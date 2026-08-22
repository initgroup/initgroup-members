from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from backend import auth_context
from backend.database_errors import database_error_status, raise_database_http_error
from backend.routers import admin_companies


class _OracleErrorDetail:
    def __init__(self, code: int | None = None, full_code: str = ""):
        self.code = code
        self.full_code = full_code

    def __str__(self) -> str:
        return self.full_code or f"ORA-{int(self.code or 0):05d}"


def _database_error(code: int | None = None, full_code: str = "") -> Exception:
    return Exception(_OracleErrorDetail(code, full_code))


class _Cursor:
    def __init__(
        self,
        *,
        rowcount: int = 1,
        fetch_row=None,
        execute_error: Exception | None = None,
        error_on_execute: int = 1,
    ):
        self.rowcount = rowcount
        self.fetch_row = fetch_row
        self.execute_error = execute_error
        self.error_on_execute = error_on_execute
        self.execute_count = 0
        self.closed = False

    def execute(self, _sql, _params=None):
        self.execute_count += 1
        if self.execute_error and self.execute_count == self.error_on_execute:
            raise self.execute_error

    def fetchone(self):
        return self.fetch_row

    def close(self):
        self.closed = True


class _Connection:
    def __init__(self, cursor: _Cursor | None = None, cursor_error: Exception | None = None):
        self.cursor_instance = cursor or _Cursor()
        self.cursor_error = cursor_error
        self.commit_count = 0
        self.rollback_count = 0
        self.close_count = 0

    def cursor(self):
        if self.cursor_error:
            raise self.cursor_error
        return self.cursor_instance

    def commit(self):
        self.commit_count += 1

    def rollback(self):
        self.rollback_count += 1

    def close(self):
        self.close_count += 1


class DatabaseErrorMappingTests(unittest.TestCase):
    def test_database_error_status_is_mapped_by_error_category(self):
        self.assertEqual(409, database_error_status(_database_error(1), conflict_codes={1}))
        self.assertEqual(503, database_error_status(_database_error(942)))
        self.assertEqual(503, database_error_status(_database_error(3113)))
        self.assertEqual(503, database_error_status(_database_error(full_code="DPY-4005")))
        self.assertEqual(500, database_error_status(_database_error(900)))

    def test_database_error_response_does_not_expose_oracle_message(self):
        with self.assertRaises(HTTPException) as raised:
            raise_database_http_error(
                _database_error(900),
                default_detail="안전한 오류 메시지",
            )

        self.assertEqual(500, raised.exception.status_code)
        self.assertEqual("안전한 오류 메시지", raised.exception.detail)


class CompanyTransactionTests(unittest.TestCase):
    def test_delete_history_commits_once_and_closes_resources(self):
        connection = _Connection(_Cursor(rowcount=1))
        with patch.object(admin_companies, "get_db_connection", return_value=connection):
            result = admin_companies.delete_history(10, 20)

        self.assertEqual({"status": "success"}, result)
        self.assertEqual(1, connection.commit_count)
        self.assertEqual(0, connection.rollback_count)
        self.assertTrue(connection.cursor_instance.closed)
        self.assertEqual(1, connection.close_count)

    def test_delete_history_rolls_back_http_error(self):
        connection = _Connection(_Cursor(rowcount=0))
        with patch.object(admin_companies, "get_db_connection", return_value=connection):
            with self.assertRaises(HTTPException) as raised:
                admin_companies.delete_history(10, 20)

        self.assertEqual(404, raised.exception.status_code)
        self.assertEqual(0, connection.commit_count)
        self.assertEqual(1, connection.rollback_count)
        self.assertTrue(connection.cursor_instance.closed)
        self.assertEqual(1, connection.close_count)

    def test_delete_history_rolls_back_and_maps_unavailable_database(self):
        connection = _Connection(_Cursor(execute_error=_database_error(3113)))
        with (
            patch.object(admin_companies, "get_db_connection", return_value=connection),
            patch.object(admin_companies.logger, "exception") as log_exception,
        ):
            with self.assertRaises(HTTPException) as raised:
                admin_companies.delete_history(10, 20)

        self.assertEqual(503, raised.exception.status_code)
        self.assertEqual(0, connection.commit_count)
        self.assertEqual(1, connection.rollback_count)
        self.assertTrue(connection.cursor_instance.closed)
        self.assertEqual(1, connection.close_count)
        log_exception.assert_called_once()

    def test_cursor_creation_failure_still_rolls_back_and_closes_connection(self):
        connection = _Connection(cursor_error=RuntimeError("cursor failed"))
        with (
            patch.object(admin_companies, "get_db_connection", return_value=connection),
            patch.object(admin_companies.logger, "exception"),
        ):
            with self.assertRaises(HTTPException) as raised:
                admin_companies.delete_history(10, 20)

        self.assertEqual(500, raised.exception.status_code)
        self.assertEqual(1, connection.rollback_count)
        self.assertEqual(1, connection.close_count)


class AuthenticationTransactionTests(unittest.TestCase):
    def setUp(self):
        auth_context.invalidate_session_cache(
            auth_context._hash_session_token("session-token")
        )

    @staticmethod
    def _request():
        return SimpleNamespace(
            cookies={auth_context.SESSION_COOKIE_NAME: "session-token"},
            state=SimpleNamespace(),
        )

    @staticmethod
    def _user_row():
        return (1, "tester", "테스터", "tester@example.com", "USER", "N")

    def test_authentication_touch_commits_once(self):
        connection = _Connection(_Cursor(fetch_row=self._user_row()))
        with patch.object(auth_context, "get_db_connection", return_value=connection):
            user = auth_context.authenticate_request(self._request())

        self.assertEqual(1, user["userId"])
        self.assertEqual(1, connection.commit_count)
        self.assertEqual(0, connection.rollback_count)
        self.assertTrue(connection.cursor_instance.closed)
        self.assertEqual(1, connection.close_count)

    def test_authentication_reuses_short_lived_verification_cache(self):
        connection = _Connection(_Cursor(fetch_row=self._user_row()))
        with patch.object(
            auth_context,
            "get_db_connection",
            return_value=connection,
        ) as get_connection:
            first_user = auth_context.authenticate_request(self._request())
            second_user = auth_context.authenticate_request(self._request())

        self.assertEqual(first_user, second_user)
        get_connection.assert_called_once()
        self.assertEqual(1, connection.commit_count)

    def test_authentication_touch_failure_rolls_back_and_logs(self):
        cursor = _Cursor(
            fetch_row=self._user_row(),
            execute_error=_database_error(3113),
            error_on_execute=2,
        )
        connection = _Connection(cursor)
        with (
            patch.object(auth_context, "get_db_connection", return_value=connection),
            patch.object(auth_context.logger, "exception") as log_exception,
        ):
            with self.assertRaises(HTTPException) as raised:
                auth_context.authenticate_request(self._request())

        self.assertEqual(503, raised.exception.status_code)
        self.assertEqual(0, connection.commit_count)
        self.assertEqual(1, connection.rollback_count)
        self.assertTrue(connection.cursor_instance.closed)
        self.assertEqual(1, connection.close_count)
        log_exception.assert_called_once()

    def test_invalid_session_rolls_back_before_returning_401(self):
        connection = _Connection(_Cursor(fetch_row=None))
        with patch.object(auth_context, "get_db_connection", return_value=connection):
            with self.assertRaises(HTTPException) as raised:
                auth_context.authenticate_request(self._request())

        self.assertEqual(401, raised.exception.status_code)
        self.assertEqual(1, connection.rollback_count)
        self.assertTrue(connection.cursor_instance.closed)
        self.assertEqual(1, connection.close_count)


if __name__ == "__main__":
    unittest.main()
