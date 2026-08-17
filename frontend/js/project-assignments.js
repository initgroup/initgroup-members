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
    }

    function hasUnsavedFormChanges(scope = "all") {
        return (
            (scope !== "assignment" && companyFormDirty)
            || (scope !== "company" && assignmentFormDirty)
        );
    }

    async function canDiscardFormChanges(scope = "all") {
        if (!hasUnsavedFormChanges(scope)) return true;
        const targetLabel = scope === "company"
            ? "참여회사"
            : scope === "assignment"
                ? "투입인력"
                : "현재 프로젝트";
        const confirmed = await Common.ui.confirm(
            `${targetLabel}에 저장하지 않은 변경사항이 있습니다. 변경사항을 버리고 이동하시겠습니까?`,
            { title: "변경사항 확인", confirmText: "버리고 이동", danger: true }
        );
        if (!confirmed) return false;
        if (scope !== "assignment") clearCompanyForm();
        if (scope !== "company") clearAssignmentForm();
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
            input.min = startDate;
            input.max = endDate;
        });
    }

    function validateAssignmentPeriod() {
        const startInput = query("#assignmentStartDate");
        const endInput = query("#assignmentEndDate");
        const { startDate: projectStartDate, endDate: projectEndDate } = projectPeriod();
        [startInput, endInput].forEach((input) => input.setCustomValidity(""));
        if (!startInput.value || !endInput.value) return true;
        if (startInput.value > endInput.value) {
            endInput.setCustomValidity("투입 종료일은 시작일보다 빠를 수 없습니다.");
            return false;
        }
        if (startInput.value < projectStartDate || endInput.value > projectEndDate) {
            const message = `투입기간은 프로젝트 기간(${projectStartDate} ~ ${projectEndDate}) 안에서 설정해 주세요.`;
            if (startInput.value < projectStartDate) startInput.setCustomValidity(message);
            else endInput.setCustomValidity(message);
            return false;
        }
        return true;
    }

    function renderProjectOptions() {
        const selectedYear = query("#assignmentProjectYearSelect").value;
        const projectSelect = query("#assignmentProjectSelect");
        const yearProjects = projects.filter((project) => (
            String(value(project, "projectYear", "PROJECT_YEAR")) === selectedYear
        ));
        projectSelect.replaceChildren(option(
            "",
            yearProjects.length ? "프로젝트 선택" : "등록된 프로젝트 없음"
        ));
        yearProjects.forEach((project) => projectSelect.appendChild(option(
            value(project, "projectId", "PROJECT_ID"),
            value(project, "projectName", "PROJECT_NAME")
        )));
    }

    function populateReferences() {
        const currentYear = String(new Date().getFullYear());
        const years = Array.from(new Set(projects.map((project) => (
            String(value(project, "projectYear", "PROJECT_YEAR"))
        )).filter(Boolean)));
        if (!years.includes(currentYear)) years.push(currentYear);
        years.sort((left, right) => Number(right) - Number(left));

        const yearSelect = query("#assignmentProjectYearSelect");
        yearSelect.replaceChildren(...years.map((year) => option(year, `${year}년`)));
        yearSelect.value = currentYear;
        activeYear = currentYear;
        renderProjectOptions();
        Common.ui.setInlineStatus(query("#assignmentPageStatus"), `${currentYear}년 프로젝트를 선택해 주세요.`);

        const typeLabels = { HEADQUARTERS: "본사", PARTNER: "협력업체", FREELANCER: "프리랜서" };
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

    async function loadReferences() {
        const payload = await Common.api.request("/project-assignments/references", {
            signal: controller.signal,
            showLoading: false
        });
        const data = Common.data.get(payload) || {};
        projects = value(data, "projects", "PROJECTS") || [];
        workers = value(data, "workers", "WORKERS") || [];
        masterCompanies = value(data, "companies", "COMPANIES") || [];
        populateReferences();
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
        ["#projectCompanyPanel", "#assignmentListPanel", "#assignmentEditorPanel"].forEach((selector) => {
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
        ["#assignmentSummary", "#projectCompanyPanel", "#assignmentListPanel", "#assignmentEditorPanel"].forEach((selector) => {
            query(selector).hidden = true;
        });
        clearCompanyForm();
        clearAssignmentForm();
        query("#newAssignmentButton").disabled = true;
    }

    async function loadProjectData() {
        const requestId = ++projectDataRequestId;
        const projectId = selectedProjectId();
        clearProjectDataView();
        if (!projectId) {
            setProjectDataLoading(false);
            Common.ui.setInlineStatus(query("#assignmentPageStatus"), `${query("#assignmentProjectYearSelect").value}년 프로젝트를 선택해 주세요.`);
            return;
        }
        setProjectDataLoading(true);
        Common.ui.setInlineStatus(query("#assignmentPageStatus"), "프로젝트 투입정보를 불러오고 있습니다.");
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
            renderCompanies();
            renderAssignments();
            ["#projectCompanyPanel", "#assignmentListPanel", "#assignmentEditorPanel"].forEach((selector) => query(selector).hidden = false);
            clearCompanyForm();
            clearAssignmentForm();
            Common.ui.setInlineStatus(query("#assignmentPageStatus"), `${assignments.length}명의 투입인력을 조회했습니다.`);
        } catch (error) {
            if (requestId === projectDataRequestId && error?.name !== "AbortError") {
                clearProjectDataView();
                Common.ui.setInlineStatus(query("#assignmentPageStatus"), error.message || "투입정보를 불러오지 못했습니다.", "error");
            }
        } finally {
            if (requestId === projectDataRequestId) setProjectDataLoading(false);
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

    function boardWorker(workerKeyValue) {
        return workers.find((worker) => workerKey(worker) === workerKeyValue) || null;
    }

    function boardProject(projectId) {
        return boardProjects.find((project) => (
            String(value(project, "projectId", "PROJECT_ID")) === String(projectId)
        )) || null;
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
        if (!boardProjects.length) {
            container.appendChild(Common.dom.element("p", { className: "empty-state", text: `${boardYear()}년에 등록된 프로젝트가 없습니다.` }));
            return;
        }
        boardProjects.forEach((project) => {
            const projectId = value(project, "projectId", "PROJECT_ID");
            const projectName = value(project, "projectName", "PROJECT_NAME") || "프로젝트명 미정";
            const projectAssignments = boardAssignments.filter((assignment) => (
                String(value(assignment, "projectId", "PROJECT_ID")) === String(projectId)
            ));
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
                Common.dom.element("small", { text: `${projectAssignments.length}명 · ${number(value(project, "totalMm", "TOTAL_MM")).toFixed(2)} M/M` }),
                addButton
            );
            const timeline = Common.dom.element("div", {
                className: "assignment-board-timeline",
                attrs: { "aria-label": `${projectName} 확정 투입 타임라인` }
            });
            boardMonths().forEach((month, monthOffset) => {
                const drop = Common.dom.element("button", {
                    className: "assignment-board-month-drop",
                    text: "+",
                    type: "button",
                    attrs: {
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
                const card = Common.dom.element("button", {
                    className: "assignment-board-assignment",
                    type: "button",
                    attrs: {
                        draggable: "true",
                        "data-board-assignment-id": assignmentId,
                        "data-board-assignment-project-id": projectId,
                        "aria-label": `${value(assignment, "employeeName", "EMPLOYEE_NAME")} ${value(assignment, "assignmentStartDate", "ASSIGNMENT_START_DATE")}부터 ${value(assignment, "assignmentEndDate", "ASSIGNMENT_END_DATE")}까지 편집`
                    }
                });
                card.style.gridColumn = `${position.start} / span ${position.span}`;
                card.style.gridRow = String(index + 2);
                card.append(
                    Common.dom.element("strong", { text: value(assignment, "employeeName", "EMPLOYEE_NAME") || "이름 미정" }),
                    Common.dom.element("small", { text: `${number(value(assignment, "totalMm", "TOTAL_MM")).toFixed(2)} M · ${value(assignment, "companyName", "COMPANY_NAME") || "소속 미정"}` })
                );
                timeline.appendChild(card);
            });
            lane.append(info, timeline);
            container.appendChild(lane);
        });
    }

    function renderAssignmentBoard() {
        query("#assignmentBoardYearLabel").textContent = `${boardYear()}년 확정 투입`;
        const selectedWorker = boardWorker(boardSelectedWorkerKey);
        query("#assignmentBoardSelection").textContent = selectedWorker
            ? `${value(selectedWorker, "userName", "USER_NAME")} 선택됨 · 프로젝트의 월 칸을 누르거나 드롭하세요.`
            : "선택한 인력이 없습니다.";
        renderAssignmentBoardMonths();
        renderAssignmentBoardWorkers();
        renderAssignmentBoardLanes();
    }

    async function loadAssignmentBoard() {
        if (boardLoading) return;
        boardLoading = true;
        Common.ui.setInlineStatus(query("#assignmentBoardStatus"), `${boardYear()}년 확정 투입을 불러오고 있습니다.`);
        try {
            const payload = await Common.api.request(`/project-assignments/workspace?projectYear=${encodeURIComponent(boardYear())}`, {
                signal: controller.signal,
                showLoading: false
            });
            const data = Common.data.get(payload) || {};
            boardProjects = value(data, "projects", "PROJECTS") || [];
            boardAssignments = value(data, "assignments", "ASSIGNMENTS") || [];
            renderAssignmentBoard();
            Common.ui.setInlineStatus(query("#assignmentBoardStatus"), `${boardProjects.length}개 프로젝트와 ${boardAssignments.length}건의 확정 투입을 불러왔습니다.`, "success");
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.setInlineStatus(query("#assignmentBoardStatus"), error.message || "확정 투입 배치 보드를 불러오지 못했습니다.", "error");
            }
        } finally {
            boardLoading = false;
        }
    }

    async function openAssignmentBoard() {
        if (!(await canDiscardFormChanges())) return;
        boardSelectedWorkerKey = "";
        query("#assignmentBoardWorkerSearch").value = "";
        const dialog = query("#assignmentBoardDialog");
        if (!dialog.open) dialog.showModal();
        renderAssignmentBoard();
        await loadAssignmentBoard();
    }

    function closeAssignmentBoard() {
        const dialog = query("#assignmentBoardDialog");
        if (dialog.open) dialog.close();
    }

    async function loadProjectEditorFromBoard(projectId) {
        closeAssignmentBoard();
        query("#assignmentProjectYearSelect").value = String(boardYear());
        activeYear = String(boardYear());
        renderProjectOptions();
        query("#assignmentProjectSelect").value = String(projectId);
        await loadProjectData();
        if (String(loadedProjectId) !== String(projectId)) {
            throw new Error("선택한 프로젝트의 상세 정보를 불러오지 못했습니다.");
        }
    }

    async function createAssignmentFromBoard(projectId, workerKeyValue, month) {
        const worker = boardWorker(workerKeyValue);
        const project = boardProject(projectId);
        if (!worker || !project) return;
        await loadProjectEditorFromBoard(projectId);
        clearAssignmentForm();
        const company = companies.find((item) => (
            String(value(item, "companyId", "COMPANY_ID")) === String(value(worker, "companyId", "COMPANY_ID"))
        ));
        if (!company) {
            Common.ui.setInlineStatus(
                query("#assignmentEditorStatus"),
                "해당 인력의 소속회사가 이 프로젝트의 참여회사로 등록되지 않았습니다. 참여회사를 먼저 등록해 주세요.",
                "error"
            );
            query("#projectCompanyPanel").scrollIntoView({ behavior: "smooth", block: "start" });
            return;
        }
        query("#assignmentCompany").value = String(value(company, "projectCompanyId", "PROJECT_COMPANY_ID"));
        renderAssignmentEmployees(workerKeyValue);
        query("#assignmentEmployee").value = workerKeyValue;
        const projectStart = String(value(project, "projectStartDate", "PROJECT_START_DATE")).slice(0, 10);
        const projectEnd = String(value(project, "projectEndDate", "PROJECT_END_DATE")).slice(0, 10);
        const requestedStart = `${month}-01`;
        const requestedEnd = lastDateOfMonth(month);
        query("#assignmentStartDate").value = requestedStart < projectStart ? projectStart : requestedStart;
        query("#assignmentEndDate").value = requestedEnd > projectEnd ? projectEnd : requestedEnd;
        generateMonthlyAllocations();
        setFormDirty("assignment");
        Common.ui.setInlineStatus(query("#assignmentEditorStatus"), "배치 보드의 인력과 시작 월을 적용했습니다. 상세 조건을 확인한 뒤 저장하세요.", "success");
        query("#assignmentEditorPanel").scrollIntoView({ behavior: "smooth", block: "start" });
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
            const { startDate: projectStart, endDate: projectEnd } = projectPeriod();
            const requestedStart = `${targetMonth}-01`;
            const requestedEnd = lastDateOfMonth(addMonths(targetMonth, monthSpan));
            const nextStart = requestedStart < projectStart ? projectStart : requestedStart;
            const nextEnd = requestedEnd > projectEnd ? projectEnd : requestedEnd;
            if (nextStart > nextEnd) {
                Common.ui.setInlineStatus(query("#assignmentEditorStatus"), "선택한 월은 프로젝트 기간 밖입니다.", "error");
            } else {
                query("#assignmentStartDate").value = nextStart;
                query("#assignmentEndDate").value = nextEnd;
                generateMonthlyAllocations();
                setFormDirty("assignment");
                Common.ui.setInlineStatus(query("#assignmentEditorStatus"), "배치 기간을 이동했습니다. 월별 M/M과 금액을 검토한 뒤 저장하세요.", "success");
            }
        }
        query("#assignmentEditorPanel").scrollIntoView({ behavior: "smooth", block: "start" });
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
    }

    function handleBoardDragOver(event) {
        if (!event.target.closest("[data-board-drop-project-id]")) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    }

    function handleBoardDrop(event) {
        const dropTarget = event.target.closest("[data-board-drop-project-id]");
        if (!dropTarget) return;
        event.preventDefault();
        const payload = boardDragPayload(event);
        if (!payload) return;
        const projectId = dropTarget.dataset.boardDropProjectId;
        const month = dropTarget.dataset.boardDropMonth;
        if (payload.kind === "worker") {
            createAssignmentFromBoard(projectId, payload.workerKey, month).catch((error) => Common.ui.toast(error.message, "error"));
            return;
        }
        if (String(payload.projectId) !== String(projectId)) {
            Common.ui.toast("확정 투입의 프로젝트 이동은 참여회사와 단가가 달라질 수 있어 지원하지 않습니다. 대상 프로젝트에 새 배치로 등록해 주세요.", "warning");
            return;
        }
        editAssignmentFromBoard(projectId, payload.assignmentId, month).catch((error) => Common.ui.toast(error.message, "error"));
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

    async function saveCompany(event) {
        event.preventDefault();
        const projectId = loadedProjectForMutation();
        if (!projectId || !event.currentTarget.reportValidity()) return;
        const id = query("#projectCompanyId").value;
        await Common.api.request(`/project-assignments/${encodeURIComponent(projectId)}/companies${id ? `/${encodeURIComponent(id)}` : ""}`, {
            method: id ? "PUT" : "POST",
            body: { companyId: Number(query("#projectCompanyMaster").value), participationTypeCode: query("#projectCompanyType").value, shareRate: query("#projectCompanyShareRate").value, note: query("#projectCompanyNote").value.trim(), versionToken: id ? event.currentTarget.dataset.versionToken : null },
            signal: controller.signal,
            loadingMessage: "참여회사를 저장하고 있습니다."
        });
        Common.ui.toast("참여회사를 저장했습니다.", "success");
        await loadProjectData();
    }

    async function deleteCompany() {
        const id = query("#projectCompanyId").value;
        const projectId = loadedProjectForMutation();
        if (!projectId || !id || !(await Common.ui.confirm("선택한 참여회사를 삭제하시겠습니까?", { title: "참여회사 삭제", confirmText: "삭제", danger: true }))) return;
        const versionToken = query("#projectCompanyForm").dataset.versionToken;
        await Common.api.request(`/project-assignments/${encodeURIComponent(projectId)}/companies/${encodeURIComponent(id)}?versionToken=${encodeURIComponent(versionToken)}`, { method: "DELETE", signal: controller.signal, loadingMessage: "참여회사를 삭제하고 있습니다." });
        await loadProjectData();
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
        query("#assignmentAllocationType").value = value(item, "allocationTypeCode", "ALLOCATION_TYPE_CODE") || "MONTHLY";
        query("#assignmentDefaultMm").value = String(value(item, "defaultMm", "DEFAULT_MM") ?? 1);
        query("#assignmentCostUnitPrice").value = value(item, "costUnitPrice", "COST_UNIT_PRICE") || 0;
        query("#assignmentSalesUnitPrice").value = value(item, "salesUnitPrice", "SALES_UNIT_PRICE") || 0;
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
            Common.ui.setInlineStatus(query("#assignmentEditorStatus"), "투입기간을 프로젝트 기간 안에서 설정해 주세요.", "error");
            return;
        }
        if (!event.currentTarget.reportValidity()) return;
        const allocations = currentAllocations();
        if (!allocations.length) { Common.ui.setInlineStatus(query("#assignmentEditorStatus"), "월별 배분을 생성해 주세요.", "error"); return; }
        const id = query("#assignmentId").value;
        const [workerType, workerId] = query("#assignmentEmployee").value.split(":");
        await Common.api.request(`/project-assignments/${encodeURIComponent(projectId)}/assignments${id ? `/${encodeURIComponent(id)}` : ""}`, {
            method: id ? "PUT" : "POST",
            body: { employeeUserId: workerType === "USER" ? Number(workerId) : null, companyEmployeeId: workerType === "COMPANY_EMPLOYEE" ? Number(workerId) : null, projectCompanyId: Number(query("#assignmentCompany").value), assignmentStartDate: query("#assignmentStartDate").value, assignmentEndDate: query("#assignmentEndDate").value, allocationTypeCode: query("#assignmentAllocationType").value, defaultMm: query("#assignmentDefaultMm").value, weeklyDayCodes: [...root.querySelectorAll("#assignmentWeekdays input:checked")].map((input) => input.value), monthlyAllocations: allocations, costUnitPrice: query("#assignmentCostUnitPrice").value, salesUnitPrice: query("#assignmentSalesUnitPrice").value, note: query("#assignmentNote").value.trim(), versionToken: id ? event.currentTarget.dataset.versionToken : null },
            signal: controller.signal,
            loadingMessage: "투입인력 정보를 저장하고 있습니다."
        });
        Common.ui.toast("투입인력 정보를 저장했습니다.", "success");
        await loadProjectData();
    }

    async function deleteAssignment() {
        const id = query("#assignmentId").value;
        const projectId = loadedProjectForMutation(query("#assignmentEditorStatus"));
        if (!projectId || !id || !(await Common.ui.confirm("선택한 투입정보를 삭제하시겠습니까?", { title: "투입인력 삭제", confirmText: "삭제", danger: true }))) return;
        const versionToken = query("#assignmentForm").dataset.versionToken;
        await Common.api.request(`/project-assignments/${encodeURIComponent(projectId)}/assignments/${encodeURIComponent(id)}?versionToken=${encodeURIComponent(versionToken)}`, { method: "DELETE", signal: controller.signal, loadingMessage: "투입정보를 삭제하고 있습니다." });
        await loadProjectData();
    }

    async function handleYearChange(event) {
        const nextYear = event.currentTarget.value;
        if (!(await canDiscardFormChanges())) {
            event.currentTarget.value = activeYear;
            return;
        }
        activeYear = nextYear;
        renderProjectOptions();
        await loadProjectData();
    }

    async function handleProjectChange(event) {
        if (!(await canDiscardFormChanges())) {
            event.currentTarget.value = loadedProjectId || "";
            return;
        }
        await loadProjectData();
    }

    async function selectCompanyRow(companyId, focusEditor = false) {
        const item = companies.find((row) => (
            String(value(row, "projectCompanyId", "PROJECT_COMPANY_ID")) === String(companyId)
        ));
        if (!item || !(await canDiscardFormChanges("company"))) return;
        fillCompanyForm(item);
        if (focusEditor) query("#projectCompanyMaster").focus();
    }

    async function selectAssignmentRow(assignmentId, focusEditor = false) {
        const item = assignments.find((row) => (
            String(value(row, "assignmentId", "ASSIGNMENT_ID")) === String(assignmentId)
        ));
        if (!item || !(await canDiscardFormChanges("assignment"))) return;
        fillAssignmentForm(item);
        if (focusEditor) query("#assignmentCompany").focus();
    }

    async function clearCompanyFormWithConfirmation() {
        if (!(await canDiscardFormChanges("company"))) return;
        clearCompanyForm();
        query("#projectCompanyMaster").focus();
    }

    async function clearAssignmentFormWithConfirmation() {
        if (!(await canDiscardFormChanges("assignment"))) return;
        clearAssignmentForm();
        query("#assignmentCompany").focus();
    }

    async function startNewAssignment() {
        const projectId = loadedProjectForMutation();
        if (!projectId) {
            query("#assignmentProjectSelect").focus();
            return;
        }
        await clearAssignmentFormWithConfirmation();
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            root = context.root;
            controller = new AbortController();
            query("#openAssignmentBoardButton").addEventListener("click", () => {
                openAssignmentBoard().catch((error) => Common.ui.setInlineStatus(query("#assignmentPageStatus"), error.message, "error"));
            }, { signal: controller.signal });
            [query("#closeAssignmentBoardButton"), query("#assignmentBoardDoneButton")].forEach((button) => {
                button.addEventListener("click", closeAssignmentBoard, { signal: controller.signal });
            });
            query("#refreshAssignmentBoardButton").addEventListener("click", () => {
                loadAssignmentBoard().catch((error) => Common.ui.setInlineStatus(query("#assignmentBoardStatus"), error.message, "error"));
            }, { signal: controller.signal });
            query("#assignmentBoardWorkerSearch").addEventListener("input", renderAssignmentBoardWorkers, { signal: controller.signal });
            query("#assignmentBoardWorkerList").addEventListener("click", (event) => {
                const workerButton = event.target.closest("[data-board-worker-key]");
                if (!workerButton) return;
                boardSelectedWorkerKey = workerButton.dataset.boardWorkerKey;
                renderAssignmentBoard();
            }, { signal: controller.signal });
            query("#assignmentBoardWorkerList").addEventListener("dragstart", handleBoardDragStart, { signal: controller.signal });
            query("#assignmentBoardLanes").addEventListener("dragstart", handleBoardDragStart, { signal: controller.signal });
            query("#assignmentBoardLanes").addEventListener("dragover", handleBoardDragOver, { signal: controller.signal });
            query("#assignmentBoardLanes").addEventListener("drop", handleBoardDrop, { signal: controller.signal });
            query("#assignmentBoardLanes").addEventListener("click", (event) => {
                const assignmentButton = event.target.closest("[data-board-assignment-id]");
                if (assignmentButton) {
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
            query("#assignmentBoardDialog").addEventListener("cancel", (event) => {
                event.preventDefault();
                closeAssignmentBoard();
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
                clearCompanyFormWithConfirmation().catch((error) => Common.ui.setInlineStatus(query("#assignmentPageStatus"), error.message, "error"));
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
                clearAssignmentFormWithConfirmation().catch((error) => Common.ui.setInlineStatus(query("#assignmentEditorStatus"), error.message, "error"));
            }, { signal: controller.signal });
            query("#assignmentCompany").addEventListener("change", () => renderAssignmentEmployees(), { signal: controller.signal });
            query("#generateMonthlyAllocationButton").addEventListener("click", () => {
                generateMonthlyAllocations();
                setFormDirty("assignment");
            }, { signal: controller.signal });
            query("#assignmentStartDate").addEventListener("change", validateAssignmentPeriod, { signal: controller.signal });
            query("#assignmentEndDate").addEventListener("change", validateAssignmentPeriod, { signal: controller.signal });
            query("#assignmentAllocationType").addEventListener("change", () => { query("#assignmentWeekdays").hidden = query("#assignmentAllocationType").value !== "WEEKLY"; }, { signal: controller.signal });
            query("#assignmentWeekdays").addEventListener("change", () => { if (query("#assignmentAllocationType").value === "WEEKLY") generateMonthlyAllocations(); }, { signal: controller.signal });
            query("#monthlyAllocationBody").addEventListener("input", updateMonthlyTotals, { signal: controller.signal });
            query("#assignmentCostUnitPrice").addEventListener("input", updateMonthlyTotals, { signal: controller.signal });
            query("#assignmentSalesUnitPrice").addEventListener("input", updateMonthlyTotals, { signal: controller.signal });
            query("#assignmentForm").addEventListener("input", () => setFormDirty("assignment"), { signal: controller.signal });
            query("#assignmentForm").addEventListener("submit", (event) => saveAssignment(event).catch((error) => Common.ui.setInlineStatus(query("#assignmentEditorStatus"), error.message, "error")), { signal: controller.signal });
            query("#deleteAssignmentButton").addEventListener("click", () => deleteAssignment().catch((error) => Common.ui.setInlineStatus(query("#assignmentEditorStatus"), error.message, "error")), { signal: controller.signal });
            window.addEventListener("beforeunload", beforeUnload, { signal: controller.signal });
            await loadReferences();
        },
        beforeLeave() {
            return canDiscardFormChanges();
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
            projectDataRequestId += 1;
        }
    };
})();
