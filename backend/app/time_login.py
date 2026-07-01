"""
Time Login Module - Auto-scheduled first-IN and last-OUT tracking.
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

# Default slot times (HH:MM) - can be edited via UI
DEFAULT_SLOT_TIMES = ["08:00", "10:00", "13:00", "15:00", "17:00"]
DEFAULT_SLOT_LABELS = {}
# Default slot ranges in minutes relative to slot_time: (from_offset, to_offset)
DEFAULT_SLOT_RANGES = {
    "08:00": (-20, 0),
    "10:00": (1, 120),
    "13:00": (1, 180),
    "15:00": (1, 120),
    "17:00": (1, 120),
}
DEFAULT_OUT_TIMES = ["22:00", "23:00"]

TL_FILE = Path(os.getenv("TIME_LOGIN_FILE", str(ROOT_DIR / "backend" / "data" / "time_login.json")))

_TL_DEFAULTS = {
    "config": {
        "enabled": True,
        "slots": {t: True for t in DEFAULT_SLOT_TIMES},
        "slot_times": list(DEFAULT_SLOT_TIMES),
        "out_check_enabled": True,
        "out_times": list(DEFAULT_OUT_TIMES),
        "slot_labels": dict(DEFAULT_SLOT_LABELS),
        "slot_ranges": {k: list(v) for k, v in DEFAULT_SLOT_RANGES.items()},
        "zoho_sync_enabled": False,
    },
    "records": {},
    "slot_log": [],
}


def _read_data() -> dict[str, Any]:
    try:
        if TL_FILE.exists():
            loaded = json.loads(TL_FILE.read_text(encoding="utf-8"))
            data = {**_TL_DEFAULTS, **loaded}
            data.setdefault("config", {}).setdefault("slots", {t: True for t in DEFAULT_SLOT_TIMES})
            data.setdefault("records", {})
            data.setdefault("slot_log", [])
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

    for key in ("enabled", "out_check_enabled", "zoho_sync_enabled"):
        if key in payload:
            config[key] = bool(payload[key])

    if "slots" in payload and isinstance(payload["slots"], dict):
        for slot, enabled in payload["slots"].items():
            if slot in config.get("slots", {}):
                config["slots"][slot] = bool(enabled)

    if "slot_times" in payload and isinstance(payload["slot_times"], list):
        config["slot_times"] = [str(t) for t in payload["slot_times"] if str(t).count(":") == 1]

    if "out_times" in payload and isinstance(payload["out_times"], list):
        config["out_times"] = [str(t) for t in payload["out_times"] if str(t).count(":") == 1]

    if "slot_labels" in payload and isinstance(payload["slot_labels"], dict):
        for k, v in payload["slot_labels"].items():
            config.setdefault("slot_labels", {})[k] = str(v)

    if "slot_ranges" in payload and isinstance(payload["slot_ranges"], dict):
        config["slot_ranges"] = {
            k: [int(v[0]), int(v[1])]
            for k, v in payload["slot_ranges"].items()
            if isinstance(v, list) and len(v) == 2
        }

    # Remove slot entries no longer in slot_times
    if "slot_times" in payload:
        for k in list(config.get("slots", {}).keys()):
            if k not in config["slot_times"]:
                config["slots"].pop(k, None)
                config.get("slot_labels", {}).pop(k, None)
                config.get("slot_ranges", {}).pop(k, None)

    data["config"] = config
    _write_data(data)
    return config


# ---------- Core Logic ----------
def _today() -> str:
    return date.today().isoformat()


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _parse_slot_time(slot_time: str) -> datetime:
    today = date.today()
    parts = slot_time.split(":")
    return datetime(today.year, today.month, today.day, int(parts[0]), int(parts[1]), 0)


def _get_punches_for_range(from_dt: datetime, to_dt: datetime, direction: str = "IN") -> list[dict[str, Any]]:
    from_str = from_dt.isoformat(timespec="seconds")
    to_str = to_dt.isoformat(timespec="seconds")
    return database.list_punches(
        from_time=from_str,
        to_time=to_str,
        direction=direction,
        sort_order="asc",
        limit=5000,
    )


def _get_or_create_record(data: dict[str, Any], user_id: str, user_name: str, rec_date: str) -> dict[str, Any]:
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
    data = _read_data()
    config = data.get("config", {})
    slot_ranges = config.get("slot_ranges", {})
    slot_dt = _parse_slot_time(slot_time)
    offset_from, offset_to = slot_ranges.get(slot_time, DEFAULT_SLOT_RANGES.get(slot_time, (0, 0)))
    range_from = slot_dt + timedelta(minutes=offset_from)
    range_to = slot_dt + timedelta(minutes=offset_to)

    label = config.get("slot_labels", {}).get(slot_time, DEFAULT_SLOT_LABELS.get(slot_time, f"Slot {slot_time}"))
    today = _today()

    punches = _get_punches_for_range(range_from, range_to, "IN")
    _log.info("TimeLogin slot %s: %d IN punches in range %s-%s",
              slot_time, len(punches), range_from.isoformat(), range_to.isoformat())

    seen_users = {}
    for p in punches:
        uid = p.get("user_id", "")
        if uid and uid not in seen_users:
            seen_users[uid] = p

    recorded_count = 0
    already_recorded = 0

    for uid, punch in seen_users.items():
        rec = _get_or_create_record(data, uid, punch.get("user_name", ""), today)
        if rec["in_status"] == "recorded":
            already_recorded += 1
            continue

        rec["first_in_time"] = punch.get("punch_time")
        rec["first_in_punch_id"] = punch.get("id")
        rec["slot_time"] = slot_time
        rec["slot_label"] = label
        rec["in_status"] = "recorded"
        rec["in_synced_at"] = _now()
        rec["updated_at"] = _now()
        recorded_count += 1

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
    check_dt = _parse_slot_time(check_time)
    today = _today()
    data = _read_data()

    parts = today.split("-")
    day_start = datetime(int(parts[0]), int(parts[1]), int(parts[2]), 0, 0, 0)

    out_punches = _get_punches_for_range(day_start, check_dt, "OUT")
    _log.info("TimeLogin OUT check %s: %d OUT punches found", check_time, len(out_punches))

    user_last_out = {}
    for p in out_punches:
        uid = p.get("user_id", "")
        if uid:
            user_last_out[uid] = p

    updated_count = 0
    pending_count = 0

    for key, rec in data["records"].items():
        rec_date = rec.get("date", "")
        if rec_date != today or rec.get("out_status") == "recorded":
            continue

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
    _log.info("TimeLogin scheduler started")
    last_processed = {}

    while not _tl_stop.is_set():
        try:
            now = datetime.now()
            current_time_str = now.strftime("%H:%M")
            today_str = now.strftime("%Y-%m-%d")
            config = get_config()

            if not config.get("enabled", True):
                _tl_stop.wait(30)
                continue

            enabled_slots = config.get("slots", {})
            active_slot_times = config.get("slot_times", DEFAULT_SLOT_TIMES)
            for slot_time in active_slot_times:
                if not enabled_slots.get(slot_time, True):
                    continue
                last_key = f"in_{slot_time}"
                last_date = last_processed.get(last_key)
                if last_date != today_str and current_time_str >= slot_time:
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

            if config.get("out_check_enabled", True):
                active_out_times = config.get("out_times", DEFAULT_OUT_TIMES)
                for out_time in active_out_times:
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


def get_records(date_str: str | None = None, user_id: str | None = None) -> list[dict[str, Any]]:
    data = _read_data()
    records = list(data["records"].values())

    if date_str:
        records = [r for r in records if r.get("date") == date_str]
    if user_id:
        records = [r for r in records if r.get("user_id") == user_id]

    records.sort(key=lambda r: (r.get("date", ""), r.get("user_name", "")), reverse=False)
    return records


def get_slot_summary(date_str: str | None = None) -> dict[str, Any]:
    target_date = date_str or _today()
    records = get_records(target_date)

    slots = []
    for slot_time in DEFAULT_SLOT_TIMES:
        label = DEFAULT_SLOT_LABELS.get(slot_time, f"Slot {slot_time}")
        slot_users = [r for r in records if r.get("slot_time") == slot_time and r.get("in_status") == "recorded"]
        slots.append({
            "slot_time": slot_time,
            "slot_label": label,
            "total_users": len(slot_users),
            "users": sorted(slot_users, key=lambda r: r.get("first_in_time", "")),
        })

    return {
        "date": target_date,
        "slots": slots,
        "pending_out": [r for r in records if r.get("in_status") == "recorded" and r.get("out_status") != "recorded"],
        "pending_in": [],
    }


def get_stats() -> dict[str, Any]:
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


def update_record_time(record_id: str, field: str, value: str) -> dict[str, Any]:
    data = _read_data()
    key = record_id
    if key not in data["records"]:
        raise ValueError("Record not found")

    rec = data["records"][key]
    if field in ("first_in_time", "last_out_time"):
        rec[field] = value
        rec["updated_at"] = _now()
        _write_data(data)
        return rec

    raise ValueError("Invalid field")


def delete_record(record_id: str) -> None:
    data = _read_data()
    if record_id in data["records"]:
        del data["records"][record_id]
        _write_data(data)


def sync_to_zoho(record_ids: list[str] | None = None) -> dict[str, Any]:
    try:
        zp = None
        try:
            from . import zoho_people as zp
        except ImportError:
            import zoho_people as zp  # type: ignore[no-redef]

        if not zp.is_configured(zp.get_config()):
            return {"status": "error", "message": "Zoho not configured"}

        data = _read_data()
        records = list(data["records"].values())

        if record_ids:
            records = [r for r in records if f"{r['user_id']}|{r['date']}" in record_ids]

        synced = 0
        skipped = 0
        for rec in records:
            if rec.get("in_status") != "recorded" or rec.get("out_status") != "recorded":
                skipped += 1
                continue

            punch_time_in = rec.get("first_in_time", "")
            punch_time_out = rec.get("last_out_time", "")
            if not punch_time_in or not punch_time_out:
                skipped += 1
                continue

            try:
                result = zp.send_single_punch(
                    user_id=rec["user_id"],
                    user_name=rec.get("user_name", ""),
                    first_in=punch_time_in,
                    last_out=punch_time_out,
                )
                if result.get("status") == "ok":
                    synced += 1
                else:
                    skipped += 1
            except Exception:
                skipped += 1

        return {"status": "ok", "synced": synced, "skipped": skipped, "message": f"Sent {synced}, skipped {skipped}"}

    except ImportError:
        return {"status": "error", "message": "Zoho integration not available"}
    except Exception as e:
        return {"status": "error", "message": str(e)[:200]}