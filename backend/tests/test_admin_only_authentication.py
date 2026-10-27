from __future__ import annotations

import asyncio
import time
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from starlette.responses import JSONResponse, Response

import main
from backend import auth_context
from backend.routers import auth
from backend.site_identity import SITE_NAME


class AdminOnlyLoginTests(unittest.TestCase):
    def attempt(self, *, role="ADMIN", active="Y", valid_password=True):
        connection = MagicMock()
        connection.cursor.return_value.fetchone.return_value = (
            7, "tester", "테스터", "tester@example.com", "stored-hash", active, role, "N"
        )
        response = Response()
        with (
            patch.object(auth, "get_db_connection", return_value=connection),
            patch.object(auth, "_core_table_status", return_value={auth._USER_TABLE}),
            patch.object(auth, "_core_column_status", return_value={}),
            patch.object(auth, "_schema_is_complete", return_value=True),
            patch.object(auth, "_user_count", return_value=1),
            patch.object(auth, "verify_password", return_value=valid_password),
            patch.object(auth, "create_login_session", return_value="test-token") as create_session,
        ):
            try:
                result = auth.login(
                    auth.LoginRequest(loginId="tester", password="test-password"),
                    SimpleNamespace(client=SimpleNamespace(host="testclient")),
                    response,
                )
            except HTTPException as exc:
                result = exc
        self.assertTrue(connection.cursor.return_value.close.called)
        connection.close.assert_called_once()
        return result, response, connection, create_session

    def test_active_admin_can_login_and_change_initial_password(self):
        result, response, connection, create_session = self.attempt()
        self.assertEqual("success", result["status"])
        self.assertEqual("ADMIN", result["user"]["roleCode"])
        self.assertEqual("N", result["user"]["passwordChangeYn"])
        create_session.assert_called_once_with(connection, 7)
        connection.commit.assert_called_once()
        connection.rollback.assert_not_called()
        self.assertIn("httponly", response.headers["set-cookie"].lower())

    def test_active_non_admin_cannot_receive_session_or_cookie(self):
        for role in ("USER", "GUEST", "", None):
            with self.subTest(role=role):
                result, response, connection, create_session = self.attempt(role=role)
                self.assertIsInstance(result, HTTPException)
                self.assertEqual(403, result.status_code)
                create_session.assert_not_called()
                connection.commit.assert_not_called()
                connection.rollback.assert_called_once()
                self.assertNotIn("set-cookie", response.headers)

    def test_inactive_admin_cannot_login(self):
        result, _, connection, create_session = self.attempt(active="N")
        self.assertEqual(403, result.status_code)
        create_session.assert_not_called()
        connection.rollback.assert_called_once()

    def test_invalid_password_does_not_disclose_role_restriction(self):
        result, _, _, create_session = self.attempt(role="USER", valid_password=False)
        self.assertEqual(401, result.status_code)
        create_session.assert_not_called()


class AdminOnlySessionTests(unittest.TestCase):
    def setUp(self):
        self.token_hash = auth_context._hash_session_token("admin-only-review-token")
        auth_context.invalidate_session_cache(self.token_hash)
        self.addCleanup(auth_context.invalidate_session_cache, self.token_hash)

    def request(self, user=None):
        state = SimpleNamespace()
        if user is not None:
            state.auth_user = user
        return SimpleNamespace(
            cookies={auth_context.SESSION_COOKIE_NAME: "admin-only-review-token"},
            state=state,
        )

    def assert_blocked(self, request):
        with self.assertRaises(HTTPException) as raised:
            auth_context.authenticate_request(request)
        self.assertEqual(403, raised.exception.status_code)

    def test_request_cache_rejects_existing_user_session(self):
        self.assert_blocked(self.request({"userId": 7, "roleCode": "USER"}))

    def test_shared_cache_rejects_existing_user_session(self):
        now = time.monotonic()
        auth_context._store_cached_session(
            self.token_hash, {"userId": 7, "roleCode": "USER"},
            verified_until=now + 30, next_touch_at=now + 600,
        )
        with patch.object(auth_context, "get_db_connection") as get_connection:
            self.assert_blocked(self.request())
        get_connection.assert_not_called()

    def test_cache_rechecked_under_lock_rejects_non_admin(self):
        with (
            patch.object(auth_context, "_cached_session", side_effect=[None, {"userId": 7, "roleCode": "USER"}]),
            patch.object(auth_context, "get_db_connection") as get_connection,
        ):
            self.assert_blocked(self.request())
        get_connection.assert_not_called()

    def test_database_user_session_is_rejected_before_touch_or_commit(self):
        connection = MagicMock()
        connection.cursor.return_value.fetchone.return_value = (
            7, "tester", "테스터", "tester@example.com", "USER", "Y"
        )
        with patch.object(auth_context, "get_db_connection", return_value=connection):
            self.assert_blocked(self.request())
        self.assertEqual(1, connection.cursor.return_value.execute.call_count)
        connection.commit.assert_not_called()
        connection.rollback.assert_called_once()
        connection.cursor.return_value.close.assert_called_once()
        connection.close.assert_called_once()

    def test_admin_request_cache_remains_usable(self):
        user = {"userId": 7, "roleCode": "ADMIN"}
        self.assertEqual(user, auth_context.authenticate_request(self.request(user)))

    def test_existing_user_session_cannot_access_common_or_admin_api(self):
        async def call_next(_request):
            self.fail("A non-admin session reached the protected endpoint")
            return JSONResponse({})

        for path in ("/api/auth/session", "/api/account", "/api/home/dashboard"):
            with self.subTest(path=path):
                request = self.request({"userId": 7, "roleCode": "USER"})
                request.url = SimpleNamespace(path=path)
                request.method = "GET"
                response = asyncio.run(main.enforce_api_authentication(request, call_next))
                self.assertEqual(403, response.status_code)


class SiteIdentityTests(unittest.TestCase):
    def test_api_title_and_health_keep_official_name_with_legacy_environment(self):
        with patch.dict("os.environ", {"APP_NAME": "Legacy site name"}):
            self.assertEqual("(주) 인아이티 경영정보 시스템", SITE_NAME)
            self.assertEqual(SITE_NAME, main.app.title)
            self.assertEqual(SITE_NAME, main.health()["appName"])


if __name__ == "__main__":
    unittest.main()
