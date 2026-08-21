from __future__ import annotations

import json
import logging
import os
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from backend.auth_context import authenticate_request, require_admin_role
from backend.database import get_db_connection
from backend.database_errors import oracle_error_code, raise_database_http_error
from backend.database_helper import SqlLoader
from backend.routers.planning_scenarios import load_scenario_detail


router = APIRouter()
logger = logging.getLogger(__name__)


def _serialize(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "read"):
        return value.read()
    return value


def _safe_file_name(value: Any) -> str:
    file_name = Path(str(value or "attachment")).name
    file_name = re.sub(r"[\x00-\x1f\x7f]+", "_", file_name).strip()
    return file_name[:500] or "attachment"


def _notice_payload(row) -> dict[str, Any]:
    return {
        "noticeId": int(row[0]),
        "noticeType": row[1] or "INFO",
        "title": row[2],
        "content": _serialize(row[3]) or "",
        "postStartAt": _serialize(row[4]),
        "postEndAt": _serialize(row[5]),
        "pinYn": row[6] or "N",
        "sortOrder": int(row[7] or 0),
        "fileCount": int(row[8] or 0),
        "createdAt": _serialize(row[9]),
    }


def _file_payload(row) -> dict[str, Any]:
    return {
        "fileId": int(row[0]),
        "noticeId": int(row[1]),
        "fileName": row[2],
        "contentType": row[3] or "application/octet-stream",
        "fileSize": int(row[4] or 0),
        "sortOrder": int(row[5] or 0),
    }


def _load_notices(cursor, limit: int = 20) -> list[dict[str, Any]]:
    cursor.execute(SqlLoader.get_sql("HOME_ACTIVE_NOTICES"), {"limit": limit})
    notices = [_notice_payload(row) for row in cursor.fetchall()]
    for notice in notices:
        cursor.execute(
            SqlLoader.get_sql("HOME_NOTICE_FILES"),
            {"noticeId": notice["noticeId"]},
        )
        notice["attachments"] = [_file_payload(row) for row in cursor.fetchall()]
    return notices


def _decimal_number(value: Any) -> float | int:
    number = float(value or 0)
    return int(number) if number.is_integer() else number


def _personal_assignment_payload(row) -> dict[str, Any]:
    raw_allocations = _serialize(row[13])
    allocation_data_quality_error = False
    try:
        source = json.loads(raw_allocations) if raw_allocations else []
        if not isinstance(source, list):
            raise ValueError("Monthly allocation JSON must be a list.")
        monthly_allocations = []
        for item in source:
            month = str(item.get("month") or "") if isinstance(item, dict) else ""
            if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
                raise ValueError("Monthly allocation contains an invalid month.")
            monthly_allocations.append(
                {"month": month, "mm": _decimal_number(item.get("mm"))}
            )
    except (TypeError, ValueError, json.JSONDecodeError):
        monthly_allocations = []
        allocation_data_quality_error = True

    return {
        "assignmentId": int(row[0]),
        "projectId": int(row[1]),
        "projectName": row[2],
        "customerName": row[3] or "",
        "projectStatusCode": row[4] or "",
        "projectStartDate": row[5],
        "projectEndDate": row[6],
        "assignmentStatusCode": row[7] or "CONFIRMED",
        "assignmentStartDate": row[8],
        "assignmentEndDate": row[9],
        "allocationTypeCode": row[10] or "MONTHLY",
        "defaultMm": _decimal_number(row[11]),
        "totalMm": _decimal_number(row[12]),
        "monthlyAllocations": monthly_allocations,
        "allocationDataQualityError": allocation_data_quality_error,
        "projectRoleName": row[14] or "",
        "primaryDuty": row[15] or "",
        "timelineStatusCode": row[16] or "COMPLETED",
    }


def _executive_scenario_payload(source: dict[str, Any] | None) -> dict[str, Any] | None:
    if not source:
        return None
    monthly: dict[str, dict[str, int]] = {}
    projects = []
    for project in source.get("projects", []):
        active_project = str(project.get("bidDecisionCode") or "").upper() != "SKIP"
        projects.append(
            {
                "projectId": project.get("projectId"),
                "projectName": project.get("projectName"),
                "bidDecisionCode": project.get("bidDecisionCode"),
                "winProbability": project.get("winProbability"),
                "expectedContractAmount": project.get("expectedContractAmount"),
                "targetHeadcount": project.get("targetHeadcount"),
                "staffedHeadcount": project.get("staffedHeadcount"),
                "shortageHeadcount": project.get("shortageHeadcount"),
            }
        )
        for assignment in project.get("assignments", []) if active_project else []:
            for allocation in assignment.get("monthlyAllocations", []):
                month = str(allocation.get("month") or "")[:7]
                if not month:
                    continue
                target = monthly.setdefault(
                    month,
                    {"salesAmount": 0, "costAmount": 0, "operatingProfit": 0},
                )
                target["salesAmount"] += int(allocation.get("salesAmount") or 0)
                target["costAmount"] += int(allocation.get("costAmount") or 0)
                target["operatingProfit"] += int(
                    allocation.get("operatingProfit") or 0
                )
    return {
        "scenarioId": source.get("scenarioId"),
        "planYear": source.get("planYear"),
        "scenarioName": source.get("scenarioName"),
        "statusCode": source.get("statusCode"),
        "revisionNo": source.get("revisionNo"),
        "summary": source.get("summary") or {},
        "warnings": [
            {
                key: warning.get(key)
                for key in (
                    "type",
                    "employeeName",
                    "projectId",
                    "projectName",
                    "month",
                    "totalMm",
                    "shortageHeadcount",
                    "message",
                )
                if warning.get(key) is not None
            }
            for warning in source.get("warnings", [])
        ],
        "projects": projects,
        "monthlyFinancials": [
            {
                "month": month,
                "salesAmount": str(amounts["salesAmount"]),
                "costAmount": str(amounts["costAmount"]),
                "operatingProfit": str(amounts["operatingProfit"]),
            }
            for month, amounts in sorted(monthly.items())
        ],
    }


@router.get("/dashboard", dependencies=[Depends(require_admin_role)])
def dashboard(
    request: Request,
    planYear: int | None = Query(default=None, ge=1900, le=2100),
):
    user = authenticate_request(request)
    plan_year = planYear or (datetime.now().year + 1)
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("HOME_DASHBOARD_COUNTS"))
        count_row = cursor.fetchone() or (0, 0, 0)
        notices = _load_notices(cursor)

        cursor.execute(
            SqlLoader.get_sql("HOME_EXECUTIVE_PROJECT_SUMMARY"),
            {"planYear": plan_year},
        )
        project_row = cursor.fetchone() or (0, 0, 0, 0, 0)
        cursor.execute(
            SqlLoader.get_sql("HOME_EXECUTIVE_DECISION_PROJECTS"),
            {"planYear": plan_year},
        )
        decision_projects = [
            {
                "projectId": int(row[0]),
                "projectName": row[1],
                "customerName": row[2] or "",
                "statusCode": row[3] or "PLANNED",
                "orderAmountVat": str(row[4] or 0),
                "contractAmountVat": str(row[5] or 0),
                "projectStartDate": row[6],
                "projectEndDate": row[7],
            }
            for row in cursor.fetchall()
        ]

        schema_warnings = []
        company_schema_available = True
        workforce = {
            "internalCount": int(count_row[1] or 0),
            "partnerCount": 0,
        }
        try:
            cursor.execute(
                SqlLoader.get_sql("HOME_EXECUTIVE_WORKFORCE_SUMMARY"),
                {"planYear": plan_year},
            )
            workforce_row = cursor.fetchone() or (count_row[1], 0)
            workforce = {
                "internalCount": int(workforce_row[0] or 0),
                "partnerCount": int(workforce_row[1] or 0),
            }
        except Exception as exc:
            if oracle_error_code(exc) not in {904, 942}:
                raise
            company_schema_available = False
            schema_warnings.append(
                "협력업체·외부인력 스키마가 아직 설치되지 않았습니다."
            )

        planning_schema_available = True
        scenario = None
        try:
            cursor.execute(
                SqlLoader.get_sql("HOME_EXECUTIVE_LATEST_SCENARIO"),
                {"planYear": plan_year},
            )
            scenario_row = cursor.fetchone()
            if scenario_row:
                scenario = _executive_scenario_payload(
                    load_scenario_detail(cursor, int(scenario_row[0]))
                )
        except Exception as exc:
            if oracle_error_code(exc) not in {904, 942}:
                raise
            planning_schema_available = False
            schema_warnings.append(
                "연간 사업·인력계획 스키마가 아직 설치되지 않았습니다."
            )

        return {
            "status": "success",
            "data": {
                "appName": os.getenv("APP_NAME", "INIT Members"),
                "user": user,
                "dashboardType": "executive",
                "planYear": plan_year,
                "generatedAt": datetime.now().isoformat(),
                "noticeCount": int(count_row[2] or 0),
                "projectSummary": {
                    "projectCount": int(project_row[0] or 0),
                    "bidTargetCount": int(project_row[1] or 0),
                    "awardedCount": int(project_row[2] or 0),
                    "orderAmountVat": str(project_row[3] or 0),
                    "contractAmountVat": str(project_row[4] or 0),
                },
                "workforce": workforce,
                "companySchemaAvailable": company_schema_available,
                "planningSchemaAvailable": planning_schema_available,
                "scenario": scenario,
                "decisionProjects": decision_projects,
                "schemaWarnings": schema_warnings,
                "notices": notices,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Executive dashboard query failed. plan_year=%s", plan_year)
        raise_database_http_error(
            exc,
            default_detail="경영 현황을 불러오지 못했습니다.",
            schema_detail="시스템 DB 기본 스키마가 설치되지 않았습니다. INIT_SYSTEM_DDL.sql을 확인해 주세요.",
            unavailable_detail="시스템 DB에 연결하지 못했습니다. DB 접속 상태와 연결 풀을 확인해 주세요.",
        )
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/my-dashboard")
def my_dashboard(request: Request):
    user = authenticate_request(request)
    user_id = int(user["userId"])
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("HOME_PERSONAL_ASSIGNMENTS"),
            {"userId": user_id, "limit": 100},
        )
        assignments = [_personal_assignment_payload(row) for row in cursor.fetchall()]
        notices = _load_notices(cursor)

        current_month = datetime.now().strftime("%Y-%m")
        current_year = current_month[:4]
        monthly_mm = {
            f"{current_year}-{month:02d}": 0.0
            for month in range(1, 13)
        }
        for assignment in assignments:
            for allocation in assignment["monthlyAllocations"]:
                month = allocation["month"]
                if month in monthly_mm:
                    monthly_mm[month] += float(allocation["mm"] or 0)

        active_project_ids = {
            assignment["projectId"]
            for assignment in assignments
            if assignment["timelineStatusCode"] == "ACTIVE"
        }
        upcoming_project_ids = {
            assignment["projectId"]
            for assignment in assignments
            if assignment["timelineStatusCode"] == "UPCOMING"
        }
        all_project_ids = {assignment["projectId"] for assignment in assignments}
        return {
            "status": "success",
            "data": {
                "appName": os.getenv("APP_NAME", "INIT Members"),
                "user": user,
                "dashboardType": "personal",
                "generatedAt": datetime.now().isoformat(),
                "currentMonth": current_month,
                "summary": {
                    "activeProjectCount": len(active_project_ids),
                    "upcomingProjectCount": len(upcoming_project_ids),
                    "totalProjectCount": len(all_project_ids),
                    "currentMonthMm": _decimal_number(monthly_mm[current_month]),
                },
                "monthlyAllocations": [
                    {"month": month, "mm": _decimal_number(mm)}
                    for month, mm in monthly_mm.items()
                ],
                "assignments": assignments,
                "notices": notices,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Personal dashboard query failed. user_id=%s", user_id)
        raise_database_http_error(
            exc,
            default_detail="개인 투입 프로젝트 현황을 불러오지 못했습니다.",
            schema_detail=(
                "프로젝트 투입 스키마가 설치되지 않았습니다. "
                "database/INIT_SYSTEM_ALT.sql을 적용한 뒤 다시 시도해 주세요."
            ),
            unavailable_detail="시스템 DB에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        )
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/notice-files/{file_id}/download")
def download_notice_file(file_id: int):
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("HOME_NOTICE_FILE_DOWNLOAD"), {"fileId": file_id})
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
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Notice attachment download failed. file_id=%s", file_id)
        raise_database_http_error(
            exc,
            default_detail="공지 첨부파일을 내려받지 못했습니다.",
            schema_detail="공지 첨부파일 스키마가 설치되지 않았습니다. INIT_SYSTEM_DDL.sql을 확인해 주세요.",
        )
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
