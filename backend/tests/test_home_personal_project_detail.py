from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.routers import home


class _DetailCursor:
    def __init__(self, project_found=True, photo_found=True):
        self.project_found = project_found
        self.photo_found = photo_found
        self.executions = []
        self.rows = []
        self.closed = False

    def execute(self, sql, params=None):
        self.executions.append((sql, params or {}))
        if sql == SqlLoader.get_sql("HOME_PERSONAL_PROJECT_DETAIL"):
            self.rows = [(
                7,
                2026,
                "테스트 프로젝트",
                "테스트 고객사",
                "2026-01-01",
                "2026-12-31",
                "LEAD",
                100,
                "2025-12-20",
                "2025-12-01",
                "IN_PROGRESS",
                "프로젝트 설명",
            )] if self.project_found else []
        elif sql == SqlLoader.get_sql("HOME_PERSONAL_PROJECT_WORKFORCE"):
            self.rows = [(
                11,
                "USER",
                "홍길동",
                "인아이티",
                "APP개발사업부",
                "과장",
                "팀원",
                "2026-01-01",
                "2026-12-31",
                "CONFIRMED",
                "MONTHLY",
                1,
                12,
                "개발자",
                "서비스 개발",
                "Y",
                42,
                "profile.jpg",
                "2026-01-02T03:04:05.000000",
            )]
        elif sql == SqlLoader.get_sql("HOME_PERSONAL_PROJECT_USER_PHOTO"):
            self.rows = [(
                "image/jpeg",
                b"stored-photo",
                "2026-01-02T03:04:05.000000",
            )] if self.photo_found else []
        else:
            self.rows = []

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)

    def close(self):
        self.closed = True


class _DetailConnection:
    def __init__(self, project_found=True, photo_found=True):
        self.cursor_instance = _DetailCursor(project_found, photo_found)
        self.closed = False

    def cursor(self):
        return self.cursor_instance

    def close(self):
        self.closed = True


class PersonalProjectDetailTests(unittest.TestCase):
    def test_detail_uses_session_user_and_excludes_financial_fields(self):
        connection = _DetailConnection()
        request = SimpleNamespace(query_params={"userId": "999"})
        with (
            patch.object(
                home,
                "authenticate_request",
                return_value={"userId": 42, "roleCode": "USER"},
            ),
            patch.object(home, "get_db_connection", return_value=connection),
        ):
            result = home.my_project_detail(7, request)

        expected_params = {"projectId": 7, "userId": 42}
        self.assertEqual(2, len(connection.cursor_instance.executions))
        self.assertTrue(all(
            params == expected_params
            for _sql, params in connection.cursor_instance.executions
        ))
        self.assertEqual("테스트 프로젝트", result["data"]["project"]["projectName"])
        self.assertEqual("홍길동", result["data"]["workforce"][0]["employeeName"])
        self.assertEqual("profile.jpg", result["data"]["workforce"][0]["photoFileName"])
        response_keys = str(result).lower()
        for forbidden in ("amount", "price", "cost", "sales", "profit"):
            self.assertNotIn(forbidden, response_keys)
        self.assertTrue(connection.cursor_instance.closed)
        self.assertTrue(connection.closed)

    def test_photo_uses_session_user_and_returns_cached_thumbnail(self):
        connection = _DetailConnection()
        with (
            patch.object(
                home,
                "authenticate_request",
                return_value={"userId": 42, "roleCode": "USER"},
            ),
            patch.object(home, "get_db_connection", return_value=connection),
            patch.object(home, "_photo_thumbnail", return_value=b"thumbnail") as thumbnail,
        ):
            response = home.my_project_user_photo(
                7,
                43,
                SimpleNamespace(query_params={}),
                v="photo-version",
            )

        self.assertEqual(b"thumbnail", response.body)
        self.assertEqual("image/jpeg", response.media_type)
        self.assertEqual("private, max-age=31536000, immutable", response.headers["cache-control"])
        self.assertEqual(
            {
                "projectId": 7,
                "photoUserId": 43,
                "viewerUserId": 42,
            },
            connection.cursor_instance.executions[0][1],
        )
        thumbnail.assert_called_once()
        self.assertTrue(connection.cursor_instance.closed)
        self.assertTrue(connection.closed)

    def test_photo_is_not_exposed_without_shared_project_assignment(self):
        connection = _DetailConnection(photo_found=False)
        with (
            patch.object(
                home,
                "authenticate_request",
                return_value={"userId": 42, "roleCode": "USER"},
            ),
            patch.object(home, "get_db_connection", return_value=connection),
            self.assertRaises(HTTPException) as raised,
        ):
            home.my_project_user_photo(
                99,
                43,
                SimpleNamespace(query_params={}),
                v="",
            )

        self.assertEqual(404, raised.exception.status_code)
        self.assertTrue(connection.cursor_instance.closed)
        self.assertTrue(connection.closed)

    def test_detail_returns_not_found_when_user_is_not_assigned(self):
        connection = _DetailConnection(project_found=False)
        with (
            patch.object(
                home,
                "authenticate_request",
                return_value={"userId": 42, "roleCode": "USER"},
            ),
            patch.object(home, "get_db_connection", return_value=connection),
            self.assertRaises(HTTPException) as raised,
        ):
            home.my_project_detail(99, SimpleNamespace(query_params={}))

        self.assertEqual(404, raised.exception.status_code)
        self.assertEqual(1, len(connection.cursor_instance.executions))
        self.assertTrue(connection.cursor_instance.closed)
        self.assertTrue(connection.closed)


if __name__ == "__main__":
    unittest.main()
