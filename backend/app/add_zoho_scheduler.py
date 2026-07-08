import os

path = 'backend/app/zoho_people.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

if 'def start_zoho_auto_sync_scheduler' in content:
    print('scheduler already present')
    raise SystemExit

if 'import threading' not in content:
    content = content.replace('import json\nimport os\nimport time', 'import json\nimport os\nimport threading\nimport time')

scheduler = '''

# ---------- Zoho auto-sync scheduler ----------
_zoho_sync_thread = None
_zoho_sync_stop = None

def _zoho_auto_sync_loop(interval_seconds: int):
    while not _zoho_sync_stop.is_set():
        try:
            config = get_config()
            if config.get("enabled") and config.get("auto_push") and is_configured(config):
                sync_pending_punches(limit=config.get("batch_size", 100))
        except Exception:
            pass
        _zoho_sync_stop.wait(interval_seconds)

def start_zoho_auto_sync_scheduler(interval_seconds: int = 300):
    global _zoho_sync_thread, _zoho_sync_stop
    if _zoho_sync_thread is not None and _zoho_sync_thread.is_alive():
        return
    _zoho_sync_stop = threading.Event()
    _zoho_sync_stop.clear()
    _zoho_sync_thread = threading.Thread(target=_zoho_auto_sync_loop, args=(interval_seconds,), daemon=True)
    _zoho_sync_thread.start()

def stop_zoho_auto_sync_scheduler():
    global _zoho_sync_thread, _zoho_sync_stop
    if _zoho_sync_stop is not None:
        _zoho_sync_stop.set()
    if _zoho_sync_thread is not None:
        _zoho_sync_thread.join(timeout=5)
        _zoho_sync_thread = None
        _zoho_sync_stop = None
'''

content = content.rstrip() + '\n' + scheduler

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

import ast
ast.parse(content)
print('OK - scheduler added')