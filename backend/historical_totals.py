"""Optional company totals for past years without project revenue details."""
from datetime import date
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from backend.database import get_db_connection
from backend.database_helper import SqlLoader

MAX_AMOUNT = 999_999_999_999_999_999_999_999


class HistoricalWrite(BaseModel):
    revision: int = Field(ge=0)
    targetAmount: int | None = Field(default=None, ge=0, le=MAX_AMOUNT)
    salesAmount: int = Field(ge=0, le=MAX_AMOUNT)
    netProfit: int | None = Field(default=None, ge=-MAX_AMOUNT, le=MAX_AMOUNT)
    note: str = Field(default="", max_length=2000)
    model_config = ConfigDict(extra="forbid")


SqlLoader.register_bind_contract("ANNUAL_HISTORICAL_SAVE", {"year", "targetAmount", "salesAmount", "netProfit", "note", "actor"})
SqlLoader.register_bind_contract("ANNUAL_HISTORICAL_DISABLE", {"year", "actor"})
SqlLoader.register_bind_contract("ANNUAL_HISTORICAL_TOUCH", {"year"})


def active_historical(source):
    record = source.get("historicalTotals") or {}
    return record if record.get("active_yn") == "Y" else None


def historical_reason(source):
    header = source.get("header") or {}
    if source["year"] >= date.today().year:
        return "현재·미래 연도는 프로젝트별 매출을 입력해 주세요. 총액 소급은 과거 연도만 가능합니다."
    if header.get("year_closed_at") or header.get("year_snapshot") or source.get("closed"):
        return "마감된 연도의 기록은 총액 소급으로 변경할 수 없습니다."
    if source.get("projectRevenue"):
        return "프로젝트별 매출 자료가 있는 연도는 회사 총액을 중복 입력할 수 없습니다."
    return ""


def historical_dto(source):
    row = source.get("historicalTotals") or {}
    active = active_historical(source)
    reason = historical_reason(source)
    return {"revision": int(row.get("revision_no", 0)), "saved": bool(active), "available": not reason,
            "reason": reason, "targetEditable": not bool(source.get("annualEntries")),
            "targetAmount": str(active["target_amount"]) if active and active.get("target_amount") is not None else None,
            "salesAmount": str(active["sales_amount"]) if active else None,
            "netProfit": str(active["net_profit"]) if active and active.get("net_profit") is not None else None,
            "note": active.get("note") or "" if active else ""}


def validate_historical(source, payload):
    reason = historical_reason(source)
    if reason:
        raise HTTPException(409, reason)
    revision = int((source.get("historicalTotals") or {}).get("revision_no", 0))
    if payload.revision != revision:
        raise HTTPException(409, "다른 사용자가 과거 총액을 수정했습니다. 다시 조회해 주세요.")
    if source.get("annualEntries") and payload.targetAmount is not None:
        raise HTTPException(409, "기존 직원·사업부 목표 합계를 유지합니다. 과거 목표 총액은 비워 주세요.")


def apply_schema():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("INIT_HISTORICAL_TOTALS_V1"))
        cursor.execute(SqlLoader.get_sql("HISTORICAL_TOTALS_SCHEMA_STATUS"))
        if int(cursor.fetchone()[0]) != 1:
            raise RuntimeError("Historical totals schema verification failed.")
        return {"historicalTotalsSchemaReady": True}
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
