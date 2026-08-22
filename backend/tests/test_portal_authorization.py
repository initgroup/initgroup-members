from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse

import main
from backend.auth_context import require_admin_role
from backend.database_helper import SqlLoader
from backend.portal_access import portal_access_for_role
from backend.routers import auth, home


class _HomeCursor:
    def __init__(self):
        self.executions = []
        self.current_sql = ""
        self.closed = False

    def execute(self, sql, params=None):
        self.current_sql = sql
        self.executions.append((sql, params or {}))

    def fetchall(self):
        return []

    def close(self):
        self.closed = True


class _HomeConnection:
    def __init__(self):
        self.cursor_instance = _HomeCursor()
        self.closed = False

    def cursor(self):
        return self.cursor_instance

    def close(self):
        self.closed = True


def _request(path: str) -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode("ascii"),
            "query_string": b"",
            "headers": [],
            "client": ("testclient", 50000),
            "server": ("testserver", 80),
        }
    )


class PortalAccessTests(unittest.TestCase):
    def test_user_session_receives_only_common_navigation_and_pages(self):
        access = portal_access_for_role("USER")
        serialized = repr(access)

        self.assertEqual(["my-account"], [item["key"] for item in access["navigation"]])
        account_group = access["navigation"][0]
        self.assertEqual(
            ["account", "my-project-assignments"],
            [item["page"] for item in account_group["children"]],
        )
        self.assertEqual(
            ["account", "my-project-assignments"],
            access["pageFiles"]["htmlPages"],
        )
        self.assertNotIn("home", access["pageFiles"]["htmlPages"])
        self.assertNotIn("admin-users", serialized)
        self.assertNotIn("business-planning", serialized)

    def test_admin_session_receives_admin_navigation(self):
        access = portal_access_for_role("ADMIN")
        group_keys = [item.get("key") for item in access["navigation"] if item["type"] == "group"]

        self.assertEqual("home", access["navigation"][0]["page"])
        self.assertIn("business-planning", group_keys)
        self.assertIn("my-account", group_keys)
        self.assertIn("home", access["pageFiles"]["htmlPages"])
        self.assertIn("my-project-assignments", access["pageFiles"]["htmlPages"])
        self.assertIn("admin-users", access["pageFiles"]["htmlPages"])

    def test_session_access_is_derived_from_authenticated_server_role(self):
        request = SimpleNamespace()
        with patch.object(
            auth,
            "authenticate_request",
            return_value={"userId": 7, "roleCode": "USER"},
        ):
            result = auth.get_session(request)

        self.assertEqual("USER", result["user"]["roleCode"])
        self.assertEqual(
            ["account", "my-project-assignments"],
            result["portalAccess"]["pageFiles"]["htmlPages"],
        )


class RoleEnforcementTests(unittest.TestCase):
    def test_client_role_values_cannot_upgrade_server_session_role(self):
        request = SimpleNamespace(
            state=SimpleNamespace(
                auth_user={"userId": 9, "roleCode": "USER"},
            ),
            headers={"X-Role-Code": "ADMIN"},
            query_params={"roleCode": "ADMIN"},
        )

        with self.assertRaises(HTTPException) as raised:
            require_admin_role(request)

        self.assertEqual(403, raised.exception.status_code)

    def test_user_is_blocked_from_admin_static_page_asset(self):
        async def call_next(_request):
            return JSONResponse({"unexpected": True})

        with patch.object(
            main,
            "authenticate_request",
            return_value={"userId": 9, "roleCode": "USER", "passwordChangeYn": "Y"},
        ):
            response = asyncio.run(
                main.enforce_api_authentication(
                    _request("/pages/admin-users.html"),
                    call_next,
                )
            )

        self.assertEqual(403, response.status_code)

    def test_admin_static_asset_check_normalizes_path_segments(self):
        async def call_next(_request):
            return JSONResponse({"unexpected": True})

        with patch.object(
            main,
            "authenticate_request",
            return_value={"userId": 9, "roleCode": "USER", "passwordChangeYn": "Y"},
        ):
            response = asyncio.run(
                main.enforce_api_authentication(
                    _request("/pages/section/../admin-users.html"),
                    call_next,
                )
            )

        self.assertEqual(403, response.status_code)

    def test_user_is_blocked_from_direct_admin_api_url(self):
        async def call_next(_request):
            return JSONResponse({"unexpected": True})

        with patch.object(
            main,
            "authenticate_request",
            return_value={"userId": 9, "roleCode": "USER", "passwordChangeYn": "Y"},
        ):
            response = asyncio.run(
                main.enforce_api_authentication(
                    _request("/api/admin/users"),
                    call_next,
                )
            )

        self.assertEqual(403, response.status_code)

    def test_user_is_blocked_from_executive_dashboard_url(self):
        async def call_next(_request):
            return JSONResponse({"unexpected": True})

        with patch.object(
            main,
            "authenticate_request",
            return_value={"userId": 9, "roleCode": "USER", "passwordChangeYn": "Y"},
        ):
            response = asyncio.run(
                main.enforce_api_authentication(
                    _request("/api/home/dashboard"),
                    call_next,
                )
            )

        self.assertEqual(403, response.status_code)

    def test_user_is_blocked_from_workforce_bootstrap_url(self):
        async def call_next(_request):
            return JSONResponse({"unexpected": True})

        with patch.object(
            main,
            "authenticate_request",
            return_value={"userId": 9, "roleCode": "USER", "passwordChangeYn": "Y"},
        ):
            response = asyncio.run(
                main.enforce_api_authentication(
                    _request("/api/workforce-management/bootstrap"),
                    call_next,
                )
            )

        self.assertEqual(403, response.status_code)

    def test_user_is_blocked_from_executive_home_asset(self):
        async def call_next(_request):
            return JSONResponse({"unexpected": True})

        with patch.object(
            main,
            "authenticate_request",
            return_value={"userId": 9, "roleCode": "USER", "passwordChangeYn": "Y"},
        ):
            response = asyncio.run(
                main.enforce_api_authentication(
                    _request("/pages/home.html"),
                    call_next,
                )
            )

        self.assertEqual(403, response.status_code)


class PersonalDashboardTests(unittest.TestCase):
    def test_personal_dashboard_binds_user_id_from_session(self):
        connection = _HomeConnection()
        request = SimpleNamespace(query_params={"userId": "999"})
        with (
            patch.object(
                home,
                "authenticate_request",
                return_value={"userId": 42, "roleCode": "USER"},
            ),
            patch.object(home, "get_db_connection", return_value=connection),
        ):
            result = home.my_dashboard(request)

        personal_sql = SqlLoader.get_sql("HOME_PERSONAL_ASSIGNMENTS")
        personal_params = next(
            params for sql, params in connection.cursor_instance.executions if sql == personal_sql
        )
        self.assertEqual({"userId": 42, "limit": 100}, personal_params)
        self.assertEqual("personal", result["data"]["dashboardType"])
        self.assertTrue(connection.cursor_instance.closed)
        self.assertTrue(connection.closed)


if __name__ == "__main__":
    unittest.main()
