from __future__ import annotations

import hashlib
import logging
import os
import secrets
from typing import Any, Optional

from fastapi import HTTPException, Request, Response

from backend.database import get_db_connection
from backend.database_errors import raise_database_http_error
from backend.database_helper import SqlLoader


logger = logging.getLogger(__name__)
SESSION_COOKIE_NAME = os.getenv("INIT_SESSION_COOKIE_NAME", "init_session")
SqlLoader.register_bind_contract(
    "AUTH_SESSION_TOUCH",
    {"sessionTokenHash", "ttlSeconds"},
)


def get_session_ttl_seconds() -> int:
    try:
        configured = int(os.getenv("INIT_SESSION_TTL_SECONDS", "28800"))
    except (TypeError, ValueError):
        configured = 28800
    return max(300, min(configured, 7 * 24 * 60 * 60))


def get_auth_query_timeout_ms() -> int:
    try:
        configured = int(os.getenv("INIT_AUTH_QUERY_TIMEOUT_MS", "5000"))
    except (TypeError, ValueError):
        configured = 5000
    return max(1000, min(configured, 15000))


def _is_local_request(request: Optional[Request]) -> bool:
    if request is None or request.client is None:
        return False
    return request.client.host in {"127.0.0.1", "::1", "localhost", "testclient"}


def _cookie_secure(request: Optional[Request]) -> bool:
    configured = str(os.getenv("INIT_COOKIE_SECURE", "")).strip().lower()
    if configured in {"1", "true", "yes", "y"}:
        return True
    if configured in {"0", "false", "no", "n"}:
        return False
    if configured:
        logger.warning(
            "INIT_COOKIE_SECURE has an invalid value; Secure cookies are enforced."
        )
        return True
    return not _is_local_request(request)


def _cookie_samesite() -> str:
    configured = str(os.getenv("INIT_COOKIE_SAMESITE", "lax")).strip().lower()
    return configured if configured in {"lax", "strict"} else "lax"


def _hash_session_token(token: str) -> str:
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()


def _get_session_token(request: Request) -> str:
    return str(request.cookies.get(SESSION_COOKIE_NAME) or "")


def get_current_session_token_hash(request: Request) -> str:
    token = _get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="로그인 세션이 필요합니다.")
    return _hash_session_token(token)


def create_login_session(conn, user_id: int) -> str:
    token = secrets.token_urlsafe(48)
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("AUTH_SESSION_DELETE_EXPIRED"))
        cursor.execute(
            SqlLoader.get_sql("AUTH_SESSION_INSERT"),
            {
                "sessionTokenHash": _hash_session_token(token),
                "userId": int(user_id),
                "ttlSeconds": get_session_ttl_seconds(),
            },
        )
        return token
    finally:
        if cursor:
            cursor.close()


def set_session_cookie(response: Response, token: str, request: Optional[Request] = None) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=get_session_ttl_seconds(),
        httponly=True,
        secure=_cookie_secure(request),
        samesite=_cookie_samesite(),
        path="/",
    )


def refresh_session_cookie(request: Request, response: Response) -> None:
    token = _get_session_token(request)
    if token:
        set_session_cookie(response, token, request)


def clear_session_cookie(response: Response, request: Optional[Request] = None) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=_cookie_secure(request),
        samesite=_cookie_samesite(),
    )


def revoke_current_session(request: Request, response: Optional[Response] = None) -> None:
    token = _get_session_token(request)
    if response is not None:
        clear_session_cookie(response, request)
    if not token:
        return

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        if hasattr(conn, "call_timeout"):
            conn.call_timeout = get_auth_query_timeout_ms()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("AUTH_SESSION_REVOKE"),
            {"sessionTokenHash": _hash_session_token(token)},
        )
        conn.commit()
    except Exception:
        if conn:
            conn.rollback()
        logger.warning("Session revocation failed.", exc_info=True)
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def _row_to_user(row) -> dict[str, Any]:
    return {
        "userId": int(row[0]),
        "loginId": row[1],
        "userName": row[2],
        "email": row[3],
        "roleCode": str(row[4] or "USER").strip().upper(),
        "passwordChangeYn": str(row[5] or "N").strip().upper(),
    }


def authenticate_request(request: Request, *, touch: bool = True) -> dict[str, Any]:
    cached = getattr(request.state, "auth_user", None)
    if cached:
        return cached

    token = _get_session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="로그인 세션이 필요합니다.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        if hasattr(conn, "call_timeout"):
            conn.call_timeout = get_auth_query_timeout_ms()
        cursor = conn.cursor()
        token_hash = _hash_session_token(token)
        cursor.execute(
            SqlLoader.get_sql("AUTH_SESSION_SELECT"),
            {"sessionTokenHash": token_hash},
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="로그인 세션이 만료되었거나 유효하지 않습니다.")
        user = _row_to_user(row)
        if touch:
            cursor.execute(
                SqlLoader.get_sql("AUTH_SESSION_TOUCH"),
                {
                    "sessionTokenHash": token_hash,
                    "ttlSeconds": get_session_ttl_seconds(),
                },
            )
            conn.commit()
        request.state.auth_user = user
        return user
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Login session verification failed.")
        raise_database_http_error(
            exc,
            default_detail="로그인 세션을 확인하지 못했습니다.",
            unavailable_detail="로그인 세션을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        )
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def get_request_user_id(request: Request) -> int:
    return int(authenticate_request(request)["userId"])


def get_request_user_email(request: Request) -> str:
    return str(authenticate_request(request).get("email") or "").strip()


def get_request_login_id(request: Request) -> str:
    return str(authenticate_request(request).get("loginId") or "").strip()


def get_request_role_code(request: Request) -> str:
    return str(authenticate_request(request).get("roleCode") or "USER").strip().upper()


def require_admin_role(request: Request) -> None:
    if get_request_role_code(request) != "ADMIN":
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")
