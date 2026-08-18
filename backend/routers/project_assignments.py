from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated, Any

import oracledb
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.auth_context import get_request_user_id, require_admin_role
from backend.database import get_db_connection
from backend.database_helper import SqlLoader


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_admin_role)])
_PARTICIPATION_TYPES = {"LEAD", "CONSORTIUM", "SUBCONTRACT"}
_ALLOCATION_TYPES = {"MONTHLY", "WEEKLY"}
_ASSIGNMENT_STATUS_CODES = {"CONFIRMED", "PLANNED"}
_WEEKDAYS = {"MON", "TUE", "WED", "THU", "FRI"}
_MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_MAX_AMOUNT = 999_999_999_999_999_999
MoneyText = Annotated[str, Field(pattern=r"^\d{1,18}$")]

_ASSIGNMENT_COMMON_BIND_NAMES = {
    "projectId",
    "employeeUserId",
    "companyEmployeeId",
    "projectCompanyId",
    "assignmentStartDate",
    "assignmentEndDate",
    "assignmentStatusCode",
    "allocationTypeCode",
    "defaultMm",
    "weeklyDayCodes",
    "monthlyAllocationJson",
    "totalMm",
    "costUnitPrice",
    "salesUnitPrice",
    "totalCostAmount",
    "totalSalesAmount",
    "operatingProfit",
    "note",
    "projectRoleName",
    "primaryDuty",
    "userId",
}
SqlLoader.register_bind_contract(
    "PROJECT_ASSIGNMENT_INSERT",
    _ASSIGNMENT_COMMON_BIND_NAMES | {"displayOrder", "assignmentIdOut"},
)
SqlLoader.register_bind_contract(
    "PROJECT_ASSIGNMENT_UPDATE",
    _ASSIGNMENT_COMMON_BIND_NAMES | {"assignmentId", "versionToken"},
)


class CompanyWriteRequest(BaseModel):
    companyId: int = Field(gt=0)
    participationTypeCode: str = Field(max_length=30)
    shareRate: Decimal = Field(default=Decimal("0"), ge=0, le=100, decimal_places=2)
    note: str = Field(default="", max_length=1000)
    versionToken: str | None = Field(default=None, min_length=1, max_length=40)
    model_config = ConfigDict(extra="forbid")


class CompanyUpdateRequest(CompanyWriteRequest):
    versionToken: str = Field(min_length=1, max_length=40)


class MonthlyAllocation(BaseModel):
    month: str = Field(max_length=7)
    mm: Decimal = Field(ge=0, le=1, decimal_places=2)
    model_config = ConfigDict(extra="forbid")


class AssignmentWriteRequest(BaseModel):
    employeeUserId: int | None = Field(default=None, gt=0)
    companyEmployeeId: int | None = Field(default=None, gt=0)
    projectCompanyId: int = Field(gt=0)
    assignmentStartDate: date
    assignmentEndDate: date
    assignmentStatusCode: str = Field(default="CONFIRMED", pattern=r"^(CONFIRMED|PLANNED)$")
    allocationTypeCode: str = Field(default="MONTHLY", max_length=30)
    defaultMm: Decimal = Field(default=Decimal("1"), ge=0, le=1, decimal_places=2)
    weeklyDayCodes: list[str] = Field(default_factory=list, max_length=5)
    monthlyAllocations: list[MonthlyAllocation] = Field(
        default_factory=list,
        min_length=1,
        max_length=240,
    )
    # Browser JSON numbers cannot preserve all Oracle NUMBER(18) values.
    costUnitPrice: MoneyText = "0"
    salesUnitPrice: MoneyText = "0"
    projectRoleName: str = Field(default="", max_length=100)
    primaryDuty: str = Field(default="", max_length=1000)
    note: str = Field(default="", max_length=2000)
    versionToken: str | None = Field(default=None, min_length=1, max_length=40)
    model_config = ConfigDict(extra="forbid")


class AssignmentUpdateRequest(AssignmentWriteRequest):
    versionToken: str = Field(min_length=1, max_length=40)


class AssignmentReorderRequest(BaseModel):
    assignmentIds: list[Annotated[int, Field(gt=0)]] = Field(min_length=1, max_length=500)
    model_config = ConfigDict(extra="forbid")


class AssignmentBatchCreateRequest(BaseModel):
    assignments: list[AssignmentWriteRequest] = Field(min_length=1, max_length=100)
    model_config = ConfigDict(extra="forbid")


def _is_money_column(column: str | None) -> bool:
    name = str(column or "").upper()
    return (
        name.endswith("_AMOUNT")
        or name.endswith("_AMOUNT_VAT")
        or name.endswith("_UNIT_PRICE")
        or name == "OPERATING_PROFIT"
    )


def _serialize(value: Any, column: str | None = None) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if value is not None and _is_money_column(column):
        if isinstance(value, Decimal):
            return format(value, "f")
        return str(value)
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if hasattr(value, "read"):
        return value.read()
    return value


def _camel_key(value: str) -> str:
    parts = str(value or "").lower().split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _rows(cursor) -> list[dict[str, Any]]:
    columns = [item[0] for item in cursor.description or []]
    result = []
    for row in cursor.fetchall():
        item = {
            _camel_key(column): _serialize(value, column)
            for column, value in zip(columns, row)
        }
        if "monthlyAllocationJson" in item:
            raw_allocations = item.pop("monthlyAllocationJson", None)
            try:
                allocations = json.loads(raw_allocations) if raw_allocations else []
                if not isinstance(allocations, list):
                    raise ValueError("Monthly allocation JSON must be a list.")
                item["monthlyAllocations"] = allocations
                item["allocationDataQualityError"] = False
            except (TypeError, ValueError, json.JSONDecodeError):
                item["monthlyAllocations"] = []
                item["allocationDataQualityError"] = True
        result.append(item)
    return result


def _raise_assignment_read_error(exc: Exception) -> None:
    oracle_code = getattr(exc.args[0], "code", None) if getattr(exc, "args", None) else None
    if oracle_code in {904, 942}:
        raise HTTPException(
            status_code=503,
            detail=(
                "프로젝트 투입 스키마가 설치되지 않았습니다. "
                "database/INIT_SYSTEM_ALT.sql을 적용한 뒤 다시 시도해 주세요."
            ),
        ) from exc
    if "DPY-4005" in str(exc):
        raise HTTPException(
            status_code=503,
            detail="시스템 DB 연결을 확보하지 못했습니다. DB 접속 상태를 확인해 주세요.",
        ) from exc
    raise HTTPException(status_code=500, detail="프로젝트 투입정보를 조회하지 못했습니다.") from exc


def _oracle_error_code(exc: Exception) -> int | str | None:
    if not getattr(exc, "args", None):
        return None
    return getattr(exc.args[0], "code", None)


def _raise_assignment_write_error(exc: Exception, detail: str) -> None:
    oracle_code = _oracle_error_code(exc)
    if oracle_code in {904, 942}:
        raise HTTPException(
            status_code=503,
            detail=(
                "프로젝트 투입 스키마가 설치되지 않았습니다. "
                "database/INIT_SYSTEM_ALT.sql을 적용한 뒤 다시 시도해 주세요."
            ),
        ) from exc
    if "DPY-4005" in str(exc):
        raise HTTPException(
            status_code=503,
            detail="시스템 DB 연결을 확보하지 못했습니다. DB 접속 상태를 확인해 주세요.",
        ) from exc
    raise HTTPException(status_code=500, detail=detail) from exc


def _current_row(cursor) -> dict[str, Any]:
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="대상을 찾을 수 없습니다.")
    columns = [item[0] for item in cursor.description or []]
    return {
        _camel_key(column): _serialize(value, column)
        for column, value in zip(columns, row)
    }


def _company_params(payload: CompanyWriteRequest) -> dict[str, Any]:
    type_code = payload.participationTypeCode.strip().upper()
    if type_code not in _PARTICIPATION_TYPES:
        raise HTTPException(status_code=400, detail="지원하지 않는 참여유형입니다.")
    return {
        "companyId": payload.companyId,
        "participationTypeCode": type_code,
        "shareRate": payload.shareRate,
        "note": payload.note.strip() or None,
    }


def _assignment_params(payload: AssignmentWriteRequest) -> dict[str, Any]:
    if (payload.employeeUserId is None) == (payload.companyEmployeeId is None):
        raise HTTPException(status_code=400, detail="소속회사 임직원을 한 명 선택해 주세요.")
    if payload.assignmentStartDate > payload.assignmentEndDate:
        raise HTTPException(status_code=400, detail="투입 종료일은 시작일보다 빠를 수 없습니다.")
    allocation_type = payload.allocationTypeCode.strip().upper()
    if allocation_type not in _ALLOCATION_TYPES:
        raise HTTPException(status_code=400, detail="지원하지 않는 배분 방식입니다.")
    assignment_status = payload.assignmentStatusCode.strip().upper()
    if assignment_status not in _ASSIGNMENT_STATUS_CODES:
        raise HTTPException(status_code=400, detail="투입 구분은 확정 투입 또는 계획 투입이어야 합니다.")
    weekdays = []
    for value in payload.weeklyDayCodes:
        code = str(value).strip().upper()
        if code not in _WEEKDAYS:
            raise HTTPException(status_code=400, detail="지원하지 않는 투입 요일입니다.")
        if code not in weekdays:
            weekdays.append(code)
    if allocation_type == "WEEKLY" and not weekdays:
        raise HTTPException(status_code=400, detail="주간 배분은 투입 요일을 선택해야 합니다.")

    cost_unit_price = Decimal(payload.costUnitPrice)
    sales_unit_price = Decimal(payload.salesUnitPrice)
    allocations = []
    seen_months = set()
    total_mm = Decimal("0")
    total_cost = 0
    total_sales = 0
    for item in sorted(payload.monthlyAllocations, key=lambda value: value.month):
        if not _MONTH_PATTERN.fullmatch(item.month) or item.month in seen_months:
            raise HTTPException(status_code=400, detail="월별 배분의 연월 값을 확인해 주세요.")
        if not (payload.assignmentStartDate.strftime("%Y-%m") <= item.month <= payload.assignmentEndDate.strftime("%Y-%m")):
            raise HTTPException(status_code=400, detail="월별 배분은 투입기간 안에서만 설정할 수 있습니다.")
        seen_months.add(item.month)
        allocations.append({"month": item.month, "mm": float(item.mm)})
        total_mm += item.mm
        total_cost += int(
            (item.mm * cost_unit_price).quantize(
                Decimal("1"),
                rounding=ROUND_HALF_UP,
            )
        )
        total_sales += int(
            (item.mm * sales_unit_price).quantize(
                Decimal("1"),
                rounding=ROUND_HALF_UP,
            )
        )
    if total_cost > _MAX_AMOUNT or total_sales > _MAX_AMOUNT:
        raise HTTPException(
            status_code=400,
            detail=(
                "투입기간 합계 금액이 저장 가능한 범위를 초과했습니다. "
                "투입기간 또는 월 단가를 조정해 주세요."
            ),
        )
    return {
        "employeeUserId": payload.employeeUserId,
        "companyEmployeeId": payload.companyEmployeeId,
        "projectCompanyId": payload.projectCompanyId,
        "assignmentStartDate": payload.assignmentStartDate,
        "assignmentEndDate": payload.assignmentEndDate,
        "assignmentStatusCode": assignment_status,
        "allocationTypeCode": allocation_type,
        "defaultMm": payload.defaultMm,
        "weeklyDayCodes": ",".join(weekdays) if weekdays else None,
        "monthlyAllocationJson": json.dumps(allocations, ensure_ascii=False, separators=(",", ":")),
        "totalMm": total_mm,
        "costUnitPrice": int(payload.costUnitPrice),
        "salesUnitPrice": int(payload.salesUnitPrice),
        "projectRoleName": payload.projectRoleName.strip() or None,
        "primaryDuty": payload.primaryDuty.strip() or None,
        "totalCostAmount": total_cost,
        "totalSalesAmount": total_sales,
        "operatingProfit": total_sales - total_cost,
        "note": payload.note.strip() or None,
    }


def _ensure_company(cursor, project_id: int, company_id: int | None) -> None:
    if not company_id:
        return
    cursor.execute(
        SqlLoader.get_sql("PROJECT_ASSIGNMENT_COMPANY_BELONGS"),
        {"projectId": project_id, "projectCompanyId": company_id},
    )
    if int(cursor.fetchone()[0] or 0) <= 0:
        raise HTTPException(status_code=400, detail="선택한 참여회사가 프로젝트에 속하지 않습니다.")


def _master_company(cursor, company_id: int) -> dict[str, Any]:
    cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_MASTER_COMPANY"), {"companyId": company_id})
    try:
        return _current_row(cursor)
    except HTTPException as exc:
        raise HTTPException(status_code=400, detail="등록된 사용 가능 회사를 선택해 주세요.") from exc


def _ensure_person(cursor, project_id: int, payload: AssignmentWriteRequest) -> None:
    cursor.execute(
        SqlLoader.get_sql("PROJECT_ASSIGNMENT_PERSON_BELONGS"),
        {
            "projectId": project_id,
            "projectCompanyId": payload.projectCompanyId,
            "employeeUserId": payload.employeeUserId,
            "companyEmployeeId": payload.companyEmployeeId,
        },
    )
    if int(cursor.fetchone()[0] or 0) <= 0:
        raise HTTPException(
            status_code=400,
            detail="선택한 인력의 소속회사와 프로젝트 참여회사가 일치하지 않습니다. 프로젝트 상세에서 해당 소속회사를 참여회사로 등록해 주세요.",
        )


def _ensure_company_share(cursor, project_id: int, company_id: int | None, share_rate: Decimal) -> None:
    cursor.execute(
        SqlLoader.get_sql("PROJECT_ASSIGNMENT_COMPANY_OTHER_SHARE"),
        {"projectId": project_id, "projectCompanyId": company_id},
    )
    if Decimal(str(cursor.fetchone()[0] or 0)) + share_rate > 100:
        raise HTTPException(status_code=400, detail="참여회사 비중 합계는 100%를 초과할 수 없습니다.")


def _lock_project(cursor, project_id: int) -> None:
    cursor.execute(
        SqlLoader.get_sql("PROJECT_ASSIGNMENT_PROJECT_LOCK"),
        {"projectId": project_id},
    )
    if not cursor.fetchone():
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")


def _ensure_version(
    cursor,
    sql: str,
    params: dict[str, Any],
    expected_version: str | None,
    target_label: str,
) -> None:
    if not expected_version:
        raise HTTPException(
            status_code=400,
            detail=f"{target_label}의 버전 정보가 없습니다. 화면을 새로고침해 주세요.",
        )
    cursor.execute(sql, params)
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"{target_label}을(를) 찾을 수 없습니다.")
    if str(row[0]) != expected_version:
        raise HTTPException(
            status_code=409,
            detail=f"다른 사용자가 {target_label}을(를) 변경했습니다. 새로고침 후 다시 시도해 주세요.",
        )


def _ensure_company_change_allowed(cursor, project_id: int, project_company_id: int, company_id: int) -> None:
    cursor.execute(
        SqlLoader.get_sql("PROJECT_ASSIGNMENT_COMPANY_CHANGE_CHECK"),
        {"projectId": project_id, "projectCompanyId": project_company_id},
    )
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="참여회사를 찾을 수 없습니다.")
    current_company_id, assignment_count = row
    company_changed = current_company_id is None or int(current_company_id) != company_id
    if company_changed and int(assignment_count or 0) > 0:
        raise HTTPException(status_code=409, detail="투입인력이 연결된 참여회사는 다른 회사로 변경할 수 없습니다.")


@router.get("/references")
def references():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_REFERENCE_PROJECTS"))
        projects = _rows(cursor)
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_REFERENCE_USERS"))
        workers = _rows(cursor)
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_REFERENCE_COMPANIES"))
        companies = _rows(cursor)
        return {"status": "success", "data": {"projects": projects, "workers": workers, "companies": companies}}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Project assignment references could not be loaded.")
        _raise_assignment_read_error(exc)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("")
def project_assignment_data(projectId: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        _lock_project(cursor, projectId)
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_PROJECT"), {"projectId": projectId})
        project = _current_row(cursor)
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_COMPANY_LIST"), {"projectId": projectId})
        companies = _rows(cursor)
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_LIST"), {"projectId": projectId})
        assignments = _rows(cursor)
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_SUMMARY"), {"projectId": projectId})
        summary = _current_row(cursor)
        return {"status": "success", "data": {"project": project, "companies": companies, "assignments": assignments, "summary": summary}}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Project assignment data could not be loaded. project_id=%s", projectId)
        _raise_assignment_read_error(exc)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/workspace")
def project_assignment_workspace(
    projectYear: Annotated[int, Query(ge=1900, le=2100)],
):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("PROJECT_ASSIGNMENT_WORKSPACE_PROJECTS"),
            {"projectYear": projectYear},
        )
        projects = _rows(cursor)
        cursor.execute(
            SqlLoader.get_sql("PROJECT_ASSIGNMENT_WORKSPACE_ASSIGNMENTS"),
            {"projectYear": projectYear},
        )
        assignments = _rows(cursor)
        cursor.execute(
            SqlLoader.get_sql("PROJECT_ASSIGNMENT_WORKSPACE_COMPANIES"),
            {"projectYear": projectYear},
        )
        companies = _rows(cursor)
        return {
            "status": "success",
            "data": {
                "projectYear": projectYear,
                "projects": projects,
                "assignments": assignments,
                "companies": companies,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "Project assignment workspace could not be loaded. project_year=%s",
            projectYear,
        )
        _raise_assignment_read_error(exc)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/{project_id}/companies")
def create_company(project_id: int, payload: CompanyWriteRequest, request: Request):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        _lock_project(cursor, project_id)
        _ensure_company_share(cursor, project_id, None, payload.shareRate)
        master_company = _master_company(cursor, payload.companyId)
        output = cursor.var(oracledb.DB_TYPE_NUMBER)
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_COMPANY_INSERT"), {**_company_params(payload), "companyName": master_company["companyName"], "projectId": project_id, "userId": get_request_user_id(request), "projectCompanyIdOut": output})
        conn.commit()
        value = output.getvalue()
        return {"status": "success", "data": {"projectCompanyId": int(value[0] if isinstance(value, list) else value)}}
    except Exception as exc:
        if conn:
            conn.rollback()
        if isinstance(exc, HTTPException):
            raise
        logger.exception("Project company creation failed.")
        if _oracle_error_code(exc) == 1:
            raise HTTPException(status_code=409, detail="이미 등록된 참여회사입니다.") from exc
        _raise_assignment_write_error(exc, "참여회사를 저장하지 못했습니다.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.put("/{project_id}/companies/{company_id}")
def update_company(project_id: int, company_id: int, payload: CompanyUpdateRequest, request: Request):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        _lock_project(cursor, project_id)
        _ensure_version(
            cursor,
            SqlLoader.get_sql("PROJECT_ASSIGNMENT_COMPANY_VERSION"),
            {"projectId": project_id, "projectCompanyId": company_id},
            payload.versionToken,
            "참여회사",
        )
        _ensure_company_share(cursor, project_id, company_id, payload.shareRate)
        _ensure_company_change_allowed(cursor, project_id, company_id, payload.companyId)
        master_company = _master_company(cursor, payload.companyId)
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_COMPANY_UPDATE"), {**_company_params(payload), "companyName": master_company["companyName"], "projectId": project_id, "projectCompanyId": company_id, "userId": get_request_user_id(request), "versionToken": payload.versionToken})
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=409, detail="다른 사용자가 참여회사를 변경했습니다. 새로고침 후 다시 시도해 주세요.")
        conn.commit()
        return {"status": "success"}
    except Exception as exc:
        if conn:
            conn.rollback()
        if isinstance(exc, HTTPException):
            raise
        logger.exception("Project company update failed.")
        if _oracle_error_code(exc) == 1:
            raise HTTPException(status_code=409, detail="이미 등록된 참여회사입니다.") from exc
        _raise_assignment_write_error(exc, "참여회사를 저장하지 못했습니다.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.delete("/{project_id}/companies/{company_id}")
def delete_company(
    project_id: int,
    company_id: int,
    versionToken: Annotated[str, Query(min_length=1, max_length=40)],
):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        _lock_project(cursor, project_id)
        _ensure_version(
            cursor,
            SqlLoader.get_sql("PROJECT_ASSIGNMENT_COMPANY_VERSION"),
            {"projectId": project_id, "projectCompanyId": company_id},
            versionToken,
            "참여회사",
        )
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_COMPANY_DELETE"), {"projectId": project_id, "projectCompanyId": company_id, "versionToken": versionToken})
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=409, detail="다른 사용자가 참여회사를 변경했습니다. 새로고침 후 다시 시도해 주세요.")
        conn.commit()
        return {"status": "success"}
    except Exception as exc:
        if conn:
            conn.rollback()
        if isinstance(exc, HTTPException):
            raise
        logger.exception("Project company deletion failed.")
        if _oracle_error_code(exc) == 2292:
            raise HTTPException(status_code=409, detail="투입인력이 연결된 참여회사는 삭제할 수 없습니다.") from exc
        _raise_assignment_write_error(exc, "참여회사를 삭제하지 못했습니다.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def _save_assignment(project_id: int, assignment_id: int | None, payload: AssignmentWriteRequest, request: Request):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        params = _assignment_params(payload)
        _lock_project(cursor, project_id)
        if assignment_id is not None:
            _ensure_version(
                cursor,
                SqlLoader.get_sql("PROJECT_ASSIGNMENT_VERSION"),
                {"projectId": project_id, "assignmentId": assignment_id},
                payload.versionToken,
                "투입정보",
            )
        _ensure_company(cursor, project_id, payload.projectCompanyId)
        _ensure_person(cursor, project_id, payload)
        common = {**params, "projectId": project_id, "userId": get_request_user_id(request)}
        if assignment_id is not None:
            cursor.setinputsizes(monthlyAllocationJson=oracledb.DB_TYPE_CLOB)
            cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_UPDATE"), {**common, "assignmentId": assignment_id, "versionToken": payload.versionToken})
            if cursor.rowcount <= 0:
                raise HTTPException(status_code=409, detail="다른 사용자가 투입정보를 변경했습니다. 새로고침 후 다시 시도해 주세요.")
        else:
            cursor.execute(
                SqlLoader.get_sql("PROJECT_ASSIGNMENT_NEXT_DISPLAY_ORDER"),
                {"projectId": project_id},
            )
            display_order = int(cursor.fetchone()[0])
            output = cursor.var(oracledb.DB_TYPE_NUMBER)
            cursor.setinputsizes(monthlyAllocationJson=oracledb.DB_TYPE_CLOB)
            cursor.execute(
                SqlLoader.get_sql("PROJECT_ASSIGNMENT_INSERT"),
                {**common, "displayOrder": display_order, "assignmentIdOut": output},
            )
            value = output.getvalue()
            assignment_id = int(value[0] if isinstance(value, list) else value)
        conn.commit()
        return {"status": "success", "data": {"assignmentId": assignment_id}}
    except Exception as exc:
        if conn:
            conn.rollback()
        if isinstance(exc, HTTPException):
            raise
        logger.exception("Project assignment save failed.")
        _raise_assignment_write_error(exc, "투입인력 정보를 저장하지 못했습니다.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/{project_id}/assignments")
def create_assignment(project_id: int, payload: AssignmentWriteRequest, request: Request):
    return _save_assignment(project_id, None, payload, request)


@router.post("/{project_id}/assignments/batch")
def create_assignments_batch(
    project_id: Annotated[int, Path(gt=0)],
    payload: AssignmentBatchCreateRequest,
    request: Request,
):
    conn = None
    cursor = None
    insert_cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        insert_cursor = conn.cursor()
        insert_cursor.setinputsizes(monthlyAllocationJson=oracledb.DB_TYPE_CLOB)
        _lock_project(cursor, project_id)
        cursor.execute(
            SqlLoader.get_sql("PROJECT_ASSIGNMENT_NEXT_DISPLAY_ORDER"),
            {"projectId": project_id},
        )
        display_order = int(cursor.fetchone()[0])
        user_id = get_request_user_id(request)
        assignment_ids = []
        for index, assignment in enumerate(payload.assignments):
            params = _assignment_params(assignment)
            _ensure_company(cursor, project_id, assignment.projectCompanyId)
            _ensure_person(cursor, project_id, assignment)
            output = insert_cursor.var(oracledb.DB_TYPE_NUMBER)
            insert_cursor.execute(
                SqlLoader.get_sql("PROJECT_ASSIGNMENT_INSERT"),
                {
                    **params,
                    "projectId": project_id,
                    "userId": user_id,
                    "displayOrder": display_order + (index * 10),
                    "assignmentIdOut": output,
                },
            )
            value = output.getvalue()
            assignment_ids.append(int(value[0] if isinstance(value, list) else value))
        conn.commit()
        return {"status": "success", "data": {"assignmentIds": assignment_ids}}
    except Exception as exc:
        if conn:
            conn.rollback()
        if isinstance(exc, HTTPException):
            raise
        logger.exception("Project assignment batch save failed.")
        _raise_assignment_write_error(exc, "투입인력 일괄 저장에 실패했습니다.")
    finally:
        if insert_cursor:
            insert_cursor.close()
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.put("/{project_id}/assignments/reorder")
def reorder_assignments(
    project_id: Annotated[int, Path(gt=0)],
    payload: AssignmentReorderRequest,
    request: Request,
):
    if len(payload.assignmentIds) != len(set(payload.assignmentIds)):
        raise HTTPException(status_code=400, detail="배치 순서에 중복된 투입정보가 있습니다.")
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        _lock_project(cursor, project_id)
        cursor.execute(
            SqlLoader.get_sql("PROJECT_ASSIGNMENT_COUNT"),
            {"projectId": project_id},
        )
        if int(cursor.fetchone()[0]) != len(payload.assignmentIds):
            raise HTTPException(status_code=409, detail="배치 목록이 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
        sql = SqlLoader.get_sql("PROJECT_ASSIGNMENT_REORDER")
        user_id = get_request_user_id(request)
        for index, assignment_id in enumerate(payload.assignmentIds, start=1):
            cursor.execute(
                sql,
                {
                    "projectId": project_id,
                    "assignmentId": assignment_id,
                    "displayOrder": index * 10,
                    "userId": user_id,
                },
            )
            if cursor.rowcount != 1:
                raise HTTPException(status_code=409, detail="배치 목록이 변경되었습니다. 새로고침 후 다시 시도해 주세요.")
        conn.commit()
        return {"status": "success", "data": {"assignmentIds": payload.assignmentIds}}
    except Exception as exc:
        if conn:
            conn.rollback()
        if isinstance(exc, HTTPException):
            raise
        logger.exception("Project assignment reorder failed.")
        _raise_assignment_write_error(exc, "투입인력 배치 순서를 저장하지 못했습니다.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.put("/{project_id}/assignments/{assignment_id}")
def update_assignment(
    project_id: int,
    assignment_id: Annotated[int, Path(gt=0)],
    payload: AssignmentUpdateRequest,
    request: Request,
):
    return _save_assignment(project_id, assignment_id, payload, request)


@router.delete("/{project_id}/assignments/{assignment_id}")
def delete_assignment(
    project_id: int,
    assignment_id: Annotated[int, Path(gt=0)],
    versionToken: Annotated[str, Query(min_length=1, max_length=40)],
):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        _lock_project(cursor, project_id)
        _ensure_version(
            cursor,
            SqlLoader.get_sql("PROJECT_ASSIGNMENT_VERSION"),
            {"projectId": project_id, "assignmentId": assignment_id},
            versionToken,
            "투입정보",
        )
        cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_DELETE"), {"projectId": project_id, "assignmentId": assignment_id, "versionToken": versionToken})
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=409, detail="다른 사용자가 투입정보를 변경했습니다. 새로고침 후 다시 시도해 주세요.")
        conn.commit()
        return {"status": "success"}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception(
            "Project assignment deletion failed. project_id=%s assignment_id=%s",
            project_id,
            assignment_id,
        )
        _raise_assignment_write_error(exc, "투입인력 정보를 삭제하지 못했습니다.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
