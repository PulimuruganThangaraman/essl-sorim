from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    from .config import DeviceConfig
except ImportError:
    from config import DeviceConfig  # type: ignore[no-redef]


try:
    DEVICE_TIMEZONE = ZoneInfo("Asia/Kolkata")
except ZoneInfoNotFoundError:
    DEVICE_TIMEZONE = timezone(timedelta(hours=5, minutes=30), name="Asia/Kolkata")


class DeviceLibraryMissing(RuntimeError):
    pass


def _load_zk_class():
    try:
        from zk import ZK
    except ImportError as exc:
        raise DeviceLibraryMissing(
            "The pyzk package is not installed. Run `pip install -r backend/requirements.txt`."
        ) from exc
    return ZK


def _value(source: Any, name: str, default: Any = None) -> Any:
    value = getattr(source, name, default)
    if callable(value):
        return value()
    return value


def _clean(value: Any) -> Any:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore").strip()
    if isinstance(value, str):
        return value.strip()
    return value


def _local_iso(timestamp: datetime) -> str:
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=DEVICE_TIMEZONE)
    return timestamp.astimezone(DEVICE_TIMEZONE).isoformat(timespec="seconds")


def punch_label(code: int | None) -> str:
    labels = {
        0: "Check In",
        1: "Check Out",
        2: "Break Out",
        3: "Break In",
        4: "Overtime In",
        5: "Overtime Out",
        255: "Unknown",
    }
    return labels.get(code, "Unknown")


def punch_direction(code: int | None, fallback: str) -> str:
    directions = {
        0: "IN",
        1: "OUT",
        2: "OUT",
        3: "IN",
        4: "IN",
        5: "OUT",
    }
    return directions.get(code, fallback.upper())


def normalize_user(user: Any) -> dict[str, Any]:
    return {
        "uid": _clean(_value(user, "uid")),
        "user_id": str(_clean(_value(user, "user_id", ""))),
        "name": _clean(_value(user, "name", "")),
        "privilege": _clean(_value(user, "privilege")),
        "password": _clean(_value(user, "password")),
        "group_id": _clean(_value(user, "group_id")),
        "card": _clean(_value(user, "card")),
    }


def normalize_punch(record: Any, device: DeviceConfig) -> dict[str, Any]:
    code = _clean(_value(record, "punch"))
    try:
        punch_code = int(code) if code is not None else None
    except (TypeError, ValueError):
        punch_code = None

    status = _clean(_value(record, "status"))
    try:
        verify_code = int(status) if status is not None else None
    except (TypeError, ValueError):
        verify_code = None

    return {
        "uid": _clean(_value(record, "uid")),
        "user_id": str(_clean(_value(record, "user_id", ""))),
        "punch_time": _local_iso(_value(record, "timestamp")),
        "punch_code": punch_code,
        "punch_label": punch_label(punch_code),
        "direction": punch_direction(punch_code, device.default_direction),
        "verify_code": verify_code,
        "raw_status": str(status) if status is not None else None,
    }


def push_user_to_device(device: DeviceConfig, user_id: str, name: str = "", privilege: int = 0, password: str = "", card: str = "") -> dict[str, Any]:
    """Create or update a user on the physical biometric device."""
    ZK = _load_zk_class()
    zk = ZK(
        device.ip,
        port=device.port,
        timeout=device.timeout_seconds,
        password=device.password,
        force_udp=False,
        ommit_ping=False,
    )
    conn = None
    try:
        conn = zk.connect()
        try:
            conn.disable_device()
        except Exception:
            pass

        # Find the existing UID for this user_id (if any) by scanning device users
        existing_uid = None
        try:
            for u in conn.get_users():
                try:
                    if str(_clean(_value(u, "user_id", ""))) == str(user_id):
                        existing_uid = int(_clean(_value(u, "uid"))) if _clean(_value(u, "uid")) is not None else None
                        break
                except Exception:
                    continue
        except Exception:
            existing_uid = None

        if existing_uid is not None:
            # User already exists on device - update the name and other fields
            conn.set_user(
                uid=existing_uid,
                user_id=user_id,
                name=name,
                privilege=privilege,
                password=password,
                group_id="",
                card=card,
            )
            return {"status": "ok", "message": f"User {user_id} updated on {device.name} (uid={existing_uid})"}
        else:
            # New user - use uid=0 to auto-assign
            conn.set_user(
                uid=0,
                user_id=user_id,
                name=name,
                privilege=privilege,
                password=password,
                group_id="",
                card=card,
            )
            return {"status": "ok", "message": f"User {user_id} created on {device.name}"}
    finally:
        if conn is not None:
            try:
                conn.enable_device()
            except Exception:
                pass
            try:
                conn.disconnect()
            except Exception:
                pass


def delete_user_from_device(device: DeviceConfig, user_id: str) -> dict[str, Any]:
    """Delete a user from the physical biometric device."""
    ZK = _load_zk_class()
    zk = ZK(
        device.ip,
        port=device.port,
        timeout=device.timeout_seconds,
        password=device.password,
        force_udp=False,
        ommit_ping=False,
    )
    conn = None
    try:
        conn = zk.connect()
        try:
            conn.disable_device()
        except Exception:
            pass
        conn.delete_user(user_id)
        return {"status": "ok", "message": f"User {user_id} deleted from {device.name}"}
    finally:
        if conn is not None:
            try:
                conn.enable_device()
            except Exception:
                pass
            try:
                conn.disconnect()
            except Exception:
                pass


def fetch_device_payload(device: DeviceConfig) -> dict[str, Any]:
    ZK = _load_zk_class()
    zk = ZK(
        device.ip,
        port=device.port,
        timeout=device.timeout_seconds,
        password=device.password,
        force_udp=False,
        ommit_ping=False,
    )
    conn = None

    try:
        conn = zk.connect()
        try:
            conn.disable_device()
        except Exception:
            pass

        actual_serial = None
        for method_name in ("get_serialnumber", "get_serial_number"):
            method = getattr(conn, method_name, None)
            if method:
                try:
                    actual_serial = _clean(method())
                    break
                except Exception:
                    actual_serial = None

        users = [normalize_user(user) for user in conn.get_users()]
        punches = [normalize_punch(record, device) for record in conn.get_attendance()]
        return {
            "actual_serial": actual_serial,
            "users": users,
            "punches": punches,
        }
    finally:
        if conn is not None:
            try:
                conn.enable_device()
            except Exception:
                pass
            try:
                conn.disconnect()
            except Exception:
                pass
