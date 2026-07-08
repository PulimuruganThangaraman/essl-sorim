"""
Zoho People integration module.
Handles OAuth2 authentication, employee lookup, attendance sync,
and now: fetching existing Zoho attendance entries for the 'earliest IN / latest OUT' merge logic.
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib import error, parse, request

try:
    from . import db
    from .config import ROOT_DIR
except ImportError:
    import db  # type: ignore[no-redef]
    from config import ROOT_DIR  # type: ignore[no-redef]


CONFIG_FILE = Path(os.getenv("ZOHO_PEOPLE_CONFIG_FILE", str(ROOT_DIR / "backend" / "data" / "zoho_people_config.json")))
REQUIRED_ATTENDANCE_SCOPE = "ZOHOPEOPLE.attendance.ALL"
REQUIRED_EMPLOYEE_READ_SCOPE = "ZOHOPEOPLE.forms.READ"

DATA_CENTERS = {
    "us": {"accounts_url": "https://accounts.zoho.com", "people_url": "https://people.zoho.com"},
    "in": {"accounts_url": "https://accounts.zoho.in", "people_url": "https://people.zoho.in"},
    "eu": {"accounts_url": "https://accounts.zoho.eu", "people_url": "https://people.zoho.eu"},
    "au": {"accounts_url": "https://accounts.zoho.com.au", "people_url": "https://people.zoho.com.au"},
    "jp": {"accounts_url": "https://accounts.zoho.jp", "people_url": "https://people.zoho.jp"},
    "cn": {"accounts_url": "https://accounts.zoho.com.cn", "people_url": "https://people.zoho.com.cn"},
}

DEFAULT_CONFIG: dict[str, Any] = {
    "enabled": False,
    "auto_push": False,
    "data_center": "in",
    "accounts_url": DATA_CENTERS["in"]["accounts_url"],
    "people_url": DATA_CENTERS["in"]["people_url"],
    "client_id": "",
    "client_secret": "",
    "refresh_token": "",
    "access_token": "",
    "access_token_expires_at": 0,
    "default_location": "",
    "default_building": "",
    "min_punch_date": "2020-01-01",
    "use_biometric_user_id_as_emp_id": False,
    "send_only_mapped_users": True,
    "employee_verified_at": "",
    "employee_verify_matched_count": 0,
    "employee_verify_missing_count": 0,
    "employee_verify_unmapped_count": 0,
    "batch_size": 100,
    "mappings": {},
}

SECRET_KEYS = {"client_id", "client_secret", "refresh_token", "access_token"}
PUBLIC_SECRET_KEYS = {
    "client_id": "client_id_configured",
    "client_secret": "client_secret_configured",
    "refresh_token": "refresh_token_configured",
    "access_token": "access_token_configured",
}

_TOKEN_CACHE: dict[str, Any] = {"access_token": "", "expires_at": 0.0}


class ZohoConfigError(RuntimeError):
    pass


class ZohoAPIError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, body: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


def _to_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _to_int(value: Any, default: int, *, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(parsed, maximum))


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _expiry_timestamp(value: Any) -> float:
    if value in (None, ""):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value))
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return 0.0


def _parse_date(value: Any, fallback: str = "2020-01-01") -> date:
    try:
        return date.fromisoformat(str(value or fallback)[:10])
    except (TypeError, ValueError):
        return date.fromisoformat(fallback)


def _domain_defaults(data_center: str) -> dict[str, str]:
    return DATA_CENTERS.get(str(data_center or "").lower(), DATA_CENTERS["in"])


def _normalize_mapping(user_id: str, raw: dict[str, Any]) -> dict[str, Any]:
    biometric_user_id = _clean_text(raw.get("biometric_user_id") or user_id)
    zoho_employee_id = _clean_text(raw.get("zoho_employee_id") or raw.get("empId") or raw.get("emp_id"))
    active = _to_bool(raw.get("active"), bool(zoho_employee_id))
    return {
        "biometric_user_id": biometric_user_id,
        "zoho_employee_id": zoho_employee_id,
        "active": active,
        "name": _clean_text(raw.get("name")),
        "notes": _clean_text(raw.get("notes")),
    }


def _normalize_mappings(raw: Any) -> dict[str, dict[str, Any]]:
    mappings: dict[str, dict[str, Any]] = {}
    if isinstance(raw, list):
        iterable = ((_clean_text(item.get("biometric_user_id") or item.get("user_id")), item) for item in raw if isinstance(item, dict))
    elif isinstance(raw, dict):
        iterable = ((str(key), value) for key, value in raw.items() if isinstance(value, dict))
    else:
        iterable = []

    for user_id, item in iterable:
        user_id = _clean_text(user_id)
        if not user_id:
            continue
        mappings[user_id] = _normalize_mapping(user_id, item)
    return mappings


def _apply_env(config: dict[str, Any]) -> dict[str, Any]:
    env_map = {
        "ZOHO_PEOPLE_ENABLED": ("enabled", _to_bool),
        "ZOHO_PEOPLE_AUTO_PUSH": ("auto_push", _to_bool),
        "ZOHO_DATA_CENTER": ("data_center", _clean_text),
        "ZOHO_ACCOUNTS_URL": ("accounts_url", _clean_text),
        "ZOHO_PEOPLE_URL": ("people_url", _clean_text),
        "ZOHO_CLIENT_ID": ("client_id", _clean_text),
        "ZOHO_CLIENT_SECRET": ("client_secret", _clean_text),
        "ZOHO_REFRESH_TOKEN": ("refresh_token", _clean_text),
        "ZOHO_ACCESS_TOKEN": ("access_token", _clean_text),
        "ZOHO_DEFAULT_LOCATION": ("default_location", _clean_text),
        "ZOHO_DEFAULT_BUILDING": ("default_building", _clean_text),
        "ZOHO_MIN_PUNCH_DATE": ("min_punch_date", _clean_text),
        "ZOHO_USE_BIOMETRIC_ID_AS_EMP_ID": ("use_biometric_user_id_as_emp_id", _to_bool),
    }
    for env_key, (config_key, caster) in env_map.items():
        if env_key in os.environ:
            config[config_key] = caster(os.environ[env_key])
    if "ZOHO_BATCH_SIZE" in os.environ:
        config["batch_size"] = _to_int(os.environ["ZOHO_BATCH_SIZE"], 100, minimum=1, maximum=200)
    if "ZOHO_ACCESS_TOKEN_EXPIRES_AT" in os.environ:
        config["access_token_expires_at"] = _expiry_timestamp(os.environ["ZOHO_ACCESS_TOKEN_EXPIRES_AT"])
    return config


def _read_raw_config() -> dict[str, Any]:
    loaded: dict[str, Any] = {}
    if CONFIG_FILE.exists():
        try:
            loaded = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception as exc:
            raise ZohoConfigError(f"Could not read Zoho config: {exc}") from exc
    config = {**DEFAULT_CONFIG, **loaded}
    config["mappings"] = _normalize_mappings(config.get("mappings"))
    data_center = _clean_text(config.get("data_center") or "in").lower()
    defaults = _domain_defaults(data_center)
    config["data_center"] = data_center
    config["accounts_url"] = _clean_text(config.get("accounts_url")) or defaults["accounts_url"]
    config["people_url"] = _clean_text(config.get("people_url")) or defaults["people_url"]
    config["batch_size"] = _to_int(config.get("batch_size"), 100, minimum=1, maximum=200)
    config["enabled"] = _to_bool(config.get("enabled"))
    config["auto_push"] = _to_bool(config.get("auto_push"))
    config["use_biometric_user_id_as_emp_id"] = _to_bool(config.get("use_biometric_user_id_as_emp_id"))
    config["send_only_mapped_users"] = _to_bool(config.get("send_only_mapped_users"), default=True)
    config["access_token_expires_at"] = _expiry_timestamp(config.get("access_token_expires_at"))
    config = _apply_env(config)
    if config.get("auto_push") and not config.get("employee_verified_at"):
        config["auto_push"] = False
    return config


def get_config() -> dict[str, Any]:
    return _read_raw_config()


def public_config(config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = dict(config or get_config())
    mappings = _normalize_mappings(config.get("mappings"))
    public = {key: value for key, value in config.items() if key not in SECRET_KEYS}
    public["mappings"] = mappings
    for key, public_key in PUBLIC_SECRET_KEYS.items():
        public[public_key] = bool(config.get(key))
    public["configured"] = is_configured(config)
    public["mapping_count"] = len([item for item in mappings.values() if item.get("active") and item.get("zoho_employee_id")])
    public["send_only_mapped_users"] = _to_bool(config.get("send_only_mapped_users"), default=True)
    public["data_centers"] = DATA_CENTERS
    public["required_scope"] = REQUIRED_ATTENDANCE_SCOPE
    public["employee_read_scope"] = REQUIRED_EMPLOYEE_READ_SCOPE
    return public


def save_config(payload: dict[str, Any]) -> dict[str, Any]:
    current = get_config()
    updated = dict(current)
    allowed = {
        "enabled",
        "auto_push",
        "data_center",
        "accounts_url",
        "people_url",
        "client_id",
        "client_secret",
        "refresh_token",
        "access_token",
        "access_token_expires_at",
        "default_location",
        "default_building",
        "min_punch_date",
        "use_biometric_user_id_as_emp_id",
        "send_only_mapped_users",
        "batch_size",
        "mappings",
    }

    for key, value in payload.items():
        if key not in allowed:
            continue
        if key in SECRET_KEYS and _clean_text(value) == "":
            continue
        if key == "access_token_expires_at" and not payload.get("access_token"):
            continue
        updated[key] = value

    updated["data_center"] = _clean_text(updated.get("data_center") or "in").lower()
    defaults = _domain_defaults(updated["data_center"])
    updated["accounts_url"] = _clean_text(updated.get("accounts_url")) or defaults["accounts_url"]
    updated["people_url"] = _clean_text(updated.get("people_url")) or defaults["people_url"]
    updated["enabled"] = _to_bool(updated.get("enabled"))
    updated["auto_push"] = _to_bool(updated.get("auto_push"))
    updated["use_biometric_user_id_as_emp_id"] = _to_bool(updated.get("use_biometric_user_id_as_emp_id"))
    updated["send_only_mapped_users"] = _to_bool(updated.get("send_only_mapped_users"), default=True)
    updated["employee_verify_matched_count"] = _to_int(updated.get("employee_verify_matched_count"), 0, minimum=0, maximum=100000)
    updated["employee_verify_missing_count"] = _to_int(updated.get("employee_verify_missing_count"), 0, minimum=0, maximum=100000)
    updated["employee_verify_unmapped_count"] = _to_int(updated.get("employee_verify_unmapped_count"), 0, minimum=0, maximum=100000)
    updated["batch_size"] = _to_int(updated.get("batch_size"), 100, minimum=1, maximum=200)
    updated["access_token_expires_at"] = _expiry_timestamp(updated.get("access_token_expires_at"))
    updated["mappings"] = _normalize_mappings(updated.get("mappings"))
    if updated.get("auto_push") and not updated.get("employee_verified_at"):
        updated["auto_push"] = False

    credentials_changed = any(_clean_text(payload.get(key)) for key in ("client_id", "client_secret", "refresh_token"))
    if payload.get("access_token"):
        _TOKEN_CACHE["access_token"] = _clean_text(payload.get("access_token"))
        _TOKEN_CACHE["expires_at"] = _expiry_timestamp(updated.get("access_token_expires_at"))
    if credentials_changed and not payload.get("access_token"):
        updated["access_token"] = ""
        updated["access_token_expires_at"] = 0
        _TOKEN_CACHE["access_token"] = ""
        _TOKEN_CACHE["expires_at"] = 0.0

    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(updated, indent=2), encoding="utf-8")
    return public_config(updated)


def _persist_config_values(values: dict[str, Any]) -> None:
    try:
        current: dict[str, Any] = {}
        if CONFIG_FILE.exists():
            current = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        current.update(values)
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(current, indent=2), encoding="utf-8")
    except Exception:
        pass


def is_configured(config: dict[str, Any] | None = None) -> bool:
    config = config or get_config()
    return bool(config.get("client_id") and config.get("client_secret") and config.get("refresh_token"))


def active_mapped_user_ids(config: dict[str, Any] | None = None) -> list[str]:
    config = config or get_config()
    mappings = _normalize_mappings(config.get("mappings"))
    return sorted(
        user_id
        for user_id, mapping in mappings.items()
        if mapping.get("active") and mapping.get("zoho_employee_id")
    )


def _persist_access_token(access_token: str, expires_at: float) -> None:
    _persist_config_values({"access_token": access_token, "access_token_expires_at": expires_at})


def _persist_employee_verification(*, matched_count: int, missing_count: int, unmapped_count: int) -> None:
    _persist_config_values(
        {
            "employee_verified_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "employee_verify_matched_count": matched_count,
            "employee_verify_missing_count": missing_count,
            "employee_verify_unmapped_count": unmapped_count,
        }
    )


def _validate_ready(config: dict[str, Any]) -> None:
    missing = [key for key in ("client_id", "client_secret", "refresh_token") if not config.get(key)]
    if missing:
        raise ZohoConfigError(f"Zoho is missing {', '.join(missing)}")


def refresh_access_token(config: dict[str, Any] | None = None, *, force: bool = False) -> str:
    config = config or get_config()
    _validate_ready(config)

    now = time.time()
    if not force and _TOKEN_CACHE.get("access_token") and float(_TOKEN_CACHE.get("expires_at") or 0) - now > 120:
        return str(_TOKEN_CACHE["access_token"])
    persisted_token = _clean_text(config.get("access_token"))
    persisted_expires_at = _expiry_timestamp(config.get("access_token_expires_at"))
    if not force and persisted_token and persisted_expires_at - now > 120:
        _TOKEN_CACHE["access_token"] = persisted_token
        _TOKEN_CACHE["expires_at"] = persisted_expires_at
        return persisted_token

    token_url = f"{str(config['accounts_url']).rstrip('/')}/oauth/v2/token"
    body = parse.urlencode(
        {
            "refresh_token": config["refresh_token"],
            "client_id": config["client_id"],
            "client_secret": config["client_secret"],
            "grant_type": "refresh_token",
        }
    ).encode("utf-8")
    req = request.Request(token_url, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with request.urlopen(req, timeout=25) as response:
            text = response.read().decode("utf-8", errors="replace")
            payload = json.loads(text)
    except error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        raise ZohoAPIError("Zoho token refresh failed", status_code=exc.code, body=body_text) from exc
    except (TimeoutError, request.socket.timeout) as exc:
        raise ZohoAPIError(f"Zoho token refresh failed: connection timed out after 25s. Check your network and that the Zoho accounts URL '{token_url}' is reachable.") from exc
    except request.URLError as exc:
        reason = str(exc.reason) if hasattr(exc, 'reason') else str(exc)
        raise ZohoAPIError(f"Zoho token refresh failed: cannot reach Zoho at '{token_url}'. Network error: {reason}. Check your data center setting and internet connection.") from exc
    except Exception as exc:
        error_type = type(exc).__name__
        error_msg = str(exc)
        raise ZohoAPIError(f"Zoho token refresh failed: {error_type}: {error_msg}") from exc

    access_token = payload.get("access_token")
    if not access_token:
        raise ZohoAPIError(f"Zoho token refresh failed: {_extract_zoho_error(json.dumps(payload))}", body=json.dumps(payload))

    expires_in = _to_int(payload.get("expires_in"), 3600, minimum=60, maximum=86400)
    expires_at = time.time() + expires_in
    _TOKEN_CACHE["access_token"] = access_token
    _TOKEN_CACHE["expires_at"] = expires_at
    _persist_access_token(str(access_token), expires_at)
    return str(access_token)


def _extract_zoho_error(text: str) -> str:
    cleaned = str(text or "").strip()
    if not cleaned:
        return "Zoho returned an empty error response"
    try:
        payload = json.loads(cleaned)
        response = payload.get("response", payload) if isinstance(payload, dict) else payload
        if isinstance(response, dict):
            errors = response.get("errors")
            if isinstance(errors, dict):
                message = errors.get("message") or response.get("message")
                code = errors.get("code")
                if message and code:
                    return f"{message} (Zoho code {code})"
                if message:
                    return str(message)
            message = response.get("message")
            if message:
                return str(message)
        if isinstance(payload, dict) and payload.get("error"):
            description = payload.get("error_description") or payload.get("error")
            return str(description)
    except Exception:
        pass
    return cleaned[:500]


def validate_attendance_scope(config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or get_config()
    access_token = refresh_access_token(config)
    query = parse.urlencode({"last_modified_within": 1, "offset": 0})
    url = f"{str(config['people_url']).rstrip('/')}/people/api/v3/attendance/entries?{query}"
    req = request.Request(url, method="GET")
    req.add_header("Authorization", f"Zoho-oauthtoken {access_token}")

    try:
        with request.urlopen(req, timeout=25) as response:
            status_code = response.getcode()
            text = response.read().decode("utf-8", errors="replace")
    except error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        raise ZohoAPIError(_extract_zoho_error(body_text), status_code=exc.code, body=body_text) from exc
    except Exception as exc:
        raise ZohoAPIError(f"Zoho attendance scope validation failed: {exc}") from exc

    if _response_has_error(status_code, text):
        raise ZohoAPIError(_extract_zoho_error(text), status_code=status_code, body=text)
    return {"status_code": status_code, "response_text": text}


def _field_token(value: Any) -> str:
    return "".join(ch for ch in str(value or "").lower() if ch.isalnum())


def _value_to_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        for key in ("display_value", "DisplayValue", "name", "Name", "value", "Value", "ID", "id"):
            if value.get(key):
                return _clean_text(value.get(key))
        return _clean_text(json.dumps(value, separators=(",", ":")))
    if isinstance(value, (list, tuple)):
        return ", ".join(_value_to_text(item) for item in value if _value_to_text(item))
    return _clean_text(value)


def _extract_field(record: dict[str, Any], aliases: list[str]) -> str:
    alias_tokens = {_field_token(alias) for alias in aliases}
    for key, value in record.items():
        if _field_token(key) in alias_tokens:
            return _value_to_text(value)
    return ""


def _append_flat_record(records: list[dict[str, Any]], value: Any, record_id: str = "") -> None:
    if isinstance(value, dict):
        row = dict(value)
        if record_id and not any(_field_token(key) in {"recordid", "id"} for key in row):
            row["record_id"] = record_id
        records.append(row)


def _flatten_zoho_records(value: Any) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if isinstance(value, list):
        for item in value:
            records.extend(_flatten_zoho_records(item))
        return records
    if not isinstance(value, dict):
        return records

    response = value.get("response")
    if isinstance(response, dict):
        result = response.get("result") or response.get("records") or response.get("data")
        if result is not None:
            return _flatten_zoho_records(result)

    # Zoho form APIs often return [{"123456789": [{"EmployeeID": "..."}]}].
    nested_record = False
    for record_id, item in value.items():
        if isinstance(item, list):
            nested_record = True
            for entry in item:
                _append_flat_record(records, entry, str(record_id))
        elif isinstance(item, dict):
            nested_record = True
            _append_flat_record(records, item, str(record_id))

    if nested_record:
        return records

    _append_flat_record(records, value)
    return records


def _normalize_employee_record(record: dict[str, Any]) -> dict[str, Any]:
    first_name = _extract_field(record, ["FirstName", "First Name"])
    last_name = _extract_field(record, ["LastName", "Last Name"])
    full_name = _extract_field(record, ["EmployeeName", "Employee Name", "Name", "FullName", "Full Name"])
    if not full_name:
        full_name = " ".join(part for part in (first_name, last_name) if part).strip()
    employee_id = _extract_field(record, ["EmployeeID", "Employee ID", "EmployeeId", "EMPLOYEEID"])
    return {
        "employee_id": employee_id,
        "name": full_name,
        "email": _extract_field(record, ["EmailID", "Email ID", "Employeemail", "Employee Email", "Email"]),
        "status": _extract_field(record, ["Employeestatus", "EmployeeStatus", "Employee Status"]),
        "record_id": _extract_field(record, ["record_id", "RecordID", "Record ID", "ID"]),
    }


def _get_employee_records_page(config: dict[str, Any], *, start_index: int, limit: int) -> tuple[str, int, str]:
    access_token = refresh_access_token(config)
    query = parse.urlencode({"sIndex": start_index, "limit": limit})
    paths = (
        f"/people/api/forms/employee/getRecords?{query}",
        f"/api/forms/employee/getRecords?{query}",
    )
    last_not_found: ZohoAPIError | None = None
    for path in paths:
        url = f"{str(config['people_url']).rstrip('/')}{path}"
        req = request.Request(url, method="GET")
        req.add_header("Authorization", f"Zoho-oauthtoken {access_token}")
        try:
            with request.urlopen(req, timeout=25) as response:
                status_code = response.getcode()
                text = response.read().decode("utf-8", errors="replace")
        except error.HTTPError as exc:
            body_text = exc.read().decode("utf-8", errors="replace")
            zoho_error = ZohoAPIError(_extract_zoho_error(body_text), status_code=exc.code, body=body_text)
            if exc.code == 404:
                last_not_found = zoho_error
                continue
            raise zoho_error from exc
        except Exception as exc:
            raise ZohoAPIError(f"Zoho employee lookup failed: {exc}") from exc

        if _response_has_error(status_code, text):
            raise ZohoAPIError(_extract_zoho_error(text), status_code=status_code, body=text)
        return text, status_code, url

    if last_not_found:
        raise last_not_found
    raise ZohoAPIError("Zoho employee lookup endpoint was not found")


def fetch_employee_records(
    config: dict[str, Any] | None = None,
    *,
    page_size: int = 200,
    max_pages: int = 10,
) -> dict[str, Any]:
    config = config or get_config()
    _validate_ready(config)
    refresh_access_token(config, force=True)
    page_size = _to_int(page_size, 200, minimum=1, maximum=200)
    max_pages = _to_int(max_pages, 10, minimum=1, maximum=50)
    employees: list[dict[str, Any]] = []
    source_url = ""
    status_code = 0

    for page in range(max_pages):
        text, status_code, source_url = _get_employee_records_page(
            config,
            start_index=(page * page_size) + 1,
            limit=page_size,
        )
        try:
            payload = json.loads(text)
        except Exception as exc:
            raise ZohoAPIError(f"Zoho employee lookup returned invalid JSON: {exc}", body=text) from exc

        page_rows = [_normalize_employee_record(row) for row in _flatten_zoho_records(payload)]
        page_rows = [row for row in page_rows if row.get("employee_id") or row.get("email") or row.get("name")]
        employees.extend(page_rows)
        if len(page_rows) < page_size:
            break

    unique: dict[str, dict[str, Any]] = {}
    for employee in employees:
        key = _field_token(employee.get("employee_id")) or _field_token(employee.get("email")) or _field_token(employee.get("record_id"))
        if not key:
            key = f"row{len(unique)}"
        unique[key] = employee

    return {
        "status_code": status_code,
        "source_url": source_url,
        "records": list(unique.values()),
        "count": len(unique),
        "required_scope": REQUIRED_EMPLOYEE_READ_SCOPE,
    }


def verify_local_employee_mappings(local_users: list[dict[str, Any]], config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or get_config()
    try:
        employees_result = fetch_employee_records(config)
    except ZohoAPIError as exc:
        if "Invalid OAuth Scope" in str(exc) or exc.status_code == 502:
            raise ZohoAPIError(
                f"Your refresh token is missing the required scope '{REQUIRED_EMPLOYEE_READ_SCOPE}'. "
                f"Please generate a new refresh token with BOTH scopes: "
                f"'{REQUIRED_ATTENDANCE_SCOPE}' AND '{REQUIRED_EMPLOYEE_READ_SCOPE}'.\n\n"
                f"Steps:\n"
                f"1. Go to https://api-console.zoho.com/\n"
                f"2. Select your Self Client\n"
                f"3. Under 'Generate Token', add BOTH scopes:\n"
                f"   - {REQUIRED_ATTENDANCE_SCOPE}\n"
                f"   - {REQUIRED_EMPLOYEE_READ_SCOPE}\n"
                f"4. Generate a NEW refresh token\n"
                f"5. Update it in CRM Settings → Zoho People",
                status_code=exc.status_code,
                body=exc.body,
            ) from exc
        raise
    employees = employees_result["records"]
    zoho_by_employee_id = {
        _field_token(employee.get("employee_id")): employee
        for employee in employees
        if employee.get("employee_id")
    }

    unique_users: dict[str, dict[str, Any]] = {}
    for user in local_users:
        user_id = _clean_text(user.get("user_id"))
        if not user_id:
            continue
        current = unique_users.setdefault(
            user_id,
            {
                "user_id": user_id,
                "name": _clean_text(user.get("name")),
                "devices": [],
            },
        )
        if not current["name"] and user.get("name"):
            current["name"] = _clean_text(user.get("name"))
        device_name = _clean_text(user.get("device_name"))
        if device_name and device_name not in current["devices"]:
            current["devices"].append(device_name)

    rows: list[dict[str, Any]] = []
    matched_count = 0
    missing_count = 0
    unmapped_count = 0
    for user_id, user in sorted(unique_users.items(), key=lambda item: (item[1].get("name") or item[0]).lower()):
        expected_id, source = resolve_employee_id(user_id, config)
        expected_id = _clean_text(expected_id)
        zoho_employee = zoho_by_employee_id.get(_field_token(expected_id)) if expected_id else None
        if not expected_id:
            status = "unmapped"
            unmapped_count += 1
        elif zoho_employee:
            status = "matched"
            matched_count += 1
        else:
            status = "missing"
            missing_count += 1
        rows.append(
            {
                "user_id": user_id,
                "user_name": user.get("name"),
                "devices": user.get("devices", []),
                "expected_employee_id": expected_id,
                "mapping_source": source,
                "status": status,
                "zoho_employee": zoho_employee,
            }
        )

    if matched_count > 0 and missing_count == 0:
        _persist_employee_verification(
            matched_count=matched_count,
            missing_count=missing_count,
            unmapped_count=unmapped_count,
        )

    return {
        "status": "ok",
        "zoho_employee_count": employees_result["count"],
        "local_user_count": len(unique_users),
        "matched_count": matched_count,
        "missing_count": missing_count,
        "unmapped_count": unmapped_count,
        "required_scope": REQUIRED_EMPLOYEE_READ_SCOPE,
        "items": rows,
    }


def _format_zoho_time(value: str) -> str:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed.strftime("%Y-%m-%d %H:%M:%S")


def _punch_date(punch: dict[str, Any]) -> date:
    parsed = datetime.fromisoformat(str(punch["punch_time"]).replace("Z", "+00:00"))
    return parsed.date()


def resolve_employee_id(user_id: str, config: dict[str, Any] | None = None) -> tuple[str | None, str]:
    config = config or get_config()
    mappings = _normalize_mappings(config.get("mappings"))
    mapping = mappings.get(str(user_id))
    if mapping and mapping.get("active") and mapping.get("zoho_employee_id"):
        return str(mapping["zoho_employee_id"]), "mapping"
    if _to_bool(config.get("use_biometric_user_id_as_emp_id")):
        return str(user_id), "biometric_user_id"
    return None, "unmapped"


# ============================================================
# NEW FUNCTIONS: ZOHO ATTENDANCE FETCH + MERGE EARLIEST/LATEST
# ============================================================

def fetch_zoho_attendance_for_date(
    emp_id: str,
    target_date: str,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Fetch Zoho attendance entries for a specific employee and date.
    Returns dict with 'checkIn' and 'checkOut' times if found, or empty if not found.
    """
    config = config or get_config()
    _validate_ready(config)
    access_token = refresh_access_token(config)

    # Zoho v3 attendance API with date filter
    query = parse.urlencode({
        "employeeId": emp_id,
        "attendanceDate": target_date,
        "limit": 10,
    })
    url = f"{str(config['people_url']).rstrip('/')}/people/api/v3/attendance/entries?{query}"
    req = request.Request(url, method="GET")
    req.add_header("Authorization", f"Zoho-oauthtoken {access_token}")

    try:
        with request.urlopen(req, timeout=25) as response:
            text = response.read().decode("utf-8", errors="replace")
    except error.HTTPError as exc:
        # 404 / no records is valid — means no Zoho entry yet
        if exc.code == 404:
            return {}
        body_text = exc.read().decode("utf-8", errors="replace")
        raise ZohoAPIError(_extract_zoho_error(body_text), status_code=exc.code, body=body_text) from exc
    except Exception as exc:
        raise ZohoAPIError(f"Zoho attendance fetch failed: {exc}") from exc

    try:
        payload = json.loads(text)
    except Exception:
        return {}

    # Try to extract checkIn / checkOut from response
    response = payload.get("response", payload) if isinstance(payload, dict) else payload
    if isinstance(response, dict):
        result = response.get("result") or response.get("data") or response.get("records")
        if isinstance(result, list):
            for entry in result:
                if isinstance(entry, dict):
                    ci = entry.get("checkIn") or entry.get("CheckIn")
                    co = entry.get("checkOut") or entry.get("CheckOut")
                    if ci or co:
                        return {
                            "checkIn": _clean_text(str(ci)) if ci else None,
                            "checkOut": _clean_text(str(co)) if co else None,
                        }
        elif isinstance(result, dict):
            ci = result.get("checkIn") or result.get("CheckIn")
            co = result.get("checkOut") or result.get("CheckOut")
            if ci or co:
                return {
                    "checkIn": _clean_text(str(ci)) if ci else None,
                    "checkOut": _clean_text(str(co)) if co else None,
                }
    return {}


def _parse_iso_datetime(value: str) -> datetime | None:
    """Parse an ISO datetime string safely, returning None on failure."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def resolve_earliest_latest_entry(
    biometric_user_id: str,
    target_date: str,
    biometric_first_in: str | None,
    biometric_last_out: str | None,
    config: dict[str, Any] | None = None,
) -> tuple[str | None, str | None]:
    """
    Merge logic: compares biometric first-in/last-out with existing Zoho entries
    for the same user on the same day, returning (earliest_checkin, latest_checkout).

    Rules:
    - Earliest IN = min(zoho_checkIn, biometric_first_in, zoho_checkOut)
    - Latest OUT = max(zoho_checkOut, biometric_last_out)

    If Zoho has no entry, biometric values are used as-is.
    """
    config = config or get_config()
    emp_id, _ = resolve_employee_id(biometric_user_id, config)
    if not emp_id:
        # No Zoho mapping; return biometric values unchanged
        return biometric_first_in, biometric_last_out

    try:
        zoho_entry = fetch_zoho_attendance_for_date(emp_id, target_date, config)
    except Exception:
        # If Zoho fetch fails (network, auth), fall back to biometric only
        return biometric_first_in, biometric_last_out

    # Parse all candidate times
    candidates_in: list[datetime] = []
    candidates_out: list[datetime] = []

    if biometric_first_in:
        dt = _parse_iso_datetime(biometric_first_in)
        if dt:
            candidates_in.append(dt)
    if biometric_last_out:
        dt = _parse_iso_datetime(biometric_last_out)
        if dt:
            candidates_out.append(dt)

    if zoho_entry:
        zoho_ci = zoho_entry.get("checkIn")
        zoho_co = zoho_entry.get("checkOut")
        # Zoho checkIn is also a candidate for "earliest IN"
        if zoho_ci:
            dt = _parse_iso_datetime(zoho_ci)
            if dt:
                candidates_in.append(dt)
        # Zoho checkOut: both a candidate for latest OUT and if it's actually
        # the first event of the day (e.g. check in from Zoho web at 7AM)
        # but we also consider it - the earliest IN could be a checkOut time
        # only if there's no checkIn. We'll treat checkOut as a candidate for
        # earliest IN too (some users might have only OUT entry in Zoho).
        if zoho_co:
            dt = _parse_iso_datetime(zoho_co)
            if dt:
                candidates_out.append(dt)
                # Also consider for earliest IN (no checkIn but has checkOut)
                candidates_in.append(dt)

    # Determine earliest IN and latest OUT
    earliest_in: str | None = None
    if candidates_in:
        earliest_in_dt = min(candidates_in)
        earliest_in = earliest_in_dt.isoformat(timespec="seconds")

    latest_out: str | None = None
    if candidates_out:
        latest_out_dt = max(candidates_out)
        latest_out = latest_out_dt.isoformat(timespec="seconds")

    return earliest_in, latest_out


def send_single_punch(
    user_id: str,
    user_name: str,
    first_in: str,
    last_out: str,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Send a single user's first IN / last OUT to Zoho as a bulk import entry.
    Used by the Time Login page "Sync to Zoho" button.
    """
    config = config or get_config()
    _validate_ready(config)

    emp_id, source = resolve_employee_id(user_id, config)
    if not emp_id:
        return {"status": "error", "message": f"No Zoho mapping for user {user_id}"}

    item: dict[str, Any] = {"empId": emp_id}

    if first_in:
        item["checkIn"] = _format_zoho_time(first_in)
    if last_out:
        item["checkOut"] = _format_zoho_time(last_out)

    location = _clean_text(config.get("default_location"))
    building = _clean_text(config.get("default_building"))
    if location:
        item["location"] = location
    if building:
        item["building"] = building

    try:
        result = send_bulk_import([item], config)
        response_text = str(result.get("response_text") or "")
        if "error" in response_text.lower() or result.get("status_code", 200) >= 400:
            return {"status": "error", "message": _extract_zoho_error(response_text), "response": response_text[:500]}
        return {"status": "ok", "message": f"Sent IN/OUT for {user_id} to Zoho", "response": response_text[:200]}
    except ZohoAPIError as exc:
        return {"status": "error", "message": str(exc)[:300]}
    except Exception as exc:
        return {"status": "error", "message": f"Zoho sync failed: {exc}"[:300]}


# ============================================================
# EXISTING FUNCTIONS (KEPT UNCHANGED)
# ============================================================

def build_bulk_import_item(punch: dict[str, Any], config: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    employee_id, source = resolve_employee_id(str(punch.get("user_id", "")), config)
    if not employee_id:
        return None, source

    direction = str(punch.get("direction") or "").upper()
    item: dict[str, Any] = {"empId": employee_id}
    if direction == "OUT":
        item["checkOut"] = _format_zoho_time(str(punch["punch_time"]))
    else:
        item["checkIn"] = _format_zoho_time(str(punch["punch_time"]))

    location = _clean_text(config.get("default_location"))
    building = _clean_text(config.get("default_building"))
    if location:
        item["location"] = location
    if building:
        item["building"] = building
    return item, source


def _bulk_item_date(item: dict[str, Any]) -> date:
    value = item.get("checkIn") or item.get("checkOut")
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def _parse_bulk_import_skips(text: str) -> set[str]:
    cleaned = str(text or "").strip()
    if not cleaned:
        return set()
    try:
        payload = json.loads(cleaned)
    except Exception:
        return set()
    skipped = payload.get("skippedEmpInfo") if isinstance(payload, dict) else None
    if not isinstance(skipped, list):
        return set()
    return {str(value) for value in skipped}


def _response_has_error(status_code: int, text: str) -> bool:
    if status_code >= 400:
        return True
    cleaned = text.strip()
    if not cleaned:
        return False
    try:
        payload = json.loads(cleaned)
        response = payload.get("response", payload) if isinstance(payload, dict) else payload
        if isinstance(response, dict):
            if str(response.get("status", "0")) not in {"0", "success", "SUCCESS"}:
                return True
            return any(key.lower() == "error" for key in response.keys())
    except Exception:
        pass
    lowered = cleaned.lower()
    return lowered.startswith("invalid") or "error" in lowered or "exception" in lowered


def send_bulk_import(items: list[dict[str, Any]], config: dict[str, Any] | None = None) -> dict[str, Any]:
    if not items:
        return {"status_code": 0, "response_text": "", "sent": 0}

    config = config or get_config()
    access_token = refresh_access_token(config)
    url = f"{str(config['people_url']).rstrip('/')}/people/api/attendance/bulkImport"
    body = parse.urlencode(
        {
            "dateFormat": "yyyy-MM-dd HH:mm:ss",
            "data": json.dumps(items, separators=(",", ":")),
        }
    ).encode("utf-8")
    req = request.Request(url, data=body, method="POST")
    req.add_header("Authorization", f"Zoho-oauthtoken {access_token}")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with request.urlopen(req, timeout=45) as response:
            status_code = response.getcode()
            text = response.read().decode("utf-8", errors="replace")
    except error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        raise ZohoAPIError(_extract_zoho_error(body_text), status_code=exc.code, body=body_text) from exc
    except Exception as exc:
        raise ZohoAPIError(f"Zoho attendance bulk import failed: {exc}") from exc

    if _response_has_error(status_code, text):
        raise ZohoAPIError(_extract_zoho_error(text), status_code=status_code, body=text)

    return {"status_code": status_code, "response_text": text, "sent": len(items)}


def _chunk(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def _chunk_prepared_by_date_window(items: list[dict[str, Any]], size: int, max_days: int = 31) -> list[list[dict[str, Any]]]:
    if not items:
        return []

    sorted_items = sorted(items, key=lambda row: (_bulk_item_date(row["item"]), int(row["punch"]["id"])))
    batches: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    window_start: date | None = None
    allowed_span = max(0, max_days - 1)

    for row in sorted_items:
        item_date = _bulk_item_date(row["item"])
        starts_new_window = window_start is None or (item_date - window_start).days > allowed_span
        starts_new_size = len(current) >= size
        if current and (starts_new_window or starts_new_size):
            batches.append(current)
            current = []
            window_start = None
        if window_start is None:
            window_start = item_date
        current.append(row)

    if current:
        batches.append(current)
    return batches


def sync_pending_punches(
    *,
    from_time: str | None = None,
    to_time: str | None = None,
    user_ids: list[str] | None = None,
    limit: int = 200,
    dry_run: bool = False,
) -> dict[str, Any]:
    config = get_config()
    if not config.get("enabled") and not dry_run:
        raise ZohoConfigError("Zoho People sync is disabled")
    if not dry_run:
        _validate_ready(config)

    limit = max(1, min(int(limit), 1000))
    mapped_user_ids = active_mapped_user_ids(config)
    effective_user_ids = user_ids
    if _to_bool(config.get("send_only_mapped_users"), default=True) and mapped_user_ids:
        requested_user_ids = {str(user_id) for user_id in user_ids} if user_ids else None
        effective_user_ids = [
            user_id
            for user_id in mapped_user_ids
            if requested_user_ids is None or user_id in requested_user_ids
        ]
        if not effective_user_ids:
            return {
                "dry_run": dry_run,
                "configured": is_configured(config),
                "requested_count": 0,
                "ready_count": 0,
                "skipped_count": 0,
                "items": [],
                "skipped": [],
                "status": "ok",
                "message": "No mapped users matched this request.",
                "sent_count": 0,
                "failed_count": 0,
                "mapped_user_ids": mapped_user_ids,
            }
    candidates = db.list_zoho_candidate_punches(
        from_time=from_time,
        to_time=to_time,
        user_ids=effective_user_ids,
        limit=limit,
        include_failed=True,
    )
    prepared: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    min_punch_date = _parse_date(config.get("min_punch_date"))

    for punch in candidates:
        if _punch_date(punch) < min_punch_date:
            skipped.append(
                {
                    "punch_id": punch["id"],
                    "user_id": punch["user_id"],
                    "user_name": punch.get("user_name"),
                    "punch_time": punch["punch_time"],
                    "reason": f"Punch date is before Zoho sync minimum date {min_punch_date.isoformat()}",
                }
            )
            continue
        item, source = build_bulk_import_item(punch, config)
        if not item:
            skipped.append(
                {
                    "punch_id": punch["id"],
                    "user_id": punch["user_id"],
                    "user_name": punch.get("user_name"),
                    "punch_time": punch["punch_time"],
                    "reason": "No Zoho employee mapping",
                }
            )
            continue
        prepared.append({"punch": punch, "item": item, "mapping_source": source})

    if dry_run:
        return {
            "dry_run": True,
            "configured": is_configured(config),
            "requested_count": len(candidates),
            "ready_count": len(prepared),
            "skipped_count": len(skipped),
            "mapped_user_ids": mapped_user_ids,
            "items": [
                {
                    "punch_id": row["punch"]["id"],
                    "user_id": row["punch"]["user_id"],
                    "user_name": row["punch"].get("user_name"),
                    "punch_time": row["punch"]["punch_time"],
                    "direction": row["punch"]["direction"],
                    "zoho_employee_id": row["item"]["empId"],
                    "mapping_source": row["mapping_source"],
                    "payload": row["item"],
                }
                for row in prepared
            ],
            "skipped": skipped,
        }

    run_id = db.start_zoho_sync_run(dry_run=False)
    sent_count = 0
    failed_count = 0

    for item in skipped:
        db.record_zoho_punch_status(
            int(item["punch_id"]),
            status="skipped",
            error=item["reason"],
        )

    batch_size = _to_int(config.get("batch_size"), 100, minimum=1, maximum=200)
    try:
        for batch in _chunk_prepared_by_date_window(prepared, batch_size, max_days=31):
            payload_items = [row["item"] for row in batch]
            payload_text = json.dumps(payload_items, separators=(",", ":"))
            try:
                response = send_bulk_import(payload_items, config)
                response_text = str(response.get("response_text") or "")
                skipped_emp_ids = _parse_bulk_import_skips(response_text)
                for row in batch:
                    emp_id = str(row["item"]["empId"])
                    if emp_id in skipped_emp_ids:
                        failed_count += 1
                        db.record_zoho_punch_status(
                            int(row["punch"]["id"]),
                            status="failed",
                            zoho_employee_id=emp_id,
                            request_payload=json.dumps(row["item"], separators=(",", ":")),
                            response_text=response_text[:4000],
                            error="Zoho skipped this employee in the bulk import response. Check Employee ID, biometric mapper, and attendance settings.",
                        )
                        continue
                    db.record_zoho_punch_status(
                        int(row["punch"]["id"]),
                        status="sent",
                        zoho_employee_id=emp_id,
                        request_payload=json.dumps(row["item"], separators=(",", ":")),
                        response_text=response_text[:4000],
                    )
                    sent_count += 1
            except ZohoAPIError as exc:
                failed_count += len(batch)
                error_text = str(exc)
                response_text = exc.body or ""
                for row in batch:
                    db.record_zoho_punch_status(
                        int(row["punch"]["id"]),
                        status="failed",
                        zoho_employee_id=str(row["item"]["empId"]),
                        request_payload=payload_text,
                        response_text=response_text[:4000],
                        error=error_text,
                    )
                raise

        status = "ok" if failed_count == 0 else ("partial" if sent_count else "error")
        message = f"{sent_count} sent, {len(skipped)} skipped, {failed_count} failed"
        db.finish_zoho_sync_run(
            run_id,
            status=status,
            message=message,
            requested_count=len(candidates),
            sent_count=sent_count,
            skipped_count=len(skipped),
            failed_count=failed_count,
        )
        return {
            "run_id": run_id,
            "status": status,
            "message": message,
            "requested_count": len(candidates),
            "sent_count": sent_count,
            "skipped_count": len(skipped),
            "failed_count": failed_count,
            "skipped": skipped,
        }
    except Exception as exc:
        db.finish_zoho_sync_run(
            run_id,
            status="error",
            message=str(exc),
            requested_count=len(candidates),
            sent_count=sent_count,
            skipped_count=len(skipped),
            failed_count=failed_count,
        )
        raise


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
