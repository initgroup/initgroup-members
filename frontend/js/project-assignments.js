(function() {
    "use strict";

    const PAGE_NAME = "project-assignments";
    const TYPE_LABELS = { LEAD: "주관사", CONSORTIUM: "컨소사", SUBCONTRACT: "하도급" };
    const WEEKDAY_CODES = ["MON", "TUE", "WED", "THU", "FRI"];
    let root = null;
    let controller = null;
    let projects = [];
    let workers = [];
    let masterCompanies = [];
    let companies = [];
    let assignments = [];
    let currentProject = null;
    let projectDataRequestId = 0;
    let loadedProjectId = "";
    let activeYear = "";
    let projectDataLoading = false;
    let companyFormDirty = false;
    let assignmentFormDirty = false;
    let boardProjects = [];
    let boardAssignments = [];
    let boardSelectedWorkerKey = "";
    let boardLoading = false;
    let boardLoadPromise = null;
    let compactMode = false;
    let boardDraftAssignmentId = "";

    function query(selector) { return root?.querySelector(selector) || null; }
    function value(row, ...keys) { return Common.data.pick(row, ...keys); }
    function integerAmount(nextValue) {
        const text = String(nextValue ?? "0").trim();
        try { return BigInt(/^-?\d+$/.test(text) ? text : String(Math.round(Number(text) || 0))); }
        catch (_error) { return 0n; }
    }
    function money(nextValue) { return `${integerAmount(nextValue).toLocaleString("ko-KR")}원`; }
    function number(nextValue) { return Number(nextValue || 0); }
    function roundedAllocationAmount(mm, unitPrice) {
        const hundredths = BigInt(Math.round(number(mm) * 100));
        return (integerAmount(unitPrice) * hundredths + 50n) / 100n;
    }
    function percentage(numerator, denominator) {
        const base = integerAmount(denominator);
        if (base === 0n) return 0;
        return Number(integerAmount(numerator) * 1000n / base) / 10;
    }
    function option(valueText, text) { return Common.dom.element("option", { value: valueText, text }); }
    function cell(text = "") { return Common.dom.element("td", { text }); }

    function selectedProjectId() { return query("#assignmentProjectSelect").value; }

    function setFormDirty(formName, value = true) {
        if (formName === "company") companyFormDirty = Boolean(value);
        if (formName === "assignment") assignmentFormDirty = Boolean(value);
        const form = query(formName === "company" ? "#projectCompanyForm" : "#assignmentForm");
        if (form) form.dataset.dirty = String(Boolean(value));
        const boardSaveButton = query("#assignmentBoardSaveButton");
        if (boardSaveButton && !compactMode) boardSaveButton.disabled = !assignmentFormDirty;
    }

    function boardDrafts() {
        return boardAssignments.filter((item) => String(value(item, "draftYn", "DRAFT_YN") || "") === "Y");
    }

    function syncBoardDraftControls() {
        const drafts = boardDrafts();
        const saveButton = query("#assignmentBoardSaveButton");
        if (saveButton && compactMode) {
            saveButton.disabled = drafts.length === 0;
            saveButton.textContent = drafts.length ? `변경사항 저장 (${drafts.length})` : "변경사항 저장";
        }
    }

    function hasUnsavedFormChanges() {
        return companyFormDirty || assignmentFormDirty || boardDrafts().length > 0;
    }

    async function canDiscardFormChanges() {
        if (!hasUnsavedFormChanges()) return true;
        const confirmed = await Common.ui.confirm(
            "현재 프로젝트에 저장하지 않은 변경사항이 있습니다. 저장하지 않고 다른 화면으로 이동하시겠습니까?",
            { title: "변경사항 확인", confirmText: "저장하지 않고 이동", danger: true }
        );
        if (!confirmed) return false;
        clearCompanyForm();
        clearAssignmentForm();
        clearAllBoardDrafts();
        return true;
    }

    function beforeUnload(event) {
        if (!hasUnsavedFormChanges()) return;
        event.preventDefault();
        event.returnValue = "";
    }

    function loadedProjectForMutation(statusElement = query("#assignmentPageStatus")) {
        const selectedId = selectedProjectId();
        if (
            projectDataLoading
            || !loadedProjectId
            || String(selectedId) !== String(loadedProjectId)
        ) {
            Common.ui.setInlineStatus(statusElement, "프로젝트 정보를 다시 불러온 뒤 작업해 주세요.", "error");
            return "";
        }
        return loadedProjectId;
    }

    function projectPeriod() {
        if (!currentProject) return { startDate: "", endDate: "" };
        return {
            startDate: String(value(currentProject, "projectStartDate", "PROJECT_START_DATE") || "").slice(0, 10),
            endDate: String(value(currentProject, "projectEndDate", "PROJECT_END_DATE") || "").slice(0, 10)
        };
    }

    function applyProjectPeriod() {
        const { startDate, endDate } = projectPeriod();
        const periodElement = query("#assignmentProjectPeriod");
        periodElement.textContent = `프로젝트 기간: ${startDate} ~ ${endDate}`;
        periodElement.hidden = !(startDate && endDate);
        [query("#assignmentStartDate"), query("#assignmentEndDate")].forEach((input) => {
            input.removeAttribute("min");
            input.removeAttribute("max");
        });
    }

    function validateAssignmentPeriod() {
        const startInput = query("#assignmentStartDate");
        const endInput = query("#assignmentEndDate");
        [startInput, endInput].forEach((input) => input.setCustomValidity(""));
        if (!startInput.value || !endInput.value) return true;
        if (startInput.value > endInput.value) {
            endInput.setCustomValidity("투입 종료일은 시작일보다 빠를 수 없습니다.");
            return false;
        }
        return true;
    }

    function renderProjectOptions() {
        const selectedYear = query("#assignmentProjectYearSelect").value;
        const projectSelect = query("#assignmentProjectSelect");
        const previousProjectId = projectSelect.value;
        const yearProjects = projects.filter((project) => (
            projectOverlapsYear(project, selectedYear)
        ));
        projectSelect.replaceChildren(option(
            "",
            yearProjects.length ? "전체 프로젝트" : "등록된 프로젝트 없음"
        ));
        yearProjects.forEach((project) => projectSelect.appendChild(option(
            value(project, "projectId", "PROJECT_ID"),
            value(project, "projectName", "PROJECT_NAME")
        )));
        if ([...projectSelect.options].some((item) => item.value === previousProjectId)) {
            projectSelect.value = previousProjectId;
        }
    }

    function projectOverlapsYear(project, yearValue) {
        const year = Number(yearValue);
        const startYear = Number(String(value(project, "projectStartDate", "PROJECT_START_DATE") || "").slice(0, 4));
        const endYear = Number(String(value(project, "projectEndDate", "PROJECT_END_DATE") || "").slice(0, 4));
        if (Number.isInteger(startYear) && Number.isInteger(endYear)) {
            return startYear <= year && year <= endYear;
        }
        return false;
    }

    function populateReferences(preferredYear) {
        const currentYear = String(new Date().getFullYear());
        const yearSet = new Set();
        projects.forEach((project) => {
            const startYear = Number(String(value(project, "projectStartDate", "PROJECT_START_DATE") || "").slice(0, 4));
            const endYear = Number(String(value(project, "projectEndDate", "PROJECT_END_DATE") || "").slice(0, 4));
            if (Number.isInteger(startYear) && Number.isInteger(endYear) && startYear <= endYear) {
                for (let year = Math.max(1900, startYear); year <= Math.min(2100, endYear); year += 1) yearSet.add(String(year));
                return;
            }
        });
        const years = Array.from(yearSet);
        if (!years.includes(currentYear)) years.push(currentYear);
        const requestedYear = String(preferredYear || "");
        if (/^\d{4}$/.test(requestedYear) && !years.includes(requestedYear)) years.push(requestedYear);
        years.sort((left, right) => Number(right) - Number(left));

        const yearSelect = query("#assignmentProjectYearSelect");
        yearSelect.replaceChildren(...years.map((year) => option(year, `${year}년`)));
        yearSelect.value = years.includes(requestedYear) ? requestedYear : currentYear;
        activeYear = yearSelect.value;
        renderProjectOptions();
        Common.ui.setInlineStatus(query("#assignmentPageStatus"), `${activeYear}년에 수행기간이 겹치는 프로젝트를 선택해 주세요.`);

        const typeLabels = { HEADQUARTERS: "본사", PARTNER: "협력업체" };
        const companySelect = query("#projectCompanyMaster");
        companySelect.replaceChildren(option("", "등록 회사 선택"));
        masterCompanies.forEach((company) => companySelect.appendChild(option(
            value(company, "companyId", "COMPANY_ID"),
            `${typeLabels[value(company, "companyTypeCode", "COMPANY_TYPE_CODE")] || "회사"} · ${value(company, "companyName", "COMPANY_NAME")}`
        )));
        query("#assignmentEmployee").replaceChildren(option("", "소속회사를 먼저 선택해 주세요"));
        query("#assignmentEmployee").disabled = true;
        query("#newAssignmentButton").disabled = true;
    }

    async function loadReferences(options = {}) {
        const payload = await Common.api.request("/project-assignments/references", {
            signal: controller.signal,
            showLoading: false
        });
        const data = Common.data.get(payload) || {};
        projects = value(data, "projects", "PROJECTS") || [];
        workers = value(data, "workers", "WORKERS") || [];
        masterCompanies = value(data, "companies", "COMPANIES") || [];
        populateReferences(options.projectYear);
        const hasRequestedProject = options.projectId && [...query("#assignmentProjectSelect").options].some((item) => (
            item.value === String(options.projectId)
        ));
        if (hasRequestedProject) query("#assignmentProjectSelect").value = String(options.projectId);
        await loadAssignmentBoard();
        if (hasRequestedProject) {
            await loadProjectData();
            renderAssignmentBoard();
        }
    }

    function renderSummary(summary) {
        const sales = value(summary, "totalSalesAmount", "TOTAL_SALES_AMOUNT") || "0";
        const profit = value(summary, "operatingProfit", "OPERATING_PROFIT") || "0";
        const contractAmount = value(summary, "contractAmountVat", "CONTRACT_AMOUNT_VAT") || "0";
        query("#summaryContractAmount").textContent = money(contractAmount);
        query("#summaryTotalMm").textContent = `${number(value(summary, "totalMm", "TOTAL_MM")).toFixed(2)} M`;
        query("#summarySalesAmount").textContent = money(sales);
        query("#summaryCostAmount").textContent = money(value(summary, "totalCostAmount", "TOTAL_COST_AMOUNT"));
        query("#summaryProfitAmount").textContent = money(profit);
        query("#summaryProfitRate").textContent = integerAmount(sales) !== 0n ? `${percentage(profit, sales).toFixed(1)}%` : "0%";
        query("#summaryCompanyShareRate").textContent = `${number(value(summary, "companyShareRate", "COMPANY_SHARE_RATE")).toFixed(2)}%`;
        query("#summaryCompanyAllocatedAmount").textContent = money(value(summary, "companyAllocatedAmount", "COMPANY_ALLOCATED_AMOUNT"));
        query("#summarySalesContractRate").textContent = integerAmount(contractAmount) !== 0n ? `${percentage(sales, contractAmount).toFixed(1)}%` : "0%";
        query("#assignmentSummary").hidden = false;
    }

    function renderCompanies() {
        const body = query("#projectCompanyTableBody");
        Common.dom.clear(body);
        if (!companies.length) {
            const row = Common.dom.element("tr");
            const empty = cell("등록된 참여회사가 없습니다.");
            empty.colSpan = 7;
            empty.style.textAlign = "center";
            row.appendChild(empty);
            body.appendChild(row);
        }
        companies.forEach((company) => {
            const companyName = value(company, "companyName", "COMPANY_NAME") || "회사명 미정";
            const row = Common.dom.element("tr", {
                attrs: {
                    tabindex: "0",
                    "data-company-id": String(value(company, "projectCompanyId", "PROJECT_COMPANY_ID")),
                    "aria-label": `${companyName} 참여회사 편집`
                }
            });
            row.append(
                cell(companyName),
                cell(TYPE_LABELS[value(company, "participationTypeCode", "PARTICIPATION_TYPE_CODE")] || "-"),
                cell(`${number(value(company, "shareRate", "SHARE_RATE")).toFixed(2)}%`),
                cell(money(value(company, "allocatedSalesAmount", "ALLOCATED_SALES_AMOUNT"))),
                cell(money(value(company, "totalCostAmount", "TOTAL_COST_AMOUNT"))),
                cell(money(value(company, "totalSalesAmount", "TOTAL_SALES_AMOUNT"))),
                cell(money(value(company, "operatingProfit", "OPERATING_PROFIT")))
            );
            body.appendChild(row);
        });
        const companySelect = query("#assignmentCompany");
        const selected = companySelect.value;
        companySelect.replaceChildren(option("", "소속회사 선택"));
        companies.forEach((company) => companySelect.appendChild(option(
            value(company, "projectCompanyId", "PROJECT_COMPANY_ID"),
            value(company, "companyName", "COMPANY_NAME")
        )));
        companySelect.value = selected;
    }

    function renderAssignmentEmployees(selectedValue = "", legacyItem = null) {
        const employeeSelect = query("#assignmentEmployee");
        const projectCompany = companies.find((company) => (
            String(value(company, "projectCompanyId", "PROJECT_COMPANY_ID")) === query("#assignmentCompany").value
        ));
        const companyId = projectCompany ? value(projectCompany, "companyId", "COMPANY_ID") : null;
        if (!companyId) {
            employeeSelect.replaceChildren(option("", "소속회사를 먼저 선택해 주세요"));
            employeeSelect.disabled = true;
            return;
        }

        const companyWorkers = workers.filter((worker) => (
            String(value(worker, "companyId", "COMPANY_ID")) === String(companyId)
        ));
        employeeSelect.replaceChildren(option("", companyWorkers.length ? "임직원 선택" : "등록된 임직원 없음"));
        companyWorkers.forEach((worker) => {
            const employeeNo = value(worker, "employeeNo", "EMPLOYEE_NO");
            const department = value(worker, "departmentName", "DEPARTMENT_NAME") || "부서 미지정";
            const workerValue = `${value(worker, "workerTypeCode", "WORKER_TYPE_CODE")}:${value(worker, "workerId", "WORKER_ID")}`;
            employeeSelect.appendChild(option(workerValue, `${value(worker, "userName", "USER_NAME")} · ${department}${employeeNo ? ` · ${employeeNo}` : ""}`));
        });
        if (selectedValue && ![...employeeSelect.options].some((item) => item.value === selectedValue) && legacyItem) {
            employeeSelect.appendChild(option(selectedValue, `${value(legacyItem, "userName", "USER_NAME")} · 기존 투입정보`));
        }
        employeeSelect.disabled = false;
        employeeSelect.value = selectedValue;
    }

    function renderAssignments() {
        const body = query("#assignmentTableBody");
        Common.dom.clear(body);
        if (!assignments.length) {
            const row = Common.dom.element("tr");
            const empty = cell("등록된 투입인력이 없습니다.");
            empty.colSpan = 11;
            empty.style.textAlign = "center";
            row.appendChild(empty);
            body.appendChild(row);
        }
        assignments.forEach((assignment) => {
            const userName = value(assignment, "userName", "USER_NAME") || "이름 미정";
            const row = Common.dom.element("tr", {
                attrs: {
                    tabindex: "0",
                    "data-assignment-id": String(value(assignment, "assignmentId", "ASSIGNMENT_ID")),
                    "aria-label": `${userName} 투입정보 편집`
                }
            });
            const department = value(assignment, "departmentName", "DEPARTMENT_NAME") || "-";
            const position = value(assignment, "positionName", "POSITION_NAME") || "-";
            row.append(
                cell(userName),
                cell(`${department} / ${position}`),
                cell(value(assignment, "companyName", "COMPANY_NAME") || "소속회사 미등록"),
                cell(value(assignment, "assignmentStatusCode", "ASSIGNMENT_STATUS_CODE") === "PLANNED" ? "계획 투입" : "확정 투입"),
                cell(`${value(assignment, "assignmentStartDate", "ASSIGNMENT_START_DATE")} ~ ${value(assignment, "assignmentEndDate", "ASSIGNMENT_END_DATE")}`),
                cell(value(assignment, "allocationTypeCode", "ALLOCATION_TYPE_CODE") === "WEEKLY" ? `매주 ${value(assignment, "weeklyDayCodes", "WEEKLY_DAY_CODES") || ""}` : "월별"),
                cell(`${number(value(assignment, "totalMm", "TOTAL_MM")).toFixed(2)} M`),
                cell(money(value(assignment, "costUnitPrice", "COST_UNIT_PRICE"))),
                cell(money(value(assignment, "salesUnitPrice", "SALES_UNIT_PRICE"))),
                cell(money(value(assignment, "totalCostAmount", "TOTAL_COST_AMOUNT"))),
                cell(money(value(assignment, "totalSalesAmount", "TOTAL_SALES_AMOUNT"))),
                cell(money(value(assignment, "operatingProfit", "OPERATING_PROFIT")))
            );
            body.appendChild(row);
        });
    }

    function setProjectDataLoading(value) {
        projectDataLoading = Boolean(value);
        query("#assignmentProjectYearSelect").disabled = projectDataLoading;
        query("#assignmentProjectSelect").disabled = projectDataLoading;
        query("#newAssignmentButton").disabled = projectDataLoading || !loadedProjectId;
        ["#projectCompanyPanel", "#assignmentListPanel", "#assignmentEditorPanel", "#assignmentEditorActionBar"].forEach((selector) => {
            const panel = query(selector);
            panel.inert = projectDataLoading;
            panel.setAttribute("aria-busy", String(projectDataLoading));
        });
    }

    function clearProjectDataView() {
        loadedProjectId = "";
        currentProject = null;
        companies = [];
        assignments = [];
        query("#assignmentProjectPeriod").textContent = "";
        query("#assignmentProjectPeriod").hidden = true;
        Common.dom.clear(query("#projectCompanyTableBody"));
        Common.dom.clear(query("#assignmentTableBody"));
        ["#assignmentSummary", "#projectCompanyPanel", "#assignmentListPanel", "#assignmentEditorPanel", "#assignmentEditorActionBar"].forEach((selector) => {
            query(selector).hidden = true;
        });
        clearCompanyForm();
        clearAssignmentForm();
        query("#newAssignmentButton").disabled = true;
    }

    async function loadProjectData(options = {}) {
        const requestId = ++projectDataRequestId;
        const projectId = selectedProjectId();
        const preserveView = options.preserveView === true
            && Boolean(projectId)
            && String(loadedProjectId) === String(projectId);
        if (!preserveView) clearProjectDataView();
        if (!projectId) {
            setProjectDataLoading(false);
            Common.ui.setInlineStatus(query("#assignmentPageStatus"), `${query("#assignmentProjectYearSelect").value}년 프로젝트를 선택해 주세요.`);
            return;
        }
        if (!preserveView) {
            setProjectDataLoading(true);
            Common.ui.setInlineStatus(query("#assignmentPageStatus"), "프로젝트 투입정보를 불러오고 있습니다.");
        }
        try {
            const payload = await Common.api.request(`/project-assignments?projectId=${encodeURIComponent(projectId)}`, { signal: controller.signal, showLoading: false });
            if (requestId !== projectDataRequestId) return;
            const data = Common.data.get(payload) || {};
            currentProject = value(data, "project", "PROJECT") || null;
            const responseProjectId = value(currentProject, "projectId", "PROJECT_ID");
            if (!currentProject || String(responseProjectId) !== String(projectId)) {
                throw new Error("선택한 프로젝트와 조회 결과가 일치하지 않습니다.");
            }
            loadedProjectId = String(projectId);
            companies = value(data, "companies", "COMPANIES") || [];
            assignments = value(data, "assignments", "ASSIGNMENTS") || [];
            applyProjectPeriod();
            renderSummary(value(data, "summary", "SUMMARY") || {});
            if (options.renderCompanies !== false) renderCompanies();
            if (options.renderAssignments !== false) renderAssignments();
            ["#projectCompanyPanel", "#assignmentListPanel", "#assignmentEditorPanel"].forEach((selector) => query(selector).hidden = false);
            query("#assignmentEditorActionBar").hidden = false;
            if (options.resetCompanyForm !== false) clearCompanyForm();
            if (options.resetAssignmentForm !== false) clearAssignmentForm();
            Common.ui.setInlineStatus(
                query("#assignmentPageStatus"),
                options.statusMessage || `${assignments.length}명의 투입인력을 조회했습니다.`,
                options.statusMessage ? "success" : ""
            );
        } catch (error) {
            if (requestId === projectDataRequestId && error?.name !== "AbortError") {
                if (!preserveView) clearProjectDataView();
                Common.ui.setInlineStatus(query("#assignmentPageStatus"), error.message || "투입정보를 불러오지 못했습니다.", "error");
            }
        } finally {
            if (requestId === projectDataRequestId && !preserveView) setProjectDataLoading(false);
        }
    }

    function boardYear() {
        return Number(query("#assignmentProjectYearSelect").value || activeYear || new Date().getFullYear());
    }

    function boardMonths() {
        const year = boardYear();
        return Array.from({ length: 12 }, (_item, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
    }

    function workerKey(worker) {
        return `${value(worker, "workerTypeCode", "WORKER_TYPE_CODE")}:${value(worker, "workerId", "WORKER_ID")}`;
    }

    function assignmentWorkerKey(assignment) {
        const companyEmployeeId = value(assignment, "companyEmployeeId", "COMPANY_EMPLOYEE_ID");
        if (companyEmployeeId) return `COMPANY_EMPLOYEE:${companyEmployeeId}`;
        const employeeUserId = value(assignment, "employeeUserId", "EMPLOYEE_USER_ID", "userId", "USER_ID");
        return employeeUserId ? `USER:${employeeUserId}` : "";
    }

    function boardWorker(workerKeyValue) {
        return workers.find((worker) => workerKey(worker) === workerKeyValue) || null;
    }

    function boardProject(projectId) {
        return boardProjects.find((project) => (
            String(value(project, "projectId", "PROJECT_ID")) === String(projectId)
        )) || null;
    }

    function boardProjectAssignmentCount(projectId) {
        return boardAssignments.filter((assignment) => (
            String(value(assignment, "projectId", "PROJECT_ID")) === String(projectId)
            && String(value(assignment, "draftYn", "DRAFT_YN") || "") !== "Y"
        )).length;
    }

    function boardProjectCompany(worker) {
        const workerCompanyId = String(value(worker, "companyId", "COMPANY_ID") || "");
        const masterCompany = masterCompanies.find((item) => (
            String(value(item, "companyId", "COMPANY_ID")) === workerCompanyId
        ));
        const workerCompanyName = String(value(masterCompany, "companyName", "COMPANY_NAME") || "").trim();
        return companies.find((item) => (
            String(value(item, "companyId", "COMPANY_ID") || "") === workerCompanyId
        )) || companies.find((item) => (
            workerCompanyName
            && String(value(item, "companyName", "COMPANY_NAME") || "").trim() === workerCompanyName
        )) || null;
    }

    function removeBoardDraft(draftId, render = true) {
        if (!draftId) return;
        boardAssignments = boardAssignments.filter((item) => (
            String(value(item, "assignmentId", "ASSIGNMENT_ID")) !== String(draftId)
        ));
        if (boardDraftAssignmentId === String(draftId)) boardDraftAssignmentId = "";
        syncBoardDraftControls();
        if (render && root) renderAssignmentBoard();
    }

    function clearBoardDraft(render = true) {
        removeBoardDraft(boardDraftAssignmentId, render);
    }

    function clearAllBoardDrafts(render = true) {
        boardAssignments = boardAssignments.filter((item) => String(value(item, "draftYn", "DRAFT_YN") || "") !== "Y");
        boardDraftAssignmentId = "";
        syncBoardDraftControls();
        if (render && root) renderAssignmentBoard();
    }

    function showBoardDraft(project, worker, workerKeyValue, insertIndex = null) {
        const [workerType, workerId] = workerKeyValue.split(":");
        const projectStart = String(value(project, "projectStartDate", "PROJECT_START_DATE")).slice(0, 10);
        const projectEnd = String(value(project, "projectEndDate", "PROJECT_END_DATE")).slice(0, 10);
        const company = masterCompanies.find((item) => (
            String(value(item, "companyId", "COMPANY_ID")) === String(value(worker, "companyId", "COMPANY_ID"))
        ));
        const projectCompany = boardProjectCompany(worker);
        boardDraftAssignmentId = `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const monthlyAllocations = monthRange(projectStart, projectEnd).map((allocationMonth) => ({ month: allocationMonth, mm: 1 }));
        const draft = {
            assignmentId: boardDraftAssignmentId,
            projectId: value(project, "projectId", "PROJECT_ID"),
            userId: workerType === "USER" ? Number(workerId) : null,
            companyEmployeeId: workerType === "COMPANY_EMPLOYEE" ? Number(workerId) : null,
            employeeName: value(worker, "userName", "USER_NAME") || "이름 미정",
            companyName: value(company, "companyName", "COMPANY_NAME") || "소속 미정",
            assignmentStartDate: projectStart,
            assignmentEndDate: projectEnd,
            assignmentStatusCode: "CONFIRMED",
            projectCompanyId: value(projectCompany, "projectCompanyId", "PROJECT_COMPANY_ID") || null,
            allocationTypeCode: "MONTHLY",
            defaultMm: 1,
            monthlyAllocations,
            totalMm: monthlyAllocations.length,
            costUnitPrice: 0,
            salesUnitPrice: 0,
            projectRoleName: "",
            primaryDuty: "",
            note: "",
            draftYn: "Y",
            draftInsertIndex: Number.isInteger(insertIndex) ? insertIndex : boardProjectAssignmentCount(value(project, "projectId", "PROJECT_ID"))
        };
        boardAssignments.push(draft);
        syncBoardDraftControls();
        renderAssignmentBoard();
        return draft;
    }

    function syncBoardDraftFromForm() {
        if (!boardDraftAssignmentId) return;
        const draft = boardAssignments.find((item) => (
            String(value(item, "assignmentId", "ASSIGNMENT_ID")) === boardDraftAssignmentId
        ));
        if (!draft) return;
        const startDate = query("#assignmentStartDate").value;
        const endDate = query("#assignmentEndDate").value;
        if (startDate && endDate && startDate <= endDate) {
            draft.assignmentStartDate = startDate;
            draft.assignmentEndDate = endDate;
        }
        draft.assignmentStatusCode = query("#assignmentStatusCode").value || "CONFIRMED";
        draft.totalMm = currentAllocations().reduce((total, item) => total + number(item.mm), 0);
        renderAssignmentBoard();
    }

    function updateBoardDraft(options = {}) {
        if (options.draftId) boardDraftAssignmentId = String(options.draftId);
        if (!boardDraftAssignmentId) return;
        const draft = boardAssignments.find((item) => (
            String(value(item, "assignmentId", "ASSIGNMENT_ID")) === boardDraftAssignmentId
        ));
        if (!draft) return;
        if (options.startDate && options.endDate && options.startDate <= options.endDate) {
            draft.assignmentStartDate = options.startDate;
            draft.assignmentEndDate = options.endDate;
        }
        if (options.assignmentStatusCode) draft.assignmentStatusCode = options.assignmentStatusCode;
        if (Number.isFinite(Number(options.totalMm))) draft.totalMm = Number(options.totalMm);
        if (Array.isArray(options.monthlyAllocations)) draft.monthlyAllocations = options.monthlyAllocations;
        if (options.defaultMm !== undefined) draft.defaultMm = number(options.defaultMm);
        if (options.costUnitPrice !== undefined) draft.costUnitPrice = options.costUnitPrice;
        if (options.salesUnitPrice !== undefined) draft.salesUnitPrice = options.salesUnitPrice;
        if (options.projectRoleName !== undefined) draft.projectRoleName = options.projectRoleName;
        if (options.primaryDuty !== undefined) draft.primaryDuty = options.primaryDuty;
        if (options.note !== undefined) draft.note = options.note;
        syncBoardDraftControls();
        renderAssignmentBoard();
    }

    function monthIndex(month) {
        const match = String(month || "").match(/^(\d{4})-(\d{2})/);
        return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : -1;
    }

    function addMonths(month, offset) {
        const index = monthIndex(month) + offset;
        const year = Math.floor(index / 12);
        return `${year}-${String(index % 12 + 1).padStart(2, "0")}`;
    }

    function lastDateOfMonth(month) {
        const [year, monthNumber] = month.split("-").map(Number);
        return `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, "0")}`;
    }

    function boardTimelinePosition(startDate, endDate) {
        const year = boardYear();
        const firstMonth = `${year}-01`;
        const lastMonth = `${year}-12`;
        const startMonth = String(startDate || "").slice(0, 7);
        const endMonth = String(endDate || "").slice(0, 7);
        if (!startMonth || !endMonth || endMonth < firstMonth || startMonth > lastMonth) return null;
        const clippedStart = startMonth < firstMonth ? firstMonth : startMonth;
        const clippedEnd = endMonth > lastMonth ? lastMonth : endMonth;
        return {
            start: Number(clippedStart.slice(5, 7)),
            span: monthIndex(clippedEnd) - monthIndex(clippedStart) + 1
        };
    }

    function renderAssignmentBoardMonths() {
        const header = query("#assignmentBoardMonthHeader");
        Common.dom.clear(header);
        header.appendChild(Common.dom.element("span", { text: "프로젝트" }));
        boardMonths().forEach((month) => header.appendChild(Common.dom.element("span", {
            text: `${Number(month.slice(5, 7))}월`
        })));
    }

    function renderAssignmentBoardWorkers() {
        const container = query("#assignmentBoardWorkerList");
        Common.dom.clear(container);
        const keyword = query("#assignmentBoardWorkerSearch").value.trim().toLowerCase();
        const filteredWorkers = workers.filter((worker) => {
            const company = masterCompanies.find((item) => (
                String(value(item, "companyId", "COMPANY_ID")) === String(value(worker, "companyId", "COMPANY_ID"))
            ));
            const haystack = [
                value(worker, "userName", "USER_NAME"),
                value(worker, "departmentName", "DEPARTMENT_NAME"),
                value(worker, "positionName", "POSITION_NAME"),
                value(company, "companyName", "COMPANY_NAME")
            ].join(" ").toLowerCase();
            return !keyword || haystack.includes(keyword);
        });
        query("#assignmentBoardWorkerCount").textContent = `${filteredWorkers.length}명`;
        if (!filteredWorkers.length) {
            container.appendChild(Common.dom.element("p", { className: "empty-state", text: "조건에 맞는 인력이 없습니다." }));
            return;
        }
        filteredWorkers.forEach((worker) => {
            const key = workerKey(worker);
            const company = masterCompanies.find((item) => (
                String(value(item, "companyId", "COMPANY_ID")) === String(value(worker, "companyId", "COMPANY_ID"))
            ));
            const button = Common.dom.element("button", {
                className: `assignment-board-worker${key === boardSelectedWorkerKey ? " is-selected" : ""}`,
                type: "button",
                attrs: {
                    draggable: "true",
                    "data-board-worker-key": key,
                    "aria-pressed": String(key === boardSelectedWorkerKey)
                }
            });
            button.append(
                Common.dom.element("strong", { text: value(worker, "userName", "USER_NAME") || "이름 미정" }),
                Common.dom.element("span", { text: value(company, "companyName", "COMPANY_NAME") || "소속 미정" }),
                Common.dom.element("small", {
                    text: [value(worker, "departmentName", "DEPARTMENT_NAME"), value(worker, "positionName", "POSITION_NAME")].filter(Boolean).join(" · ") || "직무 정보 없음"
                })
            );
            container.appendChild(button);
        });
    }

    function renderAssignmentBoardLanes() {
        const container = query("#assignmentBoardLanes");
        Common.dom.clear(container);
        const selectedProject = selectedProjectId();
        const visibleProjects = selectedProject
            ? boardProjects.filter((project) => String(value(project, "projectId", "PROJECT_ID")) === String(selectedProject))
            : boardProjects;
        if (!visibleProjects.length) {
            container.appendChild(Common.dom.element("p", { className: "empty-state", text: `${boardYear()}년에 등록된 프로젝트가 없습니다.` }));
            return;
        }
        visibleProjects.forEach((project) => {
            const projectId = value(project, "projectId", "PROJECT_ID");
            const projectName = value(project, "projectName", "PROJECT_NAME") || "프로젝트명 미정";
            const savedAssignments = boardAssignments.filter((assignment) => (
                String(value(assignment, "projectId", "PROJECT_ID")) === String(projectId)
                && String(value(assignment, "draftYn", "DRAFT_YN") || "") !== "Y"
            )).sort((left, right) => (
                number(value(left, "displayOrder", "DISPLAY_ORDER")) - number(value(right, "displayOrder", "DISPLAY_ORDER"))
            ));
            const draftAssignments = boardAssignments.filter((assignment) => (
                String(value(assignment, "projectId", "PROJECT_ID")) === String(projectId)
                && String(value(assignment, "draftYn", "DRAFT_YN") || "") === "Y"
            ));
            const projectAssignments = [...savedAssignments];
            draftAssignments.forEach((draft, draftOffset) => {
                const requestedIndex = Number(value(draft, "draftInsertIndex", "DRAFT_INSERT_INDEX"));
                const insertIndex = Number.isInteger(requestedIndex)
                    ? Math.min(Math.max(requestedIndex + draftOffset, 0), projectAssignments.length)
                    : projectAssignments.length;
                projectAssignments.splice(insertIndex, 0, draft);
            });
            const lane = Common.dom.element("article", {
                className: "assignment-board-lane",
                attrs: { "data-board-project-id": projectId }
            });
            const info = Common.dom.element("div", { className: "assignment-board-lane-info" });
            const addButton = Common.dom.element("button", {
                className: "button button-secondary button-small",
                text: boardSelectedWorkerKey ? "선택 인력 배치" : "인력 선택 필요",
                type: "button",
                attrs: { "data-board-add-project-id": projectId }
            });
            addButton.disabled = !boardSelectedWorkerKey;
            info.append(
                Common.dom.element("strong", { text: projectName }),
                Common.dom.element("span", { text: value(project, "customerName", "CUSTOMER_NAME") || "고객사 미정" }),
                Common.dom.element("small", {
                    text: `${savedAssignments.length}명${draftAssignments.length ? ` · 편집중 ${draftAssignments.length}명` : ""} · ${number(value(project, "totalMm", "TOTAL_MM")).toFixed(2)} M/M`
                })
            );
            if (!compactMode) info.appendChild(addButton);
            const timeline = Common.dom.element("div", {
                className: "assignment-board-timeline",
                attrs: {
                    "aria-label": `${projectName} 확정 투입 타임라인`,
                    "data-board-timeline-project-id": compactMode ? projectId : undefined
                }
            });
            boardMonths().forEach((month, monthOffset) => {
                const drop = Common.dom.element(compactMode ? "div" : "button", {
                    className: "assignment-board-month-drop",
                    text: compactMode ? "" : "+",
                    type: compactMode ? undefined : "button",
                    attrs: compactMode
                        ? { "aria-hidden": "true" }
                        : {
                            "data-board-drop-project-id": projectId,
                            "data-board-drop-month": month,
                            "aria-label": `${projectName} ${month}에 선택 인력 배치`
                        }
                });
                drop.style.gridColumn = String(monthOffset + 1);
                timeline.appendChild(drop);
            });
            projectAssignments.forEach((assignment, index) => {
                const position = boardTimelinePosition(
                    value(assignment, "assignmentStartDate", "ASSIGNMENT_START_DATE"),
                    value(assignment, "assignmentEndDate", "ASSIGNMENT_END_DATE")
                );
                if (!position) return;
                const assignmentId = value(assignment, "assignmentId", "ASSIGNMENT_ID");
                const isDraft = String(value(assignment, "draftYn", "DRAFT_YN") || "") === "Y";
                const planned = value(assignment, "assignmentStatusCode", "ASSIGNMENT_STATUS_CODE") === "PLANNED";
                const card = Common.dom.element("div", {
                    className: `assignment-board-assignment${planned ? " is-planned" : " is-confirmed"}${isDraft ? " is-draft is-unsaved" : ""}`,
                    attrs: {
                        draggable: "true",
                        role: "button",
                        tabindex: "0",
                        "data-board-assignment-id": assignmentId,
                        "data-board-assignment-project-id": projectId,
                        "aria-label": `${value(assignment, "employeeName", "EMPLOYEE_NAME")} ${value(assignment, "assignmentStartDate", "ASSIGNMENT_START_DATE")}부터 ${value(assignment, "assignmentEndDate", "ASSIGNMENT_END_DATE")}까지 편집`
                    }
                });
                card.style.gridColumn = `${position.start} / span ${position.span}`;
                card.style.gridRow = String(index + 2);
                card.append(
                    Common.dom.element("strong", { text: value(assignment, "employeeName", "EMPLOYEE_NAME") || "이름 미정" }),
                    Common.dom.element("small", {
                        text: [
                            planned ? "계획 투입" : "확정 투입",
                            value(assignment, "projectRoleName", "PROJECT_ROLE_NAME"),
                            `${number(value(assignment, "totalMm", "TOTAL_MM")).toFixed(2)} M`,
                            value(assignment, "companyName", "COMPANY_NAME") || "소속 미정"
                        ].filter(Boolean).join(" · ")
                    })
                );
                if (isDraft) {
                    card.append(
                        Common.dom.element("span", { className: "assignment-board-card-settings is-editing", text: "✎ 편집중" }),
                        Common.dom.element("button", {
                            className: "assignment-board-card-remove",
                            text: "×",
                            type: "button",
                            attrs: {
                                "data-board-remove-draft-id": assignmentId,
                                "aria-label": `${value(assignment, "employeeName", "EMPLOYEE_NAME") || "임시 투입 인력"} 편집 취소`
                            }
                        })
                    );
                } else if (compactMode) {
                    card.appendChild(Common.dom.element("button", {
                        className: "assignment-board-card-remove",
                        text: "×",
                        type: "button",
                        attrs: {
                            "data-board-remove-assignment-id": assignmentId,
                            "data-board-remove-project-id": projectId,
                            "aria-label": `${value(assignment, "employeeName", "EMPLOYEE_NAME") || "투입 인력"} 투입 해제`
                        }
                    }));
                } else {
                    card.appendChild(Common.dom.element("span", { className: "assignment-board-card-settings", text: "⚙" }));
                }
                timeline.appendChild(card);
            });
            if (compactMode) {
                Array.from({ length: projectAssignments.length + 1 }, (_item, insertIndex) => {
                    const insertLine = Common.dom.element("div", {
                        className: "assignment-board-insert-line",
                        attrs: {
                            "data-board-insert-project-id": projectId,
                            "data-board-insert-index": insertIndex,
                            "aria-hidden": "true"
                        }
                    });
                    insertLine.style.gridColumn = "1 / -1";
                    insertLine.style.gridRow = String(insertIndex === 0 ? 2 : insertIndex + 1);
                    insertLine.classList.add(insertIndex === 0 ? "is-before-first" : "is-after-row");
                    timeline.appendChild(insertLine);
                });
            }
            lane.append(info, timeline);
            container.appendChild(lane);
        });
    }

    function renderAssignmentBoard() {
        query("#assignmentBoardYearLabel").textContent = `${boardYear()}년 확정 투입`;
        const selectedWorker = boardWorker(boardSelectedWorkerKey);
        query("#assignmentBoardSelection").textContent = selectedWorker
            ? compactMode
                ? `${value(selectedWorker, "userName", "USER_NAME")} 선택됨 · 더블클릭하거나 프로젝트 타임라인 안으로 끌어 놓으세요.`
                : `${value(selectedWorker, "userName", "USER_NAME")} 선택됨 · 프로젝트의 월 칸을 누르거나 드롭하세요.`
            : compactMode
                ? "인력 카드를 더블클릭하거나 프로젝트 타임라인 안으로 끌어 놓으세요."
                : "선택한 인력이 없습니다.";
        renderAssignmentBoardMonths();
        renderAssignmentBoardWorkers();
        renderAssignmentBoardLanes();
    }

    function loadAssignmentBoard() {
        if (boardLoadPromise) return boardLoadPromise;
        boardLoading = true;
        Common.ui.setInlineStatus(query("#assignmentBoardStatus"), `${boardYear()}년 확정 투입을 불러오고 있습니다.`);
        boardLoadPromise = (async () => {
            try {
                const payload = await Common.api.request(`/project-assignments/workspace?projectYear=${encodeURIComponent(boardYear())}&refreshToken=${Date.now()}`, {
                    signal: controller.signal,
                    showLoading: false
                });
                const data = Common.data.get(payload) || {};
                boardProjects = value(data, "projects", "PROJECTS") || [];
                boardAssignments = value(data, "assignments", "ASSIGNMENTS") || [];
                boardDraftAssignmentId = "";
                syncBoardDraftControls();
                renderAssignmentBoard();
                Common.ui.setInlineStatus(query("#assignmentBoardStatus"), `${boardProjects.length}개 프로젝트와 ${boardAssignments.length}건의 확정 투입을 불러왔습니다.`, "success");
            } catch (error) {
                if (error?.name !== "AbortError") {
                    Common.ui.setInlineStatus(query("#assignmentBoardStatus"), error.message || "확정 투입 배치 보드를 불러오지 못했습니다.", "error");
                }
            } finally {
                boardLoading = false;
                boardLoadPromise = null;
            }
        })();
        return boardLoadPromise;
    }

    async function loadProjectEditorFromBoard(projectId) {
        query("#assignmentProjectYearSelect").value = String(boardYear());
        activeYear = String(boardYear());
        renderProjectOptions();
        query("#assignmentProjectSelect").value = String(projectId);
        renderAssignmentBoard();
        await loadProjectData();
        if (String(loadedProjectId) !== String(projectId)) {
            throw new Error("선택한 프로젝트의 상세 정보를 불러오지 못했습니다.");
        }
    }

    async function createAssignmentFromBoard(projectId, workerKeyValue, month, insertIndex = null) {
        const worker = boardWorker(workerKeyValue);
        const project = boardProject(projectId);
        if (!worker || !project) return;
        const projectStart = String(value(project, "projectStartDate", "PROJECT_START_DATE")).slice(0, 10);
        const projectEnd = String(value(project, "projectEndDate", "PROJECT_END_DATE")).slice(0, 10);
        const existing = boardAssignments.find((assignment) => (
            String(value(assignment, "projectId", "PROJECT_ID")) === String(projectId)
            && assignmentWorkerKey(assignment) === workerKeyValue
            && String(value(assignment, "draftYn", "DRAFT_YN") || "") !== "Y"
        ));
        const pendingDraft = boardAssignments.find((assignment) => (
            String(value(assignment, "projectId", "PROJECT_ID")) === String(projectId)
            && assignmentWorkerKey(assignment) === workerKeyValue
            && String(value(assignment, "draftYn", "DRAFT_YN") || "") === "Y"
        ));
        if (compactMode) {
            if (pendingDraft) {
                boardDraftAssignmentId = String(value(pendingDraft, "assignmentId", "ASSIGNMENT_ID"));
                root.dispatchEvent(new CustomEvent("workforce:open-quick-assignment", {
                    bubbles: true,
                    detail: {
                        mode: "batch-draft",
                        projectId,
                        draftId: boardDraftAssignmentId,
                        workerKey: workerKeyValue,
                        assignment: pendingDraft
                    }
                }));
                return;
            }
            if (existing) {
                root.dispatchEvent(new CustomEvent("workforce:open-quick-assignment", {
                    bubbles: true,
                    detail: { mode: "edit", projectId, assignmentId: value(existing, "assignmentId", "ASSIGNMENT_ID") }
                }));
                return;
            }
            showBoardDraft(project, worker, workerKeyValue, insertIndex);
            Common.ui.setInlineStatus(
                query("#assignmentBoardStatus"),
                `${value(worker, "userName", "USER_NAME") || "인력"}을 편집중 상태로 추가했습니다. 계속 인력을 추가하거나 카드를 눌러 세부 설정하세요.`,
                "success"
            );
            return;
        }
        showBoardDraft(project, worker, workerKeyValue, insertIndex);
        try {
            await loadProjectEditorFromBoard(projectId);
            clearAssignmentForm();
            const company = boardProjectCompany(worker);
            query("#assignmentStartDate").value = projectStart;
            query("#assignmentEndDate").value = projectEnd;
            if (company) {
                query("#assignmentCompany").value = String(value(company, "projectCompanyId", "PROJECT_COMPANY_ID"));
                renderAssignmentEmployees(workerKeyValue);
                query("#assignmentEmployee").value = workerKeyValue;
            }
            generateMonthlyAllocations();
            setFormDirty("assignment");
            Common.ui.setInlineStatus(
                query("#assignmentEditorStatus"),
                company
                    ? "프로젝트 전체 기간으로 임시 배치했습니다. 기간과 월별 M/M을 조정한 뒤 저장하세요."
                    : "인력의 소속회사가 프로젝트 참여회사와 연결되지 않았습니다. 참여회사 정보를 확인해 주세요.",
                company ? "success" : "error"
            );
            if (!compactMode) query("#assignmentEditorPanel").scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (error) {
            clearBoardDraft();
            throw error;
        }
    }

    async function editAssignmentFromBoard(projectId, assignmentId, targetMonth = "") {
        const boardItem = boardAssignments.find((item) => (
            String(value(item, "assignmentId", "ASSIGNMENT_ID")) === String(assignmentId)
        ));
        await loadProjectEditorFromBoard(projectId);
        const item = assignments.find((assignment) => (
            String(value(assignment, "assignmentId", "ASSIGNMENT_ID")) === String(assignmentId)
        ));
        if (!item) throw new Error("선택한 확정 투입정보를 찾을 수 없습니다.");
        fillAssignmentForm(item);
        if (targetMonth && boardItem) {
            const oldStart = String(value(boardItem, "assignmentStartDate", "ASSIGNMENT_START_DATE")).slice(0, 10);
            const oldEnd = String(value(boardItem, "assignmentEndDate", "ASSIGNMENT_END_DATE")).slice(0, 10);
            const monthSpan = Math.max(0, monthIndex(oldEnd.slice(0, 7)) - monthIndex(oldStart.slice(0, 7)));
            const requestedStart = `${targetMonth}-01`;
            const requestedEnd = lastDateOfMonth(addMonths(targetMonth, monthSpan));
            query("#assignmentStartDate").value = requestedStart;
            query("#assignmentEndDate").value = requestedEnd;
            generateMonthlyAllocations();
            setFormDirty("assignment");
            Common.ui.setInlineStatus(query("#assignmentEditorStatus"), "배치 기간을 이동했습니다. 월별 M/M과 금액을 검토한 뒤 저장하세요.", "success");
        }
        if (!compactMode) query("#assignmentEditorPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function boardDragPayload(event) {
        try {
            return JSON.parse(event.dataTransfer?.getData("text/plain") || "null");
        } catch (_error) {
            return null;
        }
    }

    function handleBoardDragStart(event) {
        const workerButton = event.target.closest("[data-board-worker-key]");
        const assignmentButton = event.target.closest("[data-board-assignment-id]");
        const payload = workerButton
            ? { kind: "worker", workerKey: workerButton.dataset.boardWorkerKey }
            : assignmentButton
                ? { kind: "assignment", assignmentId: assignmentButton.dataset.boardAssignmentId, projectId: assignmentButton.dataset.boardAssignmentProjectId }
                : null;
        if (!payload || !event.dataTransfer) return;
        event.dataTransfer.effectAllowed = payload.kind === "worker" ? "copy" : "move";
        event.dataTransfer.setData("text/plain", JSON.stringify(payload));
        if (compactMode && payload.kind === "worker") root.classList.add("is-board-worker-dragging");
        if (compactMode && payload.kind === "assignment") root.classList.add("is-board-assignment-dragging");
    }

    function boardPointerInsertIndex(event, projectId) {
        const explicitLine = event.target.closest("[data-board-insert-project-id]");
        if (explicitLine) return Number(explicitLine.dataset.boardInsertIndex);
        const assignmentCard = event.target.closest("[data-board-assignment-id]");
        if (assignmentCard && String(assignmentCard.dataset.boardAssignmentProjectId) === String(projectId)) {
            const timeline = assignmentCard.closest("[data-board-timeline-project-id]");
            const cards = [...timeline.querySelectorAll("[data-board-assignment-id]:not(.is-draft)")];
            const cardIndex = cards.indexOf(assignmentCard);
            const cardRect = assignmentCard.getBoundingClientRect();
            return cardIndex + (event.clientY >= cardRect.top + cardRect.height / 2 ? 1 : 0);
        }
        return boardProjectAssignmentCount(projectId);
    }

    function handleBoardDragOver(event) {
        const insertTarget = compactMode ? event.target.closest("[data-board-insert-project-id]") : null;
        const timelineTarget = compactMode ? event.target.closest("[data-board-timeline-project-id]") : null;
        const monthTarget = event.target.closest("[data-board-drop-project-id]");
        const isWorkerDrag = compactMode && root.classList.contains("is-board-worker-dragging");
        const isAssignmentDrag = compactMode && root.classList.contains("is-board-assignment-dragging");
        if (compactMode && !isWorkerDrag && !isAssignmentDrag) return;
        if (!insertTarget && !timelineTarget && !monthTarget) return;
        if (isAssignmentDrag && monthTarget && !insertTarget && !timelineTarget) return;
        event.preventDefault();
        if (insertTarget || timelineTarget) {
            root.querySelectorAll(".assignment-board-insert-line.is-drag-over").forEach((item) => item.classList.remove("is-drag-over"));
            root.querySelectorAll(".assignment-board-timeline.is-append-drag-over").forEach((item) => item.classList.remove("is-append-drag-over"));
            const projectId = insertTarget?.dataset.boardInsertProjectId || timelineTarget?.dataset.boardTimelineProjectId;
            const targetIndex = isAssignmentDrag
                ? boardPointerInsertIndex(event, projectId)
                : boardProjectAssignmentCount(projectId);
            const activeLine = insertTarget || [...root.querySelectorAll("[data-board-insert-project-id]")].find((item) => (
                String(item.dataset.boardInsertProjectId) === String(projectId)
                && Number(item.dataset.boardInsertIndex) === targetIndex
            ));
            activeLine?.classList.add("is-drag-over");
            if (!insertTarget && targetIndex === boardProjectAssignmentCount(projectId)) timelineTarget?.classList.add("is-append-drag-over");
        }
        if (event.dataTransfer) event.dataTransfer.dropEffect = isAssignmentDrag ? "move" : (insertTarget || timelineTarget ? "copy" : "move");
    }

    function handleBoardDrop(event) {
        const insertTarget = compactMode ? event.target.closest("[data-board-insert-project-id]") : null;
        const timelineTarget = compactMode ? event.target.closest("[data-board-timeline-project-id]") : null;
        const dropTarget = insertTarget || timelineTarget || event.target.closest("[data-board-drop-project-id]");
        if (!dropTarget) return;
        event.preventDefault();
        const payload = boardDragPayload(event);
        root.classList.remove("is-board-worker-dragging", "is-board-assignment-dragging");
        root.querySelectorAll(".assignment-board-insert-line.is-drag-over").forEach((item) => item.classList.remove("is-drag-over"));
        root.querySelectorAll(".assignment-board-timeline.is-append-drag-over").forEach((item) => item.classList.remove("is-append-drag-over"));
        if (!payload) return;
        const projectId = dropTarget.dataset.boardInsertProjectId || dropTarget.dataset.boardTimelineProjectId || dropTarget.dataset.boardDropProjectId;
        const month = dropTarget.dataset.boardDropMonth;
        if (payload.kind === "worker") {
            const insertIndex = insertTarget ? Number(insertTarget.dataset.boardInsertIndex) : boardProjectAssignmentCount(projectId);
            createAssignmentFromBoard(projectId, payload.workerKey, month, insertIndex).catch((error) => Common.ui.toast(error.message, "error"));
            return;
        }
        if (insertTarget || timelineTarget) {
            if (String(payload.projectId) !== String(projectId)) {
                Common.ui.toast("투입인력 순서는 같은 프로젝트 안에서만 변경할 수 있습니다.", "warning");
                return;
            }
            const draggedAssignment = boardAssignments.find((assignment) => (
                String(value(assignment, "assignmentId", "ASSIGNMENT_ID")) === String(payload.assignmentId)
            ));
            if (String(value(draggedAssignment, "draftYn", "DRAFT_YN") || "") === "Y") {
                draggedAssignment.draftInsertIndex = boardPointerInsertIndex(event, projectId);
                renderAssignmentBoardLanes();
                return;
            }
            const orderedAssignments = boardAssignments
                .filter((assignment) => (
                    String(value(assignment, "projectId", "PROJECT_ID")) === String(projectId)
                    && String(value(assignment, "draftYn", "DRAFT_YN") || "") !== "Y"
                ))
                .sort((left, right) => (
                    number(value(left, "displayOrder", "DISPLAY_ORDER")) - number(value(right, "displayOrder", "DISPLAY_ORDER"))
                ));
            const sourceIndex = orderedAssignments.findIndex((assignment) => (
                String(value(assignment, "assignmentId", "ASSIGNMENT_ID")) === String(payload.assignmentId)
            ));
            if (sourceIndex < 0) return;
            const [moved] = orderedAssignments.splice(sourceIndex, 1);
            let insertIndex = boardPointerInsertIndex(event, projectId);
            if (sourceIndex < insertIndex) insertIndex -= 1;
            insertIndex = Math.min(Math.max(insertIndex, 0), orderedAssignments.length);
            orderedAssignments.splice(insertIndex, 0, moved);
            orderedAssignments.forEach((assignment, index) => {
                assignment.displayOrder = (index + 1) * 10;
                assignment.DISPLAY_ORDER = (index + 1) * 10;
            });
            renderAssignmentBoardLanes();
            root.dispatchEvent(new CustomEvent("workforce:reorder-assignments", {
                bubbles: true,
                detail: {
                    projectId,
                    assignmentIds: orderedAssignments.map((assignment) => value(assignment, "assignmentId", "ASSIGNMENT_ID"))
                }
            }));
            return;
        }
        if (String(payload.projectId) !== String(projectId)) {
            Common.ui.toast("확정 투입의 프로젝트 이동은 참여회사와 단가가 달라질 수 있어 지원하지 않습니다. 대상 프로젝트에 새 배치로 등록해 주세요.", "warning");
            return;
        }
        editAssignmentFromBoard(projectId, payload.assignmentId, month).catch((error) => Common.ui.toast(error.message, "error"));
    }

    function handleBoardDragEnd() {
        root?.classList.remove("is-board-worker-dragging", "is-board-assignment-dragging");
        root?.querySelectorAll(".assignment-board-insert-line.is-drag-over").forEach((item) => item.classList.remove("is-drag-over"));
        root?.querySelectorAll(".assignment-board-timeline.is-append-drag-over").forEach((item) => item.classList.remove("is-append-drag-over"));
        query(".assignment-board-pool")?.classList.remove("is-remove-drag-over");
    }

    function requestBoardAssignmentRemoval(projectId, assignmentId) {
        root.dispatchEvent(new CustomEvent("workforce:remove-assignment", {
            bubbles: true,
            detail: { projectId, assignmentId }
        }));
    }

    function handleBoardRemoveDragOver(event) {
        if (!compactMode || !root.classList.contains("is-board-assignment-dragging")) return;
        event.preventDefault();
        event.currentTarget.classList.add("is-remove-drag-over");
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    }

    function handleBoardRemoveDrop(event) {
        if (!compactMode) return;
        const payload = boardDragPayload(event);
        if (payload?.kind !== "assignment") return;
        event.preventDefault();
        handleBoardDragEnd();
        const assignment = boardAssignments.find((item) => (
            String(value(item, "assignmentId", "ASSIGNMENT_ID")) === String(payload.assignmentId)
        ));
        if (String(value(assignment, "draftYn", "DRAFT_YN") || "") === "Y") {
            removeBoardDraft(payload.assignmentId);
            Common.ui.setInlineStatus(query("#assignmentBoardStatus"), "임시 투입을 취소했습니다.", "success");
            return;
        }
        requestBoardAssignmentRemoval(payload.projectId, payload.assignmentId);
    }

    function clearCompanyForm() {
        query("#projectCompanyForm").reset();
        query("#projectCompanyForm").dataset.versionToken = "";
        query("#projectCompanyId").value = "";
        query("#deleteProjectCompanyButton").hidden = true;
        setFormDirty("company", false);
    }

    function fillCompanyForm(company) {
        query("#projectCompanyForm").dataset.versionToken = value(company, "versionToken", "VERSION_TOKEN") || "";
        query("#projectCompanyId").value = value(company, "projectCompanyId", "PROJECT_COMPANY_ID");
        query("#projectCompanyMaster").value = value(company, "companyId", "COMPANY_ID") || "";
        query("#projectCompanyType").value = value(company, "participationTypeCode", "PARTICIPATION_TYPE_CODE") || "LEAD";
        query("#projectCompanyShareRate").value = value(company, "shareRate", "SHARE_RATE") || 0;
        query("#projectCompanyNote").value = value(company, "note", "NOTE") || "";
        query("#deleteProjectCompanyButton").hidden = false;
        setFormDirty("company", false);
    }

    function setFormSubmitting(formSelector, submitting, busyText) {
        const form = query(formSelector);
        const button = form?.querySelector('button[type="submit"]');
        if (!form || !button) return;
        form.setAttribute("aria-busy", String(Boolean(submitting)));
        if (submitting) {
            button.dataset.idleText = button.textContent;
            button.textContent = busyText;
            button.disabled = true;
            return;
        }
        button.textContent = button.dataset.idleText || button.textContent;
        delete button.dataset.idleText;
        button.disabled = false;
    }

    async function saveCompany(event) {
        event.preventDefault();
        const projectId = loadedProjectForMutation();
        if (!projectId || !event.currentTarget.reportValidity()) return;
        const id = query("#projectCompanyId").value;
        setFormSubmitting("#projectCompanyForm", true, "저장 중...");
        try {
            await Common.api.request(`/project-assignments/${encodeURIComponent(projectId)}/companies${id ? `/${encodeURIComponent(id)}` : ""}`, {
                method: id ? "PUT" : "POST",
                body: { companyId: Number(query("#projectCompanyMaster").value), participationTypeCode: query("#projectCompanyType").value, shareRate: query("#projectCompanyShareRate").value, note: query("#projectCompanyNote").value.trim(), versionToken: id ? event.currentTarget.dataset.versionToken : null },
                signal: controller.signal,
                showLoading: false
            });
            await loadProjectData({
                preserveView: true,
                resetCompanyForm: true,
                resetAssignmentForm: false,
                renderAssignments: false,
                statusMessage: "참여회사 정보를 갱신했습니다."
            });
            Common.ui.toast("참여회사를 저장했습니다.", "success");
        } finally {
            setFormSubmitting("#projectCompanyForm", false);
        }
    }

    async function deleteCompany() {
        const id = query("#projectCompanyId").value;
        const projectId = loadedProjectForMutation();
        if (!projectId || !id || !(await Common.ui.confirm("선택한 참여회사를 삭제하시겠습니까?", { title: "참여회사 삭제", confirmText: "삭제", danger: true }))) return;
        const versionToken = query("#projectCompanyForm").dataset.versionToken;
        const button = query("#deleteProjectCompanyButton");
        button.disabled = true;
        try {
            await Common.api.request(`/project-assignments/${encodeURIComponent(projectId)}/companies/${encodeURIComponent(id)}?versionToken=${encodeURIComponent(versionToken)}`, { method: "DELETE", signal: controller.signal, showLoading: false });
            await loadProjectData({
                preserveView: true,
                resetCompanyForm: true,
                resetAssignmentForm: false,
                renderAssignments: false,
                statusMessage: "참여회사 정보를 갱신했습니다."
            });
        } finally {
            button.disabled = false;
        }
    }

    function monthRange(startText, endText) {
        if (!startText || !endText || startText > endText) return [];
        const [startYear, startMonth] = startText.split("-").map(Number);
        const [endYear, endMonth] = endText.split("-").map(Number);
        const result = [];
        for (let cursor = new Date(startYear, startMonth - 1, 1), end = new Date(endYear, endMonth - 1, 1); cursor <= end; cursor.setMonth(cursor.getMonth() + 1)) {
            result.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
        }
        return result;
    }

    function weekdayMm(month, selectedDays) {
        const [year, monthNumber] = month.split("-").map(Number);
        const first = new Date(`${query("#assignmentStartDate").value}T00:00:00`);
        const last = new Date(`${query("#assignmentEndDate").value}T00:00:00`);
        let workdays = 0;
        let assigned = 0;
        for (let date = new Date(year, monthNumber - 1, 1); date.getMonth() === monthNumber - 1; date.setDate(date.getDate() + 1)) {
            if (date.getDay() === 0 || date.getDay() === 6) continue;
            workdays += 1;
            if (date >= first && date <= last && selectedDays.includes(WEEKDAY_CODES[date.getDay() - 1])) assigned += 1;
        }
        return workdays ? Math.round(assigned / workdays * 100) / 100 : 0;
    }

    function monthlyMm(month, defaultMm) {
        const [year, monthNumber] = month.split("-").map(Number);
        const first = new Date(`${query("#assignmentStartDate").value}T00:00:00`);
        const last = new Date(`${query("#assignmentEndDate").value}T00:00:00`);
        let workdays = 0;
        let activeWorkdays = 0;
        for (let date = new Date(year, monthNumber - 1, 1); date.getMonth() === monthNumber - 1; date.setDate(date.getDate() + 1)) {
            if (date.getDay() === 0 || date.getDay() === 6) continue;
            workdays += 1;
            if (date >= first && date <= last) activeWorkdays += 1;
        }
        return workdays ? Math.round(defaultMm * activeWorkdays / workdays * 100) / 100 : 0;
    }

    function renderMonthlyAllocations(allocations) {
        const body = query("#monthlyAllocationBody");
        Common.dom.clear(body);
        allocations.forEach((item) => {
            const row = Common.dom.element("tr", { attrs: { "data-month": item.month } });
            const input = Common.dom.element("input", { className: "input monthly-mm-input", type: "number", value: item.mm, attrs: { min: "0", max: "1", step: "0.01", "aria-label": `${item.month} M/M` } });
            const mmCell = cell(); mmCell.appendChild(input);
            row.append(cell(item.month), mmCell, cell("0원"), cell("0원"), cell("0원"));
            body.appendChild(row);
        });
        updateMonthlyTotals();
    }

    function generateMonthlyAllocations() {
        const months = monthRange(query("#assignmentStartDate").value, query("#assignmentEndDate").value);
        const weekly = query("#assignmentAllocationType").value === "WEEKLY";
        const selectedDays = [...root.querySelectorAll("#assignmentWeekdays input:checked")].map((input) => input.value);
        const defaultMm = number(query("#assignmentDefaultMm").value);
        renderMonthlyAllocations(months.map((month) => ({
            month,
            mm: weekly ? weekdayMm(month, selectedDays) : monthlyMm(month, defaultMm)
        })));
    }

    function currentAllocations() {
        return [...root.querySelectorAll("#monthlyAllocationBody tr")].map((row) => ({ month: row.dataset.month, mm: number(row.querySelector("input").value) }));
    }

    function updateMonthlyTotals() {
        const costUnit = query("#assignmentCostUnitPrice").value;
        const salesUnit = query("#assignmentSalesUnitPrice").value;
        let totalMm = 0, totalCost = 0n, totalSales = 0n;
        [...root.querySelectorAll("#monthlyAllocationBody tr")].forEach((row) => {
            const mm = number(row.querySelector("input").value);
            const cost = roundedAllocationAmount(mm, costUnit), sales = roundedAllocationAmount(mm, salesUnit);
            totalMm += mm; totalCost += cost; totalSales += sales;
            row.children[2].textContent = money(cost); row.children[3].textContent = money(sales); row.children[4].textContent = money(sales - cost);
        });
        query("#monthlyTotalMm").textContent = `${totalMm.toFixed(2)} M`;
        query("#monthlyTotalCost").textContent = money(totalCost);
        query("#monthlyTotalSales").textContent = money(totalSales);
        query("#monthlyTotalProfit").textContent = money(totalSales - totalCost);
    }

    function clearAssignmentForm() {
        query("#assignmentForm").reset();
        query("#assignmentForm").dataset.versionToken = "";
        const { startDate, endDate } = projectPeriod();
        query("#assignmentStartDate").value = startDate;
        query("#assignmentEndDate").value = endDate;
        query("#assignmentStatusCode").value = "CONFIRMED";
        query("#assignmentId").value = "";
        query("#deleteAssignmentButton").hidden = true;
        query("#assignmentEditorTitle").textContent = "투입인력 등록";
        query("#assignmentWeekdays").hidden = true;
        renderAssignmentEmployees();
        Common.dom.clear(query("#monthlyAllocationBody"));
        updateMonthlyTotals();
        Common.ui.setInlineStatus(query("#assignmentEditorStatus"), "");
        setFormDirty("assignment", false);
    }

    function fillAssignmentForm(item) {
        query("#assignmentForm").dataset.versionToken = value(item, "versionToken", "VERSION_TOKEN") || "";
        query("#assignmentId").value = value(item, "assignmentId", "ASSIGNMENT_ID");
        query("#assignmentCompany").value = value(item, "projectCompanyId", "PROJECT_COMPANY_ID") || "";
        const companyEmployeeId = value(item, "companyEmployeeId", "COMPANY_EMPLOYEE_ID");
        const workerValue = companyEmployeeId
            ? `COMPANY_EMPLOYEE:${companyEmployeeId}`
            : `USER:${value(item, "userId", "USER_ID")}`;
        renderAssignmentEmployees(workerValue, item);
        query("#assignmentStartDate").value = String(value(item, "assignmentStartDate", "ASSIGNMENT_START_DATE")).slice(0, 10);
        query("#assignmentEndDate").value = String(value(item, "assignmentEndDate", "ASSIGNMENT_END_DATE")).slice(0, 10);
        query("#assignmentStatusCode").value = value(item, "assignmentStatusCode", "ASSIGNMENT_STATUS_CODE") || "CONFIRMED";
        query("#assignmentAllocationType").value = value(item, "allocationTypeCode", "ALLOCATION_TYPE_CODE") || "MONTHLY";
        query("#assignmentDefaultMm").value = String(value(item, "defaultMm", "DEFAULT_MM") ?? 1);
        query("#assignmentCostUnitPrice").value = value(item, "costUnitPrice", "COST_UNIT_PRICE") || 0;
        query("#assignmentSalesUnitPrice").value = value(item, "salesUnitPrice", "SALES_UNIT_PRICE") || 0;
        query("#assignmentProjectRoleName").value = value(item, "projectRoleName", "PROJECT_ROLE_NAME") || "";
        query("#assignmentPrimaryDuty").value = value(item, "primaryDuty", "PRIMARY_DUTY") || "";
        query("#assignmentNote").value = value(item, "note", "NOTE") || "";
        const weeklyDays = String(value(item, "weeklyDayCodes", "WEEKLY_DAY_CODES") || "").split(",");
        root.querySelectorAll("#assignmentWeekdays input").forEach((input) => input.checked = weeklyDays.includes(input.value));
        query("#assignmentWeekdays").hidden = query("#assignmentAllocationType").value !== "WEEKLY";
        query("#deleteAssignmentButton").hidden = false;
        query("#assignmentEditorTitle").textContent = "투입인력 상세 및 수정";
        renderMonthlyAllocations(value(item, "monthlyAllocations", "MONTHLY_ALLOCATIONS") || []);
        Common.ui.setInlineStatus(
            query("#assignmentEditorStatus"),
            value(item, "allocationDataQualityError", "ALLOCATION_DATA_QUALITY_ERROR")
                ? "기존 월별 배분 데이터가 손상되었습니다. 월별 배분을 다시 생성한 뒤 저장해 주세요."
                : "",
            value(item, "allocationDataQualityError", "ALLOCATION_DATA_QUALITY_ERROR") ? "error" : ""
        );
        setFormDirty("assignment", false);
    }

    async function saveAssignment(event) {
        event.preventDefault();
        const projectId = loadedProjectForMutation(query("#assignmentEditorStatus"));
        if (!projectId) return;
        if (!validateAssignmentPeriod()) {
            event.currentTarget.reportValidity();
            Common.ui.setInlineStatus(query("#assignmentEditorStatus"), "투입 시작일과 종료일을 확인해 주세요.", "error");
            return;
        }
        if (!event.currentTarget.reportValidity()) return;
        const allocations = currentAllocations();
        if (!allocations.length) { Common.ui.setInlineStatus(query("#assignmentEditorStatus"), "월별 배분을 생성해 주세요.", "error"); return; }
        const id = query("#assignmentId").value;
        const [workerType, workerId] = query("#assignmentEmployee").value.split(":");
        setFormSubmitting("#assignmentForm", true, "저장 중...");
        try {
            await Common.api.request(`/project-assignments/${encodeURIComponent(projectId)}/assignments${id ? `/${encodeURIComponent(id)}` : ""}`, {
                method: id ? "PUT" : "POST",
                body: { employeeUserId: workerType === "USER" ? Number(workerId) : null, companyEmployeeId: workerType === "COMPANY_EMPLOYEE" ? Number(workerId) : null, projectCompanyId: Number(query("#assignmentCompany").value), assignmentStartDate: query("#assignmentStartDate").value, assignmentEndDate: query("#assignmentEndDate").value, assignmentStatusCode: query("#assignmentStatusCode").value, allocationTypeCode: query("#assignmentAllocationType").value, defaultMm: query("#assignmentDefaultMm").value, weeklyDayCodes: [...root.querySelectorAll("#assignmentWeekdays input:checked")].map((input) => input.value), monthlyAllocations: allocations, costUnitPrice: query("#assignmentCostUnitPrice").value, salesUnitPrice: query("#assignmentSalesUnitPrice").value, projectRoleName: query("#assignmentProjectRoleName").value.trim(), primaryDuty: query("#assignmentPrimaryDuty").value.trim(), note: query("#assignmentNote").value.trim(), versionToken: id ? event.currentTarget.dataset.versionToken : null },
                signal: controller.signal,
                showLoading: false
            });
            await Promise.all([
                loadProjectData({
                    preserveView: true,
                    resetCompanyForm: false,
                    resetAssignmentForm: true,
                    statusMessage: "투입인력 정보를 갱신했습니다."
                }),
                loadAssignmentBoard()
            ]);
            clearBoardDraft();
            setFormDirty("assignment", false);
            Common.ui.toast("투입인력 정보를 저장했습니다.", "success");
        } finally {
            setFormSubmitting("#assignmentForm", false);
        }
    }

    async function deleteAssignment() {
        const id = query("#assignmentId").value;
        const projectId = loadedProjectForMutation(query("#assignmentEditorStatus"));
        if (!projectId || !id || !(await Common.ui.confirm("선택한 투입정보를 삭제하시겠습니까?", { title: "투입인력 삭제", confirmText: "삭제", danger: true }))) return;
        const versionToken = query("#assignmentForm").dataset.versionToken;
        const button = query("#deleteAssignmentButton");
        button.disabled = true;
        try {
            await Common.api.request(`/project-assignments/${encodeURIComponent(projectId)}/assignments/${encodeURIComponent(id)}?versionToken=${encodeURIComponent(versionToken)}`, { method: "DELETE", signal: controller.signal, showLoading: false });
            await Promise.all([
                loadProjectData({
                    preserveView: true,
                    resetCompanyForm: false,
                    resetAssignmentForm: true,
                    statusMessage: "투입인력 정보를 갱신했습니다."
                }),
                loadAssignmentBoard()
            ]);
            clearBoardDraft();
            setFormDirty("assignment", false);
        } finally {
            button.disabled = false;
        }
    }

    async function handleYearChange(event) {
        const nextYear = event.currentTarget.value;
        activeYear = nextYear;
        renderProjectOptions();
        await Promise.all([loadProjectData(), loadAssignmentBoard()]);
    }

    async function handleProjectChange() {
        await loadProjectData();
        renderAssignmentBoard();
    }

    async function selectCompanyRow(companyId, focusEditor = false) {
        const item = companies.find((row) => (
            String(value(row, "projectCompanyId", "PROJECT_COMPANY_ID")) === String(companyId)
        ));
        if (!item) return;
        fillCompanyForm(item);
        if (focusEditor) query("#projectCompanyMaster").focus();
    }

    async function selectAssignmentRow(assignmentId, focusEditor = false) {
        const item = assignments.find((row) => (
            String(value(row, "assignmentId", "ASSIGNMENT_ID")) === String(assignmentId)
        ));
        if (!item) return;
        fillAssignmentForm(item);
        if (focusEditor) query("#assignmentCompany").focus();
    }

    async function clearCompanyFormForNewEntry() {
        clearCompanyForm();
        query("#projectCompanyMaster").focus();
    }

    async function clearAssignmentFormForNewEntry() {
        clearAssignmentForm();
        query("#assignmentCompany").focus();
    }

    async function startNewAssignment() {
        const projectId = loadedProjectForMutation();
        if (!projectId) {
            query("#assignmentProjectSelect").focus();
            return;
        }
        await clearAssignmentFormForNewEntry();
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            root = context.root;
            controller = new AbortController();
            compactMode = context.compactMode === true || context.routeContext?.compactMode === true;
            if (compactMode) {
                const boardSaveButton = query("#assignmentBoardSaveButton");
                boardSaveButton.hidden = false;
                boardSaveButton.disabled = true;
                query(".assignment-board-canvas .assignment-board-section-heading")?.appendChild(boardSaveButton);
                query(".assignment-board-help").textContent = "인력을 계속 추가한 뒤 카드별 설정을 조정하고, 우측 변경사항 저장으로 한 번에 반영할 수 있습니다.";
                query(".assignment-board-pool .assignment-board-section-heading p").textContent = "더블클릭하거나 타임라인에 끌어 추가하고, 기존 투입을 이곳에 놓아 해제하세요.";
            }
            query("#assignmentProjectPanel").after(query("#assignmentBoardPanel"));
            query("#queryAssignmentBoardButton").addEventListener("click", () => {
                loadAssignmentBoard().catch((error) => Common.ui.setInlineStatus(query("#assignmentBoardStatus"), error.message, "error"));
            }, { signal: controller.signal });
            query("#assignmentBoardSaveButton").addEventListener("click", () => {
                if (!compactMode) {
                    query("#assignmentForm").requestSubmit();
                    return;
                }
                const drafts = boardDrafts().sort((left, right) => (
                    number(value(left, "draftInsertIndex", "DRAFT_INSERT_INDEX"))
                    - number(value(right, "draftInsertIndex", "DRAFT_INSERT_INDEX"))
                ));
                if (!drafts.length) {
                    Common.ui.setInlineStatus(query("#assignmentBoardStatus"), "저장할 편집중 투입이 없습니다.", "warning");
                    return;
                }
                Common.ui.setInlineStatus(query("#assignmentBoardStatus"), `${drafts.length}명의 변경사항 저장을 요청했습니다.`);
                root.dispatchEvent(new CustomEvent("workforce:save-assignment-drafts", {
                    bubbles: true,
                    detail: {
                        projectId: value(drafts[0], "projectId", "PROJECT_ID"),
                        drafts: drafts.map((draft) => ({ ...draft }))
                    }
                }));
            }, { signal: controller.signal });
            query("#assignmentBoardWorkerSearch").addEventListener("input", renderAssignmentBoardWorkers, { signal: controller.signal });
            query("#assignmentBoardWorkerList").addEventListener("click", (event) => {
                const workerButton = event.target.closest("[data-board-worker-key]");
                if (!workerButton) return;
                boardSelectedWorkerKey = workerButton.dataset.boardWorkerKey;
                if (compactMode) {
                    root.querySelectorAll("[data-board-worker-key]").forEach((item) => item.classList.toggle("is-selected", item === workerButton));
                    query("#assignmentBoardSelection").textContent = `${value(boardWorker(boardSelectedWorkerKey), "userName", "USER_NAME")} 선택됨 · 더블클릭하거나 프로젝트 타임라인 안으로 끌어 놓으세요.`;
                } else {
                    renderAssignmentBoard();
                }
            }, { signal: controller.signal });
            query("#assignmentBoardWorkerList").addEventListener("dblclick", (event) => {
                if (!compactMode) return;
                const workerButton = event.target.closest("[data-board-worker-key]");
                if (!workerButton) return;
                const projectId = selectedProjectId() || value(boardProjects[0], "projectId", "PROJECT_ID");
                const project = boardProject(projectId);
                if (!project) {
                    Common.ui.toast("배치할 프로젝트를 먼저 선택해 주세요.", "warning");
                    return;
                }
                createAssignmentFromBoard(
                    projectId,
                    workerButton.dataset.boardWorkerKey,
                    String(value(project, "projectStartDate", "PROJECT_START_DATE") || "").slice(0, 7),
                    boardProjectAssignmentCount(projectId)
                ).catch((error) => Common.ui.toast(error.message, "error"));
            }, { signal: controller.signal });
            query("#assignmentBoardWorkerList").addEventListener("dragstart", handleBoardDragStart, { signal: controller.signal });
            query("#assignmentBoardWorkerList").addEventListener("dragend", handleBoardDragEnd, { signal: controller.signal });
            query(".assignment-board-pool").addEventListener("dragover", handleBoardRemoveDragOver, { signal: controller.signal });
            query(".assignment-board-pool").addEventListener("dragleave", (event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove("is-remove-drag-over");
            }, { signal: controller.signal });
            query(".assignment-board-pool").addEventListener("drop", handleBoardRemoveDrop, { signal: controller.signal });
            query("#assignmentBoardLanes").addEventListener("dragstart", handleBoardDragStart, { signal: controller.signal });
            query("#assignmentBoardLanes").addEventListener("dragend", handleBoardDragEnd, { signal: controller.signal });
            query("#assignmentBoardLanes").addEventListener("dragover", handleBoardDragOver, { signal: controller.signal });
            query("#assignmentBoardLanes").addEventListener("drop", handleBoardDrop, { signal: controller.signal });
            query("#assignmentBoardLanes").addEventListener("click", (event) => {
                const removeDraftButton = event.target.closest("[data-board-remove-draft-id]");
                if (removeDraftButton) {
                    event.stopPropagation();
                    removeBoardDraft(removeDraftButton.dataset.boardRemoveDraftId);
                    Common.ui.setInlineStatus(query("#assignmentBoardStatus"), "임시 투입을 취소했습니다.", "success");
                    return;
                }
                const removeButton = event.target.closest("[data-board-remove-assignment-id]");
                if (removeButton) {
                    requestBoardAssignmentRemoval(removeButton.dataset.boardRemoveProjectId, removeButton.dataset.boardRemoveAssignmentId);
                    return;
                }
                const assignmentButton = event.target.closest("[data-board-assignment-id]");
                if (assignmentButton) {
                    if (compactMode) {
                        const assignment = boardAssignments.find((item) => (
                            String(value(item, "assignmentId", "ASSIGNMENT_ID")) === String(assignmentButton.dataset.boardAssignmentId)
                        ));
                        const isDraft = String(value(assignment, "draftYn", "DRAFT_YN") || "") === "Y";
                        if (isDraft) boardDraftAssignmentId = assignmentButton.dataset.boardAssignmentId;
                        root.dispatchEvent(new CustomEvent("workforce:open-quick-assignment", {
                            bubbles: true,
                            detail: isDraft
                                ? {
                                    mode: "batch-draft",
                                    projectId: assignmentButton.dataset.boardAssignmentProjectId,
                                    draftId: assignmentButton.dataset.boardAssignmentId,
                                    workerKey: assignmentWorkerKey(assignment),
                                    assignment
                                }
                                : {
                                    mode: "edit",
                                    projectId: assignmentButton.dataset.boardAssignmentProjectId,
                                    assignmentId: assignmentButton.dataset.boardAssignmentId
                                }
                        }));
                        return;
                    }
                    editAssignmentFromBoard(
                        assignmentButton.dataset.boardAssignmentProjectId,
                        assignmentButton.dataset.boardAssignmentId
                    ).catch((error) => Common.ui.toast(error.message, "error"));
                    return;
                }
                const addButton = event.target.closest("[data-board-add-project-id]");
                const dropButton = event.target.closest("[data-board-drop-project-id]");
                const projectId = addButton?.dataset.boardAddProjectId || dropButton?.dataset.boardDropProjectId;
                if (!projectId || !boardSelectedWorkerKey) return;
                const project = boardProject(projectId);
                const projectStart = String(value(project, "projectStartDate", "PROJECT_START_DATE") || "").slice(0, 7);
                const month = dropButton?.dataset.boardDropMonth
                    || (projectStart.startsWith(`${boardYear()}-`) ? projectStart : `${boardYear()}-01`);
                createAssignmentFromBoard(projectId, boardSelectedWorkerKey, month).catch((error) => Common.ui.toast(error.message, "error"));
            }, { signal: controller.signal });
            query("#assignmentBoardLanes").addEventListener("keydown", (event) => {
                if (!["Enter", " "].includes(event.key) || event.target.closest("[data-board-remove-assignment-id], [data-board-remove-draft-id]")) return;
                const assignmentCard = event.target.closest("[data-board-assignment-id]");
                if (!assignmentCard) return;
                event.preventDefault();
                assignmentCard.click();
            }, { signal: controller.signal });
            query("#assignmentProjectYearSelect").addEventListener("change", (event) => {
                handleYearChange(event).catch((error) => {
                    Common.ui.setInlineStatus(query("#assignmentPageStatus"), error.message || "연도를 변경하지 못했습니다.", "error");
                });
            }, { signal: controller.signal });
            query("#assignmentProjectSelect").addEventListener("change", (event) => {
                handleProjectChange(event).catch((error) => {
                    Common.ui.setInlineStatus(query("#assignmentPageStatus"), error.message || "프로젝트를 변경하지 못했습니다.", "error");
                });
            }, { signal: controller.signal });
            query("#projectCompanyForm").addEventListener("submit", (event) => saveCompany(event).catch((error) => Common.ui.setInlineStatus(query("#assignmentPageStatus"), error.message, "error")), { signal: controller.signal });
            query("#projectCompanyForm").addEventListener("input", () => setFormDirty("company"), { signal: controller.signal });
            query("#clearProjectCompanyButton").addEventListener("click", () => {
                clearCompanyFormForNewEntry().catch((error) => Common.ui.setInlineStatus(query("#assignmentPageStatus"), error.message, "error"));
            }, { signal: controller.signal });
            query("#deleteProjectCompanyButton").addEventListener("click", () => deleteCompany().catch((error) => Common.ui.setInlineStatus(query("#assignmentPageStatus"), error.message, "error")), { signal: controller.signal });
            query("#projectCompanyTableBody").addEventListener("click", (event) => {
                const companyId = event.target.closest("tr[data-company-id]")?.dataset.companyId;
                if (companyId) selectCompanyRow(companyId).catch((error) => Common.ui.setInlineStatus(query("#assignmentPageStatus"), error.message, "error"));
            }, { signal: controller.signal });
            query("#projectCompanyTableBody").addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                const companyId = event.target.closest("tr[data-company-id]")?.dataset.companyId;
                if (!companyId) return;
                event.preventDefault();
                selectCompanyRow(companyId, true).catch((error) => Common.ui.setInlineStatus(query("#assignmentPageStatus"), error.message, "error"));
            }, { signal: controller.signal });
            query("#assignmentTableBody").addEventListener("click", (event) => {
                const assignmentId = event.target.closest("tr[data-assignment-id]")?.dataset.assignmentId;
                if (assignmentId) selectAssignmentRow(assignmentId).catch((error) => Common.ui.setInlineStatus(query("#assignmentEditorStatus"), error.message, "error"));
            }, { signal: controller.signal });
            query("#assignmentTableBody").addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                const assignmentId = event.target.closest("tr[data-assignment-id]")?.dataset.assignmentId;
                if (!assignmentId) return;
                event.preventDefault();
                selectAssignmentRow(assignmentId, true).catch((error) => Common.ui.setInlineStatus(query("#assignmentEditorStatus"), error.message, "error"));
            }, { signal: controller.signal });
            query("#newAssignmentButton").addEventListener("click", () => {
                startNewAssignment().catch((error) => Common.ui.setInlineStatus(query("#assignmentEditorStatus"), error.message, "error"));
            }, { signal: controller.signal });
            query("#clearAssignmentButton").addEventListener("click", () => {
                clearAssignmentFormForNewEntry().catch((error) => Common.ui.setInlineStatus(query("#assignmentEditorStatus"), error.message, "error"));
            }, { signal: controller.signal });
            query("#assignmentCompany").addEventListener("change", () => renderAssignmentEmployees(), { signal: controller.signal });
            query("#generateMonthlyAllocationButton").addEventListener("click", () => {
                generateMonthlyAllocations();
                syncBoardDraftFromForm();
                setFormDirty("assignment");
            }, { signal: controller.signal });
            [query("#assignmentStartDate"), query("#assignmentEndDate")].forEach((input) => {
                input.addEventListener("change", () => {
                    validateAssignmentPeriod();
                    generateMonthlyAllocations();
                    syncBoardDraftFromForm();
                }, { signal: controller.signal });
            });
            query("#assignmentAllocationType").addEventListener("change", () => { query("#assignmentWeekdays").hidden = query("#assignmentAllocationType").value !== "WEEKLY"; }, { signal: controller.signal });
            query("#assignmentDefaultMm").addEventListener("change", () => {
                generateMonthlyAllocations();
                syncBoardDraftFromForm();
            }, { signal: controller.signal });
            query("#assignmentStatusCode").addEventListener("change", syncBoardDraftFromForm, { signal: controller.signal });
            query("#assignmentWeekdays").addEventListener("change", () => {
                if (query("#assignmentAllocationType").value !== "WEEKLY") return;
                generateMonthlyAllocations();
                syncBoardDraftFromForm();
            }, { signal: controller.signal });
            query("#monthlyAllocationBody").addEventListener("input", () => {
                updateMonthlyTotals();
                syncBoardDraftFromForm();
            }, { signal: controller.signal });
            query("#assignmentCostUnitPrice").addEventListener("input", updateMonthlyTotals, { signal: controller.signal });
            query("#assignmentSalesUnitPrice").addEventListener("input", updateMonthlyTotals, { signal: controller.signal });
            query("#assignmentForm").addEventListener("input", () => setFormDirty("assignment"), { signal: controller.signal });
            query("#assignmentForm").addEventListener("submit", (event) => saveAssignment(event).catch((error) => Common.ui.setInlineStatus(query("#assignmentEditorStatus"), error.message, "error")), { signal: controller.signal });
            query("#deleteAssignmentButton").addEventListener("click", () => deleteAssignment().catch((error) => Common.ui.setInlineStatus(query("#assignmentEditorStatus"), error.message, "error")), { signal: controller.signal });
            window.addEventListener("beforeunload", beforeUnload, { signal: controller.signal });
            await loadReferences({
                projectYear: context.routeContext?.projectYear,
                projectId: context.routeContext?.projectId
            });
        },
        beforeLeave() {
            return canDiscardFormChanges();
        },
        hasUnsavedChanges() {
            return hasUnsavedFormChanges();
        },
        discardChanges() {
            clearCompanyForm();
            clearAssignmentForm();
            clearAllBoardDrafts();
        },
        clearDraft(draftId) {
            if (draftId) removeBoardDraft(draftId);
            else clearBoardDraft();
        },
        removeDraft(draftId) {
            removeBoardDraft(draftId);
        },
        updateDraft(options) {
            updateBoardDraft(options);
        },
        stageDraftSettings(options) {
            updateBoardDraft(options);
        },
        setSaveFeedback(message, type = "", busy = false) {
            const saveButton = query("#assignmentBoardSaveButton");
            if (saveButton) {
                saveButton.disabled = Boolean(busy) || boardDrafts().length === 0;
                if (busy) saveButton.textContent = "저장 중...";
                else syncBoardDraftControls();
            }
            Common.ui.setInlineStatus(query("#assignmentBoardStatus"), message || "", type);
        },
        async refresh() {
            if (boardLoadPromise) await boardLoadPromise;
            await loadAssignmentBoard();
        },
        destroy() {
            controller?.abort();
            controller = null;
            root = null;
            projects = [];
            workers = [];
            masterCompanies = [];
            companies = [];
            assignments = [];
            currentProject = null;
            loadedProjectId = "";
            activeYear = "";
            projectDataLoading = false;
            companyFormDirty = false;
            assignmentFormDirty = false;
            boardProjects = [];
            boardAssignments = [];
            boardSelectedWorkerKey = "";
            boardLoading = false;
            boardLoadPromise = null;
            compactMode = false;
            boardDraftAssignmentId = "";
            projectDataRequestId += 1;
        }
    };
})();
