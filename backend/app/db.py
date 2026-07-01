from __future__ import annotations

import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    from .config import DeviceConfig, ROOT_DIR
except ImportError:
    from config import DeviceConfig, ROOT_DIR  # type: ignore[no-redef]


DB_PATH = Path(os.getenv("BIOMETRIC_DB_FILE", str(ROOT_DIR / "backend" / "data" / "attendance.db")))


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                short_name TEXT NOT NULL,
                serial TEXT,
                actual_serial TEXT,
                ip TEXT NOT NULL,
                port INTEGER NOT NULL,
                location TEXT,
                direction_mode TEXT NOT NULL,
                default_direction TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'configured',
                error TEXT,
                last_seen_at TEXT,
                last_sync_at TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS users (
                device_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                uid INTEGER,
                name TEXT,
                privilege INTEGER,
                password TEXT,
                group_id TEXT,
                card TEXT,
                synced_at TEXT NOT NULL,
                PRIMARY KEY (device_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS punches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                device_name TEXT NOT NULL,
                device_ip TEXT NOT NULL,
                device_serial TEXT,
                user_id TEXT NOT NULL,
                user_name TEXT,
                uid INTEGER,
                punch_time TEXT NOT NULL,
                punch_code INTEGER,
                punch_label TEXT NOT NULL,
                direction TEXT NOT NULL,
                verify_code INTEGER,
                raw_status TEXT,
                synced_at TEXT NOT NULL,
                UNIQUE (device_id, user_id, punch_time, punch_code, verify_code)
            );

            CREATE TABLE IF NOT EXISTS sync_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                status TEXT NOT NULL,
                message TEXT,
                device_count INTEGER NOT NULL DEFAULT 0,
                user_count INTEGER NOT NULL DEFAULT 0,
                punch_count INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS zoho_sync_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                status TEXT NOT NULL,
                message TEXT,
                requested_count INTEGER NOT NULL DEFAULT 0,
                sent_count INTEGER NOT NULL DEFAULT 0,
                skipped_count INTEGER NOT NULL DEFAULT 0,
                failed_count INTEGER NOT NULL DEFAULT 0,
                dry_run INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS zoho_punch_sync (
                punch_id INTEGER PRIMARY KEY,
                zoho_employee_id TEXT,
                status TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                request_payload TEXT,
                response_text TEXT,
                error TEXT,
                sent_at TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (punch_id) REFERENCES punches(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_punches_time ON punches (punch_time);
            CREATE INDEX IF NOT EXISTS idx_punches_device ON punches (device_id);
            CREATE INDEX IF NOT EXISTS idx_punches_user ON punches (user_id);
            CREATE INDEX IF NOT EXISTS idx_zoho_punch_sync_status ON zoho_punch_sync (status);
            """
        )


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def upsert_config_devices(devices: list[DeviceConfig]) -> None:
    timestamp = now_iso()
    with connect() as conn:
        for device in devices:
            conn.execute(
                """
                INSERT INTO devices (
                    id, name, short_name, serial, ip, port, location, direction_mode,
                    default_direction, enabled, status, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'configured', ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    short_name = excluded.short_name,
                    serial = excluded.serial,
                    ip = excluded.ip,
                    port = excluded.port,
                    location = excluded.location,
                    direction_mode = excluded.direction_mode,
                    default_direction = excluded.default_direction,
                    enabled = excluded.enabled,
                    updated_at = excluded.updated_at
                """,
                (
                    device.id,
                    device.name,
                    device.short_name,
                    device.serial,
                    device.ip,
                    device.port,
                    device.location,
                    device.direction_mode,
                    device.default_direction,
                    int(device.enabled),
                    timestamp,
                ),
            )


def list_devices() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute("SELECT * FROM devices ORDER BY name").fetchall()
        return [row_to_dict(row) for row in rows]


def get_device(device_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM devices WHERE id = ?", (device_id,)).fetchone()
        return row_to_dict(row) if row else None


def create_user(
    device_id: str,
    user_id: str,
    name: str = "",
    privilege: int = 0,
    password: str = "",
    group_id: str = "",
    card: str = "",
) -> None:
    timestamp = now_iso()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO users (device_id, user_id, name, privilege, password, group_id, card, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id, user_id) DO UPDATE SET
                name = excluded.name,
                privilege = excluded.privilege,
                password = excluded.password,
                group_id = excluded.group_id,
                card = excluded.card,
                synced_at = excluded.synced_at
            """,
            (device_id, user_id, name, privilege, password, group_id, card, timestamp),
        )


def delete_user(device_id: str, user_id: str) -> bool:
    with connect() as conn:
        cursor = conn.execute(
            "DELETE FROM users WHERE device_id = ? AND user_id = ?",
            (device_id, user_id),
        )
        return cursor.rowcount > 0


def update_punch_names(user_id: str, new_name: str) -> int:
    """Update the user_name on all historical punch records for a user."""
    with connect() as conn:
        cursor = conn.execute(
            "UPDATE punches SET user_name = ? WHERE user_id = ?",
            (new_name, user_id),
        )
        return cursor.rowcount


def get_daily_attendance(
    from_date: str | None = None,
    to_date: str | None = None,
) -> list[dict[str, Any]]:
    """Return per-day, per-user attendance with first IN and last OUT."""
    clauses: list[str] = []
    params: list[Any] = []
    if from_date:
        clauses.append("date(punch_time) >= ?")
        params.append(from_date)
    if to_date:
        clauses.append("date(punch_time) <= ?")
        params.append(to_date)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    query = f"""
        SELECT
            date(punch_time) AS day,
            user_id,
            user_name,
            MIN(CASE WHEN direction = 'IN' THEN punch_time END) AS first_in,
            MAX(CASE WHEN direction = 'OUT' THEN punch_time END) AS last_out,
            COUNT(*) AS total_punches,
            SUM(CASE WHEN direction = 'IN' THEN 1 ELSE 0 END) AS in_count,
            SUM(CASE WHEN direction = 'OUT' THEN 1 ELSE 0 END) AS out_count
        FROM punches
        {where}
        GROUP BY date(punch_time), user_id
        ORDER BY day DESC, user_name COLLATE NOCASE
    """
    with connect() as conn:
        rows = conn.execute(query, params).fetchall()
        results = []
        for row in rows:
            d = row_to_dict(row)
            # Calculate work hours from first IN to last OUT
            if d["first_in"] and d["last_out"]:
                try:
                    first = datetime.fromisoformat(d["first_in"])
                    last = datetime.fromisoformat(d["last_out"])
                    diff = (last - first).total_seconds() / 3600
                    d["work_hours"] = round(diff, 2)
                except (ValueError, TypeError):
                    d["work_hours"] = None
            else:
                d["work_hours"] = None
            results.append(d)
        return results


def list_users(device_ip: str | None = None) -> list[dict[str, Any]]:
    query = """
        SELECT u.*, d.name AS device_name, d.ip AS device_ip
        FROM users u
        JOIN devices d ON d.id = u.device_id
    """
    params: list[Any] = []
    if device_ip:
        query += " WHERE d.ip = ?"
        params.append(device_ip)
    query += " ORDER BY u.name COLLATE NOCASE, u.user_id"

    with connect() as conn:
        rows = conn.execute(query, params).fetchall()
        return [row_to_dict(row) for row in rows]


def get_detailed_report(
    from_date: str | None = None,
    to_date: str | None = None,
    user_id: str | None = None,
    user_ids: list[str] | None = None,
    summary: bool = False,
) -> list[dict[str, Any]]:
    """Get detailed per-user, per-day attendance report with all IN/OUT punches.
    
    Returns list of dicts with: day, user_id, user_name, device_name, punches (list of timed entries),
    first_in, last_out, work_hours, total_punches, in_count, out_count.
    """
    clauses: list[str] = []
    params: list[Any] = []
    if from_date:
        clauses.append("date(p.punch_time) >= ?")
        params.append(from_date)
    if to_date:
        clauses.append("date(p.punch_time) <= ?")
        params.append(to_date)
    if user_id:
        clauses.append("p.user_id = ?")
        params.append(user_id)
    elif user_ids:
        placeholders = ",".join("?" for _ in user_ids)
        clauses.append(f"p.user_id IN ({placeholders})")
        params.extend(user_ids)
    
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    
    with connect() as conn:
        rows = conn.execute(
            f"""
            SELECT
                date(p.punch_time) AS day,
                p.user_id,
                p.user_name,
                p.punch_time,
                p.direction,
                p.punch_label,
                p.punch_code,
                p.verify_code,
                p.device_name,
                p.device_ip,
                p.id
            FROM punches p
            {where}
            ORDER BY date(p.punch_time) DESC, p.user_name COLLATE NOCASE, p.punch_time ASC
            """,
            params,
        ).fetchall()
        
        # Group by day then user
        from collections import OrderedDict
        grouped = OrderedDict()
        for row in rows:
            d = row_to_dict(row)
            day_key = d["day"]
            user_key = f"{day_key}|{d['user_id']}"
            if user_key not in grouped:
                grouped[user_key] = {
                    "day": day_key,
                    "user_id": d["user_id"],
                    "user_name": d["user_name"],
                    "device_name": d["device_name"],
                    "device_ip": d["device_ip"],
                    "punches": [],
                    "first_in": None,
                    "last_out": None,
                    "in_count": 0,
                    "out_count": 0,
                    "total_punches": 0,
                }
            entry = grouped[user_key]
            entry["punches"].append({
                "time": d["punch_time"],
                "direction": d["direction"],
                "label": d["punch_label"],
                "code": d["punch_code"],
                "verify_code": d["verify_code"],
            })
            if d["direction"] == "IN":
                entry["in_count"] += 1
                if entry["first_in"] is None or d["punch_time"] < entry["first_in"]:
                    entry["first_in"] = d["punch_time"]
            elif d["direction"] == "OUT":
                entry["out_count"] += 1
                if entry["last_out"] is None or d["punch_time"] > entry["last_out"]:
                    entry["last_out"] = d["punch_time"]
            entry["total_punches"] += 1
        
        results = list(grouped.values())
        for entry in results:
            if entry["first_in"] and entry["last_out"]:
                try:
                    first = datetime.fromisoformat(entry["first_in"])
                    last = datetime.fromisoformat(entry["last_out"])
                    diff = (last - first).total_seconds() / 3600
                    entry["work_hours"] = round(diff, 2)
                except (ValueError, TypeError):
                    entry["work_hours"] = None
            else:
                entry["work_hours"] = None
        
        if summary:
            return results
        return results


def list_punches(
    *,
    from_time: str | None = None,
    to_time: str | None = None,
    device_ip: str | None = None,
    user_id: str | None = None,
    direction: str | None = None,
    sort_order: str = "desc",
    limit: int = 500,
) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []

    if from_time:
        clauses.append("punch_time >= ?")
        params.append(from_time)
    if to_time:
        clauses.append("punch_time <= ?")
        params.append(to_time)
    if device_ip:
        clauses.append("device_ip = ?")
        params.append(device_ip)
    if user_id:
        clauses.append("user_id = ?")
        params.append(user_id)
    if direction:
        clauses.append("direction = ?")
        params.append(direction.upper())

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(max(1, min(limit, 100000)))
    order_direction = "ASC" if str(sort_order).lower() == "asc" else "DESC"

    with connect() as conn:
        rows = conn.execute(
            f"""
            SELECT *
            FROM punches
            {where}
            ORDER BY punch_time {order_direction}, id {order_direction}
            LIMIT ?
            """,
            params,
        ).fetchall()
        return [row_to_dict(row) for row in rows]


def get_summary(
    from_time: str | None = None,
    to_time: str | None = None,
    device_ip: str | None = None,
    user_id: str | None = None,
    direction: str | None = None,
) -> dict[str, Any]:
    clauses: list[str] = []
    params: list[Any] = []

    if from_time:
        clauses.append("punch_time >= ?")
        params.append(from_time)
    if to_time:
        clauses.append("punch_time <= ?")
        params.append(to_time)
    if device_ip:
        clauses.append("device_ip = ?")
        params.append(device_ip)
    if user_id:
        clauses.append("user_id = ?")
        params.append(user_id)
    if direction:
        clauses.append("direction = ?")
        params.append(direction.upper())

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with connect() as conn:
        totals = conn.execute(
            f"""
            SELECT
                COUNT(*) AS total_punches,
                COUNT(DISTINCT user_id) AS total_people,
                SUM(CASE WHEN direction = 'IN' THEN 1 ELSE 0 END) AS in_count,
                SUM(CASE WHEN direction = 'OUT' THEN 1 ELSE 0 END) AS out_count
            FROM punches
            {where}
            """,
            params,
        ).fetchone()
        by_device = conn.execute(
            f"""
            SELECT device_name, device_ip, COUNT(*) AS punches
            FROM punches
            {where}
            GROUP BY device_id, device_name, device_ip
            ORDER BY punches DESC
            """,
            params,
        ).fetchall()

    return {
        "total_punches": totals["total_punches"] or 0,
        "total_people": totals["total_people"] or 0,
        "in_count": totals["in_count"] or 0,
        "out_count": totals["out_count"] or 0,
        "by_device": [row_to_dict(row) for row in by_device],
    }


def start_sync_run() -> int:
    with connect() as conn:
        cursor = conn.execute(
            "INSERT INTO sync_runs (started_at, status) VALUES (?, 'running')",
            (now_iso(),),
        )
        return int(cursor.lastrowid)


def finish_sync_run(
    run_id: int,
    *,
    status: str,
    message: str,
    device_count: int,
    user_count: int,
    punch_count: int,
) -> None:
    with connect() as conn:
        conn.execute(
            """
            UPDATE sync_runs
            SET completed_at = ?, status = ?, message = ?, device_count = ?,
                user_count = ?, punch_count = ?
            WHERE id = ?
            """,
            (now_iso(), status, message, device_count, user_count, punch_count, run_id),
        )


def start_zoho_sync_run(*, dry_run: bool = False) -> int:
    with connect() as conn:
        cursor = conn.execute(
            "INSERT INTO zoho_sync_runs (started_at, status, dry_run) VALUES (?, 'running', ?)",
            (now_iso(), int(dry_run)),
        )
        return int(cursor.lastrowid)


def finish_zoho_sync_run(
    run_id: int,
    *,
    status: str,
    message: str,
    requested_count: int,
    sent_count: int,
    skipped_count: int,
    failed_count: int,
) -> None:
    with connect() as conn:
        conn.execute(
            """
            UPDATE zoho_sync_runs
            SET completed_at = ?, status = ?, message = ?, requested_count = ?,
                sent_count = ?, skipped_count = ?, failed_count = ?
            WHERE id = ?
            """,
            (now_iso(), status, message, requested_count, sent_count, skipped_count, failed_count, run_id),
        )


def list_zoho_sync_runs(limit: int = 10) -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM zoho_sync_runs
            ORDER BY started_at DESC, id DESC
            LIMIT ?
            """,
            (max(1, min(int(limit), 100)),),
        ).fetchall()
        return [row_to_dict(row) for row in rows]


def get_zoho_sync_summary() -> dict[str, Any]:
    with connect() as conn:
        totals = conn.execute(
            """
            SELECT
                COUNT(*) AS total_punches,
                SUM(CASE WHEN z.status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
                SUM(CASE WHEN z.status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
                SUM(CASE WHEN z.status = 'skipped' THEN 1 ELSE 0 END) AS skipped_count
            FROM punches p
            LEFT JOIN zoho_punch_sync z ON z.punch_id = p.id
            """
        ).fetchone()
        last_run = conn.execute(
            "SELECT * FROM zoho_sync_runs ORDER BY started_at DESC, id DESC LIMIT 1"
        ).fetchone()
        last_error = conn.execute(
            """
            SELECT
                z.status,
                z.error,
                z.response_text,
                z.updated_at,
                p.user_id,
                p.user_name,
                p.punch_time
            FROM zoho_punch_sync z
            LEFT JOIN punches p ON p.id = z.punch_id
            WHERE z.status IN ('failed', 'skipped') AND (z.error IS NOT NULL OR z.response_text IS NOT NULL)
            ORDER BY z.updated_at DESC
            LIMIT 1
            """
        ).fetchone()

    total = totals["total_punches"] or 0
    sent = totals["sent_count"] or 0
    failed = totals["failed_count"] or 0
    skipped = totals["skipped_count"] or 0
    return {
        "total_punches": total,
        "sent_count": sent,
        "failed_count": failed,
        "skipped_count": skipped,
        "pending_count": max(0, total - sent),
        "last_run": row_to_dict(last_run) if last_run else None,
        "last_error": row_to_dict(last_error) if last_error else None,
    }


def list_zoho_candidate_punches(
    *,
    from_time: str | None = None,
    to_time: str | None = None,
    user_ids: list[str] | None = None,
    limit: int = 200,
    include_failed: bool = True,
) -> list[dict[str, Any]]:
    clauses = ["COALESCE(z.status, '') != 'sent'"]
    params: list[Any] = []

    if not include_failed:
        clauses.append("COALESCE(z.status, '') != 'failed'")
    if from_time:
        clauses.append("p.punch_time >= ?")
        params.append(from_time)
    if to_time:
        clauses.append("p.punch_time <= ?")
        params.append(to_time)
    if user_ids:
        placeholders = ",".join("?" for _ in user_ids)
        clauses.append(f"p.user_id IN ({placeholders})")
        params.extend([str(user_id) for user_id in user_ids])

    params.append(max(1, min(int(limit), 1000)))
    with connect() as conn:
        rows = conn.execute(
            f"""
            SELECT
                p.*,
                z.status AS zoho_status,
                z.attempts AS zoho_attempts,
                z.error AS zoho_error,
                z.sent_at AS zoho_sent_at
            FROM punches p
            LEFT JOIN zoho_punch_sync z ON z.punch_id = p.id
            WHERE {' AND '.join(clauses)}
            ORDER BY p.punch_time ASC, p.id ASC
            LIMIT ?
            """,
            params,
        ).fetchall()
        return [row_to_dict(row) for row in rows]


def record_zoho_punch_status(
    punch_id: int,
    *,
    status: str,
    zoho_employee_id: str | None = None,
    request_payload: str | None = None,
    response_text: str | None = None,
    error: str | None = None,
) -> None:
    timestamp = now_iso()
    sent_at = timestamp if status == "sent" else None
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO zoho_punch_sync (
                punch_id, zoho_employee_id, status, attempts, request_payload,
                response_text, error, sent_at, updated_at
            )
            VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
            ON CONFLICT(punch_id) DO UPDATE SET
                zoho_employee_id = excluded.zoho_employee_id,
                status = excluded.status,
                attempts = zoho_punch_sync.attempts + 1,
                request_payload = excluded.request_payload,
                response_text = excluded.response_text,
                error = excluded.error,
                sent_at = COALESCE(excluded.sent_at, zoho_punch_sync.sent_at),
                updated_at = excluded.updated_at
            """,
            (
                punch_id,
                zoho_employee_id,
                status,
                request_payload,
                response_text,
                error[:1000] if error else None,
                sent_at,
                timestamp,
            ),
        )


def clear_zoho_punch_status(punch_id: int) -> bool:
    with connect() as conn:
        cursor = conn.execute("DELETE FROM zoho_punch_sync WHERE punch_id = ?", (punch_id,))
        return cursor.rowcount > 0


def record_device_success(device: DeviceConfig, actual_serial: str | None = None) -> None:
    timestamp = now_iso()
    with connect() as conn:
        conn.execute(
            """
            UPDATE devices
            SET status = 'online', error = NULL, actual_serial = COALESCE(?, actual_serial),
                last_seen_at = ?, last_sync_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (actual_serial, timestamp, timestamp, timestamp, device.id),
        )


def record_device_error(device: DeviceConfig, error: str) -> None:
    with connect() as conn:
        conn.execute(
            """
            UPDATE devices
            SET status = 'error', error = ?, updated_at = ?
            WHERE id = ?
            """,
            (error[:1000], now_iso(), device.id),
        )


def save_device_payload(
    device: DeviceConfig,
    *,
    actual_serial: str | None,
    users: list[dict[str, Any]],
    punches: list[dict[str, Any]],
) -> dict[str, int]:
    timestamp = now_iso()
    user_count = 0
    punch_count = 0
    user_names = {str(user.get("user_id")): user.get("name") for user in users}

    with connect() as conn:
        for user in users:
            conn.execute(
                """
                INSERT INTO users (
                    device_id, user_id, uid, name, privilege, password, group_id, card, synced_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(device_id, user_id) DO UPDATE SET
                    uid = excluded.uid,
                    name = excluded.name,
                    privilege = excluded.privilege,
                    password = excluded.password,
                    group_id = excluded.group_id,
                    card = excluded.card,
                    synced_at = excluded.synced_at
                """,
                (
                    device.id,
                    str(user.get("user_id")),
                    user.get("uid"),
                    user.get("name"),
                    user.get("privilege"),
                    user.get("password"),
                    user.get("group_id"),
                    user.get("card"),
                    timestamp,
                ),
            )
            user_count += 1

        for punch in punches:
            user_id = str(punch["user_id"])
            cursor = conn.execute(
                """
                INSERT OR IGNORE INTO punches (
                    device_id, device_name, device_ip, device_serial, user_id, user_name, uid,
                    punch_time, punch_code, punch_label, direction, verify_code, raw_status, synced_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    device.id,
                    device.name,
                    device.ip,
                    actual_serial or device.serial,
                    user_id,
                    user_names.get(user_id),
                    punch.get("uid"),
                    punch["punch_time"],
                    punch.get("punch_code"),
                    punch["punch_label"],
                    punch["direction"],
                    punch.get("verify_code"),
                    punch.get("raw_status"),
                    timestamp,
                ),
            )
            punch_count += cursor.rowcount

    record_device_success(device, actual_serial)
    return {"users": user_count, "punches": punch_count}
