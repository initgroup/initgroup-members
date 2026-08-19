from __future__ import annotations

from collections.abc import Mapping

from fastapi import HTTPException


SCHEMA_ERROR_CODES = frozenset({904, 942})
UNAVAILABLE_ERROR_CODES = frozenset(
    {
        28,
        1012,
        1033,
        1034,
        1089,
        1090,
        2396,
        3113,
        3114,
        3135,
        12170,
        12514,
        12537,
        12541,
        12545,
        12547,
    }
)
UNAVAILABLE_DRIVER_CODES = frozenset(
    {
        "DPY-4005",
        "DPY-4011",
        "DPY-6000",
        "DPY-6001",
        "DPY-6005",
    }
)


def _error_detail(exc: BaseException):
    return exc.args[0] if getattr(exc, "args", None) else None


def oracle_error_code(exc: BaseException) -> int | None:
    code = getattr(_error_detail(exc), "code", None)
    try:
        normalized = abs(int(code))
    except (TypeError, ValueError):
        return None
    return normalized or None


def oracle_driver_code(exc: BaseException) -> str:
    detail = _error_detail(exc)
    full_code = str(getattr(detail, "full_code", "") or "").strip().upper()
    if full_code:
        return full_code
    message = str(exc).upper()
    for code in UNAVAILABLE_DRIVER_CODES:
        if code in message:
            return code
    return ""


def database_error_status(
    exc: BaseException,
    *,
    conflict_codes: set[int] | frozenset[int] = frozenset(),
) -> int:
    code = oracle_error_code(exc)
    if code in conflict_codes:
        return 409
    if code in SCHEMA_ERROR_CODES or code in UNAVAILABLE_ERROR_CODES:
        return 503
    if oracle_driver_code(exc) in UNAVAILABLE_DRIVER_CODES:
        return 503
    return 500


def raise_database_http_error(
    exc: BaseException,
    *,
    default_detail: str,
    conflict_details: Mapping[int, str] | None = None,
    schema_detail: str = "데이터베이스 스키마가 설치되지 않았습니다. 관리자에게 문의해 주세요.",
    unavailable_detail: str = "데이터베이스 연결을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
) -> None:
    conflicts = dict(conflict_details or {})
    status_code = database_error_status(exc, conflict_codes=frozenset(conflicts))
    code = oracle_error_code(exc)
    if status_code == 409:
        detail = conflicts[code]
    elif status_code == 503 and code in SCHEMA_ERROR_CODES:
        detail = schema_detail
    elif status_code == 503:
        detail = unavailable_detail
    else:
        detail = default_detail
    raise HTTPException(status_code=status_code, detail=detail) from exc
