from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.auth_context import get_request_user_id, require_admin_role
from backend.database import get_db_connection
from backend.database_errors import database_error_status, oracle_error_code, raise_database_http_error
from backend.database_helper import SqlLoader


logger = logging.getLogger(__name__)
public_router = APIRouter()
admin_router = APIRouter(dependencies=[Depends(require_admin_role)])

# Keep the persisted key and response field compatible with existing installations.
DEFAULT_HOMEPAGE_SKIN = "national-intelligence"
ALLOWED_HOMEPAGE_SKINS = {
    "national-intelligence",
    "data-spectrum",
    "public-insight",
}


class SitePreferenceUpdateRequest(BaseModel):
    homepageSkin: str = Field(min_length=1, max_length=50)
    model_config = ConfigDict(extra="forbid")


def _normalize_skin(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in ALLOWED_HOMEPAGE_SKINS else DEFAULT_HOMEPAGE_SKIN


def _read_portal_skin() -> tuple[str, bool]:
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("SITE_HOMEPAGE_SKIN_GET"))
        row = cursor.fetchone()
        return (_normalize_skin(row[0] if row else None), bool(row))
    except Exception as exc:
        if oracle_error_code(exc) == 942:
            logger.warning("System settings table is not installed; using the default skin.")
            return (DEFAULT_HOMEPAGE_SKIN, False)
        raise
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@public_router.get("/preferences")
def public_portal_preferences():
    try:
        portal_skin, _ = _read_portal_skin()
        return {
            "status": "success",
            "data": {"homepageSkin": portal_skin},
        }
    except Exception as exc:
        if database_error_status(exc) == 503:
            logger.warning(
                "Portal preferences DB query failed; using the default skin.",
                exc_info=True,
            )
            return {
                "status": "success",
                "data": {"homepageSkin": DEFAULT_HOMEPAGE_SKIN},
            }
        logger.exception("Portal preferences could not be loaded.")
        raise HTTPException(status_code=500, detail="포털 설정을 불러오지 못했습니다.") from exc


@admin_router.get("")
def get_site_preferences():
    try:
        portal_skin, configured = _read_portal_skin()
        return {
            "status": "success",
            "data": {
                "homepageSkin": portal_skin,
                "configured": configured,
                "supportedHomepageSkins": sorted(ALLOWED_HOMEPAGE_SKINS),
            },
        }
    except Exception as exc:
        logger.exception("Administrator portal preferences could not be loaded.")
        raise_database_http_error(
            exc,
            default_detail="포털 설정을 불러오지 못했습니다.",
            schema_detail=(
                "System settings table is not installed. "
                "Run database/INIT_SYSTEM_ALT.sql for an existing database."
            ),
            unavailable_detail="시스템 DB에 연결하지 못했습니다. DB 접속 상태를 확인해 주세요.",
        )


@admin_router.put("")
def update_site_preferences(payload: SitePreferenceUpdateRequest, request: Request):
    portal_skin = str(payload.homepageSkin or "").strip().lower()
    if portal_skin not in ALLOWED_HOMEPAGE_SKINS:
        raise HTTPException(status_code=400, detail="Unsupported portal skin.")

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("SITE_HOMEPAGE_SKIN_UPSERT"),
            {
                "settingValue": portal_skin,
                "updatedBy": get_request_user_id(request),
            },
        )
        conn.commit()
        return {
            "status": "success",
            "data": {"homepageSkin": portal_skin, "configured": True},
        }
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Administrator portal preferences update failed.")
        raise_database_http_error(
            exc,
            default_detail="포털 설정을 저장하지 못했습니다.",
            schema_detail=(
                "System settings table is not installed. "
                "Run database/INIT_SYSTEM_ALT.sql for an existing database."
            ),
            unavailable_detail="시스템 DB에 연결하지 못했습니다. DB 접속 상태를 확인해 주세요.",
        )
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
