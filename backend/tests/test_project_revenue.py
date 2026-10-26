import unittest
from datetime import date, datetime
from unittest.mock import MagicMock, patch
from fastapi import HTTPException
from pydantic import ValidationError
from backend import project_revenue as revenue
from backend.database_helper import SqlLoader


PROJECT = {"projectId": 10, "projectStartDate": "2025-03-01", "projectEndDate": "2027-05-31", "contractAmountVat": "999999999999999999"}


class ProjectRevenueTests(unittest.TestCase):
    def test_three_tax_years_and_zero_are_distinct_from_missing(self):
        saved=[{"revenue_year":2026,"revision_no":4,"amount":0,"note":"No revenue"}]
        with patch.object(revenue,"rows",side_effect=[saved,[{"plan_year":2025}]]):
            result=revenue.revenue_detail(MagicMock(),PROJECT)
        self.assertEqual([1,2,3],[y["ordinal"] for y in result["years"]])
        self.assertTrue(result["years"][0]["closed"])
        self.assertFalse(result["years"][0]["saved"])
        self.assertTrue(result["years"][1]["saved"])
        self.assertEqual("0",result["years"][1]["totalAmount"])
        self.assertEqual(PROJECT["contractAmountVat"],result["contractAmountVat"])

    def test_closed_year_rejects_before_any_revenue_write(self):
        cursor=MagicMock();cursor.fetchone.return_value=(1,)
        with patch.object(revenue,"rows",return_value=[{"year_closed_at":datetime.now()}]):
            with self.assertRaises(HTTPException) as caught:
                revenue.save_revenue(cursor,PROJECT,2026,revenue.RevenueWrite(revision=0,amount=1),1)
        self.assertEqual(409,caught.exception.status_code)
        self.assertFalse(any("MERGE" in call.args[0] for call in cursor.execute.call_args_list))

    def test_concurrent_revision_conflict_preserves_saved_amount(self):
        cursor=MagicMock();cursor.fetchone.side_effect=[(1,),(10,)]
        with patch.object(revenue,"rows",side_effect=[[{}],[],[{"revision_no":2}]]):
            with self.assertRaises(HTTPException) as caught:
                revenue.save_revenue(cursor,PROJECT,2026,revenue.RevenueWrite(revision=1,amount=10),1)
        self.assertEqual(409,caught.exception.status_code)
        self.assertFalse(any("MERGE" in call.args[0] for call in cursor.execute.call_args_list))

    def test_prior_month_close_protects_annual_revenue(self):
        cursor=MagicMock();cursor.fetchone.side_effect=[(1,),(10,)]
        with patch.object(revenue,"rows",side_effect=[[{}],[],[],[{"month_key":"2026-01"}]]):
            with self.assertRaises(HTTPException) as caught:
                revenue.save_revenue(cursor,PROJECT,2026,revenue.RevenueWrite(revision=0,amount=1),1)
        self.assertEqual(409,caught.exception.status_code)

    def test_save_writes_only_the_requested_year_and_leaves_commit_to_caller(self):
        cursor=MagicMock();cursor.fetchone.side_effect=[(1,),(10,)]
        with patch.object(revenue,"rows",side_effect=[[{}],[],[],[]]),patch.object(revenue,"revenue_detail",return_value={"ok":True}):
            result=revenue.save_revenue(cursor,PROJECT,2026,revenue.RevenueWrite(revision=0,amount=999999999999999999,note="Tax year"),1)
        save=[call for call in cursor.execute.call_args_list if call.args[0]==SqlLoader.get_sql("PROJECT_REVENUE_YEAR_SAVE")]
        self.assertEqual(1,len(save))
        self.assertEqual({"projectId":10,"year":2026,"amount":999999999999999999,"note":"Tax year","actor":1},save[0].args[1])
        cursor.connection.commit.assert_not_called()
        self.assertTrue(result["ok"])

    def test_historical_total_blocks_project_revenue_without_writing_it(self):
        cursor=MagicMock();cursor.fetchone.return_value=(1,)
        with patch.object(revenue,"rows",side_effect=[[{}],[{"active_yn":"Y"}]]):
            with self.assertRaises(HTTPException) as caught:
                revenue.save_revenue(cursor,PROJECT,2025,revenue.RevenueWrite(revision=0,amount=123),1)
        self.assertEqual(409,caught.exception.status_code)
        self.assertFalse(any("MERGE" in call.args[0] for call in cursor.execute.call_args_list))

    def test_amount_is_annual_whole_won_and_does_not_accept_month_fields(self):
        for payload in ({"amount":-1},{"amount":1.5},{"amount":10**18},{"amount":1,"month":1}):
            with self.assertRaises(ValidationError):
                revenue.RevenueWrite(revision=0,**payload)


if __name__ == "__main__":
    unittest.main()
