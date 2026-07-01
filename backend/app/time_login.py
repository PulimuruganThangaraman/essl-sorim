"""
Time Login Module - Auto-scheduled first-IN and last-OUT tracking.

Schedule:
  - 08:00 → Push first IN for users who arrived between 07:40-08:00
  - 10:00 → Push first IN for users who arrived between 08:01-10:00
  - 13:00 → Push first IN for users who arrived between 10:01-13:00
  - 15:00 → Push first IN for users who arrived between 13:01-15:00
  - 17:00 → Push first IN for users who arrived between 15:01-17:00
  - 22:00 → Mark last OUT for the day
  - 23:00 → Final OUT check for remaining users
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Any

try:
    from . import db as database
    from .config import ROOT_DIR
except ImportError:
    import db as database  # type: ignore[no-redef]
    from config import ROOT_DIR  # type: ignore[no-redef]

_log = logging.getLogger("time_login")

# Sync schedule times (HH:MM in 24h format)
SLOT_TIMES = ["08:00", "10:00", "13:00", "15:00", "17:00"]
SLOT_LABELS = {
    "08:00": "Morning 8AM",
    "10:00": "Mid-Morning 10AM",
    "13:00": "Lunch 1PM",
    "15:00": "Afternoon 3PM",
    "17:00": "Evening 5PM",
}
# Slot time ranges (from, to) in minutes relative to slot time
SLOT_RANGES = {
    "08:00": (-20, 0),    # 07:40 to 08:00
    "10:00": (1, 120),    # 08:01 to 10:00
    "13:00": (1, 180),    # 10:01 to 13:00
    "15:00": (1, 120),    # 13:01 to 15:00
    "17:00": (1, 120),    # 15:01 to 17:00
}
OUT_TIMES = ["22:00", "23:00"]

TL_FILE = Path(os.getenv("TIME_LOGIN_FILE", str(ROOT_DIR / "backend" / "data" / "time_login.json")))

# ---------- File-based storage for config and records ----------
_TL_DEFAULTS = {
    "config": {
        "enabled": True,
        "slots": {s: True for s in SLOT_TIMES},
        "out_check_enabled": True,
    },
    "records": {},  # key: "{user_id}|{date}", value: record dict
    "slot_log": [],  # list of sync action logs
}


def _read_data() -> dict[str, Any]:
    try:
        if TL_FILE.exists():
            loaded = json.loads(TL_FILE.read_text(encoding="utf-8"))
            data = {**_TL_DEFAULTS, **loaded}
            if "records" not in data:
                data["records"] = {}
            if "slot_log" not in data:
                data["slot_log"] = []
            return data
    except Exception as exc:
        _log.warning("Failed to read time_login data: %s", exc)
    return json.loads(json.dumps(_TL_DEFAULTS))


def _write_data(data: dict[str, Any]) -> None:
    TL_FILE.parent.mkdir(parents=True, exist_ok=True)
    TL_FILE.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


def get_config() -> dict[str, Any]:
    return _read_data()["config"]


def save_config(payload: dict[str, Any]) -> dict[str, Any]:
    data = _read_data()
    config = data["config"]
    for key in ("enabled", "out_check_enabled"):
        if key in payload:
            config[key] = bool(payload[key])
    if "slots" in payload and isinstance(payload["slots"], dict):
        for slot, enabled in payload["slots"].items():
            if slot in config["slots"]:
                config["slots"][slot] = bool(enabled)
    data["config"] = config
    _write_data(data)
    return config


# ---------- Core Logic ----------
def _today() -> str:
    return date.today().isoformat()


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _parse_slot_time(slot_time: str) -> datetime:
    """Parse slot time like '08:00' into a datetime for today."""
    today = date.today()
    parts = slot_time.split(":")
    return datetime(today.year, today.month, today.day, int(parts[0]), int(parts[1]), 0)


def _get_punches_for_range(from_dt: datetime, to_dt: datetime) -> list[dict[str, Any]]:
    """Get IN punches within a time range from the database."""
    from_str = from_dt.isoformat(timespec="seconds")
    to_str = to_dt.isoformat(timespec="seconds")
    return database.list_punches(
        from_time=from_str,
        to_time=to_str,
        direction="IN",
        sort_order="asc",
        limit=5000,
    )


def _get_punches_for_out_range(from_dt: datetime, to_dt: datetime) -> list[dict[str, Any]]:
    """Get OUT punches within a time range from the database."""
    from_str = from_dt.isoformat(timespec="seconds")
    to_str = to_dt.isoformat(timespec="seconds")
    return database.list_punches(
        from_time=from_str,
        to_time=to_str,
        direction="OUT",
        sort_order="asc",
        limit=5000,
    )


def _get_or_create_record(data: dict[str, Any], user_id: str, user_name: str, rec_date: str) -> dict[str, Any]:
    """Get existing record or create a new one."""
    key = f"{user_id}|{rec_date}"
    if key not in data["records"]:
        data["records"][key] = {
            "user_id": user_id,
            "user_name": user_name or "",
            "date": rec_date,
            "first_in_time": None,
            "first_in_punch_id": None,
            "slot_time": None,
            "slot_label": None,
            "in_status": "pending",
            "in_synced_at": None,
            "last_out_time": None,
            "last_out_punch_id": None,
            "out_status": "pending",
            "out_synced_at": None,
            "created_at": _now(),
            "updated_at": _now(),
        }
    return data["records"][key]


def process_slot(slot_time: str) -> dict[str, Any]:
    """
    Process a time slot: find users who first-punched in the slot range
    and record their first IN if not already recorded.
    """
    slot_dt = _parse_slot_time(slot_time)
    offset_from, offset_to = SLOT_RANGES.get(slot_time, (0, 0))
    range_from = slot_dt + timedelta(minutes=offset_from)
    range_to = slot_dt + timedelta(minutes=offset_to)
    
    label = SLOT_LABELS.get(slot_time, f"Slot {slot_time}")
    today = _today()
    data = _read_data()
    
    punches = _get_punches_for_range(range_from, range_to)
    _log.info("TimeLogin slot %s: %d IN punches in range %s-%s", 
              slot_time, len(punches), range_from.isoformat(), range_to.isoformat())
    
    # Group by user_id, take first IN for each user
    seen_users = {}
    for p in punches:
        uid = p.get("user_id", "")
        if uid and uid not in seen_users:
            seen_users[uid] = p
    
    recorded_count = 0
    already_recorded = 0
    skipped = 0
    
    for uid, punch in seen_users.items():
        rec = _get_or_create_record(data, uid, punch.get("user_name", ""), today)
        
        # If already recorded for this day, skip
        if rec["in_status"] == "recorded":
            already_recorded += 1
            continue
        
        # Record the first IN
        rec["first_in_time"] = punch.get("punch_time")
        rec["first_in_punch_id"] = punch.get("id")
        rec["slot_time"] = slot_time
        rec["slot_label"] = label
        rec["in_status"] = "recorded"
        rec["in_synced_at"] = _now()
        rec["updated_at"] = _now()
        recorded_count += 1
    
    # Log the sync action
    log_entry = {
        "timestamp": _now(),
        "action": "slot_sync",
        "slot_time": slot_time,
        "slot_label": label,
        "range_from": range_from.isoformat(timespec="seconds"),
        "range_to": range_to.isoformat(timespec="seconds"),
        "punches_found": len(punches),
        "users_recorded": recorded_count,
        "already_recorded": already_recorded,
    }
    data["slot_log"].append(log_entry)
    # Keep only last 500 log entries
    if len(data["slot_log"]) > 500:
        data["slot_log"] = data["slot_log"][-500:]
    
    _write_data(data)
    
    return {
        "slot_time": slot_time,
        "slot_label": label,
        "punches_in_range": len(punches),
        "new_records": recorded_count,
        "already_recorded": already_recorded,
        "message": f"Slot {slot_time}: {recorded_count} users recorded, {already_recorded} already synced",
    }


def process_out_check(check_time: str) -> dict[str, Any]:
    """
    Process OUT check: find users who have IN records but no OUT recorded yet.
    Match their last OUT punch for today.
    """
    check_dt = _parse_slot_time(check_time)
    today = _today()
    data = _read_data()
    
    # Get all OUT punches for today up to check time
    day_start = datetime(today.year if isinstance(today, date) else date.today().year, 
                         today.month if isinstance(today, date) else date.today().month,
                         today.day if isinstance(today, date) else date.today().day,
                         0, 0, 0)
    if isinstance(today, str):
        parts = today.split("-")
        day_start = datetime(int(parts[0]), int(parts[1]), int(parts[2]), 0, 0, 0)
    
    out_punches = _get_punches_for_out_range(day_start, check_dt)
    _log.info("TimeLogin OUT check %s: %d OUT punches found", check_time, len(out_punches))
    
    # Group punches by user_id, get last OUT for each
    user_last_out = {}
    for p in out_punches:
        uid = p.get("user_id", "")
        if uid:
            user_last_out[uid] = p  # Since sorted asc, last one wins
    
    updated_count = 0
    pending_count = 0
    
    for key, rec in data["records"].items():
        rec_date = rec.get("date", "")
        if rec_date != today:
            continue
        if rec.get("out_status") == "recorded":
            continue  # Already recorded OUT
        
        uid = rec.get("user_id", "")
        if uid in user_last_out:
            punch = user_last_out[uid]
            rec["last_out_time"] = punch.get("punch_time")
            rec["last_out_punch_id"] = punch.get("id")
            rec["out_status"] = "recorded"
            rec["out_synced_at"] = _now()
            rec["updated_at"] = _now()
            updated_count += 1
        else:
            pending_count += 1
    
    log_entry = {
        "timestamp": _now(),
        "action": "out_check",
        "check_time": check_time,
        "out_punches_found": len(out_punches),
        "out_updated": updated_count,
        "still_pending": pending_count,
    }
    data["slot_log"].append(log_entry)
    if len(data["slot_log"]) > 500:
        data["slot_log"] = data["slot_log"][-500:]
    
    _write_data(data)
    
    return {
        "check_time": check_time,
        "out_punches_found": len(out_punches),
        "out_updated": updated_count,
        "still_pending": pending_count,
        "message": f"OUT check {check_time}: {updated_count} users updated, {pending_count} still pending",
    }


# ---------- Scheduler ----------
_tl_stop = threading.Event()
_tl_thread: threading.Thread | None = None


def _run_time_login_scheduler():
    """Background scheduler that checks every 30 seconds."""
    _log.info("TimeLogin scheduler started")
    last_processed = {}  # key: slot_time or out_time -> last processed date
    
    while not _tl_stop.is_set():
        try:
            now = datetime.now()
            current_time_str = now.strftime("%H:%M")
            today_str = now.strftime("%Y-%m-%d")
            config = get_config()
            
            if not config.get("enabled", True):
                _tl_stop.wait(30)
                continue
            
            # Check IN slots
            enabled_slots = config.get("slots", {})
            for slot_time in SLOT_TIMES:
                if not enabled_slots.get(slot_time, True):
                    continue
                last_key = f"in_{slot_time}"
                last_date = last_processed.get(last_key)
                if last_date != today_str and current_time_str >= slot_time:
                    # Check if we're within 2 minutes of the slot time
                    slot_dt = _parse_slot_time(slot_time)
                    diff_minutes = (now - slot_dt).total_seconds() / 60
                    if 0 <= diff_minutes < 2:
                        _log.info("TimeLogin: Processing IN slot %s", slot_time)
                        try:
                            result = process_slot(slot_time)
                            _log.info("TimeLogin slot %s result: %s", slot_time, result.get("message"))
                        except Exception as e:
                            _log.error("TimeLogin slot %s error: %s", slot_time, e)
                        last_processed[last_key] = today_str
            
            # Check OUT times
            if config.get("out_check_enabled", True):
                for out_time in OUT_TIMES:
                    last_key = f"out_{out_time}"
                    last_date = last_processed.get(last_key)
                    if last_date != today_str and current_time_str >= out_time:
                        out_dt = _parse_slot_time(out_time)
                        diff_minutes = (now - out_dt).total_seconds() / 60
                        if 0 <= diff_minutes < 5:
                            _log.info("TimeLogin: Processing OUT check %s", out_time)
                            try:
                                result = process_out_check(out_time)
                                _log.info("TimeLogin OUT %s result: %s", out_time, result.get("message"))
                            except Exception as e:
                                _log.error("TimeLogin OUT %s error: %s", out_time, e)
                            last_processed[last_key] = today_str
            
        except Exception as e:
            _log.error("TimeLogin scheduler error: %s", e)
        
        _tl_stop.wait(30)


def start_scheduler():
    global _tl_thread
    if _tl_thread and _tl_thread.is_alive():
        return
    _tl_stop.clear()
    _tl_thread = threading.Thread(target=_run_time_login_scheduler, daemon=True)
    _tl_thread.start()
    _log.info("TimeLogin scheduler thread started")


def stop_scheduler():
    _tl_stop.set()
    if _tl_thread:
        _tl_thread.join(timeout=5)


# ---------- Query APIs ----------
def get_records(date_str: str | None = None, user_id: str | None = None) -> list[dict[str, Any]]:
    """Get time login records, optionally filtered by date and/or user."""
    data = _read_data()
    records = list(data["records"].values())
    
    if date_str:
        records = [r for r in records if r.get("date") == date_str]
    if user_id:
        records = [r for r in records if r.get("user_id") == user_id]
    
    # Sort by date desc, then user_name
    records.sort(key=lambda r: (r.get("date", ""), r.get("user_name", "")), reverse=False)
    return records


def get_slot_summary(date_str: str | None = None) -> list[dict[str, Any]]:
    """
    Get summary of users per time slot.
    Returns list of slot objects with lists of users.
    """
    target_date = date_str or _today()
    records = get_records(target_date)
    
    slots = []
    for slot_time in SLOT_TIMES:
        label = SLOT_LABELS.get(slot_time, f"Slot {slot_time}")
        slot_users = [r for r in records if r.get("slot_time") == slot_time and r.get("in_status") == "recorded"]
        slots.append({
            "slot_time": slot_time,
            "slot_label": label,
            "total_users": len(slot_users),
            "users": sorted(slot_users, key=lambda r: r.get("first_in_time", "")),
        })
    
    # Users who haven't been recorded in any slot (pending)
    recorded_user_ids = {r.get("user_id") for r in records if r.get("in_status") == "recorded"}
    pending_users = [r for r in records if r.get("user_id") not in recorded_user_ids]
    
    # Users with no IN recorded
    missing_users = []
    if not records:
        # Check database for today's IN punches not yet processed
        today_start = datetime.strptime(target_date + " 00:00:00", "%Y-%m-%d %H:%M:%S")
        today_end = datetime.strptime(target_date + " 23:59:59", "%Y-%m-%d %H:%M:%S")
        all_today_punches = database.list_punches(
            from_time=today_start.isoformat(),
            to_time=today_end.isoformat(),
            direction="IN",
            sort_order="asc",
            limit=5000,
        )
        seen = set()
        for p in all_today_punches:
            uid = p.get("user_id", "")
            if uid not in seen:
                seen.add(uid)
                if uid not in recorded_user_ids:
                    missing_users.append({
                        "user_id": uid,
                        "user_name": p.get("user_name", ""),
                        "punch_time": p.get("punch_time", ""),
                    })
    
    return {
        "date": target_date,
        "slots": slots,
        "pending_out": [r for r in records if r.get("in_status") == "recorded" and r.get("out_status") != "recorded"],
        "pending_in": missing_users[:50] if missing_users else [],
    }


def get_stats() -> dict[str, Any]:
    """Get overall stats."""
    data = _read_data()
    records = data.get("records", {})
    config = data.get("config", {})
    
    today_str = _today()
    today_records = [r for r in records.values() if r.get("date") == today_str]
    
    return {
        "config": config,
        "total_records": len(records),
        "today_records": len(today_records),
        "today_recorded_in": len([r for r in today_records if r.get("in_status") == "recorded"]),
        "today_pending_out": len([r for r in today_records if r.get("in_status") == "recorded" and r.get("out_status") != "recorded"]),
        "today_recorded_out": len([r for r in today_records if r.get("out_status") == "recorded"]),
        "recent_logs": data.get("slot_log", [])[-20:],
    }