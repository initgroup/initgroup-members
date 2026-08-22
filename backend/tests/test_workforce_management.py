from __future__ import annotations

import unittest
from unittest.mock import patch

from backend.database_helper import SqlLoader
from backend.routers import workforce_management


class _Cursor:
    def __init__(self):
        self.description = []
        self.rows = []
        self.executions = []
        self.closed = False

    def execute(self, sql, params=None):
        self.executions.append((sql, params or {}))
        if sql == SqlLoader.get_sql("WORKFORCE_MANAGEMENT_ESTABLISHMENT_YEAR"):
            self.description = [("ESTABLISHMENT_YEAR",)]
            self.rows = [(2010,)]
        elif sql == SqlLoader.get_sql("PLANNING_SCENARIO_LIST"):
            self.description = [("SCENARIO_ID",)]
            self.rows = [(5,)]
        else:
            self.description = []
            self.rows = []

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)

    def close(self):
        self.closed = True


class _Connection:
    def __init__(self):
        self.cursor_instance = _Cursor()
        self.closed = False

    def cursor(self):
        return self.cursor_instance

    def close(self):
        self.closed = True


class WorkforceManagementBootstrapTests(unittest.TestCase):
    def test_bootstrap_uses_three_pooled_branches_for_initial_data(self):
        connections = [_Connection(), _Connection(), _Connection()]
        with (
            patch.object(
                workforce_management,
                "get_db_connection",
                side_effect=connections,
            ) as get_connection,
            patch.object(
                workforce_management,
                "load_scenario_detail",
                return_value={"scenarioId": 5},
            ) as load_scenario_detail,
        ):
            response = workforce_management.bootstrap(planYear=2026)

        data = response["data"]
        self.assertEqual(2026, data["planYear"])
        self.assertEqual(2010, data["establishmentYear"])
        self.assertTrue(data["departments"])
        self.assertEqual(5, data["scenarios"][0]["scenarioId"])
        self.assertEqual({"scenarioId": 5}, data["scenario"])
        self.assertEqual(3, get_connection.call_count)
        self.assertEqual(
            7,
            sum(len(item.cursor_instance.executions) for item in connections),
        )
        self.assertTrue(all(item.cursor_instance.closed for item in connections))
        self.assertTrue(all(item.closed for item in connections))
        capacity_seed = load_scenario_detail.call_args.args[2]
        self.assertEqual(3, len(capacity_seed))
        executed_sql = [
            sql
            for connection in connections
            for sql, _params in connection.cursor_instance.executions
        ]
        self.assertNotIn(
            SqlLoader.get_sql("PLANNING_REFERENCE_ACTUAL_ASSIGNMENTS"),
            executed_sql,
        )


if __name__ == "__main__":
    unittest.main()
