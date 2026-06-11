
content = open('backend/main.py').read()

# 1. Make Machine.username + host optional for kerberos/winrm
old_machine = '    id: str = ""\n    name: str\n    host: str\n    port: int = 22\n    username: str\n    auth_method: str = "key"'
new_machine = '    id: str = ""\n    name: str\n    host: str = ""\n    port: int = 22\n    username: str = ""\n    auth_method: str = "key"  # key | password | kerberos | winrm'
assert old_machine in content, "Machine model not found"
content = content.replace(old_machine, new_machine, 1)

# 2. Add active_tasks and active_processes after active_runs
old_active = 'active_runs: dict[str, asyncio.Queue] = {}'
new_active = 'active_runs: dict[str, asyncio.Queue] = {}\nactive_tasks: dict[str, asyncio.Task] = {}\nactive_processes: dict[str, asyncio.subprocess.Process] = {}'
assert old_active in content
content = content.replace(old_active, new_active, 1)

# 3. Add cancel endpoint + local ansible exec before _build_connect_kwargs
old_build = 'def _build_connect_kwargs(cfg: dict) -> dict:'
cancel_and_local = '''@app.post("/api/runs/{run_id}/cancel")
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
                inv_content = (inventory.get("base_content") or "") + \
                    "\\n\\n[targets]\\n" + "\\n".join(hosts) + "\\n"
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
            inv_content = f"[targets]\\n{host}{inv_vars}\\n"

        with tempfile.NamedTemporaryFile(mode="w", suffix=".ini", delete=False) as f:
            f.write(inv_content)
            local_inv = f.name

        is_playbook = script_path.suffix in {".yml", ".yaml"}
        if is_playbook:
            cmd_parts = ["ansible-playbook", "-i", local_inv, str(script_path)]
            if args:
                cmd_parts.extend(args.split())
        else:
            cmd_parts = ["ansible", "all", "-i", local_inv, "-m", "script",
                         "-a", f"{script_path} {args}".strip()]

        await queue.put(f"[INFO] Running locally: {' '.join(cmd_parts)}\\n")
        await queue.put("-" * 60 + "\\n")

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
        await queue.put("-" * 60 + "\\n")
        await queue.put(f"[INFO] Finished with exit code: {exit_code}\\n")
    except asyncio.CancelledError:
        await queue.put("[INFO] Cancelled by user.\\n")
        raise
    finally:
        if local_inv:
            try: os.unlink(local_inv)
            except Exception: pass
        active_processes.pop(run_id, None)


def _build_connect_kwargs(cfg: dict) -> dict:'''
assert old_build in content, "_build_connect_kwargs not found"
content = content.replace(old_build, cancel_and_local, 1)

# 4. In _execute_script, route kerberos/winrm to local exec at the top
old_execute_start = 'async def _execute_script(run_id, machine, script_path, args, queue,\n                           inventory=None, ephemeral_hosts=None):\n    async def _run_on_conn(conn):'
new_execute_start = '''async def _execute_script(run_id, machine, script_path, args, queue,
                           inventory=None, ephemeral_hosts=None):
    auth = machine.get("auth_method", "key")
    if auth in ("kerberos", "winrm"):
        try:
            await _execute_local(run_id, machine, script_path, args, queue, inventory, ephemeral_hosts)
        except asyncio.CancelledError:
            _update_history_status(run_id, "error")
        except Exception as e:
            await queue.put(f"[ERROR] {type(e).__name__}: {e}\\n")
            _update_history_status(run_id, "error")
        else:
            _update_history_status(run_id, "done")
        finally:
            active_tasks.pop(run_id, None)
            if active_runs.get(run_id) is queue:
                await queue.put(None)
        return

    async def _run_on_conn(conn):'''
assert old_execute_start in content, "_execute_script start not found"
content = content.replace(old_execute_start, new_execute_start, 1)

# 5. Add CancelledError + task cleanup to SSH exception block
old_exc = '    except asyncssh.DisconnectError as e:\n        await queue.put(f"[ERROR] SSH disconnected: {e}\\n")\n        _update_history_status(run_id, "error")\n    except asyncssh.PermissionDenied:\n        await queue.put("[ERROR] SSH permission denied. Check credentials.\\n")\n        _update_history_status(run_id, "error")\n    except Exception as e:\n        await queue.put(f"[ERROR] {type(e).__name__}: {e}\\n")\n        _update_history_status(run_id, "error")\n    else:\n        _update_history_status(run_id, "done")\n    finally:\n        active_tasks.pop(run_id, None)\n        if active_runs.get(run_id) is queue:\n            await queue.put(None)'
# If already patched (first run partially worked), skip
if '    except asyncio.CancelledError:' not in content:
    old_exc_orig = '    except asyncssh.DisconnectError as e:\n        await queue.put(f"[ERROR] SSH disconnected: {e}\\n")\n        _update_history_status(run_id, "error")\n    except asyncssh.PermissionDenied:\n        await queue.put("[ERROR] SSH permission denied. Check credentials.\\n")\n        _update_history_status(run_id, "error")\n    except Exception as e:\n        await queue.put(f"[ERROR] {type(e).__name__}: {e}\\n")\n        _update_history_status(run_id, "error")\n    else:\n        _update_history_status(run_id, "done")\n    finally:\n        await queue.put(None)'
    new_exc = '    except asyncio.CancelledError:\n        _update_history_status(run_id, "error")\n    except asyncssh.DisconnectError as e:\n        await queue.put(f"[ERROR] SSH disconnected: {e}\\n")\n        _update_history_status(run_id, "error")\n    except asyncssh.PermissionDenied:\n        await queue.put("[ERROR] SSH permission denied. Check credentials.\\n")\n        _update_history_status(run_id, "error")\n    except Exception as e:\n        await queue.put(f"[ERROR] {type(e).__name__}: {e}\\n")\n        _update_history_status(run_id, "error")\n    else:\n        _update_history_status(run_id, "done")\n    finally:\n        active_tasks.pop(run_id, None)\n        if active_runs.get(run_id) is queue:\n            await queue.put(None)'
    if old_exc_orig in content:
        content = content.replace(old_exc_orig, new_exc, 1)
        print("exc block patched")
    else:
        print("WARNING: exc block not found, skipping")
else:
    print("exc block already patched")

open('backend/main.py', 'w').write(content)
print("Done: all backend patches applied")
