from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

import oracledb
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.auth_context import get_request_user_id, require_admin_role
from backend.database import get_db_connection
from backend.database_errors import oracle_error_code, raise_database_http_error
from backend.database_helper import SqlLoader


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_admin_role)])

_BID_DECISION_CODES = {"REVIEW", "PARTICIPATE", "HOLD", "SKIP"}
_MAX_AMOUNT = 999_999_999_999_999_999
_MAX_DISCOUNT_RATE = Decimal("99999.9999")
_MAX_PLAN_ASSIGNMENTS = 5_000
_MAX_PLAN_MONTH_ROWS = 60_000
_MONEY_ROUNDING = Decimal("1")
_MONEY_PATTERN = r"^\d{1,18}$"
_MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


class _ScenarioReadConflict(RuntimeError):
    pass


class PlanningMonthRequest(BaseModel):
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    mm: Decimal = Field(ge=0, le=1, decimal_places=2)
    model_config = ConfigDict(extra="forbid")


class PlanningAssignmentRequest(BaseModel):
    employeeUserId: int | None = Field(default=None, gt=0)
    companyEmployeeId: int | None = Field(default=None, gt=0)
    assignmentStartDate: date
    assignmentEndDate: date
    costUnitPrice: str = Field(default="0", pattern=_MONEY_PATTERN)
    salesUnitPrice: str = Field(default="0", pattern=_MONEY_PATTERN)
    projectRoleName: str = Field(default="", max_length=100)
    primaryDuty: str = Field(default="", max_length=1000)
    monthlyAllocations: list[PlanningMonthRequest] = Field(
        default_factory=list,
        min_length=1,
        max_length=240,
    )
    note: str = Field(default="", max_length=2000)
    model_config = ConfigDict(extra="forbid", coerce_numbers_to_str=True)


class PlanningProjectRequest(BaseModel):
    projectId: int = Field(gt=0)
    bidDecisionCode: str = Field(default="REVIEW", max_length=30)
    winProbability: Decimal = Field(default=0, ge=0, le=100, decimal_places=2)
    plannedStartDate: date
    plannedEndDate: date
    announcementAmount: str = Field(default="0", pattern=_MONEY_PATTERN)
    bidAmount: str = Field(default="0", pattern=_MONEY_PATTERN)
    expectedContractAmount: str = Field(default="0", pattern=_MONEY_PATTERN)
    targetHeadcount: int = Field(default=0, ge=0, le=10000)
    note: str = Field(default="", max_length=2000)
    assignments: list[PlanningAssignmentRequest] = Field(
        default_factory=list,
        max_length=1000,
    )
    model_config = ConfigDict(extra="forbid", coerce_numbers_to_str=True)


class PlanningScenarioCreateRequest(BaseModel):
    planYear: int = Field(ge=1900, le=2100)
    scenarioName: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    model_config = ConfigDict(extra="forbid")


class PlanningScenarioSaveRequest(BaseModel):
    revisionNo: int = Field(ge=1)
    scenarioName: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    projects: list[PlanningProjectRequest] = Field(
        default_factory=list,
        max_length=300,
    )
    model_config = ConfigDict(extra="forbid")


class PlanningScenarioConfirmRequest(BaseModel):
    revisionNo: int = Field(ge=1)
    acknowledgeWarnings: bool = False
    warningSignature: str | None = Field(
        default=None,
        pattern=r"^[0-9a-f]{64}$",
    )
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
    return [
        {
            _camel_key(column): _serialize(value, column)
            for column, value in zip(columns, row)
        }
        for row in cursor.fetchall()
    ]


def _row(cursor) -> dict[str, Any] | None:
    columns = [item[0] for item in cursor.description or []]
    value = cursor.fetchone()
    if not value:
        return None
    return {
        _camel_key(column): _serialize(item, column)
        for column, item in zip(columns, value)
    }


def _output_number(variable) -> int:
    value = variable.getvalue()
    if isinstance(value, list):
        value = value[0] if value else None
    if value is None:
        raise RuntimeError("Oracle RETURNING did not provide an identity value.")
    return int(value)


def _raise_service_error(exc: Exception) -> None:
    raise_database_http_error(
        exc,
        default_detail="연간 투입계획을 처리하지 못했습니다.",
        schema_detail=(
            "연간 투입계획 스키마가 설치되지 않았습니다. "
            "database/INIT_SYSTEM_ALT.sql을 시스템 DB에 적용해 주세요."
        ),
    )


def _month_date(value: str) -> date:
    return datetime.strptime(f"{value}-01", "%Y-%m-%d").date()


def _money(value: Decimal) -> int:
    return int(value.quantize(_MONEY_ROUNDING, rounding=ROUND_HALF_UP))


def _worker_key(employee_user_id: int | None, company_employee_id: int | None) -> str:
    if employee_user_id is not None:
        return f"USER:{employee_user_id}"
    return f"COMPANY_EMPLOYEE:{company_employee_id}"


def _warning_signature(warnings: list[dict[str, Any]]) -> str:
    normalized = [
        {
            key: value
            for key, value in sorted(warning.items())
            if key != "message"
        }
        for warning in warnings
    ]
    normalized.sort(
        key=lambda warning: json.dumps(
            warning,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    )
    canonical = json.dumps(
        normalized,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _actual_data_quality_warning(
    assignment_id: int,
    worker_key: str,
    employee_name: str,
    reason_code: str,
) -> dict[str, Any]:
    reason_labels = {
        "MISSING_ALLOCATION_JSON": "월별 배분 데이터가 없습니다",
        "INVALID_JSON": "월별 배분 JSON을 해석할 수 없습니다",
        "INVALID_SHAPE": "월별 배분 목록 구조가 올바르지 않습니다",
        "INVALID_MONTH": "월별 배분의 연월 값이 올바르지 않습니다",
        "DUPLICATE_MONTH": "같은 연월이 중복되어 있습니다",
        "INVALID_MM": "월별 M/M 값이 올바르지 않습니다",
    }
    reason = reason_labels.get(reason_code, "월별 배분 데이터가 올바르지 않습니다")
    return {
        "type": "DATA_QUALITY",
        "source": "ACTUAL_ASSIGNMENT",
        "assignmentId": assignment_id,
        "workerKey": worker_key,
        "employeeName": employee_name,
        "reasonCode": reason_code,
        "message": (
            f"{employee_name}님의 실제 투입 #{assignment_id}: {reason}. "
            "프로젝트 투입 메뉴에서 데이터를 수정해 주세요."
        ),
    }


def _actual_capacity(
    cursor,
    plan_year: int,
) -> tuple[
    dict[tuple[str, str], Decimal],
    dict[str, str],
    list[dict[str, Any]],
]:
    cursor.execute(
        SqlLoader.get_sql("PLANNING_REFERENCE_ACTUAL_ASSIGNMENTS"),
        {"planYear": plan_year},
    )
    capacity: dict[tuple[str, str], Decimal] = defaultdict(lambda: Decimal("0"))
    worker_names: dict[str, str] = {}
    data_quality_warnings: list[dict[str, Any]] = []
    for (
        assignment_id,
        user_id,
        company_employee_id,
        employee_name,
        raw_allocations,
    ) in cursor.fetchall():
        assignment_id = int(assignment_id)
        worker_key = _worker_key(user_id, company_employee_id)
        employee_name = str(employee_name or worker_key)
        worker_names[worker_key] = employee_name
        if hasattr(raw_allocations, "read"):
            raw_allocations = raw_allocations.read()
        reason_code = ""
        if raw_allocations is None or not str(raw_allocations).strip():
            allocations = None
            reason_code = "MISSING_ALLOCATION_JSON"
        else:
            try:
                allocations = json.loads(raw_allocations)
            except (TypeError, ValueError):
                allocations = None
                reason_code = "INVALID_JSON"

        if not reason_code and (not isinstance(allocations, list) or not allocations):
            reason_code = "INVALID_SHAPE"

        validated_allocations: list[tuple[str, Decimal]] = []
        seen_months: set[str] = set()
        if not reason_code:
            for allocation in allocations:
                if not isinstance(allocation, dict):
                    reason_code = "INVALID_SHAPE"
                    break
                month = allocation.get("month")
                if not isinstance(month, str) or not _MONTH_PATTERN.fullmatch(month):
                    reason_code = "INVALID_MONTH"
                    break
                if month in seen_months:
                    reason_code = "DUPLICATE_MONTH"
                    break
                seen_months.add(month)
                raw_mm = allocation.get("mm")
                if isinstance(raw_mm, bool) or raw_mm is None:
                    reason_code = "INVALID_MM"
                    break
                try:
                    mm = Decimal(str(raw_mm))
                    valid_precision = mm == mm.quantize(Decimal("0.01"))
                except (InvalidOperation, TypeError, ValueError):
                    reason_code = "INVALID_MM"
                    break
                if (
                    not mm.is_finite()
                    or mm < Decimal("0")
                    or mm > Decimal("1")
                    or not valid_precision
                ):
                    reason_code = "INVALID_MM"
                    break
                validated_allocations.append((month, mm))

        if reason_code:
            logger.warning(
                "Invalid actual assignment allocation data. assignment_id=%s reason=%s",
                assignment_id,
                reason_code,
            )
            data_quality_warnings.append(
                _actual_data_quality_warning(
                    assignment_id,
                    worker_key,
                    employee_name,
                    reason_code,
                )
            )
            continue

        for month, mm in validated_allocations:
            if month.startswith(f"{plan_year}-"):
                capacity[(worker_key, month)] += mm
    return capacity, worker_names, data_quality_warnings


def _load_scenario_detail_once(cursor, scenario_id: int) -> dict[str, Any]:
    cursor.execute(
        SqlLoader.get_sql("PLANNING_SCENARIO_DETAIL"),
        {"scenarioId": scenario_id},
    )
    scenario = _row(cursor)
    if not scenario:
        raise HTTPException(status_code=404, detail="계획안을 찾을 수 없습니다.")

    capacity, worker_names, data_quality_warnings = _actual_capacity(
        cursor,
        int(scenario["planYear"]),
    )

    cursor.execute(
        SqlLoader.get_sql("PLANNING_SCENARIO_PROJECT_LIST"),
        {"scenarioId": scenario_id},
    )
    projects = _rows(cursor)
    cursor.execute(
        SqlLoader.get_sql("PLANNING_SCENARIO_ASSIGNMENT_LIST"),
        {"scenarioId": scenario_id},
    )
    assignments = _rows(cursor)
    cursor.execute(
        SqlLoader.get_sql("PLANNING_SCENARIO_MONTH_LIST"),
        {"scenarioId": scenario_id},
    )
    months = _rows(cursor)

    months_by_assignment: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for item in months:
        months_by_assignment[int(item["planAssignmentId"])].append(
            {
                "month": item["allocationMonth"],
                "mm": item["mm"],
                "costAmount": item["costAmount"],
                "salesAmount": item["salesAmount"],
                "operatingProfit": item["operatingProfit"],
            }
        )

    assignments_by_project: dict[int, list[dict[str, Any]]] = defaultdict(list)
    skipped_project_ids = {
        int(project["scenarioProjectId"])
        for project in projects
        if str(project.get("bidDecisionCode") or "").upper() == "SKIP"
    }
    for item in assignments:
        assignment_id = int(item["planAssignmentId"])
        key = _worker_key(item.get("userId"), item.get("companyEmployeeId"))
        item["workerKey"] = key
        item["monthlyAllocations"] = months_by_assignment.get(assignment_id, [])
        assignments_by_project[int(item["scenarioProjectId"])].append(item)
        worker_names[key] = str(item.get("employeeName") or key)
        if int(item["scenarioProjectId"]) not in skipped_project_ids:
            for month in item["monthlyAllocations"]:
                capacity[(key, str(month["month"]))] += Decimal(str(month["mm"] or 0))

    warnings = list(data_quality_warnings)
    warnings.extend(
        {
            "type": "OVER_CAPACITY",
            "workerKey": worker_key,
            "employeeName": worker_names.get(worker_key, worker_key),
            "month": month,
            "totalMm": _serialize(total_mm),
            "message": (
                f"{worker_names.get(worker_key, worker_key)}님의 {month} 총 투입률이 "
                f"{_serialize(total_mm)} M/M입니다."
            ),
        }
        for (worker_key, month), total_mm in sorted(capacity.items())
        if total_mm > Decimal("1")
    )

    total_mm = Decimal("0")
    total_cost = 0
    total_sales = 0
    active_project_count = 0
    active_assignment_count = 0
    for project in projects:
        project_assignments = assignments_by_project.get(
            int(project["scenarioProjectId"]),
            [],
        )
        project["assignments"] = project_assignments
        staffed_worker_keys = {
            str(item["workerKey"])
            for item in project_assignments
            if Decimal(str(item.get("totalMm") or 0)) > 0
        }
        project["assignmentCount"] = len(project_assignments)
        project["staffedHeadcount"] = len(staffed_worker_keys)
        active_project = str(project.get("bidDecisionCode") or "").upper() != "SKIP"
        project["shortageHeadcount"] = (
            max(0, int(project.get("targetHeadcount") or 0) - len(staffed_worker_keys))
            if active_project
            else 0
        )
        project["totalMm"] = _serialize(
            sum(
                (Decimal(str(item.get("totalMm") or 0)) for item in project_assignments),
                Decimal("0"),
            )
        )
        project_total_cost = sum(
            int(item.get("totalCostAmount") or 0) for item in project_assignments
        )
        project_total_sales = sum(
            int(item.get("totalSalesAmount") or 0) for item in project_assignments
        )
        project["totalCostAmount"] = str(project_total_cost)
        project["totalSalesAmount"] = str(project_total_sales)
        project["operatingProfit"] = str(project_total_sales - project_total_cost)
        if active_project:
            active_project_count += 1
            active_assignment_count += len(project_assignments)
            total_mm += Decimal(str(project["totalMm"] or 0))
            total_cost += project_total_cost
            total_sales += project_total_sales
        if project["shortageHeadcount"] > 0:
            warnings.append(
                {
                    "type": "UNDERSTAFFED",
                    "projectId": project["projectId"],
                    "projectName": project["projectName"],
                    "shortageHeadcount": project["shortageHeadcount"],
                    "message": (
                        f"{project['projectName']}에 "
                        f"{project['shortageHeadcount']}명이 부족합니다."
                    ),
                }
            )

    scenario["projects"] = projects
    scenario["warnings"] = warnings
    scenario["warningSignature"] = _warning_signature(warnings)
    scenario["summary"] = {
        "projectCount": active_project_count,
        "assignmentCount": active_assignment_count,
        "totalMm": _serialize(total_mm),
        "totalCostAmount": str(total_cost),
        "totalSalesAmount": str(total_sales),
        "operatingProfit": str(total_sales - total_cost),
        "operatingProfitRate": (
            round((total_sales - total_cost) / total_sales * 100, 2)
            if total_sales
            else 0
        ),
        "warningCount": len(warnings),
    }
    cursor.execute(
        SqlLoader.get_sql("PLANNING_SCENARIO_REVISION"),
        {"scenarioId": scenario_id},
    )
    revision_row = cursor.fetchone()
    if not revision_row:
        raise HTTPException(status_code=404, detail="계획안을 찾을 수 없습니다.")
    if int(revision_row[0]) != int(scenario["revisionNo"]):
        raise _ScenarioReadConflict()
    return scenario


def load_scenario_detail(cursor, scenario_id: int) -> dict[str, Any]:
    for _attempt in range(3):
        try:
            return _load_scenario_detail_once(cursor, scenario_id)
        except _ScenarioReadConflict:
            continue
    raise HTTPException(
        status_code=409,
        detail="계획안이 수정 중입니다. 잠시 후 다시 조회해 주세요.",
    )


def _reference_sets(
    cursor,
    plan_year: int,
) -> tuple[
    set[int],
    set[int],
    set[int],
    dict[str, tuple[date | None, date | None]],
]:
    cursor.execute(
        SqlLoader.get_sql("PLANNING_REFERENCE_PROJECTS"),
        {"planYear": plan_year},
    )
    project_ids = {int(row[0]) for row in cursor.fetchall()}
    cursor.execute(
        SqlLoader.get_sql("PLANNING_REFERENCE_USERS"),
        {"planYear": plan_year},
    )
    users = _rows(cursor)
    cursor.execute(
        SqlLoader.get_sql("PLANNING_REFERENCE_COMPANY_EMPLOYEES"),
        {"planYear": plan_year},
    )
    company_employees = _rows(cursor)
    availability: dict[str, tuple[date | None, date | None]] = {}
    for item in users:
        availability[f"USER:{item['userId']}"] = (
            date.fromisoformat(item["availableStartDate"])
            if item.get("availableStartDate")
            else None,
            date.fromisoformat(item["availableEndDate"])
            if item.get("availableEndDate")
            else None,
        )
    for item in company_employees:
        availability[f"COMPANY_EMPLOYEE:{item['companyEmployeeId']}"] = (
            date.fromisoformat(item["availableStartDate"])
            if item.get("availableStartDate")
            else None,
            date.fromisoformat(item["availableEndDate"])
            if item.get("availableEndDate")
            else None,
        )
    return (
        project_ids,
        {int(item["userId"]) for item in users},
        {int(item["companyEmployeeId"]) for item in company_employees},
        availability,
    )


def _ensure_confirmation_references(cursor, current_scenario: dict[str, Any]) -> None:
    project_ids, user_ids, company_employee_ids, availability = _reference_sets(
        cursor,
        int(current_scenario["planYear"]),
    )
    invalid_projects = []
    invalid_workers = []
    for project in current_scenario.get("projects", []):
        if int(project["projectId"]) not in project_ids:
            invalid_projects.append(str(project.get("projectName") or project["projectId"]))
        for assignment in project.get("assignments", []):
            user_id = assignment.get("userId")
            company_employee_id = assignment.get("companyEmployeeId")
            if user_id is not None and int(user_id) not in user_ids:
                invalid_workers.append(str(assignment.get("employeeName") or user_id))
            if (
                company_employee_id is not None
                and int(company_employee_id) not in company_employee_ids
            ):
                invalid_workers.append(
                    str(assignment.get("employeeName") or company_employee_id)
                )
            worker_key = _worker_key(user_id, company_employee_id)
            available_period = availability.get(worker_key)
            if available_period:
                available_start, available_end = available_period
                assignment_start = date.fromisoformat(
                    str(assignment["assignmentStartDate"])[:10]
                )
                assignment_end = date.fromisoformat(
                    str(assignment["assignmentEndDate"])[:10]
                )
                if (
                    (available_start and assignment_start < available_start)
                    or (available_end and assignment_end > available_end)
                ):
                    invalid_workers.append(
                        str(assignment.get("employeeName") or worker_key)
                    )
    if invalid_projects or invalid_workers:
        details = []
        if invalid_projects:
            details.append(f"사용 불가 프로젝트 {len(invalid_projects)}건")
        if invalid_workers:
            details.append(f"퇴직·비활성 인력 {len(invalid_workers)}건")
        raise HTTPException(
            status_code=409,
            detail=(
                "기준정보가 변경되어 계획안을 확정할 수 없습니다(" + ", ".join(details) + "). "
                "계획안을 다시 저장해 현재 기준정보를 반영해 주세요."
            ),
        )


def _validated_plan(
    cursor,
    plan_year: int,
    projects: list[PlanningProjectRequest],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    assignment_count = sum(len(project.assignments) for project in projects)
    month_row_count = sum(
        len(assignment.monthlyAllocations)
        for project in projects
        for assignment in project.assignments
    )
    if assignment_count > _MAX_PLAN_ASSIGNMENTS:
        raise HTTPException(
            status_code=413,
            detail=f"한 계획안에는 투입인력을 최대 {_MAX_PLAN_ASSIGNMENTS:,}건까지 저장할 수 있습니다.",
        )
    if month_row_count > _MAX_PLAN_MONTH_ROWS:
        raise HTTPException(
            status_code=413,
            detail=f"한 계획안에는 월별 배분을 최대 {_MAX_PLAN_MONTH_ROWS:,}건까지 저장할 수 있습니다.",
        )

    project_ids, user_ids, company_employee_ids, availability = _reference_sets(
        cursor,
        plan_year,
    )
    plan_start_date = date(plan_year, 1, 1)
    plan_end_date = date(plan_year, 12, 31)
    seen_projects: set[int] = set()
    capacity, _actual_worker_names, data_quality_warnings = _actual_capacity(
        cursor,
        plan_year,
    )
    validated_projects: list[dict[str, Any]] = []
    staffed_headcounts: dict[int, int] = {}

    for project_index, project in enumerate(projects):
        if project.projectId not in project_ids:
            raise HTTPException(
                status_code=400,
                detail="계획 대상 프로젝트가 없거나 사용할 수 없는 상태입니다.",
            )
        if project.projectId in seen_projects:
            raise HTTPException(
                status_code=400,
                detail="한 계획안에 같은 프로젝트를 중복해서 배치할 수 없습니다.",
            )
        seen_projects.add(project.projectId)
        if project.plannedStartDate > project.plannedEndDate:
            raise HTTPException(
                status_code=400,
                detail="프로젝트 예상 종료일은 시작일보다 빠를 수 없습니다.",
            )
        if (
            project.plannedEndDate < plan_start_date
            or project.plannedStartDate > plan_end_date
        ):
            raise HTTPException(
                status_code=400,
                detail="프로젝트 예상기간은 계획연도와 하루 이상 겹쳐야 합니다.",
            )
        decision = project.bidDecisionCode.strip().upper()
        if decision not in _BID_DECISION_CODES:
            raise HTTPException(status_code=400, detail="입찰 검토 상태를 확인해 주세요.")

        announcement = Decimal(project.announcementAmount)
        bid_amount = Decimal(project.bidAmount)
        discount_rate = (
            ((announcement - bid_amount) / announcement * 100).quantize(
                Decimal("0.0001"),
                rounding=ROUND_HALF_UP,
            )
            if announcement
            else Decimal("0")
        )
        if abs(discount_rate) > _MAX_DISCOUNT_RATE:
            raise HTTPException(
                status_code=400,
                detail="공모가와 입찰가의 차이가 너무 커 할인율을 계산할 수 없습니다.",
        )
        assignment_rows: list[dict[str, Any]] = []
        staffed_worker_keys: set[str] = set()
        for assignment_index, assignment in enumerate(project.assignments):
            if (assignment.employeeUserId is None) == (
                assignment.companyEmployeeId is None
            ):
                raise HTTPException(
                    status_code=400,
                    detail="투입인력은 내부 또는 외부 인력 중 한 명을 선택해야 합니다.",
                )
            if (
                assignment.employeeUserId is not None
                and assignment.employeeUserId not in user_ids
            ):
                raise HTTPException(status_code=400, detail="사용할 수 없는 임직원입니다.")
            if (
                assignment.companyEmployeeId is not None
                and assignment.companyEmployeeId not in company_employee_ids
            ):
                raise HTTPException(status_code=400, detail="사용할 수 없는 외부 인력입니다.")
            if assignment.assignmentStartDate > assignment.assignmentEndDate:
                raise HTTPException(
                    status_code=400,
                    detail="인력 투입 종료일은 시작일보다 빠를 수 없습니다.",
                )
            months: list[dict[str, Any]] = []
            seen_months: set[str] = set()
            total_mm = Decimal("0")
            total_cost = 0
            total_sales = 0
            worker_key = _worker_key(
                assignment.employeeUserId,
                assignment.companyEmployeeId,
            )
            cost_unit_price = int(assignment.costUnitPrice)
            sales_unit_price = int(assignment.salesUnitPrice)
            available_start, available_end = availability[worker_key]
            if (
                (available_start and assignment.assignmentStartDate < available_start)
                or (available_end and assignment.assignmentEndDate > available_end)
            ):
                raise HTTPException(
                    status_code=400,
                    detail="인력 투입기간은 해당 인력의 재직·계약기간 안에서 설정해 주세요.",
                )
            start_month = assignment.assignmentStartDate.strftime("%Y-%m")
            end_month = assignment.assignmentEndDate.strftime("%Y-%m")
            for month in sorted(assignment.monthlyAllocations, key=lambda item: item.month):
                if month.month in seen_months or not (
                    start_month <= month.month <= end_month
                ):
                    raise HTTPException(
                        status_code=400,
                        detail="월별 투입률의 연월과 투입기간을 확인해 주세요.",
                    )
                if not month.month.startswith(f"{plan_year}-"):
                    raise HTTPException(
                        status_code=400,
                        detail="월별 투입률은 계획연도 안에서만 저장할 수 있습니다.",
                    )
                seen_months.add(month.month)
                cost_amount = _money(month.mm * cost_unit_price)
                sales_amount = _money(month.mm * sales_unit_price)
                total_mm += month.mm
                total_cost += cost_amount
                total_sales += sales_amount
                if decision != "SKIP":
                    capacity[(worker_key, month.month)] += month.mm
                months.append(
                    {
                        "allocationMonth": _month_date(month.month),
                        "month": month.month,
                        "mm": month.mm,
                        "costAmount": cost_amount,
                        "salesAmount": sales_amount,
                        "operatingProfit": sales_amount - cost_amount,
                    }
                )
            if total_cost > _MAX_AMOUNT or total_sales > _MAX_AMOUNT:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "한 인력의 투입기간 합계 금액이 저장 가능한 범위를 초과했습니다. "
                        "투입기간 또는 월 단가를 조정해 주세요."
                    ),
                )
            if decision != "SKIP" and total_mm > 0:
                staffed_worker_keys.add(worker_key)
            assignment_rows.append(
                {
                    "employeeUserId": assignment.employeeUserId,
                    "companyEmployeeId": assignment.companyEmployeeId,
                    "assignmentStartDate": assignment.assignmentStartDate,
                    "assignmentEndDate": assignment.assignmentEndDate,
                    "totalMm": total_mm,
                    "costUnitPrice": cost_unit_price,
                    "salesUnitPrice": sales_unit_price,
                    "totalCostAmount": total_cost,
                    "totalSalesAmount": total_sales,
                    "operatingProfit": total_sales - total_cost,
                    "sortOrder": assignment_index,
                    "projectRoleName": assignment.projectRoleName.strip() or None,
                    "primaryDuty": assignment.primaryDuty.strip() or None,
                    "note": assignment.note.strip() or None,
                    "months": months,
                }
            )
        validated_projects.append(
            {
                "projectId": project.projectId,
                "bidDecisionCode": decision,
                "winProbability": project.winProbability,
                "plannedStartDate": project.plannedStartDate,
                "plannedEndDate": project.plannedEndDate,
                "announcementAmount": int(project.announcementAmount),
                "bidAmount": int(project.bidAmount),
                "expectedContractAmount": int(project.expectedContractAmount),
                "targetHeadcount": project.targetHeadcount,
                "discountRate": discount_rate,
                "sortOrder": project_index,
                "note": project.note.strip() or None,
                "assignments": assignment_rows,
            }
        )
        staffed_headcounts[project.projectId] = len(staffed_worker_keys)

    warnings = list(data_quality_warnings)
    warnings.extend(
        {
            "type": "OVER_CAPACITY",
            "workerKey": worker_key,
            "month": month,
            "totalMm": _serialize(total_mm),
            "message": f"{month}에 동일 인력이 {_serialize(total_mm)} M/M 배치되어 있습니다.",
        }
        for (worker_key, month), total_mm in sorted(capacity.items())
        if total_mm > Decimal("1")
    )
    warnings.extend(
        {
            "type": "UNDERSTAFFED",
            "projectId": project["projectId"],
            "shortageHeadcount": (
                int(project["targetHeadcount"])
                - staffed_headcounts[project["projectId"]]
            ),
            "message": (
                f"프로젝트 {project['projectId']}에 "
                f"{int(project['targetHeadcount']) - staffed_headcounts[project['projectId']]}명이 부족합니다."
            ),
        }
        for project in validated_projects
        if (
            project["bidDecisionCode"] != "SKIP"
            and int(project["targetHeadcount"]) > staffed_headcounts[project["projectId"]]
        )
    )
    return validated_projects, warnings


@router.get("/references")
def references(planYear: int = Query(ge=1900, le=2100)):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("PLANNING_REFERENCE_PROJECTS"),
            {"planYear": planYear},
        )
        projects = _rows(cursor)
        cursor.execute(
            SqlLoader.get_sql("PLANNING_REFERENCE_USERS"),
            {"planYear": planYear},
        )
        users = _rows(cursor)
        cursor.execute(
            SqlLoader.get_sql("PLANNING_REFERENCE_COMPANY_EMPLOYEES"),
            {"planYear": planYear},
        )
        company_employees = _rows(cursor)
        (
            actual_capacity,
            actual_worker_names,
            data_quality_warnings,
        ) = _actual_capacity(cursor, planYear)
        return {
            "status": "success",
            "data": {
                "projects": projects,
                "workers": [
                    {**item, "workerKey": f"USER:{item['userId']}"}
                    for item in users
                ]
                + [
                    {
                        **item,
                        "workerKey": (
                            f"COMPANY_EMPLOYEE:{item['companyEmployeeId']}"
                        ),
                    }
                    for item in company_employees
                ],
                "actualCapacity": [
                    {
                        "workerKey": worker_key,
                        "employeeName": actual_worker_names.get(worker_key, worker_key),
                        "month": month,
                        "totalMm": _serialize(total_mm),
                    }
                    for (worker_key, month), total_mm in sorted(actual_capacity.items())
                ],
                "dataQualityWarnings": data_quality_warnings,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Planning references could not be loaded.")
        _raise_service_error(exc)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("")
def list_scenarios(planYear: int = Query(ge=1900, le=2100)):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("PLANNING_SCENARIO_LIST"),
            {"planYear": planYear},
        )
        return {"status": "success", "data": {"scenarios": _rows(cursor)}}
    except Exception as exc:
        logger.exception("Planning scenario list could not be loaded.")
        _raise_service_error(exc)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("")
def create_scenario(payload: PlanningScenarioCreateRequest, request: Request):
    conn = None
    cursor = None
    try:
        scenario_name = payload.scenarioName.strip()
        if not scenario_name:
            raise HTTPException(status_code=400, detail="계획안 이름을 입력해 주세요.")
        conn = get_db_connection()
        cursor = conn.cursor()
        output = cursor.var(oracledb.DB_TYPE_NUMBER)
        cursor.execute(
            SqlLoader.get_sql("PLANNING_SCENARIO_INSERT"),
            {
                "planYear": payload.planYear,
                "scenarioName": scenario_name,
                "description": payload.description.strip() or None,
                "userId": get_request_user_id(request),
                "scenarioIdOut": output,
            },
        )
        scenario_id = _output_number(output)
        conn.commit()
        return {
            "status": "success",
            "data": {"scenarioId": scenario_id, "revisionNo": 1},
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Planning scenario creation failed.")
        if oracle_error_code(exc) == 1:
            raise HTTPException(
                status_code=409,
                detail="같은 연도에 동일한 계획안 이름이 이미 있습니다.",
            ) from exc
        _raise_service_error(exc)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/{scenario_id}")
def get_scenario(scenario_id: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        return {
            "status": "success",
            "data": {"scenario": load_scenario_detail(cursor, scenario_id)},
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Planning scenario detail could not be loaded.")
        _raise_service_error(exc)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.put("/{scenario_id}")
def save_scenario(
    scenario_id: int,
    payload: PlanningScenarioSaveRequest,
    request: Request,
):
    conn = None
    cursor = None
    try:
        scenario_name = payload.scenarioName.strip()
        if not scenario_name:
            raise HTTPException(status_code=400, detail="계획안 이름을 입력해 주세요.")
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("PLANNING_SCENARIO_DETAIL"),
            {"scenarioId": scenario_id},
        )
        scenario = _row(cursor)
        if not scenario:
            raise HTTPException(status_code=404, detail="계획안을 찾을 수 없습니다.")
        plan_year = int(scenario["planYear"])
        validated_projects, warnings = _validated_plan(
            cursor,
            plan_year,
            payload.projects,
        )

        cursor.execute(
            SqlLoader.get_sql("PLANNING_SCENARIO_LOCK"),
            {"scenarioId": scenario_id},
        )
        lock_row = cursor.fetchone()
        if not lock_row:
            raise HTTPException(status_code=404, detail="계획안을 찾을 수 없습니다.")
        status_code, revision_no = str(lock_row[0]), int(lock_row[1])
        if status_code != "DRAFT":
            raise HTTPException(
                status_code=409,
                detail="확정되거나 보관된 계획안은 수정할 수 없습니다.",
            )
        if revision_no != payload.revisionNo:
            raise HTTPException(
                status_code=409,
                detail="다른 사용자가 계획안을 변경했습니다. 새로고침 후 다시 저장해 주세요.",
            )

        user_id = get_request_user_id(request)
        cursor.execute(
            SqlLoader.get_sql("PLANNING_SCENARIO_UPDATE"),
            {
                "scenarioId": scenario_id,
                "scenarioName": scenario_name,
                "description": payload.description.strip() or None,
                "userId": user_id,
            },
        )
        cursor.execute(
            SqlLoader.get_sql("PLANNING_SCENARIO_PROJECT_DELETE_ALL"),
            {"scenarioId": scenario_id},
        )
        for project in validated_projects:
            project_output = cursor.var(oracledb.DB_TYPE_NUMBER)
            cursor.execute(
                SqlLoader.get_sql("PLANNING_SCENARIO_PROJECT_INSERT"),
                {
                    **{key: value for key, value in project.items() if key != "assignments"},
                    "scenarioId": scenario_id,
                    "userId": user_id,
                    "scenarioProjectIdOut": project_output,
                },
            )
            scenario_project_id = _output_number(project_output)
            for assignment in project["assignments"]:
                assignment_output = cursor.var(oracledb.DB_TYPE_NUMBER)
                cursor.execute(
                    SqlLoader.get_sql("PLANNING_SCENARIO_ASSIGNMENT_INSERT"),
                    {
                        **{key: value for key, value in assignment.items() if key != "months"},
                        "scenarioProjectId": scenario_project_id,
                        "userId": user_id,
                        "planAssignmentIdOut": assignment_output,
                    },
                )
                plan_assignment_id = _output_number(assignment_output)
                for month in assignment["months"]:
                    cursor.execute(
                        SqlLoader.get_sql("PLANNING_SCENARIO_MONTH_INSERT"),
                        {
                            "planAssignmentId": plan_assignment_id,
                            "allocationMonth": month["allocationMonth"],
                            "mm": month["mm"],
                            "costAmount": month["costAmount"],
                            "salesAmount": month["salesAmount"],
                            "operatingProfit": month["operatingProfit"],
                        },
                    )
        conn.commit()
        return {
            "status": "success",
            "data": {
                "scenarioId": scenario_id,
                "revisionNo": revision_no + 1,
                "warnings": warnings,
                "warningSignature": _warning_signature(warnings),
            },
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Planning scenario save failed. scenario_id=%s", scenario_id)
        if oracle_error_code(exc) == 1:
            raise HTTPException(
                status_code=409,
                detail="중복된 프로젝트 또는 계획안 이름이 있습니다.",
            ) from exc
        _raise_service_error(exc)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/{scenario_id}/confirm")
def confirm_scenario(
    scenario_id: int,
    payload: PlanningScenarioConfirmRequest,
    request: Request,
):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("PLANNING_SCENARIO_LOCK"),
            {"scenarioId": scenario_id},
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="계획안을 찾을 수 없습니다.")
        if str(row[0]) != "DRAFT":
            raise HTTPException(status_code=409, detail="이미 확정된 계획안입니다.")
        if int(row[1]) != payload.revisionNo:
            raise HTTPException(
                status_code=409,
                detail="다른 사용자가 계획안을 변경했습니다. 새로고침 후 다시 확정해 주세요.",
            )
        cursor.execute(
            SqlLoader.get_sql("PLANNING_SCENARIO_PROJECT_COUNT"),
            {"scenarioId": scenario_id},
        )
        if int(cursor.fetchone()[0] or 0) <= 0:
            raise HTTPException(
                status_code=400,
                detail="프로젝트가 없는 계획안은 확정할 수 없습니다.",
            )
        current_scenario = load_scenario_detail(cursor, scenario_id)
        _ensure_confirmation_references(cursor, current_scenario)
        current_warnings = current_scenario["warnings"]
        current_warning_signature = current_scenario["warningSignature"]
        data_quality_warnings = [
            warning
            for warning in current_warnings
            if warning.get("type") == "DATA_QUALITY"
        ]
        if data_quality_warnings:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "ACTUAL_ASSIGNMENT_DATA_QUALITY",
                    "message": (
                        "실제 투입 데이터에 품질 오류가 있어 계획안을 확정할 수 없습니다. "
                        "프로젝트 투입 정보를 수정한 뒤 다시 확인해 주세요."
                    ),
                    "warningSignature": current_warning_signature,
                    "warnings": current_warnings,
                },
            )
        if current_warnings and (
            not payload.acknowledgeWarnings
            or payload.warningSignature != current_warning_signature
        ):
            signature_changed = (
                payload.acknowledgeWarnings
                and payload.warningSignature is not None
                and payload.warningSignature != current_warning_signature
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "code": (
                        "PLANNING_WARNING_SIGNATURE_CHANGED"
                        if signature_changed
                        else "PLANNING_WARNINGS_NOT_ACKNOWLEDGED"
                    ),
                    "message": (
                        "계획 위험이 변경되었습니다. 최신 경고를 다시 확인한 뒤 확정해 주세요."
                        if signature_changed
                        else "현재 계획 위험을 확인한 뒤 다시 확정해 주세요."
                    ),
                    "warningSignature": current_warning_signature,
                    "warnings": current_warnings,
                },
            )
        cursor.execute(
            SqlLoader.get_sql("PLANNING_SCENARIO_CONFIRM"),
            {"scenarioId": scenario_id, "userId": get_request_user_id(request)},
        )
        conn.commit()
        return {"status": "success"}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Planning scenario confirmation failed. scenario_id=%s", scenario_id)
        _raise_service_error(exc)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.delete("/{scenario_id}")
def delete_scenario(
    scenario_id: int,
    revisionNo: int = Query(ge=1),
):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("PLANNING_SCENARIO_DELETE"),
            {"scenarioId": scenario_id, "revisionNo": revisionNo},
        )
        if cursor.rowcount <= 0:
            raise HTTPException(
                status_code=409,
                detail=(
                    "계획안이 변경되었거나 이미 확정·삭제되었습니다. "
                    "목록을 새로고침한 뒤 다시 시도해 주세요."
                ),
            )
        conn.commit()
        return {"status": "success"}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Planning scenario deletion failed. scenario_id=%s", scenario_id)
        _raise_service_error(exc)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
