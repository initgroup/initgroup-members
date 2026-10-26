"""Employee detail owns dated employment history; closed periods stay immutable."""
from datetime import date

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.annual_performance import as_date, profile_at, rows, save_profile
from backend.database_helper import SqlLoader
from backend.department_config import departments


class HistoryWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    effectiveFrom: date
    department: str = Field(max_length=50)
    employmentType: str = Field(pattern=r"^(REGULAR|EXECUTIVE|CONTRACT|INTERN|DISPATCH|OTHER)$")
    employmentStatus: str = Field(pattern=r"^(ACTIVE|LEAVE|RETIRED)$")
    hireDate: date | None = None
    retirementDate: date | None = None
    versionToken: str | None = Field(default=None, max_length=30)


SqlLoader.register_bind_contract("USER_HISTORY_DELETE", {"userId", "effectiveFrom", "versionToken"})
SqlLoader.register_bind_contract("USER_HISTORY_SYNC_CURRENT", {"userId", "department", "departmentName", "employmentType", "employmentStatus", "hireDate", "retirementDate"})


def get_history(cursor, user_id):
    current = rows(cursor, SqlLoader.get_sql("ANNUAL_USER_PROFILE"), {"userId": user_id})
    if not current:
        raise HTTPException(404, "임직원을 찾을 수 없습니다.")
    events = rows(cursor, SqlLoader.get_sql("ANNUAL_HISTORY_USER_GET"), {"userId": user_id})
    cursor.execute(SqlLoader.get_sql("ANNUAL_LAST_CLOSE"))
    last = cursor.fetchone()[0]
    return {"items": [{k: (as_date(v).isoformat() if isinstance(v, date) else v) for k, v in event.items()} for event in events], "lastClosedMonth": last}


def change_history(cursor, user_id, payload=None, original_day=None, version=None):
    # Same order as the existing employee save transaction.
    cursor.execute(SqlLoader.get_sql("ADMIN_USER_TABLE_LOCK"))
    cursor.execute(SqlLoader.get_sql("ANNUAL_HISTORY_LOCK"))
    data = get_history(cursor, user_id)
    events, last = data["items"], data["lastClosedMonth"]
    for day in (original_day, payload.effectiveFrom if payload else None):
        if day and last and day.strftime("%Y-%m") <= last:
            raise HTTPException(409, "마감월에 영향을 주는 소속·고용 이력은 수정하거나 삭제할 수 없습니다.")
    if payload:
        if payload.effectiveFrom > date.today():
            raise HTTPException(400, "이력 적용일은 오늘까지 입력할 수 있습니다.")
        if payload.hireDate and payload.retirementDate and payload.hireDate > payload.retirementDate:
            raise HTTPException(400, "퇴사일은 입사일보다 빠를 수 없습니다.")
        if payload.department not in {d["code"] for d in departments()} | {"UNASSIGNED"}:
            raise HTTPException(400, "등록된 사업부를 선택해 주세요.")
        duplicate = next((e for e in events if e["effective_from"] == payload.effectiveFrom.isoformat()), None)
        if duplicate and payload.effectiveFrom != original_day:
            raise HTTPException(409, "같은 적용일의 이력이 있습니다. 해당 이력을 수정해 주세요.")
    if original_day:
        original = next((e for e in events if e["effective_from"] == original_day.isoformat()), None)
        if not original or original["version_token"] != version:
            raise HTTPException(409, "다른 사용자가 이력을 변경했습니다. 다시 조회해 주세요.")
        if not payload and len(events) <= 1:
            raise HTTPException(409, "마지막 이력은 삭제할 수 없습니다. 내용을 수정해 주세요.")
        cursor.execute(SqlLoader.get_sql("USER_HISTORY_DELETE"), {"userId": user_id, "effectiveFrom": original_day, "versionToken": version})
        if cursor.rowcount != 1:
            raise HTTPException(409, "이력이 변경되었습니다. 다시 조회해 주세요.")
    if payload:
        current = rows(cursor, SqlLoader.get_sql("ANNUAL_USER_PROFILE"), {"userId": user_id})[0]
        label = next((d["label"] for d in departments() if d["code"] == payload.department), "미지정")
        save_profile(cursor, user_id, payload.effectiveFrom, {**current, "department_code": payload.department,
            "department_name": label, "employment_type_code": payload.employmentType,
            "employment_status_code": payload.employmentStatus, "hire_date": payload.hireDate, "retirement_date": payload.retirementDate})
    events = rows(cursor, SqlLoader.get_sql("ANNUAL_HISTORY_USER_GET"), {"userId": user_id})
    current = profile_at(events, date.today())
    if not current:
        raise HTTPException(400, "현재에 적용할 이력이 하나 이상 필요합니다.")
    cursor.execute(SqlLoader.get_sql("USER_HISTORY_SYNC_CURRENT"), {"userId": user_id,
        "department": current["department_code"], "departmentName": current["department_name"],
        "employmentType": current["employment_type_code"], "employmentStatus": current["employment_status_code"],
        "hireDate": as_date(current["hire_date"]), "retirementDate": as_date(current["retirement_date"])})
    return get_history(cursor, user_id)
