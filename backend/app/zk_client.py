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


def clear_biometric_from_device(device: DeviceConfig, user_id: str) -> dict[str, Any]:
    """Clear biometric templates for a specific user from the device."""
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
        try:
            users = list(conn.get_users())
            target_uid = None
            for u in users:
                if str(_clean(_value(u, "user_id", ""))) == str(user_id):
                    target_uid = int(_clean(_value(u, "uid"))) if _clean(_value(u, "uid")) is not None else None
                    break
            if target_uid is not None:
                method = getattr(conn, "clear_templates", None) or getattr(conn, "clear_fp", None)
                if method:
                    method(uid=target_uid)
                    return {"status": "ok", "message": f"Biometric templates cleared for user {user_id} on {device.name}"}
                else:
                    return {"status": "error", "message": "clear_templates method not supported on this device"}
            else:
                return {"status": "error", "message": f"User {user_id} not found on device"}
        except Exception as e:
            return {"status": "error", "message": str(e)}
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


def restart_device(device: DeviceConfig) -> dict[str, Any]:
    """Restart the biometric device."""
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
        try:
            method = getattr(conn, "restart", None)
            if method:
                method()
                return {"status": "ok", "message": f"Device {device.name} is restarting..."}
            else:
                return {"status": "error", "message": "Restart not supported on this device"}
        except Exception as e:
            return {"status": "error", "message": str(e)}
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


def enable_device(device: DeviceConfig) -> dict[str, Any]:
    """Enable the biometric device."""
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
            conn.enable_device()
            return {"status": "ok", "message": f"Device {device.name} enabled"}
        except Exception as e:
            return {"status": "error", "message": str(e)}
    finally:
        if conn is not None:
            try:
                conn.disconnect()
            except Exception:
                pass


def disable_device(device: DeviceConfig) -> dict[str, Any]:
    """Disable the biometric device."""
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
            return {"status": "ok", "message": f"Device {device.name} disabled"}
        except Exception as e:
            return {"status": "error", "message": str(e)}
    finally:
        if conn is not None:
            try:
                conn.disconnect()
            except Exception:
                pass


def get_device_settings(device: DeviceConfig) -> dict[str, Any]:
    """Fetch device settings and parameters."""
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
        settings = {}
        try:
            if hasattr(conn, "get_parameters"):
                params = conn.get_parameters()
                settings["parameters"] = {str(k): str(v) for k, v in params.items()} if isinstance(params, dict) else str(params)
        except Exception:
            settings["parameters"] = "N/A"
        try:
            if hasattr(conn, "get_device_info"):
                info = conn.get_device_info()
                settings["device_info"] = {str(k): str(v) for k, v in info.items()} if isinstance(info, dict) else str(info)
        except Exception:
            settings["device_info"] = "N/A"
        try:
            if hasattr(conn, "get_oem"):
                settings["oem"] = _clean(conn.get_oem())
        except Exception:
            settings["oem"] = "N/A"
        try:
            if hasattr(conn, "get_version"):
                settings["version"] = _clean(conn.get_version())
        except Exception:
            settings["version"] = "N/A"
        try:
            if hasattr(conn, "get_platform"):
                settings["platform"] = _clean(conn.get_platform())
        except Exception:
            settings["platform"] = "N/A"
        try:
            if hasattr(conn, "get_serialnumber"):
                settings["serial"] = _clean(conn.get_serialnumber())
        except Exception:
            settings["serial"] = "N/A"
        try:
            if hasattr(conn, "get_lock_state"):
                settings["lock_state"] = _clean(conn.get_lock_state())
        except Exception:
            pass
        try:
            if hasattr(conn, "get_attendance_state"):
                settings["attendance_state"] = _clean(conn.get_attendance_state())
        except Exception:
            pass
        return {"status": "ok", "settings": settings}
    except Exception as e:
        return {"status": "error", "message": str(e)}
    finally:
        if conn is not None:
            try:
                conn.disconnect()
            except Exception:
                pass


def set_device_parameter(device: DeviceConfig, parameter: str, value: str) -> dict[str, Any]:
    """Set a device parameter."""
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
        try:
            if hasattr(conn, "set_parameter"):
                conn.set_parameter(parameter, value)
                return {"status": "ok", "message": f"Parameter {parameter} set to {value}"}
            else:
                return {"status": "error", "message": "set_parameter not supported on this device"}
        except Exception as e:
            return {"status": "error", "message": str(e)}
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


_FINGER_NAMES = {
    0: "Left Thumb",
    1: "Left Index",
    2: "Left Middle",
    3: "Left Ring",
    4: "Left Little",
    5: "Right Thumb",
    6: "Right Index",
    7: "Right Middle",
    8: "Right Ring",
    9: "Right Little",
}

def _finger_name(index: Any) -> str:
    try:
        return _FINGER_NAMES.get(int(index), f"Finger {index}")
    except (TypeError, ValueError):
        return f"Finger {index}"


def get_device_biometric_templates(device: DeviceConfig) -> dict[str, Any]:
    """Fetch biometric templates for all users from the device.
    Returns a dict mapping user_id to a list of templates (by finger/fp index).
    """
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
    template_counts: dict[str, int] = {}
    template_details: dict[str, list[dict[str, Any]]] = {}
    user_names: dict[str, str] = {}
    try:
        conn = zk.connect()
        users_by_uid: dict[int, str] = {}
        try:
            for u in conn.get_users():
                uid_val = _clean(_value(u, "uid"))
                user_id_val = str(_clean(_value(u, "user_id", "")))
                name_val = _clean(_value(u, "name", "")) or user_id_val
                if uid_val is not None:
                    users_by_uid[int(uid_val)] = user_id_val
                if user_id_val:
                    user_names[user_id_val] = name_val
        except Exception:
            users_by_uid = {}

        try:
            method = getattr(conn, "get_templates", None)
            if method is None:
                method = getattr(conn, "get_fp_template", None)
            if method is None:
                method = getattr(conn, "get_templates", None)
            raw_templates = method() if method else []
        except Exception:
            raw_templates = []

        for tpl in raw_templates:
            try:
                tpl_uid = _clean(_value(tpl, "uid"))
                tpl_fid = _clean(_value(tpl, "fid"))
                tpl_valid = _clean(_value(tpl, "valid"))
                user_id = users_by_uid.get(int(tpl_uid), str(tpl_uid))
                detail = {
                    "uid": tpl_uid,
                    "finger_index": tpl_fid,
                    "finger_name": _finger_name(tpl_fid),
                    "valid": tpl_valid,
                }
                template_counts[user_id] = template_counts.get(user_id, 0) + 1
                template_details.setdefault(user_id, []).append(detail)
            except Exception:
                continue
        return {
            "template_counts": template_counts,
            "template_details": template_details,
            "user_names": user_names,
            "total_templates": sum(template_counts.values()),
            "users_with_biometrics": len(template_counts),
        }
    finally:
        if conn is not None:
            try:
                conn.disconnect()
            except Exception:
                pass


def get_all_device_details(device: DeviceConfig) -> dict[str, Any]:
    """Fetch comprehensive details from the biometric device.
    Returns users, punches, device info, and biometric templates.
    """
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
    template_counts: dict[str, int] = {}
    template_details: dict[str, list[dict[str, Any]]] = {}
    user_names: dict[str, str] = {}
    try:
        conn = zk.connect()
        actual_serial = None
        for method_name in ("get_serialnumber", "get_serial_number"):
            method = getattr(conn, method_name, None)
            if method:
                try:
                    actual_serial = _clean(method())
                    break
                except Exception:
                    actual_serial = None
        try:
            device_info_raw = conn.get_device_info() if hasattr(conn, "get_device_info") else {}
        except Exception:
            device_info_raw = {}
        try:
            platform_raw = conn.get_platform() if hasattr(conn, "get_platform") else None
        except Exception:
            platform_raw = None
        try:
            version_raw = conn.get_version() if hasattr(conn, "get_version") else None
        except Exception:
            version_raw = None
        try:
            oem_raw = conn.get_oem() if hasattr(conn, "get_oem") else None
        except Exception:
            oem_raw = None
        users_by_uid: dict[int, str] = {}
        users_list = []
        try:
            for u in conn.get_users():
                uid_val = _clean(_value(u, "uid"))
                user_id_val = str(_clean(_value(u, "user_id", "")))
                name_val = _clean(_value(u, "name", "")) or user_id_val
                privilege_val = _clean(_value(u, "privilege"))
                group_id_val = _clean(_value(u, "group_id"))
                card_val = _clean(_value(u, "card"))
                password_val = _clean(_value(u, "password"))
                users_list.append({
                    "uid": uid_val,
                    "user_id": user_id_val,
                    "name": name_val,
                    "privilege": privilege_val,
                    "password": password_val,
                    "group_id": group_id_val,
                    "card": card_val,
                })
                if uid_val is not None:
                    users_by_uid[int(uid_val)] = user_id_val
                if user_id_val:
                    user_names[user_id_val] = name_val
        except Exception:
            users_list = []
            users_by_uid = {}
        try:
            punches_list = []
            for record in conn.get_attendance():
                punch_code = None
                raw_punch = _clean(_value(record, "punch"))
                try:
                    punch_code = int(raw_punch) if raw_punch is not None else None
                except (TypeError, ValueError):
                    punch_code = None
                punches_list.append({
                    "uid": _clean(_value(record, "uid")),
                    "user_id": str(_clean(_value(record, "user_id", ""))),
                    "timestamp": _local_iso(_value(record, "timestamp")),
                    "punch_code": punch_code,
                    "punch_label": punch_label(punch_code),
                    "direction": punch_direction(punch_code, device.default_direction),
                    "verify_code": _clean(_value(record, "status")),
                })
        except Exception:
            punches_list = []
        try:
            method = getattr(conn, "get_templates", None) or getattr(conn, "get_fp_template", None)
            raw_templates = method() if method else []
            for tpl in raw_templates:
                tpl_uid = _clean(_value(tpl, "uid"))
                tpl_fid = _clean(_value(tpl, "fid"))
                tpl_valid = _clean(_value(tpl, "valid"))
                user_id = users_by_uid.get(int(tpl_uid), str(tpl_uid))
                template_counts[user_id] = template_counts.get(user_id, 0) + 1
                template_details.setdefault(user_id, []).append({
                    "uid": tpl_uid,
                    "finger_index": tpl_fid,
                    "finger_name": _finger_name(tpl_fid),
                    "valid": tpl_valid,
                })
        except Exception:
            pass
        try:
            workcode_list = []
            for wc in conn.get_work_code() if hasattr(conn, "get_work_code") else []:
                workcode_list.append({
                    "id": _clean(_value(wc, "id")),
                    "name": _clean(_value(wc, "name")),
                })
        except Exception:
            workcode_list = []
        return {
            "device_info": {
                "actual_serial": actual_serial,
                "platform": platform_raw,
                "version": version_raw,
                "oem": oem_raw,
                "raw": device_info_raw,
            },
            "users": users_list,
            "user_names": user_names,
            "punches": punches_list,
            "biometric_templates": {
                "template_counts": template_counts,
                "template_details": template_details,
                "total_templates": sum(template_counts.values()),
                "users_with_biometrics": len(template_counts),
            },
            "work_codes": workcode_list,
        }
    finally:
        if conn is not None:
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
