"""
Daily attendance email report module.
Generates an HTML email with today's attendance summary and sends it via SMTP.
"""
from __future__ import annotations

import csv
from html import escape
import io
import logging
import os
import smtplib
import sqlite3
import ssl
from datetime import date, datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import getaddresses
from pathlib import Path
from typing import Any

logger = logging.getLogger("email_report")


def _first_env(*names: str, default: str = "") -> str:
    """Return the first non-empty environment variable from the given names."""
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return default


def _env_int(*names: str, default: int) -> int:
    value = _first_env(*names)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        logger.warning("Invalid integer env value for %s: %r", "/".join(names), value)
        return default


def _env_bool(*names: str, default: bool) -> bool:
    value = _first_env(*names)
    if not value:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _explicit_env(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


def _clean_password(value: str) -> str:
    # Gmail app passwords are often copied with spaces; SMTP login wants the raw token.
    return value.replace(" ", "")


def _parse_recipients(value: Any) -> list[str]:
    """Parse comma/semicolon/newline separated recipient addresses for SMTP."""
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        raw_values = [str(item) for item in value]
    else:
        raw_values = [str(value)]

    normalized = [item.replace(";", ",").replace("\n", ",") for item in raw_values]
    recipients: list[str] = []
    seen: set[str] = set()
    for _name, address in getaddresses(normalized):
        address = address.strip()
        key = address.lower()
        if address and "@" in address and key not in seen:
            recipients.append(address)
            seen.add(key)
    return recipients


def _parse_cc_bcc(value: Any) -> tuple[list[str], list[str]]:
    """Parse CC and BCC from a string or list. Format: 'to1@ex.com,cc1@ex.com;bcc1@ex.com' or separate fields."""
    if value is None:
        return [], []
    if isinstance(value, dict):
        cc = _parse_recipients(value.get("cc"))
        bcc = _parse_recipients(value.get("bcc"))
        return cc, bcc
    # Fallback: treat all as regular recipients
    recipients = _parse_recipients(value)
    return [], []


def _env_config_overrides() -> dict[str, Any]:
    overrides: dict[str, Any] = {}
    env_values = {
        "host": _explicit_env("SMTP_HOST", "MAIL_SERVER", "MAIL_HOST"),
        "port": _explicit_env("SMTP_PORT", "MAIL_PORT"),
        "user": _explicit_env("SMTP_USER", "MAIL_USERNAME"),
        "password": _explicit_env("SMTP_PASSWORD", "MAIL_PASSWORD"),
        "from_email": _explicit_env("SMTP_FROM", "MAIL_FROM", "MAIL_DEFAULT_SENDER"),
        "to_email": _explicit_env("SMTP_TO", "MAIL_TO", "EMAIL_REPORT_TO"),
        "use_tls": _explicit_env("SMTP_TLS", "MAIL_USE_TLS"),
        "enabled": _explicit_env("EMAIL_REPORT_ENABLED", "MAIL_ENABLED"),
        "time": _explicit_env("EMAIL_REPORT_TIME", "MAIL_REPORT_TIME"),
    }
    for key, value in env_values.items():
        if value is None:
            continue
        if key == "port":
            try:
                overrides[key] = int(value)
            except ValueError:
                logger.warning("Invalid SMTP port env value: %r", value)
        elif key in {"use_tls", "enabled"}:
            overrides[key] = value.strip().lower() in {"1", "true", "yes", "y", "on"}
        elif key == "password":
            overrides[key] = _clean_password(value)
        else:
            overrides[key] = value
    return overrides


_smtp_user = _first_env("SMTP_USER", "MAIL_USERNAME")

# Default SMTP config (can be overridden via env vars or API)
SMTP_CONFIG = {
    "host": _first_env("SMTP_HOST", "MAIL_SERVER", "MAIL_HOST", default="smtp.gmail.com"),
    "port": _env_int("SMTP_PORT", "MAIL_PORT", default=587),
    "user": _smtp_user,
    "password": _clean_password(_first_env("SMTP_PASSWORD", "MAIL_PASSWORD")),
    "from_email": _first_env("SMTP_FROM", "MAIL_FROM", "MAIL_DEFAULT_SENDER", default=_smtp_user),
    "to_email": _first_env("SMTP_TO", "MAIL_TO", "EMAIL_REPORT_TO", default=_smtp_user),
    "use_tls": _env_bool("SMTP_TLS", "MAIL_USE_TLS", default=True),
    "enabled": _env_bool("EMAIL_REPORT_ENABLED", "MAIL_ENABLED", default=False),
    "time": _first_env("EMAIL_REPORT_TIME", "MAIL_REPORT_TIME", default="23:30"),
}

_CONFIG_FILE = Path(__file__).resolve().parent.parent / "data" / "email_config.json"


def _load_config() -> dict:
    """Load SMTP config from JSON file, falling back to env vars."""
    config = dict(SMTP_CONFIG)
    try:
        if _CONFIG_FILE.exists():
            import json
            saved = json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
            config.update(saved)
        config.update(_env_config_overrides())
        config["password"] = _clean_password(str(config.get("password", "")))
    except Exception as exc:
        logger.warning("Failed to load email config file: %s", exc)
    return config


def _save_config(config: dict) -> None:
    """Save SMTP config to JSON file."""
    import json
    _CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CONFIG_FILE.write_text(json.dumps(config, indent=2), encoding="utf-8")


def get_config() -> dict:
    """Get the current email configuration."""
    return _load_config()


def update_config(**kwargs) -> dict:
    """Update email configuration with the given key-value pairs."""
    config = _load_config()
    for key, value in kwargs.items():
        if value is not None:
            if key == "cc_email":
                config["cc_email"] = ", ".join(_parse_recipients(value)) if isinstance(value, str) else value
            elif key == "bcc_email":
                config["bcc_email"] = ", ".join(_parse_recipients(value)) if isinstance(value, str) else value
            elif key == "password":
                config[key] = _clean_password(value)
            elif key in config:
                config[key] = value
    _save_config(config)
    return config


def _get_db_path() -> str:
    """Get the database path from the environment or default."""
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    return os.getenv("BIOMETRIC_DB_FILE", str(root / "backend" / "data" / "attendance.db"))


def _query_db(query: str, params: list[Any] = None) -> list[dict[str, Any]]:
    """Execute a query on the attendance database and return results as dicts."""
    conn = sqlite3.connect(_get_db_path())
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(query, params or [])
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def _parse_punch_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def _format_clock(value: datetime | None) -> str:
    return value.strftime("%H:%M:%S") if value else "-"


def _format_duration(seconds: int | None) -> str:
    if seconds is None or seconds < 0:
        return "-"
    total_minutes = seconds // 60
    hours = total_minutes // 60
    minutes = total_minutes % 60
    return f"{hours:02d}:{minutes:02d}:00"


def _duration_cell_style(seconds: int | None) -> str:
    base = "padding:7px 8px;border:1px solid #d9d9d9;text-align:center;font-weight:800;color:#0016a8;font-size:12px;"
    if seconds is None:
        return base
    if seconds < 5 * 60 * 60:
        return base + "background:#ff9900;color:#111;"
    if seconds < 8 * 60 * 60:
        return base + "background:#fff200;color:#111;"
    return base


def _device_report_label(device_names: set[str]) -> str:
    prefixes: set[str] = set()
    for name in device_names:
        prefix = str(name or "").split("-", 1)[0].strip()
        if prefix:
            prefixes.add(prefix)
    if not prefixes:
        return "Devices"

    def sort_key(value: str) -> tuple[int, str]:
        return (int(value), value) if value.isdigit() else (-1, value)

    ordered = sorted(prefixes, key=sort_key, reverse=True)
    if len(ordered) == 1:
        return ordered[0]
    if len(ordered) == 2:
        return f"{ordered[0]} and {ordered[1]}"
    return f"{', '.join(ordered[:-1])} and {ordered[-1]}"


def _build_employee_attendance_rows(punches: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], set[str]]:
    employees: dict[str, dict[str, Any]] = {}
    device_names: set[str] = set()

    for punch in punches:
        user_id = str(punch.get("user_id") or "").strip() or "-"
        device_name = str(punch.get("device_name") or "").strip()
        if device_name:
            device_names.add(device_name)

        employee = employees.setdefault(
            user_id,
            {
                "user_id": user_id,
                "user_name": punch.get("user_name") or "Unknown",
                "punches": [],
            },
        )
        if punch.get("user_name") and employee["user_name"] == "Unknown":
            employee["user_name"] = punch["user_name"]

        punch_time = _parse_punch_datetime(punch.get("punch_time"))
        if not punch_time:
            continue

        direction = str(punch.get("direction") or "").upper()
        if direction in {"IN", "OUT"}:
            employee["punches"].append((punch_time, direction))

    rows: list[dict[str, Any]] = []
    for employee in employees.values():
        punch_events = sorted(employee["punches"], key=lambda item: item[0])
        first_in = None
        for punch_time, direction in punch_events:
            if direction == "IN":
                first_in = punch_time
                break

        last_out = None
        for punch_time, direction in punch_events:
            if direction == "OUT":
                last_out = punch_time

        duration_seconds = None
        if first_in and last_out and last_out >= first_in:
            duration_seconds = int((last_out - first_in).total_seconds())
        rows.append(
            {
                "user_id": employee["user_id"],
                "user_name": employee["user_name"],
                "first_in": first_in,
                "last_out": last_out,
                "duration_seconds": duration_seconds,
            }
        )

    rows.sort(key=lambda row: (str(row.get("user_name") or "").casefold(), str(row.get("user_id") or "")))
    return rows, device_names


def generate_html_report(target_date: date | None = None) -> str:
    """Generate an HTML email report for the given date (default: today)."""
    if target_date is None:
        target_date = date.today()

    date_str = target_date.isoformat()

    punches = _query_db(
        """
        SELECT punch_time, direction, user_id, user_name, device_name, device_ip, punch_label
        FROM punches
        WHERE date(punch_time) = ?
        ORDER BY punch_time ASC
        """,
        [date_str],
    )
    attendance_rows, device_names = _build_employee_attendance_rows(punches)

    formatted_date = target_date.strftime("%d/%m/%Y")
    device_label = _device_report_label(device_names)

    row_html = ""
    for row in attendance_rows:
        row_html += f"""
        <tr>
            <td style="padding:7px 8px;border:1px solid #d9d9d9;text-align:center;font-weight:700;font-size:12px;">{escape(str(row["user_id"]))}</td>
            <td style="padding:7px 8px;border:1px solid #d9d9d9;font-weight:700;font-size:12px;">{escape(str(row["user_name"]))}</td>
            <td style="padding:7px 8px;border:1px solid #d9d9d9;text-align:center;font-size:12px;">{_format_clock(row["first_in"])}</td>
            <td style="padding:7px 8px;border:1px solid #d9d9d9;text-align:center;font-size:12px;">{_format_clock(row["last_out"])}</td>
            <td style="{_duration_cell_style(row["duration_seconds"])}">{_format_duration(row["duration_seconds"])}</td>
        </tr>"""

    if not row_html:
        row_html = """
        <tr>
            <td colspan="5" style="padding:16px;border:1px solid #d9d9d9;text-align:center;color:#666;font-size:12px;">No attendance records found.</td>
        </tr>"""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#222;">
    <div style="padding:28px 32px;">
        <h2 style="margin:0 0 14px;color:#3f86df;font-size:18px;font-weight:700;">Daily Attendance Report - {formatted_date}</h2>
        <div style="background:#f3f3f3;border-left:4px solid #3f86df;padding:14px 16px;margin:0 0 18px;font-size:12px;">
            <strong>Total Employees:</strong> {len(attendance_rows)}
        </div>
        <table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;">
            <thead>
                <tr>
                    <th style="width:22%;padding:8px;border:1px solid #d9d9d9;background:#4a90e2;color:#fff;text-align:center;font-size:12px;">Employee Code</th>
                    <th style="width:38%;padding:8px;border:1px solid #d9d9d9;background:#4a90e2;color:#fff;text-align:center;font-size:12px;">Employee Name</th>
                    <th style="width:13%;padding:8px;border:1px solid #d9d9d9;background:#4a90e2;color:#fff;text-align:center;font-size:12px;">IN</th>
                    <th style="width:13%;padding:8px;border:1px solid #d9d9d9;background:#4a90e2;color:#fff;text-align:center;font-size:12px;">OUT</th>
                    <th style="width:14%;padding:8px;border:1px solid #d9d9d9;background:#4a90e2;color:#fff;text-align:center;font-size:12px;">Duration</th>
                </tr>
            </thead>
            <tbody>{row_html}
            </tbody>
        </table>
        <p style="margin:14px 0 0;color:#777;font-size:11px;">Report includes combined punches from {escape(device_label)}.</p>
    </div>
</body>
</html>"""


def generate_email_subject(target_date: date | None = None) -> str:
    """Generate the email subject for the attendance report."""
    if target_date is None:
        target_date = date.today()
    devices = _query_db(
        """
        SELECT DISTINCT device_name
        FROM punches
        WHERE date(punch_time) = ?
        ORDER BY device_name
        """,
        [target_date.isoformat()],
    )
    device_names = {row.get("device_name", "") for row in devices}
    return f"{target_date.strftime('%d/%m/%Y')} - Attendance Report for {_device_report_label(device_names)}"


def send_report(target_date: date | None = None, config_override: dict | None = None, require_enabled: bool = True) -> dict[str, Any]:
    """Generate and send the daily attendance report via email."""
    config = config_override or _load_config()
    recipients = _parse_recipients(config.get("to_email"))
    cc_recipients = _parse_recipients(config.get("cc_email"))
    bcc_recipients = _parse_recipients(config.get("bcc_email"))
    all_recipients = list(recipients) + list(cc_recipients) + list(bcc_recipients)

    if require_enabled and not config.get("enabled"):
        return {"status": "skipped", "message": "Email report is disabled."}

    if not recipients or not config.get("from_email"):
        return {"status": "error", "message": "SMTP to/from email not configured."}

    if "gmail.com" in str(config.get("host", "")).lower() and (not config.get("user") or not config.get("password")):
        return {"status": "error", "message": "Gmail SMTP username/password not configured."}

    if target_date is None:
        target_date = date.today()

    html_content = generate_html_report(target_date)
    formatted_date = target_date.strftime("%d-%m-%Y")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = generate_email_subject(target_date)
    msg["From"] = config["from_email"]
    msg["To"] = ", ".join(recipients)
    if cc_recipients:
        msg["Cc"] = ", ".join(cc_recipients)
    if bcc_recipients:
        msg["Bcc"] = ", ".join(bcc_recipients)
    msg.attach(MIMEText(html_content, "html"))

    try:
        server = smtplib.SMTP(config["host"], config["port"], timeout=30)
        server.set_debuglevel(0)
        server.ehlo()

        if config.get("use_tls", True):
            server.starttls(context=ssl.create_default_context())
            server.ehlo()

        if config.get("user") and config.get("password"):
            server.login(config["user"], config["password"])

        server.sendmail(config["from_email"], all_recipients, msg.as_string())
        server.quit()

        recipient_parts = []
        if recipients:
            recipient_parts.append(f"To: {', '.join(recipients)}")
        if cc_recipients:
            recipient_parts.append(f"CC: {', '.join(cc_recipients)}")
        if bcc_recipients:
            recipient_parts.append(f"BCC: {', '.join(bcc_recipients)}")
        recipient_text = " | ".join(recipient_parts)
        logger.info("Daily report sent for %s — %s", formatted_date, recipient_text)
        return {"status": "ok", "message": f"Report sent for {formatted_date}. {recipient_text}"}

    except smtplib.SMTPAuthenticationError:
        logger.error("Failed to send email report: Gmail SMTP authentication rejected for %s", config.get("user"))
        return {
            "status": "error",
            "message": (
                "Gmail rejected the SMTP username/app password. Generate a new Google App Password "
                "for this Gmail account, update Settings > Email, then try Send Test again."
            ),
        }
    except smtplib.SMTPRecipientsRefused as exc:
        logger.error("Failed to send email report: recipients rejected: %s", exc.recipients)
        return {"status": "error", "message": f"SMTP rejected recipient address(es): {', '.join(exc.recipients.keys())}"}
    except Exception as exc:
        logger.error("Failed to send email report: %s", exc)
        return {"status": "error", "message": str(exc)}


def generate_csv_report(target_date: date | None = None) -> str:
    """Generate a CSV string of all punches for the given date."""
    if target_date is None:
        target_date = date.today()

    punches = _query_db(
        """
        SELECT punch_time, direction, user_id, user_name, device_name, device_ip, device_serial, punch_label, punch_code, verify_code
        FROM punches
        WHERE date(punch_time) = ?
        ORDER BY punch_time ASC
        """,
        [target_date.isoformat()],
    )

    buffer = io.StringIO()
    fieldnames = ["punch_time", "direction", "user_id", "user_name", "device_name", "device_ip", "device_serial", "punch_label", "punch_code", "verify_code"]
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(punches)
    buffer.seek(0)
    return buffer.getvalue()
