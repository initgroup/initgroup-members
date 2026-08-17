from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import oracledb
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.auth_context import get_request_user_id, require_admin_role
from backend.database import get_db_connection
from backend.database_helper import SqlLoader


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_admin_role)])
_HISTORY_TYPES = {"ESTABLISHED", "NAME_CHANGE", "ADDRESS_CHANGE", "CERTIFICATION", "OTHER"}


class CompanyWriteRequest(BaseModel):
    companyName: str = Field(max_length=200)
    businessNumber: str = Field(default="", max_length=30)
    representativeName: str = Field(default="", max_length=100)
    businessType: str = Field(default="", max_length=200)
    businessItem: str = Field(default="", max_length=300)
    email: str = Field(default="", max_length=300)
    phone: str = Field(default="", max_length=50)
    address: str = Field(default="", max_length=500)
    websiteUrl: str = Field(default="", max_length=500)
    establishedDate: date | None = None
    useYn: str = Field(default="Y", max_length=1)
    note: str = Field(default="", max_length=2000)
    model_config = ConfigDict(extra="forbid")


class EmployeeWriteRequest(BaseModel):
    employeeNo: str = Field(default="", max_length=100)
    employeeName: str = Field(max_length=200)
    departmentName: str = Field(default="", max_length=200)
    positionName: str = Field(default="", max_length=100)
    jobTitle: str = Field(default="", max_length=100)
    email: str = Field(default="", max_length=300)
    mobilePhone: str = Field(default="", max_length=50)
    joinDate: date | None = None
    leaveDate: date | None = None
    useYn: str = Field(default="Y", max_length=1)
    note: str = Field(default="", max_length=2000)
    model_config = ConfigDict(extra="forbid")


class HistoryWriteRequest(BaseModel):
    historyDate: date
    historyTypeCode: str = Field(default="OTHER", max_length=30)
    title: str = Field(max_length=300)
    content: str = Field(default="", max_length=2000)
    model_config = ConfigDict(extra="forbid")


def _serialize(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return value.read() if hasattr(value, "read") else value


def _camel_key(value: str) -> str:
    parts = str(value or "").lower().split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _rows(cursor) -> list[dict[str, Any]]:
    columns = [item[0] for item in cursor.description or []]
    return [
        {_camel_key(column): _serialize(value) for column, value in zip(columns, row)}
        for row in cursor.fetchall()
    ]


def _raise_company_read_error(exc: Exception) -> None:
    oracle_code = getattr(exc.args[0], "code", None) if getattr(exc, "args", None) else None
    if oracle_code in {904, 942}:
        raise HTTPException(
            status_code=503,
            detail=(
                "회사 관리 스키마가 설치되지 않았습니다. "
                "database/INIT_SYSTEM_ALT.sql을 시스템 DB에 적용해 주세요."
            ),
        ) from exc
    raise HTTPException(status_code=500, detail="회사 정보를 조회하지 못했습니다.") from exc


def _optional(value: str) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _use_yn(value: str) -> str:
    normalized = str(value or "").strip().upper()
    if normalized not in {"Y", "N"}:
        raise HTTPException(status_code=400, detail="사용 여부는 Y 또는 N이어야 합니다.")
    return normalized


def _company_params(payload: CompanyWriteRequest, company_type: str, user_id: int) -> dict[str, Any]:
    company_name = payload.companyName.strip()
    if not company_name:
        raise HTTPException(status_code=400, detail="회사명을 입력해 주세요.")
    return {
        "companyTypeCode": company_type,
        "companyName": company_name,
        "businessNumber": _optional(payload.businessNumber),
        "representativeName": _optional(payload.representativeName),
        "businessType": _optional(payload.businessType),
        "businessItem": _optional(payload.businessItem),
        "email": _optional(payload.email),
        "phone": _optional(payload.phone),
        "address": _optional(payload.address),
        "websiteUrl": _optional(payload.websiteUrl),
        "establishedDate": payload.establishedDate,
        "useYn": _use_yn(payload.useYn),
        "note": _optional(payload.note),
        "userId": user_id,
    }


def _employee_params(payload: EmployeeWriteRequest, user_id: int) -> dict[str, Any]:
    employee_name = payload.employeeName.strip()
    if not employee_name:
        raise HTTPException(status_code=400, detail="직원명을 입력해 주세요.")
    if payload.joinDate and payload.leaveDate and payload.joinDate > payload.leaveDate:
        raise HTTPException(status_code=400, detail="퇴사일은 입사일보다 빠를 수 없습니다.")
    return {
        "employeeNo": _optional(payload.employeeNo),
        "employeeName": employee_name,
        "departmentName": _optional(payload.departmentName),
        "positionName": _optional(payload.positionName),
        "jobTitle": _optional(payload.jobTitle),
        "email": _optional(payload.email),
        "mobilePhone": _optional(payload.mobilePhone),
        "joinDate": payload.joinDate,
        "leaveDate": payload.leaveDate,
        "useYn": _use_yn(payload.useYn),
        "note": _optional(payload.note),
        "userId": user_id,
    }


def _history_params(payload: HistoryWriteRequest, user_id: int) -> dict[str, Any]:
    history_type = payload.historyTypeCode.strip().upper()
    if history_type not in _HISTORY_TYPES:
        raise HTTPException(status_code=400, detail="지원하지 않는 이력 유형입니다.")
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="이력 제목을 입력해 주세요.")
    return {
        "historyDate": payload.historyDate,
        "historyTypeCode": history_type,
        "title": title,
        "content": _optional(payload.content),
        "userId": user_id,
    }


def _company_list(cursor, company_type: str) -> list[dict[str, Any]]:
    cursor.execute(SqlLoader.get_sql("COMPANY_LIST_BY_TYPE"), {"companyTypeCode": company_type})
    return _rows(cursor)


def _ensure_company(cursor, company_id: int, company_type: str) -> None:
    cursor.execute(
        SqlLoader.get_sql("COMPANY_EXISTS_TYPE"),
        {"companyId": company_id, "companyTypeCode": company_type},
    )
    if int(cursor.fetchone()[0] or 0) <= 0:
        raise HTTPException(status_code=404, detail="회사를 찾을 수 없습니다.")


def _insert_company(cursor, params: dict[str, Any]) -> int:
    output = cursor.var(oracledb.DB_TYPE_NUMBER)
    cursor.execute(SqlLoader.get_sql("COMPANY_INSERT"), {**params, "companyIdOut": output})
    value = output.getvalue()
    return int(value[0] if isinstance(value, list) else value)


def _get_or_create_freelancer_company(cursor, user_id: int) -> int:
    companies = _company_list(cursor, "FREELANCER")
    if companies:
        return int(companies[0]["companyId"])
    return _insert_company(cursor, {
        "companyTypeCode": "FREELANCER",
        "companyName": "프리랜서",
        "businessNumber": None,
        "representativeName": None,
        "businessType": None,
        "businessItem": None,
        "email": None,
        "phone": None,
        "address": None,
        "websiteUrl": None,
        "establishedDate": None,
        "useYn": "Y",
        "note": "프리랜서 소속 구분용 시스템 회사",
        "userId": user_id,
    })


def _save_employee(
    company_id: int,
    company_type: str,
    employee_id: int | None,
    payload: EmployeeWriteRequest,
    request: Request,
) -> dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        _ensure_company(cursor, company_id, company_type)
        params = {**_employee_params(payload, get_request_user_id(request)), "companyId": company_id}
        if employee_id:
            cursor.execute(
                SqlLoader.get_sql("COMPANY_EMPLOYEE_UPDATE"),
                {**params, "companyTypeCode": company_type, "companyEmployeeId": employee_id},
            )
            if cursor.rowcount <= 0:
                raise HTTPException(status_code=404, detail="직원을 찾을 수 없습니다.")
        else:
            output = cursor.var(oracledb.DB_TYPE_NUMBER)
            cursor.execute(
                SqlLoader.get_sql("COMPANY_EMPLOYEE_INSERT"),
                {**params, "companyEmployeeIdOut": output},
            )
            value = output.getvalue()
            employee_id = int(value[0] if isinstance(value, list) else value)
        conn.commit()
        return {"status": "success", "data": {"companyEmployeeId": employee_id}}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Company employee save failed.")
        raise HTTPException(status_code=409, detail="직원 정보를 저장하지 못했습니다. 사번 중복 여부를 확인해 주세요.") from exc
    finally:
        cursor.close()
        conn.close()


def _delete_employee(company_id: int, company_type: str, employee_id: int) -> dict[str, str]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            SqlLoader.get_sql("COMPANY_EMPLOYEE_DELETE"),
            {"companyId": company_id, "companyTypeCode": company_type, "companyEmployeeId": employee_id},
        )
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="직원을 찾을 수 없습니다.")
        conn.commit()
        return {"status": "success"}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Company employee deletion failed.")
        raise HTTPException(status_code=409, detail="프로젝트 투입에 연결된 직원은 삭제할 수 없습니다.") from exc
    finally:
        cursor.close()
        conn.close()


@router.get("/partners")
def list_partners():
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        return {"status": "success", "data": {"companies": _company_list(cursor, "PARTNER")}}
    except Exception as exc:
        logger.exception("Partner company list query failed.")
        _raise_company_read_error(exc)
    finally:
        cursor.close()
        conn.close()


@router.post("/partners")
def create_partner(payload: CompanyWriteRequest, request: Request):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        company_id = _insert_company(cursor, _company_params(payload, "PARTNER", get_request_user_id(request)))
        conn.commit()
        return {"status": "success", "data": {"companyId": company_id}}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Partner company creation failed.")
        raise HTTPException(status_code=409, detail="협력업체를 저장하지 못했습니다. 회사명 또는 사업자번호를 확인해 주세요.") from exc
    finally:
        cursor.close()
        conn.close()


@router.put("/partners/{company_id}")
def update_partner(company_id: int, payload: CompanyWriteRequest, request: Request):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            SqlLoader.get_sql("COMPANY_UPDATE"),
            {**_company_params(payload, "PARTNER", get_request_user_id(request)), "companyId": company_id},
        )
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="협력업체를 찾을 수 없습니다.")
        conn.commit()
        return {"status": "success"}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Partner company update failed.")
        raise HTTPException(status_code=409, detail="협력업체를 저장하지 못했습니다. 회사명 또는 사업자번호를 확인해 주세요.") from exc
    finally:
        cursor.close()
        conn.close()


@router.delete("/partners/{company_id}")
def delete_partner(company_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            SqlLoader.get_sql("COMPANY_DELETE"),
            {"companyId": company_id, "companyTypeCode": "PARTNER"},
        )
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="협력업체를 찾을 수 없습니다.")
        conn.commit()
        return {"status": "success"}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Partner company deletion failed.")
        raise HTTPException(status_code=409, detail="직원 또는 프로젝트에 연결된 협력업체는 삭제할 수 없습니다.") from exc
    finally:
        cursor.close()
        conn.close()


@router.get("/partners/{company_id}/employees")
def list_partner_employees(company_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        _ensure_company(cursor, company_id, "PARTNER")
        cursor.execute(
            SqlLoader.get_sql("COMPANY_EMPLOYEE_LIST"),
            {"companyId": company_id, "companyTypeCode": "PARTNER"},
        )
        return {"status": "success", "data": {"employees": _rows(cursor)}}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Partner employee list query failed.")
        _raise_company_read_error(exc)
    finally:
        cursor.close()
        conn.close()


@router.post("/partners/{company_id}/employees")
def create_partner_employee(company_id: int, payload: EmployeeWriteRequest, request: Request):
    return _save_employee(company_id, "PARTNER", None, payload, request)


@router.put("/partners/{company_id}/employees/{employee_id}")
def update_partner_employee(company_id: int, employee_id: int, payload: EmployeeWriteRequest, request: Request):
    return _save_employee(company_id, "PARTNER", employee_id, payload, request)


@router.delete("/partners/{company_id}/employees/{employee_id}")
def delete_partner_employee(company_id: int, employee_id: int):
    return _delete_employee(company_id, "PARTNER", employee_id)


@router.get("/headquarters")
def get_headquarters():
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        companies = _company_list(cursor, "HEADQUARTERS")
        company = companies[0] if companies else None
        histories: list[dict[str, Any]] = []
        if company:
            cursor.execute(SqlLoader.get_sql("COMPANY_HISTORY_LIST"), {"companyId": company["companyId"]})
            histories = _rows(cursor)
        return {"status": "success", "data": {"company": company, "histories": histories}}
    except Exception as exc:
        logger.exception("Headquarters query failed.")
        _raise_company_read_error(exc)
    finally:
        cursor.close()
        conn.close()


@router.put("/headquarters")
def save_headquarters(payload: CompanyWriteRequest, request: Request):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        user_id = get_request_user_id(request)
        companies = _company_list(cursor, "HEADQUARTERS")
        params = _company_params(payload, "HEADQUARTERS", user_id)
        if companies:
            company_id = int(companies[0]["companyId"])
            cursor.execute(SqlLoader.get_sql("COMPANY_UPDATE"), {**params, "companyId": company_id})
        else:
            company_id = _insert_company(cursor, params)
        conn.commit()
        return {"status": "success", "data": {"companyId": company_id}}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Headquarters save failed.")
        raise HTTPException(status_code=409, detail="본사 정보를 저장하지 못했습니다. 회사명 또는 사업자번호를 확인해 주세요.") from exc
    finally:
        cursor.close()
        conn.close()


@router.post("/headquarters/{company_id}/histories")
def create_history(company_id: int, payload: HistoryWriteRequest, request: Request):
    return _save_history(company_id, None, payload, request)


@router.put("/headquarters/{company_id}/histories/{history_id}")
def update_history(company_id: int, history_id: int, payload: HistoryWriteRequest, request: Request):
    return _save_history(company_id, history_id, payload, request)


def _save_history(
    company_id: int,
    history_id: int | None,
    payload: HistoryWriteRequest,
    request: Request,
) -> dict[str, Any]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        _ensure_company(cursor, company_id, "HEADQUARTERS")
        params = {**_history_params(payload, get_request_user_id(request)), "companyId": company_id}
        if history_id:
            cursor.execute(
                SqlLoader.get_sql("COMPANY_HISTORY_UPDATE"),
                {**params, "companyHistoryId": history_id},
            )
            if cursor.rowcount <= 0:
                raise HTTPException(status_code=404, detail="회사 이력을 찾을 수 없습니다.")
        else:
            output = cursor.var(oracledb.DB_TYPE_NUMBER)
            cursor.execute(
                SqlLoader.get_sql("COMPANY_HISTORY_INSERT"),
                {**params, "companyHistoryIdOut": output},
            )
            value = output.getvalue()
            history_id = int(value[0] if isinstance(value, list) else value)
        conn.commit()
        return {"status": "success", "data": {"companyHistoryId": history_id}}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Headquarters history save failed.")
        raise HTTPException(status_code=500, detail="회사 이력을 저장하지 못했습니다.") from exc
    finally:
        cursor.close()
        conn.close()


@router.delete("/headquarters/{company_id}/histories/{history_id}")
def delete_history(company_id: int, history_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            SqlLoader.get_sql("COMPANY_HISTORY_DELETE"),
            {"companyId": company_id, "companyHistoryId": history_id},
        )
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="회사 이력을 찾을 수 없습니다.")
        conn.commit()
        return {"status": "success"}
    except HTTPException:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


@router.get("/freelancers")
def list_freelancers():
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        companies = _company_list(cursor, "FREELANCER")
        company = companies[0] if companies else None
        employees: list[dict[str, Any]] = []
        if company:
            cursor.execute(
                SqlLoader.get_sql("COMPANY_EMPLOYEE_LIST"),
                {"companyId": company["companyId"], "companyTypeCode": "FREELANCER"},
            )
            employees = _rows(cursor)
        return {"status": "success", "data": {"company": company, "employees": employees}}
    except Exception as exc:
        logger.exception("Freelancer list query failed.")
        _raise_company_read_error(exc)
    finally:
        cursor.close()
        conn.close()


@router.post("/freelancers/employees")
def create_freelancer(payload: EmployeeWriteRequest, request: Request):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        user_id = get_request_user_id(request)
        company_id = _get_or_create_freelancer_company(cursor, user_id)
        params = {**_employee_params(payload, user_id), "companyId": company_id}
        output = cursor.var(oracledb.DB_TYPE_NUMBER)
        cursor.execute(
            SqlLoader.get_sql("COMPANY_EMPLOYEE_INSERT"),
            {**params, "companyEmployeeIdOut": output},
        )
        value = output.getvalue()
        employee_id = int(value[0] if isinstance(value, list) else value)
        conn.commit()
        return {"status": "success", "data": {"companyId": company_id, "companyEmployeeId": employee_id}}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Freelancer creation failed.")
        raise HTTPException(status_code=409, detail="프리랜서를 저장하지 못했습니다. 사번 중복 여부를 확인해 주세요.") from exc
    finally:
        cursor.close()
        conn.close()


@router.put("/freelancers/{company_id}/employees/{employee_id}")
def update_freelancer(company_id: int, employee_id: int, payload: EmployeeWriteRequest, request: Request):
    return _save_employee(company_id, "FREELANCER", employee_id, payload, request)


@router.delete("/freelancers/{company_id}/employees/{employee_id}")
def delete_freelancer(company_id: int, employee_id: int):
    return _delete_employee(company_id, "FREELANCER", employee_id)
