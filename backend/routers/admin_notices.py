from __future__ import annotations

import logging
import os
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

import oracledb
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from backend.auth_context import get_request_user_id, require_admin_role
from backend.database import get_db_connection
from backend.database_errors import raise_database_http_error
from backend.database_helper import SqlLoader


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_admin_role)])
_NOTICE_TYPES = {"INFO", "IMPORTANT", "MAINTENANCE", "WARNING"}
_MEDIA_TYPE_PATTERN = re.compile(
    r"^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+(?:[ \t]*;[ \t]*[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+\"'():=-]+)*$"
)


class NoticeWriteRequest(BaseModel):
    noticeType: str = Field(default="INFO", max_length=30)
    title: str = Field(max_length=300)
    content: str = ""
    postStartAt: Optional[datetime] = None
    postEndAt: Optional[datetime] = None
    pinYn: str = Field(default="N", max_length=1)
    useYn: str = Field(default="Y", max_length=1)
    sortOrder: int = 0
    model_config = ConfigDict(extra="forbid")


def _serialize(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "read"):
        return value.read()
    return value


def _yn(value: str, field_name: str) -> str:
    normalized = str(value or "").strip().upper()
    if normalized not in {"Y", "N"}:
        raise HTTPException(status_code=400, detail=f"{field_name} must be Y or N.")
    return normalized


def _notice_type(value: str) -> str:
    normalized = str(value or "").strip().upper()
    if normalized not in _NOTICE_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported notice type.")
    return normalized


def _local_datetime(value: Optional[datetime], field_name: str) -> Optional[datetime]:
    if value is not None and value.utcoffset() is not None:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must not include a timezone offset.",
        )
    return value


def _notice_params(payload: NoticeWriteRequest, user_id: int) -> dict[str, Any]:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Notice title is required.")
    if len(title) > 300:
        raise HTTPException(status_code=400, detail="Notice title must be 300 characters or less.")
    if not payload.content.strip():
        raise HTTPException(status_code=400, detail="Notice content is required.")
    post_start_at = _local_datetime(payload.postStartAt, "postStartAt")
    post_end_at = _local_datetime(payload.postEndAt, "postEndAt")
    if post_start_at and post_end_at and post_start_at > post_end_at:
        raise HTTPException(status_code=400, detail="postEndAt must not be earlier than postStartAt.")
    return {
        "noticeType": _notice_type(payload.noticeType),
        "title": title,
        "content": payload.content,
        "postStartAt": post_start_at,
        "postEndAt": post_end_at,
        "pinYn": _yn(payload.pinYn, "pinYn"),
        "useYn": _yn(payload.useYn, "useYn"),
        "sortOrder": payload.sortOrder,
        "userId": user_id,
    }


def _row_dict(cursor, row) -> dict[str, Any]:
    columns = [description[0] for description in cursor.description or []]
    return {
        _camel_key(column): _serialize(value)
        for column, value in zip(columns, row)
    }


def _camel_key(value: str) -> str:
    parts = str(value or "").lower().split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _fetch_notice(cursor, notice_id: int) -> dict[str, Any]:
    cursor.execute(SqlLoader.get_sql("ADMIN_NOTICE_DETAIL"), {"noticeId": notice_id})
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Notice was not found.")
    return _row_dict(cursor, row)


def _fetch_files(cursor, notice_id: int) -> list[dict[str, Any]]:
    cursor.execute(SqlLoader.get_sql("ADMIN_NOTICE_FILE_LIST"), {"noticeId": notice_id})
    return [_row_dict(cursor, row) for row in cursor.fetchall()]


def _safe_file_name(value: str) -> str:
    file_name = Path(str(value or "attachment")).name
    file_name = re.sub(r"[\x00-\x1f\x7f]+", "_", file_name).strip()
    return file_name[:500] or "attachment"


def _max_file_bytes() -> int:
    try:
        configured_bytes = int(
            os.getenv("APP_NOTICE_FILE_MAX_BYTES", str(10 * 1024 * 1024))
        )
    except (TypeError, ValueError):
        configured_bytes = 10 * 1024 * 1024
    return max(1024, min(configured_bytes, 50 * 1024 * 1024))


def _content_type(value: str) -> str:
    normalized = str(value or "application/octet-stream").strip()
    if len(normalized) > 200 or not _MEDIA_TYPE_PATTERN.fullmatch(normalized):
        return "application/octet-stream"
    return normalized


def _store_attachment(
    notice_id: int,
    file_name: str,
    content_type: str,
    file_data: bytes,
    sort_order: int,
    user_id: int,
) -> dict[str, Any]:
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        _fetch_notice(cursor, notice_id)
        file_id_var = cursor.var(oracledb.DB_TYPE_NUMBER)
        cursor.setinputsizes(fileData=oracledb.DB_TYPE_BLOB)
        cursor.execute(
            SqlLoader.get_sql("ADMIN_NOTICE_FILE_INSERT"),
            {
                "noticeId": notice_id,
                "fileName": file_name,
                "contentType": content_type,
                "fileSize": len(file_data),
                "fileData": file_data,
                "sortOrder": sort_order,
                "userId": user_id,
                "fileIdOut": file_id_var,
            },
        )
        value = file_id_var.getvalue()
        file_id = int(value[0] if isinstance(value, list) else value)
        conn.commit()
        return {"status": "success", "data": {"fileId": file_id, "fileName": file_name}}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Notice attachment upload failed.")
        raise_database_http_error(exc, default_detail="Attachment could not be uploaded.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("")
def list_notices(
    keyword: str = Query("", max_length=300),
    useYn: str = Query("ALL"),
    limit: int = Query(100, ge=1, le=500),
):
    normalized_use = str(useYn or "ALL").strip().upper()
    if normalized_use not in {"ALL", "Y", "N"}:
        raise HTTPException(status_code=400, detail="useYn must be Y, N, or ALL.")
    normalized_keyword = keyword.strip().upper()
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("ADMIN_NOTICE_LIST"),
            {
                "keyword": f"%{normalized_keyword}%" if normalized_keyword else None,
                "keywordText": normalized_keyword or None,
                "useYn": normalized_use,
                "limit": limit,
            },
        )
        data = [_row_dict(cursor, row) for row in cursor.fetchall()]
        return {"status": "success", "data": data, "total": len(data)}
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/{notice_id}")
def get_notice(notice_id: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        notice = _fetch_notice(cursor, notice_id)
        notice["attachments"] = _fetch_files(cursor, notice_id)
        return {"status": "success", "data": notice}
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("")
def create_notice(payload: NoticeWriteRequest, request: Request):
    user_id = get_request_user_id(request)
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        params = _notice_params(payload, user_id)
        notice_id_var = cursor.var(oracledb.DB_TYPE_NUMBER)
        cursor.setinputsizes(content=oracledb.DB_TYPE_CLOB)
        cursor.execute(
            SqlLoader.get_sql("ADMIN_NOTICE_INSERT"),
            {**params, "noticeIdOut": notice_id_var},
        )
        value = notice_id_var.getvalue()
        notice_id = int(value[0] if isinstance(value, list) else value)
        notice = _fetch_notice(cursor, notice_id)
        notice["attachments"] = []
        conn.commit()
        return {"status": "success", "data": notice}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Notice creation failed.")
        raise_database_http_error(exc, default_detail="Notice could not be created.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.put("/{notice_id}")
def update_notice(notice_id: int, payload: NoticeWriteRequest, request: Request):
    user_id = get_request_user_id(request)
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.setinputsizes(content=oracledb.DB_TYPE_CLOB)
        cursor.execute(
            SqlLoader.get_sql("ADMIN_NOTICE_UPDATE"),
            {**_notice_params(payload, user_id), "noticeId": notice_id},
        )
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="Notice was not found.")
        notice = _fetch_notice(cursor, notice_id)
        notice["attachments"] = _fetch_files(cursor, notice_id)
        conn.commit()
        return {"status": "success", "data": notice}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Notice update failed.")
        raise_database_http_error(exc, default_detail="Notice could not be updated.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.delete("/{notice_id}")
def delete_notice(notice_id: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("ADMIN_NOTICE_DELETE"), {"noticeId": notice_id})
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="Notice was not found.")
        conn.commit()
        return {"status": "success", "message": "Notice deleted."}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Notice deletion failed.")
        raise_database_http_error(exc, default_detail="Notice could not be deleted.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/{notice_id}/attachments")
def list_attachments(notice_id: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        _fetch_notice(cursor, notice_id)
        data = _fetch_files(cursor, notice_id)
        return {"status": "success", "data": data, "total": len(data)}
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.post("/{notice_id}/attachments")
async def upload_attachment(
    notice_id: int,
    request: Request,
    file: UploadFile = File(...),
    sortOrder: int = Form(0),
):
    user_id = get_request_user_id(request)
    max_bytes = _max_file_bytes()
    try:
        file_data = await file.read(max_bytes + 1)
        if not file_data:
            raise HTTPException(status_code=400, detail="Attachment is empty.")
        if len(file_data) > max_bytes:
            raise HTTPException(status_code=413, detail="Attachment exceeds the server size limit.")
        file_name = _safe_file_name(file.filename or "attachment")
        content_type = _content_type(file.content_type or "")
        return await run_in_threadpool(
            _store_attachment,
            notice_id,
            file_name,
            content_type,
            file_data,
            sortOrder,
            user_id,
        )
    finally:
        await file.close()


@router.get("/attachments/{file_id}/download")
def download_attachment(file_id: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("ADMIN_NOTICE_FILE_DOWNLOAD"), {"fileId": file_id})
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Attachment was not found.")
        file_name = _safe_file_name(row[2])
        file_data = _serialize(row[5]) or b""
        if isinstance(file_data, str):
            file_data = file_data.encode("utf-8")
        return Response(
            content=file_data,
            media_type=row[3] or "application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename=\"attachment\"; filename*=UTF-8''{quote(file_name)}",
                "X-Content-Type-Options": "nosniff",
            },
        )
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.delete("/attachments/{file_id}")
def delete_attachment(file_id: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("ADMIN_NOTICE_FILE_DELETE"), {"fileId": file_id})
        if cursor.rowcount <= 0:
            raise HTTPException(status_code=404, detail="Attachment was not found.")
        conn.commit()
        return {"status": "success", "message": "Attachment deleted."}
    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as exc:
        if conn:
            conn.rollback()
        logger.exception("Notice attachment deletion failed.")
        raise_database_http_error(exc, default_detail="Attachment could not be deleted.")
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
