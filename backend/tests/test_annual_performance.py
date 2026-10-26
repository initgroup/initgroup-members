import copy
import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from backend.annual_performance import distribute, annual_roster, report, capture_profile, monthly_sales, annual_trend
from backend.routers import annual_targets as api


def history(day="1900-01-01", department="APP", employment="REGULAR", **extra):
    return {"user_id": 1, "effective_from": date.fromisoformat(day), "user_name": "Test",
            "department_code": department, "department_name": department,
            "employment_type_code": employment, "employment_status_code": "ACTIVE",
            "hire_date": date(2026, 1, 1), "retirement_date": None, "source_code": "VERIFIED", **extra}


def source():
    return {"year": 2026, "header": {"revision_no": 1, "staff_annual_rate": 1200},
            "history": [history()], "annualEntries": [], "annualExpense": {"amount":0,"note":""}, "closed": {},
            "projects": [{"project_id": 10, "project_name": "Project", "status_code": "CONTRACTED", "contract_amount_vat": 5000, "order_amount_vat": 9000, "participation_rate": 50, "department_code": "APP"}],
            "assignments": [{"projectId": 10, "assignmentId": 1, "userId": 1, "projectStatusCode": "CONTRACTED",
                "assignmentStartDate": "2026-01-01", "assignmentEndDate": "2026-12-31",
                "salesUnitPrice": "1000", "costUnitPrice": "600", "monthlyAllocations": [{"month": "2026-01", "mm": 1}]}]}


class AnnualPerformanceTests(unittest.TestCase):
    def test_three_year_trend_reuses_selected_year_and_preserves_snapshots_and_missing(self):
        selected=source();selected["projectRevenue"]=[]
        current=report(selected)
        historic={"year":2024,"annualEntries":[]}
        missing={"year":2025,"annualEntries":[]}
        snapshot={"closed":True,"revenueBasis":"LEGACY_WORKER_RATE","summary":{"targetAmount":"999999999999999999","salesAmount":"900000000000000001","netProfit":"-100","costAmount":"900000000000000101","otherCost":"0"}}
        empty={"closed":False,"revenueFacts":[],"missingRevenue":[],"summary":{"targetAmount":"0","salesAmount":"0","netProfit":"0","costAmount":"0","otherCost":"0"}}
        with patch("backend.annual_performance.load_sources",side_effect=[historic,missing]) as load,patch("backend.annual_performance.report",side_effect=[snapshot,empty]):
            trend=annual_trend(MagicMock(),2026,selected,current)
        self.assertEqual([2024,2025,2026],[y["year"] for y in trend])
        self.assertEqual(2,load.call_count)
        self.assertEqual("900000000000000001",trend[0]["salesAmount"])
        self.assertEqual("-100",trend[0]["netProfit"])
        self.assertTrue(trend[0]["revenueRecorded"])
        self.assertFalse(trend[1]["revenueRecorded"])
        self.assertFalse(trend[2]["revenueRecorded"])
        self.assertEqual(1,trend[2]["missingRevenueCount"])

    def test_three_year_trend_keeps_explicit_zero_and_lower_year_bound(self):
        s=source();s["year"]=1900;s["assignments"]=[]
        p={"summary":{"targetAmount":"0","salesAmount":"0","netProfit":"0","costAmount":"0","otherCost":"0"},"revenueFacts":[{"salesAmount":"0"}]}
        result=annual_trend(MagicMock(),1900,s,p)
        self.assertEqual([1900],[y["year"] for y in result])
        self.assertTrue(result[0]["revenueRecorded"])
        self.assertEqual("0",result[0]["salesAmount"])

    def test_project_revenue_replaces_personal_rates_without_double_counting(self):
        s=source();s["projectRevenue"]=[{"project_id":10,"project_name":"Project","status_code":"CONTRACTED","department_code":"APP","amount":9000}]
        s["annualExpense"]={"amount":100}
        result=report(s)
        self.assertEqual("9000",result["summary"]["salesAmount"])
        self.assertEqual("8300",result["summary"]["netProfit"])
        self.assertEqual("1000",result["workers"][0]["salesAmount"])
        self.assertEqual("9000",result["projects"][0]["salesAmount"])
        self.assertEqual("PROJECT_YEAR",result["revenueBasis"])
        self.assertEqual([],result["missingRevenue"])

    def test_missing_annual_revenue_does_not_fall_back_to_personal_rate(self):
        s=source();s["projectRevenue"]=[]
        result=report(s)
        self.assertEqual("0",result["summary"]["salesAmount"])
        self.assertEqual("-600",result["summary"]["netProfit"])
        self.assertEqual(10,result["missingRevenue"][0]["projectId"])

    def test_saved_zero_revenue_is_not_missing_and_rates_remain_optional(self):
        s=source();s["assignments"][0]["salesUnitPrice"]="0"
        s["projectRevenue"]=[{"project_id":10,"project_name":"Project","status_code":"CONTRACTED","amount":0}]
        result=report(s)
        self.assertEqual([],result["missingRevenue"])
        self.assertEqual("0",result["summary"]["salesAmount"])
        self.assertFalse(any("단가" in w for w in result["warnings"]))
        self.assertFalse(result["workers"][0]["salesReferenceAvailable"])

    def test_annual_project_revenue_keeps_hr_shares_and_exact_won(self):
        s=source();s["history"].append(history("2026-01-16","DATA",employment="CONTRACT"))
        s["projectRevenue"]=[{"project_id":10,"project_name":"Project","status_code":"CONTRACTED","amount":1001}]
        result=report(s)
        self.assertEqual(1001,sum(int(d["salesAmount"]) for d in result["departments"]))
        self.assertTrue(int(result["summary"]["staffSalesAmount"])>0)
        self.assertTrue(int(result["summary"]["contractSalesAmount"])>0)

    def test_project_without_workforce_still_has_revenue_and_cancelled_is_excluded(self):
        s=source();s["assignments"]=[];s["projectRevenue"]=[{"project_id":10,"project_name":"Project","status_code":"CONTRACTED","department_code":"APP","amount":1001},
            {"project_id":20,"project_name":"Cancelled","status_code":"CANCELLED","amount":999999}]
        result=report(s)
        self.assertEqual("1001",result["summary"]["salesAmount"])
        self.assertEqual("1001",next(d for d in result["departments"] if d["key"]=="APP")["unattributedSalesAmount"])

    def test_staff_roster_excludes_contractors_and_has_no_monthly_entries(self):
        roster = annual_roster(2026,[history(),history(employment="CONTRACT",user_id=2),history(employment="EXECUTIVE",user_id=3)])
        self.assertEqual({1,3},{r["userId"] for r in roster})
        self.assertTrue(all(r["amount"]=="0" and "month" not in r for r in roster))

    def test_annual_goals_and_costs_are_exact_and_never_split(self):
        s=source()
        person={"userId":1,"name":"Test","department":"APP","departmentName":"APP","employmentType":"REGULAR"}
        s["annualEntries"]=[api.entry("STAFF",1,1001,person=person),api.entry("DEPARTMENT","APP",25,department="APP"),api.entry("COMPANY","ALL",13)]
        s["annualExpense"]={"amount":101,"note":"Yearly cost"}
        result=report(s)
        self.assertNotIn("months",result)
        self.assertEqual("1039",result["summary"]["targetAmount"])
        self.assertEqual("101",result["summary"]["otherCost"])
        self.assertEqual("299",result["summary"]["netProfit"])
        self.assertEqual({"staffAmount":"1001","departmentExtra":"25","companyExtra":"13"},result["targetBreakdown"])
        self.assertEqual("1001",result["workers"][0]["targetAmount"])
        app=next(d for d in result["departments"] if d["key"]=="APP")
        self.assertEqual("1026",app["targetAmount"])
        self.assertEqual("400",app["laborMargin"])
        self.assertEqual("400",result["projects"][0]["laborMargin"])

    def test_annual_actual_attribution_uses_dated_profiles_and_preserves_every_won(self):
        s=source();s["history"].append(history("2026-01-16","DATA",employment="CONTRACT"))
        result=report(s);facts=result["facts"]
        self.assertEqual({"APP","DATA"},{f["department"] for f in facts})
        self.assertEqual({"staff","contract"},{f["category"] for f in facts})
        self.assertEqual(1000,sum(int(f["salesAmount"]) for f in facts))
        self.assertEqual(600,sum(int(f["costAmount"]) for f in facts))
        self.assertEqual(1,sum(f["mm"] for f in facts))

    def test_old_month_close_preserves_actuals_without_cost_double_counting(self):
        s=source();january=copy.deepcopy(report(s)["facts"])
        s["closed"]={"2026-01":{"facts":january,"totals":{"otherCost":"101"}}}
        s["annualExpense"]={"amount":101,"note":"Migrated yearly cost"}
        s["assignments"][0]["salesUnitPrice"]="99999"
        result=report(s)
        self.assertEqual("1000",result["summary"]["salesAmount"])
        self.assertEqual("299",result["summary"]["netProfit"])
        self.assertEqual(january,result["facts"])

    def test_year_snapshot_survives_hr_project_target_and_cost_changes(self):
        import json
        s=source();snapshot=report(s);snapshot["closed"]=True
        s["header"]["year_snapshot"]=json.dumps(snapshot)
        s["history"]=[];s["assignments"]=[];s["projects"]=[];s["annualEntries"]=[];s["annualExpense"]={"amount":9999}
        self.assertEqual(snapshot,report(s))

    def test_only_company_year_cost_without_assignments_is_counted_once(self):
        s=source();s["assignments"]=[];s["annualExpense"]={"amount":777}
        result=report(s)
        self.assertEqual("-777",result["summary"]["netProfit"])
        self.assertEqual("0",result["summary"]["salesAmount"])
        self.assertFalse(result["projects"])

    def test_planning_cancelled_and_contractors_keep_the_same_annual_classification(self):
        for state,planned in [("PLANNED","1000"),("BIDDING","1000"),("CANCELLED","0")]:
            s=source();s["assignments"][0]["projectStatusCode"]=state
            result=report(s)
            self.assertEqual("0",result["summary"]["salesAmount"])
            self.assertEqual(planned,result["summary"]["plannedSalesAmount"])
        s=source();s["assignments"][0].update(userId=None,companyEmployeeId=5,employeeName="External");s["projects"][0]["department_code"]="DATA"
        result=report(s)
        self.assertEqual("DATA",result["facts"][0]["department"])
        self.assertEqual("1000",result["summary"]["contractSalesAmount"])
        self.assertEqual("0",result["summary"]["targetAmount"])

    def test_monthly_reference_continues_but_revenue_stops_at_project_end(self):
        s=source();s["projects"][0].update(project_start_date=date(2026,1,1),project_end_date=date(2026,3,15))
        s["assignments"][0]["monthlyAllocations"]=[{"month":"2026-01","mm":0.5},{"month":"2026-02","mm":1},{"month":"2026-03","mm":0.25},{"month":"2026-04","mm":1},{"month":"2026-12","mm":1}]
        annual=report(s);series=monthly_sales(2026,annual["facts"],12000)
        self.assertEqual("1750",annual["summary"]["salesAmount"])
        self.assertEqual(["500","1000","250"],[m["salesAmount"] for m in series[:3]])
        self.assertTrue(all(m["salesAmount"]=="0" for m in series[3:]))
        self.assertTrue(all(m["targetReference"]=="1000" for m in series))
        self.assertEqual("12000",series[-1]["cumulativeTargetReference"])
        self.assertTrue(all(m["cumulativeSalesAmount"]=="1750" for m in series[2:]))

    def test_cross_year_revenue_and_large_goal_preserve_annual_totals(self):
        s=source();s["projects"][0].update(project_start_date=date(2025,11,1),project_end_date=date(2027,2,28))
        s["assignments"][0].update(assignmentStartDate="2025-11-01",assignmentEndDate="2027-02-28",monthlyAllocations=[{"month":"2025-12","mm":1},{"month":"2026-01","mm":0.5},{"month":"2026-12","mm":0.2},{"month":"2027-01","mm":1}])
        annual=report(s);goal=999999999999999999999997
        series=monthly_sales(2026,annual["facts"],goal)
        self.assertEqual("700",annual["summary"]["salesAmount"])
        self.assertEqual(700,sum(int(m["salesAmount"]) for m in series))
        self.assertEqual(goal,sum(int(m["targetReference"]) for m in series))
        self.assertEqual(str(goal),series[-1]["cumulativeTargetReference"])
        self.assertNotIn("otherCost",series[0])
        planning=monthly_sales(2026,annual["facts"])
        self.assertTrue(all(m["targetReference"] is None for m in planning))

    def test_stale_revision_and_closed_history_are_rejected(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = (2,)
        with self.assertRaises(HTTPException) as error:
            api.lock_year(cursor, 2026, 1)
        self.assertEqual(409, error.exception.status_code)
    def test_failed_write_rolls_back_and_closes_resources(self):
        conn = MagicMock()
        with patch.object(api, "get_db_connection", return_value=conn):
            with self.assertRaises(HTTPException):
                api.transaction(lambda _cursor: (_ for _ in ()).throw(HTTPException(409, "conflict")))
        conn.rollback.assert_called_once()
        conn.commit.assert_not_called()
        conn.close.assert_called_once()
        conn.cursor.return_value.close.assert_called_once()

    def test_annual_roster_has_one_entry_per_staff_and_never_creates_an_amount(self):
        items = annual_roster(2026, [history(),history("2026-02-01", "DATA"),history(user_id=2,employment="CONTRACT")])
        self.assertEqual(1,len(items)); self.assertEqual("DATA",items[0]["department"])
        self.assertEqual("0",items[0]["amount"])

    def test_section_models_reject_duplicate_management_fields(self):
        from pydantic import ValidationError
        for field in ("month", "departmentTargets", "goals", "expenses"):
            with self.assertRaises(ValidationError):
                api.SaveStaff(revision=0,staff=[],**{field:[]})
        with self.assertRaises(ValidationError):
            api.SaveExpenses(revision=0,expenses=[{"month":"2026-01","amount":1}])

    def test_section_conflict_rejects_write_without_using_another_sections_revision(self):
        s=source();s["revisions"]={"staff":2,"expenses":0}
        cursor=MagicMock()
        with (patch.object(api,"transaction",side_effect=lambda cb:cb(cursor)),patch.object(api,"lock_year"),
              patch.object(api,"load_sources",return_value=s),patch.object(api,"get_request_user_id",return_value=1)):
            with self.assertRaises(HTTPException) as error:
                api.save_section(2026,"staff",1,SimpleNamespace(),lambda *_:self.fail("stale write executed"))
            self.assertEqual(409,error.exception.status_code)

    def test_hr_corrections_reject_closed_dates_stale_versions_and_last_deletion(self):
        from backend.user_history import change_history, HistoryWrite
        events = [{**history(), "effective_from": "2026-01-01", "version_token": "current"}]
        cursor = MagicMock()
        with patch("backend.user_history.get_history", return_value={"items": events, "lastClosedMonth": "2026-02"}):
            with self.assertRaises(HTTPException) as error:
                change_history(cursor, 1, original_day=date(2026,1,1), version="current")
            self.assertEqual(409, error.exception.status_code)
        with patch("backend.user_history.get_history", return_value={"items": events, "lastClosedMonth": None}):
            for token in ("stale", "current"):
                with self.assertRaises(HTTPException) as error:
                    change_history(cursor, 1, original_day=date(2026,1,1), version=token)
                self.assertEqual(409, error.exception.status_code)

    def test_closed_year_rejects_all_section_writes(self):
        s=source();s["header"]["year_closed_at"]=date(2027,1,1);s["revisions"]={"expenses":0}
        cursor=MagicMock()
        with (patch.object(api,"transaction",side_effect=lambda cb:cb(cursor)),patch.object(api,"lock_year"),
              patch.object(api,"load_sources",return_value=s),patch.object(api,"get_request_user_id",return_value=1)):
            with self.assertRaises(HTTPException) as error:
                api.save_expenses(2026,api.SaveExpenses(revision=0,amount=100),SimpleNamespace())
        self.assertEqual(409,error.exception.status_code);cursor.execute.assert_not_called()

    def test_admin_history_routes_and_rollback_are_protected(self):
        from backend.routers import admin_users
        from backend.auth_context import require_admin_role
        self.assertIn(require_admin_role, [d.dependency for d in admin_users.router.dependencies])
        conn = MagicMock()
        with patch.object(admin_users, "get_db_connection", return_value=conn):
            with self.assertRaises(HTTPException):
                admin_users._history_transaction(lambda cursor: (_ for _ in ()).throw(HTTPException(409, "conflict")))
        conn.rollback.assert_called_once()
        conn.commit.assert_not_called()
        conn.close.assert_called_once()

    def test_only_admin_can_access_new_router_and_menu(self):
        from backend.auth_context import require_admin_role
        from backend.portal_access import portal_access_for_role
        self.assertIn(require_admin_role, [d.dependency for d in api.router.dependencies])
        self.assertNotIn("annual-targets", portal_access_for_role("USER")["pageFiles"]["htmlPages"])
        self.assertIn("annual-targets", portal_access_for_role("ADMIN")["pageFiles"]["htmlPages"])
        with self.assertRaises(HTTPException) as error:
            require_admin_role(SimpleNamespace(state=SimpleNamespace(auth_user={"userId": 1, "roleCode": "USER"})))
        self.assertEqual(403, error.exception.status_code)

    def test_hr_change_appends_at_effective_date_without_rewriting_old_event(self):
        current = history("2026-03-01", "DATA")
        old = history(department="APP")
        cursor = MagicMock()
        cursor.fetchone.return_value = ("2026-01",)
        with patch("backend.annual_performance.rows", side_effect=[[current], [old]]):
            capture_profile(cursor, 1, date(2026, 3, 1))
        saved = cursor.execute.call_args.args[1]
        self.assertEqual(date(2026, 3, 1), saved["effectiveFrom"])
        self.assertEqual("DATA", saved["department"])
        self.assertNotEqual(old["effective_from"], saved["effectiveFrom"])


if __name__ == "__main__":
    unittest.main()
