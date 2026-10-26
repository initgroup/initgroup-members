"""Optional DB integration check. Uses unused year 2099 and ALWAYS rolls back."""
from datetime import date, timedelta
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from fastapi import HTTPException
from backend.database import get_db_connection
from backend.database_helper import SqlLoader
from backend.department_config import departments
from backend.annual_performance import load_sources, annual_roster, rows
from backend.routers import annual_targets as api
from backend.user_history import get_history, change_history, HistoryWrite


class RollbackOnlyConnection:
    def __init__(self, connection):
        self.connection = connection
    def cursor(self):
        return self.connection.cursor()
    def commit(self):
        pass  # End-to-end transaction owner below always rolls back.
    def rollback(self):
        pass
    def close(self):
        pass


class FutureDate(date):
    @classmethod
    def today(cls):
        return date(2100, 1, 1)


def main():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("ANNUAL_YEAR_GET"), {"year": 2099})
        if cursor.fetchone():
            raise RuntimeError("Refusing to test: year 2099 is already in use.")
        source = load_sources(cursor, 2099)
        # History DML uses an existing employee only inside this rollback-only transaction.
        user_id = int(source["history"][0]["user_id"])
        original = get_history(cursor, user_id)
        days = {event["effective_from"] for event in original["items"]}
        day = date.today()
        while day.isoformat() in days:
            day -= timedelta(days=1)
        if original["lastClosedMonth"] and day.strftime("%Y-%m") <= original["lastClosedMonth"]:
            raise RuntimeError("No open history date available for rollback-only verification.")
        event = original["items"][-1]
        history_body = HistoryWrite(effectiveFrom=day, department=departments()[0]["code"],
            employmentType="REGULAR", employmentStatus="ACTIVE", hireDate=event["hire_date"], retirementDate=None)
        created = change_history(cursor, user_id, history_body)
        new = next(e for e in created["items"] if e["effective_from"] == day.isoformat())
        assert len(created["items"]) == len(original["items"]) + 1
        history_body.versionToken = new["version_token"]
        history_body.department = departments()[1]["code"]
        updated = change_history(cursor, user_id, history_body, day, new["version_token"])
        latest = next(e for e in updated["items"] if e["effective_from"] == day.isoformat())
        assert latest["department_code"] == history_body.department
        profile = rows(cursor, SqlLoader.get_sql("ANNUAL_USER_PROFILE"), {"userId": user_id})[0]
        assert profile["department_code"] == history_body.department
        try:
            change_history(cursor, user_id, original_day=day, version="1900-01-01T00:00:00.000000")
            raise AssertionError("Stale history version unexpectedly accepted")
        except HTTPException as exc:
            assert exc.status_code == 409
        deleted = change_history(cursor, user_id, original_day=day, version=latest["version_token"])
        assert len(deleted["items"]) == len(original["items"])
        conn.rollback()
        assert get_history(cursor, user_id) == original
        candidates = annual_roster(2099, source["history"])
        if not candidates:
            raise RuntimeError("No staff candidate available for annual target check.")
        person = candidates[0]
        department = person["department"]
        with (patch.object(api, "get_db_connection", return_value=RollbackOnlyConnection(conn)),
              patch.object(api, "get_request_user_id", return_value=0), patch.object(api, "date", FutureDate)):
            saved = api.save_staff(2099, api.SaveStaff(revision=0,staff=[{"userId":person["userId"],"amount":1200}]), SimpleNamespace())["data"]
            assert saved["performance"]["summary"]["targetAmount"] == "1200"
            assert "months" not in saved["performance"]
            # Other sections retain their independent revision=0 after employee save.
            saved = api.save_departments(2099,api.SaveDepartments(revision=0,extras=[{"department":department,"amount":120}]),SimpleNamespace())["data"]
            saved = api.save_company(2099,api.SaveCompany(revision=0,amount=240),SimpleNamespace())["data"]
            assert saved["performance"]["summary"]["targetAmount"] == "1560"
            saved = api.save_expenses(2099,api.SaveExpenses(revision=0,amount=101,note="ROLLBACK ONLY"),SimpleNamespace())["data"]
            assert saved["revision"] == 4 and saved["annualExpense"]["amount"] == "101"
            assert saved["performance"]["summary"]["netProfit"] == "-101"
            try:
                api.save_staff(2099,api.SaveStaff(revision=0,staff=[]),SimpleNamespace())
                raise AssertionError("Stale employee revision accepted")
            except HTTPException as exc:
                assert exc.status_code == 409
            closed = api.close_year(2099,api.CloseYear(revision=4,reviewedHistory=True),SimpleNamespace())["data"]
            assert closed["performance"]["closed"]
            cursor.execute(SqlLoader.get_sql("ANNUAL_LAST_CLOSE"))
            assert cursor.fetchone()[0] == "2099-12"
            assert closed["performance"]["summary"]["targetAmount"] == "1560"
            assert closed["performance"]["summary"]["otherCost"] == "101"
            assert "months" not in closed["performance"]
            for action in (
                lambda:api.save_staff(2099,api.SaveStaff(revision=closed["revisions"]["staff"],staff=[]),SimpleNamespace()),
                lambda:api.save_expenses(2099,api.SaveExpenses(revision=closed["revisions"]["expenses"],amount=200),SimpleNamespace())):
                try:
                    action();raise AssertionError("Closed annual record unexpectedly changed")
                except HTTPException as exc:
                    assert exc.status_code==409
        conn.rollback()
        assert load_sources(cursor, 2099)["header"] is None
        assert not load_sources(cursor, 2099)["closed"]
        print("Oracle integration passed: history CRUD and current profile sync, independent annual staff/extras/cost saves, annual-only report, single annual cost, preserved yearly close, section revisions, complete rollback.")
    finally:
        if conn:
            conn.rollback()
        if cursor:
            cursor.close()
        if conn:
            conn.close()


if __name__ == "__main__":
    main()
