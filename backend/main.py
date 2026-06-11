"""
Monitoring App - FastAPI Backend
Streams script execution logs in real-time via WebSocket.
SSH execution (with optional jump host) is handled via asyncssh.
"""
import asyncio
import json
import os
import tempfile
import uuid
from pathlib import Path
from typing import Optional

import asyncssh
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─── Paths ────────────────────────────────────────────────────────────────────
# DATA_DIR env var allows overriding the data root (used in Docker deployments).
_data_env = os.environ.get("DATA_DIR")
BASE_DIR = Path(_data_env) if _data_env else Path(__file__).parent.parent
SCRIPTS_DIR = BASE_DIR / "scripts"
MACHINES_FILE = BASE_DIR / "backend" / "machines.json"
ENVIRONMENTS_FILE = BASE_DIR / "backend" / "environments.json"
INVENTORIES_FILE = BASE_DIR / "backend" / "inventories.json"
SCRIPT_EXTS = {".sh", ".py", ".bash", ".zsh", ".yml", ".yaml"}

HISTORY_FILE = BASE_DIR / "backend" / "history.json"
SCRIPTS_DIR.mkdir(exist_ok=True)


def _sanitize_env_name(name: str) -> str:
    import re as _re
    return _re.sub(r'[^a-zA-Z0-9_-]', '_', name)[:64] or "env"

def _get_env_folder(env_id: str) -> str:
    """Return sanitized env name for use as directory. Falls back to UUID."""
    envs = _load_envs()
    for e in envs:
        if e.get("id") == env_id:
            return _sanitize_env_name(e.get("name", env_id))
    return env_id

def _get_scripts_dir(env_id: str = "") -> Path:
    if env_id:
        d = BASE_DIR / "envs" / _get_env_folder(env_id) / "scripts"
        d.mkdir(parents=True, exist_ok=True)
        # Ensure the 3 category subdirectories always exist
        for sub in ("ansible", "bash", "powershell"):
            (d / sub).mkdir(exist_ok=True)
        return d
    return SCRIPTS_DIR


def _get_logs_dir(env_id: str = "") -> Path:
    if env_id:
        d = BASE_DIR / "envs" / _get_env_folder(env_id) / "logs"
        d.mkdir(parents=True, exist_ok=True)
        return d
    return BASE_DIR / "logs"
for _f, _d in [(MACHINES_FILE, "[]"), (ENVIRONMENTS_FILE, "[]"), (INVENTORIES_FILE, "[]"), (HISTORY_FILE, "[]")]:
    _f.parent.mkdir(parents=True, exist_ok=True)
    if not _f.exists():
        _f.write_text(_d)

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="Monitoring App")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── Models ───────────────────────────────────────────────────────────────────
class Environment(BaseModel):
    id: str = ""
    name: str
    color: str = "slate"


class JumpHost(BaseModel):
    host: str
    port: int = 22
    username: str
    auth_method: str = "key"
    key_path: Optional[str] = None
    password: Optional[str] = None


class Machine(BaseModel):
    id: str = ""
    name: str
    host: str = ""
    port: int = 22
    username: str = ""
    auth_method: str = "key"  # key | password | kerberos | winrm | inventory | none
    key_path: Optional[str] = None
    password: Optional[str] = None
    use_ansible: bool = False
    ansible_inventory: Optional[str] = None
    jump_hosts: list[JumpHost] = []   # ordered chain; first = nearest to us
    jump_host: Optional[JumpHost] = None   # legacy single hop kept for compat
    environment_id: Optional[str] = None
    timeout_s: int = 10


class AnsibleInventory(BaseModel):
    id: str = ""
    name: str
    content: str = ""
    is_ephemeral: bool = False
    base_content: str = ""
    description: str = ""
    environment_id: Optional[str] = None


class BulkImportRequest(BaseModel):
    hosts: list[str]
    username: str
    port: int = 22
    auth_method: str = "key"
    key_path: Optional[str] = None
    password: Optional[str] = None
    name_prefix: str = ""
    use_ansible: bool = False
    ansible_inventory: Optional[str] = None
    environment_id: Optional[str] = None
    jump_hosts: list[JumpHost] = []   # ordered chain
    jump_host: Optional[JumpHost] = None  # legacy compat


class SaveLogsRequest(BaseModel):
    lines: list[str]
    script: str
    env_id: str = ""

class ParseInventoryRequest(BaseModel):
    content: str

class HistoryEntry(BaseModel):
    id: str = ""
    script: str
    machine_name: str
    machine_id: str
    args: str = ""
    timestamp: str = ""
    status: str = "running"  # running | done | error
    use_ansible: bool = False
    environment_id: Optional[str] = None


class RunRequest(BaseModel):
    script: str
    machine_id: str = ""          # optional when inline params provided
    args: str = ""
    inventory_id: str = ""
    ephemeral_hosts: list[str] = []
    environment_id: str = ""
    # Inline connection params (used when machine_id is empty)
    host: str = ""
    port: int = 22
    username: str = ""
    auth_method: str = "key"      # key | password | inventory | none
    key_path: Optional[str] = None
    password: Optional[str] = None


# ─── Active runs ──────────────────────────────────────────────────────────────
active_runs: dict[str, asyncio.Queue] = {}
active_tasks: dict[str, asyncio.Task] = {}
active_processes: dict[str, asyncio.subprocess.Process] = {}
run_history_status: dict[str, str] = {}  # run_id -> final status for history update

def _load_history() -> list[dict]:  return json.loads(HISTORY_FILE.read_text())
def _save_history(h: list[dict]):   HISTORY_FILE.write_text(json.dumps(h, indent=2))

@app.get("/api/history")
def get_history(env_id: str = ""):
    h = _load_history()
    if env_id:
        h = [e for e in h if e.get("environment_id") == env_id]
    return {"history": list(reversed(h))}

def _update_history_status(run_id: str, status: str):
    try:
        h = _load_history()
        for entry in h:
            if entry.get("id") == run_id:
                entry["status"] = status
                break
        _save_history(h)
    except Exception:
        pass

@app.delete("/api/history", status_code=204)
def clear_history(env_id: str = ""):
    if env_id:
        h = [e for e in _load_history() if e.get("environment_id") != env_id]
        _save_history(h)
    else:
        _save_history([])

@app.get("/api/logs/list")
def list_logs(env_id: str = ""):
    import datetime as dt
    logs_root = _get_logs_dir(env_id)
    files = []
    for category in ["ansible", "bash"]:
        cat_dir = logs_root / category
        if cat_dir.exists():
            for f in sorted(cat_dir.iterdir(), reverse=True):
                if f.is_file() and f.suffix == ".log":
                    stat = f.stat()
                    files.append({
                        "name": f.name,
                        "category": category,
                        "path": str(f.relative_to(BASE_DIR)),
                        "size": stat.st_size,
                        "modified": dt.datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    })
    return {"files": files}

@app.get("/api/logs/content")
def get_log_content(path: str):
    log_path = (BASE_DIR / path).resolve()
    logs_root = (BASE_DIR / "logs").resolve()
    if not str(log_path).startswith(str(logs_root)):
        raise HTTPException(400, "Invalid path")
    if not log_path.exists():
        raise HTTPException(404, "Log file not found")
    return {"content": log_path.read_text()}

@app.delete("/api/logs/file")
def delete_log_file(path: str):
    log_path = (BASE_DIR / path).resolve()
    logs_root = (BASE_DIR / "logs").resolve()
    if not str(log_path).startswith(str(logs_root)):
        raise HTTPException(400, "Invalid path")
    if not log_path.exists():
        raise HTTPException(404, "Log file not found")
    log_path.unlink()
    return {"ok": True}

# ─── Scripts ──────────────────────────────────────────────────────────────────
@app.get("/api/scripts")
def list_scripts():
    return {"scripts": sorted(f.name for f in SCRIPTS_DIR.iterdir()
                              if f.is_file() and f.suffix in SCRIPT_EXTS)}


@app.get("/api/scripts/tree")
def scripts_tree(env_id: str = ""):
    scripts_root = _get_scripts_dir(env_id)
    def build(path: Path):
        if path.is_dir():
            children = [
                n for child in sorted(path.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
                if not child.name.startswith(".")
                for n in [build(child)] if n is not None
            ]
            if not children and path != SCRIPTS_DIR:
                return None
            return {"name": path.name,
                    "path": str(path.relative_to(scripts_root)) if path != scripts_root else "",
                    "type": "dir", "children": children}
        elif path.is_file() and path.suffix in SCRIPT_EXTS:
            return {"name": path.name, "path": str(path.relative_to(scripts_root)),
                    "type": "file", "children": []}
        return None

    return build(scripts_root) or {"name": "scripts", "path": "", "type": "dir", "children": []}


# ─── Environments ─────────────────────────────────────────────────────────────
def _load_envs():  return json.loads(ENVIRONMENTS_FILE.read_text())
def _save_envs(e): ENVIRONMENTS_FILE.write_text(json.dumps(e, indent=2))

@app.get("/api/scripts/content")
def get_script_content(path: str, env_id: str = ""):
    scripts_root = _get_scripts_dir(env_id)
    script_path = (scripts_root / path).resolve()
    if not str(script_path).startswith(str(scripts_root.resolve())):
        raise HTTPException(400, "Invalid path")
    if not script_path.exists():
        raise HTTPException(404, "Script not found")
    try:
        return {"content": script_path.read_text(errors="replace"), "name": script_path.name, "path": path}
    except Exception as e:
        raise HTTPException(500, str(e))


class SaveScriptRequest(BaseModel):
    path: str
    content: str
    env_id: str = ""


@app.put("/api/scripts/content")
def save_script_content(req: SaveScriptRequest):
    scripts_root = _get_scripts_dir(req.env_id)
    script_path = (scripts_root / req.path).resolve()
    if not str(script_path).startswith(str(scripts_root.resolve())):
        raise HTTPException(400, "Invalid path")
    if not script_path.exists():
        raise HTTPException(404, "Script not found")
    try:
        script_path.write_text(req.content)
        return {"ok": True, "path": req.path}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/inventories/parse")
def parse_inventory_content(req: ParseInventoryRequest):
    """Parse an Ansible INI-style inventory, return groups and hosts."""
    groups: dict[str, list[str]] = {}
    all_hosts: dict[str, dict] = {}
    current_group: str | None = "ungrouped"
    skip_section = False

    for raw_line in req.content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or line.startswith(';'):
            continue
        if line.startswith('[') and ']' in line:
            bracket_content = line[1:line.index(']')]
            if ':vars' in bracket_content or ':children' in bracket_content:
                skip_section = True
                current_group = None
            else:
                skip_section = False
                current_group = bracket_content.strip()
                if current_group not in groups:
                    groups[current_group] = []
        elif not skip_section and current_group is not None:
            parts = line.split()
            if not parts:
                continue
            host = parts[0]
            if host not in all_hosts:
                all_hosts[host] = {"name": host, "groups": [], "variables": {}}
            if current_group not in all_hosts[host]["groups"]:
                all_hosts[host]["groups"].append(current_group)
            if current_group not in groups:
                groups[current_group] = []
            if host not in groups[current_group]:
                groups[current_group].append(host)
            for part in parts[1:]:
                if '=' in part:
                    k, _, v = part.partition('=')
                    all_hosts[host]["variables"][k] = v

    # Remove ungrouped if empty
    if not groups.get("ungrouped"):
        groups.pop("ungrouped", None)

    return {
        "groups": groups,
        "all_hosts": list(all_hosts.values()),
        "host_count": len(all_hosts),
    }


@app.get("/api/environments")
def get_environments(): return {"environments": _load_envs()}

@app.post("/api/environments", status_code=201)
def create_environment(env: Environment):
    envs = _load_envs(); env.id = str(uuid.uuid4()); envs.append(env.model_dump()); _save_envs(envs)
    return env.model_dump()

@app.put("/api/environments/{env_id}")
def update_environment(env_id: str, env: Environment):
    envs = _load_envs()
    idx = next((i for i, e in enumerate(envs) if e["id"] == env_id), None)
    if idx is None: raise HTTPException(404, "Environment not found")
    env.id = env_id; envs[idx] = env.model_dump(); _save_envs(envs)
    return env.model_dump()

@app.delete("/api/environments/{env_id}", status_code=204)
def delete_environment(env_id: str):
    envs = _load_envs(); filtered = [e for e in envs if e["id"] != env_id]
    if len(filtered) == len(envs): raise HTTPException(404, "Environment not found")
    _save_envs(filtered)


# ─── Inventories ──────────────────────────────────────────────────────────────
import re as _re_inv

def _get_inventory_dir(env_id: str = "") -> Path:
    """Return (and create) the ansible_inventory folder for an env (or _global)."""
    if env_id:
        folder = _get_env_folder(env_id)
    else:
        folder = "_global"
    d = BASE_DIR / "envs" / folder / "ansible_inventory"
    d.mkdir(parents=True, exist_ok=True)
    return d

def _sanitize_inv_filename(name: str) -> str:
    safe = _re_inv.sub(r'[^a-zA-Z0-9_.-]', '_', name).strip('_')[:60]
    return (safe or "inventory") + ".ini"

def _unique_filename(name: str, env_id: str, exclude_id: str = "") -> str:
    """Return a filename that doesn't collide with other inventories in the same env dir."""
    metas = json.loads(INVENTORIES_FILE.read_text())
    taken = {
        m.get("filename") for m in metas
        if m.get("environment_id") == env_id and m.get("id") != exclude_id and m.get("filename")
    }
    base = _sanitize_inv_filename(name)
    stem, ext = base[:-4], ".ini"
    candidate = base
    n = 1
    while candidate in taken:
        candidate = f"{stem}_{n}{ext}"
        n += 1
    return candidate

def _inv_file_path(meta: dict) -> Path:
    return _get_inventory_dir(meta.get("environment_id") or "") / (meta.get("filename") or (meta["id"] + ".ini"))

def _read_inv_content(meta: dict) -> str:
    p = _inv_file_path(meta)
    return p.read_text() if p.exists() else ""

def _write_inv_content(meta: dict, content: str) -> None:
    _inv_file_path(meta).write_text(content)

def _build_full_inv(meta: dict) -> dict:
    """Augment a metadata record with content/base_content read from disk."""
    raw = _read_inv_content(meta)
    entry = {k: v for k, v in meta.items() if k not in ("content", "base_content")}
    if meta.get("is_ephemeral"):
        entry["content"] = ""
        entry["base_content"] = raw
    else:
        entry["content"] = raw
        entry["base_content"] = ""
    return entry

def _load_inventory_meta() -> list[dict]:
    return json.loads(INVENTORIES_FILE.read_text())

def _save_inventory_meta(metas: list[dict]) -> None:
    # Strip any stray inline content before writing
    clean = [{k: v for k, v in m.items() if k not in ("content", "base_content")} for m in metas]
    INVENTORIES_FILE.write_text(json.dumps(clean, indent=2))

def _load_inventories() -> list[dict]:
    """Load all inventories; auto-migrates legacy inline-content entries to files."""
    metas = json.loads(INVENTORIES_FILE.read_text())
    needs_save = False
    taken: set[str] = {m.get("filename") for m in metas if m.get("filename")}  # type: ignore[misc]
    for m in metas:
        if not m.get("filename"):
            # Legacy entry — assign a filename and migrate content to file
            fname = _sanitize_inv_filename(m.get("name", m.get("id", "inventory")))
            stem, ext = fname[:-4], ".ini"
            candidate = fname
            n = 1
            while candidate in taken:
                candidate = f"{stem}_{n}{ext}"
                n += 1
            m["filename"] = candidate
            taken.add(candidate)
            # Write inline content to file
            inline = m.get("content") or m.get("base_content") or ""
            _write_inv_content(m, inline)
            needs_save = True
        # Always strip inline content from the in-memory meta before returning
    if needs_save:
        _save_inventory_meta(metas)
    return [_build_full_inv(m) for m in metas]

def _save_inventories(invs: list[dict]) -> None:
    """Legacy helper kept for callers that pass full objects; writes content to files."""
    metas = []
    for inv in invs:
        content = inv.get("content") or inv.get("base_content") or ""
        meta = {k: v for k, v in inv.items() if k not in ("content", "base_content")}
        if not meta.get("filename"):
            meta["filename"] = _unique_filename(meta.get("name", meta.get("id", "")),
                                                meta.get("environment_id") or "",
                                                meta.get("id", ""))
        _write_inv_content(meta, content)
        metas.append(meta)
    _save_inventory_meta(metas)

@app.get("/api/inventories")
def get_inventories(env_id: str = ""):
    invs = _load_inventories()
    if env_id:
        invs = [i for i in invs if i.get("environment_id") == env_id]
    return {"inventories": invs}

@app.post("/api/inventories", status_code=201)
def create_inventory(inv: AnsibleInventory):
    metas = _load_inventory_meta()
    inv.id = str(uuid.uuid4())
    env_id = inv.environment_id or ""
    filename = _unique_filename(inv.name, env_id)
    meta = {k: v for k, v in inv.model_dump().items() if k not in ("content", "base_content")}
    meta["filename"] = filename
    content = inv.base_content if inv.is_ephemeral else inv.content
    _write_inv_content(meta, content)
    metas.append(meta)
    _save_inventory_meta(metas)
    return _build_full_inv(meta)

@app.put("/api/inventories/{inv_id}")
def update_inventory(inv_id: str, inv: AnsibleInventory):
    metas = _load_inventory_meta()
    idx = next((i for i, x in enumerate(metas) if x["id"] == inv_id), None)
    if idx is None:
        raise HTTPException(404, "Inventory not found")
    old_meta = metas[idx]
    env_id = inv.environment_id or ""
    # If name changed, rename file
    new_filename = old_meta.get("filename") or _unique_filename(inv.name, env_id, inv_id)
    if old_meta.get("name") != inv.name:
        new_filename = _unique_filename(inv.name, env_id, inv_id)
        old_path = _inv_file_path(old_meta)
        new_meta_tmp = dict(old_meta)
        new_meta_tmp["filename"] = new_filename
        new_meta_tmp["environment_id"] = env_id
        new_path = _inv_file_path(new_meta_tmp)
        if old_path.exists() and old_path != new_path:
            old_path.rename(new_path)
    inv.id = inv_id
    new_meta = {k: v for k, v in inv.model_dump().items() if k not in ("content", "base_content")}
    new_meta["filename"] = new_filename
    content = inv.base_content if inv.is_ephemeral else inv.content
    _write_inv_content(new_meta, content)
    metas[idx] = new_meta
    _save_inventory_meta(metas)
    return _build_full_inv(new_meta)

@app.delete("/api/inventories/{inv_id}", status_code=204)
def delete_inventory(inv_id: str):
    metas = _load_inventory_meta()
    meta = next((m for m in metas if m["id"] == inv_id), None)
    if meta is None:
        raise HTTPException(404, "Inventory not found")
    # Delete file
    try:
        _inv_file_path(meta).unlink(missing_ok=True)
    except Exception:
        pass
    _save_inventory_meta([m for m in metas if m["id"] != inv_id])


# ─── WireGuard ────────────────────────────────────────────────────────────────
WIREGUARD_FILE = BASE_DIR / "backend" / "wireguard.json"
WIREGUARD_FILE.parent.mkdir(parents=True, exist_ok=True)
if not WIREGUARD_FILE.exists():
    WIREGUARD_FILE.write_text("[]")


class WireGuardPeer(BaseModel):
    public_key: str = ""
    endpoint: str = ""
    allowed_ips: str = "0.0.0.0/0, ::/0"
    preshared_key: str = ""
    persistent_keepalive: int = 25


class WireGuardConfig(BaseModel):
    id: str = ""
    name: str
    private_key: str = ""
    address: str = ""
    dns: str = ""
    peer: WireGuardPeer = WireGuardPeer()


def _load_wg():  return json.loads(WIREGUARD_FILE.read_text())
def _save_wg(d): WIREGUARD_FILE.write_text(json.dumps(d, indent=2))


def _wg_iface(name: str) -> str:
    import re as _re
    return _re.sub(r'[^a-zA-Z0-9_-]', '_', name)[:15]


def _build_wg_conf(cfg: dict) -> str:
    p = cfg.get("peer") or {}
    lines = ["[Interface]"]
    if cfg.get("private_key"):         lines.append(f"PrivateKey = {cfg['private_key']}")
    if cfg.get("address"):             lines.append(f"Address = {cfg['address']}")
    if cfg.get("dns"):                 lines.append(f"DNS = {cfg['dns']}")
    lines += ["", "[Peer]"]
    if p.get("public_key"):            lines.append(f"PublicKey = {p['public_key']}")
    if p.get("preshared_key"):         lines.append(f"PresharedKey = {p['preshared_key']}")
    if p.get("endpoint"):              lines.append(f"Endpoint = {p['endpoint']}")
    if p.get("allowed_ips"):           lines.append(f"AllowedIPs = {p['allowed_ips']}")
    if p.get("persistent_keepalive"):  lines.append(f"PersistentKeepalive = {p['persistent_keepalive']}")
    return "\n".join(lines) + "\n"


@app.get("/api/wireguard")
def get_wireguard(): return {"configs": _load_wg()}

@app.post("/api/wireguard/genkeys")
async def generate_wg_keys():
    try:
        p1 = await asyncio.create_subprocess_exec("wg", "genkey",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        priv_b, _ = await p1.communicate()
        priv = priv_b.decode().strip()
        p2 = await asyncio.create_subprocess_exec("wg", "pubkey",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        pub_b, _ = await p2.communicate(input=priv.encode())
        return {"private_key": priv, "public_key": pub_b.decode().strip()}
    except FileNotFoundError:
        raise HTTPException(503, "wg not available on this system")

@app.post("/api/wireguard", status_code=201)
def create_wireguard(cfg: WireGuardConfig):
    cfgs = _load_wg(); cfg.id = str(uuid.uuid4())
    cfgs.append(cfg.model_dump()); _save_wg(cfgs)
    return cfg.model_dump()

@app.put("/api/wireguard/{cfg_id}")
def update_wireguard(cfg_id: str, cfg: WireGuardConfig):
    cfgs = _load_wg()
    idx = next((i for i, c in enumerate(cfgs) if c["id"] == cfg_id), None)
    if idx is None: raise HTTPException(404, "Config not found")
    cfg.id = cfg_id; cfgs[idx] = cfg.model_dump(); _save_wg(cfgs)
    return cfg.model_dump()

@app.delete("/api/wireguard/{cfg_id}", status_code=204)
def delete_wireguard(cfg_id: str):
    cfgs = _load_wg(); filtered = [c for c in cfgs if c["id"] != cfg_id]
    if len(filtered) == len(cfgs): raise HTTPException(404, "Config not found")
    _save_wg(filtered)

@app.get("/api/wireguard/{cfg_id}/status")
async def wireguard_status(cfg_id: str):
    cfgs = _load_wg()
    cfg = next((c for c in cfgs if c["id"] == cfg_id), None)
    if not cfg: raise HTTPException(404, "Config not found")
    iface = _wg_iface(cfg["name"])
    try:
        proc = await asyncio.create_subprocess_exec("wg", "show", iface,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            return {"connected": False, "interface": iface, "stderr": stderr.decode().strip()}
        output = stdout.decode()
        peer: dict = {}
        for line in output.splitlines():
            s = line.strip()
            if s.startswith("latest handshake:"):  peer["latest_handshake"] = s.split(":", 1)[1].strip()
            elif s.startswith("endpoint:"):         peer["endpoint"] = s.split(":", 1)[1].strip()
            elif s.startswith("transfer:"):         peer["transfer"] = s.split(":", 1)[1].strip()
            elif s.startswith("allowed ips:"):      peer["allowed_ips"] = s.split(":", 1)[1].strip()
        return {"connected": True, "interface": iface, "peer": peer, "raw": output}
    except FileNotFoundError:
        return {"connected": False, "interface": iface, "error": "wg not installed"}
    except Exception as e:
        return {"connected": False, "interface": iface, "error": str(e)}

@app.post("/api/wireguard/{cfg_id}/connect")
async def wireguard_connect(cfg_id: str):
    cfgs = _load_wg()
    cfg = next((c for c in cfgs if c["id"] == cfg_id), None)
    if not cfg: raise HTTPException(404, "Config not found")
    iface = _wg_iface(cfg["name"])
    conf_path = Path(f"/tmp/wg_{iface}.conf")
    conf_path.write_text(_build_wg_conf(cfg)); conf_path.chmod(0o600)
    try:
        proc = await asyncio.create_subprocess_exec("wg-quick", "up", str(conf_path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        stdout, _ = await proc.communicate()
        return {"ok": proc.returncode == 0, "output": stdout.decode(), "exit_code": proc.returncode}
    except FileNotFoundError:
        raise HTTPException(503, "wg-quick not available")

@app.post("/api/wireguard/{cfg_id}/disconnect")
async def wireguard_disconnect(cfg_id: str):
    cfgs = _load_wg()
    cfg = next((c for c in cfgs if c["id"] == cfg_id), None)
    if not cfg: raise HTTPException(404, "Config not found")
    iface = _wg_iface(cfg["name"])
    conf_path = Path(f"/tmp/wg_{iface}.conf")
    if not conf_path.exists():
        conf_path.write_text(_build_wg_conf(cfg)); conf_path.chmod(0o600)
    try:
        proc = await asyncio.create_subprocess_exec("wg-quick", "down", str(conf_path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        stdout, _ = await proc.communicate()
        return {"ok": proc.returncode == 0, "output": stdout.decode(), "exit_code": proc.returncode}
    except FileNotFoundError:
        raise HTTPException(503, "wg-quick not available")


# ─── Machines ─────────────────────────────────────────────────────────────────
def _load_machines():  return json.loads(MACHINES_FILE.read_text())
def _save_machines(m): MACHINES_FILE.write_text(json.dumps(m, indent=2))

def _strip_password(m: dict) -> dict:
    r = {k: v for k, v in m.items() if k != "password"}
    if r.get("jump_host") and isinstance(r["jump_host"], dict):
        r["jump_host"] = {k: v for k, v in r["jump_host"].items() if k != "password"}
    return r

@app.get("/api/machines")
def get_machines(): return {"machines": [_strip_password(m) for m in _load_machines()]}

@app.post("/api/machines", status_code=201)
def create_machine(machine: Machine):
    machines = _load_machines(); machine.id = str(uuid.uuid4())
    machines.append(machine.model_dump()); _save_machines(machines)
    return _strip_password(machine.model_dump())

@app.post("/api/machines/bulk", status_code=201)
def bulk_create_machines(req: BulkImportRequest):
    # Normalise jump_hosts: prefer the new list, fall back to legacy single jump_host
    hops = req.jump_hosts or (([req.jump_host] if req.jump_host else []))
    machines = _load_machines(); created = []
    for raw_host in req.hosts:
        host = raw_host.strip()
        if not host: continue
        m = Machine(id=str(uuid.uuid4()),
                    name=f"{req.name_prefix}{host}" if req.name_prefix else host,
                    host=host, port=req.port, username=req.username,
                    auth_method=req.auth_method, key_path=req.key_path,
                    password=req.password, use_ansible=req.use_ansible,
                    ansible_inventory=req.ansible_inventory,
                    environment_id=req.environment_id,
                    jump_hosts=hops, jump_host=hops[0] if len(hops) == 1 else None)
        machines.append(m.model_dump()); created.append(_strip_password(m.model_dump()))
    _save_machines(machines); return {"created": created}

@app.put("/api/machines/{machine_id}")
def update_machine(machine_id: str, machine: Machine):
    machines = _load_machines()
    idx = next((i for i, m in enumerate(machines) if m["id"] == machine_id), None)
    if idx is None: raise HTTPException(404, "Machine not found")
    machine.id = machine_id; machines[idx] = machine.model_dump(); _save_machines(machines)
    return _strip_password(machine.model_dump())

@app.delete("/api/machines/{machine_id}", status_code=204)
def delete_machine(machine_id: str):
    machines = _load_machines(); filtered = [m for m in machines if m["id"] != machine_id]
    if len(filtered) == len(machines): raise HTTPException(404, "Machine not found")
    _save_machines(filtered)


# ─── Run ──────────────────────────────────────────────────────────────────────
def _script_type_from_path(script: str) -> str:
    """Derive script type from top-level folder name."""
    top = script.split("/")[0] if "/" in script else ""
    return top  # "ansible" | "bash" | "powershell" | ""


@app.post("/api/run")
async def start_run(req: RunRequest):
    scripts_root = _get_scripts_dir(req.environment_id)
    script_path = scripts_root / req.script
    if not script_path.exists(): raise HTTPException(404, f"Script '{req.script}' not found")
    script_path.resolve().relative_to(scripts_root.resolve())

    # Build machine dict — from DB or from inline params
    if req.machine_id:
        machines = _load_machines()
        machine = next((m for m in machines if m["id"] == req.machine_id), None)
        if machine is None: raise HTTPException(404, "Machine not found")
    else:
        # Inline / ephemeral machine — never stored in DB
        script_type = _script_type_from_path(req.script)
        use_ansible = (script_type == "ansible")
        machine = {
            "id": "", "name": req.host or "inline",
            "host": req.host, "port": req.port,
            "username": req.username, "auth_method": req.auth_method,
            "key_path": req.key_path, "password": req.password,
            "use_ansible": use_ansible,
            "ansible_inventory": None,
            "jump_hosts": [], "jump_host": None,
            "environment_id": req.environment_id or None,
        }

    inventory = None
    if req.inventory_id:
        inventory = next((i for i in _load_inventories() if i["id"] == req.inventory_id), None)

    run_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    active_runs[run_id] = queue
    import datetime as dt
    history = _load_history()
    history.append({
        "id": run_id, "script": req.script, "machine_name": machine.get("name","?"),
        "machine_id": req.machine_id, "args": req.args,
        "timestamp": dt.datetime.now().isoformat(timespec="seconds"),
        "status": "running",
        "environment_id": req.environment_id or None,
    })
    _save_history(history)
    task = asyncio.create_task(_execute_script(run_id, machine, script_path, req.args, queue,
                                        inventory, req.ephemeral_hosts))
    active_tasks[run_id] = task
    return {"run_id": run_id}


@app.post("/api/runs/{run_id}/cancel")
async def cancel_run(run_id: str):
    task = active_tasks.get(run_id)
    proc = active_processes.get(run_id)
    if not task and not proc:
        raise HTTPException(404, "Run not found or already completed")
    if proc and proc.returncode is None:
        try: proc.terminate()
        except Exception: pass
    if task and not task.done():
        task.cancel()
    queue = active_runs.get(run_id)
    if queue:
        await queue.put("[INFO] Cancelled by user.\n")
        await queue.put(None)
    _update_history_status(run_id, "error")
    return {"ok": True}


async def _execute_local(run_id, machine, script_path, args, queue,
                          inventory=None, ephemeral_hosts=None):
    """Execute via local Ansible for kerberos/winrm machines (no SSH needed)."""
    local_inv = None
    try:
        host = machine.get("host") or "localhost"
        auth_method = machine.get("auth_method", "key")

        if inventory:
            if inventory.get("is_ephemeral"):
                hosts = ephemeral_hosts or [host]
                base = (inventory.get("base_content") or "").rstrip("\n")
                inv_content = base + "\n\n" + "\n".join(hosts) + "\n"
            else:
                inv_content = inventory.get("content") or ""
        else:
            inv_vars = ""
            if auth_method in ("kerberos", "winrm"):
                inv_vars = " ansible_connection=winrm"
                inv_vars += " ansible_winrm_transport=" + ("kerberos" if auth_method == "kerberos" else "ntlm")
                if machine.get("username"):
                    inv_vars += f" ansible_user={machine['username']}"
                if auth_method == "winrm" and machine.get("password"):
                    inv_vars += f" ansible_password={machine['password']}"
            inv_content = f"[targets]\n{host}{inv_vars}\n"

        with tempfile.NamedTemporaryFile(mode="w", suffix=".ini", delete=False) as f:
            f.write(inv_content)
            local_inv = f.name

        is_playbook = script_path.suffix in {".yml", ".yaml"}
        # --limit: apply host filter for non-ephemeral inventories when hosts are specified
        limit_arg = ""
        if ephemeral_hosts and inventory and not inventory.get("is_ephemeral"):
            limit_arg = " --limit '" + ",".join(ephemeral_hosts) + "'"
        if is_playbook:
            cmd_parts = ["ansible-playbook", "-i", local_inv]
            if limit_arg.strip():
                cmd_parts += ["--limit", ",".join(ephemeral_hosts)]
            cmd_parts.append(str(script_path))
            if args:
                cmd_parts.extend(args.split())
        else:
            cmd_parts = ["ansible", "all", "-i", local_inv]
            if limit_arg.strip():
                cmd_parts += ["--limit", ",".join(ephemeral_hosts)]
            cmd_parts += ["-m", "script", "-a", f"{script_path} {args}".strip()]

        await queue.put(f"[INFO] Running locally: {' '.join(cmd_parts)}\n")
        await queue.put("-" * 60 + "\n")

        proc = await asyncio.create_subprocess_exec(
            *cmd_parts,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        active_processes[run_id] = proc
        assert proc.stdout is not None
        async for line in proc.stdout:
            await queue.put(line.decode(errors="replace"))
        await proc.wait()
        exit_code = proc.returncode
        await queue.put("-" * 60 + "\n")
        await queue.put(f"[INFO] Finished with exit code: {exit_code}\n")
    except asyncio.CancelledError:
        await queue.put("[INFO] Cancelled by user.\n")
        raise
    finally:
        if local_inv:
            try: os.unlink(local_inv)
            except Exception: pass
        active_processes.pop(run_id, None)


def _build_connect_kwargs(cfg: dict) -> dict:
    kw: dict = {"host": cfg["host"], "port": cfg.get("port", 22),
                "username": cfg["username"], "known_hosts": None,
                "connect_timeout": cfg.get("timeout_s", 10)}
    if cfg.get("auth_method") == "password" and cfg.get("password"):
        kw["password"] = cfg["password"]
    else:
        kw["client_keys"] = [cfg.get("key_path") or os.path.expanduser("~/.ssh/id_rsa")]
    return kw


async def _open_ssh_chain(machine: dict, queue: asyncio.Queue):
    """Open a (possibly multi-hop) asyncssh connection and return it as a context manager stack."""
    # Normalise hops list: prefer jump_hosts list, fall back to legacy jump_host
    hops: list[dict] = machine.get("jump_hosts") or []
    if not hops and machine.get("jump_host") and machine["jump_host"].get("host"):
        hops = [machine["jump_host"]]

    target_kw = _build_connect_kwargs(machine)

    # Build a contextlib.AsyncExitStack that opens each hop in sequence
    import contextlib
    stack = contextlib.AsyncExitStack()
    tunnel_conn = None
    for i, hop in enumerate(hops):
        if not hop.get("host"): continue
        hop_kw = _build_connect_kwargs(hop)
        label = f"hop {i+1} ({hop['host']}:{hop.get('port',22)})"
        await queue.put(f"[INFO] Connecting to {label}...\n")
        if tunnel_conn is not None:
            hop_kw["tunnel"] = tunnel_conn
        tunnel_conn = await stack.enter_async_context(asyncssh.connect(**hop_kw))

    if tunnel_conn is not None:
        target_kw["tunnel"] = tunnel_conn
    await queue.put(f"[INFO] Connecting to target {machine['host']}:{machine.get('port',22)}...\n")
    conn = await stack.enter_async_context(asyncssh.connect(**target_kw))
    return stack, conn


async def _execute_script(run_id, machine, script_path, args, queue,
                           inventory=None, ephemeral_hosts=None):
    auth = machine.get("auth_method", "key")

    # Local execution for kerberos / winrm / inventory-based ansible
    if auth in ("kerberos", "winrm", "inventory"):
        try:
            await _execute_local(run_id, machine, script_path, args, queue, inventory, ephemeral_hosts)
        except asyncio.CancelledError:
            _update_history_status(run_id, "error")
        except Exception as e:
            await queue.put(f"[ERROR] {type(e).__name__}: {e}\n")
            _update_history_status(run_id, "error")
        else:
            _update_history_status(run_id, "done")
        finally:
            active_tasks.pop(run_id, None)
            if active_runs.get(run_id) is queue:
                await queue.put(None)
        return

    # "none" auth — run script locally on the control node without SSH
    if auth == "none":
        try:
            await queue.put(f"[INFO] Running locally (no SSH): {script_path.name} {args}\n")
            await queue.put("-" * 60 + "\n")
            cmd_parts: list[str]
            if script_path.suffix in {".yml", ".yaml"}:
                cmd_parts = ["ansible-playbook", str(script_path)]
                if args: cmd_parts.extend(args.split())
            elif script_path.suffix == ".py":
                cmd_parts = ["python3", str(script_path)] + (args.split() if args else [])
            else:
                import stat as _stat
                script_path.chmod(script_path.stat().st_mode | _stat.S_IXUSR)
                cmd_parts = [str(script_path)] + (args.split() if args else [])
            proc = await asyncio.create_subprocess_exec(
                *cmd_parts,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
            active_processes[run_id] = proc
            assert proc.stdout is not None
            async for line in proc.stdout:
                await queue.put(line.decode(errors="replace"))
            await proc.wait()
            await queue.put("-" * 60 + "\n")
            await queue.put(f"[INFO] Finished with exit code: {proc.returncode}\n")
        except asyncio.CancelledError:
            await queue.put("[INFO] Cancelled by user.\n")
            _update_history_status(run_id, "error")
            raise
        except Exception as e:
            await queue.put(f"[ERROR] {type(e).__name__}: {e}\n")
            _update_history_status(run_id, "error")
        else:
            _update_history_status(run_id, "done")
        finally:
            active_processes.pop(run_id, None)
            active_tasks.pop(run_id, None)
            if active_runs.get(run_id) is queue:
                await queue.put(None)
        return

    async def _run_on_conn(conn):
        use_ansible = machine.get("use_ansible", False)
        await queue.put(f"[INFO] Connected to {machine['host']}. "
                        f"{'Uploading playbook + inventory to run ansible remotely' if use_ansible else 'Uploading script'}...\n")
        remote_script = f"/tmp/_monitor_{uuid.uuid4().hex}_{script_path.name}"
        remote_inv: str | None = None
        local_inv: str | None = None
        try:
            async with conn.start_sftp_client() as sftp:
                await sftp.put(str(script_path), remote_script)
                if machine.get("use_ansible") and inventory:
                    if inventory.get("is_ephemeral"):
                        hosts = ephemeral_hosts or [machine["host"]]
                        base = (inventory.get("base_content") or "").rstrip("\n")
                        inv_content = base + "\n\n" + "\n".join(hosts) + "\n"
                    else:
                        inv_content = inventory.get("content") or ""
                    with tempfile.NamedTemporaryFile(mode="w", suffix=".ini", delete=False) as f:
                        f.write(inv_content); local_inv = f.name
                    remote_inv = f"/tmp/_monitor_inv_{uuid.uuid4().hex}.ini"
                    await sftp.put(local_inv, remote_inv)

            if machine.get("use_ansible"):
                inv_arg = remote_inv or machine.get("ansible_inventory") or "localhost,"
                # --limit: apply host filter for non-ephemeral inventories when hosts are specified
                limit_arg = ""
                if ephemeral_hosts and inventory and not inventory.get("is_ephemeral"):
                    limit_arg = " --limit '" + ",".join(ephemeral_hosts) + "'"
                if script_path.suffix in {".yml", ".yaml"}:
                    cmd = f"ansible-playbook -i '{inv_arg}'{limit_arg} {remote_script} {args} 2>&1"
                else:
                    cmd = f"ansible all -i '{inv_arg}'{limit_arg} -m script -a '{remote_script} {args}' 2>&1"
            else:
                cmd = f"chmod +x {remote_script} && {remote_script} {args} 2>&1"

            await queue.put(f"[INFO] Running: {script_path.name} {args}\n")
            await queue.put("-" * 60 + "\n")
            async with conn.create_process(cmd) as process:
                async for line in process.stdout:
                    await queue.put(line)
                stderr = await process.stderr.read()
                if stderr:
                    for line in stderr.splitlines():
                        await queue.put(f"[STDERR] {line}\n")
                exit_code = process.returncode
            await queue.put("-" * 60 + "\n")
            await queue.put(f"[INFO] Finished with exit code: {exit_code}\n")
        finally:
            if local_inv: os.unlink(local_inv)
            to_clean = " ".join(filter(None, [remote_script, remote_inv]))
            if to_clean:
                try: await conn.run(f"rm -f {to_clean}")
                except Exception: pass

    try:
        stack, conn = await _open_ssh_chain(machine, queue)
        async with stack:
            await _run_on_conn(conn)
    except asyncssh.DisconnectError as e:
        await queue.put(f"[ERROR] SSH disconnected: {e}\n")
        _update_history_status(run_id, "error")
    except asyncssh.PermissionDenied:
        await queue.put("[ERROR] SSH permission denied. Check credentials.\n")
        _update_history_status(run_id, "error")
    except Exception as e:
        await queue.put(f"[ERROR] {type(e).__name__}: {e}\n")
        _update_history_status(run_id, "error")
    else:
        _update_history_status(run_id, "done")
    finally:
        await queue.put(None)



# ─── Save Logs ────────────────────────────────────────────────────────────────
@app.post("/api/logs/save")
def save_logs(req: SaveLogsRequest):
    import datetime
    category = "ansible" if req.use_ansible else "bash"
    logs_dir = _get_logs_dir(req.env_id) / category
    logs_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    script_base = Path(req.script).stem
    filename = f"{ts}_{script_base}.log"
    filepath = logs_dir / filename
    filepath.write_text("".join(req.lines))
    return {"path": str(filepath.relative_to(BASE_DIR)), "filename": filename}


# ─── WebSocket ────────────────────────────────────────────────────────────────
@app.websocket("/ws/{run_id}")
async def websocket_logs(websocket: WebSocket, run_id: str):
    await websocket.accept()
    if run_id not in active_runs:
        await websocket.send_text("[ERROR] Run not found\n"); await websocket.close(); return
    queue = active_runs[run_id]
    try:
        while True:
            line = await queue.get()
            if line is None: await websocket.send_text("[DONE]\n"); break
            await websocket.send_text(line)
    except WebSocketDisconnect:
        pass
    finally:
        active_runs.pop(run_id, None)


# ─── Machine SSH test ─────────────────────────────────────────────────────────
@app.post("/api/machines/{machine_id}/test")
async def test_machine_connection(machine_id: str):
    import time as _time
    machines = _load_machines()
    machine = next((m for m in machines if m["id"] == machine_id), None)
    if not machine:
        raise HTTPException(404, "Machine not found")
    auth = machine.get("auth_method", "key")
    if auth in ("kerberos", "winrm", "inventory"):
        return {"ok": None, "message": "Connection test not applicable for this auth method"}
    start = _time.monotonic()
    try:
        kw = _build_connect_kwargs(machine)
        async with asyncssh.connect(**kw) as conn:
            result = await conn.run("echo ok", timeout=machine.get("timeout_s", 10))
            _ = result
        latency_ms = int((_time.monotonic() - start) * 1000)
        return {"ok": True, "latency_ms": latency_ms}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ─── Script upload ────────────────────────────────────────────────────────────
from fastapi import UploadFile, File, Form as FForm

@app.post("/api/scripts/upload")
async def upload_script(
    env_id: str = FForm(""),
    folder: str = FForm(""),
    file: UploadFile = File(...),
):
    fname = file.filename or "script"
    ext = Path(fname).suffix.lower()
    if ext not in SCRIPT_EXTS:
        raise HTTPException(400, f"Unsupported file type: {ext}")
    scripts_root = _get_scripts_dir(env_id)
    if folder:
        target_dir = (scripts_root / folder).resolve()
        if not str(target_dir).startswith(str(scripts_root.resolve())):
            raise HTTPException(400, "Invalid folder")
        target_dir.mkdir(parents=True, exist_ok=True)
    else:
        target_dir = scripts_root
    dest = (target_dir / Path(fname).name).resolve()
    if not str(dest).startswith(str(scripts_root.resolve())):
        raise HTTPException(400, "Invalid filename")
    content = await file.read()
    dest.write_bytes(content)
    return {"ok": True, "path": str(dest.relative_to(scripts_root)), "name": dest.name}


# ─── Multi-machine run ────────────────────────────────────────────────────────
class MultiRunRequest(BaseModel):
    script: str
    machine_ids: list[str]
    args: str = ""
    inventory_id: str = ""
    environment_id: str = ""


@app.post("/api/run/multi")
async def start_multi_run(req: MultiRunRequest):
    import datetime as dt
    scripts_root = _get_scripts_dir(req.environment_id)
    script_path = scripts_root / req.script
    if not script_path.exists():
        raise HTTPException(404, f"Script '{req.script}' not found")

    machines = _load_machines()
    inventory = None
    if req.inventory_id:
        inventory = next((i for i in _load_inventories() if i["id"] == req.inventory_id), None)

    results = []
    for machine_id in req.machine_ids:
        machine = next((m for m in machines if m["id"] == machine_id), None)
        if not machine:
            continue
        run_id = str(uuid.uuid4())
        queue: asyncio.Queue = asyncio.Queue()
        active_runs[run_id] = queue
        history = _load_history()
        history.append({
            "id": run_id, "script": req.script, "machine_name": machine.get("name", "?"),
            "machine_id": machine_id, "args": req.args,
            "timestamp": dt.datetime.now().isoformat(timespec="seconds"),
            "status": "running",
            "environment_id": req.environment_id or None,
        })
        _save_history(history)
        task = asyncio.create_task(
            _execute_script(run_id, machine, script_path, req.args, queue, inventory, [])
        )
        active_tasks[run_id] = task
        results.append({"run_id": run_id, "machine_id": machine_id, "machine_name": machine.get("name", "?")})
    return {"runs": results}


# ─── Schedules ────────────────────────────────────────────────────────────────
import datetime as _dt
import threading as _threading

SCHEDULES_FILE = BASE_DIR / "backend" / "schedules.json"
SCHEDULES_FILE.parent.mkdir(parents=True, exist_ok=True)
if not SCHEDULES_FILE.exists():
    SCHEDULES_FILE.write_text("[]")

_schedule_lock = _threading.Lock()


def _load_schedules() -> list[dict]:
    with _schedule_lock:
        return json.loads(SCHEDULES_FILE.read_text())


def _save_schedules(s: list[dict]):
    with _schedule_lock:
        SCHEDULES_FILE.write_text(json.dumps(s, indent=2))


class ScheduleEntry(BaseModel):
    id: str = ""
    name: str
    script: str
    machine_id: str
    args: str = ""
    environment_id: str = ""
    cron_hour: int = 9       # 0-23
    cron_minute: int = 0     # 0-59
    enabled: bool = True
    last_run: str = ""


@app.get("/api/schedules")
def get_schedules():
    return {"schedules": _load_schedules()}


@app.post("/api/schedules", status_code=201)
def create_schedule(entry: ScheduleEntry):
    schedules = _load_schedules()
    entry.id = str(uuid.uuid4())
    schedules.append(entry.model_dump())
    _save_schedules(schedules)
    return entry.model_dump()


@app.put("/api/schedules/{sched_id}")
def update_schedule(sched_id: str, entry: ScheduleEntry):
    schedules = _load_schedules()
    idx = next((i for i, s in enumerate(schedules) if s["id"] == sched_id), None)
    if idx is None:
        raise HTTPException(404, "Schedule not found")
    entry.id = sched_id
    schedules[idx] = entry.model_dump()
    _save_schedules(schedules)
    return entry.model_dump()


@app.delete("/api/schedules/{sched_id}", status_code=204)
def delete_schedule(sched_id: str):
    schedules = _load_schedules()
    filtered = [s for s in schedules if s["id"] != sched_id]
    if len(filtered) == len(schedules):
        raise HTTPException(404, "Schedule not found")
    _save_schedules(filtered)


async def _scheduler_loop():
    """Check every minute if any schedule should fire."""
    import datetime as _dt2
    while True:
        await asyncio.sleep(30)
        try:
            now = _dt2.datetime.now()
            schedules = _load_schedules()
            for sched in schedules:
                if not sched.get("enabled"):
                    continue
                if sched.get("cron_hour") != now.hour or sched.get("cron_minute") != now.minute:
                    continue
                # Avoid double-firing within same minute
                last = sched.get("last_run", "")
                if last and last.startswith(now.strftime("%Y-%m-%dT%H:%M")):
                    continue
                # Fire the run
                scripts_root = _get_scripts_dir(sched.get("environment_id", ""))
                script_path = scripts_root / sched["script"]
                if not script_path.exists():
                    continue
                machines = _load_machines()
                machine = next((m for m in machines if m["id"] == sched["machine_id"]), None)
                if not machine:
                    continue
                run_id = str(uuid.uuid4())
                queue: asyncio.Queue = asyncio.Queue()
                active_runs[run_id] = queue
                history = _load_history()
                history.append({
                    "id": run_id, "script": sched["script"],
                    "machine_name": machine.get("name", "?"),
                    "machine_id": sched["machine_id"], "args": sched.get("args", ""),
                    "timestamp": now.isoformat(timespec="seconds"),
                    "status": "running",
                    "environment_id": sched.get("environment_id") or None,
                })
                _save_history(history)
                task = asyncio.create_task(
                    _execute_script(run_id, machine, script_path, sched.get("args", ""), queue)
                )
                active_tasks[run_id] = task
                # Update last_run
                all_s = _load_schedules()
                for s in all_s:
                    if s["id"] == sched["id"]:
                        s["last_run"] = now.isoformat(timespec="seconds")
                        break
                _save_schedules(all_s)
        except Exception:
            pass


@app.on_event("startup")
async def start_scheduler():
    asyncio.create_task(_scheduler_loop())

