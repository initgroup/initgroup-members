from __future__ import annotations

import logging
import os
import re
import secrets
import string
from datetime import date, datetime
from pathlib import Path
from typing import Any

import oracledb
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from backend.auth_context import get_request_user_id, require_admin_role
from backend.database import get_db_connection
from backend.database_errors import raise_database_http_error
from backend.database_helper import SqlLoader
from backend.department_config import enrich_department, resolve_department
from backend.passwords import hash_password


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_admin_role)])
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_TEMPORARY_PASSWORD_LENGTH = 16
_TEMPORARY_PASSWORD_SPECIALS = "!@#$%*-_"
_GENDER_CODES = {"MALE", "FEMALE", "OTHER", "UNDISCLOSED"}
_BIRTH_CALENDAR_CODES = {"SOLAR", "LUNAR"}
_EMPLOYMENT_STATUS_CODES = {"ACTIVE", "LEAVE", "RETIRED"}
_EMPLOYMENT_TYPE_CODES = {"REGULAR", "CONTRACT", "EXECUTIVE", "INTERN", "DISPATCH", "OTHER"}
_TECHNICAL_GRADE_CODES = {"PROFESSIONAL_ENGINEER", "SPECIAL", "ADVANCED", "INTERMEDIATE", "BEGINNER"}
_PHOTO_TYPES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/webp": (b"RIFF",),
}
_ADMIN_USER_PROFILE_BINDS = {
    "employeeNo", "genderCode", "birthDate", "birthCalendarCode", "hireDate",
    "retirementDate", "employmentStatusCode", "employmentTypeCode", "departmentName", "departmentCode",
    "positionName", "jobTitle", "workLocation", "mobilePhone", "officePhone", "hrNote",
    "technicalGradeCode", "careerMonths",
}
_ADMIN_USER_BASE_BINDS = {"loginId", "userName", "email", "roleCode", "useYn"}
SqlLoader.register_bind_contract(
    "ADMIN_USER_INSERT",
    _ADMIN_USER_BASE_BINDS | _ADMIN_USER_PROFILE_BINDS | {"passwordHash"},
)
SqlLoader.register_bind_contract(
    "ADMIN_USER_UPDATE",
    _ADMIN_USER_BASE_BINDS | _ADMIN_USER_PROFILE_BINDS | {"userId"},
)


class EmployeeProfileRequest(BaseModel):
    employeeNo: str | None = Field(default=None, max_length=100)
    genderCode: str | None = Field(default=None, max_length=20)
    birthDate: date | None = None
    birthCalendarCode: str = Field(default="SOLAR", max_length=20)
    hireDate: date | None = None
    retirementDate: date | None = None
    employmentStatusCode: str = Field(default="ACTIVE", max_length=30)
    employmentTypeCode: str | None = Field(default=None, max_length=30)
    departmentName: str | None = Field(default=None, max_length=200)
    departmentCode: str | None = Field(default=None, max_length=50)
    positionName: str | None = Field(default=None, max_length=100)
    jobTitle: str | None = Field(default=None, max_length=100)
    workLocation: str | None = Field(default=None, max_length=200)
    mobilePhone: str | None = Field(default=None, max_length=50)
    officePhone: str | None = Field(default=None, max_length=50)
    hrNote: str | None = Field(default=None, max_length=2000)
    technicalGradeCode: str | None = Field(default=None, max_length=30)
    careerMonths: int | None = Field(default=None, ge=0, le=1200)


class UserUpdateRequest(EmployeeProfileRequest):
    loginId: str = Field(max_length=100)
    userName: str = Field(max_length=200)
    email: str = Field(max_length=300)
    roleCode: str = Field(max_length=30)
    useYn: str = Field(max_length=3)
    model_config = ConfigDict(extra="forbid")


class UserCreateRequest(EmployeeProfileRequest):
    loginId: str = Field(max_length=100)
    userName: str = Field(max_length=200)
    email: str = Field(max_length=300)
    roleCode: str = Field(default="USER", max_length=30)
    useYn: str = Field(default="Y", max_length=3)
    model_config = ConfigDict(extra="forbid")


def _serialize(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "read"):
        return value.read()
    return value


def _camel_key(value: str) -> str:
    parts = str(value or "").lower().split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _rows(cursor) -> list[dict[str, Any]]:
    columns = [description[0] for description in cursor.description or []]
    return [
        enrich_department(
            {_camel_key(column): _serialize(value) for column, value in zip(columns, row)},
            allow_legacy_label=True,
        )
        for row in cursor.fetchall()
    ]


def _normalize_use_yn(value: str, *, allow_all: bool = False) -> str:
    normalized = str(value or "").strip().upper()
    allowed = {"Y", "N"}
    if allow_all:
        allowed.add("ALL")
    if normalized not in allowed:
        raise HTTPException(status_code=400, detail="useYn must be Y, N, or ALL.")
    return normalized


def _temporary_password(length: int = _TEMPORARY_PASSWORD_LENGTH) -> str:
    alphabet = string.ascii_letters + string.digits + _TEMPORARY_PASSWORD_SPECIALS
    random_part = "".join(secrets.choice(alphabet) for _ in range(max(8, length - 4)))
    return f"Aa1!{random_part}"


def _password_policy(*, existing_sessions_revoked: bool) -> dict[str, Any]:
    return {
        "length": _TEMPORARY_PASSWORD_LENGTH,
        "requiredCharacterTypes": ["uppercase", "lowercase", "digit", "special"],
        "allowedSpecialCharacters": _TEMPORARY_PASSWORD_SPECIALS,
        "existingSessionsRevoked": existing_sessions_revoked,
    }


def _validated_user_values(
    login_id_value: str,
    user_name_value: str,
    email_value: str,
    role_code_value: str,
    use_yn_value: str,
) -> tuple[str, str, str, str, str]:
    login_id = login_id_value.strip()
    user_name = user_name_value.strip()
    email = email_value.strip().lower()
    role_code = role_code_value.strip().upper()
    use_yn = _normalize_use_yn(use_yn_value)
    if not login_id:
        raise HTTPException(status_code=400, detail="Login ID is required.")
    if not user_name:
        raise HTTPException(status_code=400, detail="User name is required.")
    if not _EMAIL_PATTERN.fullmatch(email):
        raise HTTPException(status_code=400, detail="A valid email address is required.")
    if role_code not in {"USER", "ADMIN"}:
        raise HTTPException(status_code=400, detail="roleCode must be USER or ADMIN.")
    return login_id, user_name, email, role_code, use_yn


def _optional_text(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _optional_code(value: str | None, allowed: set[str], field_name: str) -> str | None:
    normalized = str(value or "").strip().upper()
    if not normalized:
        return None
    if normalized not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported {field_name}.")
    return normalized


def _profile_values(payload: EmployeeProfileRequest) -> dict[str, Any]:
    birth_calendar_code = str(payload.birthCalendarCode or "SOLAR").strip().upper()
    employment_status_code = str(payload.employmentStatusCode or "ACTIVE").strip().upper()
    if birth_calendar_code not in _BIRTH_CALENDAR_CODES:
        raise HTTPException(status_code=400, detail="Unsupported birthCalendarCode.")
    if employment_status_code not in _EMPLOYMENT_STATUS_CODES:
        raise HTTPException(status_code=400, detail="Unsupported employmentStatusCode.")
    if payload.birthDate and payload.birthDate > date.today():
        raise HTTPException(status_code=400, detail="birthDate must not be in the future.")
    if payload.hireDate and payload.retirementDate and payload.retirementDate < payload.hireDate:
        raise HTTPException(status_code=400, detail="retirementDate must not be earlier than hireDate.")
    try:
        department = resolve_department(payload.departmentCode, payload.departmentName)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "employeeNo": _optional_text(payload.employeeNo),
        "genderCode": _optional_code(payload.genderCode, _GENDER_CODES, "genderCode"),
        "birthDate": payload.birthDate,
        "birthCalendarCode": birth_calendar_code,
        "hireDate": payload.hireDate,
        "retirementDate": payload.retirementDate,
        "employmentStatusCode": employment_status_code,
        "employmentTypeCode": _optional_code(
            payload.employmentTypeCode,
            _EMPLOYMENT_TYPE_CODES,
            "employmentTypeCode",
        ),
        "departmentName": department["label"] if department else None,
        "departmentCode": department["code"] if department else None,
        "positionName": _optional_text(payload.positionName),
        "jobTitle": _optional_text(payload.jobTitle),
        "workLocation": _optional_text(payload.workLocation),
        "mobilePhone": _optional_text(payload.mobilePhone),
        "officePhone": _optional_text(payload.officePhone),
        "hrNote": _optional_text(payload.hrNote),
        "technicalGradeCode": _optional_code(
            payload.technicalGradeCode,
            _TECHNICAL_GRADE_CODES,
            "technicalGradeCode",
        ),
        "careerMonths": payload.careerMonths,
    }


def _photo_max_bytes() -> int:
    try:
        configured_bytes = int(os.getenv("APP_USER_PHOTO_MAX_BYTES", str(5 * 1024 * 1024)))
    except (TypeError, ValueError):
        configured_bytes = 5 * 1024 * 1024
    return max(1024, min(configured_bytes, 10 * 1024 * 1024))


def _validated_photo_type(content_type: str, file_data: bytes) -> str:
    normalized = str(content_type or "").split(";", 1)[0].strip().lower()
    signatures = _PHOTO_TYPES.get(normalized)
    signature_matches = signatures and any(file_data.startswith(signature) for signature in signatures)
    if normalized == "image/webp":
        signature_matches = signature_matches and len(file_data) >= 12 and file_data[8:12] == b"WEBP"
    if not signature_matches:
        raise HTTPException(status_code=400, detail="Only valid JPEG, PNG, GIF, or WebP images are allowed.")
    return normalized


def _safe_photo_name(value: str) -> str:
    file_name = Path(str(value or "profile-image")).name
    file_name = re.sub(r"[\x00-\x1f\x7f]+", "_", file_name).strip()
    return file_name[:500] or "profile-image"


@router.post("")
def create_user(payload: UserCreateRequest):
    login_id, user_name, email, role_code, use_yn = _validated_user_values(
        payload.loginId,
        payload.userName,
        payload.email,
        payload.roleCode,
        payload.useYn,
    )
    profile = _profile_values(payload)
    temporary_password = _temporary_password()
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("ADMIN_USER_TABLE_LOCK"))
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_CREATE_DUPLICATE_COUNT"),
            {"loginId": login_id, "email": email, "employeeNo": profile["employeeNo"]},
        )
        if int(cursor.fetchone()[0] or 0) > 0:
            raise HTTPException(
                status_code=409,
                detail="Login ID or email is already used by another user.",
            )

        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_INSERT"),
            {
                "loginId": login_id,
                "userName": user_name,
                "email": email,
                "passwordHash": hash_password(temporary_password),
                "roleCode": role_code,
                "useYn": use_yn,
                **profile,
            },
        )
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_ID_BY_LOGIN"),
            {"loginId": login_id},
        )
        row = cursor.fetchone()
        if not row:
            raise RuntimeError("Created user could not be reloaded.")
        user_id = int(row[0])
        conn.commit()
        return {
            "status": "success",
            "message": "User created with a temporary password.",
            "data": {
                "userId": user_id,
                "loginId": login_id,
                "userName": user_name,
                "email": email,
                "roleCode": role_code,
                "useYn": use_yn,
                "passwordChangeYn": "N",
                **profile,
                "temporaryPassword": temporary_password,
                "passwordPolicy": _password_policy(existing_sessions_revoked=False),
            },
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Administrator user creation failed.")
        raise_database_http_error(exc, default_detail="User could not be created.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("")
def list_users(
    keyword: str = Query("", max_length=200),
    useYn: str = Query("ALL"),
    page: int = Query(1, ge=1, le=100_000),
    pageSize: int = Query(100, ge=1, le=100),
):
    normalized_keyword = keyword.strip().upper()
    filters = {
        "keyword": f"%{normalized_keyword}%" if normalized_keyword else None,
        "useYn": _normalize_use_yn(useYn, allow_all=True),
    }
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("ADMIN_USER_COUNT"), filters)
        total = int(cursor.fetchone()[0] or 0)
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_LIST"),
            {
                **filters,
                "offset": (page - 1) * pageSize,
                "pageSize": pageSize,
            },
        )
        items = _rows(cursor)
        total_pages = max(1, (total + pageSize - 1) // pageSize)
        return {
            "status": "success",
            "data": {
                "items": items,
                "page": page,
                "pageSize": pageSize,
                "total": total,
                "totalPages": total_pages,
            },
            "total": total,
        }
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.patch("/{user_id}")
def update_user(user_id: int, payload: UserUpdateRequest, request: Request):
    actor_user_id = get_request_user_id(request)
    login_id, user_name, email, role_code, use_yn = _validated_user_values(
        payload.loginId,
        payload.userName,
        payload.email,
        payload.roleCode,
        payload.useYn,
    )
    profile = _profile_values(payload)
    if actor_user_id == user_id and (role_code != "ADMIN" or use_yn != "Y"):
        raise HTTPException(status_code=400, detail="You cannot remove your own active administrator access.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("ADMIN_USER_TABLE_LOCK"))
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_ROLE_STATUS"),
            {"userId": user_id},
        )
        current_row = cursor.fetchone()
        if not current_row:
            raise HTTPException(status_code=404, detail="User was not found.")

        removes_active_admin = (
            str(current_row[0] or "").strip().upper() == "ADMIN"
            and str(current_row[1] or "").strip().upper() == "Y"
            and (role_code != "ADMIN" or use_yn != "Y")
        )
        if removes_active_admin:
            cursor.execute(SqlLoader.get_sql("ADMIN_ACTIVE_ADMIN_COUNT"))
            active_admin_count = int(cursor.fetchone()[0] or 0)
            if active_admin_count <= 1:
                raise HTTPException(
                    status_code=409,
                    detail="At least one active administrator is required.",
                )

        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_DUPLICATE_COUNT"),
            {
                "loginId": login_id,
                "email": email,
                "employeeNo": profile["employeeNo"],
                "userId": user_id,
            },
        )
        if int(cursor.fetchone()[0] or 0) > 0:
            raise HTTPException(
                status_code=409,
                detail="Login ID or email is already used by another user.",
            )

        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_UPDATE"),
            {
                "loginId": login_id,
                "userName": user_name,
                "email": email,
                "roleCode": role_code,
                "useYn": use_yn,
                "userId": user_id,
                **profile,
            },
        )
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="User was not found.")
        if use_yn == "N":
            cursor.execute(
                SqlLoader.get_sql("ADMIN_USER_SESSION_REVOKE"),
                {"userId": user_id},
            )
        conn.commit()
        return {
            "status": "success",
            "data": {
                "userId": user_id,
                "loginId": login_id,
                "userName": user_name,
                "email": email,
                "roleCode": role_code,
                "useYn": use_yn,
                **profile,
            },
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Administrator user update failed.")
        raise_database_http_error(exc, default_detail="User could not be updated.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def _store_user_photo(
    user_id: int,
    file_name: str,
    content_type: str,
    file_data: bytes,
) -> dict[str, Any]:
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.setinputsizes(photoData=oracledb.DB_TYPE_BLOB)
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_PHOTO_UPDATE"),
            {
                "photoFileName": file_name,
                "photoContentType": content_type,
                "photoFileSize": len(file_data),
                "photoData": file_data,
                "userId": user_id,
            },
        )
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="User was not found.")
        conn.commit()
        return {
            "status": "success",
            "data": {
                "userId": user_id,
                "photoFileName": file_name,
                "photoContentType": content_type,
                "photoFileSize": len(file_data),
            },
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Employee profile photo upload failed.")
        raise_database_http_error(exc, default_detail="Profile photo could not be uploaded.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/{user_id}/photo")
async def upload_user_photo(user_id: int, file: UploadFile = File(...)):
    max_bytes = _photo_max_bytes()
    try:
        file_data = await file.read(max_bytes + 1)
        if not file_data:
            raise HTTPException(status_code=400, detail="Profile photo is empty.")
        if len(file_data) > max_bytes:
            raise HTTPException(status_code=413, detail="Profile photo exceeds the server size limit.")
        content_type = _validated_photo_type(file.content_type or "", file_data)
        file_name = _safe_photo_name(file.filename or "profile-image")
        return await run_in_threadpool(
            _store_user_photo,
            user_id,
            file_name,
            content_type,
            file_data,
        )
    finally:
        await file.close()


@router.get("/{user_id}/photo")
def get_user_photo(user_id: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("ADMIN_USER_PHOTO_DOWNLOAD"), {"userId": user_id})
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Profile photo was not found.")
        file_data = _serialize(row[1]) or b""
        if isinstance(file_data, str):
            file_data = file_data.encode("utf-8")
        return Response(
            content=file_data,
            media_type=row[0] or "application/octet-stream",
            headers={
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox",
            },
        )
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.delete("/{user_id}/photo")
def delete_user_photo(user_id: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("ADMIN_USER_PHOTO_DELETE"), {"userId": user_id})
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="Profile photo was not found.")
        conn.commit()
        return {"status": "success", "data": {"userId": user_id}}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Employee profile photo delete failed.")
        raise_database_http_error(exc, default_detail="Profile photo could not be deleted.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.delete("/{user_id}")
def delete_user(user_id: int, request: Request):
    actor_user_id = get_request_user_id(request)
    if actor_user_id == user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("ADMIN_USER_TABLE_LOCK"))
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_ROLE_STATUS"),
            {"userId": user_id},
        )
        current_row = cursor.fetchone()
        if not current_row:
            raise HTTPException(status_code=404, detail="User was not found.")

        deletes_active_admin = (
            str(current_row[0] or "").strip().upper() == "ADMIN"
            and str(current_row[1] or "").strip().upper() == "Y"
        )
        if deletes_active_admin:
            cursor.execute(SqlLoader.get_sql("ADMIN_ACTIVE_ADMIN_COUNT"))
            active_admin_count = int(cursor.fetchone()[0] or 0)
            if active_admin_count <= 1:
                raise HTTPException(
                    status_code=409,
                    detail="At least one active administrator is required.",
                )

        cursor.execute(SqlLoader.get_sql("ADMIN_USER_DELETE"), {"userId": user_id})
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="User was not found.")
        conn.commit()
        return {
            "status": "success",
            "message": "User deleted.",
            "data": {"userId": user_id},
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Administrator user deletion failed.")
        raise_database_http_error(
            exc,
            default_detail="User could not be deleted.",
            conflict_details={
                2292: "User is referenced by business history and cannot be deleted. Disable the user instead."
            },
        )
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/{user_id}/reset-password")
def reset_password(user_id: int):
    temporary_password = _temporary_password()
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_PASSWORD_RESET"),
            {"passwordHash": hash_password(temporary_password), "userId": user_id},
        )
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="User was not found.")
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_IDENTITY"),
            {"userId": user_id},
        )
        identity_row = cursor.fetchone()
        if not identity_row:
            raise HTTPException(status_code=404, detail="User was not found.")
        cursor.execute(
            SqlLoader.get_sql("ADMIN_USER_SESSION_REVOKE"),
            {"userId": user_id},
        )
        conn.commit()
        return {
            "status": "success",
            "message": "Temporary password created.",
            "data": {
                "userId": user_id,
                "loginId": identity_row[0],
                "userName": identity_row[1],
                "temporaryPassword": temporary_password,
                "passwordChangeYn": "N",
                "passwordPolicy": _password_policy(existing_sessions_revoked=True),
            },
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Administrator password reset failed.")
        raise_database_http_error(exc, default_detail="Password could not be reset.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
