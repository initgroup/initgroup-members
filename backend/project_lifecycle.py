"""Classification and annual performance of the single registered project ledger."""
from decimal import Decimal, ROUND_HALF_UP
from datetime import date


CONFIRMED_STATUSES = frozenset({"CONTRACTED", "IN_PROGRESS", "COMPLETED"})
PLANNING_STATUSES = frozenset({"PLANNED", "BIDDING"})


def project_phase(status: str) -> str | None:
    status = str(status or "").upper()
    if status in CONFIRMED_STATUSES:
        return "confirmed"
    if status in PLANNING_STATUSES:
        return "planning"
    return None


def assignment_status(status: str) -> str:
    return "CONFIRMED" if project_phase(status) == "confirmed" else "PLANNED"


def _financial_issue(assignment, kind, reasons):
    return {
        "type": kind, "assignmentId": assignment.get("assignmentId"), "projectId": assignment.get("projectId"),
        "projectName": assignment.get("projectName") or f"프로젝트 #{assignment.get('projectId')}",
        "employeeName": assignment.get("employeeName") or "이름 미정",
        "startDate": assignment.get("assignmentStartDate"), "endDate": assignment.get("assignmentEndDate"),
        "salesUnitPrice": str(assignment.get("salesUnitPrice") or 0), "costUnitPrice": str(assignment.get("costUnitPrice") or 0),
        "reasons": reasons,
    }


def registered_financials(assignments: list[dict], year: int) -> dict:
    """Use saved monthly MM, round each placement-month like the write path, and clip to year."""
    months = [f"{year}-{month:02d}" for month in range(1, 13)]
    result = {}
    capacity = {}
    for phase in ("confirmed", "planning"):
        result[phase] = {
            "salesAmount": 0, "costAmount": 0, "totalMm": Decimal(0),
            "workers": set(), "projects": set(), "assignmentCount": 0,
            "zeroPriceCount": 0, "invalidAllocationCount": 0,
            "zeroSalesPriceCount": 0, "zeroCostPriceCount": 0, "dataQualityIssues": [],
        }
    for assignment in assignments:
        phase = project_phase(assignment.get("projectStatusCode"))
        if phase is None:
            continue
        target = result[phase]
        allocations = assignment.get("monthlyAllocations") or []
        if assignment.get("allocationDataQualityError") or not allocations:
            target["invalidAllocationCount"] += 1
            target["dataQualityIssues"].append(_financial_issue(assignment, "INVALID_ALLOCATION", [
                "월별 투입 배분을 읽을 수 없거나 배분이 없어 매출·원가 집계에서 제외했습니다. 투입 설정에서 월별 배분을 저장해 주세요."]))
            continue
        parsed = []
        seen = set()
        try:
            starts = [date.fromisoformat(str(assignment[key])[:10]) for key in ("projectStartDate", "assignmentStartDate") if assignment.get(key)]
            ends = [date.fromisoformat(str(assignment[key])[:10]) for key in ("projectEndDate", "assignmentEndDate") if assignment.get(key)]
            start, end = max(starts, default=None), min(ends, default=None)
            cost = Decimal(str(assignment.get("costUnitPrice") or 0))
            sales = Decimal(str(assignment.get("salesUnitPrice") or 0))
            if not cost.is_finite() or not sales.is_finite() or cost < 0 or sales < 0:
                raise ValueError("Invalid price")
            for allocation in allocations:
                month = str(allocation.get("month") or "")
                mm = Decimal(str(allocation.get("mm") or 0))
                if month in seen or not mm.is_finite() or mm < 0 or mm > 1:
                    raise ValueError("Invalid monthly allocation")
                seen.add(month)
                if (month in months and mm > 0 and (not start or month >= start.strftime("%Y-%m"))
                        and (not end or month <= end.strftime("%Y-%m")) and (not start or not end or start <= end)):
                    parsed.append((month, mm))
        except (ValueError, TypeError, AttributeError, ArithmeticError):
            target["invalidAllocationCount"] += 1
            target["dataQualityIssues"].append(_financial_issue(assignment, "INVALID_ALLOCATION", [
                "기간·단가·월별 M/M에 유효하지 않은 값 또는 중복 배분월이 있어 매출·원가 집계에서 제외했습니다. 투입 설정을 확인해 주세요."]))
            continue
        if not parsed:
            continue
        worker = (f"USER:{assignment['userId']}" if assignment.get("userId") is not None
                  else f"COMPANY_EMPLOYEE:{assignment.get('companyEmployeeId')}")
        target["workers"].add(worker)
        target["projects"].add(assignment["projectId"])
        target["assignmentCount"] += 1
        if cost == 0 or sales == 0:
            target["zeroPriceCount"] += 1
            reasons = []
            if sales == 0:
                target["zeroSalesPriceCount"] += 1
                reasons.append("매출단가가 0원이므로 등록된 M/M을 곱해도 이 투입의 매출은 0원입니다.")
            if cost == 0:
                target["zeroCostPriceCount"] += 1
                reasons.append("원가단가가 0원이므로 인력원가가 0원으로 계산됩니다. 순이익을 비교하기 전에 원가단가를 확인해 주세요.")
            reasons.append("매출은 월별 M/M × 매출단가, 관리 순이익은 매출 − 인력원가 − 회사 연간 기타비용으로 계산합니다.")
            target["dataQualityIssues"].append(_financial_issue(assignment, "ZERO_PRICE", reasons))
        for month, mm in parsed:
            target["salesAmount"] += int((mm * sales).quantize(Decimal(1), rounding=ROUND_HALF_UP))
            target["costAmount"] += int((mm * cost).quantize(Decimal(1), rounding=ROUND_HALF_UP))
            target["totalMm"] += mm
            available_start = str(assignment.get("availableStartDate") or "")[:7]
            available_end = str(assignment.get("availableEndDate") or "")[:7]
            limit = 1 if (not available_start or month >= available_start) and (not available_end or month <= available_end) else 0
            usage = capacity.setdefault((worker, month), {"mm": Decimal(0), "capacityMm": limit,
                "name": assignment.get("employeeName") or "이름 미정", "allocations": [], "projects": set(),
                "availableStartDate": assignment.get("availableStartDate"), "availableEndDate": assignment.get("availableEndDate")})
            usage["mm"] += mm
            usage["projects"].add(assignment["projectId"])
            usage["allocations"].append({"assignmentId": assignment.get("assignmentId"), "projectId": assignment["projectId"],
                "projectName": assignment.get("projectName") or f"프로젝트 #{assignment['projectId']}", "phase": phase,
                "startDate": assignment.get("assignmentStartDate"), "endDate": assignment.get("assignmentEndDate"), "mm": float(mm),
                "role": assignment.get("projectRoleName") or "", "source": "저장된 투입"})
    for phase, target in result.items():
        total_sales = target["salesAmount"]
        total_cost = target["costAmount"]
        result[phase] = {
            "summary": {
                "assignmentCount": target["assignmentCount"],
                "workerCount": len(target["workers"]),
                "projectCount": len(target["projects"]),
                "totalMm": float(target["totalMm"]),
                "totalSalesAmount": str(total_sales), "totalCostAmount": str(total_cost),
                "operatingProfit": str(total_sales - total_cost),
                "zeroPriceCount": target["zeroPriceCount"],
                "zeroSalesPriceCount": target["zeroSalesPriceCount"],
                "zeroCostPriceCount": target["zeroCostPriceCount"],
                "invalidAllocationCount": target["invalidAllocationCount"],
            },
            "dataQualityIssues": target["dataQualityIssues"],
        }
    result["warnings"] = []
    for (worker, month), usage in sorted(capacity.items()):
        overloaded = usage["mm"] > 1
        if not overloaded:
            continue
        excess = usage["mm"] - 1
        reasons = [f"전체 프로젝트 투입 {usage['mm']:g} M/M이 월 중복 판정 기준 1 M/M을 {excess:g} M/M 초과했습니다."]
        if usage["capacityMm"] == 0:
            reasons.append("해당 월은 등록된 입사·퇴사 또는 소속회사 가용기간 밖입니다. 등록된 고용·가용기간도 확인해 주세요.")
        if len(usage["projects"]) > 1:
            reasons.append(f"같은 달의 {len(usage['projects'])}개 프로젝트 투입을 합산했습니다. 프로젝트 수와 관계없이 합계가 1 M/M 이하면 정상입니다.")
        if len(usage["allocations"]) > len(usage["projects"]):
            reasons.append("동일 프로젝트의 여러 투입 행도 각각 합산했습니다. 아래 투입기간과 행별 M/M을 확인해 주세요.")
        result["warnings"].append({"type": "OVER_CAPACITY", "workerKey": worker,
            "employeeName": usage["name"], "month": month, "totalMm": float(usage["mm"]), "capacityMm": 1, "availableMm": usage["capacityMm"],
            "overloadMm": float(excess), "projectCount": len(usage["projects"]), "duplicate": True,
            "reasons": reasons, "allocations": usage["allocations"], "availableStartDate": usage["availableStartDate"], "availableEndDate": usage["availableEndDate"],
            "message": f"{usage['name']}님의 {month} 총 투입량이 {usage['mm']:g} M/M입니다."})
    result["source"] = "PROJECT_STATUS"
    return result
