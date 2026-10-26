import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from backend.routers import admin_projects as projects


class DashboardProjectNavigationTests(unittest.TestCase):
    def test_read_only_status_groups_are_shared_by_count_and_list(self):
        for scope in ("PRE_CONTRACT", "POST_CONTRACT"):
            with self.subTest(scope=scope):
                conn = MagicMock()
                cursor = conn.cursor.return_value
                cursor.fetchone.return_value = (0,)
                cursor.fetchall.return_value = []
                with patch.object(projects, "get_db_connection", return_value=conn):
                    projects.list_projects(
                        periodYear=None, periodYearFrom=2026, periodYearTo=2026,
                        keyword="", statusCode=scope, participationTypeCode="ALL",
                        periodStart=None, periodEnd=None, bidDateFrom=None, bidDateTo=None,
                        contractAmountMin=None, contractAmountMax=None,
                        page=1, pageSize=100, sortBy="projectStartDate", sortDirection="desc",
                    )
                self.assertEqual([scope, scope], [call.args[1]["statusCode"] for call in cursor.execute.call_args_list])
                self.assertTrue(all(call.args[1]["periodYearFrom"] == 2026 for call in cursor.execute.call_args_list))
                conn.commit.assert_not_called()

    def test_a_read_filter_cannot_be_saved_as_a_project_status(self):
        for scope in ("PRE_CONTRACT", "POST_CONTRACT"):
            payload = projects.ProjectWriteRequest(
                projectYear=2026, projectName="Test", customerName="Test", projectStartDate="2026-01-01",
                projectEndDate="2026-12-31", participationTypeCode="LEAD", statusCode=scope,
            )
            with self.assertRaises(HTTPException) as error:
                projects._project_params(payload, 1)
            self.assertEqual(400, error.exception.status_code)


if __name__ == "__main__":
    unittest.main()
