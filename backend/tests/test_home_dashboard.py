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
        self.description = []

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
        self.assertEqual("PROJECT_STATUS", data["financials"]["source"])
        self.assertNotIn("monthlyFinancials", data["financials"]["confirmed"])
        self.assertTrue(all(
            params["planYear"] == datetime.now().year
            for _, params in executions if "planYear" in params
        ))

    def test_home_uses_shared_annual_targets_and_costs_without_monthly_reports(self):
        annual={"summary":{"targetAmount":"1560","salesAmount":"0","costAmount":"0","otherCost":"101","netProfit":"-101"},
            "targetBreakdown":{"staffAmount":"1200","departmentExtra":"120","companyExtra":"240"},"facts":[],"closed":False}
        with patch.object(home,"load_annual_sources",return_value={"header":{"model_version":4}}),patch.object(home,"annual_report",return_value=annual):
            data,_=self._dashboard(2026)
        confirmed=data["financials"]["confirmed"]
        self.assertEqual("1560",confirmed["summary"]["targetAmount"])
        self.assertEqual([2024,2025,2026],[y["year"] for y in data["annualTrend"]])
        self.assertEqual(annual["summary"]["salesAmount"],data["annualTrend"][-1]["salesAmount"])
        self.assertEqual("101",confirmed["summary"]["otherCost"])
        self.assertEqual("-101",confirmed["summary"]["operatingProfit"])
        self.assertNotIn("monthlyFinancials",confirmed)
        self.assertNotIn("months",data["annualPerformance"])
        self.assertNotIn("monthlySales",confirmed)

    def test_home_revenue_and_cost_use_shared_annual_summary_without_monthly_distribution(self):
        annual={"summary":{"targetAmount":"1200","salesAmount":"750","costAmount":"300","otherCost":"101","netProfit":"349"},
            "facts":[{"month":"2026-01","phase":"confirmed","assignmentId":1,"salesAmount":"500","costAmount":"200"},
                     {"month":"2026-03","phase":"confirmed","assignmentId":1,"salesAmount":"250","costAmount":"100"}]}
        with patch.object(home,"load_annual_sources",return_value={"header":{"model_version":4}}),patch.object(home,"annual_report",return_value=annual):
            data,_=self._dashboard(2026)
        financial=data["financials"]["confirmed"]
        self.assertEqual("750",financial["summary"]["totalSalesAmount"])
        self.assertNotIn("monthlySales",financial)
        self.assertEqual("101",financial["summary"]["otherCost"])
        self.assertEqual("349",financial["summary"]["operatingProfit"])

    def test_explicit_year_is_preserved_for_all_summaries(self):
        data, executions = self._dashboard(2027)
        self.assertEqual(2027, data["planYear"])
        self.assertTrue(all(
            params["planYear"] == 2027
            for _, params in executions if "planYear" in params
        ))


if __name__ == "__main__":
    unittest.main()
