from __future__ import annotations

import logging
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.auth_context import require_admin_role
from backend.database import get_db_connection
from backend.database_errors import raise_database_http_error
from backend.database_helper import SqlLoader
from backend.department_config import departments
from backend.routers.planning_scenarios import (
    _rows as planning_rows,
    actual_capacity_from_assignments,
    load_scenario_detail,
)
from backend.routers.project_assignments import _rows as assignment_rows


logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(require_admin_role)])


def _load_confirmed(
    plan_year: int,
    actual_capacity_future: Future,
) -> dict:
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("PROJECT_ASSIGNMENT_WORKSPACE_ASSIGNMENTS"),
            {"projectYear": plan_year},
        )
        assignments = assignment_rows(cursor)
        actual_capacity_future.set_result(
            actual_capacity_from_assignments(assignments, plan_year)
        )
        cursor.execute(SqlLoader.get_sql("WORKFORCE_MANAGEMENT_ESTABLISHMENT_YEAR"))
        establishment_row = cursor.fetchone()
        establishment_year = (
            int(establishment_row[0])
            if establishment_row and establishment_row[0] is not None
            else None
        )
        cursor.execute(
            SqlLoader.get_sql("PROJECT_ASSIGNMENT_WORKSPACE_PROJECTS"),
            {"projectYear": plan_year},
        )
        projects = assignment_rows(cursor)
        cursor.execute(
            SqlLoader.get_sql("PROJECT_ASSIGNMENT_WORKSPACE_COMPANIES"),
            {"projectYear": plan_year},
        )
        companies = assignment_rows(cursor)
        return {
            "establishmentYear": establishment_year,
            "confirmed": {
                "projectYear": plan_year,
                "projects": projects,
                "assignments": assignments,
                "companies": companies,
            },
        }
    except Exception as exc:
        if not actual_capacity_future.done():
            actual_capacity_future.set_exception(exc)
        raise
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def _load_references(plan_year: int) -> dict:
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("PLANNING_REFERENCE_USERS"),
            {"planYear": plan_year},
        )
        users = planning_rows(cursor)
        cursor.execute(
            SqlLoader.get_sql("PLANNING_REFERENCE_COMPANY_EMPLOYEES"),
            {"planYear": plan_year},
        )
        company_employees = planning_rows(cursor)
        return {
            "workers": [
                {**item, "workerKey": f"USER:{item['userId']}"}
                for item in users
            ] + [
                {
                    **item,
                    "workerKey": f"COMPANY_EMPLOYEE:{item['companyEmployeeId']}",
                }
                for item in company_employees
            ],
            "actualCapacity": [],
            "dataQualityWarnings": [],
        }
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def _load_scenarios(
    plan_year: int,
    scenario_id: int | None,
    actual_capacity_future: Future,
) -> dict:
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            SqlLoader.get_sql("PLANNING_SCENARIO_LIST"),
            {"planYear": plan_year},
        )
        scenarios = planning_rows(cursor)
        scenario = None
        if scenarios:
            scenario_ids = {int(item["scenarioId"]) for item in scenarios}
            target_scenario_id = (
                scenario_id
                if scenario_id in scenario_ids
                else int(scenarios[0]["scenarioId"])
            )
            scenario = load_scenario_detail(
                cursor,
                target_scenario_id,
                actual_capacity_future.result(),
            )
        return {"scenarios": scenarios, "scenario": scenario}
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


@router.get("/bootstrap")
def bootstrap(
    planYear: Annotated[int, Query(ge=1900, le=2100)],
    scenarioId: Annotated[int | None, Query(gt=0)] = None,
):
    try:
        actual_capacity_future = Future()
        with ThreadPoolExecutor(
            max_workers=3,
            thread_name_prefix="workforce-bootstrap",
        ) as executor:
            confirmed_future = executor.submit(
                _load_confirmed,
                planYear,
                actual_capacity_future,
            )
            references_future = executor.submit(_load_references, planYear)
            scenarios_future = executor.submit(
                _load_scenarios,
                planYear,
                scenarioId,
                actual_capacity_future,
            )
            confirmed_data = confirmed_future.result()
            references = references_future.result()
            scenario_data = scenarios_future.result()

        return {
            "status": "success",
            "data": {
                "planYear": planYear,
                "establishmentYear": confirmed_data["establishmentYear"],
                "departments": [dict(item) for item in departments()],
                "confirmed": confirmed_data["confirmed"],
                "references": references,
                "scenarios": scenario_data["scenarios"],
                "scenario": scenario_data["scenario"],
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "Workforce management bootstrap could not be loaded. plan_year=%s",
            planYear,
        )
        raise_database_http_error(
            exc,
            default_detail="인력 운영 현황을 조회하지 못했습니다.",
            schema_detail=(
                "인력 운영 스키마가 설치되지 않았습니다. "
                "database/INIT_SYSTEM_ALT.sql을 적용한 뒤 다시 시도해 주세요."
            ),
        )
