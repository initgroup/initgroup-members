"""Annual staff targets and dated attribution; closed months are immutable snapshots."""
from __future__ import annotations

import calendar
import json
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException

from backend.database_helper import SqlLoader
from backend.department_config import departments
from backend.project_lifecycle import project_phase
from backend.historical_totals import active_historical, historical_reason
from backend.routers.project_assignments import _rows as assignment_rows

STAFF_TYPES = {"REGULAR", "EXECUTIVE"}
MONEY_FIELDS = ("targetAmount", "salesAmount", "costAmount", "otherCost", "netProfit", "staffSalesAmount", "contractSalesAmount", "plannedSalesAmount")


def rows(cursor, sql, params=None):
    cursor.execute(sql, params or {})
    columns = [x[0].lower() for x in cursor.description or []]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def as_date(value):
    if not value:
        return None
    return value.date() if isinstance(value, datetime) else value if isinstance(value, date) else date.fromisoformat(str(value)[:10])


def rounded(value):
    return int(Decimal(value).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def distribute(total, weights):
    """Largest remainder allocation conserves every won, including cross-department splits."""
    weights = [Decimal(str(w)) for w in weights]
    denominator = sum(weights)
    if not weights or denominator <= 0:
        return [0] * len(weights)
    raw = [Decimal(total) * w / denominator for w in weights]
    result = [int(x) for x in raw]
    order = sorted(range(len(raw)), key=lambda i: (-(raw[i] - result[i]), i))
    for i in order[:total - sum(result)]:
        result[i] += 1
    return result


def history_index(history):
    result = defaultdict(list)
    for row in history:
        result[int(row["user_id"])].append({**row, "effective_from": as_date(row["effective_from"])})
    for events in result.values():
        events.sort(key=lambda x: x["effective_from"])
    return result


def profile_at(events, day):
    return next((row for row in reversed(events) if as_date(row["effective_from"]) <= day), None)


def month_days(month):
    first = date.fromisoformat(month + "-01")
    return [first + timedelta(days=i) for i in range(calendar.monthrange(first.year, first.month)[1])]


def is_active(profile, day):
    hire = as_date(profile.get("hire_date"))
    retirement = as_date(profile.get("retirement_date"))
    return (not hire or hire <= day) and (not retirement or day <= retirement) and profile["employment_status_code"] != "LEAVE" and (profile["employment_status_code"] != "RETIRED" or bool(retirement and day <= retirement))


def annual_roster(year, history):
    """Choose one dated staff profile per year, without creating monthly targets."""
    result = []
    reference = min(date.today(), date(year, 12, 31))
    first = date(year, 1, 1)
    days = [first + timedelta(days=i) for i in range((date(year + 1, 1, 1) - first).days)]
    for user_id, events in history_index(history).items():
        eligible = []
        for day in days:
            profile = profile_at(events, day)
            if profile and profile["employment_type_code"] in STAFF_TYPES and is_active(profile, day):
                eligible.append((day, profile))
        if not eligible:
            continue
        prior = [item for item in eligible if item[0] <= reference]
        profile = (prior or eligible)[-1][1]
        result.append({"userId": user_id, "name": profile["user_name"], "department": profile["department_code"] or "UNASSIGNED",
            "departmentName": profile["department_name"] or "미지정", "employmentType": profile["employment_type_code"], "amount": "0"})
    return result


def load_sources(cursor, year):
    header = rows(cursor, SqlLoader.get_sql("ANNUAL_YEAR_GET"), {"year": year})
    # Read versions before editable data: a concurrent commit may cause a safe
    # conflict, but must never pair stale content with a newer write version.
    revisions = rows(cursor, SqlLoader.get_sql("ANNUAL_REVISIONS_GET"), {"year": year})
    historical = rows(cursor, SqlLoader.get_sql("ANNUAL_HISTORICAL_GET"), {"year": year})
    entries = rows(cursor, SqlLoader.get_sql("ANNUAL_ENTRIES_GET"), {"year": year})
    expenses = rows(cursor, SqlLoader.get_sql("ANNUAL_EXPENSE_GET"), {"year": year})
    history = rows(cursor, SqlLoader.get_sql("ANNUAL_HISTORY_GET"))
    projects = rows(cursor, SqlLoader.get_sql("ANNUAL_PROJECTS"), {"year": year})
    cursor.execute(SqlLoader.get_sql("PROJECT_ASSIGNMENT_WORKSPACE_ASSIGNMENTS"), {"projectYear": year})
    assignments = assignment_rows(cursor)
    closed = rows(cursor, SqlLoader.get_sql("ANNUAL_CLOSE_GET"), {"year": year})
    project_revenue = rows(cursor, SqlLoader.get_sql("ANNUAL_PROJECT_REVENUE"), {"year": year})
    return {"year": year, "header": header[0] if header else None, "annualEntries": entries,
            "revisions": {r["section_code"]: int(r["revision_no"]) for r in revisions},
            "annualExpense": expenses[0] if expenses else {"amount": 0, "note": ""}, "history": history, "projects": projects, "assignments": assignments,
            "projectRevenue": project_revenue, "historicalTotals": historical[0] if historical else None,
            "closed": {row["month_key"]: json.loads(row["snapshot_json"]) for row in closed}}


def assignment_facts(source):
    history = history_index(source["history"])
    projects = {int(row["project_id"]): row for row in source["projects"]}
    facts, warnings = [], set()
    for assignment in source["assignments"]:
        phase = project_phase(assignment.get("projectStatusCode"))
        if not phase:
            continue
        project_id = int(assignment["projectId"])
        if assignment.get("allocationDataQualityError") or not assignment.get("monthlyAllocations"):
            warnings.add("월별 배분이 없는 투입은 집계에서 제외했습니다.")
            continue
        try:
            sales = Decimal(str(assignment.get("salesUnitPrice") or 0))
            cost = Decimal(str(assignment.get("costUnitPrice") or 0))
            allocations = [(str(a["month"]), Decimal(str(a["mm"]))) for a in assignment["monthlyAllocations"]]
            if len({m for m, _ in allocations}) != len(allocations) or not all(mm.is_finite() and 0 <= mm <= 1 for _, mm in allocations):
                raise ValueError()
            if not sales.is_finite() or not cost.is_finite() or min(sales, cost) < 0:
                raise ValueError()
            for month, _ in allocations:
                date.fromisoformat(month + "-01")
        except (ValueError, KeyError, TypeError, ArithmeticError):
            warnings.add("월별 배분 또는 단가가 잘못된 투입은 집계에서 제외했습니다.")
            continue
        if not cost:
            warnings.add("원가단가 미입력 투입의 인력원가는 0원으로 계산됩니다. 개인 매출단가는 선택 항목입니다.")
        for month, mm in allocations:
            if not month.startswith(f"{source['year']}-") or mm <= 0:
                continue
            project = projects.get(project_id, {})
            starts = [as_date(value) for value in (assignment.get("assignmentStartDate"), project.get("project_start_date")) if value]
            ends = [as_date(value) for value in (assignment.get("assignmentEndDate"), project.get("project_end_date")) if value]
            start, end = max(starts, default=None), min(ends, default=None)
            days = [d for d in month_days(month) if (not start or d >= start) and (not end or d <= end)]
            if not days:
                warnings.add("프로젝트 수행기간 또는 투입기간 밖의 월별 배분은 제외했습니다.")
                continue
            groups = {}
            for day in days:
                user_id = assignment.get("userId")
                profile = profile_at(history.get(int(user_id), []), day) if user_id else None
                department = (profile["department_code"] if profile else projects.get(project_id, {}).get("department_code")) or "UNASSIGNED"
                employment = profile["employment_type_code"] if profile else "EXTERNAL"
                key = (department, employment)
                group = groups.setdefault(key, {"days": 0, "profile": profile})
                group["days"] += 1
                if profile and profile["source_code"] == "BASELINE":
                    warnings.add("도입 이전 소속은 현재 인사정보의 초기값입니다. 이력 검토 후 마감해 주세요.")
                if department == "UNASSIGNED":
                    warnings.add("귀속 사업부 미지정 실적이 있습니다. 외부인력은 사업·입찰 관리의 담당 사업부를 지정하세요.")
            split_sales = distribute(rounded(sales * mm), [g["days"] for g in groups.values()])
            split_cost = distribute(rounded(cost * mm), [g["days"] for g in groups.values()])
            for ((department, employment), group), sale, expense in zip(groups.items(), split_sales, split_cost):
                profile = group["profile"]
                facts.append({"month": month, "projectId": project_id, "projectName": projects.get(project_id, {}).get("project_name", "프로젝트"),
                              "assignmentId": assignment["assignmentId"],
                              "workerKey": f"USER:{user_id}" if user_id else f"COMPANY_EMPLOYEE:{assignment.get('companyEmployeeId')}",
                              "name": profile["user_name"] if profile else assignment.get("employeeName", "인력"),
                              "department": department, "employmentType": employment,
                              "category": "staff" if employment in STAFF_TYPES else "contract", "phase": phase,
                              "mm": float(mm * group["days"] / len(days)), "salesAmount": str(sale), "costAmount": str(expense),
                              "salesRateProvided": sales > 0, "salesUnitPrice": str(int(sales)), "costUnitPrice": str(int(cost)),
                              "rateEditable": month not in source.get("closed", {}),
                              "attributionMm": str(mm * group["days"] / len(days))})
    return facts, sorted(warnings)


def monthly_sales(year, facts, annual_target=None):
    """Targets are reference twelfths; revenue keeps its actual ledger month."""
    keys = [f"{year}-{month:02d}" for month in range(1, 13)]
    sales = dict.fromkeys(keys, 0)
    for fact in facts:
        if fact.get("month") in sales:
            sales[fact["month"]] += int(fact["salesAmount"])
    quotient, remainder = divmod(int(annual_target or 0), 12)
    cumulative_sales, cumulative_target = 0, 0
    result = []
    for index, month in enumerate(keys):
        target = quotient + (index < remainder)
        cumulative_sales += sales[month]
        cumulative_target += target
        result.append({"month": month, "salesAmount": str(sales[month]), "cumulativeSalesAmount": str(cumulative_sales),
            "targetReference": str(target) if annual_target is not None else None,
            "cumulativeTargetReference": str(cumulative_target) if annual_target is not None else None})
    return result


def bucket(key, name):
    return {"key": key, "name": name, **{field: 0 for field in MONEY_FIELDS}}


def report(source):
    """Annual targets and company expense are never divided or allocated to months."""
    header = source.get("header") or {}
    if header.get("year_snapshot"):
        snapshot = header["year_snapshot"]
        result = json.loads(snapshot.read() if hasattr(snapshot, "read") else snapshot)
        result.setdefault("revenueBasis", "LEGACY_WORKER_RATE")
        return result
    live_facts, warnings = assignment_facts(source)
    facts = [fact for fact in live_facts if fact["month"] not in source["closed"]]
    # Prior monthly closes remain immutable evidence for annual actuals.
    facts += [{**fact, "rateEditable": False} for month in source["closed"].values() for fact in month.get("facts", [])]
    labels = {row["code"]: row["label"] for row in departments()}
    labels["UNASSIGNED"] = "미지정"
    depts = {code: bucket(code, name) for code, name in labels.items()}
    workers, projects = {}, {}
    reference_assignments, missing_reference_assignments = defaultdict(set), defaultdict(set)
    company_extra = 0
    staff_total, extra_total = 0, 0
    for item in source["annualEntries"]:
        amount = int(item["target_amount"])
        scope = item["scope_code"]
        if scope == "COMPANY":
            company_extra += amount
            continue
        dep = item["department_code"] or "UNASSIGNED"
        department = depts.setdefault(dep, bucket(dep, item.get("department_name") or labels.get(dep, dep)))
        department["targetAmount"] += amount
        if scope == "DEPARTMENT":
            extra_total += amount
            department["extraTargetAmount"] = department.get("extraTargetAmount", 0) + amount
        else:
            staff_total += amount
            key = (f"USER:{int(item['user_id'])}", dep, item["employment_type_code"])
            worker = workers.setdefault(key, {**bucket(key[0], item["user_name"]), "department": dep,
                "employmentType": item["employment_type_code"], "category": "staff"})
            worker["targetAmount"] += amount
    project_sources = {int(p["project_id"]): p for p in source["projects"]}
    project_revenue_mode = "projectRevenue" in source
    for fact in facts:
        dep = fact["department"]
        department = depts.setdefault(dep, bucket(dep, labels.get(dep, dep)))
        key = (fact["workerKey"], dep, fact["employmentType"])
        worker = workers.setdefault(key, {**bucket(key[0], fact["name"]), "department": dep,
            "employmentType": fact["employmentType"], "category": fact["category"]})
        if fact["phase"] == "confirmed":
            provided = fact.get("salesRateProvided", int(fact["salesAmount"]) > 0)
            reference_id = fact.get("assignmentId") or (fact["projectId"], fact["workerKey"])
            reference_assignments[key].add(reference_id)
            if not provided:
                missing_reference_assignments[key].add(reference_id)
            worker["salesReferenceAvailable"] = worker.get("salesReferenceAvailable", False) or provided
            worker["salesReferenceIncomplete"] = worker.get("salesReferenceIncomplete", False) or not provided
        pid = int(fact["projectId"])
        project = projects.setdefault(pid, {**bucket(pid, fact["projectName"]), "projectId": pid,
            "status": project_sources.get(pid, {}).get("status_code", "ARCHIVED")})
        for target in (department, worker, project):
            if fact["phase"] == "confirmed":
                target["costAmount"] += int(fact["costAmount"])
                if not project_revenue_mode or target is worker:
                    target["salesAmount"] += int(fact["salesAmount"])
                    target["staffSalesAmount" if fact["category"] == "staff" else "contractSalesAmount"] += int(fact["salesAmount"])
            else:
                if not project_revenue_mode or target is worker:
                    target["plannedSalesAmount"] += int(fact["salesAmount"])
    revenue_facts, missing_revenue = [], []
    if project_revenue_mode:
        saved_projects = {int(r["project_id"]) for r in source["projectRevenue"]}
        for pid, p in project_sources.items():
            if project_phase(p.get("status_code")) != "confirmed":
                continue
            projects.setdefault(pid, {**bucket(pid, p["project_name"]), "projectId": pid, "status": p["status_code"]})
            if pid not in saved_projects and source["year"] <= date.today().year:
                missing_revenue.append({"projectId": pid, "projectName": p["project_name"], "year": source["year"],
                    "reason": "선택 연도의 프로젝트 매출이 등록되지 않았습니다. 매출 발생 후 VAT 별도 연간 합계를 입력하세요. 발생 전이라면 미등록 상태를 유지할 수 있습니다."})
        for revenue in source["projectRevenue"]:
            if project_phase(revenue["status_code"]) != "confirmed":
                continue
            pid, amount = int(revenue["project_id"]), int(revenue["amount"])
            project = projects.setdefault(pid, {**bucket(pid, revenue["project_name"]), "projectId": pid, "status": revenue["status_code"]})
            project["salesAmount"] += amount
            weights = defaultdict(Decimal)
            for fact in facts:
                if int(fact["projectId"]) == pid and fact["phase"] == "confirmed":
                    weights[(fact["department"], fact["category"])] += Decimal(str(fact.get("attributionMm", fact["mm"])))
            weights = {key: weight for key, weight in weights.items() if weight > 0}
            if not weights:
                weights = {(revenue.get("department_code") or "UNASSIGNED", "unallocated"): Decimal(1)}
            for (dep, category), share in zip(weights, distribute(amount, weights.values())):
                department = depts.setdefault(dep, bucket(dep, labels.get(dep, dep)))
                department["salesAmount"] += share
                field = "staffSalesAmount" if category == "staff" else "contractSalesAmount" if category == "contract" else "unattributedSalesAmount"
                department[field] = department.get(field, 0) + share
            revenue_facts.append({"projectId": pid, "projectName": revenue["project_name"], "year": source["year"], "salesAmount": str(amount)})
    for department in depts.values():
        department["extraTargetAmount"] = str(department.get("extraTargetAmount", 0))
        department["staffTargetAmount"] = str(department["targetAmount"] - int(department["extraTargetAmount"]))
    for key, worker in workers.items():
        worker["departmentName"] = depts[worker["department"]]["name"]
        worker["salesReferenceAssignmentCount"] = len(reference_assignments[key])
        worker["salesReferenceMissingAssignmentCount"] = len(missing_reference_assignments[key])
        # No confirmed allocation is zero activity, not an unentered sales rate.
        worker.setdefault("salesReferenceAvailable", not reference_assignments[key])
        worker.setdefault("salesReferenceIncomplete", False)
    for item in [*depts.values(), *workers.values(), *projects.values()]:
        item["unattributedSalesAmount"] = str(item.get("unattributedSalesAmount", 0))
        item["netProfit"] = item["salesAmount"] - item["costAmount"]
        item["laborMargin"] = str(item["netProfit"])
        for field in MONEY_FIELDS:
            item[field] = str(item[field])
    summary = {field: str(sum(int(d[field]) for d in depts.values())) for field in MONEY_FIELDS}
    summary["targetAmount"] = str(staff_total + extra_total + company_extra)
    summary["otherCost"] = str(source["annualExpense"]["amount"])
    summary["netProfit"] = str(int(summary["salesAmount"]) - int(summary["costAmount"]) - int(summary["otherCost"]))
    historical = active_historical(source)
    historical = historical if historical and not source.get("projectRevenue") else None
    if historical:
        if historical.get("target_amount") is not None and not source.get("annualEntries"):
            summary["targetAmount"] = str(historical["target_amount"])
        summary["salesAmount"] = str(historical["sales_amount"])
        summary["netProfit"] = str(historical["net_profit"]) if historical.get("net_profit") is not None else None
        # No cost breakdown can be reconstructed from an annual revenue/profit pair.
        summary["costAmount"], summary["otherCost"] = "0", "0"
        summary["staffSalesAmount"], summary["contractSalesAmount"] = "0", "0"
    return {"schemaVersion": 6 if historical else 5 if project_revenue_mode else 4,
        "revenueBasis": "HISTORICAL_TOTALS" if historical else "PROJECT_YEAR" if project_revenue_mode else "LEGACY_WORKER_RATE",
        "costBreakdownAvailable": not bool(historical),
        "targetRecorded": bool(source.get("annualEntries")) or bool(historical and historical.get("target_amount") is not None),
        "profitRecorded": historical.get("net_profit") is not None if historical else bool(revenue_facts),
        "revenueFacts": revenue_facts,
        "year": source["year"], "closed": False, "summary": summary, "warnings": warnings,
        "departments": [] if historical else list(depts.values()), "workers": [] if historical else list(workers.values()),
        "projects": [] if historical else list(projects.values()), "facts": [] if historical else facts,
        "missingRevenue": [] if historical else missing_revenue,
        "targetBreakdown": None if historical and not source.get("annualEntries") else {"staffAmount": str(staff_total), "departmentExtra": str(extra_total), "companyExtra": str(company_extra)}}


def annual_trend(cursor, end_year, selected_source=None, selected_report=None):
    """Reuse annual ledgers/snapshots; missing input is distinct from an entered zero."""
    result = []
    for year in range(max(1900, end_year - 2), end_year + 1):
        source = selected_source if year == end_year and selected_source is not None else load_sources(cursor, year)
        performance = selected_report if year == end_year and selected_report is not None else report(source)
        summary = performance["summary"]
        closed = bool(performance.get("closed"))
        result.append({"year": year, "closed": closed,
            "revenueBasis": performance.get("revenueBasis", "LEGACY_WORKER_RATE"),
            "targetRecorded": performance.get("targetRecorded", bool(source.get("annualEntries")) or int(summary["targetAmount"]) > 0 or closed),
            "revenueRecorded": bool(performance.get("revenueFacts")) or closed or performance.get("revenueBasis") == "HISTORICAL_TOTALS",
            "profitRecorded": performance.get("profitRecorded", bool(performance.get("revenueFacts")) or closed),
            "historicalAvailable": not historical_reason({**source, "year": year}),
            "missingRevenueCount": len(performance.get("missingRevenue", [])),
            "targetAmount": str(summary["targetAmount"]), "salesAmount": str(summary["salesAmount"]),
            "netProfit": str(summary["netProfit"]) if summary["netProfit"] is not None else None,
            "costAmount": str(summary["costAmount"]), "otherCost": str(summary["otherCost"])})
    return result


def capture_profile(cursor, user_id, effective_from=None):
    """Called in the existing HR transaction. A transfer never rewrites previous events."""
    cursor.execute(SqlLoader.get_sql("ANNUAL_HISTORY_LOCK"))
    current = rows(cursor, SqlLoader.get_sql("ANNUAL_USER_PROFILE"), {"userId": user_id})
    if not current:
        raise HTTPException(404, "인력을 찾을 수 없습니다.")
    profile = current[0]
    history = rows(cursor, SqlLoader.get_sql("ANNUAL_HISTORY_USER_GET"), {"userId": user_id})
    fields = ("user_name", "department_code", "department_name", "employment_type_code", "employment_status_code", "hire_date", "retirement_date")
    active = profile_at(history, date.today())
    if active and all((active.get(f) or "") == (profile.get(f) or "") for f in fields):
        return
    day = effective_from or date.today()
    cursor.execute(SqlLoader.get_sql("ANNUAL_LAST_CLOSE"))
    last = cursor.fetchone()[0]
    if last and day.strftime("%Y-%m") <= last:
        raise HTTPException(409, "마감월 이전 인사 이력은 변경할 수 없습니다. 적용일을 확인해 주세요.")
    if day > date.today():
        raise HTTPException(400, "현재 인사정보 변경의 적용일은 오늘 이후일 수 없습니다. 변경이 적용되는 날짜에 등록해 주세요.")
    save_profile(cursor, user_id, day, profile)


def save_profile(cursor, user_id, day, profile):
    cursor.execute(SqlLoader.get_sql("ANNUAL_HISTORY_UPSERT"), {
        "userId": user_id, "effectiveFrom": day, "name": profile["user_name"],
        "department": profile.get("department_code") or "UNASSIGNED", "departmentName": profile.get("department_name") or "미지정",
        "employmentType": profile.get("employment_type_code") or "OTHER", "employmentStatus": profile["employment_status_code"],
        "hireDate": as_date(profile.get("hire_date")), "retirementDate": as_date(profile.get("retirement_date")),
    })
