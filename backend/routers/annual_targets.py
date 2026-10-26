from __future__ import annotations

import json
import logging
from datetime import date
from typing import Annotated

import oracledb
from fastapi import APIRouter, Depends, HTTPException, Path, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.annual_performance import load_sources, report, annual_roster
from backend.auth_context import get_request_user_id, require_admin_role
from backend.database import get_db_connection
from backend.database_errors import oracle_error_code, raise_database_http_error
from backend.database_helper import SqlLoader
from backend.department_config import departments
from backend.historical_totals import HistoricalWrite, active_historical, historical_dto, validate_historical

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_admin_role)])
Year = Annotated[int, Path(ge=1900, le=2100)]
Amount = Annotated[int, Field(ge=0, le=999_999_999_999_999_999_999_999)]
SECTIONS = ("staff", "department-extras", "company-extra", "expenses")
for sql_id, binds in {
    "ANNUAL_ENTRIES_DELETE": {"year", "scope"},
    "ANNUAL_ENTRY_INSERT": {"year", "scope", "key", "userId", "name", "department", "departmentName", "employmentType", "amount", "note"},
    "ANNUAL_SECTION_UPDATE": {"year", "section"},
    "ANNUAL_EXPENSE_SAVE": {"year", "amount", "note"},
    "ANNUAL_HISTORY_UPSERT": {"userId", "effectiveFrom", "name", "department", "departmentName", "employmentType", "employmentStatus", "hireDate", "retirementDate"},
    "ANNUAL_YEAR_CLOSE": {"year", "snapshot", "actor"},
}.items():
    SqlLoader.register_bind_contract(sql_id, binds)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StaffTarget(StrictModel):
    userId: int = Field(gt=0)
    amount: Amount


class DepartmentExtra(StrictModel):
    department: str = Field(max_length=50)
    amount: Amount
    note: str = Field(default="", max_length=1000)


class SaveStaff(StrictModel):
    revision: int = Field(ge=0)
    staff: list[StaffTarget] = Field(max_length=5000)


class SaveDepartments(StrictModel):
    revision: int = Field(ge=0)
    extras: list[DepartmentExtra] = Field(max_length=100)


class SaveCompany(StrictModel):
    revision: int = Field(ge=0)
    amount: Amount
    note: str = Field(default="", max_length=1000)


class SaveExpenses(SaveCompany):
    pass


class CloseYear(StrictModel):
    revision: int = Field(ge=0)
    reviewedHistory: bool = False


def transaction(callback):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        data = callback(cursor)
        conn.commit()
        return {"status": "success", "data": data}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Annual targets request failed.")
        if oracle_error_code(exc) == 1 and any(name in str(exc).upper() for name in ("INIT$_PK_TARGET_YEAR", "INIT$_PK_MONTH_CLOSE")):
            raise HTTPException(409, "같은 연도 목표 또는 월 마감이 이미 저장되어 있습니다. 다시 조회해 주세요.") from exc
        raise_database_http_error(exc, default_detail="연간 목표를 처리하지 못했습니다.", schema_detail="연간 목표 스키마 적용이 필요합니다.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def entry_dto(entry):
    return {"userId": int(entry["user_id"]) if entry.get("user_id") else None, "name": entry.get("user_name"),
        "department": entry.get("department_code"), "departmentName": entry.get("department_name"),
        "employmentType": entry.get("employment_type_code"), "amount": str(entry["target_amount"]), "note": entry.get("note") or ""}


def output(source):
    header = source["header"] or {}
    entries = source["annualEntries"]
    company = next((entry for entry in entries if entry["scope_code"] == "COMPANY"), None)
    return {"year": source["year"], "revision": int(header.get("revision_no", 0)), "saved": bool(header),
        "revisions": {section: source["revisions"].get(section, 0) for section in SECTIONS},
        "departments": list(departments()), "staffRoster": annual_roster(source["year"], source["history"]),
        "staffTargets": [entry_dto(e) for e in entries if e["scope_code"] == "STAFF"],
        "departmentExtras": [entry_dto(e) for e in entries if e["scope_code"] == "DEPARTMENT"],
        "companyExtra": {"amount": str(company["target_amount"]) if company else "0", "note": company.get("note") or "" if company else ""},
        "projects": [{"projectId": int(p["project_id"]), "name": p["project_name"], "status": p["status_code"],
            "orderAmount": str(p["order_amount_vat"] or 0), "contractAmount": str(p["contract_amount_vat"] or 0),
            "participationRate": str(p["participation_rate"] or 0), "department": p["department_code"] or "UNASSIGNED"} for p in source["projects"]],
        "annualExpense": {"amount": str(source["annualExpense"]["amount"]), "note": source["annualExpense"].get("note") or ""},
        "historicalTotals": historical_dto(source),
        "performance": report(source)}


def lock_year(cursor, year, revision=None, create=False):
    cursor.execute(SqlLoader.get_sql("ANNUAL_YEAR_LOCK"), {"year": year})
    row = cursor.fetchone()
    if not row and create and revision in (None, 0):
        cursor.execute(SqlLoader.get_sql("ANNUAL_YEAR_INSERT"), {"year": year})
    elif not row or (revision is not None and int(row[0]) != revision):
        raise HTTPException(409, "목표 또는 마감이 변경되었습니다. 다시 조회해 주세요.")
    cursor.execute(SqlLoader.get_sql("ANNUAL_HISTORY_LOCK"))


def valid_department(code):
    if code not in {d["code"] for d in departments()} | {"UNASSIGNED"}:
        raise HTTPException(400, "등록된 사업부를 선택해 주세요.")


@router.get("/{year}")
def get_year(year: Year):
    return transaction(lambda cursor: output(load_sources(cursor, year)))


def entry(scope, key, amount, person=None, department=None, note=""):
    person = person or {}
    labels = {d["code"]: d["label"] for d in departments()}
    return {"scope_code": scope, "target_key": str(key), "user_id": person.get("userId"), "user_name": person.get("name"),
        "department_code": person.get("department") or department,
        "department_name": person.get("departmentName") or labels.get(department, "미지정"),
        "employment_type_code": person.get("employmentType"), "target_amount": amount, "note": note}


def write_entries(cursor, year, scope, entries):
    cursor.execute(SqlLoader.get_sql("ANNUAL_ENTRIES_DELETE"), {"year": year, "scope": scope})
    for row in entries:
        cursor.execute(SqlLoader.get_sql("ANNUAL_ENTRY_INSERT"), {"year": year, "scope": scope, "key": row["target_key"],
            "userId": row["user_id"], "name": row["user_name"], "department": row["department_code"],
            "departmentName": row["department_name"], "employmentType": row["employment_type_code"],
            "amount": row["target_amount"], "note": row["note"]})


def save_section(year, section, revision, request, update):
    actor = get_request_user_id(request)
    def run(cursor):
        lock_year(cursor, year, create=True)
        source = load_sources(cursor, year)
        if (source["header"] or {}).get("year_closed_at"):
            raise HTTPException(409, "마감한 연도의 목표·비용은 변경할 수 없습니다.")
        if active_historical(source):
            raise HTTPException(409, "과거 총액을 적용 중입니다. 총액 적용을 해제한 뒤 상세 목표·비용을 입력해 주세요.")
        if source["revisions"].get(section, 0) != revision:
            raise HTTPException(409, "이 영역을 다른 사용자가 변경했거나 연도 마감했습니다. 다시 조회해 주세요.")
        update(cursor, source)
        cursor.execute(SqlLoader.get_sql("ANNUAL_SECTION_UPDATE"), {"year": year, "section": section})
        cursor.execute(SqlLoader.get_sql("ANNUAL_YEAR_UPDATE"), {"year": year, "actor": actor})
        return output(load_sources(cursor, year))
    return transaction(run)


def replace_entries(cursor, source, scope, entries):
    write_entries(cursor, source["year"], scope, entries)


@router.put("/{year}/staff")
def save_staff(year: Year, payload: SaveStaff, request: Request):
    def update(cursor, source):
        people = {row["userId"]: row for row in annual_roster(year, source["history"])}
        people.update({int(e["user_id"]): entry_dto(e) for e in source["annualEntries"] if e["scope_code"] == "STAFF"})
        seen, entries = set(), []
        for row in payload.staff:
            if row.userId in seen:
                raise HTTPException(400, "직원 연간 목표가 중복되었습니다.")
            seen.add(row.userId)
            person = people.get(row.userId)
            if not person:
                raise HTTPException(400, "해당 연도의 목표 대상 직원을 확인해 주세요. 계약직·외부인력은 실적만 반영합니다.")
            entries.append(entry("STAFF", row.userId, row.amount, person=person))
        replace_entries(cursor, source, "STAFF", entries)
    return save_section(year, "staff", payload.revision, request, update)


@router.put("/{year}/department-extras")
def save_departments(year: Year, payload: SaveDepartments, request: Request):
    def update(cursor, source):
        existing = {e["department_code"] for e in source["annualEntries"] if e["scope_code"] == "DEPARTMENT"}
        seen, entries = set(), []
        for row in payload.extras:
            if row.department not in existing:
                valid_department(row.department)
            if row.department in seen:
                raise HTTPException(400, "사업부 추가목표가 중복되었습니다.")
            seen.add(row.department)
            entries.append(entry("DEPARTMENT", row.department, row.amount, department=row.department, note=row.note))
        replace_entries(cursor, source, "DEPARTMENT", entries)
    return save_section(year, "department-extras", payload.revision, request, update)


@router.put("/{year}/company-extra")
def save_company(year: Year, payload: SaveCompany, request: Request):
    return save_section(year, "company-extra", payload.revision, request,
        lambda cursor, source: replace_entries(cursor, source, "COMPANY", [entry("COMPANY", "ALL", payload.amount, note=payload.note)]))


@router.put("/{year}/expenses")
def save_expenses(year: Year, payload: SaveExpenses, request: Request):
    def update(cursor, source):
        cursor.execute(SqlLoader.get_sql("ANNUAL_EXPENSE_SAVE"), {"year": year, "amount": payload.amount, "note": payload.note})
    return save_section(year, "expenses", payload.revision, request, update)


class HistoricalRevision(StrictModel):
    revision: int = Field(ge=0)


@router.put("/{year}/historical-totals")
def save_historical(year: Year, payload: HistoricalWrite, request: Request):
    actor = get_request_user_id(request)
    def run(cursor):
        lock_year(cursor, year, create=True)
        source = load_sources(cursor, year)
        validate_historical(source, payload)
        cursor.execute(SqlLoader.get_sql("ANNUAL_HISTORICAL_SAVE"), {"year": year, "targetAmount": payload.targetAmount,
            "salesAmount": payload.salesAmount, "netProfit": payload.netProfit, "note": payload.note.strip(), "actor": actor})
        cursor.execute(SqlLoader.get_sql("ANNUAL_YEAR_UPDATE"), {"year": year, "actor": actor})
        return output(load_sources(cursor, year))
    return transaction(run)


@router.delete("/{year}/historical-totals")
def disable_historical(year: Year, payload: HistoricalRevision, request: Request):
    actor = get_request_user_id(request)
    def run(cursor):
        lock_year(cursor, year)
        source = load_sources(cursor, year)
        header = source.get("header") or {}
        if year >= date.today().year or header.get("year_closed_at") or header.get("year_snapshot") or source.get("closed"):
            raise HTTPException(409, "현재·미래 연도 또는 마감 기록의 총액 적용은 변경할 수 없습니다.")
        record = source.get("historicalTotals") or {}
        if int(record.get("revision_no", 0)) != payload.revision:
            raise HTTPException(409, "과거 총액이 변경되었습니다. 다시 조회해 주세요.")
        if not active_historical(source):
            raise HTTPException(409, "적용 중인 과거 총액이 없습니다.")
        cursor.execute(SqlLoader.get_sql("ANNUAL_HISTORICAL_DISABLE"), {"year": year, "actor": actor})
        cursor.execute(SqlLoader.get_sql("ANNUAL_YEAR_UPDATE"), {"year": year, "actor": actor})
        return output(load_sources(cursor, year))
    return transaction(run)


@router.post("/{year}/close")
def close_year(year: Year, payload: CloseYear, request: Request):
    if year >= date.today().year:
        raise HTTPException(400, "종료된 연도만 마감할 수 있습니다.")
    actor = get_request_user_id(request)
    def run(cursor):
        lock_year(cursor, year, payload.revision)
        cursor.execute(SqlLoader.get_sql("ANNUAL_SOURCE_LOCK"))
        source = load_sources(cursor, year)
        if source["header"].get("year_closed_at"):
            raise HTTPException(409, "이미 마감한 연도입니다.")
        if not payload.reviewedHistory:
            raise HTTPException(400, "소속 이력·투입·연간 목표·회사 연간 비용을 검토한 후 마감해 주세요.")
        snapshot = report(source)
        snapshot["closed"] = True
        cursor.setinputsizes(snapshot=oracledb.DB_TYPE_CLOB)
        cursor.execute(SqlLoader.get_sql("ANNUAL_YEAR_CLOSE"), {"year": year, "snapshot": json.dumps(snapshot, ensure_ascii=False), "actor": actor})
        cursor.execute(SqlLoader.get_sql("ANNUAL_YEAR_UPDATE"), {"year": year, "actor": actor})
        for section in SECTIONS:
            cursor.execute(SqlLoader.get_sql("ANNUAL_SECTION_UPDATE"), {"year": year, "section": section})
        cursor.execute(SqlLoader.get_sql("ANNUAL_HISTORICAL_TOUCH"), {"year": year})
        return output(load_sources(cursor, year))
    return transaction(run)
