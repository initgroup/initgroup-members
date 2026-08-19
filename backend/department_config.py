from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


_CONFIG_PATH = Path(__file__).resolve().parent.parent / "frontend" / "config" / "departments.json"


@lru_cache(maxsize=1)
def departments() -> tuple[dict[str, Any], ...]:
    payload = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    items = payload.get("departments")
    if not isinstance(items, list) or not items:
        raise RuntimeError("Department config must contain a non-empty departments list.")
    normalized: list[dict[str, Any]] = []
    codes: set[str] = set()
    labels: set[str] = set()
    orders: set[int] = set()
    for item in items:
        code = str(item.get("code") or "").strip().upper()
        label = str(item.get("label") or "").strip()
        display_order = int(item.get("displayOrder"))
        if not code or not label:
            raise RuntimeError("Department code and label are required.")
        if code in codes or label in labels or display_order in orders:
            raise RuntimeError("Department code, label, and displayOrder must be unique.")
        codes.add(code)
        labels.add(label)
        orders.add(display_order)
        normalized.append({"code": code, "label": label, "displayOrder": display_order})
    return tuple(sorted(normalized, key=lambda item: (item["displayOrder"], item["label"])))


def department_by_code(value: str | None) -> dict[str, Any] | None:
    code = str(value or "").strip().upper()
    return next((item for item in departments() if item["code"] == code), None)


def department_by_label(value: str | None) -> dict[str, Any] | None:
    label = str(value or "").strip()
    return next((item for item in departments() if item["label"] == label), None)


def resolve_department(code: str | None, legacy_label: str | None = None) -> dict[str, Any] | None:
    if not code and not legacy_label:
        return None
    item = department_by_code(code) or department_by_label(legacy_label) or department_by_code(legacy_label)
    if not item:
        raise ValueError("Unsupported departmentCode.")
    return item


def enrich_department(row: dict[str, Any], *, allow_legacy_label: bool = False) -> dict[str, Any]:
    item = department_by_code(row.get("departmentCode"))
    if not item and allow_legacy_label:
        item = department_by_label(row.get("departmentName"))
    if not item:
        return row
    return {
        **row,
        "departmentCode": item["code"],
        "departmentName": item["label"],
        "departmentDisplayOrder": item["displayOrder"],
    }
