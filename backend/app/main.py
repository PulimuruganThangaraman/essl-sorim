from __future__ import annotations

import csv
import io
import json
import logging
import os
import sys
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
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
    from .zk_client import DEVICE_TIMEZONE, DeviceLibraryMissing, fetch_device_payload
except ImportError:
    _backend_dir = str(Path(__file__).resolve().parent.parent)
    if _backend_dir not in sys.path:
        sys.path.insert(0, _backend_dir)
    import db
    from config import DeviceConfig, load_devices
    from zk_client import DEVICE_TIMEZONE, DeviceLibraryMissing, fetch_device_payload

app = FastAPI(title="Sorim CRM API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ---------- Pydantic models ----------
class SyncRequest(BaseModel):
    device_ips: list[str] | None = None
    from_time: str | None = None
    to_time: str | None = None

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
        from . import email_report as er
    except ImportError:
        import email_report as er
    return er

def _public_email_config(config: dict) -> dict:
    public = dict(config)
    public["password"] = ""
    public["password_configured"] = bool(config.get("password"))
    return public

# ---------- Auto-Sync ----------
_log = logging.getLogger("autocync")
_auto_sync_state = {"interval": int(os.getenv("AUTO_SYNC_INTERVAL", "60")), "enabled": True}
_auto_sync_lock = threading.Lock()
_auto_sync_thread: threading.Thread | None = None
_auto_sync_stop = threading.Event()

def _get_sync_interval() -> int:
    with _auto_sync_lock: return _auto_sync_state["interval"]
def _is_sync_enabled() -> bool:
    with _auto_sync_lock: return _auto_sync_state["enabled"]
def _set_sync_state(enabled=None, interval=None):
    global _auto_sync_thread
    restart = False
    with _auto_sync_lock:
        if enabled is not None and enabled != _auto_sync_state["enabled"]:
            _auto_sync_state["enabled"] = enabled; restart = True
        if interval is not None and interval != _auto_sync_state["interval"]:
            _auto_sync_state["interval"] = interval; restart = True
    if restart and _auto_sync_thread:
        _auto_sync_stop.set()
        _auto_sync_thread.join(timeout=10)
        _auto_sync_stop.clear()
        _auto_sync_thread = threading.Thread(target=_run_sync, daemon=True)
        _auto_sync_thread.start()

def _run_sync():
    while not _auto_sync_stop.is_set():
        _auto_sync_stop.wait(_get_sync_interval())
        if _auto_sync_stop.is_set() or not _is_sync_enabled(): continue
        try:
            conf = [d for d in _refresh_config() if d.enabled]
            if not conf: continue
            rid = db.start_sync_run(); tot_u = 0; tot_p = 0; fail = 0
            for d in conf:
                try:
                    pl = fetch_device_payload(d)
                    c = db.save_device_payload(d, actual_serial=pl.get("actual_serial"), users=pl["users"], punches=pl["punches"])
                    tot_u += c["users"]; tot_p += c["punches"]
                except DeviceLibraryMissing: fail += 1; break
                except Exception as e: fail += 1; db.record_device_error(d, str(e)[:200])
            db.finish_sync_run(rid, status="ok" if not fail else "partial", message=f"auto: {len(conf)-fail}/{len(conf)}", device_count=len(conf), user_count=tot_u, punch_count=tot_p)
            if tot_p: _log.info("Auto-sync: %d new punches", tot_p)
        except Exception as e: _log.error("Auto-sync error: %s", e)

# ---------- Email Report Scheduler ----------
_report_log = logging.getLogger("email_report")
_report_stop = threading.Event()
_report_thread: threading.Thread | None = None


def _parse_report_time(value: Any) -> int:
    if value is None:
        value = "23:30"
    token = str(value).strip().split(",", 1)[0].strip()
    try:
        hour_text, minute_text = token.split(":", 1)
        hour = int(hour_text)
        minute = int(minute_text)
    except ValueError:
        _report_log.warning("Invalid email report time %r; falling back to 23:30", value)
        return 23 * 60 + 30
    if 0 <= hour <= 23 and 0 <= minute <= 59:
        return hour * 60 + minute
    _report_log.warning("Out-of-range email report time %r; falling back to 23:30", value)
    return 23 * 60 + 30


def _format_report_time(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def _run_report_scheduler():
    _er = _load_email_report_module()
    last_sent_day: str | None = None
    while not _report_stop.is_set():
        n = datetime.now()
        today = n.strftime("%Y-%m-%d")

        cfg = _er.get_config()
        if cfg.get("enabled"):
            now_minutes = n.hour * 60 + n.minute
            target = _parse_report_time(cfg.get("time"))
            if abs(now_minutes - target) <= 1 and last_sent_day != today:
                _report_log.info("Sending daily report for scheduled time %02d:%02d...", target // 60, target % 60)
                _er.send_report(config_override=cfg)
                last_sent_day = today
        _report_stop.wait(30)

# ---------- Startup / Shutdown ----------
def startup():
    db.init_db(); _refresh_config()
    _auto_sync_stop.clear(); global _auto_sync_thread
    _auto_sync_thread = threading.Thread(target=_run_sync, daemon=True); _auto_sync_thread.start()
    _log.info("Auto-sync started (%ds)", _get_sync_interval())
    _report_stop.clear(); global _report_thread
    _report_thread = threading.Thread(target=_run_report_scheduler, daemon=True); _report_thread.start()
    try:
        schedule = _format_report_time(_parse_report_time(_load_email_report_module().get_config().get("time")))
    except Exception:
        schedule = "23:30"
    _report_log.info("Email scheduler started (daily at %s)", schedule)

def shutdown():
    _auto_sync_stop.set(); _report_stop.set()
    if _report_thread: _report_thread.join(timeout=5)

# ---------- API ----------
@app.get("/api/health")
def health(): return {"ok": True, "database": str(db.DB_PATH)}

@app.get("/api/devices")
def devices(): _refresh_config(); return db.list_devices()

@app.get("/api/users")
def users(device_ip: str | None = None): return db.list_users(device_ip=device_ip)

@app.get("/api/punches")
def punches(from_time=None, to_time=None, device_ip=None, user_id=None, direction=None, limit=500):
    return db.list_punches(from_time=_query_time(from_time), to_time=_query_time(to_time), device_ip=device_ip, user_id=user_id, direction=direction, limit=_clamp_limit(limit, default=500, maximum=5000))

@app.get("/api/punches.csv")
def punches_csv(from_time=None, to_time=None, device_ip=None, user_id=None, direction=None, limit=100000):
    rows = db.list_punches(from_time=_query_time(from_time), to_time=_query_time(to_time), device_ip=device_ip, user_id=user_id, direction=direction, limit=_clamp_limit(limit, default=100000, maximum=100000))
    import csv as _csv
    buf = io.StringIO(); w = _csv.DictWriter(buf, fieldnames=["punch_time","direction","user_id","user_name","device_name","device_ip","device_serial","punch_label","punch_code","verify_code"], extrasaction="ignore")
    w.writeheader(); w.writerows(rows); buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="attendance-punches.csv"'})

@app.get("/api/summary")
def summary(from_time=None, to_time=None): return db.get_summary(from_time=_query_time(from_time), to_time=_query_time(to_time))

@app.get("/api/attendance/daily")
def daily_attendance(from_date=None, to_date=None): return db.get_daily_attendance(from_date=from_date, to_date=to_date)

@app.get("/api/auto-sync")
def get_auto_sync(): return {"enabled": _is_sync_enabled(), "interval_seconds": _get_sync_interval()}

@app.post("/api/auto-sync")
def set_auto_sync(payload: dict):
    _set_sync_state(enabled=bool(payload.get("enabled", True)) if payload.get("enabled") is not None else None, interval=int(payload["interval_seconds"]) if "interval_seconds" in payload else None)
    return {"enabled": _is_sync_enabled(), "interval_seconds": _get_sync_interval()}

@app.get("/api/email/config")
def get_email_config():
    try:
        er = _load_email_report_module()
        return _public_email_config(er.get_config())
    except Exception as e:
        raise HTTPException(500, detail=str(e))

@app.post("/api/email/config")
def update_email_config(payload: dict):
    try:
        er = _load_email_report_module()
        updated = er.update_config(**{k: v for k, v in payload.items() if k in er.get_config()})
        return _public_email_config(updated)
    except Exception as e: raise HTTPException(500, detail=str(e))

@app.post("/api/email/test")
def test_email():
    try:
        er = _load_email_report_module()
        cfg = er.get_config()
        if not cfg.get("to_email") or not cfg.get("from_email"): return {"status": "error", "message": "Email not configured"}
        return er.send_report(config_override=cfg, require_enabled=False)
    except Exception as e: raise HTTPException(500, detail=str(e))


@app.post("/api/email/send")
def send_email_for_date(payload: dict):
    try:
        er = _load_email_report_module()
        from datetime import date as _date, datetime as _dt
        date_str = payload.get("date")
        if date_str:
            try: target = _dt.strptime(date_str, "%Y-%m-%d").date()
            except: target = _date.today()
        else:
            target = _date.today()
        cfg = er.get_config()
        if not cfg.get("to_email") or not cfg.get("from_email"):
            return {"status": "error", "message": "Email not configured. Set SMTP to/from in Settings."}
        return er.send_report(target_date=target, config_override=cfg, require_enabled=False)
    except Exception as e: raise HTTPException(500, detail=str(e))

@app.post("/api/users")
def create_user(payload: CreateUserRequest):
    if not payload.user_id.strip(): raise HTTPException(422, "user_id required")
    if not db.get_device(payload.device_id): raise HTTPException(404, "Device not found")
    db.create_user(device_id=payload.device_id, user_id=payload.user_id.strip(), name=payload.name, privilege=payload.privilege, password=payload.password, group_id=payload.group_id, card=payload.card)
    return {"status": "ok", "user_id": payload.user_id.strip(), "device_id": payload.device_id}

@app.put("/api/users/{device_id}/{user_id}")
def edit_user(device_id: str, user_id: str, payload: EditUserRequest):
    if not db.get_device(device_id): raise HTTPException(404, "Device not found")
    db.create_user(device_id=device_id, user_id=user_id, name=payload.name, privilege=payload.privilege, password=payload.password, group_id=payload.group_id, card=payload.card)
    updated = db.update_punch_names(user_id, payload.name)
    return {"status": "ok", "user_id": user_id, "device_id": device_id, "updated_punches": updated}

@app.delete("/api/users/{device_id}/{user_id}")
def delete_user(device_id: str, user_id: str):
    if not db.delete_user(device_id, user_id): raise HTTPException(404, "User not found")
    return {"status": "ok", "device_id": device_id, "user_id": user_id}

@app.post("/api/users/push")
def push_user(payload: PushUserRequest):
    devices = _refresh_config(); device = next((d for d in devices if d.ip == payload.device_ip), None)
    if not device: raise HTTPException(404, "Device not found")
    try:
        fetch_device_payload(device)
        from . import zk_client; zk_client.push_user_to_device(device, payload.user_id, payload.name, payload.privilege, payload.password, payload.card)
        return {"status": "ok", "message": f"User {payload.user_id} pushed to {device.name}"}
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

# Serve built frontend after API routes so /api/* is never shadowed.
_static_dir = os.getenv("STATIC_DIR", str(Path(__file__).resolve().parent.parent / "static"))
if os.path.isdir(_static_dir) and os.listdir(_static_dir):
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="frontend")
    logging.getLogger("static").info("Serving frontend from %s", _static_dir)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
