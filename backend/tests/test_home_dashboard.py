from __future__ import annotations

import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from backend.database_helper import SqlLoader
from backend.routers import home


class _DashboardCursor:
    def __init__(self):
        self.executions = []
        self.rows = []
        self.closed = False

    def execute(self, sql, params=None):
        self.executions.append((sql, params or {}))
        results = {
            SqlLoader.get_sql("HOME_DASHBOARD_COUNTS"): [(32, 32, 0)],
            SqlLoader.get_sql("HOME_EXECUTIVE_PROJECT_SUMMARY"): [(7, 0, 7, 3000, 2000)],
            SqlLoader.get_sql("HOME_EXECUTIVE_WORKFORCE_SUMMARY"): [(32, 3)],
        }
        self.rows = results.get(sql, [])

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)

    def close(self):
        self.closed = True


class _DashboardConnection:
    def __init__(self):
        self.cursor_instance = _DashboardCursor()
        self.closed = False

    def cursor(self):
        return self.cursor_instance

    def close(self):
        self.closed = True


class ExecutiveDashboardTests(unittest.TestCase):
    def _dashboard(self, year):
        connection = _DashboardConnection()
        with (
            patch.object(home, "get_db_connection", return_value=connection),
            patch.object(home, "authenticate_request", return_value={"userId": 1, "roleCode": "ADMIN"}),
        ):
            result = home.dashboard(SimpleNamespace(), planYear=year)
        self.assertTrue(connection.closed)
        self.assertTrue(connection.cursor_instance.closed)
        return result["data"], connection.cursor_instance.executions

    def test_default_year_queries_current_business_data(self):
        data, executions = self._dashboard(None)
        self.assertEqual(datetime.now().year, data["planYear"])
        self.assertEqual(7, data["projectSummary"]["projectCount"])
        self.assertEqual("2000", data["projectSummary"]["contractAmountVat"])
        self.assertEqual({"internalCount": 32, "partnerCount": 3}, data["workforce"])
        self.assertTrue(all(
            params["planYear"] == datetime.now().year
            for _, params in executions if "planYear" in params
        ))

    def test_explicit_year_is_preserved_for_all_summaries(self):
        data, executions = self._dashboard(2027)
        self.assertEqual(2027, data["planYear"])
        self.assertTrue(all(
            params["planYear"] == 2027
            for _, params in executions if "planYear" in params
        ))


if __name__ == "__main__":
    unittest.main()
