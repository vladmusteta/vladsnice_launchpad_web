import re

content = open('backend/main.py').read()

# Fix 1: update start_run to create history entry
# Find the create_task line and the return after it
pattern = r'(    asyncio\.create_task\(_execute_script\([^)]+\)\))\n    return \{"run_id": run_id\}'
replacement = r'''    import datetime as dt
    history = _load_history()
    history.append({
        "id": run_id, "script": req.script, "machine_name": machine.get("name","?"),
        "machine_id": req.machine_id, "args": req.args,
        "timestamp": dt.datetime.now().isoformat(timespec="seconds"),
        "status": "running",
    })
    _save_history(history)
\1
    return {"run_id": run_id}'''
new_content, n = re.subn(pattern, replacement, content)
assert n == 1, f"start_run pattern matched {n} times"
content = new_content

# Fix 2: update exception handlers
old_exc = (
    '    except asyncssh.DisconnectError as e:\n'
    '        await queue.put(f"[ERROR] SSH disconnected: {e}\\n")\n'
    '    except asyncssh.PermissionDenied:\n'
    '        await queue.put("[ERROR] SSH permission denied. Check credentials.\\n")\n'
    '    except Exception as e:\n'
    '        await queue.put(f"[ERROR] {type(e).__name__}: {e}\\n")\n'
    '    finally:\n'
    '        await queue.put(None)'
)
new_exc = (
    '    except asyncssh.DisconnectError as e:\n'
    '        await queue.put(f"[ERROR] SSH disconnected: {e}\\n")\n'
    '        _update_history_status(run_id, "error")\n'
    '    except asyncssh.PermissionDenied:\n'
    '        await queue.put("[ERROR] SSH permission denied. Check credentials.\\n")\n'
    '        _update_history_status(run_id, "error")\n'
    '    except Exception as e:\n'
    '        await queue.put(f"[ERROR] {type(e).__name__}: {e}\\n")\n'
    '        _update_history_status(run_id, "error")\n'
    '    else:\n'
    '        _update_history_status(run_id, "done")\n'
    '    finally:\n'
    '        await queue.put(None)'
)
assert old_exc in content, f"exception handlers not found. snippet: {repr(content[content.find('except asyncssh'):content.find('except asyncssh')+200])}"
content = content.replace(old_exc, new_exc, 1)

# Fix 3: add _update_history_status helper before @app.delete("/api/history"...)
old_del = '@app.delete("/api/history", status_code=204)'
new_del = (
    'def _update_history_status(run_id: str, status: str):\n'
    '    try:\n'
    '        h = _load_history()\n'
    '        for entry in h:\n'
    '            if entry.get("id") == run_id:\n'
    '                entry["status"] = status\n'
    '                break\n'
    '        _save_history(h)\n'
    '    except Exception:\n'
    '        pass\n'
    '\n'
    '@app.delete("/api/history", status_code=204)'
)
assert old_del in content, "@app.delete /api/history not found"
content = content.replace(old_del, new_del, 1)

open('backend/main.py', 'w').write(content)
print("Done: history status tracking added")
