import re
import sys

content = open('backend/main.py').read()

# 1. Add ParseInventoryRequest model after SaveLogsRequest
old = 'class HistoryEntry(BaseModel):'
new = '''class ParseInventoryRequest(BaseModel):
    content: str

class HistoryEntry(BaseModel):'''
assert old in content, "HistoryEntry not found"
content = content.replace(old, new, 1)

# 2. Add script content endpoint + inventory parse endpoint after /api/scripts/tree
marker = '@app.get("/api/environments")'
inject = '''@app.get("/api/scripts/content")
def get_script_content(path: str):
    script_path = (SCRIPTS_DIR / path).resolve()
    if not str(script_path).startswith(str(SCRIPTS_DIR.resolve())):
        raise HTTPException(400, "Invalid path")
    if not script_path.exists():
        raise HTTPException(404, "Script not found")
    try:
        return {"content": script_path.read_text(errors="replace"), "name": script_path.name, "path": path}
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


'''
assert marker in content, "/api/environments not found"
content = content.replace(marker, inject + marker, 1)

open('backend/main.py', 'w').write(content)
print("Done: script content + inventory parse endpoints added")
