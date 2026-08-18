from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import oracledb
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.auth_context import get_request_user_id, require_admin_role
from backend.database import get_db_connection
from backend.database_helper import SqlLoader


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_admin_role)])

_PARTICIPATION_TYPES = {"LEAD", "CONSORTIUM", "SUBCONTRACT"}
_PROJECT_STATUSES = {
    "PLANNED",
    "BIDDING",
    "CONTRACTED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
}
_SORT_FIELDS = {
    "projectName",
    "customerName",
    "projectStartDate",
    "orderAmountVat",
    "contractAmountVat",
    "participationTypeCode",
    "participationRate",
    "orderDate",
    "bidDate",
    "statusCode",
}
_MAX_AMOUNT = 999_999_999_999_999_999
_MONEY_COLUMNS = {"ORDER_AMOUNT_VAT", "CONTRACT_AMOUNT_VAT"}


class ProjectWriteRequest(BaseModel):
    projectYear: int = Field(ge=1900, le=2100)
    projectName: str = Field(max_length=300)
    customerName: str = Field(max_length=200)
    projectStartDate: date
    projectEndDate: date
    orderAmountVat: int = Field(default=0, ge=0, le=_MAX_AMOUNT)
    contractAmountVat: int = Field(default=0, ge=0, le=_MAX_AMOUNT)
    participationTypeCode: str = Field(max_length=30)
    participationRate: Decimal = Field(default=Decimal("100"), ge=0, le=100, decimal_places=2)
    orderDate: date | None = None
    bidDate: date | None = None
    statusCode: str = Field(default="PLANNED", max_length=30)
    description: str = Field(default="", max_length=2000)
    model_config = ConfigDict(extra="forbid")


def _serialize(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        if value == value.to_integral_value():
            return int(value)
        return float(value)
    return value


def _camel_key(value: str) -> str:
    parts = str(value or "").lower().split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _row_dict(cursor, row) -> dict[str, Any]:
    columns = [description[0] for description in cursor.description or []]
    return {
        _camel_key(column): (
            str(value) if column in _MONEY_COLUMNS and value is not None else _serialize(value)
        )
        for column, value in zip(columns, row)
    }


def _choice(value: str, allowed: set[str], field_name: str, *, allow_all: bool = False) -> str:
    normalized = str(value or "").strip().upper()
    accepted = allowed | ({"ALL"} if allow_all else set())
    if normalized not in accepted:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 {field_name} 값입니다.")
    return normalized


def _like_pattern(value: str) -> str | None:
    normalized = str(value or "").strip().upper()
    if not normalized:
        return None
    escaped = normalized.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _project_params(payload: ProjectWriteRequest, user_id: int) -> dict[str, Any]:
    project_name = payload.projectName.strip()
    customer_name = payload.customerName.strip()
    if not project_name:
        raise HTTPException(status_code=400, detail="프로젝트명을 입력해 주세요.")
    if not customer_name:
        raise HTTPException(status_code=400, detail="발주처를 입력해 주세요.")
    if payload.projectStartDate > payload.projectEndDate:
        raise HTTPException(
            status_code=400,
            detail="프로젝트 종료일은 시작일보다 빠를 수 없습니다.",
        )

    return {
        "projectYear": payload.projectYear,
        "projectName": project_name,
        "customerName": customer_name,
        "projectStartDate": payload.projectStartDate,
        "projectEndDate": payload.projectEndDate,
        "orderAmountVat": payload.orderAmountVat,
        "contractAmountVat": payload.contractAmountVat,
        "participationTypeCode": _choice(
            payload.participationTypeCode,
            _PARTICIPATION_TYPES,
            "참여유형",
        ),
        "participationRate": payload.participationRate,
        "orderDate": payload.orderDate,
        "bidDate": payload.bidDate,
        "statusCode": _choice(payload.statusCode, _PROJECT_STATUSES, "진행상태"),
        "description": payload.description.strip() or None,
        "userId": user_id,
    }


def _fetch_project(cursor, project_id: int) -> dict[str, Any]:
    cursor.execute(
        SqlLoader.get_sql("ADMIN_PROJECT_DETAIL"),
        {"projectId": project_id},
    )
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    return _row_dict(cursor, row)


@router.get("")
def list_projects(
    periodYear: int | None = Query(None, ge=1900, le=2100),
    periodYearFrom: int | None = Query(None, ge=1900, le=2100),
    periodYearTo: int | None = Query(None, ge=1900, le=2100),
    keyword: str = Query("", max_length=300),
    statusCode: str = Query("ALL", max_length=30),
    participationTypeCode: str = Query("ALL", max_length=30),
    periodStart: date | None = Query(None),
    periodEnd: date | None = Query(None),
    bidDateFrom: date | None = Query(None),
    bidDateTo: date | None = Query(None),
    contractAmountMin: int | None = Query(None, ge=0, le=_MAX_AMOUNT),
    contractAmountMax: int | None = Query(None, ge=0, le=_MAX_AMOUNT),
    page: int = Query(1, ge=1, le=100_000),
    pageSize: int = Query(100, ge=10, le=100),
    sortBy: str = Query("projectStartDate", max_length=40),
    sortDirection: str = Query("desc", max_length=4),
):
    if periodYearFrom and periodYearTo and periodYearFrom > periodYearTo:
        raise HTTPException(status_code=400, detail="프로젝트 수행연도 범위를 확인해 주세요.")
    if periodStart and periodEnd and periodStart > periodEnd:
        raise HTTPException(status_code=400, detail="조회 종료일은 시작일보다 빠를 수 없습니다.")
    if bidDateFrom and bidDateTo and bidDateFrom > bidDateTo:
        raise HTTPException(status_code=400, detail="입찰일 종료 범위를 확인해 주세요.")
    if (
        contractAmountMin is not None
        and contractAmountMax is not None
        and contractAmountMin > contractAmountMax
    ):
        raise HTTPException(status_code=400, detail="수주금액 범위를 확인해 주세요.")
    if sortBy not in _SORT_FIELDS:
        raise HTTPException(status_code=400, detail="지원하지 않는 정렬 항목입니다.")
    normalized_direction = str(sortDirection or "").strip().lower()
    if normalized_direction not in {"asc", "desc"}:
        raise HTTPException(status_code=400, detail="정렬 방향은 asc 또는 desc여야 합니다.")

    filters = {
        "periodYear": periodYear,
        "periodYearFrom": periodYearFrom,
        "periodYearTo": periodYearTo,
        "keyword": _like_pattern(keyword),
        "statusCode": _choice(statusCode, _PROJECT_STATUSES, "진행상태", allow_all=True),
        "participationTypeCode": _choice(
            participationTypeCode,
            _PARTICIPATION_TYPES,
            "참여유형",
            allow_all=True,
        ),
        "periodStart": periodStart,
        "periodEnd": periodEnd,
        "bidDateFrom": bidDateFrom,
        "bidDateTo": bidDateTo,
        "contractAmountMin": contractAmountMin,
        "contractAmountMax": contractAmountMax,
    }

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("ADMIN_PROJECT_COUNT"), filters)
        total = int(cursor.fetchone()[0] or 0)
        cursor.execute(
            SqlLoader.get_sql("ADMIN_PROJECT_LIST"),
            {
                **filters,
                "sortBy": sortBy,
                "sortDirection": normalized_direction,
                "offset": (page - 1) * pageSize,
                "pageSize": pageSize,
            },
        )
        items = [_row_dict(cursor, row) for row in cursor.fetchall()]
        total_pages = max(1, (total + pageSize - 1) // pageSize)
        return {
            "status": "success",
            "data": {
                "items": items,
                "page": page,
                "pageSize": pageSize,
                "total": total,
                "totalPages": total_pages,
                "sortBy": sortBy,
                "sortDirection": normalized_direction,
            },
            "total": total,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Project list query failed.")
        raise HTTPException(status_code=500, detail="프로젝트 목록을 조회하지 못했습니다.") from exc
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/{project_id}")
def get_project(project_id: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        return {"status": "success", "data": _fetch_project(cursor, project_id)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Project detail query failed. project_id=%s", project_id)
        raise HTTPException(status_code=500, detail="프로젝트 상세를 조회하지 못했습니다.") from exc
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("")
def create_project(payload: ProjectWriteRequest, request: Request):
    user_id = get_request_user_id(request)
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        project_id_var = cursor.var(oracledb.DB_TYPE_NUMBER)
        cursor.execute(
            SqlLoader.get_sql("ADMIN_PROJECT_INSERT"),
            {
                **_project_params(payload, user_id),
                "projectIdOut": project_id_var,
            },
        )
        value = project_id_var.getvalue()
        project_id = int(value[0] if isinstance(value, list) else value)
        project = _fetch_project(cursor, project_id)
        conn.commit()
        return {"status": "success", "data": project}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Project creation failed.")
        raise HTTPException(status_code=500, detail="프로젝트를 저장하지 못했습니다.") from exc
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.put("/{project_id}")
def update_project(project_id: int, payload: ProjectWriteRequest, request: Request):
    user_id = get_request_user_id(request)
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("ADMIN_PROJECT_UPDATE"),
            {
                **_project_params(payload, user_id),
                "projectId": project_id,
            },
        )
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
        project = _fetch_project(cursor, project_id)
        conn.commit()
        return {"status": "success", "data": project}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Project update failed. project_id=%s", project_id)
        raise HTTPException(status_code=500, detail="프로젝트를 저장하지 못했습니다.") from exc
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.delete("/{project_id}")
def delete_project(project_id: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("ADMIN_PROJECT_DELETE"),
            {"projectId": project_id},
        )
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
        conn.commit()
        return {
            "status": "success",
            "message": "Project deleted.",
            "data": {"projectId": project_id},
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Project deletion failed. project_id=%s", project_id)
        oracle_code = (
            getattr(exc.args[0], "code", None)
            if getattr(exc, "args", None)
            else None
        )
        if oracle_code == 2292:
            raise HTTPException(
                status_code=409,
                detail=(
                    "계획안·참여회사·투입인력에서 사용 중인 프로젝트는 삭제할 수 없습니다. "
                    "연결된 업무정보를 먼저 확인해 주세요."
                ),
            ) from exc
        raise HTTPException(status_code=500, detail="프로젝트를 삭제하지 못했습니다.") from exc
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
