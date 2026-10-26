import json
import unittest
from datetime import date, datetime
from unittest.mock import MagicMock
from fastapi import HTTPException
from pydantic import ValidationError
from backend.annual_performance import report, annual_trend
from backend.historical_totals import HistoricalWrite, historical_dto, validate_historical


def source():
    return {"year":date.today().year-1,"header":{},"annualEntries":[],"annualExpense":{"amount":0},
        "history":[],"projects":[],"projectRevenue":[],"assignments":[],"closed":{},"historicalTotals":None}


def record(**extra):
    return {"revision_no":1,"active_yn":"Y","target_amount":9000,"sales_amount":10000,"net_profit":-100,"note":"Past closing summary",**extra}


class HistoricalTotalsTests(unittest.TestCase):
    def test_company_totals_do_not_invent_costs_or_detail_and_trend_matches(self):
        s=source();s["historicalTotals"]=record()
        p=report(s)
        self.assertEqual("HISTORICAL_TOTALS",p["revenueBasis"])
        self.assertEqual("9000",p["summary"]["targetAmount"])
        self.assertEqual("10000",p["summary"]["salesAmount"])
        self.assertEqual("-100",p["summary"]["netProfit"])
        self.assertFalse(p["costBreakdownAvailable"])
        self.assertEqual([],p["departments"]);self.assertEqual([],p["projects"]);self.assertEqual([],p["facts"])
        self.assertIsNone(p["targetBreakdown"])
        # Lower-bound year lets this test reuse one supplied report without DB calls.
        s["year"]=1900
        trend=annual_trend(MagicMock(),1900,s,p)[0]
        self.assertEqual("-100",trend["netProfit"])
        self.assertTrue(trend["revenueRecorded"]);self.assertTrue(trend["profitRecorded"])

    def test_blank_optional_amounts_stay_unknown_and_zero_is_explicit(self):
        s=source();s["historicalTotals"]=record(target_amount=None,sales_amount=0,net_profit=None)
        p=report(s)
        self.assertEqual("0",p["summary"]["salesAmount"])
        self.assertIsNone(p["summary"]["netProfit"])
        self.assertFalse(p["targetRecorded"]);self.assertFalse(p["profitRecorded"])
        dto=historical_dto(s);self.assertTrue(dto["saved"])
        self.assertIsNone(dto["targetAmount"]);self.assertIsNone(dto["netProfit"])

    def test_current_future_closed_and_detailed_years_are_rejected(self):
        base=source();payload=HistoricalWrite(revision=0,salesAmount=1)
        for change in ({"year":date.today().year},{"year":date.today().year+1},{"header":{"year_closed_at":datetime.now()}},
                       {"closed":{"2025-01":{}}},{"projectRevenue":[{"amount":0}]}):
            s={**base,**change}
            with self.assertRaises(HTTPException): validate_historical(s,payload)

    def test_revisions_survive_disable_to_prevent_old_initial_edit_overwrite(self):
        s=source();s["historicalTotals"]=record(active_yn="N",revision_no=2)
        self.assertFalse(historical_dto(s)["saved"])
        self.assertEqual(2,historical_dto(s)["revision"])
        with self.assertRaises(HTTPException): validate_historical(s,HistoricalWrite(revision=0,salesAmount=1))
        validate_historical(s,HistoricalWrite(revision=2,salesAmount=1))

    def test_existing_staff_targets_are_retained_instead_of_overridden(self):
        s=source();s["annualEntries"]=[{"scope_code":"COMPANY","target_amount":50}];s["historicalTotals"]=record(target_amount=None)
        self.assertEqual("50",report(s)["summary"]["targetAmount"])
        self.assertFalse(historical_dto(s)["targetEditable"])
        with self.assertRaises(HTTPException): validate_historical(s,HistoricalWrite(revision=1,targetAmount=999,salesAmount=1))

    def test_actual_project_revenue_takes_priority_and_is_never_added_to_history(self):
        s=source();s["historicalTotals"]=record();s["projectRevenue"]=[{"project_id":10,"project_name":"Project","status_code":"COMPLETED","amount":123}]
        p=report(s)
        self.assertEqual("123",p["summary"]["salesAmount"])
        self.assertEqual("PROJECT_YEAR",p["revenueBasis"])

    def test_annual_close_snapshot_preserves_company_totals_and_unknowns(self):
        s=source();s["historicalTotals"]=record(net_profit=None)
        closed=report(s);closed["closed"]=True
        s["header"]={"year_snapshot":json.dumps(closed)};s["historicalTotals"]=None
        self.assertEqual(closed,report(s))

    def test_negative_revenue_and_fractional_amounts_are_not_accepted(self):
        for change in ({"salesAmount":-1},{"salesAmount":1.5},{"targetAmount":-1},{"netProfit":1.1},{"salesAmount":10**24}):
            with self.assertRaises(ValidationError):
                HistoricalWrite(**{"revision":0,"salesAmount":0,**change})
