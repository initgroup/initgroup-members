import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from backend.project_lifecycle import assignment_status, project_phase, registered_financials
from backend.routers import project_assignments as router


def placement(status="CONTRACTED", **overrides):
    return {
        "projectId": 1, "userId": 1, "employeeName": "Test worker",
        "projectStatusCode": status, "assignmentStatusCode": "PLANNED",
        "costUnitPrice": "800", "salesUnitPrice": "1000",
        "monthlyAllocations": [{"month": "2026-01", "mm": 1}],
        **overrides,
    }


class ProjectLifecycleTests(unittest.TestCase):
    def test_stages_move_same_placement_without_copying(self):
        for status, phase in [("PLANNED", "planning"), ("BIDDING", "planning"),
                              ("CONTRACTED", "confirmed"), ("IN_PROGRESS", "confirmed"),
                              ("COMPLETED", "confirmed")]:
            with self.subTest(status=status):
                result = registered_financials([placement(status)], 2026)
                self.assertEqual(phase, project_phase(status))
                self.assertEqual("1000", result[phase]["summary"]["totalSalesAmount"])
                other = "planning" if phase == "confirmed" else "confirmed"
                self.assertEqual(0, result[other]["summary"]["assignmentCount"])
                self.assertEqual("CONFIRMED" if phase == "confirmed" else "PLANNED", assignment_status(status))
        result = registered_financials([placement("CANCELLED"), placement("UNKNOWN")], 2026)
        self.assertEqual(0, result["confirmed"]["summary"]["assignmentCount"])
        self.assertEqual(0, result["planning"]["summary"]["assignmentCount"])
        self.assertEqual([], result["warnings"])

    def test_year_clip_rounding_precision_and_combined_overload(self):
        rows = [placement(salesUnitPrice="999999999999999999", costUnitPrice="1", monthlyAllocations=[
            {"month": "2025-12", "mm": 1}, {"month": "2026-01", "mm": 0.5}, {"month": "2027-01", "mm": 1}]),
            placement("BIDDING", projectId=2), placement("CANCELLED")]
        data = registered_financials(rows, 2026)
        summary = data["confirmed"]["summary"]
        self.assertEqual("500000000000000000", summary["totalSalesAmount"])
        self.assertEqual("1", summary["totalCostAmount"])
        self.assertEqual(0.5, summary["totalMm"])
        self.assertNotIn("monthlyFinancials", data["confirmed"])
        self.assertEqual(1, len(data["warnings"]))
        self.assertEqual(1.5, data["warnings"][0]["totalMm"])

    def test_ledger_revenue_clips_both_project_and_assignment_period(self):
        item=placement(projectStartDate="2026-02-01",projectEndDate="2026-04-30",assignmentStartDate="2026-03-01",assignmentEndDate="2026-12-31",
            monthlyAllocations=[{"month":f"2026-{m:02d}","mm":1} for m in range(1,7)])
        summary=registered_financials([item],2026)["confirmed"]["summary"]
        self.assertEqual("2000",summary["totalSalesAmount"])
        self.assertEqual(2,summary["totalMm"])

    def test_invalid_monthly_data_and_zero_prices_are_visible(self):
        data = registered_financials([
            placement(monthlyAllocations=[]),
            placement(allocationDataQualityError=True),
            placement(monthlyAllocations=[{"month": "2026-01", "mm": 1.1}]),
            placement(salesUnitPrice="0"),
        ], 2026)
        summary = data["confirmed"]["summary"]
        self.assertEqual(3, summary["invalidAllocationCount"])
        self.assertEqual(1, summary["zeroPriceCount"])
        self.assertEqual("-800", summary["operatingProfit"])

    def test_warning_details_separate_duplicate_review_and_capacity_excess(self):
        rows=[placement(assignmentId=1,projectName="A",monthlyAllocations=[{"month":"2026-01","mm":0.5}]),
              placement("BIDDING",assignmentId=2,projectId=2,projectName="B",monthlyAllocations=[{"month":"2026-01","mm":0.5}])]
        self.assertEqual([],registered_financials(rows,2026)["warnings"])
        rows[1]["monthlyAllocations"][0]["mm"]=0.6
        warning=registered_financials(rows,2026)["warnings"][0]
        self.assertEqual("OVER_CAPACITY",warning["type"])
        self.assertEqual(0.1,warning["overloadMm"])
        self.assertEqual(2,len(warning["allocations"]))
        rows[1]["projectId"]=1;rows[1]["monthlyAllocations"][0]["mm"]=1
        warning=registered_financials(rows,2026)["warnings"][0]
        self.assertEqual("OVER_CAPACITY",warning["type"])
        self.assertEqual(0.5,warning["overloadMm"])
        self.assertIn("여러 투입 행"," ".join(warning["reasons"]))
        rows=[placement(availableStartDate="2026-02-01",monthlyAllocations=[{"month":"2026-01","mm":0.2}])]
        self.assertEqual([],registered_financials(rows,2026)["warnings"])

    def test_zero_price_details_identify_the_placement_and_recalculate_after_rates_are_saved(self):
        rows=[placement(assignmentId=10,projectName="Priced project",salesUnitPrice="0",costUnitPrice="100"),
              placement(assignmentId=11,userId=2,salesUnitPrice="200",costUnitPrice="0")]
        result=registered_financials(rows,2026)["confirmed"]
        self.assertEqual(1,result["summary"]["zeroSalesPriceCount"])
        self.assertEqual(1,result["summary"]["zeroCostPriceCount"])
        self.assertEqual(2,len(result["dataQualityIssues"]))
        self.assertEqual(10,result["dataQualityIssues"][0]["assignmentId"])
        self.assertIn("매출단가가 0원",result["dataQualityIssues"][0]["reasons"][0])
        self.assertIn("원가단가가 0원",result["dataQualityIssues"][1]["reasons"][0])
        for row in rows:
            row.update(salesUnitPrice="200",costUnitPrice="100")
        result=registered_financials(rows,2026)["confirmed"]
        self.assertEqual([],result["dataQualityIssues"])
        self.assertEqual("400",result["summary"]["totalSalesAmount"])
        self.assertEqual("200",result["summary"]["operatingProfit"])

    def test_single_and_batch_save_ignore_stale_client_status(self):
        for status, expected in [("BIDDING", "PLANNED"), ("CONTRACTED", "CONFIRMED")]:
            for batch in (False, True):
                with self.subTest(status=status, batch=batch):
                    conn = MagicMock()
                    cursor = conn.cursor.return_value
                    cursor.fetchone.return_value = (10,)
                    cursor.var.return_value.getvalue.return_value = [123]
                    payload = SimpleNamespace(projectCompanyId=1)
                    with (patch.object(router, "get_db_connection", return_value=conn),
                          patch.object(router, "_lock_project", return_value=status),
                          patch.object(router, "_assignment_params", return_value={"assignmentStatusCode": "PLANNED" if expected == "CONFIRMED" else "CONFIRMED"}),
                          patch.object(router, "_ensure_company"), patch.object(router, "_ensure_person"),
                          patch.object(router, "get_request_user_id", return_value=1)):
                        if batch:
                            router.create_assignments_batch(1, SimpleNamespace(assignments=[payload, payload]), SimpleNamespace())
                        else:
                            router.create_assignment(1, payload, SimpleNamespace())
                    inserts = [call.args[1] for call in cursor.execute.call_args_list if "assignmentIdOut" in call.args[1]]
                    self.assertEqual(2 if batch else 1, len(inserts))
                    self.assertTrue(all(row["assignmentStatusCode"] == expected for row in inserts))
                    conn.commit.assert_called_once()
                    conn.rollback.assert_not_called()


if __name__ == "__main__":
    unittest.main()
