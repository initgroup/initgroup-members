"""Project tax-year revenue ledger, independent of optional worker sales rates."""
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from backend.annual_performance import rows
from backend.database_helper import SqlLoader
from backend.database import get_db_connection


def apply_schema():
    """Explicit installer only; never called by requests or ordinary startup."""
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("INIT_PROJECT_REVENUE_V1"))
        cursor.execute(SqlLoader.get_sql("PROJECT_REVENUE_SCHEMA_STATUS"))
        if int(cursor.fetchone()[0]) != 1:
            raise RuntimeError("Project revenue schema verification failed.")
        return {"projectRevenueSchemaReady": True}
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


class RevenueWrite(BaseModel):
    revision: int = Field(ge=0)
    note: str = Field(default="", max_length=2000)
    amount: int = Field(ge=0, le=999_999_999_999_999_999)
    model_config = ConfigDict(extra="forbid")


SqlLoader.register_bind_contract("PROJECT_REVENUE_YEAR_SAVE", {"projectId", "year", "amount", "note", "actor"})


def revenue_detail(cursor, project):
    project_id = int(project["projectId"])
    # All versions and rows are retrieved in one statement for a consistent edit baseline.
    saved = rows(cursor, SqlLoader.get_sql("PROJECT_REVENUE_GET"), {"projectId": project_id})
    first = int(str(project["projectStartDate"])[:4])
    last = int(str(project["projectEndDate"])[:4])
    years = set(range(first, last + 1)) | {int(r["revenue_year"]) for r in saved}
    result = []
    closed = rows(cursor, SqlLoader.get_sql("PROJECT_REVENUE_CLOSED_YEARS"))
    closed_years = {int(r["plan_year"]) for r in closed}
    for year in sorted(years):
        records = [r for r in saved if int(r["revenue_year"]) == year]
        result.append({"year": year, "ordinal": year - first + 1 if first <= year <= last else None,
                       "revision": int(records[0]["revision_no"]) if records else 0,
                       "saved": bool(records), "closed": year in closed_years,
                       "note": (records[0]["note"] or "") if records else "",
                       "totalAmount": str(records[0]["amount"]) if records else "0"})
    return {"projectId": project_id, "contractAmountVat": str(project["contractAmountVat"]),
            "totalAmount": str(sum(int(y["totalAmount"]) for y in result)), "years": result}


def save_revenue(cursor, project, year, payload, actor):
    project_id = int(project["projectId"])
    # Year lock is acquired before project lock, in the same order as year closing.
    cursor.execute(SqlLoader.get_sql("ANNUAL_YEAR_LOCK"), {"year": year})
    if not cursor.fetchone():
        cursor.execute(SqlLoader.get_sql("ANNUAL_YEAR_INSERT"), {"year": year})
    header = rows(cursor, SqlLoader.get_sql("ANNUAL_YEAR_GET"), {"year": year})[0]
    if header.get("year_closed_at"):
        raise HTTPException(409, "마감한 연도의 프로젝트 매출은 수정할 수 없습니다.")
    historical = rows(cursor, SqlLoader.get_sql("ANNUAL_HISTORICAL_GET"), {"year": year})
    if historical and historical[0].get("active_yn") == "Y":
        raise HTTPException(409, "이 연도는 과거 회사 총액을 적용 중입니다. 연간 목표·실적에서 총액 적용을 해제한 뒤 프로젝트 매출을 입력하세요.")
    cursor.execute(SqlLoader.get_sql("PROJECT_REVENUE_PROJECT_LOCK"), {"projectId": project_id})
    if not cursor.fetchone():
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")
    previous = rows(cursor, SqlLoader.get_sql("PROJECT_REVENUE_YEAR_GET"), {"projectId": project_id, "year": year})
    if (int(previous[0]["revision_no"]) if previous else 0) != payload.revision:
        raise HTTPException(409, "다른 사용자가 이 연도의 매출을 수정했습니다. 다시 조회해 주세요.")
    last_closed = rows(cursor, SqlLoader.get_sql("PROJECT_REVENUE_CLOSED_MONTHS"), {"year": year})
    if last_closed:
        raise HTTPException(409, "월 마감 기록이 있는 연도의 매출은 일반 입력에서 변경할 수 없습니다.")
    cursor.execute(SqlLoader.get_sql("PROJECT_REVENUE_YEAR_SAVE"), {"projectId": project_id, "year": year,
        "amount": payload.amount, "note": payload.note.strip(), "actor": actor})
    cursor.execute(SqlLoader.get_sql("ANNUAL_YEAR_UPDATE"), {"year": year, "actor": actor})
    return revenue_detail(cursor, project)
