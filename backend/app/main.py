"""
Sorim CRM API - Main FastAPI application.
Auto-syncs biometric devices, serves API endpoints, and optionally serves the SPA frontend.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import os
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from pydantic import BaseModel, Field


@asynccontextmanager
async def lifespan(app: FastAPI):
    startup()
    try:
        yield
    finally:
        shutdown()


try:
    from . import db
    from .config import DeviceConfig, load_devices
    from .zk_client import DEVICE_TIMEZONE, DeviceLibraryMissing, fetch_device_payload, get_device_biometric_templates, get_all_device_details, clear_biometric_from_device, restart_device, enable_device, disable_device, get_device_settings, set_device_parameter
    from . import time_login as tl
except ImportError:
    _backend_dir = str(Path(__file__).resolve().parent.parent)
    if _backend_dir not in sys.path:
        sys.path.insert(0, _backend_dir)
    import db
    from config import DeviceConfig, load_devices
    from zk_client import DEVICE_TIMEZONE, DeviceLibraryMissing, fetch_device_payload, get_device_biometric_templates, get_all_device_details, clear_biometric_from_device, restart_device, enable_device, disable_device, get_device_settings, set_device_parameter
    import time_login as tl

app = FastAPI(title="Sorim CRM API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ---------- Pydantic models ----------
class SyncRequest(BaseModel):
    device_ips: list[str] | None = None
    from_time: str | None = None
    to_time: str | None = None

class ZohoSyncRequest(BaseModel):
    from_time: str | None = None
    to_time: str | None = None
    user_ids: list[str] | None = None
    limit: int = Field(default=200, ge=1, le=1000)
    dry_run: bool = False

class CreateUserRequest(BaseModel):
    device_id: str; user_id: str; name: str = ""; privilege: int = 0; password: str = ""; group_id: str = ""; card: str = ""

class EditUserRequest(BaseModel):
    name: str = ""; privilege: int = 0; password: str = ""; group_id: str = ""; card: str = ""

class PushUserRequest(BaseModel):
    device_ip: str; user_id: str; name: str = ""; privilege: int = 0; password: str = ""; card: str = ""

# ---------- Helpers ----------
def _parse_time(value: str | None) -> datetime | None:
    if not value: return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None: parsed = parsed.replace(tzinfo=DEVICE_TIMEZONE)
        return parsed
    except: return None

def _query_time(value: str | None) -> str | None:
    p = _parse_time(value)
    return p.astimezone(DEVICE_TIMEZONE).isoformat(timespec="seconds") if p else None

def _clamp_limit(value: Any, default: int = 500, maximum: int = 5000) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(1, min(parsed, maximum))

def _payload_bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}

def _sync_interval(value: Any) -> int:
    try:
        interval = int(value)
    except (TypeError, ValueError):
        raise HTTPException(422, "interval_seconds must be a number")
    if interval < 15:
        raise HTTPException(422, "interval_seconds must be at least 15 seconds")
    return min(interval, 24 * 60 * 60)

def _time_in_range(punch_time: str, from_time: datetime | None, to_time: datetime | None) -> bool:
    try:
        d = datetime.fromisoformat(punch_time)
        if from_time and d < from_time: return False
        if to_time and d > to_time: return False
        return True
    except: return True

def _refresh_config() -> list[DeviceConfig]:
    devices = load_devices()
    db.upsert_config_devices(devices)
    return devices

def _load_email_report_module():
    try:
        from . import email_report
    except ImportError:
        import email_report
    return email_report

_HR_FILE = Path(__file__).resolve().parent.parent / "data" / "hr_records.json"
_HR_LIST_COLLECTIONS = {"leave_requests", "assets", "documents", "performance"}
_HR_DEFAULTS = {
    "leave_requests": [],
    "assets": [],
    "documents": [],
    "performance": [],
    "profiles": {},
}

# ---------- Scheduler ----------
_sync_thread: threading.Thread | None = None
_sync_stop = threading.Event()

def _is_sync_enabled() -> bool:
    return not _sync_stop.is_set()

def _get_sync_interval() -> int:
    return _scheduler_interval

_scheduler_interval = 60

def _set_scheduler_interval(interval: int) -> None:
    global _scheduler_interval
    _scheduler_interval = max(15, min(interval, 86400))

def _sync_loop():
    while not _sync_stop.is_set():
        try:
            devices = [d for d in _refresh_config() if d.enabled]
            for device in devices:
                try:
                    pl = fetch_device_payload(device)
                    db.save_device_payload(device, actual_serial=pl.get("actual_serial"), users=pl["users"], punches=pl["punches"])
                except DeviceLibraryMissing:
                    pass
                except Exception as e:
                    db.record_device_error(device, str(e))
        except Exception:
            pass
        _sync_stop.wait(_scheduler_interval)

def _enable_sync(interval: int = 60) -> None:
    global _sync_thread
    _set_scheduler_interval(interval)
    if _sync_thread and _sync_thread.is_alive():
        return
    _sync_stop.clear()
    _sync_thread = threading.Thread(target=_sync_loop, daemon=True)
    _sync_thread.start()

def _disable_sync() -> None:
    _sync_stop.set()
    global _sync_thread
    if _sync_thread:
        _sync_thread.join(timeout=5)
        _sync_thread = None

# ---------- Email report scheduler ----------
_report_stop = threading.Event()
_report_thread: threading.Thread | None = None

def _run_report_scheduler():
    while not _report_stop.is_set():
        try:
            now = datetime.now().strftime("%H:%M")
            email_report = _load_email_report_module()
            config = email_report.get_config()
            if config.get("enabled") and config.get("time"):
                target_time = config["time"]
                if now == target_time:
                    try:
                        email_report.send_report()
                    except Exception as e:
                        logging.getLogger("email_report").error("Scheduled report error: %s", e)
        except Exception:
            pass
        _report_stop.wait(30)

def _start_email_report_scheduler():
    global _report_thread
    if _report_thread and _report_thread.is_alive():
        return
    _report_stop.clear()
    _report_thread = threading.Thread(target=_run_report_scheduler, daemon=True)
    _report_thread.start()

# ---------- Startup / Shutdown ----------
def startup():
    db.init_db()
    _enable_sync(interval=60)
    _start_email_report_scheduler()
    tl.start_scheduler()
    # Start Zoho sync scheduler
    try:
        from . import zoho_people
    except ImportError:
        import zoho_people
    if zoho_people.is_configured():
        zoho_people.start_zoho_auto_sync_scheduler()
        logging.getLogger("startup").info("Zoho People auto-sync scheduler started")
    else:
        logging.getLogger("startup").info("Zoho People not configured; auto-sync disabled")
    logging.getLogger("startup").info("Sorim CRM API started")

def shutdown():
    _disable_sync()
    _report_stop.set()
    tl.stop_scheduler()
    try:
        from . import zoho_people
    except ImportError:
        import zoho_people
    zoho_people.stop_zoho_auto_sync_scheduler()
    logging.getLogger("shutdown").info("Sorim CRM API stopped")

# ---------- API ----------
@app.get("/api/health")
def health(): return {"ok": True, "database": str(db.DB_PATH)}

@app.get("/api/devices")
def devices(): _refresh_config(); return db.list_devices()

@app.get("/api/users")
def users(device_ip: str | None = None): return db.list_users(device_ip=device_ip)

@app.get("/api/punches")
def punches(from_time=None, to_time=None, device_ip=None, user_id=None, direction=None, sort_order="desc", limit=500):
    limit = _clamp_limit(limit)
    return db.list_punches(from_time=from_time, to_time=to_time, device_ip=device_ip, user_id=user_id, direction=direction, sort_order=sort_order, limit=limit)

@app.get("/api/punches.csv")
def punches_csv(from_time=None, to_time=None, device_ip=None, user_id=None, direction=None, sort_order="desc", limit=100000):
    limit = _clamp_limit(limit, maximum=100000)
    rows = db.list_punches(from_time=from_time, to_time=to_time, device_ip=device_ip, user_id=user_id, direction=direction, sort_order=sort_order, limit=limit)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["ID", "Device Name", "IP", "User ID", "User Name", "Punch Time", "Direction"])
    for row in rows:
        w.writerow([row["id"], row["device_name"], row["device_ip"], row["user_id"], row["user_name"], row["punch_time"], row["direction"]])
    return StreamingResponse(iter([out.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=punches_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"})

@app.get("/api/report/detailed")
def get_report(from_date=None, to_date=None, user_id=None, user_ids=None, summary="false", csv="false"):
    ulist = json.loads(user_ids) if user_ids else ([user_id] if user_id else None)
    rows = db.get_detailed_report(from_date=from_date, to_date=to_date, user_ids=ulist)
    if summary.lower() == "true":
        result = {}
        for r in rows:
            k = (r["user_id"], r["device_ip"])
            existing = result.get(k)
            if existing:
                existing["punches"] += 1
                existing["first_in"] = min(existing["first_in"], r["punch_time"])
                existing["last_out"] = max(existing["last_out"], r["punch_time"])
            else:
                result[k] = {"user_id": r["user_id"], "user_name": r["user_name"], "device_name": r["device_name"], "device_ip": r["device_ip"], "first_in": r["punch_time"], "last_out": r["punch_time"], "punches": 1}
        rows = list(result.values())
    if csv.lower() == "true":
        out = io.StringIO()
        w = csv.writer(out)
        if summary.lower() == "true":
            w.writerow(["User ID", "User Name", "Device", "Device IP", "First IN", "Last OUT", "Total Punches"])
            for r in rows: w.writerow([r["user_id"], r["user_name"], r["device_name"], r["device_ip"], r["first_in"], r["last_out"], r["punches"]])
        else:
            w.writerow(["User ID", "User Name", "Device", "Device IP", "Punch Time", "Direction"])
            for r in rows: w.writerow([r["user_id"], r["user_name"], r["device_name"], r["device_ip"], r["punch_time"], r["direction"]])
        return StreamingResponse(iter([out.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"})
    return rows

@app.get("/api/summary")
def summary(from_time=None, to_time=None, device_ip=None, user_id=None, direction=None):
    return db.get_summary(from_time=from_time, to_time=to_time, device_ip=device_ip, user_id=user_id, direction=direction)

@app.get("/api/attendance/daily")
def daily_attendance(from_date=None, to_date=None): return db.get_daily_attendance(from_date=from_date, to_date=to_date)

@app.get("/api/auto-sync")
def get_auto_sync(): return {"enabled": _is_sync_enabled(), "interval_seconds": _get_sync_interval()}

@app.post("/api/auto-sync")
def set_auto_sync(payload: dict):
    enabled = _payload_bool(payload.get("enabled"))
    if enabled and not _is_sync_enabled():
        _enable_sync(_sync_interval(payload.get("interval_seconds", _scheduler_interval)))
    elif not enabled:
        _disable_sync()
    else:
        _set_scheduler_interval(_sync_interval(payload.get("interval_seconds", _scheduler_interval)))
    return {"enabled": _is_sync_enabled(), "interval_seconds": _get_sync_interval()}

@app.get("/api/email/config")
def get_email_config():
    email_report = _load_email_report_module()
    return email_report.get_config()

@app.post("/api/email/config")
def update_email_config(payload: dict):
    email_report = _load_email_report_module()
    return email_report.update_config(**payload)

@app.post("/api/email/test")
def test_email():
    email_report = _load_email_report_module()
    result = email_report.send_test()
    return result

@app.post("/api/email/send")
def send_email_for_date(payload: dict):
    email_report = _load_email_report_module()
    date_str = payload.get("date")
    if not date_str:
        date_str = datetime.now().strftime("%Y-%m-%d")
    result = email_report.send_report(date_str=date_str)
    return result

@app.get("/api/zoho/config")
def get_zoho_config():
    try:
        from . import zoho_people
    except ImportError:
        import zoho_people
    return zoho_people.public_config()

@app.post("/api/zoho/config")
def update_zoho_config(payload: dict):
    try:
        from . import zoho_people
    except ImportError:
        import zoho_people
    return zoho_people.save_config(payload)

@app.get("/api/zoho/status")
def get_zoho_status():
    try:
        from . import zoho_people
    except ImportError:
        import zoho_people
    config = zoho_people.get_config()
    return {
        "configured": zoho_people.is_configured(config),
        "enabled": config.get("enabled", False),
        "auto_push": config.get("auto_push", False),
        "last_sync": None,
        "next_sync": None,
        "mapped_users_count": len(zoho_people.active_mapped_user_ids(config)),
    }

@app.post("/api/zoho/test")
def test_zoho_connection():
    try:
        from . import zoho_people
    except ImportError:
        import zoho_people
    try:
        result = zoho_people.validate_attendance_scope()
        return {"status": "ok", "message": "Zoho connection successful", "detail": result}
    except zoho_people.ZohoAPIError as e:
        raise HTTPException(status_code=e.status_code or 502, detail=f"Zoho returned: {e}")
    except Exception as e:
        raise HTTPException(502, detail=f"Connection failed: {e}")

@app.get("/api/zoho/employees/verify")
def verify_zoho_employees():
    try:
        from . import zoho_people
    except ImportError:
        import zoho_people
    users = db.list_users()
    config = zoho_people.get_config()
    try:
        result = zoho_people.verify_local_employee_mappings(users, config)
        return result
    except zoho_people.ZohoAPIError as e:
        status_code = e.status_code or 502
        detail = str(e)
        if e.body:
            detail += f"\n\nResponse from Zoho:\n{e.body[:2000]}"
        raise HTTPException(status_code=status_code, detail=detail)

@app.post("/api/zoho/sync")
def sync_zoho_people(payload: ZohoSyncRequest):
    try:
        from . import zoho_people
    except ImportError:
        import zoho_people
    try:
        result = zoho_people.sync_pending_punches(
            from_time=payload.from_time,
            to_time=payload.to_time,
            user_ids=payload.user_ids,
            limit=payload.limit,
            dry_run=payload.dry_run,
        )
        return result
    except zoho_people.ZohoConfigError as e:
        raise HTTPException(400, detail=str(e))
    except zoho_people.ZohoAPIError as e:
        status_code = e.status_code or 502
        detail = str(e)
        if e.body:
            detail += f"\n\nZoho response:\n{e.body[:2000]}"
        raise HTTPException(status_code=status_code, detail=detail)

@app.get("/api/hr")
def get_hr_records():
    return {"collections": list(_HR_LIST_COLLECTIONS), "defaults": _HR_DEFAULTS}

@app.get("/api/hr/profiles")
def get_hr_profiles():
    """Return employee profiles stored in hr_records.json."""
    try:
        raw = json.loads(_HR_FILE.read_text(encoding="utf-8"))
        return {"profiles": list(raw.get("profiles", {}).values())}
    except (FileNotFoundError, json.JSONDecodeError):
        return {"profiles": []}

@app.get("/api/hr/{collection}")
def list_hr_records(collection: str):
    if collection not in _HR_LIST_COLLECTIONS:
        raise HTTPException(404, f"Collection '{collection}' not found. Valid: {sorted(_HR_LIST_COLLECTIONS)}")
    try:
        raw = json.loads(_HR_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return []
    return raw.get(collection, [])

@app.post("/api/hr/{collection}")
def create_hr_record(collection: str, payload: dict):
    if collection not in _HR_LIST_COLLECTIONS:
        raise HTTPException(404, f"Collection '{collection}' not found. Valid: {sorted(_HR_LIST_COLLECTIONS)}")
    try:
        raw = json.loads(_HR_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        raw = {k: [] for k in _HR_LIST_COLLECTIONS}
    raw.setdefault(collection, [])
    record = {
        "id": str(uuid.uuid4()),
        "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        **payload,
    }
    raw[collection].append(record)
    _HR_FILE.parent.mkdir(parents=True, exist_ok=True)
    _HR_FILE.write_text(json.dumps(raw, indent=2, default=str), encoding="utf-8")
    return record

@app.post("/api/users")
def create_user(payload: CreateUserRequest):
    devices = _refresh_config()
    target = None
    if payload.device_id:
        target = next((d for d in devices if d.id == payload.device_id), None)
    else:
        target = next((d for d in devices if d.ip == payload.device_id), None)
    if not target:
        raise HTTPException(404, f"Device '{payload.device_id}' not found")
    try:
        from . import zk_client
        user_data = {"user_id": payload.user_id, "name": payload.name, "privilege": payload.privilege, "password": payload.password, "group_id": payload.group_id, "card": payload.card}
        result = zk_client.create_user_on_device(target, user_data)
        db.upsert_users([{"user_id": payload.user_id, "name": payload.name, "device_ip": target.ip, "device_name": target.name}])
        return result
    except DeviceLibraryMissing:
        raise HTTPException(503, "pyzk not installed")
    except Exception as e:
        raise HTTPException(500, detail=str(e))

@app.post("/api/users/push")
def push_user(payload: PushUserRequest):
    devices = _refresh_config()
    device = next((d for d in devices if d.ip == payload.device_ip), None)
    if not device:
        raise HTTPException(404, f"Device '{payload.device_ip}' not found")
    try:
        from . import zk_client
        result = zk_client.push_user_to_device(device, payload.user_id, payload.name, payload.privilege, payload.password, payload.card)
        db.upsert_users([{"user_id": payload.user_id, "name": payload.name, "device_ip": device.ip, "device_name": device.name}])
        return result
    except DeviceLibraryMissing:
        raise HTTPException(503, "pyzk not installed")
    except Exception as e:
        raise HTTPException(500, detail=str(e))

@app.get("/api/device-details")
def get_device_details(device_ip: str = None):
    devices = _refresh_config()
    if device_ip:
        devices = [d for d in devices if d.ip == device_ip]
    try:
        return get_all_device_details(devices)
    except DeviceLibraryMissing:
        raise HTTPException(503, "pyzk not installed")
    except Exception as e:
        raise HTTPException(500, detail=str(e))

@app.get("/api/biometric-templates")
def get_biometric_templates(device_ip: str = None):
    devices = _refresh_config()
    if device_ip:
        devices = [d for d in devices if d.ip == device_ip]
    try:
        return get_device_biometric_templates(devices)
    except DeviceLibraryMissing:
        raise HTTPException(503, "pyzk not installed")
    except Exception as e:
        raise HTTPException(500, detail=str(e))

@app.post("/api/devices/{device_ip}/clear-biometric")
def clear_biometric(device_ip: str, payload: dict):
    devices = _refresh_config(); device = next((d for d in devices if d.ip == device_ip), None)
    if not device: raise HTTPException(404, "Device not found")
    user_id = payload.get("user_id")
    if not user_id: raise HTTPException(422, "user_id required")
    try:
        result = clear_biometric_from_device(device, user_id)
        return result
    except DeviceLibraryMissing: raise HTTPException(503, "pyzk not installed")
    except Exception as e: raise HTTPException(500, detail=str(e))

@app.post("/api/devices/{device_ip}/restart")
def restart_device_endpoint(device_ip: str):
    devices = _refresh_config(); device = next((d for d in devices if d.ip == device_ip), None)
    if not device: raise HTTPException(404, "Device not found")
    try:
        result = restart_device(device)
        return result
    except DeviceLibraryMissing: raise HTTPException(503, "pyzk not installed")
    except Exception as e: raise HTTPException(500, detail=str(e))

@app.post("/api/devices/{device_ip}/enable")
def enable_device_endpoint(device_ip: str):
    devices = _refresh_config(); device = next((d for d in devices if d.ip == device_ip), None)
    if not device: raise HTTPException(404, "Device not found")
    try:
        result = enable_device(device)
        return result
    except DeviceLibraryMissing: raise HTTPException(503, "pyzk not installed")
    except Exception as e: raise HTTPException(500, detail=str(e))

@app.post("/api/devices/{device_ip}/users")
def create_device_user(device_ip: str, payload: dict):
    devices = _refresh_config(); device = next((d for d in devices if d.ip == device_ip), None)
    if not device: raise HTTPException(404, "Device not found")
    user_id = payload.get("user_id")
    name = payload.get("name", "")
    privilege = int(payload.get("privilege", 0))
    password = payload.get("password", "")
    card = payload.get("card", "")
    if not user_id: raise HTTPException(422, "user_id required")
    try:
        from . import zk_client
        result = zk_client.push_user_to_device(device, user_id, name, privilege, password, card)
        return result
    except DeviceLibraryMissing: raise HTTPException(503, "pyzk not installed")
    except Exception as e: raise HTTPException(500, detail=str(e))

@app.put("/api/devices/{device_ip}/users/{user_id}")
def update_device_user(device_ip: str, user_id: str, payload: dict):
    devices = _refresh_config(); device = next((d for d in devices if d.ip == device_ip), None)
    if not device: raise HTTPException(404, "Device not found")
    name = payload.get("name", "")
    privilege = int(payload.get("privilege", 0))
    password = payload.get("password", "")
    card = payload.get("card", "")
    try:
        from . import zk_client
        result = zk_client.push_user_to_device(device, user_id, name, privilege, password, card)
        return result
    except DeviceLibraryMissing: raise HTTPException(503, "pyzk not installed")
    except Exception as e: raise HTTPException(500, detail=str(e))

@app.delete("/api/devices/{device_ip}/users/{user_id}")
def delete_device_user(device_ip: str, user_id: str):
    devices = _refresh_config(); device = next((d for d in devices if d.ip == device_ip), None)
    if not device: raise HTTPException(404, "Device not found")
    try:
        from . import zk_client
        result = zk_client.delete_user_from_device(device, user_id)
        return result
    except DeviceLibraryMissing: raise HTTPException(503, "pyzk not installed")
    except Exception as e: raise HTTPException(500, detail=str(e))

@app.post("/api/devices/{device_ip}/disable")
def disable_device_endpoint(device_ip: str):
    devices = _refresh_config(); device = next((d for d in devices if d.ip == device_ip), None)
    if not device: raise HTTPException(404, "Device not found")
    try:
        result = disable_device(device)
        return result
    except DeviceLibraryMissing: raise HTTPException(503, "pyzk not installed")
    except Exception as e: raise HTTPException(500, detail=str(e))

@app.get("/api/devices/{device_ip}/settings")
def get_device_settings_endpoint(device_ip: str):
    devices = _refresh_config(); device = next((d for d in devices if d.ip == device_ip), None)
    if not device: raise HTTPException(404, "Device not found")
    try:
        return get_device_settings(device)
    except DeviceLibraryMissing: raise HTTPException(503, "pyzk not installed")
    except Exception as e: raise HTTPException(500, detail=str(e))

@app.post("/api/devices/{device_ip}/settings")
def set_device_settings_endpoint(device_ip: str, payload: dict):
    devices = _refresh_config(); device = next((d for d in devices if d.ip == device_ip), None)
    if not device: raise HTTPException(404, "Device not found")
    parameter = payload.get("parameter")
    value = payload.get("value")
    if not parameter or value is None: raise HTTPException(422, "parameter and value required")
    try:
        return set_device_parameter(device, parameter, str(value))
    except DeviceLibraryMissing: raise HTTPException(503, "pyzk not installed")
    except Exception as e: raise HTTPException(500, detail=str(e))

@app.post("/api/sync")
def sync_attendance(payload: SyncRequest):
    configured = [d for d in _refresh_config() if d.enabled]
    if payload.device_ips: configured = [d for d in configured if d.ip in set(payload.device_ips)]
    if not configured: raise HTTPException(404, "No matching devices")
    ft = _parse_time(payload.from_time); tt = _parse_time(payload.to_time)
    rid = db.start_sync_run(); results = []; tu = 0; tp = 0; fail = 0
    for device in configured:
        try:
            pl = fetch_device_payload(device); punches = pl["punches"]
            if ft or tt: punches = [p for p in punches if _time_in_range(p["punch_time"], ft, tt)]
            c = db.save_device_payload(device, actual_serial=pl.get("actual_serial"), users=pl["users"], punches=punches)
            tu += c["users"]; tp += c["punches"]
            results.append({"device": device.name, "ip": device.ip, "status": "ok", "users": c["users"], "new_punches": c["punches"], "fetched_punches": len(punches)})
        except DeviceLibraryMissing:
            raise HTTPException(503, "pyzk not installed")
        except Exception as e:
            fail += 1; msg = str(e) or e.__class__.__name__; db.record_device_error(device, msg)
            results.append({"device": device.name, "ip": device.ip, "status": "error", "error": msg})
    db.finish_sync_run(rid, status="partial" if fail else "ok", message=f"{len(configured)-fail}/{len(configured)} synced", device_count=len(configured), user_count=tu, punch_count=tp)
    return {"run_id": rid, "status": "partial" if fail else "ok", "devices": results, "users_synced": tu, "new_punches": tp}

# ---------- Stub endpoints (frontend Dashboard compatibility) ----------
@app.get("/api/alerts/active/counts")
def stub_alerts_active_counts():
    return {"count": 0, "warnings": 0, "errors": 0}

@app.get("/api/alerts/active")
def stub_alerts_active(limit: int = 20):
    return []

@app.get("/api/activities/upcoming/counts")
def stub_activities_upcoming_counts():
    return {"count": 0}

@app.get("/api/activities/upcoming")
def stub_activities_upcoming(limit: int = 20):
    return []

@app.get("/api/production-dashboard/summary")
def stub_production_summary():
    return {"total_tasks": 0, "completed": 0, "pending": 0}

# ---------- WebSocket endpoint for frontend live stream ----------
@app.websocket("/api/stream")
async def api_stream(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await websocket.receive_text()
            await websocket.send_json({"status": "ok", "message": "connected"})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass

# ---------- Time Login API ----------
_query_time_iso = _query_time

@app.get("/api/time-login/config")
def get_time_login_config():
    return tl.get_config()

@app.post("/api/time-login/config")
def set_time_login_config(payload: dict):
    return tl.save_config(payload)

@app.get("/api/time-login/records")
def get_time_login_records(date: str | None = None, user_id: str | None = None):
    return tl.get_records(date_str=date, user_id=user_id)

@app.get("/api/time-login/stats")
def get_time_login_stats():
    return tl.get_stats()

@app.get("/api/time-login/summary")
def get_time_login_summary(date: str | None = None):
    return tl.get_slot_summary(date_str=date)

@app.post("/api/time-login/slot/{slot_time}")
def trigger_time_login_slot(slot_time: str):
    """Manually trigger processing of a time slot."""
    config = tl.get_config()
    active_slot_times = config.get("slot_times", tl.DEFAULT_SLOT_TIMES)
    if slot_time not in active_slot_times:
        raise HTTPException(400, f"Invalid slot time. Valid: {active_slot_times}")
    return tl.process_slot(slot_time)

@app.post("/api/time-login/out-check/{check_time}")
def trigger_time_login_out(check_time: str):
    """Manually trigger an OUT check."""
    if check_time not in tl.OUT_TIMES:
        raise HTTPException(400, f"Invalid check time. Valid: {tl.OUT_TIMES}")
    return tl.process_out_check(check_time)

@app.post("/api/time-login/records/{record_id}/update-time")
def update_time_login_record_time(record_id: str, payload: dict):
    field = payload.get("field")
    value = payload.get("value")
    if field not in ("first_in_time", "last_out_time"):
        raise HTTPException(422, "field must be first_in_time or last_out_time")
    try:
        rec = tl.update_record_time(record_id, field, value)
        return {"status": "ok", "record": rec}
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, detail=str(e))

@app.delete("/api/time-login/records/{record_id}")
def delete_time_login_record(record_id: str):
    try:
        tl.delete_record(record_id)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(500, detail=str(e))

@app.post("/api/time-login/sync-zoho")
def sync_time_login_to_zoho(payload: dict):
    record_ids = payload.get("record_ids")
    try:
        result = tl.sync_to_zoho(record_ids=record_ids)
        return result
    except Exception as e:
        raise HTTPException(500, detail=str(e))

# ---------- SafeStaticFiles: rejects WebSocket so it does not crash ----------
class SafeStaticFiles(StaticFiles):
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            response = Response(status_code=426, content="WebSocket not supported")
            await response(scope, receive, send)
            return
        await super().__call__(scope, receive, send)

# Serve built frontend after API routes so /api/* is never shadowed.
_static_dir = os.getenv("STATIC_DIR", str(Path(__file__).resolve().parent.parent / "static"))
if os.path.isdir(_static_dir) and os.listdir(_static_dir):
    app.mount("/", SafeStaticFiles(directory=_static_dir, html=True), name="frontend")
    logging.getLogger("static").info("Serving frontend from %s", _static_dir)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)