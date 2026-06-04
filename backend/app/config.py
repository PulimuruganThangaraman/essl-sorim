from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_DEVICE_CONFIG = ROOT_DIR / "devices.json"


@dataclass(frozen=True)
class DeviceConfig:
    name: str
    short_name: str
    serial: str
    ip: str
    port: int = 4370
    location: str = ""
    direction_mode: str = "device"
    default_direction: str = "IN"
    password: int = 0
    timeout_seconds: int = 30
    enabled: bool = True

    @property
    def id(self) -> str:
        return self.serial.strip() or self.ip


def _as_int(value: Any, fallback: int) -> int:
    if value in (None, ""):
        return fallback
    return int(value)


def load_devices() -> list[DeviceConfig]:
    config_path = Path(os.getenv("DEVICE_CONFIG_FILE", str(DEFAULT_DEVICE_CONFIG)))
    if not config_path.exists():
        return []

    raw_devices = json.loads(config_path.read_text(encoding="utf-8"))
    devices: list[DeviceConfig] = []

    for raw in raw_devices:
        if not raw.get("ip"):
            continue
        name = raw.get("name") or raw.get("short_name") or raw["ip"]
        devices.append(
            DeviceConfig(
                name=name,
                short_name=raw.get("short_name") or name,
                serial=raw.get("serial") or "",
                ip=raw["ip"],
                port=_as_int(raw.get("port"), 4370),
                location=raw.get("location") or "",
                direction_mode=(raw.get("direction_mode") or "device").lower(),
                default_direction=(raw.get("default_direction") or "IN").upper(),
                password=_as_int(raw.get("password"), 0),
                timeout_seconds=_as_int(raw.get("timeout_seconds"), 30),
                enabled=bool(raw.get("enabled", True)),
            )
        )

    return devices
