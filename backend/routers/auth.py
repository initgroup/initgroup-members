from __future__ import annotations

import hmac
import logging
import os
import re

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from backend.auth_context import (
    authenticate_request,
    create_login_session,
    get_session_ttl_seconds,
    revoke_current_session,
    set_session_cookie,
)
from backend.database import get_db_connection
from backend.database_errors import raise_database_http_error
from backend.database_helper import SqlLoader
from backend.passwords import hash_password, verify_password
from backend.portal_access import portal_access_for_role


logger = logging.getLogger(__name__)
router = APIRouter()
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_CORE_TABLES = frozenset(
    {
        "INIT$_TB_USER",
        "INIT$_TB_AUTH_SESSION",
        "INIT$_TB_NOTICE",
        "INIT$_TB_NOTICE_FILE",
    }
)
_REQUIRED_CORE_COLUMNS = {
    "INIT$_TB_USER": frozenset(
        {
            "USER_ID",
            "LOGIN_ID",
            "USER_NAME",
            "EMAIL",
            "PASSWORD_HASH",
            "ROLE_CODE",
            "USE_YN",
            "CREATED_AT",
            "UPDATED_AT",
            "PASSWORD_CHANGE_YN",
        }
    ),
    "INIT$_TB_AUTH_SESSION": frozenset(
        {
            "SESSION_TOKEN_HASH",
            "USER_ID",
            "CREATED_AT",
            "LAST_SEEN_AT",
            "EXPIRES_AT",
            "REVOKED_AT",
        }
    ),
    "INIT$_TB_NOTICE": frozenset(
        {
            "NOTICE_ID",
            "NOTICE_TYPE",
            "TITLE",
            "CONTENT",
            "POST_START_AT",
            "POST_END_AT",
            "PIN_YN",
            "USE_YN",
            "SORT_ORDER",
            "CREATED_BY",
            "CREATED_AT",
            "UPDATED_BY",
            "UPDATED_AT",
        }
    ),
    "INIT$_TB_NOTICE_FILE": frozenset(
        {
            "FILE_ID",
            "NOTICE_ID",
            "FILE_NAME",
            "CONTENT_TYPE",
            "FILE_SIZE",
            "FILE_DATA",
            "SORT_ORDER",
            "USE_YN",
            "CREATED_BY",
            "CREATED_AT",
            "UPDATED_BY",
            "UPDATED_AT",
        }
    ),
}
_USER_TABLE = "INIT$_TB_USER"
_INCOMPLETE_SCHEMA_DETAIL = (
    "시스템 데이터베이스 구성이 완료되지 않았습니다. "
    "신규 데이터베이스는 database/INIT_SYSTEM_DDL.sql을 실행하고, "
    "기존 데이터베이스는 시스템 DB 소유자 계정으로 database/INIT_SYSTEM_ALT.sql을 실행해 주세요."
)
_DUMMY_PASSWORD_HASH = hash_password("")


class SignupRequest(BaseModel):
    loginId: str = Field(max_length=100)
    userName: str = Field(max_length=200)
    email: str = Field(max_length=300)
    password: str = Field(max_length=1024)
    roleCode: str = Field(default="USER", max_length=30)
    adminKey: str = Field(default="", max_length=1024)
    model_config = ConfigDict(extra="forbid")


class LoginRequest(BaseModel):
    loginId: str = Field(max_length=100)
    password: str = Field(max_length=1024)
    model_config = ConfigDict(extra="forbid")


def _core_table_status(cursor) -> set[str]:
    cursor.execute(SqlLoader.get_sql("AUTH_CORE_TABLE_STATUS"))
    return {
        str(row[0] or "").strip().upper()
        for row in cursor.fetchall()
        if row and row[0]
    }


def _core_column_status(cursor) -> dict[str, set[str]]:
    cursor.execute(SqlLoader.get_sql("AUTH_CORE_COLUMN_STATUS"))
    columns_by_table: dict[str, set[str]] = {}
    for row in cursor.fetchall():
        if not row or not row[0] or not row[1]:
            continue
        table_name = str(row[0]).strip().upper()
        column_name = str(row[1]).strip().upper()
        columns_by_table.setdefault(table_name, set()).add(column_name)
    return columns_by_table


def _schema_is_complete(
    table_names: set[str],
    columns_by_table: dict[str, set[str]],
) -> bool:
    if not _CORE_TABLES.issubset(table_names):
        return False
    return all(
        required_columns.issubset(columns_by_table.get(table_name, set()))
        for table_name, required_columns in _REQUIRED_CORE_COLUMNS.items()
    )


def _user_count(cursor) -> int:
    cursor.execute(SqlLoader.get_sql("AUTH_USER_COUNT"))
    row = cursor.fetchone()
    return int(row[0] or 0) if row else 0


def _public_user(row) -> dict:
    return {
        "userId": int(row[0]),
        "loginId": row[1],
        "userName": row[2],
        "email": row[3],
        "roleCode": row[6] or "USER",
        "passwordChangeYn": str(row[7] or "N").strip().upper(),
    }


def _validate_signup(payload: SignupRequest) -> tuple[str, str, str, str]:
    login_id = payload.loginId.strip()
    user_name = payload.userName.strip()
    email = payload.email.strip().lower()
    requested_role = payload.roleCode.strip().upper()
    if not login_id:
        raise HTTPException(status_code=400, detail="로그인 ID를 입력해 주세요.")
    if len(login_id) > 100:
        raise HTTPException(status_code=400, detail="로그인 ID는 100자 이하로 입력해 주세요.")
    if not user_name:
        raise HTTPException(status_code=400, detail="이름을 입력해 주세요.")
    if len(user_name) > 200:
        raise HTTPException(status_code=400, detail="이름은 200자 이하로 입력해 주세요.")
    if not _EMAIL_PATTERN.fullmatch(email):
        raise HTTPException(status_code=400, detail="올바른 이메일 주소를 입력해 주세요.")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="비밀번호는 8자 이상 입력해 주세요.")
    if requested_role not in {"USER", "ADMIN"}:
        raise HTTPException(status_code=400, detail="권한 코드는 USER 또는 ADMIN이어야 합니다.")
    return login_id, user_name, email, requested_role


def _require_first_admin_key(provided_key: str) -> None:
    configured_key = str(os.getenv("INIT_ADMIN_KEY") or "")
    if not configured_key:
        raise HTTPException(status_code=503, detail="최초 관리자 가입 설정이 완료되지 않았습니다.")
    if not hmac.compare_digest(str(provided_key or ""), configured_key):
        raise HTTPException(status_code=403, detail="관리자 가입 키가 올바르지 않습니다.")


@router.get("/admin-contact")
def get_admin_contact():
    return {
        "status": "success",
        "data": {
            "name": os.getenv("INIT_ADMIN_CONTACT_NAME", "시스템 관리자"),
            "email": os.getenv("INIT_ADMIN_CONTACT_EMAIL", ""),
            "phone": os.getenv("INIT_ADMIN_CONTACT_PHONE", ""),
        },
    }


@router.post("/signup")
def signup(payload: SignupRequest):
    login_id, user_name, email, requested_role = _validate_signup(payload)
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        table_names = _core_table_status(cursor)
        columns_by_table = _core_column_status(cursor)
        user_table_exists = _USER_TABLE in table_names
        lock_held = False
        if user_table_exists:
            cursor.execute(SqlLoader.get_sql("AUTH_FIRST_ADMIN_LOCK"))
            lock_held = True
            user_count = _user_count(cursor)
        else:
            user_count = 0

        if user_count > 0 and not _schema_is_complete(
            table_names,
            columns_by_table,
        ):
            raise HTTPException(status_code=503, detail=_INCOMPLETE_SCHEMA_DETAIL)

        if user_count == 0:
            if requested_role != "ADMIN":
                raise HTTPException(
                    status_code=409,
                    detail="최초 계정은 관리자 권한으로 가입해야 합니다.",
                )
            _require_first_admin_key(payload.adminKey)
            if not _schema_is_complete(table_names, columns_by_table):
                try:
                    cursor.execute(SqlLoader.get_sql("INIT_SYSTEM_DDL"))
                except Exception as exc:
                    logger.exception("Core database schema initialization failed.")
                    raise HTTPException(
                        status_code=503,
                        detail=_INCOMPLETE_SCHEMA_DETAIL,
                    ) from exc
                lock_held = False
                table_names = _core_table_status(cursor)
                columns_by_table = _core_column_status(cursor)
                if not _schema_is_complete(table_names, columns_by_table):
                    raise HTTPException(
                        status_code=503,
                        detail=_INCOMPLETE_SCHEMA_DETAIL,
                    )

        if not lock_held:
            cursor.execute(SqlLoader.get_sql("AUTH_FIRST_ADMIN_LOCK"))
        first_user = _user_count(cursor) == 0
        if first_user:
            if requested_role != "ADMIN":
                raise HTTPException(
                    status_code=409,
                    detail="최초 계정은 관리자 권한으로 가입해야 합니다.",
                )
            _require_first_admin_key(payload.adminKey)
            role_code = "ADMIN"
            use_yn = "Y"
        else:
            if requested_role != "USER":
                raise HTTPException(
                    status_code=409,
                    detail="관리자 가입은 최초 시스템 초기화 단계에서만 가능합니다.",
                )
            role_code = "USER"
            use_yn = "N"

        cursor.execute(
            SqlLoader.get_sql("AUTH_SIGNUP_DUPLICATE_COUNT"),
            {"loginId": login_id, "email": email},
        )
        if int(cursor.fetchone()[0] or 0) > 0:
            raise HTTPException(status_code=409, detail="이미 등록된 로그인 ID 또는 이메일입니다.")

        cursor.execute(
            SqlLoader.get_sql("AUTH_SIGNUP_INSERT_USER"),
            {
                "loginId": login_id,
                "userName": user_name,
                "email": email,
                "passwordHash": hash_password(payload.password),
                "roleCode": role_code,
                "useYn": use_yn,
            },
        )
        conn.commit()
        return {
            "status": "success",
            "message": (
                "최초 관리자 계정을 생성했습니다."
                if first_user
                else "가입 신청을 완료했습니다. 관리자 승인 후 로그인할 수 있습니다."
            ),
            "data": {
                "loginId": login_id,
                "roleCode": role_code,
                "useYn": use_yn,
            },
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Signup failed.")
        raise_database_http_error(exc, default_detail="가입 처리 중 오류가 발생했습니다.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response):
    login_id = payload.loginId.strip()
    if not login_id or not payload.password:
        raise HTTPException(status_code=400, detail="로그인 ID와 비밀번호를 입력해 주세요.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        table_names = _core_table_status(cursor)
        columns_by_table = _core_column_status(cursor)
        user_count = _user_count(cursor) if _USER_TABLE in table_names else 0
        if not _schema_is_complete(table_names, columns_by_table):
            if user_count > 0:
                raise HTTPException(status_code=503, detail=_INCOMPLETE_SCHEMA_DETAIL)
            raise HTTPException(
                status_code=503,
                detail="시스템 초기화를 위해 최초 관리자 가입이 필요합니다.",
            )
        if user_count == 0:
            raise HTTPException(
                status_code=503,
                detail="시스템 초기화를 위해 최초 관리자 가입이 필요합니다.",
            )
        cursor.execute(SqlLoader.get_sql("AUTH_LOGIN_USER"), {"loginId": login_id})
        row = cursor.fetchone()
        stored_password_hash = row[4] if row else _DUMMY_PASSWORD_HASH
        password_is_valid = verify_password(payload.password, stored_password_hash or "")
        if not row or not password_is_valid:
            raise HTTPException(status_code=401, detail="로그인 ID 또는 비밀번호가 올바르지 않습니다.")
        if row[5] != "Y":
            raise HTTPException(status_code=403, detail="관리자 승인이 완료되지 않은 계정입니다.")

        token = create_login_session(conn, int(row[0]))
        conn.commit()
        set_session_cookie(response, token, request)
        return {
            "status": "success",
            "message": "로그인되었습니다.",
            "sessionTtlSeconds": get_session_ttl_seconds(),
            "user": _public_user(row),
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Login failed.")
        raise_database_http_error(exc, default_detail="로그인 처리 중 오류가 발생했습니다.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/logout")
def logout(request: Request, response: Response):
    revoke_current_session(request, response)
    return {"status": "success", "message": "로그아웃되었습니다."}


@router.get("/session")
def get_session(request: Request):
    user = authenticate_request(request)
    return {
        "status": "success",
        "sessionTtlSeconds": get_session_ttl_seconds(),
        "user": user,
        "portalAccess": portal_access_for_role(user.get("roleCode", "USER")),
    }
