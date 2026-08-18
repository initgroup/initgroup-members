(function() {
    "use strict";

    const PAGE_NAME = "workforce-planning";
    const BID_LABELS = {
        REVIEW: "검토",
        PARTICIPATE: "입찰",
        HOLD: "보류",
        SKIP: "미참여"
    };
    const WORKER_LABELS = {
        INTERNAL: "내부",
        PARTNER: "협력"
    };
    const moneyFormatter = new Intl.NumberFormat("ko-KR", {
        style: "currency",
        currency: "KRW",
        maximumFractionDigits: 0
    });

    let root = null;
    let controller = null;
    let requestSequence = 0;
    let scenarioRequestSequence = 0;
    let clientSequence = 0;
    let references = { projects: [], workers: [], actualCapacity: [], dataQualityWarnings: [] };
    let scenarios = [];
    let scenario = null;
    let savedScenario = null;
    let selectedWorkerKey = "";
    let selectedProjectKey = "";
    let selectedAssignmentKey = "";
    let dirty = false;
    let formDirty = false;
    let activeDragKind = "";
    let scenarioLoading = false;

    function query(selector) {
        return root?.querySelector(selector) || null;
    }

    function element(tagName, className = "", text = "") {
        const node = document.createElement(tagName);
        if (className) node.className = className;
        if (text !== "") node.textContent = String(text);
        return node;
    }

    function number(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function integerText(value) {
        const text = String(value ?? "0").trim();
        if (/^-?\d+$/.test(text)) return text;
        return String(Math.round(number(value)));
    }

    function integerAmount(value) {
        try {
            return BigInt(integerText(value));
        } catch (_error) {
            return 0n;
        }
    }

    function money(value) {
        return moneyFormatter.format(integerAmount(value));
    }

    function fixed(value, digits = 2) {
        return number(value).toFixed(digits);
    }

    function nextClientKey(prefix) {
        clientSequence += 1;
        return `${prefix}:${Date.now()}:${clientSequence}`;
    }

    function cloneData(value) {
        return value === null || value === undefined
            ? value
            : JSON.parse(JSON.stringify(value));
    }

    function hasPendingChanges() {
        return dirty || formDirty;
    }

    function roundedAllocationAmount(mm, unitPrice) {
        const hundredths = BigInt(Math.round(number(mm) * 100));
        return (integerAmount(unitPrice) * hundredths + 50n) / 100n;
    }

    function scenarioEditable() {
        return !scenarioLoading && scenario?.statusCode === "DRAFT";
    }

    function monthRange(startDate, endDate) {
        if (!startDate || !endDate || startDate > endDate) return [];
        const [startYear, startMonth] = startDate.slice(0, 7).split("-").map(Number);
        const [endYear, endMonth] = endDate.slice(0, 7).split("-").map(Number);
        const result = [];
        const cursorDate = new Date(startYear, startMonth - 1, 1);
        const finalDate = new Date(endYear, endMonth - 1, 1);
        while (cursorDate <= finalDate && result.length < 240) {
            result.push(`${cursorDate.getFullYear()}-${String(cursorDate.getMonth() + 1).padStart(2, "0")}`);
            cursorDate.setMonth(cursorDate.getMonth() + 1);
        }
        return result;
    }

    function yearMonths() {
        const year = Number(query("#planningYearSelect")?.value || new Date().getFullYear() + 1);
        return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
    }

    function planYearBounds() {
        const year = Number(scenario?.planYear || query("#planningYearSelect")?.value);
        return {
            startDate: `${year}-01-01`,
            endDate: `${year}-12-31`
        };
    }

    function clippedPlanningPeriod(startDate, endDate) {
        const bounds = planYearBounds();
        const clippedStart = startDate ? String(startDate).slice(0, 10) : bounds.startDate;
        const clippedEnd = endDate ? String(endDate).slice(0, 10) : bounds.endDate;
        const result = {
            startDate: clippedStart < bounds.startDate ? bounds.startDate : clippedStart,
            endDate: clippedEnd > bounds.endDate ? bounds.endDate : clippedEnd
        };
        return result.startDate <= result.endDate ? result : null;
    }

    function workerByKey(workerKey) {
        return references.workers.find((item) => String(item.workerKey) === String(workerKey)) || null;
    }

    function projectReference(projectId) {
        return references.projects.find((item) => String(item.projectId) === String(projectId)) || null;
    }

    function planningProject(projectKey) {
        return scenario?.projects?.find((item) => item.clientKey === projectKey) || null;
    }

    function assignmentByKey(assignmentKey) {
        for (const project of scenario?.projects || []) {
            const assignment = project.assignments.find((item) => item.clientKey === assignmentKey);
            if (assignment) return { project, assignment };
        }
        return null;
    }

    function normalizeScenario(source) {
        const result = {
            ...source,
            projects: (source?.projects || []).map((project) => ({
                ...project,
                clientKey: `project:${project.scenarioProjectId || project.projectId}`,
                assignments: (project.assignments || []).map((assignment) => ({
                    ...assignment,
                    clientKey: `assignment:${assignment.planAssignmentId || nextClientKey("assignment")}`,
                    workerKey: assignment.workerKey || (
                        assignment.userId
                            ? `USER:${assignment.userId}`
                            : `COMPANY_EMPLOYEE:${assignment.companyEmployeeId}`
                    ),
                    monthlyAllocations: (assignment.monthlyAllocations || []).map((month) => ({
                        month: month.month,
                        mm: number(month.mm)
                    }))
                }))
            }))
        };
        return result;
    }

    function assignmentAmounts(assignment) {
        const costUnitPrice = assignment.costUnitPrice;
        const salesUnitPrice = assignment.salesUnitPrice;
        return (assignment.monthlyAllocations || []).reduce((summary, month) => {
            const mm = number(month.mm);
            const cost = roundedAllocationAmount(mm, costUnitPrice);
            const sales = roundedAllocationAmount(mm, salesUnitPrice);
            summary.totalMm += mm;
            summary.totalCostAmount += cost;
            summary.totalSalesAmount += sales;
            summary.operatingProfit += sales - cost;
            return summary;
        }, { totalMm: 0, totalCostAmount: 0n, totalSalesAmount: 0n, operatingProfit: 0n });
    }

    function calculateScenario() {
        const dataQualityWarnings = scenario
            ? (scenario.warnings || []).filter((warning) => warning.type === "DATA_QUALITY")
            : (references.dataQualityWarnings || []);
        const summary = {
            projectCount: 0,
            assignmentCount: 0,
            totalMm: 0,
            totalCostAmount: 0n,
            totalSalesAmount: 0n,
            operatingProfit: 0n,
            weightedPipeline: 0n,
            warnings: dataQualityWarnings.map((warning) => ({ ...warning }))
        };
        const capacity = new Map();
        const workerNames = new Map();
        (references.actualCapacity || []).forEach((item) => {
            const key = `${item.workerKey}|${item.month}`;
            capacity.set(key, (capacity.get(key) || 0) + number(item.totalMm));
            workerNames.set(item.workerKey, item.employeeName || item.workerKey);
        });

        (scenario?.projects || []).forEach((project) => {
            const activeProject = String(project.bidDecisionCode || "REVIEW").toUpperCase() !== "SKIP";
            if (activeProject) {
                const probabilityBasisPoints = BigInt(
                    Math.round(number(project.winProbability) * 100)
                );
                summary.projectCount += 1;
                summary.weightedPipeline += (
                    integerAmount(project.expectedContractAmount) * probabilityBasisPoints + 5000n
                ) / 10000n;
            }
            (project.assignments || []).forEach((assignment) => {
                const amounts = assignmentAmounts(assignment);
                Object.assign(assignment, {
                    totalMm: amounts.totalMm,
                    totalCostAmount: amounts.totalCostAmount.toString(),
                    totalSalesAmount: amounts.totalSalesAmount.toString(),
                    operatingProfit: amounts.operatingProfit.toString()
                });
                if (activeProject) {
                    summary.assignmentCount += 1;
                    summary.totalMm += amounts.totalMm;
                    summary.totalCostAmount += amounts.totalCostAmount;
                    summary.totalSalesAmount += amounts.totalSalesAmount;
                    summary.operatingProfit += amounts.operatingProfit;
                    workerNames.set(assignment.workerKey, assignment.employeeName || assignment.workerKey);
                    assignment.monthlyAllocations.forEach((month) => {
                        const key = `${assignment.workerKey}|${month.month}`;
                        capacity.set(key, (capacity.get(key) || 0) + number(month.mm));
                    });
                }
            });
            const staffedHeadcount = new Set(
                (project.assignments || [])
                    .filter((assignment) => assignmentAmounts(assignment).totalMm > 0)
                    .map((assignment) => assignment.workerKey)
            ).size;
            const shortageHeadcount = Math.max(
                0,
                number(project.targetHeadcount) - staffedHeadcount
            );
            if (activeProject && shortageHeadcount > 0) {
                summary.warnings.push({
                    type: "UNDERSTAFFED",
                    projectName: project.projectName,
                    shortageHeadcount,
                    message: `${project.projectName} · ${shortageHeadcount}명 부족`
                });
            }
        });

        capacity.forEach((totalMm, key) => {
            if (totalMm <= 1) return;
            const separator = key.lastIndexOf("|");
            const workerKey = key.slice(0, separator);
            const month = key.slice(separator + 1);
            summary.warnings.push({
                type: "OVER_CAPACITY",
                workerKey,
                employeeName: workerNames.get(workerKey) || workerKey,
                month,
                totalMm,
                message: `${workerNames.get(workerKey) || workerKey} · ${month} · ${fixed(totalMm)} M/M`
            });
        });
        return summary;
    }

    function markDirty(value = true) {
        dirty = Boolean(value);
        updateDirtyState();
    }

    function markFormDirty(value = true) {
        formDirty = Boolean(value);
        updateDirtyState();
    }

    function updateDirtyState() {
        const badge = query("#planningDirtyBadge");
        if (badge) badge.hidden = !hasPendingChanges();
        updateToolbarState();
    }

    function updateToolbarState() {
        const editable = scenarioEditable();
        const hasScenario = Boolean(scenario?.scenarioId);
        query("#planningYearSelect").disabled = scenarioLoading;
        query("#planningScenarioSelect").disabled = scenarioLoading;
        query("#planningNewScenarioButton").disabled = scenarioLoading;
        query("#planningWorkspace").inert = scenarioLoading;
        query("#planningWorkspace").setAttribute("aria-busy", String(scenarioLoading));
        query("#planningSaveButton").disabled = !hasScenario || !editable || !hasPendingChanges();
        query("#planningConfirmButton").disabled = !hasScenario || !editable;
        query("#planningDeleteScenarioButton").disabled = !hasScenario || !editable;
        const revision = query("#planningRevisionLabel");
        if (!revision) return;
        if (!hasScenario) {
            revision.textContent = "계획안을 선택해 주세요.";
        } else if (editable) {
            revision.textContent = `임시안 · revision ${scenario.revisionNo}`;
        } else {
            revision.textContent = `확정안 · revision ${scenario.revisionNo}`;
        }
    }

    function renderMetrics() {
        const summary = calculateScenario();
        query("#planningProjectCount").textContent = summary.projectCount;
        query("#planningAssignmentCount").textContent = summary.assignmentCount;
        query("#planningTotalMm").textContent = fixed(summary.totalMm);
        query("#planningWeightedPipeline").textContent = money(summary.weightedPipeline);
        query("#planningTotalSales").textContent = money(summary.totalSalesAmount);
        query("#planningTotalCost").textContent = money(summary.totalCostAmount);
        query("#planningOperatingProfit").textContent = money(summary.operatingProfit);
        query("#planningProfitRate").textContent = summary.totalSalesAmount !== 0n
            ? `${fixed(Number(summary.operatingProfit * 10000n / summary.totalSalesAmount) / 100)}%`
            : "0%";
        query("#planningWarningCount").textContent = summary.warnings.length;
        renderWarnings(summary.warnings);
    }

    function renderWarnings(warnings) {
        const panel = query("#planningWarningsPanel");
        const list = query("#planningWarningsList");
        Common.dom.clear(list);
        panel.hidden = !warnings.length;
        warnings.forEach((warning) => {
            const item = element("li", "planning-warning-item");
            const icon = element("span", "planning-warning-icon", "!");
            const text = element("div");
            if (warning.type === "DATA_QUALITY") {
                text.append(
                    element("strong", "", `${warning.employeeName || "실제 투입"} 데이터 오류`),
                    element("span", "", warning.message || "프로젝트 투입의 월별 배분 데이터를 수정해 주세요.")
                );
            } else if (warning.type === "UNDERSTAFFED") {
                text.append(
                    element("strong", "", `${warning.projectName} 인력 부족`),
                    element("span", "", `목표 투입인원보다 ${warning.shortageHeadcount}명이 부족합니다.`)
                );
            } else {
                text.append(
                    element("strong", "", `${warning.employeeName} 과부하`),
                    element("span", "", `${warning.month}에 ${fixed(warning.totalMm)} M/M이 배치되어 있습니다.`)
                );
            }
            item.append(icon, text);
            list.appendChild(item);
        });
    }

    function renderMonthHeader() {
        const header = query("#planningMonthHeader");
        Common.dom.clear(header);
        header.appendChild(element("span", "planning-month-label planning-month-label-title", "PROJECT / MONTH"));
        yearMonths().forEach((month) => {
            header.appendChild(element("span", "planning-month-label", `${Number(month.slice(5))}월`));
        });
    }

    function projectMatches(project, keyword) {
        if (!keyword) return true;
        return `${project.projectName || ""} ${project.customerName || ""}`.toLowerCase().includes(keyword);
    }

    function selectedProjectFilterId() {
        return query("#planningProjectFilter")?.value || "";
    }

    function renderProjectFilterOptions() {
        const select = query("#planningProjectFilter");
        if (!select) return;
        const selectedValue = select.value;
        Common.dom.clear(select);
        const allOption = element("option", "", references.projects.length ? "전체 프로젝트" : "등록된 프로젝트 없음");
        allOption.value = "";
        select.appendChild(allOption);
        references.projects.forEach((project) => {
            const item = element("option", "", project.projectName || "프로젝트명 미정");
            item.value = project.projectId;
            select.appendChild(item);
        });
        if ([...select.options].some((item) => item.value === selectedValue)) select.value = selectedValue;
    }

    function renderProjectPool() {
        const pool = query("#planningProjectPool");
        Common.dom.clear(pool);
        const keyword = query("#planningProjectSearch").value.trim().toLowerCase();
        const selectedProjectId = selectedProjectFilterId();
        const includedIds = new Set((scenario?.projects || []).map((item) => String(item.projectId)));
        const rows = references.projects.filter((item) => (
            (!selectedProjectId || String(item.projectId) === String(selectedProjectId))
            && !includedIds.has(String(item.projectId))
            && projectMatches(item, keyword)
        ));
        query("#planningProjectPoolCount").textContent = rows.length;

        if (!rows.length) {
            pool.appendChild(element("p", "planning-pool-empty", "추가할 사업 후보가 없습니다."));
            return;
        }
        rows.forEach((project) => {
            const card = element("article", "planning-project-card");
            card.draggable = scenarioEditable();
            card.dataset.projectId = project.projectId;
            const meta = element("div", "planning-card-meta");
            meta.append(
                element("span", "planning-year-chip", `등록 ${project.projectYear}`),
                element("span", `planning-status-chip is-${String(project.statusCode || "planned").toLowerCase()}`, project.statusCode || "PLANNED")
            );
            const title = element("strong", "", project.projectName);
            const customer = element("span", "planning-card-subtitle", project.customerName);
            const amounts = element("span", "planning-card-amount", `공모 ${money(project.orderAmountVat)}`);
            const button = element("button", "button button-secondary button-small", "계획에 추가");
            button.type = "button";
            button.dataset.action = "add-project";
            button.dataset.projectId = project.projectId;
            button.disabled = !scenarioEditable();
            card.append(meta, title, customer, amounts, button);
            pool.appendChild(card);
        });
    }

    function workerMatches(worker, keyword, type) {
        if (type && String(worker.workerTypeCode) !== type) return false;
        if (!keyword) return true;
        return `${worker.employeeName || ""} ${worker.companyName || ""} ${worker.departmentName || ""} ${worker.positionName || ""}`
            .toLowerCase()
            .includes(keyword);
    }

    function renderWorkerPool() {
        const pool = query("#planningWorkerPool");
        Common.dom.clear(pool);
        const keyword = query("#planningWorkerSearch").value.trim().toLowerCase();
        const type = query("#planningWorkerType").value;
        const rows = references.workers.filter((item) => workerMatches(item, keyword, type));
        query("#planningWorkerPoolCount").textContent = rows.length;

        if (!rows.length) {
            pool.appendChild(element("p", "planning-pool-empty", "조건에 맞는 인력이 없습니다."));
            return;
        }
        rows.forEach((worker) => {
            const card = element("button", "planning-worker-card", "");
            card.type = "button";
            card.draggable = scenarioEditable();
            card.dataset.workerKey = worker.workerKey;
            const selected = worker.workerKey === selectedWorkerKey;
            card.setAttribute("aria-pressed", selected ? "true" : "false");
            if (selected) card.classList.add("is-selected");
            const avatar = element("span", "planning-worker-avatar", String(worker.employeeName || "?").slice(0, 1));
            const copy = element("span", "planning-worker-copy");
            const availability = worker.availableStartDate || worker.availableEndDate
                ? ` · 가용 ${worker.availableStartDate || "제한 없음"} ~ ${worker.availableEndDate || "제한 없음"}`
                : "";
            copy.append(
                element("strong", "", worker.employeeName),
                element("small", "", `${worker.companyName || "소속 미지정"} · ${worker.positionName || worker.jobTitle || "직급 미지정"}${availability}`)
            );
            const badge = element(
                "span",
                `planning-worker-type is-${String(worker.workerTypeCode || "internal").toLowerCase()}`,
                WORKER_LABELS[worker.workerTypeCode] || worker.workerTypeCode
            );
            card.append(avatar, copy, badge);
            pool.appendChild(card);
        });
    }

    function assignmentTimelinePosition(assignment) {
        const months = yearMonths();
        const startMonth = String(assignment.assignmentStartDate || "").slice(0, 7);
        const endMonth = String(assignment.assignmentEndDate || "").slice(0, 7);
        if (!startMonth || !endMonth || endMonth < months[0] || startMonth > months[11]) {
            return null;
        }
        let start = months.findIndex((month) => month >= startMonth);
        let end = -1;
        months.forEach((month, index) => {
            if (month <= endMonth) end = index;
        });
        if (start < 0) start = 0;
        if (end < 0) end = 0;
        if (end < start) end = start;
        return { start: start + 1, span: Math.max(1, end - start + 1) };
    }

    function renderProjectLanes() {
        const container = query("#planningProjectLanes");
        Common.dom.clear(container);
        const selectedProjectId = selectedProjectFilterId();
        const projects = (scenario?.projects || []).filter((project) => (
            !selectedProjectId || String(project.projectId) === String(selectedProjectId)
        ));
        query("#planningEmptyState").hidden = projects.length > 0;
        projects.forEach((project) => {
            const lane = element("article", "planning-project-lane");
            lane.dataset.projectKey = project.clientKey;
            if (project.clientKey === selectedProjectKey) lane.classList.add("is-selected");
            lane.classList.add(`is-${String(project.bidDecisionCode || "review").toLowerCase()}`);

            const info = element("div", "planning-lane-info");
            const decision = element("span", "planning-lane-decision", BID_LABELS[project.bidDecisionCode] || "검토");
            const titleButton = element("button", "planning-lane-title", project.projectName);
            titleButton.type = "button";
            titleButton.dataset.action = "select-project";
            titleButton.dataset.projectKey = project.clientKey;
            const customer = element("span", "planning-card-subtitle", project.customerName);
            const financial = element("span", "planning-lane-financial", `${money(project.expectedContractAmount)} · ${number(project.winProbability)}%`);
            const addSelected = element("button", "button button-secondary button-small", selectedWorkerKey ? "선택 인력 배치" : "인력 선택 필요");
            addSelected.type = "button";
            addSelected.dataset.action = "add-selected-worker";
            addSelected.dataset.projectKey = project.clientKey;
            addSelected.disabled = !scenarioEditable() || !selectedWorkerKey;
            info.append(decision, titleButton, customer, financial, addSelected);

            const timeline = element("div", "planning-lane-timeline");
            timeline.dataset.projectKey = project.clientKey;
            timeline.setAttribute("aria-label", `${project.projectName} 인력 배치 영역`);
            yearMonths().forEach(() => timeline.appendChild(element("span", "planning-timeline-cell")));
            let visibleAssignmentCount = 0;
            (project.assignments || []).forEach((assignment) => {
                const amounts = assignmentAmounts(assignment);
                const position = assignmentTimelinePosition(assignment);
                if (!position) return;
                visibleAssignmentCount += 1;
                const card = element("button", "planning-assignment-card");
                card.type = "button";
                card.style.gridColumn = `${position.start} / span ${position.span}`;
                card.dataset.action = "select-assignment";
                card.dataset.assignmentKey = assignment.clientKey;
                card.setAttribute(
                    "aria-label",
                    `${assignment.employeeName || assignment.workerKey}, ${assignment.assignmentStartDate}부터 ${assignment.assignmentEndDate}까지, ${fixed(amounts.totalMm)} M/M`
                );
                if (assignment.clientKey === selectedAssignmentKey) card.classList.add("is-selected");
                card.append(
                    element("strong", "", assignment.employeeName || assignment.workerKey),
                    element("small", "", `${fixed(amounts.totalMm)} M · ${money(amounts.operatingProfit)}`)
                );
                timeline.appendChild(card);
            });
            if (!visibleAssignmentCount) {
                const hintText = (project.assignments || []).length
                    ? "선택 연도 밖의 배치가 있습니다. 상세 조정에서 기간을 확인하세요."
                    : "인력을 이곳에 놓으세요";
                const hint = element("span", "planning-drop-hint", hintText);
                hint.style.gridColumn = "1 / span 12";
                timeline.appendChild(hint);
            }
            lane.append(info, timeline);
            container.appendChild(lane);
        });
    }

    function renderScenarioOptions() {
        const select = query("#planningScenarioSelect");
        Common.dom.clear(select);
        const empty = element("option", "", scenarios.length ? "계획안 선택" : "등록된 계획안 없음");
        empty.value = "";
        select.appendChild(empty);
        scenarios.forEach((item) => {
            const option = element("option", "", `${item.scenarioName} · ${item.statusCode === "DRAFT" ? "임시" : "확정"}`);
            option.value = item.scenarioId;
            select.appendChild(option);
        });
        select.value = scenario?.scenarioId || "";
    }

    function renderAll() {
        query("#planningWorkspace").hidden = !scenario;
        renderScenarioOptions();
        renderMonthHeader();
        renderProjectPool();
        renderWorkerPool();
        renderProjectLanes();
        renderMetrics();
        renderInspector();
        updateToolbarState();
    }

    function renderInspector() {
        const projectForm = query("#planningProjectForm");
        const assignmentForm = query("#planningAssignmentForm");
        const empty = query("#planningInspectorEmpty");
        const assignmentContext = assignmentByKey(selectedAssignmentKey);
        const project = planningProject(selectedProjectKey);
        const readonly = !scenarioEditable();

        projectForm.hidden = true;
        assignmentForm.hidden = true;
        empty.hidden = Boolean(assignmentContext || project);
        if (assignmentContext) {
            assignmentForm.hidden = false;
            fillAssignmentInspector(assignmentContext.project, assignmentContext.assignment);
        } else if (project) {
            projectForm.hidden = false;
            fillProjectInspector(project);
        }
        [projectForm, assignmentForm].forEach((form) => {
            form.querySelectorAll("input, select, textarea, button").forEach((field) => {
                field.disabled = readonly;
            });
        });
    }

    function fillProjectInspector(project) {
        query("#planningProjectKey").value = project.clientKey;
        query("#planningProjectFormTitle").textContent = project.projectName;
        query("#planningBidDecision").value = project.bidDecisionCode || "REVIEW";
        query("#planningWinProbability").value = number(project.winProbability);
        query("#planningProjectStartDate").value = String(project.plannedStartDate || "").slice(0, 10);
        query("#planningProjectEndDate").value = String(project.plannedEndDate || "").slice(0, 10);
        query("#planningAnnouncementAmount").value = integerText(project.announcementAmount);
        query("#planningBidAmount").value = integerText(project.bidAmount);
        query("#planningExpectedContractAmount").value = integerText(project.expectedContractAmount);
        query("#planningTargetHeadcount").value = number(project.targetHeadcount);
        query("#planningProjectNote").value = project.note || "";
    }

    function fillAssignmentInspector(project, assignment) {
        query("#planningAssignmentKey").value = assignment.clientKey;
        query("#planningAssignmentFormTitle").textContent = assignment.employeeName || assignment.workerKey;
        query("#planningAssignmentCompany").textContent = `${assignment.companyName || "소속 미지정"} · ${project.projectName}`;
        query("#planningAssignmentStartDate").value = String(assignment.assignmentStartDate || "").slice(0, 10);
        query("#planningAssignmentEndDate").value = String(assignment.assignmentEndDate || "").slice(0, 10);
        query("#planningCostUnitPrice").value = integerText(assignment.costUnitPrice);
        query("#planningSalesUnitPrice").value = integerText(assignment.salesUnitPrice);
        query("#planningAssignmentNote").value = assignment.note || "";
        renderMonthEditor(assignment.monthlyAllocations || []);
    }

    function renderMonthEditor(allocations) {
        const editor = query("#planningMonthEditor");
        Common.dom.clear(editor);
        allocations.forEach((allocation) => {
            const label = element("label", "planning-month-input");
            label.appendChild(element("span", "", allocation.month));
            const input = element("input", "input");
            input.type = "number";
            input.min = "0";
            input.max = "1";
            input.step = "0.05";
            input.value = number(allocation.mm);
            input.dataset.month = allocation.month;
            label.appendChild(input);
            editor.appendChild(label);
        });
    }

    function syncMonthEditorToDates(fillValue = null) {
        const existing = new Map(
            [...query("#planningMonthEditor").querySelectorAll("input")]
                .map((input) => [input.dataset.month, number(input.value)])
        );
        const allocations = monthRange(
            query("#planningAssignmentStartDate").value,
            query("#planningAssignmentEndDate").value
        ).filter((month) => yearMonths().includes(month)).map((month) => ({
            month,
            mm: fillValue === null ? (existing.has(month) ? existing.get(month) : 1) : fillValue
        }));
        renderMonthEditor(allocations);
    }

    function setSelectedWorker(workerKey) {
        selectedWorkerKey = workerKey;
        const worker = workerByKey(workerKey);
        query("#planningWorkerSelection").textContent = worker
            ? `${worker.employeeName} 선택됨 · 프로젝트의 ‘선택 인력 배치’를 누르세요.`
            : "인력을 선택하거나 프로젝트로 끌어다 놓으세요.";
        renderWorkerPool();
        renderProjectLanes();
    }

    function addProject(projectId) {
        if (!scenarioEditable()) return;
        if (scenario.projects.some((item) => String(item.projectId) === String(projectId))) return;
        const reference = projectReference(projectId);
        if (!reference) return;
        const period = clippedPlanningPeriod(
            reference.projectStartDate,
            reference.projectEndDate
        );
        if (!period) {
            Common.ui.toast("선택한 사업은 현재 계획연도와 기간이 겹치지 않습니다.", "warning");
            return;
        }
        const project = {
            clientKey: nextClientKey("project"),
            projectId: Number(reference.projectId),
            projectName: reference.projectName,
            customerName: reference.customerName,
            projectStatusCode: reference.statusCode,
            bidDecisionCode: reference.statusCode === "BIDDING" ? "PARTICIPATE" : "REVIEW",
            winProbability: reference.statusCode === "CONTRACTED" ? 100 : 50,
            plannedStartDate: period.startDate,
            plannedEndDate: period.endDate,
            announcementAmount: integerText(reference.orderAmountVat),
            bidAmount: integerText(reference.contractAmountVat || reference.orderAmountVat),
            expectedContractAmount: integerText(reference.contractAmountVat || reference.orderAmountVat),
            targetHeadcount: 0,
            note: "",
            assignments: []
        };
        scenario.projects.push(project);
        selectedProjectKey = project.clientKey;
        selectedAssignmentKey = "";
        markDirty();
        renderAll();
        focusInspector();
    }

    function addAssignment(projectKey, workerKey) {
        if (!scenarioEditable()) return;
        const project = planningProject(projectKey);
        const worker = workerByKey(workerKey);
        if (!project || !worker) return;
        const existing = project.assignments.find((item) => item.workerKey === workerKey);
        if (existing) {
            selectedProjectKey = "";
            selectedAssignmentKey = existing.clientKey;
            renderAll();
            return;
        }
        const period = clippedPlanningPeriod(
            project.plannedStartDate,
            project.plannedEndDate
        );
        if (!period) {
            Common.ui.toast("프로젝트 예상기간이 현재 계획연도와 겹치지 않습니다.", "warning");
            return;
        }
        const startDate = worker.availableStartDate && worker.availableStartDate > period.startDate
            ? worker.availableStartDate
            : period.startDate;
        const endDate = worker.availableEndDate && worker.availableEndDate < period.endDate
            ? worker.availableEndDate
            : period.endDate;
        if (startDate > endDate) {
            Common.ui.toast("프로젝트 기간과 인력의 재직·계약기간이 겹치지 않습니다.", "warning");
            return;
        }
        const assignment = {
            clientKey: nextClientKey("assignment"),
            workerKey,
            employeeUserId: worker.userId || null,
            companyEmployeeId: worker.companyEmployeeId || null,
            employeeName: worker.employeeName,
            companyName: worker.companyName,
            workerTypeCode: worker.workerTypeCode,
            assignmentStartDate: startDate,
            assignmentEndDate: endDate,
            costUnitPrice: "0",
            salesUnitPrice: "0",
            note: "",
            monthlyAllocations: monthRange(startDate, endDate).map((month) => ({ month, mm: 1 }))
        };
        project.assignments.push(assignment);
        selectedProjectKey = "";
        selectedAssignmentKey = assignment.clientKey;
        markDirty();
        renderAll();
        focusInspector();
    }

    function applyProjectInputs({ showStatus = true } = {}) {
        const form = query("#planningProjectForm");
        if (!form.reportValidity()) return false;
        const project = planningProject(query("#planningProjectKey").value);
        if (!project) return false;
        const startDate = query("#planningProjectStartDate").value;
        const endDate = query("#planningProjectEndDate").value;
        if (startDate > endDate) {
            Common.ui.setInlineStatus(query("#planningStatus"), "프로젝트 예상기간을 확인해 주세요.", "error");
            return false;
        }
        const outsideAssignment = project.assignments.some((item) => (
            item.assignmentStartDate < startDate || item.assignmentEndDate > endDate
        ));
        if (outsideAssignment) {
            Common.ui.setInlineStatus(query("#planningStatus"), "기존 투입인력을 포함하도록 프로젝트 기간을 설정해 주세요.", "error");
            return false;
        }
        Object.assign(project, {
            bidDecisionCode: query("#planningBidDecision").value,
            winProbability: number(query("#planningWinProbability").value),
            plannedStartDate: startDate,
            plannedEndDate: endDate,
            announcementAmount: integerText(query("#planningAnnouncementAmount").value),
            bidAmount: integerText(query("#planningBidAmount").value),
            expectedContractAmount: integerText(query("#planningExpectedContractAmount").value),
            targetHeadcount: Math.round(number(query("#planningTargetHeadcount").value)),
            note: query("#planningProjectNote").value.trim()
        });
        markFormDirty(false);
        markDirty();
        renderAll();
        if (showStatus) {
            Common.ui.setInlineStatus(query("#planningStatus"), "프로젝트 조건을 계획안에 반영했습니다.", "success");
        }
        return true;
    }

    function applyProjectForm(event) {
        event.preventDefault();
        applyProjectInputs();
    }

    function applyAssignmentInputs({ showStatus = true } = {}) {
        const form = query("#planningAssignmentForm");
        if (!form.reportValidity()) return false;
        const context = assignmentByKey(query("#planningAssignmentKey").value);
        if (!context) return false;
        const startDate = query("#planningAssignmentStartDate").value;
        const endDate = query("#planningAssignmentEndDate").value;
        if (startDate > endDate) {
            Common.ui.setInlineStatus(query("#planningStatus"), "투입 종료일은 시작일보다 빠를 수 없습니다.", "error");
            return false;
        }
        const monthlyAllocations = [...query("#planningMonthEditor").querySelectorAll("input")].map((input) => ({
            month: input.dataset.month,
            mm: Math.max(0, Math.min(1, number(input.value)))
        }));
        Object.assign(context.assignment, {
            assignmentStartDate: startDate,
            assignmentEndDate: endDate,
            costUnitPrice: integerText(query("#planningCostUnitPrice").value),
            salesUnitPrice: integerText(query("#planningSalesUnitPrice").value),
            note: query("#planningAssignmentNote").value.trim(),
            monthlyAllocations
        });
        markFormDirty(false);
        markDirty();
        renderAll();
        if (showStatus) {
            Common.ui.setInlineStatus(query("#planningStatus"), "투입 조건을 계획안에 반영했습니다.", "success");
        }
        return true;
    }

    function applyAssignmentForm(event) {
        event.preventDefault();
        applyAssignmentInputs();
    }

    function commitInspectorForm() {
        if (!formDirty) return true;
        if (!query("#planningProjectForm").hidden) {
            return applyProjectInputs({ showStatus: false });
        }
        if (!query("#planningAssignmentForm").hidden) {
            return applyAssignmentInputs({ showStatus: false });
        }
        markFormDirty(false);
        return true;
    }

    async function removeProject() {
        const project = planningProject(query("#planningProjectKey").value);
        if (!project) return;
        if (!(await Common.ui.confirm(
            `${project.projectName}과 배치된 인력을 계획안에서 제외하시겠습니까?`,
            { title: "계획 대상 제외", confirmText: "제외", danger: true }
        ))) return;
        markFormDirty(false);
        scenario.projects = scenario.projects.filter((item) => item.clientKey !== project.clientKey);
        selectedProjectKey = "";
        selectedAssignmentKey = "";
        markDirty();
        renderAll();
    }

    function removeAssignment() {
        const context = assignmentByKey(query("#planningAssignmentKey").value);
        if (!context) return;
        markFormDirty(false);
        context.project.assignments = context.project.assignments.filter(
            (item) => item.clientKey !== context.assignment.clientKey
        );
        selectedAssignmentKey = "";
        markDirty();
        renderAll();
    }

    function scenarioPayload() {
        return {
            revisionNo: Number(scenario.revisionNo),
            scenarioName: scenario.scenarioName,
            description: scenario.description || "",
            projects: scenario.projects.map((project) => ({
                projectId: Number(project.projectId),
                bidDecisionCode: project.bidDecisionCode,
                winProbability: number(project.winProbability),
                plannedStartDate: project.plannedStartDate,
                plannedEndDate: project.plannedEndDate,
                announcementAmount: integerText(project.announcementAmount),
                bidAmount: integerText(project.bidAmount),
                expectedContractAmount: integerText(project.expectedContractAmount),
                targetHeadcount: Math.round(number(project.targetHeadcount)),
                note: project.note || "",
                assignments: project.assignments.map((assignment) => {
                    const workerType = String(assignment.workerKey).split(":")[0];
                    const workerId = Number(String(assignment.workerKey).split(":")[1]);
                    return {
                        employeeUserId: workerType === "USER" ? workerId : null,
                        companyEmployeeId: workerType === "COMPANY_EMPLOYEE" ? workerId : null,
                        assignmentStartDate: assignment.assignmentStartDate,
                        assignmentEndDate: assignment.assignmentEndDate,
                        costUnitPrice: integerText(assignment.costUnitPrice),
                        salesUnitPrice: integerText(assignment.salesUnitPrice),
                        monthlyAllocations: assignment.monthlyAllocations.map((month) => ({
                            month: month.month,
                            mm: number(month.mm)
                        })),
                        note: assignment.note || ""
                    };
                })
            }))
        };
    }

    async function loadScenario(scenarioId) {
        const requestId = ++scenarioRequestSequence;
        if (!scenarioId) {
            scenario = null;
            savedScenario = null;
            selectedProjectKey = "";
            selectedAssignmentKey = "";
            markDirty(false);
            markFormDirty(false);
            renderAll();
            return;
        }
        scenarioLoading = true;
        renderAll();
        try {
            const payload = await Common.api.request(`/planning/scenarios/${encodeURIComponent(scenarioId)}`, {
                signal: controller.signal,
                showLoading: false
            });
            if (requestId !== scenarioRequestSequence) return;
            scenario = normalizeScenario(Common.data.get(payload)?.scenario || null);
            savedScenario = cloneData(scenario);
            selectedProjectKey = "";
            selectedAssignmentKey = "";
            markDirty(false);
            markFormDirty(false);
        } finally {
            if (requestId === scenarioRequestSequence) {
                scenarioLoading = false;
                renderAll();
            }
        }
    }

    async function loadYear(preferredScenarioId = "") {
        const requestId = ++requestSequence;
        const planYear = Number(query("#planningYearSelect").value);
        scenarioLoading = true;
        renderAll();
        Common.ui.setInlineStatus(query("#planningStatus"), `${planYear}년 계획자료를 불러오고 있습니다.`);
        try {
            const [referencePayload, scenarioPayloadResult] = await Promise.all([
                Common.api.request(`/planning/scenarios/references?planYear=${encodeURIComponent(planYear)}`, {
                    signal: controller.signal,
                    showLoading: false
                }),
                Common.api.request(`/planning/scenarios?planYear=${encodeURIComponent(planYear)}`, {
                    signal: controller.signal,
                    showLoading: false
                })
            ]);
            if (requestId !== requestSequence) return;
            const referenceData = Common.data.get(referencePayload) || {};
            references = {
                projects: referenceData.projects || [],
                workers: referenceData.workers || [],
                actualCapacity: referenceData.actualCapacity || []
            };
            renderProjectFilterOptions();
            scenarios = Common.data.get(scenarioPayloadResult)?.scenarios || [];
            const targetId = preferredScenarioId || scenarios[0]?.scenarioId || "";
            if (targetId) await loadScenario(targetId);
            else {
                scenario = null;
                savedScenario = null;
                markDirty(false);
                markFormDirty(false);
                renderAll();
            }
            Common.ui.setInlineStatus(
                query("#planningStatus"),
                scenarios.length ? `${planYear}년 계획안을 불러왔습니다.` : "새 계획안을 만들어 시뮬레이션을 시작하세요.",
                scenarios.length ? "success" : ""
            );
        } catch (error) {
            if (error?.name === "AbortError" || requestId !== requestSequence) return;
            scenario = null;
            savedScenario = null;
            scenarios = [];
            references = { projects: [], workers: [], actualCapacity: [] };
            renderProjectFilterOptions();
            renderAll();
            Common.ui.setInlineStatus(query("#planningStatus"), error.message || "계획자료를 불러오지 못했습니다.", "error");
        } finally {
            if (requestId === requestSequence) {
                scenarioLoading = false;
                renderAll();
            }
        }
    }

    async function saveScenario(options = {}) {
        if (!scenarioEditable()) return false;
        if (!commitInspectorForm()) return false;
        if (!dirty) return true;
        const payload = await Common.api.request(`/planning/scenarios/${encodeURIComponent(scenario.scenarioId)}`, {
            method: "PUT",
            body: scenarioPayload(),
            signal: controller.signal,
            loadingMessage: "계획안을 저장하고 있습니다."
        });
        const data = Common.data.get(payload) || {};
        scenario.revisionNo = data.revisionNo || scenario.revisionNo + 1;
        markDirty(false);
        savedScenario = cloneData(scenario);
        await loadScenario(scenario.scenarioId);
        if (!options.silent) Common.ui.toast("연간 사업·인력계획을 저장했습니다.", "success");
        return true;
    }

    async function confirmScenario() {
        if (!scenarioEditable()) return;
        if (hasPendingChanges() && !(await saveScenario({ silent: true }))) return;
        const summary = calculateScenario();
        const warningText = summary.warnings.length
            ? ` 계획 위험 ${summary.warnings.length}건이 남아 있습니다.`
            : "";
        if (!(await Common.ui.confirm(
            `이 계획안을 최종 확정하시겠습니까?${warningText} 확정 후에는 수정할 수 없습니다.`,
            { title: "계획안 최종 확정", confirmText: "최종 확정", danger: summary.warnings.length > 0 }
        ))) return;
        await Common.api.request(`/planning/scenarios/${encodeURIComponent(scenario.scenarioId)}/confirm`, {
            method: "POST",
            body: {
                revisionNo: Number(scenario.revisionNo),
                acknowledgeWarnings: summary.warnings.length > 0,
                warningSignature: scenario.warningSignature || null
            },
            signal: controller.signal,
            loadingMessage: "계획안을 확정하고 있습니다."
        });
        await loadYear(scenario.scenarioId);
        Common.ui.toast("연간 사업·인력계획을 최종 확정했습니다.", "success");
    }

    async function deleteScenario() {
        if (!scenarioEditable()) return;
        if (!(await Common.ui.confirm(
            `${scenario.scenarioName} 계획안을 삭제하시겠습니까?`,
            { title: "계획안 삭제", confirmText: "삭제", danger: true }
        ))) return;
        await Common.api.request(`/planning/scenarios/${encodeURIComponent(scenario.scenarioId)}?revisionNo=${encodeURIComponent(scenario.revisionNo)}`, {
            method: "DELETE",
            signal: controller.signal,
            loadingMessage: "계획안을 삭제하고 있습니다."
        });
        scenario = null;
        savedScenario = null;
        await loadYear();
        Common.ui.toast("계획안을 삭제했습니다.", "success");
    }

    async function openScenarioDialog() {
        const year = Number(query("#planningYearSelect").value);
        query("#planningScenarioForm").reset();
        query("#planningScenarioYear").value = year;
        query("#planningScenarioName").value = `${year} 기준 계획안`;
        Common.ui.setInlineStatus(query("#planningScenarioDialogStatus"), "");
        query("#planningScenarioDialog").showModal();
        query("#planningScenarioName").focus();
    }

    function closeScenarioDialog() {
        query("#planningScenarioDialog").close();
    }

    async function createScenario(event) {
        event.preventDefault();
        if (!event.currentTarget.reportValidity()) return;
        try {
            const planYear = Number(query("#planningScenarioYear").value);
            const payload = await Common.api.request("/planning/scenarios", {
                method: "POST",
                body: {
                    planYear,
                    scenarioName: query("#planningScenarioName").value.trim(),
                    description: query("#planningScenarioDescription").value.trim()
                },
                signal: controller.signal,
                loadingMessage: "새 계획안을 만들고 있습니다."
            });
            const scenarioId = Common.data.get(payload)?.scenarioId;
            closeScenarioDialog();
            query("#planningYearSelect").value = String(planYear);
            await loadYear(scenarioId);
            Common.ui.toast("새 계획안을 만들었습니다.", "success");
        } catch (error) {
            Common.ui.setInlineStatus(query("#planningScenarioDialogStatus"), error.message || "계획안을 만들지 못했습니다.", "error");
        }
    }

    function discardWorkingChanges() {
        scenario = cloneData(savedScenario);
        selectedProjectKey = "";
        selectedAssignmentKey = "";
        dirty = false;
        formDirty = false;
        renderAll();
        updateDirtyState();
    }

    async function canDiscardChanges() {
        if (!hasPendingChanges()) return true;
        const confirmed = await Common.ui.confirm(
            "저장하지 않은 계획 변경사항이 있습니다. 저장하지 않고 다른 화면으로 이동하시겠습니까?",
            { title: "변경사항 확인", confirmText: "저장하지 않고 이동", danger: true }
        );
        if (confirmed) discardWorkingChanges();
        return confirmed;
    }

    function dragPayload(event) {
        try {
            return JSON.parse(event.dataTransfer?.getData("text/plain") || "null");
        } catch (_error) {
            return null;
        }
    }

    function handleDragStart(event) {
        const projectCard = event.target.closest(".planning-project-card[data-project-id]");
        const workerCard = event.target.closest(".planning-worker-card[data-worker-key]");
        if (!scenarioEditable() || (!projectCard && !workerCard)) return;
        const payload = projectCard
            ? { kind: "project", key: projectCard.dataset.projectId }
            : { kind: "worker", key: workerCard.dataset.workerKey };
        activeDragKind = payload.kind;
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", JSON.stringify(payload));
    }

    function handleDragEnd() {
        activeDragKind = "";
        root?.querySelectorAll(".planning-project-lane.is-drag-over").forEach((lane) => {
            lane.classList.remove("is-drag-over");
        });
    }

    function handleDragOver(event) {
        const lane = event.target.closest(".planning-project-lane");
        if (!scenarioEditable()) return;
        if (lane || (activeDragKind === "project" && event.target.closest(".planning-canvas"))) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            lane?.classList.add("is-drag-over");
        }
    }

    function handleDragLeave(event) {
        const lane = event.target.closest(".planning-project-lane");
        if (lane && !lane.contains(event.relatedTarget)) lane.classList.remove("is-drag-over");
    }

    function handleDrop(event) {
        if (!scenarioEditable()) return;
        const payload = dragPayload(event);
        const lane = event.target.closest(".planning-project-lane");
        if (!payload) return;
        event.preventDefault();
        lane?.classList.remove("is-drag-over");
        if (!commitInspectorForm()) return;
        if (payload.kind === "project") addProject(payload.key);
        if (payload.kind === "worker" && lane) addAssignment(lane.dataset.projectKey, payload.key);
        activeDragKind = "";
    }

    function handlePoolClick(event) {
        const addButton = event.target.closest("[data-action='add-project']");
        if (addButton && commitInspectorForm()) addProject(addButton.dataset.projectId);
        const workerCard = event.target.closest(".planning-worker-card[data-worker-key]");
        if (workerCard) setSelectedWorker(workerCard.dataset.workerKey);
    }

    function handleLaneClick(event) {
        const action = event.target.closest("[data-action]");
        if (!action) return;
        if (!commitInspectorForm()) return;
        if (action.dataset.action === "select-project") {
            selectedProjectKey = action.dataset.projectKey;
            selectedAssignmentKey = "";
            renderAll();
            focusInspector();
        } else if (action.dataset.action === "select-assignment") {
            selectedAssignmentKey = action.dataset.assignmentKey;
            selectedProjectKey = "";
            renderAll();
            focusInspector();
        } else if (action.dataset.action === "add-selected-worker") {
            addAssignment(action.dataset.projectKey, selectedWorkerKey);
        }
    }

    function focusInspector() {
        requestAnimationFrame(() => {
            const target = query(".planning-inspector-form:not([hidden]) h4");
            if (!target) return;
            target.setAttribute("tabindex", "-1");
            target.focus({ preventScroll: window.matchMedia("(min-width: 1621px)").matches });
        });
    }

    function beforeUnload(event) {
        if (!hasPendingChanges()) return;
        event.preventDefault();
        event.returnValue = "";
    }

    function bindEvents() {
        query("#planningYearSelect").addEventListener("change", async (event) => {
            scenario = null;
            await loadYear();
        }, { signal: controller.signal });
        query("#planningScenarioSelect").addEventListener("change", async (event) => {
            const nextScenarioId = event.target.value;
            try {
                await loadScenario(nextScenarioId);
                Common.ui.setInlineStatus(query("#planningStatus"), "계획안을 불러왔습니다.", "success");
            } catch (error) {
                if (error?.name === "AbortError") return;
                event.target.value = scenario?.scenarioId || "";
                Common.ui.setInlineStatus(
                    query("#planningStatus"),
                    error.message || "계획안을 불러오지 못했습니다.",
                    "error"
                );
            }
        }, { signal: controller.signal });
        query("#planningProjectFilter").addEventListener("change", () => {
            selectedProjectKey = "";
            selectedAssignmentKey = "";
            renderProjectPool();
            renderProjectLanes();
            renderInspector();
        }, { signal: controller.signal });
        query("#planningProjectSearch").addEventListener("input", renderProjectPool, { signal: controller.signal });
        query("#planningWorkerSearch").addEventListener("input", renderWorkerPool, { signal: controller.signal });
        query("#planningWorkerType").addEventListener("change", renderWorkerPool, { signal: controller.signal });
        query("#planningProjectPool").addEventListener("click", handlePoolClick, { signal: controller.signal });
        query("#planningWorkerPool").addEventListener("click", handlePoolClick, { signal: controller.signal });
        query("#planningProjectLanes").addEventListener("click", handleLaneClick, { signal: controller.signal });
        query("#planningProjectPool").addEventListener("dragstart", handleDragStart, { signal: controller.signal });
        query("#planningWorkerPool").addEventListener("dragstart", handleDragStart, { signal: controller.signal });
        query("#planningProjectPool").addEventListener("dragend", handleDragEnd, { signal: controller.signal });
        query("#planningWorkerPool").addEventListener("dragend", handleDragEnd, { signal: controller.signal });
        query("#planningCanvasTitle").closest(".planning-canvas").addEventListener("dragover", handleDragOver, { signal: controller.signal });
        query("#planningCanvasTitle").closest(".planning-canvas").addEventListener("dragleave", handleDragLeave, { signal: controller.signal });
        query("#planningCanvasTitle").closest(".planning-canvas").addEventListener("drop", handleDrop, { signal: controller.signal });
        query("#planningProjectForm").addEventListener("submit", applyProjectForm, { signal: controller.signal });
        query("#planningAssignmentForm").addEventListener("submit", applyAssignmentForm, { signal: controller.signal });
        query("#planningAssignmentStartDate").addEventListener("change", () => syncMonthEditorToDates(), { signal: controller.signal });
        query("#planningAssignmentEndDate").addEventListener("change", () => syncMonthEditorToDates(), { signal: controller.signal });
        query("#planningFillMonthsButton").addEventListener("click", () => {
            syncMonthEditorToDates(1);
            markFormDirty();
        }, { signal: controller.signal });
        query("#planningRemoveProjectButton").addEventListener("click", () => removeProject().catch((error) => Common.ui.toast(error.message, "error")), { signal: controller.signal });
        query("#planningRemoveAssignmentButton").addEventListener("click", removeAssignment, { signal: controller.signal });
        query("#planningNewScenarioButton").addEventListener("click", () => {
            openScenarioDialog().catch((error) => {
                Common.ui.setInlineStatus(query("#planningStatus"), error.message, "error");
            });
        }, { signal: controller.signal });
        query("#planningSaveButton").addEventListener("click", () => saveScenario().catch((error) => Common.ui.setInlineStatus(query("#planningStatus"), error.message, "error")), { signal: controller.signal });
        query("#planningConfirmButton").addEventListener("click", () => confirmScenario().catch((error) => Common.ui.setInlineStatus(query("#planningStatus"), error.message, "error")), { signal: controller.signal });
        query("#planningDeleteScenarioButton").addEventListener("click", () => deleteScenario().catch((error) => Common.ui.setInlineStatus(query("#planningStatus"), error.message, "error")), { signal: controller.signal });
        query("#planningScenarioForm").addEventListener("submit", createScenario, { signal: controller.signal });
        query("#planningScenarioDialogClose").addEventListener("click", closeScenarioDialog, { signal: controller.signal });
        query("#planningScenarioCancelButton").addEventListener("click", closeScenarioDialog, { signal: controller.signal });
        [query("#planningProjectForm"), query("#planningAssignmentForm")].forEach((form) => {
            form.addEventListener("input", () => markFormDirty(), { signal: controller.signal });
        });
        window.addEventListener("beforeunload", beforeUnload, { signal: controller.signal });
    }

    function initializeYears(preferredYear) {
        const select = query("#planningYearSelect");
        Common.dom.clear(select);
        const currentYear = new Date().getFullYear();
        for (let year = currentYear - 1; year <= currentYear + 4; year += 1) {
            const option = element("option", "", `${year}년`);
            option.value = year;
            select.appendChild(option);
        }
        const requestedYear = Number(preferredYear);
        const planYear = Number.isInteger(requestedYear) && requestedYear >= 1900 && requestedYear <= 2100
            ? requestedYear
            : currentYear + 1;
        if (!Array.from(select.options).some((option) => Number(option.value) === planYear)) {
            const option = element("option", "", `${planYear}년`);
            option.value = planYear;
            select.appendChild(option);
        }
        select.value = String(planYear);
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            root = context.root;
            controller = new AbortController();
            scenarioLoading = false;
            initializeYears(context.routeContext?.planYear);
            bindEvents();
            renderAll();
            await loadYear(context.routeContext?.scenarioId || "");
            const requestedProjectId = context.routeContext?.projectId;
            const requestedProject = scenario?.projects?.find((item) => String(item.projectId) === String(requestedProjectId));
            if (requestedProject) {
                selectedProjectKey = requestedProject.clientKey;
                selectedAssignmentKey = "";
                renderAll();
                focusInspector();
            }
        },
        beforeLeave() {
            return canDiscardChanges();
        },
        hasUnsavedChanges() {
            return hasPendingChanges();
        },
        discardChanges() {
            discardWorkingChanges();
        },
        async activate(context = {}) {
            if (!root || hasPendingChanges()) return;
            const requestedYear = Number(context.routeContext?.planYear);
            if (
                Number.isInteger(requestedYear)
                && requestedYear >= 1900
                && requestedYear <= 2100
                && String(requestedYear) !== query("#planningYearSelect").value
            ) {
                initializeYears(requestedYear);
                await loadYear();
            }
        },
        destroy() {
            controller?.abort();
            controller = null;
            root = null;
            references = { projects: [], workers: [], actualCapacity: [] };
            scenarios = [];
            scenario = null;
            savedScenario = null;
            selectedWorkerKey = "";
            selectedProjectKey = "";
            selectedAssignmentKey = "";
            dirty = false;
            formDirty = false;
            activeDragKind = "";
            scenarioLoading = false;
            requestSequence += 1;
            scenarioRequestSequence += 1;
        }
    };
})();
