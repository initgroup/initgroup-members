(function() {
    "use strict";

    const PAGE_NAME = "workforce-management";
    const COMPONENTS = {
        confirmed: { pageCode: "project-detail-editor", title: "프로젝트 상세 편집" }
    };
    const MONTH_COUNT = 12;
    const GENDER_LABELS = { MALE: "남성", FEMALE: "여성", OTHER: "기타", UNDISCLOSED: "미공개" };
    const TECHNICAL_GRADE_LABELS = {
        PROFESSIONAL_ENGINEER: "기술사", SPECIAL: "특급", ADVANCED: "고급",
        INTERMEDIATE: "중급", BEGINNER: "초급"
    };

    let root = null;
    let controller = null;
    let pageContext = null;
    let annualRateReturnYear = null;
    let requestSequence = 0;
    let confirmedData = { projects: [], assignments: [], companies: [] };
    let references = { workers: [], actualCapacity: [] };
    let scenarios = [];
    let scenario = null;
    let projectFilter = "all";
    let boardBasis = "project-status";
    let editorEntry = null;
    let editorOpening = false;
    let establishmentYear = null;
    let boardView = "project";
    let projectSort = "start";
    let projectDisplay = "summary";
    let projectExpansion = new Map();
    let workerDisplay = "individual";
    let departments = [];
    let workerTypeFilter = "";
    let workerNameFilter = "";
    let boardZoom = 1;
    let boardRangeMode = "default";
    let editMode = false;
    let mutationBusy = false;
    let maximized = false;
    let quickContext = null;
    let quickMonthDragHandle = "";
    let quickMonthlyAllocations = new Map();
    let quickDialogDrag = null;
    let workerDetailDrag = null;
    let editDrafts = [];
    let editDraftSequence = 0;
    let editOrders = new Map();
    let editRemovals = new Map();
    let activeBoardDrag = null;
    let renderCalculationCache = null;
    let detailLayer = null;

    function query(selector) {
        return root?.querySelector(selector) || null;
    }

    function element(tagName, className = "", text = "") {
        const node = document.createElement(tagName);
        if (className) node.className = className;
        if (text !== "") node.textContent = text;
        return node;
    }

    function pick(row, ...keys) {
        return Common.data.pick(row, ...keys);
    }

    function populateWorkerFilterOptions() {
        const validValues = new Set(["ALL", "INTERNAL", "INTERNAL_REGULAR", "INTERNAL_NON_REGULAR", "PARTNER", ...departments.map((department) => String(department.code))]);
        const selectedValue = validValues.has(workerTypeFilter) ? workerTypeFilter : "INTERNAL_REGULAR";
        ["#workforceManagementWorkerType", "#workforceManagementMatrixWorkerType"].forEach((selector) => {
            const select = query(selector);
            if (!select) return;
            select.replaceChildren();
            [
                { value: "ALL", label: "-전체인력-" },
                { value: "INTERNAL", label: "내부 임직원(전체)" },
                { value: "INTERNAL_REGULAR", label: "내부 임직원(정규직)" },
                { value: "INTERNAL_NON_REGULAR", label: "내부 임직원(정규직외)" },
                ...departments.map((department) => ({ value: String(department.code), label: String(department.label) })),
                { value: "PARTNER", label: "협력업체" }
            ].forEach((item) => {
                const option = element("option", "", item.label);
                option.value = item.value;
                select.appendChild(option);
            });
            select.value = selectedValue;
        });
        workerTypeFilter = selectedValue;
    }

    function number(value) {
        return Number(value || 0);
    }

    function fixed(value) {
        return number(value).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
    }

    function integerText(value) {
        return String(value ?? 0).replace(/[^0-9]/g, "") || "0";
    }

    function dateText(value) {
        return String(value || "").slice(0, 10);
    }

    function calculatedAge(birthDate) {
        const normalized = dateText(birthDate);
        if (!normalized) return null;
        const [year, month, day] = normalized.split("-").map(Number);
        const today = new Date();
        let age = today.getFullYear() - year;
        if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
        return age >= 0 ? age : null;
    }

    function workerPhoto(worker, detail = false) {
        const frame = element("div", detail ? "workforce-management-worker-photo is-detail" : "workforce-management-worker-photo");
        const employeeName = String(pick(worker, "employeeName", "EMPLOYEE_NAME") || "인력");
        const placeholder = element("span", "", "사진 없음");
        frame.appendChild(placeholder);
        const userId = pick(worker, "userId", "USER_ID");
        const hasPhoto = Boolean(pick(worker, "photoFileName", "PHOTO_FILE_NAME"));
        if (!userId || !hasPhoto) return frame;
        const image = element("img");
        image.alt = `${employeeName} 프로필 사진`;
        image.loading = detail ? "eager" : "lazy";
        image.decoding = "async";
        image.fetchPriority = detail ? "high" : "low";
        image.src = `/api/admin/users/${encodeURIComponent(userId)}/photo?thumbnail=true&v=${encodeURIComponent(pick(worker, "photoUpdatedAt", "PHOTO_UPDATED_AT") || "")}`;
        image.addEventListener("load", () => { placeholder.hidden = true; });
        image.addEventListener("error", () => { image.remove(); placeholder.hidden = false; });
        frame.prepend(image);
        return frame;
    }

    function appendWorkerDetailField(list, label, value) {
        const group = element("div");
        group.append(element("dt", "", label), element("dd", "", value === null || value === undefined || value === "" ? "-" : String(value)));
        list.appendChild(group);
    }

    function openWorkerDetail(worker) {
        const dialog = query("#workforceManagementWorkerDetailDialog");
        const name = pick(worker, "employeeName", "EMPLOYEE_NAME") || "이름 미정";
        const genderCode = String(pick(worker, "genderCode", "GENDER_CODE") || "").toUpperCase();
        const gradeCode = String(pick(worker, "technicalGradeCode", "TECHNICAL_GRADE_CODE") || "").toUpperCase();
        const isInternal = String(worker.workerKey || "").startsWith("USER:");
        const birthDate = pick(worker, "birthDate", "BIRTH_DATE");
        const age = pick(worker, "ageYears", "AGE_YEARS") ?? calculatedAge(birthDate);
        query("#workforceManagementWorkerDetailTitle").textContent = `${name} 상세정보`;
        query("#workforceManagementWorkerDetailSubtitle").textContent = [pick(worker, "companyName", "COMPANY_NAME"), pick(worker, "departmentName", "DEPARTMENT_NAME")].filter(Boolean).join(" · ") || "소속 정보 없음";
        query("#workforceManagementWorkerDetailPhoto").replaceChildren(workerPhoto(worker, true));
        const fields = query("#workforceManagementWorkerDetailFields");
        fields.replaceChildren();
        appendWorkerDetailField(fields, "구분", isInternal ? "내부 임직원" : "협력업체 인력");
        appendWorkerDetailField(fields, "사번", pick(worker, "employeeNo", "EMPLOYEE_NO"));
        appendWorkerDetailField(fields, "성별", GENDER_LABELS[genderCode]);
        appendWorkerDetailField(fields, "만 나이", age === null ? null : `${age}세`);
        appendWorkerDetailField(fields, "기술등급", TECHNICAL_GRADE_LABELS[gradeCode]);
        appendWorkerDetailField(fields, "경력월수", pick(worker, "careerMonths", "CAREER_MONTHS") === null || pick(worker, "careerMonths", "CAREER_MONTHS") === undefined ? null : `${pick(worker, "careerMonths", "CAREER_MONTHS")}개월`);
        appendWorkerDetailField(fields, "부서", pick(worker, "departmentName", "DEPARTMENT_NAME"));
        appendWorkerDetailField(fields, "직급", pick(worker, "positionName", "POSITION_NAME"));
        appendWorkerDetailField(fields, "직책", pick(worker, "jobTitle", "JOB_TITLE"));
        appendWorkerDetailField(fields, "이메일", pick(worker, "email", "EMAIL"));
        appendWorkerDetailField(fields, "휴대전화", pick(worker, "mobilePhone", "MOBILE_PHONE"));
        if (isInternal) appendWorkerDetailField(fields, "근무지", pick(worker, "workLocation", "WORK_LOCATION"));
        dialog.dataset.dragX = "0";
        dialog.dataset.dragY = "0";
        dialog.style.setProperty("--workforce-worker-detail-x", "0px");
        dialog.style.setProperty("--workforce-worker-detail-y", "0px");
        dialog.showModal();
    }

    function closeWorkerDetail() {
        query("#workforceManagementWorkerDetailDialog")?.close();
        workerDetailDrag = null;
    }

    function handleWorkerDetailPointerDown(event) {
        if (event.target.closest("button, input, select, textarea, a")) return;
        const dialog = query("#workforceManagementWorkerDetailDialog");
        workerDetailDrag = {
            startX: event.clientX, startY: event.clientY,
            baseX: Number(dialog.dataset.dragX || 0), baseY: Number(dialog.dataset.dragY || 0)
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.currentTarget.classList.add("is-dragging");
        event.preventDefault();
    }

    function handleWorkerDetailPointerMove(event) {
        if (!workerDetailDrag) return;
        const dialog = query("#workforceManagementWorkerDetailDialog");
        const nextX = workerDetailDrag.baseX + event.clientX - workerDetailDrag.startX;
        const nextY = workerDetailDrag.baseY + event.clientY - workerDetailDrag.startY;
        dialog.dataset.dragX = String(nextX);
        dialog.dataset.dragY = String(nextY);
        dialog.style.setProperty("--workforce-worker-detail-x", `${nextX}px`);
        dialog.style.setProperty("--workforce-worker-detail-y", `${nextY}px`);
    }

    function handleWorkerDetailPointerUp(event) {
        if (!workerDetailDrag) return;
        workerDetailDrag = null;
        event.currentTarget.classList.remove("is-dragging");
        event.currentTarget.releasePointerCapture?.(event.pointerId);
    }

    function lastDateOfMonth(month) {
        const [year, monthNumber] = String(month).split("-").map(Number);
        return new Date(year, monthNumber, 0).toISOString().slice(0, 10);
    }

    function addMonths(month, offset) {
        const [year, monthNumber] = String(month).split("-").map(Number);
        const date = new Date(year, monthNumber - 1 + offset, 1);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    function workerByKey(key) {
        return referenceWorkers().find((worker) => String(worker.workerKey) === String(key)) || null;
    }

    function laneByKey(key) {
        return allLanes().find((lane) => lane.key === key) || null;
    }

    function boardAssignments(lane) {
        const preview = quickContext?.preview;
        const drafts = editDrafts.filter((draft) => draft.laneKey === lane.key);
        const source = [...lane.assignments, ...drafts];
        const order = editOrders.get(lane.key) || [];
        const byIdentity = new Map(source.map((assignment) => [assignmentIdentity(lane, assignment), assignment]));
        const assignments = order.length
            ? [...order.map((identity) => byIdentity.get(identity)).filter(Boolean), ...source.filter((assignment) => !order.includes(assignmentIdentity(lane, assignment)))]
            : source;
        return preview && quickContext.laneKey === lane.key ? [...assignments, preview] : assignments;
    }

    function isEditDraft(assignment) {
        return String(pick(assignment, "draftYn", "DRAFT_YN") || "") === "Y" && Boolean(assignment.editDraftKey);
    }

    function isPendingRemoval(identity) {
        return editRemovals.has(String(identity || ""));
    }

    function mainEditChangeCount() {
        return editDrafts.length + editOrders.size + editRemovals.size;
    }

    function hasMainEditChanges() {
        return mainEditChangeCount() > 0 || Boolean(quickContext);
    }

    function discardMainEditChanges({ render = true } = {}) {
        if (quickContext) closeQuickDialog();
        editDrafts = [];
        editDraftSequence = 0;
        editOrders.clear();
        editRemovals.clear();
        activeBoardDrag = null;
        clearBoardDragFeedback();
        syncEditDraftControls();
        if (render) renderAll();
    }

    function toggleAssignmentRemoval(identity) {
        if (!identity || !editMode || boardView !== "project") return;
        const key = String(identity);
        if (key.startsWith("draft:")) {
            removeEditDraft(key.slice(6));
            Common.ui.setInlineStatus(query("#workforceManagementBoardStatus"), "편집중 투입을 취소했습니다.", "success");
            return;
        }
        const context = assignmentContext(key);
        if (!context) throw new Error("해제할 투입정보를 찾지 못했습니다.");
        if (editRemovals.has(key)) {
            editRemovals.delete(key);
            syncEditDraftControls(`${employeeName(context.assignment)}의 투입 해제를 취소했습니다.`, "success");
        } else {
            editRemovals.set(key, { laneKey: context.lane.key });
            syncEditDraftControls(`${employeeName(context.assignment)}을(를) 투입 해제 대상으로 표시했습니다. 변경사항 저장을 눌러 반영해 주세요.`, "success");
        }
        withRenderCalculationCache(() => {
            renderWorkers();
            renderLanes();
        });
    }

    function syncEditDraftControls(message = "", type = "") {
        const button = query("#workforceManagementApplyDraftsButton");
        const changeCount = mainEditChangeCount();
        if (button) {
            button.hidden = !editMode || boardView !== "project" || changeCount === 0;
            button.disabled = mutationBusy || changeCount === 0;
            button.textContent = changeCount ? `변경사항 저장 (${changeCount})` : "변경사항 저장";
        }
        root?.querySelectorAll("[data-workforce-saved-refresh]").forEach((refreshButton) => {
            refreshButton.disabled = mutationBusy;
        });
        if (message) Common.ui.setInlineStatus(query("#workforceManagementBoardStatus"), message, type);
    }

    function naturalLaneIdentities(lane) {
        return [...lane.assignments, ...editDrafts.filter((draft) => draft.laneKey === lane.key)]
            .map((assignment) => assignmentIdentity(lane, assignment));
    }

    function removeIdentityFromOrder(laneKey, identity) {
        const order = editOrders.get(laneKey);
        if (!order) return;
        const next = order.filter((item) => item !== identity);
        if (next.length) editOrders.set(laneKey, next);
        else editOrders.delete(laneKey);
    }

    function normalizeLaneOrder(laneKey) {
        const lane = laneByKey(laneKey);
        const order = editOrders.get(laneKey);
        if (!lane || !order) return;
        if (order.join("|") === naturalLaneIdentities(lane).join("|")) editOrders.delete(laneKey);
    }

    function isPendingOrderChange(lane, identity) {
        if (!lane || !identity || String(identity).startsWith("draft:") || isPendingRemoval(identity)) return false;
        const order = editOrders.get(lane.key);
        if (!order) return false;
        const natural = naturalLaneIdentities(lane);
        return order.indexOf(identity) !== natural.indexOf(identity);
    }

    function stageLaneOrder(lane, identity, insertIndex) {
        if (!lane || !identity) return false;
        const current = boardAssignments(lane)
            .filter((assignment) => !quickContext?.preview || assignment !== quickContext.preview)
            .map((assignment) => assignmentIdentity(lane, assignment));
        const withoutMoving = current.filter((item) => item !== identity);
        const targetIndex = Math.max(0, Math.min(Number(insertIndex) || 0, withoutMoving.length));
        withoutMoving.splice(targetIndex, 0, identity);
        if (withoutMoving.join("|") === current.join("|")) return false;
        const natural = naturalLaneIdentities(lane);
        if (withoutMoving.join("|") === natural.join("|")) editOrders.delete(lane.key);
        else editOrders.set(lane.key, withoutMoving);
        syncEditDraftControls();
        return true;
    }

    function removeEditDraft(draftKey, { render = true } = {}) {
        const identity = `draft:${draftKey}`;
        editOrders.forEach((_order, laneKey) => removeIdentityFromOrder(laneKey, identity));
        editDrafts = editDrafts.filter((draft) => draft.editDraftKey !== draftKey);
        [...editOrders.keys()].forEach(normalizeLaneOrder);
        syncEditDraftControls();
        if (render) renderAll();
    }

    function stageWorkerDraft(lane, workerKeyValue, insertIndex = Number.MAX_SAFE_INTEGER) {
        const worker = workerByKey(workerKeyValue);
        if (!lane || !worker) throw new Error("배치할 프로젝트 또는 인력을 찾지 못했습니다.");
        const eligibility = workerCompanyEligibility(lane, worker);
        if (!eligibility.valid) {
            Common.ui.toast(`${employeeName(worker)}: ${eligibility.reason}`, "warning");
            syncEditDraftControls(`${employeeName(worker)}을(를) 배치할 수 없습니다. ${eligibility.reason}`, "error");
            return null;
        }
        const duplicate = boardAssignments(lane).find((assignment) => workerKey(assignment) === workerKeyValue);
        if (duplicate) {
            const duplicateIdentity = assignmentIdentity(lane, duplicate);
            if (isPendingRemoval(duplicateIdentity)) {
                editRemovals.delete(duplicateIdentity);
                renderAll();
                syncEditDraftControls(`${employeeName(duplicate)}의 투입 해제를 취소했습니다.`, "success");
                return duplicate;
            }
            if (isEditDraft(duplicate)) openQuickEdit(`draft:${duplicate.editDraftKey}`);
            else Common.ui.toast("이미 이 프로젝트에 배치된 인력입니다. 기존 인력 박스에서 기간을 수정해 주세요.", "warning");
            return null;
        }
        const startDate = dateText(lane.startDate);
        const endDate = dateText(lane.endDate);
        const monthlyAllocations = monthsBetween(startDate, endDate).map((month) => ({ month, mm: 1 }));
        const draft = {
            editDraftKey: `edit-draft-${Date.now()}-${++editDraftSequence}`,
            clientKey: `edit-draft-${Date.now()}-${editDraftSequence}`,
            draftYn: "Y",
            laneKey: lane.key,
            laneType: lane.type,
            projectId: lane.projectId,
            scenarioProjectId: lane.scenarioProjectId,
            workerKey: workerKeyValue,
            employeeName: employeeName(worker),
            companyName: pick(worker, "companyName", "COMPANY_NAME") || "소속 미정",
            assignmentStartDate: startDate,
            assignmentEndDate: endDate,
            assignmentStatusCode: assignmentStatusCode(lane, {}),
            allocationTypeCode: "MONTHLY",
            defaultMm: 1,
            monthlyAllocations,
            totalMm: monthlyAllocations.length,
            costUnitPrice: "0",
            salesUnitPrice: "0",
            projectRoleName: "",
            primaryDuty: "",
            note: ""
        };
        editDrafts.push(draft);
        stageLaneOrder(lane, `draft:${draft.editDraftKey}`, insertIndex);
        renderAll();
        syncEditDraftControls(`${employeeName(worker)}을(를) ${lane.name} 전체 기간에 편집중으로 추가했습니다.`, "success");
        return draft;
    }

    function moveEditDraftToLane(draftKey, lane, insertIndex = Number.MAX_SAFE_INTEGER) {
        const draft = editDrafts.find((item) => item.editDraftKey === draftKey);
        if (!draft || !lane) return;
        const identity = `draft:${draftKey}`;
        if (draft.laneKey === lane.key) {
            if (stageLaneOrder(lane, identity, insertIndex)) {
                renderAll();
                syncEditDraftControls(`${draft.employeeName}의 배치 순서를 변경했습니다.`, "success");
            }
            return;
        }
        const duplicate = boardAssignments(lane).find((assignment) => (
            workerKey(assignment) === draft.workerKey
            && assignment !== draft
        ));
        if (duplicate) {
            Common.ui.toast("이미 이 프로젝트에 같은 인력이 배치되어 있습니다.", "warning");
            return;
        }
        const previousLaneKey = draft.laneKey;
        const startDate = dateText(lane.startDate);
        const endDate = dateText(lane.endDate);
        const monthlyAllocations = monthsBetween(startDate, endDate).map((month) => ({ month, mm: 1 }));
        Object.assign(draft, {
            laneKey: lane.key,
            laneType: lane.type,
            projectId: lane.projectId,
            scenarioProjectId: lane.scenarioProjectId,
            assignmentStartDate: startDate,
            assignmentEndDate: endDate,
            assignmentStatusCode: assignmentStatusCode(lane, {}),
            monthlyAllocations,
            totalMm: monthlyAllocations.length
        });
        removeIdentityFromOrder(previousLaneKey, identity);
        normalizeLaneOrder(previousLaneKey);
        stageLaneOrder(lane, identity, insertIndex);
        renderAll();
        syncEditDraftControls(`${draft.employeeName}을(를) ${lane.name} 전체 기간으로 이동했습니다.`, "success");
    }

    function selectedYear() {
        return Number(query("#workforceManagementYear")?.value || new Date().getFullYear());
    }

    function selectedProjectId() {
        return String(query("#workforceManagementProject")?.value || "");
    }

    function querySelects(type) {
        return type === "year"
            ? [query("#workforceManagementYear"), query("#workforceManagementBoardYear")].filter(Boolean)
            : [query("#workforceManagementProject"), query("#workforceManagementBoardProject")].filter(Boolean);
    }

    function syncQuerySelects(type, value) {
        querySelects(type).forEach((select) => { select.value = String(value ?? ""); });
    }

    function yearMonths() {
        const year = selectedYear();
        return Array.from({ length: MONTH_COUNT }, (_item, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
    }

    function monthIndex(value) {
        const match = String(value || "").match(/^(\d{4})-(\d{2})/);
        return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : -1;
    }

    function monthsBetween(startDate, endDate) {
        const start = monthIndex(startDate);
        const end = monthIndex(endDate);
        if (start < 0 || end < start) return [];
        return Array.from({ length: end - start + 1 }, (_item, offset) => {
            const index = start + offset;
            return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`;
        });
    }

    function boardRangeLanes() {
        return projectScopedLanes().filter((lane) => projectFilter === "all" || laneCategory(lane) === projectFilter);
    }

    function fullTimelineMonths() {
        const bounds = [];
        boardRangeLanes().forEach((lane) => {
            [lane.startDate, lane.endDate].forEach((value) => {
                const index = monthIndex(value);
                if (index >= 0) bounds.push(index);
            });
            boardAssignments(lane).forEach((assignment) => {
                [
                    pick(assignment, "assignmentStartDate", "ASSIGNMENT_START_DATE"),
                    pick(assignment, "assignmentEndDate", "ASSIGNMENT_END_DATE")
                ].forEach((value) => {
                    const index = monthIndex(value);
                    if (index >= 0) bounds.push(index);
                });
            });
        });
        if (!bounds.length) return yearMonths();
        const start = Math.min(...bounds);
        const end = Math.max(...bounds);
        return monthsBetween(
            `${Math.floor(start / 12)}-${String(start % 12 + 1).padStart(2, "0")}-01`,
            `${Math.floor(end / 12)}-${String(end % 12 + 1).padStart(2, "0")}-01`
        );
    }

    function timelineMonths() {
        return fullTimelineMonths();
    }

    function applyTimelineScale(monthCount = timelineMonths().length) {
        const board = query("#workforceManagementBoard");
        const scroll = query(".workforce-management-timeline-scroll");
        if (!board || !scroll) return;
        if (boardRangeMode !== "full") {
            board.style.removeProperty("--workforce-render-month-width");
            return;
        }
        const labelWidth = boardZoom < 1 ? 180 : boardZoom > 1 ? 280 : 220;
        const availableWidth = Math.max(0, scroll.clientWidth - labelWidth - 18);
        const fittedMonthWidth = Math.max(20, Math.floor(availableWidth / Math.max(1, monthCount)));
        board.style.setProperty("--workforce-render-month-width", `${fittedMonthWidth}px`);
    }

    function timelinePosition(startDate, endDate, months = timelineMonths()) {
        const firstMonth = months[0];
        const lastMonth = months[months.length - 1];
        const startMonth = String(startDate || "").slice(0, 7);
        const endMonth = String(endDate || "").slice(0, 7);
        if (!firstMonth || !lastMonth || !startMonth || !endMonth || endMonth < firstMonth || startMonth > lastMonth) return null;
        const clippedStart = startMonth < firstMonth ? firstMonth : startMonth;
        const clippedEnd = endMonth > lastMonth ? lastMonth : endMonth;
        return {
            start: months.indexOf(clippedStart) + 1,
            span: monthIndex(clippedEnd) - monthIndex(clippedStart) + 1
        };
    }

    function workerKey(assignment) {
        const explicit = pick(assignment, "workerKey", "WORKER_KEY");
        if (explicit) return String(explicit);
        const userId = pick(assignment, "userId", "USER_ID", "employeeUserId", "EMPLOYEE_USER_ID");
        if (userId) return `USER:${userId}`;
        const companyEmployeeId = pick(assignment, "companyEmployeeId", "COMPANY_EMPLOYEE_ID");
        if (companyEmployeeId) return `COMPANY_EMPLOYEE:${companyEmployeeId}`;
        return `NAME:${pick(assignment, "employeeName", "EMPLOYEE_NAME") || "UNKNOWN"}`;
    }

    function employeeName(assignment) {
        return pick(assignment, "employeeName", "EMPLOYEE_NAME", "userName", "USER_NAME") || "이름 미정";
    }

    function assignmentAllocations(assignment) {
        const allocations = pick(assignment, "monthlyAllocations", "MONTHLY_ALLOCATIONS");
        if (Array.isArray(allocations) && allocations.length) {
            return allocations
                .map((item) => ({
                    month: String(pick(item, "month", "MONTH", "allocationMonth", "ALLOCATION_MONTH") || "").slice(0, 7),
                    mm: number(pick(item, "mm", "MM"))
                }))
                .filter((item) => item.month);
        }
        const startDate = pick(assignment, "assignmentStartDate", "ASSIGNMENT_START_DATE");
        const endDate = pick(assignment, "assignmentEndDate", "ASSIGNMENT_END_DATE");
        const fullMonths = monthsBetween(startDate, endDate);
        const monthlyMm = fullMonths.length ? number(pick(assignment, "totalMm", "TOTAL_MM")) / fullMonths.length : 0;
        return fullMonths.map((month) => ({ month, mm: monthlyMm }));
    }

    function confirmedLanes() {
        // Stable "confirmed" identifiers refer to the registered storage, regardless of project phase.
        return (confirmedData.projects || []).filter((project) => String(pick(project, "statusCode", "STATUS_CODE") || "").toUpperCase() !== "CANCELLED").map((project) => {
            const projectId = pick(project, "projectId", "PROJECT_ID");
            return {
                type: "confirmed",
                key: `confirmed:${projectId}`,
                projectId,
                name: pick(project, "projectName", "PROJECT_NAME") || "프로젝트명 미정",
                customer: pick(project, "customerName", "CUSTOMER_NAME") || "고객사 미정",
                status: pick(project, "statusCode", "STATUS_CODE") || "PLANNED",
                startDate: pick(project, "projectStartDate", "PROJECT_START_DATE"),
                endDate: pick(project, "projectEndDate", "PROJECT_END_DATE"),
                amount: number(pick(project, "contractAmountVat", "CONTRACT_AMOUNT_VAT")),
                assignments: (confirmedData.assignments || []).filter((assignment) => (
                    String(pick(assignment, "projectId", "PROJECT_ID")) === String(projectId)
                ))
            };
        });
    }

    function planningLanes() {
        const registeredProjectIds = new Set((confirmedData.projects || []).map((project) => String(pick(project, "projectId", "PROJECT_ID"))));
        return (scenario?.projects || [])
            .filter((project) => (
                registeredProjectIds.has(String(project.projectId))
                && String(project.bidDecisionCode || "REVIEW").toUpperCase() !== "SKIP"
            ))
            .map((project) => ({
                type: "planning",
                key: `planning:${project.scenarioProjectId || project.projectId}`,
                projectId: project.projectId,
                scenarioProjectId: project.scenarioProjectId,
                name: project.projectName || "프로젝트명 미정",
                customer: project.customerName || "고객사 미정",
                status: project.bidDecisionCode || "REVIEW",
                startDate: project.plannedStartDate,
                endDate: project.plannedEndDate,
                amount: number(project.expectedContractAmount || project.bidAmount || project.announcementAmount),
                assignments: project.assignments || []
            }));
    }

    const projectSortCollator = new Intl.Collator("ko-KR", { numeric: true, sensitivity: "base" });

    function compareWorkerField(left, right, ...keys) {
        const leftValue = String(pick(left, ...keys) || "").trim();
        const rightValue = String(pick(right, ...keys) || "").trim();
        if (!leftValue && !rightValue) return 0;
        if (!leftValue) return 1;
        if (!rightValue) return -1;
        return projectSortCollator.compare(leftValue, rightValue);
    }

    function compareWorkers(left, right) {
        const leftDepartmentOrderValue = pick(left, "departmentDisplayOrder", "DEPARTMENT_DISPLAY_ORDER");
        const rightDepartmentOrderValue = pick(right, "departmentDisplayOrder", "DEPARTMENT_DISPLAY_ORDER");
        const leftDepartmentOrder = leftDepartmentOrderValue === null || leftDepartmentOrderValue === undefined || leftDepartmentOrderValue === ""
            ? Number.MAX_SAFE_INTEGER : Number(leftDepartmentOrderValue);
        const rightDepartmentOrder = rightDepartmentOrderValue === null || rightDepartmentOrderValue === undefined || rightDepartmentOrderValue === ""
            ? Number.MAX_SAFE_INTEGER : Number(rightDepartmentOrderValue);
        const departmentOrder = leftDepartmentOrder - rightDepartmentOrder;
        return compareWorkerField(left, right, "companyName", "COMPANY_NAME")
            || departmentOrder
            || compareWorkerField(left, right, "departmentName", "DEPARTMENT_NAME")
            || compareWorkerField(left, right, "employeeNo", "EMPLOYEE_NO")
            || compareWorkerField(left, right, "employeeName", "EMPLOYEE_NAME")
            || projectSortCollator.compare(String(left.workerKey || ""), String(right.workerKey || ""));
    }

    function projectEditActive() {
        return editMode && boardView === "project";
    }

    function compareProjectDates(left, right) {
        const leftText = String(left || "");
        const rightText = String(right || "");
        if (!leftText && !rightText) return 0;
        if (!leftText) return 1;
        if (!rightText) return -1;
        return leftText.localeCompare(rightText);
    }

    function compareProjectLanes(left, right) {
        const customer = projectSortCollator.compare(String(left.customer || ""), String(right.customer || ""));
        const start = compareProjectDates(left.startDate, right.startDate);
        const end = compareProjectDates(left.endDate, right.endDate);
        const amount = number(right.amount) - number(left.amount);
        const name = projectSortCollator.compare(String(left.name || ""), String(right.name || ""));
        return projectSort === "customer"
            ? customer || start || end || amount || name
            : start || customer || end || amount || name;
    }

    function allLanes() {
        // Retain the old comparison view so scenario-only allocations remain reviewable.
        return boardBasis === "legacy-scenario" ? [...confirmedLanes(), ...planningLanes()] : confirmedLanes();
    }

    function laneCategory(lane) {
        if (boardBasis === "legacy-scenario") return lane.type;
        const status = String(lane.status || "").toUpperCase();
        return ["CONTRACTED", "IN_PROGRESS", "COMPLETED"].includes(status) ? "confirmed" : "planning";
    }

    function projectScopedLanes() {
        const projectId = selectedProjectId();
        return allLanes().filter((lane) => !projectId || String(lane.projectId) === projectId);
    }

    function laneCompanies(lane) {
        if (!lane || lane.type !== "confirmed") return [];
        return (confirmedData.companies || []).filter((company) => (
            String(pick(company, "projectId", "PROJECT_ID")) === String(lane.projectId)
        ));
    }

    function workerCompanyEligibility(lane, worker) {
        if (!lane || lane.type !== "confirmed") return { valid: true, company: null, reason: "" };
        const companies = laneCompanies(lane);
        const internal = workerKey(worker).startsWith("USER:");
        let company = null;
        if (internal) {
            company = companies.find((item) => (
                String(pick(item, "companyTypeCode", "COMPANY_TYPE_CODE") || "").toUpperCase() === "HEADQUARTERS"
            ));
            return company
                ? { valid: true, company, reason: "" }
                : { valid: false, company: null, reason: `${lane.name} 참여회사에 인아이티(본사)가 등록되어 있지 않습니다.` };
        }
        const companyId = String(pick(worker, "companyId", "COMPANY_ID") || "");
        const companyName = String(pick(worker, "companyName", "COMPANY_NAME") || "").trim();
        if (!companyId) {
            return { valid: false, company: null, reason: `${employeeName(worker)}의 소속회사 연결정보가 없습니다.` };
        }
        company = companies.find((item) => String(pick(item, "companyId", "COMPANY_ID") || "") === companyId);
        return company
            ? { valid: true, company, reason: "" }
            : { valid: false, company: null, reason: `${lane.name} 참여회사에 ${companyName || "해당 소속회사"}이(가) 등록되어 있지 않습니다.` };
    }

    function workerCompanyWarnings(worker) {
        return projectScopedLanes()
            .filter((lane) => lane.type === "confirmed")
            .map((lane) => ({ ...workerCompanyEligibility(lane, worker), lane }))
            .filter((result) => !result.valid);
    }

    function withRenderCalculationCache(callback) {
        if (renderCalculationCache) return callback();
        renderCalculationCache = {};
        try {
            return callback();
        } finally {
            renderCalculationCache = null;
        }
    }

    function defaultCalculationLanes() {
        if (!renderCalculationCache) return allLanes();
        if (!renderCalculationCache.lanes) {
            renderCalculationCache.lanes = allLanes();
        }
        return renderCalculationCache.lanes;
    }

    function workerMonthlyCapacity(worker, month) {
        const start = dateText(pick(worker, "availableStartDate", "AVAILABLE_START_DATE")).slice(0, 7);
        const end = dateText(pick(worker, "availableEndDate", "AVAILABLE_END_DATE")).slice(0, 7);
        return (!start || month >= start) && (!end || month <= end) ? 1 : 0;
    }

    function detailMm(value) {
        return Number(value || 0).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 4 });
    }

    function loadDetailGroups({ workerKeys = null, months = null, scopeLanes = null, onlyWarnings = false, availableOnly = false, requireScopedAssignment = false } = {}) {
        const lanes = allLanes();
        const workers = new Map(referenceWorkers(lanes).map((worker) => [worker.workerKey, worker]));
        const { capacity } = allocationState(lanes);
        const keys = workerKeys ? new Set(workerKeys) : new Set(workers.keys());
        const monthKeys = months || timelineMonths();
        const scope = new Set((scopeLanes || lanes).map((lane) => lane.key));
        const groups = [];
        keys.forEach((key) => monthKeys.forEach((month) => {
            const worker = workers.get(key) || { workerKey: key };
            const item = capacity.get(`${key}|${month}`) || { employeeName: employeeName(worker), totalMm: 0, projects: new Map(), assignments: [] };
            const limit = workerMonthlyCapacity(worker, month);
            const total = item.totalMm;
            const overloaded = total > 1 + 0.000001;
            if (onlyWarnings && !overloaded) return;
            if (availableOnly && total >= limit - 0.000001) return;
            const allocations = item.assignments || [];
            if (requireScopedAssignment && !allocations.some((a) => scope.has(a.laneKey))) return;
            const reasons = [];
            if (overloaded) reasons.push(`전체 프로젝트 투입 ${detailMm(total)} M/M이 월 중복 판정 기준 1.0 M/M을 ${detailMm(total - 1)} M/M 초과했습니다.`);
            if (!limit) reasons.push(`해당 월은 등록된 가용기간(${dateText(pick(worker, "availableStartDate", "AVAILABLE_START_DATE")) || "시작 제한 없음"} ~ ${dateText(pick(worker, "availableEndDate", "AVAILABLE_END_DATE")) || "종료 제한 없음"}) 밖이므로 가용량이 0 M/M입니다.`);
            if (item.projects.size > 1) {
                reasons.push(`같은 달 ${item.projects.size}개 프로젝트의 투입을 합산했습니다.`);
                if (!overloaded) reasons.push("합계가 1.0 M/M 이하인 정상 분할 투입입니다. 중복 알림 대상이 아닙니다.");
            }
            if (allocations.length > item.projects.size) reasons.push("같은 프로젝트의 여러 배치 행을 각각 합산했습니다. 배치 번호와 기간을 확인해 주세요.");
            const hidden = allocations.filter((a) => !scope.has(a.laneKey));
            if (hidden.length) reasons.push(`현재 조회에서 숨겨진 프로젝트의 ${detailMm(hidden.reduce((n, a) => n + a.mm, 0))} M/M도 과부하 판정에 포함했습니다.`);
            if (!overloaded && item.projects.size <= 1) reasons.push(total ? "합산 투입이 1.0 M/M 이하이므로 중복 알림 대상이 아닙니다." : "해당 월에 등록된 투입이 없습니다.");
            groups.push({ title: `${item.employeeName || employeeName(worker)} · ${month} · ${overloaded ? "1 M/M 초과" : "투입·가용 상세"}`,
                severity: overloaded ? "danger" : "info", reasons,
                facts: [["전체 투입",`${detailMm(total)} M/M`],["중복 판정 기준","1.0 M/M"],["기간 가용량",`${detailMm(limit)} M/M`],["초과량",`${detailMm(Math.max(0,total-1))} M/M`],
                    ["잔여 가용",`${detailMm(Math.max(0,limit-total))} M/M`],["프로젝트",`${item.projects.size}개`]],
                columns: ["프로젝트","구분","투입기간","해당 월 M/M","배치 번호","저장 상태","조회 범위"],
                rows: allocations.map((a) => [a.projectName,a.phase === "confirmed" ? "확정" : "계획",`${a.startDate || "—"} ~ ${a.endDate || "—"}`,detailMm(a.mm),a.identity,a.source,scope.has(a.laneKey) ? "현재 조회" : "필터 밖 포함"])
            });
        }));
        return groups.sort((a,b) => (a.severity === "danger" ? -1 : 0) - (b.severity === "danger" ? -1 : 0) || a.title.localeCompare(b.title,"ko"));
    }

    function openLoadDetails(options = {}) {
        detailLayer.open({ title: options.title || "투입·과부하·중복 상세", description: "같은 달 전체 프로젝트 합계가 1.0 M/M을 초과할 때 중복·과부하로 알립니다. 0.5 + 0.5처럼 합계가 1.0 이하면 정상입니다. 필터 밖 프로젝트와 미저장 변경도 합산합니다.",
            groups: loadDetailGroups(options) });
    }

    function detailTrigger(node, options) {
        node.classList.add("workforce-detail-trigger");
        node.setAttribute("role","button"); node.tabIndex=0;
        node.setAttribute("aria-haspopup","dialog");
        node.setAttribute("aria-label",`${node.title || node.textContent} · 상세 사유와 대상 보기`);
        node.title=`${node.title || node.textContent} · 클릭하면 상세 사유와 대상을 확인합니다.`;
        const open = (event) => { event.preventDefault(); event.stopPropagation(); openLoadDetails(typeof options === "function" ? options() : options); };
        node.addEventListener("click",open,{signal:controller.signal});
        node.addEventListener("keydown",(event) => { if (["Enter"," "].includes(event.key)) open(event); },{signal:controller.signal});
    }

    function allocationState(lanes = null) {
        const useDefaultLanes = lanes === null;
        if (useDefaultLanes && renderCalculationCache?.allocationState) {
            return renderCalculationCache.allocationState;
        }
        const resolvedLanes = useDefaultLanes ? defaultCalculationLanes() : lanes;
        const capacity = new Map();
        const workers = new Map(referenceWorkers(resolvedLanes).map((worker) => [worker.workerKey, worker]));
        resolvedLanes.forEach((lane) => {
            boardAssignments(lane).forEach((assignment) => {
                if (isPendingRemoval(assignmentIdentity(lane, assignment))) return;
                const key = workerKey(assignment);
                assignmentAllocations(assignment).forEach((allocation) => {
                    if (allocation.mm <= 0) return;
                    const capacityKey = `${key}|${allocation.month}`;
                    if (!capacity.has(capacityKey)) {
                        capacity.set(capacityKey, {
                            workerKey: key,
                            employeeName: employeeName(assignment),
                            month: allocation.month,
                            totalMm: 0,
                            capacityMm: workerMonthlyCapacity(workers.get(key) || assignment, allocation.month),
                            assignments: [],
                            projects: new Map()
                        });
                    }
                    const item = capacity.get(capacityKey);
                    item.totalMm += allocation.mm;
                    const project = item.projects.get(lane.key) || { projectId: lane.projectId, name: lane.name, type: laneCategory(lane), mm: 0 };
                    project.mm += allocation.mm; item.projects.set(lane.key, project);
                    item.assignments.push({ laneKey: lane.key, projectName: lane.name, phase: laneCategory(lane), mm: allocation.mm,
                        startDate: dateText(pick(assignment,"assignmentStartDate","ASSIGNMENT_START_DATE")),
                        endDate: dateText(pick(assignment,"assignmentEndDate","ASSIGNMENT_END_DATE")), identity: assignmentIdentity(lane,assignment),
                        source: quickContext?.preview === assignment ? "설정 미리보기" : isEditDraft(assignment) ? "미저장 변경" : lane.type === "planning" ? "기존 계획안 참고" : "저장된 투입" });
                });
            });
        });
        const warnings = Array.from(capacity.values())
            .filter((item) => item.totalMm > 1 + 0.000001)
            .sort((left, right) => left.month.localeCompare(right.month) || left.employeeName.localeCompare(right.employeeName));
        const result = { capacity, warnings };
        if (useDefaultLanes && renderCalculationCache) {
            renderCalculationCache.allocationState = result;
        }
        return result;
    }

    function referenceWorkers(lanes = allLanes()) {
        const workers = new Map();
        (references.workers || []).forEach((worker) => {
            const key = String(pick(worker, "workerKey", "WORKER_KEY") || "");
            if (key) workers.set(key, { ...worker, workerKey: key });
        });
        lanes.forEach((lane) => lane.assignments.forEach((assignment) => {
            const key = workerKey(assignment);
            if (workers.has(key)) return;
            workers.set(key, {
                workerKey: key,
                employeeName: employeeName(assignment),
                companyName: pick(assignment, "companyName", "COMPANY_NAME") || "소속 미정",
                departmentName: pick(assignment, "departmentName", "DEPARTMENT_NAME") || "",
                departmentCode: pick(assignment, "departmentCode", "DEPARTMENT_CODE") || "",
                availableStartDate: pick(assignment,"availableStartDate","AVAILABLE_START_DATE") || "",
                availableEndDate: pick(assignment,"availableEndDate","AVAILABLE_END_DATE") || "",
                workerTypeCode: key.startsWith("USER:") ? "INTERNAL" : "PARTNER"
            });
        }));
        return Array.from(workers.values());
    }

    function workerStatistics(lanes = null) {
        const useDefaultLanes = lanes === null;
        if (useDefaultLanes && renderCalculationCache?.workerStatistics) {
            return renderCalculationCache.workerStatistics;
        }
        const resolvedLanes = useDefaultLanes ? defaultCalculationLanes() : lanes;
        const { capacity } = useDefaultLanes
            ? allocationState()
            : allocationState(resolvedLanes);
        const months = yearMonths();
        const result = referenceWorkers(resolvedLanes).map((worker) => {
            const key = worker.workerKey;
            const monthly = months.map((month) => capacity.get(`${key}|${month}`) || {
                workerKey: key,
                month,
                totalMm: 0,
                projects: new Map()
            });
            const availableStart = String(pick(worker, "availableStartDate", "AVAILABLE_START_DATE") || "").slice(0, 7);
            const availableEnd = String(pick(worker, "availableEndDate", "AVAILABLE_END_DATE") || "").slice(0, 7);
            const availableMonths = monthly.filter((item) => (
                item.totalMm < 1
                && (!availableStart || item.month >= availableStart)
                && (!availableEnd || item.month <= availableEnd)
            )).length;
            return {
                ...worker,
                monthly,
                availableMonths,
                peakMm: Math.max(0, ...monthly.map((item) => item.totalMm)),
                overloadCount: monthly.filter((item) => item.totalMm > 1 + 0.000001).length
            };
        });
        if (useDefaultLanes && renderCalculationCache) {
            renderCalculationCache.workerStatistics = result;
        }
        return result;
    }

    function renderProjectOptions() {
        const selects = querySelects("project");
        const currentValue = String(query("#workforceManagementProject")?.value || "");
        const projectsById = new Map();
        (confirmedData.projects || []).forEach((project) => {
            const projectId = pick(project, "projectId", "PROJECT_ID");
            if (projectId !== null && projectId !== undefined && projectId !== "") {
                projectsById.set(String(projectId), project);
            }
        });
        const projects = Array.from(projectsById.values()).sort((left, right) => (
            String(pick(left, "projectName", "PROJECT_NAME") || "")
                .localeCompare(String(pick(right, "projectName", "PROJECT_NAME") || ""), "ko")
        ));
        selects.forEach((select) => {
            select.replaceChildren();
            const empty = element("option", "", projects.length ? "전체 프로젝트" : "등록된 프로젝트 없음");
            empty.value = "";
            select.appendChild(empty);
            projects.forEach((project) => {
                const projectId = pick(project, "projectId", "PROJECT_ID");
                const projectName = pick(project, "projectName", "PROJECT_NAME") || "프로젝트명 미정";
                const customerName = pick(project, "customerName", "CUSTOMER_NAME");
                const option = element("option", "", customerName ? `${projectName} · ${customerName}` : projectName);
                option.value = projectId;
                select.appendChild(option);
            });
            if (Array.from(select.options).some((option) => option.value === currentValue)) select.value = currentValue;
        });
    }

    function renderMetrics() {
        const lanes = projectScopedLanes();
        const assignments = lanes.flatMap((lane) => lane.assignments);
        const workers = workerStatistics();
        const { warnings } = allocationState();
        const projectId = selectedProjectId();
        const visibleWarnings = warnings.filter((warning) => (
            warning.month.startsWith(`${selectedYear()}-`) && (!projectId
            || Array.from(warning.projects.values()).some((project) => String(project.projectId) === projectId))
        ));
        const confirmedCount = lanes.filter((lane) => laneCategory(lane) === "confirmed").length;
        const planningCount = lanes.filter((lane) => laneCategory(lane) === "planning").length;
        const uniqueWorkers = new Set(assignments.map(workerKey));
        const availableWorkers = workers.filter((worker) => worker.availableMonths > 0).length;
        query("#workforceManagementProjectMetric").textContent = `${lanes.length}개`;
        query("#workforceManagementProjectMetricNote").textContent = `확정 ${confirmedCount} · 계획 ${planningCount}`;
        query("#workforceManagementAssignmentMetric").textContent = `${uniqueWorkers.size}명 · ${assignments.length}건`;
        query("#workforceManagementAvailableMetric").textContent = `${availableWorkers}명`;
        query("#workforceManagementAvailableMetricNote").textContent = `${selectedYear()}년 중 1개월 이상 가용`;
        query("#workforceManagementWarningMetric").textContent = `${Common.workload.groupOverloads(visibleWarnings).length}명`;
        query("#workforceManagementWarningMetric").disabled = !visibleWarnings.length;
        query("#workforceManagementProjectMetric").disabled = !lanes.length;
        query("#workforceManagementAssignmentMetric").disabled = !uniqueWorkers.size;
        query("#workforceManagementAvailableMetric").disabled = !availableWorkers;
        [["Project","프로젝트 목록"],["Assignment","투입 인력·배치"],["Available","가용 인력"],["Warning","과부하·중복 알림"]].forEach(([id,label]) => {
            const button=query(`#workforceManagement${id}Metric`);
            button.setAttribute("aria-label",`${label} ${button.textContent} · 상세 사유와 대상 보기`);
        });
    }

    function openMetricDetails(kind) {
        if (kind === "warnings") { openWorkerLoadDetail(); return; }
        const lanes=projectScopedLanes();
        if (kind === "projects") {
            detailLayer.open({title:"조회 프로젝트 목록",description:"현재 선택한 프로젝트 범위입니다. 프로젝트 상태로 계획·확정을 구분합니다.",groups:lanes.map((lane)=>({
                title:lane.name,reasons:[`${statusLabel(lane)} 단계로 ${laneCategory(lane)==="confirmed"?"확정":"계획"} 투입으로 집계됩니다.`],
                facts:[["기간",`${lane.startDate || "—"} ~ ${lane.endDate || "—"}`],["고객사",lane.customer || "—"]],
                columns:["인력","투입 구분","투입기간","총 M/M"],rows:boardAssignments(lane).filter((a)=>!isPendingRemoval(assignmentIdentity(lane,a))).map((a)=>[employeeName(a),assignmentStatusLabel(lane,a),`${dateText(pick(a,"assignmentStartDate","ASSIGNMENT_START_DATE"))} ~ ${dateText(pick(a,"assignmentEndDate","ASSIGNMENT_END_DATE"))}`,fixed(pick(a,"totalMm","TOTAL_MM"))])
            }))});
            return;
        }
        const keys=kind==="assignments" ? new Set(lanes.flatMap((lane)=>boardAssignments(lane).filter((a)=>!isPendingRemoval(assignmentIdentity(lane,a))).map(workerKey))) : null;
        const months=kind==="available" ? yearMonths() : [...new Set(allLanes().flatMap((lane)=>boardAssignments(lane).flatMap((a)=>assignmentAllocations(a).map((item)=>item.month))))].sort();
        openLoadDetails({title:kind==="available"?"인력별 가용 근거":"조회 투입 인력·배치 상세",workerKeys:keys,months,
            scopeLanes:lanes,availableOnly:kind==="available",requireScopedAssignment:kind==="assignments"});
    }

    function openCompanyWarningDetails(worker) {
        detailLayer.open({title:`${employeeName(worker)} · 배치 제한 사유`,description:"소속회사 연결과 프로젝트 참여회사 등록을 비교한 결과입니다.",
            groups:workerCompanyWarnings(worker).map((item)=>({title:item.lane.name,severity:"danger",reasons:[item.reason,"협력업체 관리의 소속회사 연결과 프로젝트의 참여회사 등록을 확인해 주세요."],
                facts:[["인력",employeeName(worker)],["소속회사",pick(worker,"companyName","COMPANY_NAME") || "미지정"]],
                columns:["프로젝트 참여회사","연결 회사 ID"],rows:laneCompanies(item.lane).map((company)=>[pick(company,"companyName","COMPANY_NAME") || "미지정",pick(company,"companyId","COMPANY_ID") || "연결 없음"])}))});
    }

    function openWorkerLoadDetail(workerKey = null) {
        App.navigate("workforce-load-detail", {context:{planYear:selectedYear(),workerKey,projectId:selectedProjectId() || null,returnPage:"workforce-management"}});
    }

    function renderAlerts() {
        const projectId=selectedProjectId();
        const warnings=allocationState().warnings.filter((warning)=>warning.month.startsWith(`${selectedYear()}-`) && (!projectId || [...warning.projects.values()].some((project)=>String(project.projectId)===projectId)));
        const people=Common.workload.groupOverloads(warnings);
        const panel=query("#workforceManagementAlerts"),list=query("#workforceManagementAlertList");
        list.replaceChildren();panel.hidden=!people.length;
        const months=people.reduce((sum,person)=>sum+person.months.length,0);
        query("#workforceManagementAlertCount").textContent=`${people.length}명 · ${months}인·월`;
        people.forEach((person)=>{
            const item=element("li","workforce-management-alert-entry");
            const button=element("button","workforce-management-alert-item is-high");button.type="button";
            const icon=element("span","workforce-management-alert-icon","!");icon.setAttribute("aria-hidden","true");
            const copy=element("div");
            copy.append(element("strong","",`${person.employeeName} · 총 ${person.months.length}개월 초과투입`),
                element("span","",Common.workload.monthList(person.months)),
                element("span","",`최고 월 투입 ${detailMm(person.peakMm)} M/M · ${person.projectNames.join(" / ")}`),
                element("span","workforce-management-alert-link","인력별 초과투입 상세 →"));
            button.append(icon,copy);button.addEventListener("click",()=>openWorkerLoadDetail(person.workerKey),{signal:controller.signal});
            item.appendChild(button);list.appendChild(item);
        });
    }

    function workerMatchesType(worker, type) {
        if (!type || type === "ALL") return true;
        const key = String(worker.workerKey || "");
        const workerType = String(pick(worker, "workerTypeCode", "WORKER_TYPE_CODE") || "").toUpperCase();
        const internal = key.startsWith("USER:") || (
            !key.startsWith("COMPANY_EMPLOYEE:") && workerType === "INTERNAL"
        );
        const employmentType = String(pick(worker, "employmentTypeCode", "EMPLOYMENT_TYPE_CODE") || "").toUpperCase();
        if (type === "INTERNAL") return internal;
        if (type === "INTERNAL_REGULAR") return internal && employmentType === "REGULAR";
        if (type === "INTERNAL_NON_REGULAR") return internal && employmentType !== "REGULAR";
        if (type === "PARTNER") return !internal;
        if (!internal) return false;
        const departmentCode = String(pick(worker, "departmentCode", "DEPARTMENT_CODE") || "").toUpperCase();
        if (departmentCode) return departmentCode === type;
        const departmentName = String(pick(worker, "departmentName", "DEPARTMENT_NAME") || "");
        return departments.some((department) => (
            String(department.code) === type && String(department.label) === departmentName
        ));
    }

    function applyWorkerFilters(type, name) {
        workerTypeFilter = String(type || "");
        workerNameFilter = String(name || "").trim();
        ["#workforceManagementWorkerType", "#workforceManagementMatrixWorkerType"].forEach((selector) => {
            const control = query(selector);
            if (control) control.value = workerTypeFilter;
        });
        ["#workforceManagementWorkerSearch", "#workforceManagementMatrixWorkerSearch"].forEach((selector) => {
            const control = query(selector);
            if (control && control.value !== workerNameFilter) control.value = workerNameFilter;
        });
        withRenderCalculationCache(() => {
            renderWorkers();
            renderLanes();
        });
    }

    function renderWorkers() {
        const container = query("#workforceManagementWorkers");
        const keyword = workerNameFilter.toLocaleLowerCase("ko-KR");
        const type = workerTypeFilter;
        const workers = workerStatistics()
            .filter((worker) => workerMatchesType(worker, type))
            .filter((worker) => !keyword || String(pick(worker, "employeeName", "EMPLOYEE_NAME") || "").toLocaleLowerCase("ko-KR").includes(keyword))
            .sort(compareWorkers);
        container.replaceChildren();
        query("#workforceManagementWorkerCount").textContent = `${workers.length}명`;
        if (!workers.length) {
            container.appendChild(element("p", "empty-state", "조건에 맞는 인력이 없습니다."));
            return;
        }
        const fragment = document.createDocumentFragment();
        workers.forEach((worker) => {
            const companyWarnings = workerCompanyWarnings(worker);
            const card = element("article", `workforce-management-worker-card${worker.overloadCount ? " has-overlap" : ""}${companyWarnings.length ? " has-company-warning" : ""}`);
            card.dataset.workerKey = worker.workerKey;
            card.draggable = editMode;
            if (editMode) {
                card.tabIndex = 0;
                card.setAttribute("aria-label", `${pick(worker, "employeeName", "EMPLOYEE_NAME") || "인력"} 드래그하여 프로젝트에 배치`);
            }
            const top = element("div", "workforce-management-worker-top");
            const copy = element("div");
            const nameRow = element("div", "workforce-management-worker-name-row");
            nameRow.append(
                element("strong", "", pick(worker, "employeeName", "EMPLOYEE_NAME") || "이름 미정"),
                workerPhoto(worker)
            );
            copy.append(
                nameRow,
                element("span", "", [pick(worker, "companyName", "COMPANY_NAME"), pick(worker, "departmentName", "DEPARTMENT_NAME"), pick(worker, "positionName", "POSITION_NAME")].filter(Boolean).join(" · ") || "소속 정보 없음")
            );
            const status = element("span", `workforce-management-worker-status${worker.overloadCount ? " is-overlap" : ""}`, worker.overloadCount ? `1 M/M 초과 ${worker.overloadCount}개월` : `가용 ${worker.availableMonths}개월`);
            detailTrigger(status,{workerKeys:[worker.workerKey],months:yearMonths(),onlyWarnings:Boolean(worker.overloadCount),availableOnly:!worker.overloadCount,title:`${employeeName(worker)} · 월별 투입 사유`});
            top.append(copy, status);
            const months = element("div", "workforce-management-worker-months");
            worker.monthly.forEach((item, index) => {
                const cell = element("span", "", String(index + 1));
                if (item.totalMm > 0) cell.classList.add("is-assigned");
                if (item.totalMm >= 1) cell.classList.add("is-full");
                if (item.totalMm > 1 + 0.000001) cell.classList.add("is-overlap");
                cell.setAttribute("aria-label", `${index + 1}월 ${fixed(item.totalMm)} M/M${item.totalMm > 1 + 0.000001 ? ", 1 M/M 초과" : ""}`);
                cell.title=`${employeeName(worker)} · ${item.month} · ${fixed(item.totalMm)} M/M`;
                detailTrigger(cell,{workerKeys:[worker.workerKey],months:[item.month]});
                months.appendChild(cell);
            });
            const summary = element("small", "workforce-management-worker-summary", `최고 ${fixed(worker.peakMm)} M/M · 1.0 미만 ${worker.availableMonths}개월`);
            const detailButton = element("button", "workforce-management-worker-detail-button", "상세");
            detailButton.type = "button";
            detailButton.dataset.workerDetail = worker.workerKey;
            detailButton.draggable = false;
            card.append(top, months, summary, detailButton);
            if (companyWarnings.length) {
                const warning = element("small", "workforce-management-worker-company-warning", `⚠ 배치 불가 ${companyWarnings.length}개 프로젝트`);
                warning.title = companyWarnings.map((item) => item.reason).join("\n");
                warning.classList.add("workforce-detail-trigger"); warning.tabIndex=0; warning.setAttribute("role","button"); warning.setAttribute("aria-haspopup","dialog");
                const open=()=>openCompanyWarningDetails(worker); warning.addEventListener("click",open,{signal:controller.signal}); warning.addEventListener("keydown",(event)=>{if(["Enter"," "].includes(event.key)){event.preventDefault();open();}},{signal:controller.signal});
                card.appendChild(warning);
            }
            fragment.appendChild(card);
        });
        container.replaceChildren(fragment);
    }

    function renderProjectPalette() {
        const palette = query("#workforceManagementProjectPalette");
        palette.hidden = !projectEditActive() || boardView === "project";
        palette.replaceChildren();
        if (palette.hidden) return;
        palette.appendChild(element("strong", "", "프로젝트를 인력의 월 셀로 끌어 배치"));
        projectScopedLanes()
            .filter((lane) => projectFilter === "all" || laneCategory(lane) === projectFilter)
            .forEach((lane) => {
                const chip = element("button", `workforce-management-project-chip is-${laneCategory(lane)}`, lane.name);
                chip.type = "button";
                chip.draggable = true;
                chip.dataset.laneKey = lane.key;
                if (lane.type === "confirmed") {
                    chip.dataset.workforceEditor = "confirmed";
                    chip.dataset.projectId = lane.projectId;
                }
                chip.title = lane.type === "confirmed"
                    ? `${lane.name} · 클릭하면 상세 편집, 드래그하면 빠른 배치`
                    : `${lane.name} · 드래그하면 빠른 배치`;
                palette.appendChild(chip);
            });
    }

    function renderMonthHeader() {
        const header = query("#workforceManagementMonthHeader");
        const months = timelineMonths();
        const firstLabels = { worker: workerDisplay === "department" ? "사업부 · 소속" : "인력", project: "프로젝트" };
        query("#workforceManagementBoard").style.setProperty("--workforce-month-count", String(Math.max(1, months.length)));
        header.replaceChildren(element("span", "", firstLabels[boardView]));
        months.forEach((month) => {
            const label = element("span", "workforce-management-month-label");
            label.append(element("b", "", month.slice(0, 4)), element("small", "", `.${month.slice(5, 7)}`));
            header.appendChild(label);
        });
        applyTimelineScale(months.length);
    }

    function laneMatches(lane, keyword) {
        if (projectFilter !== "all" && laneCategory(lane) !== projectFilter) return false;
        if (!keyword) return true;
        return [lane.name, lane.customer, ...lane.assignments.map(employeeName)].join(" ").toLowerCase().includes(keyword);
    }

    function statusLabel(lane) {
        if (boardBasis === "project-status") {
            return ({ PLANNED: "계획", BIDDING: "입찰", CONTRACTED: "계약", IN_PROGRESS: "진행", COMPLETED: "완료" })[lane.status] || "계획";
        }
        if (lane.type === "confirmed") return "확정";
        const labels = { PARTICIPATE: "입찰", REVIEW: "검토", HOLD: "보류" };
        return labels[String(lane.status || "").toUpperCase()] || "계획";
    }

    function assignmentHasOverlap(assignment, lane, capacity) {
        if (isPendingRemoval(assignmentIdentity(lane,assignment))) return false;
        const key = workerKey(assignment);
        return assignmentAllocations(assignment).some((allocation) => {
            if (allocation.mm <= 0) return false;
            const item=capacity.get(`${key}|${allocation.month}`);
            return item && item.totalMm > 1 + 0.000001;
        });
    }

    function assignmentWarningButton(assignment,lane,capacity) {
        if (!assignmentHasOverlap(assignment,lane,capacity)) return null;
        const button=element("button","button button-secondary button-small workforce-management-assignment-warning","사유");
        button.type="button";
        button.setAttribute("aria-haspopup","dialog");
        button.setAttribute("aria-label",`${employeeName(assignment)} · ${lane.name} 과부하·중복 사유`);
        button.addEventListener("click",(event)=>{
            event.stopPropagation();
            openLoadDetails({workerKeys:[workerKey(assignment)],months:assignmentAllocations(assignment).map((a)=>a.month),scopeLanes:[lane],onlyWarnings:true,
                title:`${employeeName(assignment)} · ${lane.name} 경고 사유`});
        },{signal:controller.signal});
        return button;
    }

    function assignmentIdentity(lane, assignment) {
        if (isEditDraft(assignment)) return `draft:${assignment.editDraftKey}`;
        return lane.type === "confirmed"
            ? `confirmed:${pick(assignment, "assignmentId", "ASSIGNMENT_ID")}`
            : `planning:${pick(assignment, "planAssignmentId", "PLAN_ASSIGNMENT_ID") || assignment.clientKey || workerKey(assignment)}`;
    }

    function assignmentStatusCode(lane, assignment) {
        if (boardBasis === "project-status") return laneCategory(lane) === "confirmed" ? "CONFIRMED" : "PLANNED";
        if (lane.type === "planning") return "PLANNED";
        return String(pick(assignment, "assignmentStatusCode", "ASSIGNMENT_STATUS_CODE") || "CONFIRMED").toUpperCase();
    }

    function assignmentStatusLabel(lane, assignment) {
        return assignmentStatusCode(lane, assignment) === "PLANNED" ? "계획 투입" : "확정 투입";
    }

    function decorateAssignmentNode(node, lane, assignment) {
        const identity = assignmentIdentity(lane, assignment);
        node.dataset.assignmentKey = identity;
        node.dataset.quickAssignment = identity;
        node.tabIndex = 0;
        node.setAttribute("role", "group");
        node.title = "클릭하면 매출단가를 수정합니다. 이름은 인력정보를 엽니다.";
        node.dataset.laneKey = lane.key;
        node.dataset.workerKey = workerKey(assignment);
        node.dataset.projectId = lane.projectId;
        node.draggable = projectEditActive() && !isPendingRemoval(identity);
        node.classList.toggle("is-draft", isEditDraft(assignment));
        node.classList.toggle("is-pending-removal", isPendingRemoval(identity));
        node.classList.toggle("is-pending-order", isPendingOrderChange(lane, identity));
    }

    function appendProjectDropCells(timeline, lane, rowSpan, months) {
        months.forEach((month, index) => {
            const cell = element("div", "workforce-management-drop-cell");
            cell.style.gridColumn = String(index + 1);
            cell.style.gridRow = `1 / span ${rowSpan}`;
            cell.dataset.dropLaneKey = lane.key;
            cell.dataset.dropMonth = month;
            cell.setAttribute("aria-label", `${lane.name} ${index + 1}월 배치 영역`);
            timeline.appendChild(cell);
        });
    }

    function projectMonthSummary(lane, assignments, months, capacity) {
        const totals = new Map(months.map((month) => [month, { workers: new Set(), confirmed: 0, planned: 0, overloaded: new Set() }]));
        assignments.forEach((assignment) => {
            if (isPendingRemoval(assignmentIdentity(lane, assignment))) return;
            const key = workerKey(assignment);
            assignmentAllocations(assignment).forEach((allocation) => {
                const item = totals.get(allocation.month);
                if (!item || allocation.mm <= 0) return;
                item.workers.add(key);
                item[assignmentStatusCode(lane, assignment) === "PLANNED" ? "planned" : "confirmed"] += allocation.mm;
                const total = capacity.get(`${key}|${allocation.month}`);
                if ((total?.totalMm || 0) > 1 + 0.000001) item.overloaded.add(key);
            });
        });
        return totals;
    }

    function appendProjectSummary(timeline, lane, assignments, months, capacity) {
        const totals = projectMonthSummary(lane, assignments, months, capacity);
        const workers = new Set();
        let totalMm = 0;
        totals.forEach((item) => {
            item.workers.forEach((key) => workers.add(key));
            totalMm += item.confirmed + item.planned;
        });
        const summary = element("div", "workforce-management-project-summary");
        summary.style.gridColumn = "1 / -1";
        summary.style.gridRow = "2";
        summary.append(
            element("strong", "", `투입 ${workers.size}명 · ${fixed(totalMm)} M/M`),
            element("span", "", "표시 기간 합계 · 월별 확정 / 계획 투입")
        );
        if(workers.size) detailTrigger(summary,{workerKeys:[...workers],months,scopeLanes:[lane],requireScopedAssignment:true,title:`${lane.name} · 기간별 투입 상세`});
        timeline.appendChild(summary);
        totals.forEach((item, month) => {
            const cell = element("div", "workforce-management-summary-month");
            cell.style.gridColumn = String(months.indexOf(month) + 1);
            cell.style.gridRow = "3";
            cell.append(
                element("strong", "", item.workers.size ? `${item.workers.size}명` : "—"),
                element("small", "", `${fixed(item.confirmed)} / ${fixed(item.planned)}`)
            );
            if (item.overloaded.size) {
                cell.classList.add("has-overload");
                cell.append(element("small", "", `과부하 ${item.overloaded.size}명`));
            }
            cell.title = `${month} · ${item.workers.size}명 · 확정 ${fixed(item.confirmed)} M/M · 계획 ${fixed(item.planned)} M/M · 전체 프로젝트 합산 과부하 ${item.overloaded.size}명`;
            if(item.workers.size) detailTrigger(cell,{workerKeys:[...item.workers],months:[month],scopeLanes:[lane],title:`${lane.name} · ${month} 투입 상세`});
            timeline.appendChild(cell);
        });
    }

    function syncSummaryControls() {
        query("#workforceManagementProjectSummaryControls").hidden = boardView !== "project";
        root.querySelectorAll("[data-workforce-project-display]").forEach((button) => {
            const active = !projectExpansion.size && button.dataset.workforceProjectDisplay === projectDisplay;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
        root.querySelectorAll("[data-workforce-worker-view]").forEach((button) => {
            const active = button.dataset.workforceWorkerView === workerDisplay;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", String(active));
        });
    }

    function renderProjectLanes() {
        const container = query("#workforceManagementLanes");
        const keyword = query("#workforceManagementSearch").value.trim().toLowerCase();
        const scopedLanes = projectScopedLanes();
        const lanes = scopedLanes.filter((lane) => laneMatches(lane, keyword)).sort(compareProjectLanes);
        const { capacity } = allocationState();
        const months = timelineMonths();
        container.replaceChildren();
        if (!lanes.length) {
            container.appendChild(element("p", "empty-state", "조회 조건에 해당하는 프로젝트가 없습니다."));
            return;
        }
        const fragment = document.createDocumentFragment();
        lanes.forEach((lane) => {
            const laneAssignments = boardAssignments(lane);
            const expanded = projectExpansion.get(lane.key) ?? (projectDisplay === "expanded");
            const article = element("article", `workforce-management-lane is-${laneCategory(lane)}`);
            article.classList.toggle("is-collapsed", !expanded);
            article.dataset.dropProjectLane = lane.key;
            const info = element("div", "workforce-management-lane-info");
            const heading = element("div", "workforce-management-lane-title");
            heading.append(element("strong", "", lane.name), element("span", `is-${laneCategory(lane)}`, statusLabel(lane)));
            const period = `${String(lane.startDate || "").slice(0, 10)} ~ ${String(lane.endDate || "").slice(0, 10)}`;
            info.append(heading, element("span", "", lane.customer), element("small", "", period));
            const toggle = element("button", "workforce-management-project-toggle", expanded ? "▾ 인력 접기" : "▸ 인력 펼치기");
            toggle.type = "button";
            toggle.dataset.workforceProjectToggle = lane.key;
            toggle.setAttribute("aria-expanded", String(expanded));
            toggle.setAttribute("aria-label", `${lane.name} 인력 ${expanded ? "접기" : "펼치기"}`);
            info.appendChild(toggle);
            if (lane.type === "confirmed") {
                const edit = element("button", "workforce-management-project-edit", "✎ 상세");
                edit.type = "button";
                edit.dataset.workforceEditor = "confirmed";
                edit.dataset.projectId = lane.projectId;
                edit.setAttribute("aria-label", `${lane.name} 프로젝트 상세 편집`);
                info.appendChild(edit);
            }

            const timeline = element("div", "workforce-management-lane-timeline");
            timeline.id = `workforce-management-lane-${encodeURIComponent(lane.key)}`;
            toggle.setAttribute("aria-controls", timeline.id);
            timeline.dataset.projectTimelineLane = lane.key;
            timeline.setAttribute("aria-label", `${lane.name} 프로젝트 기간과 투입 인력`);
            if (editMode && expanded) appendProjectDropCells(timeline, lane, Math.max(2, laneAssignments.length + 1), months);
            const projectPosition = timelinePosition(lane.startDate, lane.endDate, months);
            if (projectPosition) {
                const band = element("div", "workforce-management-project-period");
                band.style.gridColumn = `${projectPosition.start} / span ${projectPosition.span}`;
                band.style.gridRow = "1";
                band.setAttribute("aria-label", `프로젝트 기간 ${period}`);
                timeline.appendChild(band);
            }
            if (!expanded) appendProjectSummary(timeline, lane, laneAssignments, months, capacity);
            (expanded ? laneAssignments : []).forEach((assignment, index) => {
                const position = timelinePosition(
                    pick(assignment, "assignmentStartDate", "ASSIGNMENT_START_DATE"),
                    pick(assignment, "assignmentEndDate", "ASSIGNMENT_END_DATE"),
                    months
                );
                if (!position) return;
                const assignmentType = assignmentStatusCode(lane, assignment).toLowerCase();
                const bar = element("div", `workforce-management-assignment is-${assignmentType}${assignmentHasOverlap(assignment, lane, capacity) ? " has-overlap" : ""}`);
                bar.style.gridColumn = `${position.start} / span ${position.span}`;
                bar.style.gridRow = String(index + 2);
                decorateAssignmentNode(bar, lane, assignment);
                const worker = workerByKey(workerKey(assignment)) || assignment;
                const gradeCode = String(pick(worker, "technicalGradeCode", "TECHNICAL_GRADE_CODE") || "").toUpperCase();
                const grade = TECHNICAL_GRADE_LABELS[gradeCode] || "등급 미지정";
                const positionName = pick(worker, "positionName", "POSITION_NAME") || "직급 미지정";
                const roleName = pick(assignment, "projectRoleName", "PROJECT_ROLE_NAME") || "역할 미지정";
                const person = element("div", "workforce-management-assignment-person");
                const photo = workerPhoto(worker);
                photo.classList.add("is-assignment");
                const personCopy = element("div", "workforce-management-assignment-person-copy");
                const nameLink = element("button", "workforce-management-assignment-name", employeeName(assignment));
                nameLink.type = "button";
                nameLink.dataset.workerDetail = workerKey(assignment);
                nameLink.draggable = false;
                nameLink.setAttribute("aria-label", `${employeeName(assignment)} 인력 상세정보`);
                personCopy.append(
                    nameLink,
                    element("small", "", [pick(worker, "companyName", "COMPANY_NAME"), pick(worker, "departmentName", "DEPARTMENT_NAME")].filter(Boolean).join(" · ") || "소속 미지정")
                );
                const metadata = element("div", "workforce-management-assignment-metadata");
                [
                    `등급 ${grade}`,
                    `직급 ${positionName}`,
                    `역할 ${roleName}`,
                    `${assignmentStatusLabel(lane, assignment)} · ${fixed(pick(assignment, "totalMm", "TOTAL_MM"))} M/M`
                ].forEach((text) => metadata.appendChild(element("span", "", text)));
                personCopy.appendChild(metadata);
                person.append(photo, personCopy);
                const settings=element("button", "workforce-management-assignment-settings", "매출단가 수정");
                settings.type="button";
                settings.dataset.quickAssignment=assignmentIdentity(lane,assignment);
                settings.setAttribute("aria-label",`${employeeName(assignment)} 매출단가 수정`);
                bar.appendChild(person);
                const warningButton=assignmentWarningButton(assignment,lane,capacity);
                if (warningButton) bar.appendChild(warningButton);
                bar.appendChild(settings);
                if (bar.classList.contains("is-pending-order")) {
                    const orderChange = element("span", "workforce-management-assignment-order-change", "↕");
                    orderChange.title = "순서 변경 · 저장 대기";
                    orderChange.setAttribute("aria-hidden", "true");
                    bar.appendChild(orderChange);
                }
                {
                    const pendingRemoval = isPendingRemoval(assignmentIdentity(lane, assignment));
                    const remove = element("span", "workforce-management-assignment-remove", "×");
                    remove.dataset.removeAssignment = assignmentIdentity(lane, assignment);
                    remove.setAttribute("role", "button");
                    remove.setAttribute("tabindex", "0");
                    remove.setAttribute("aria-label", `${employeeName(assignment)} ${pendingRemoval ? "투입 해제 취소" : "투입 해제"}`);
                    remove.title = pendingRemoval ? "투입 해제 취소" : "투입 해제 표시";
                    remove.classList.toggle("is-undo", pendingRemoval);
                    bar.appendChild(remove);
                }
                bar.setAttribute(
                    "aria-label",
                    `${employeeName(assignment)} ${lane.name} 투입 편집${bar.classList.contains("is-pending-order") ? " · 순서 변경 저장 대기" : ""}`
                );
                timeline.appendChild(bar);
            });
            if (expanded && !laneAssignments.length) {
                const empty = element("span", "workforce-management-lane-empty", "등록된 투입 인력이 없습니다.");
                empty.style.gridColumn = "1 / -1";
                empty.style.gridRow = "2";
                timeline.appendChild(empty);
            }
            article.append(info, timeline);
            fragment.appendChild(article);
        });
        container.replaceChildren(fragment);
    }

    function visibleWorkers(lanes = projectScopedLanes()) {
        const keyword = query("#workforceManagementSearch").value.trim().toLowerCase();
        const nameKeyword = workerNameFilter.toLocaleLowerCase("ko-KR");
        const projectSelected = Boolean(selectedProjectId());
        return workerStatistics()
            .filter((worker) => workerMatchesType(worker, workerTypeFilter))
            .filter((worker) => !nameKeyword || String(pick(worker, "employeeName", "EMPLOYEE_NAME") || "").toLocaleLowerCase("ko-KR").includes(nameKeyword))
            .filter((worker) => !projectSelected || lanes.some((lane) => boardAssignments(lane).some((assignment) => workerKey(assignment) === worker.workerKey)))
            .filter((worker) => !keyword || [
                pick(worker, "employeeName", "EMPLOYEE_NAME"),
                pick(worker, "companyName", "COMPANY_NAME"),
                pick(worker, "departmentName", "DEPARTMENT_NAME"),
                pick(worker, "positionName", "POSITION_NAME")
            ].join(" ").toLowerCase().includes(keyword) || lanes.some((lane) => (
                laneMatches(lane, keyword)
                && boardAssignments(lane).some((assignment) => workerKey(assignment) === worker.workerKey)
            )))
            .sort(compareWorkers);
    }

    function departmentGroups(workers) {
        const groups = new Map();
        workers.forEach((worker) => {
            const code = String(pick(worker, "departmentCode", "DEPARTMENT_CODE") || "").toUpperCase();
            const name = String(pick(worker, "departmentName", "DEPARTMENT_NAME") || "");
            const department = departments.find((item) => String(item.code).toUpperCase() === code || (!code && item.label === name));
            const internal = worker.workerKey.startsWith("USER:");
            const company = pick(worker, "companyName", "COMPANY_NAME") || "소속 미지정";
            const key = internal ? (department?.code || code || name || "UNASSIGNED") : `PARTNER:${company}`;
            if (!groups.has(key)) groups.set(key, {
                key,
                label: internal ? (department?.label || name || "부서 미지정") : `협력업체 · ${company}`,
                order: internal ? Number(department?.displayOrder ?? 999) : 1000,
                workers: []
            });
            groups.get(key).workers.push(worker);
        });
        return [...groups.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, "ko"));
    }

    function departmentMonthSummary(workers, month, shownCapacity, totalCapacity) {
        let mm = 0, available = 0;
        const assignedWorkers = new Set();
        const overloadedWorkers = new Set();
        workers.forEach((worker) => {
            const key = `${worker.workerKey}|${month}`;
            const shownMm = shownCapacity.get(key)?.totalMm || 0;
            const totalMm = totalCapacity.get(key)?.totalMm || 0;
            const capacity = workerMonthlyCapacity(worker,month);
            if (shownMm > 0) assignedWorkers.add(worker.workerKey);
            mm += shownMm;
            available += Math.max(0, capacity - totalMm);
            if (totalMm > 1 + 0.000001) overloadedWorkers.add(worker.workerKey);
        });
        return { assigned: assignedWorkers.size, mm, available, overloaded: overloadedWorkers.size, assignedWorkers, overloadedWorkers };
    }

    function departmentPeriodSummary(workers, months, lanes, shownCapacity, totalCapacity) {
        const monthly = new Map();
        const assignedWorkers = new Set();
        const overloadedWorkers = new Set();
        let totalMm = 0, availableMm = 0, overloadedMonths = 0;
        months.forEach((month) => {
            const item = departmentMonthSummary(workers, month, shownCapacity, totalCapacity);
            monthly.set(month, item);
            item.assignedWorkers.forEach((key) => assignedWorkers.add(key));
            item.overloadedWorkers.forEach((key) => overloadedWorkers.add(key));
            totalMm += item.mm;
            availableMm += item.available;
            if (item.overloaded) overloadedMonths += 1;
        });
        const workerKeys = new Set(workers.map((worker) => worker.workerKey));
        const monthKeys = new Set(months);
        const projects = new Set();
        lanes.forEach((lane) => {
            if (boardAssignments(lane).some((assignment) => (
                workerKeys.has(workerKey(assignment))
                && !isPendingRemoval(assignmentIdentity(lane, assignment))
                && assignmentAllocations(assignment).some((allocation) => monthKeys.has(allocation.month) && allocation.mm > 0)
            ))) projects.add(String(lane.projectId || lane.key));
        });
        return { monthly, assigned: assignedWorkers.size, projectCount: projects.size, totalMm, availableMm, overloaded: overloadedWorkers.size, overloadedMonths };
    }

    function renderDepartmentInfo(group, summary, months) {
        const info = element("div", "workforce-management-worker-row-info");
        const name = element("strong", "", group.label);
        name.title = group.label;
        info.append(name, element("span", "", `조회 인력 ${group.workers.length}명`));
        const metrics = element("dl", "workforce-management-department-metrics");
        const rows = [
            ["기간 투입 인원", `${summary.assigned}명`, "표시 기간 동안 조회 프로젝트에 투입된 인력입니다. 같은 사람은 한 번만 계산합니다."],
            ["참여 프로젝트", `${summary.projectCount}개`, "표시 기간에 투입된 프로젝트 수입니다. 같은 프로젝트의 확정·계획 배치는 한 개로 계산합니다."],
            ["누적 투입", `${fixed(summary.totalMm)} M/M`, "조회 인력과 프로젝트의 표시 기간 투입 M/M 합계입니다."],
            ["가용 합계", `${fixed(summary.availableMm)} M/M`, "조회 인력의 전체 프로젝트 투입과 가용기간을 반영한 표시 기간의 잔여 M/M 합계입니다. 현재 시점의 가용인원 수가 아닙니다."],
            ["과부하", summary.overloaded ? `${summary.overloaded}명 · ${summary.overloadedMonths}개월` : "없음", "표시 기간에 과부하가 발생한 인력 수(중복 제외)와 과부하가 있었던 월 수입니다. 전체 프로젝트를 반영합니다."]
        ];
        rows.forEach(([label, value, title]) => {
            const metric = element("div", label === "과부하" && summary.overloaded ? "has-overload" : "");
            metric.title = title;
            metric.append(element("dt", "", label), element("dd", "", value));
            if(label!=="과부하" || summary.overloaded) detailTrigger(metric,{workerKeys:group.workers.map((w)=>w.workerKey),months,scopeLanes:workerMatrixLanes(),onlyWarnings:label==="과부하",availableOnly:label==="가용 합계",requireScopedAssignment:["기간 투입 인원","참여 프로젝트","누적 투입"].includes(label),title:`${group.label} · ${label} 월별 근거`});
            metrics.appendChild(metric);
        });
        info.appendChild(metrics);
        if (months.length) info.appendChild(element("small", "", `${months[0].replace("-", ".")} ~ ${months[months.length - 1].replace("-", ".")} 합계`));
        return info;
    }

    function renderDepartmentMatrix() {
        const container = query("#workforceManagementLanes");
        const lanes = workerMatrixLanes();
        const groups = departmentGroups(visibleWorkers(lanes));
        const { capacity: shownCapacity } = allocationState(lanes);
        const { capacity: totalCapacity } = allocationState();
        const months = timelineMonths();
        container.replaceChildren();
        if (!groups.length) {
            container.appendChild(element("p", "empty-state", "조회 조건에 해당하는 인력이 없습니다."));
            return;
        }
        groups.forEach((group) => {
            const row = element("article", "workforce-management-worker-row workforce-management-department-row");
            const summary = departmentPeriodSummary(group.workers, months, lanes, shownCapacity, totalCapacity);
            row.appendChild(renderDepartmentInfo(group, summary, months));
            months.forEach((month) => {
                const item = summary.monthly.get(month);
                const cell = element("div", "workforce-management-summary-month");
                cell.classList.toggle("has-overload", item.overloaded > 0);
                cell.append(
                    element("strong", "", `투입 ${item.assigned}명`),
                    element("span", "", `${fixed(item.mm)} M/M`),
                    element("small", "", `가용 ${fixed(item.available)}`)
                );
                if (item.overloaded) cell.append(element("small", "", `과부하 ${item.overloaded}명`));
                cell.title = `${month} · 조회 인력 ${group.workers.length}명 · 표시 프로젝트 투입 ${fixed(item.mm)} M/M · 전체 프로젝트 반영 가용 ${fixed(item.available)} M/M · 과부하 ${item.overloaded}명`;
                const keys=new Set([...item.assignedWorkers,...item.overloadedWorkers]);
                detailTrigger(cell,{workerKeys:keys.size?[...keys]:group.workers.map((w)=>w.workerKey),months:[month],scopeLanes:lanes,title:`${group.label} · ${month} 상세 대상과 사유`});
                row.appendChild(cell);
            });
            container.appendChild(row);
        });
    }

    function workerMatrixLanes() {
        const keyword = query("#workforceManagementSearch").value.trim().toLowerCase();
        const scopedLanes = projectScopedLanes().filter((lane) => projectFilter === "all" || laneCategory(lane) === projectFilter);
        const matchingLanes = keyword ? scopedLanes.filter((lane) => laneMatches(lane, keyword)) : [];
        return matchingLanes.length ? matchingLanes : scopedLanes;
    }

    function renderWorkerMatrix() {
        const container = query("#workforceManagementLanes");
        const lanes = workerMatrixLanes();
        const workers = visibleWorkers(lanes);
        const { capacity } = allocationState();
        container.replaceChildren();
        if (!workers.length) {
            container.appendChild(element("p", "empty-state", "조회 조건에 해당하는 인력이 없습니다."));
            return;
        }
        workers.forEach((worker) => {
            const row = element("article", "workforce-management-worker-row");
            const projects = [];
            lanes.forEach((lane) => {
                boardAssignments(lane).filter((item) => workerKey(item) === worker.workerKey)
                    .forEach((assignment) => projects.push({ lane, assignment }));
            });
            const rowCount = Math.max(1, projects.length);
            const workerCell = element("div", "workforce-management-worker-row-info is-person");
            workerCell.dataset.workerKey = worker.workerKey;
            workerCell.draggable = false;
            workerCell.style.gridRow = `1 / span ${rowCount}`;
            const identity = element("div", "workforce-management-worker-row-identity");
            const nameRow = element("div", "workforce-management-worker-row-name");
            const name=element("strong", "", employeeName(worker));
            name.title=employeeName(worker);
            const affiliation=element("span", "", [pick(worker, "companyName", "COMPANY_NAME"), pick(worker, "departmentName", "DEPARTMENT_NAME")].filter(Boolean).join(" · ") || "소속 정보 없음");
            affiliation.title=affiliation.textContent;
            nameRow.append(name,affiliation);
            identity.append(workerPhoto(worker),nameRow);
            const footer = element("div", "workforce-management-worker-row-footer");
            const detailButton = element("button", "workforce-management-worker-detail-button", "인력정보");
            detailButton.type = "button";
            detailButton.dataset.workerDetail = worker.workerKey;
            detailButton.draggable = false;
            detailButton.setAttribute("aria-label",`${employeeName(worker)} 인력정보 보기`);
            const loadButton=element("button","workforce-management-worker-detail-button workforce-management-worker-load-button","투입내역");
            loadButton.type="button";
            loadButton.setAttribute("aria-label",`${employeeName(worker)} 투입내역·경고 사유 보기`);
            loadButton.title="월별 투입량과 경고 사유 보기";
            loadButton.addEventListener("click",()=>openLoadDetails({workerKeys:[worker.workerKey],scopeLanes:lanes,title:`${employeeName(worker)} · 투입·경고 상세`}),{signal:controller.signal});
            const projectCount=new Set(projects.map(({lane})=>String(lane.projectId))).size;
            const summary=element("small", "", projectCount ? `${projectCount}개 사업` : "미투입");
            summary.title=`참여 프로젝트 ${projectCount}개`;
            const actions=element("div","workforce-management-worker-row-actions");
            actions.append(detailButton,loadButton);
            footer.append(summary,actions);
            workerCell.append(identity, footer);
            row.appendChild(workerCell);
            timelineMonths().forEach((month, index) => {
                const cell = element("div", "workforce-management-worker-month-cell workforce-management-worker-row-drop");
                cell.dataset.dropWorkerKey = worker.workerKey;
                cell.dataset.dropMonth = month;
                cell.style.gridColumn = String(index + 2);
                cell.style.gridRow = `1 / span ${rowCount}`;
                detailTrigger(cell,{workerKeys:[worker.workerKey],months:[month],scopeLanes:lanes});
                row.appendChild(cell);
            });
            projects.forEach(({ lane, assignment }, index) => {
                const position = timelinePosition(
                    pick(assignment, "assignmentStartDate", "ASSIGNMENT_START_DATE"),
                    pick(assignment, "assignmentEndDate", "ASSIGNMENT_END_DATE")
                );
                if (!position) return;
                const assignmentType = assignmentStatusCode(lane, assignment).toLowerCase();
                const bar = element("div", `workforce-management-worker-project-bar is-${assignmentType}${assignmentHasOverlap(assignment, lane, capacity) ? " has-overlap" : ""}`);
                bar.style.gridColumn = `${position.start + 1} / span ${position.span}`;
                bar.style.gridRow = String(index + 1);
                decorateAssignmentNode(bar, lane, assignment);
                const copy = element("button", "workforce-management-worker-project-copy");
                copy.type = "button";
                copy.dataset.quickAssignment = assignmentIdentity(lane, assignment);
                copy.append(
                    element("strong", "", lane.name),
                    element("small", "", `${assignmentStatusLabel(lane, assignment)} · ${dateText(pick(assignment, "assignmentStartDate", "ASSIGNMENT_START_DATE"))} ~ ${dateText(pick(assignment, "assignmentEndDate", "ASSIGNMENT_END_DATE"))} · ${fixed(pick(assignment, "totalMm", "TOTAL_MM"))} M/M`)
                );
                const settings = element("button", "workforce-management-assignment-settings", "매출단가 수정");
                settings.type = "button";
                settings.dataset.quickAssignment = assignmentIdentity(lane, assignment);
                settings.setAttribute("aria-label", `${lane.name} 매출단가 수정`);
                bar.appendChild(copy);
                const warningButton=assignmentWarningButton(assignment,lane,capacity);
                if (warningButton) bar.appendChild(warningButton);
                bar.appendChild(settings);
                row.appendChild(bar);
            });
            container.appendChild(row);
        });
    }

    function renderLanes() {
        return withRenderCalculationCache(() => {
            const descriptions = {
                worker: "인력별로 프로젝트 기간 막대를 나누어 여러 프로젝트 투입을 한 번에 비교합니다.",
                project: "프로젝트별 월 투입 인원과 M/M을 요약합니다. ‘인력 펼치기’로 개별 배치를 확인하고 편집할 수 있습니다."
            };
            query("#workforceManagementTimelineDescription").textContent = boardView === "worker" && workerDisplay === "department"
                ? "조회 인력의 사업부별 월 투입을 요약합니다. 가용 M/M·과부하는 전체 프로젝트를 합산하며, 협력업체는 회사별로 표시합니다."
                : descriptions[boardView];
            query("#workforceManagementTimelineDescription").textContent += " 요약 숫자·과부하 표시를 누르면 대상과 상세 사유를 확인할 수 있습니다.";
            if (boardView === "project") renderProjectLanes();
            else if (workerDisplay === "department") renderDepartmentMatrix();
            else renderWorkerMatrix();
            syncSummaryControls();
        });
    }

    function renderAll() {
        return withRenderCalculationCache(() => {
            renderProjectOptions();
            renderMetrics();
            renderAlerts();
            renderWorkers();
            renderProjectPalette();
            renderMonthHeader();
            renderLanes();
        });
    }

    async function loadDashboard(preferredScenarioId = "", preferredYear = null) {
        detailLayer?.close();
        const requestId = ++requestSequence;
        const requestedYear = Number(preferredYear);
        const year = Number.isInteger(requestedYear) && requestedYear >= 1900 && requestedYear <= 2100
            ? requestedYear
            : selectedYear();
        const requestedScenarioId = preferredScenarioId || scenario?.scenarioId || "";
        Common.ui.setInlineStatus(query("#workforceManagementStatus"), `${year}년과 수행기간이 겹치는 프로젝트와 투입정보를 불러오고 있습니다.`);
        query("#workforceManagementRefreshButton").disabled = true;
        try {
            const payload = await Common.api.request(
                `/workforce-management/bootstrap?planYear=${encodeURIComponent(year)}${requestedScenarioId ? `&scenarioId=${encodeURIComponent(requestedScenarioId)}` : ""}`,
                { signal: controller.signal, showLoading: false }
            );
            if (requestId !== requestSequence) return false;
            const dashboard = Common.data.get(payload) || {};
            establishmentYear = Number(dashboard.establishmentYear) || null;
            departments = Array.isArray(dashboard.departments)
                ? [...dashboard.departments]
                    .filter((department) => department?.code && department?.label)
                    .sort((left, right) => Number(left.displayOrder) - Number(right.displayOrder))
                : [];
            populateWorkerFilterOptions();
            initializeYears(year);
            confirmedData = dashboard.confirmed || { projects: [], assignments: [], companies: [] };
            references = dashboard.references || { workers: [], actualCapacity: [] };
            scenarios = dashboard.scenarios || [];
            scenario = dashboard.scenario || null;
            query("#workforceManagementBasisField").hidden = !scenario?.projects?.length;
            if (!scenario?.projects?.length) boardBasis = "project-status";
            query("#workforceManagementBasis").value = boardBasis;
            renderAll();
            requestAnimationFrame(() => {
                applyTimelineScale();
                if (boardRangeMode !== "full") scrollTimelineToSelectedYear();
            });
            Common.ui.setInlineStatus(
                query("#workforceManagementStatus"),
                `${year}년과 수행기간이 겹치는 확정 ${allLanes().filter((lane) => laneCategory(lane) === "confirmed").length}개, 계획 ${allLanes().filter((lane) => laneCategory(lane) === "planning").length}개 프로젝트를 조회했습니다.`,
                "success"
            );
            return true;
        } catch (error) {
            if (error?.name !== "AbortError" && requestId === requestSequence) {
                confirmedData = { projects: [], assignments: [], companies: [] };
                references = { workers: [], actualCapacity: [] };
                scenarios = [];
                scenario = null;
                renderAll();
                Common.ui.setInlineStatus(query("#workforceManagementStatus"), error.message || "통합 대시보드를 불러오지 못했습니다.", "error");
            }
            return false;
        } finally {
            if (requestId === requestSequence && query("#workforceManagementRefreshButton")) {
                query("#workforceManagementRefreshButton").disabled = false;
            }
        }
    }

    function scenarioSavePayload() {
        return {
            revisionNo: Number(scenario.revisionNo),
            scenarioName: scenario.scenarioName,
            description: scenario.description || "",
            projects: (scenario.projects || []).map((project) => ({
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
                assignments: (project.assignments || []).map((assignment) => {
                    const [workerType, workerId] = String(assignment.workerKey || workerKey(assignment)).split(":");
                    return {
                        employeeUserId: workerType === "USER" ? Number(workerId) : null,
                        companyEmployeeId: workerType === "COMPANY_EMPLOYEE" ? Number(workerId) : null,
                        assignmentStartDate: dateText(assignment.assignmentStartDate),
                        assignmentEndDate: dateText(assignment.assignmentEndDate),
                        costUnitPrice: integerText(assignment.costUnitPrice),
                        salesUnitPrice: integerText(assignment.salesUnitPrice),
                        projectRoleName: assignment.projectRoleName || "",
                        primaryDuty: assignment.primaryDuty || "",
                        monthlyAllocations: (assignment.monthlyAllocations || []).map((month) => ({
                            month: String(month.month || month.allocationMonth).slice(0, 7),
                            mm: number(month.mm)
                        })),
                        note: assignment.note || ""
                    };
                })
            }))
        };
    }

    async function savePlanningScenario() {
        if (!scenario?.scenarioId || String(scenario.statusCode || "DRAFT").toUpperCase() !== "DRAFT") {
            throw new Error("수정 가능한 임시 계획안이 없습니다. 계획 프로젝트 편집에서 임시 계획안을 준비해 주세요.");
        }
        const payload = await Common.api.request(`/planning/scenarios/${encodeURIComponent(scenario.scenarioId)}`, {
            method: "PUT",
            body: scenarioSavePayload(),
            signal: controller.signal,
            showLoading: false
        });
        scenario.revisionNo = Common.data.get(payload)?.revisionNo || Number(scenario.revisionNo) + 1;
    }

    function assignmentRequestBody(assignment, overrides = {}) {
        const key = overrides.workerKey || workerKey(assignment);
        const [workerType, workerId] = String(key).split(":");
        const startDate = overrides.startDate || dateText(pick(assignment, "assignmentStartDate", "ASSIGNMENT_START_DATE"));
        const endDate = overrides.endDate || dateText(pick(assignment, "assignmentEndDate", "ASSIGNMENT_END_DATE"));
        const allocations = overrides.monthlyAllocations || assignmentAllocations(assignment)
            .filter((item) => item.month >= startDate.slice(0, 7) && item.month <= endDate.slice(0, 7));
        return {
            employeeUserId: workerType === "USER" ? Number(workerId) : null,
            companyEmployeeId: workerType === "COMPANY_EMPLOYEE" ? Number(workerId) : null,
            projectCompanyId: Number(overrides.projectCompanyId || pick(assignment, "projectCompanyId", "PROJECT_COMPANY_ID")),
            assignmentStartDate: startDate,
            assignmentEndDate: endDate,
            assignmentStatusCode: String(overrides.assignmentStatusCode ?? pick(assignment, "assignmentStatusCode", "ASSIGNMENT_STATUS_CODE") ?? "CONFIRMED"),
            allocationTypeCode: pick(assignment, "allocationTypeCode", "ALLOCATION_TYPE_CODE") || "MONTHLY",
            defaultMm: number(overrides.defaultMm ?? pick(assignment, "defaultMm", "DEFAULT_MM") ?? 1),
            weeklyDayCodes: String(pick(assignment, "weeklyDayCodes", "WEEKLY_DAY_CODES") || "").split(",").filter(Boolean),
            monthlyAllocations: allocations.map((item) => ({ month: item.month, mm: number(item.mm) })),
            costUnitPrice: integerText(overrides.costUnitPrice ?? pick(assignment, "costUnitPrice", "COST_UNIT_PRICE")),
            salesUnitPrice: integerText(overrides.salesUnitPrice ?? pick(assignment, "salesUnitPrice", "SALES_UNIT_PRICE")),
            projectRoleName: String(overrides.projectRoleName ?? pick(assignment, "projectRoleName", "PROJECT_ROLE_NAME") ?? ""),
            primaryDuty: String(overrides.primaryDuty ?? pick(assignment, "primaryDuty", "PRIMARY_DUTY") ?? ""),
            note: String(overrides.note ?? pick(assignment, "note", "NOTE") ?? ""),
            versionToken: overrides.versionToken ?? pick(assignment, "versionToken", "VERSION_TOKEN") ?? null
        };
    }

    function assignmentContext(identity) {
        for (const lane of allLanes()) {
            const assignment = lane.assignments.find((item) => assignmentIdentity(lane, item) === identity);
            if (assignment) return { lane, assignment };
        }
        return null;
    }

    function monthPeriod(lane, month) {
        const projectStart = dateText(lane.startDate);
        const projectEnd = dateText(lane.endDate);
        const startDate = projectStart.slice(0, 7) === month ? projectStart : `${month}-01`;
        const endDate = projectEnd.slice(0, 7) === month ? projectEnd : lastDateOfMonth(month);
        if (!startDate || !endDate || startDate > endDate) throw new Error("선택한 투입 월을 확인해 주세요.");
        return { startDate, endDate };
    }

    function movedPeriod(lane, assignment, targetMonth) {
        const previous = assignmentAllocations(assignment);
        const span = Math.max(1, previous.length || monthsBetween(
            pick(assignment, "assignmentStartDate", "ASSIGNMENT_START_DATE"),
            pick(assignment, "assignmentEndDate", "ASSIGNMENT_END_DATE")
        ).length);
        const startDate = monthPeriod(lane, targetMonth).startDate;
        const endMonth = addMonths(targetMonth, span - 1);
        const endDate = monthPeriod(lane, endMonth).endDate;
        if (!startDate || !endDate || startDate > endDate) throw new Error("선택한 투입기간을 확인해 주세요.");
        const months = monthsBetween(startDate, endDate);
        const fallbackMm = number(pick(assignment, "defaultMm", "DEFAULT_MM") || 1);
        return {
            startDate,
            endDate,
            monthlyAllocations: months.map((month, index) => ({ month, mm: previous[index]?.mm ?? fallbackMm }))
        };
    }

    async function projectCompanyForWorker(lane, worker, availableCompanies = null) {
        let companies = availableCompanies;
        if (!Array.isArray(companies)) {
            const payload = await Common.api.request(`/project-assignments?projectId=${encodeURIComponent(lane.projectId)}`, {
                signal: controller.signal,
                showLoading: false
            });
            companies = Common.data.get(payload)?.companies || [];
        }
        const eligibility = workerCompanyEligibility(lane, worker);
        let company = eligibility.company;
        if (availableCompanies) {
            if (workerKey(worker).startsWith("USER:")) {
                company = companies.find((item) => String(pick(item, "companyTypeCode", "COMPANY_TYPE_CODE") || "").toUpperCase() === "HEADQUARTERS");
            } else {
                const workerCompanyId = String(pick(worker, "companyId", "COMPANY_ID") || "");
                company = companies.find((item) => workerCompanyId && String(pick(item, "companyId", "COMPANY_ID") || "") === workerCompanyId);
            }
        }
        if (!company) throw new Error(`${eligibility.reason || "인력의 소속회사와 프로젝트 참여회사가 일치하지 않습니다."} 프로젝트 관리 메뉴에서 참여회사를 등록해 주세요.`);
        return Number(pick(company, "projectCompanyId", "PROJECT_COMPANY_ID"));
    }

    async function runBoardMutation(message, task) {
        if (mutationBusy) return;
        mutationBusy = true;
        query("#workforceManagementBoard")?.classList.add("is-saving");
        Common.ui.setInlineStatus(query("#workforceManagementBoardStatus"), message);
        try {
            await task();
            try {
                await loadDashboard(scenario?.scenarioId || "");
                if (editorEntry?.module.refresh) await editorEntry.module.refresh();
            } catch (refreshError) {
                Common.ui.setInlineStatus(
                    query("#workforceManagementBoardStatus"),
                    `저장은 완료했지만 보드를 다시 불러오지 못했습니다. 조회를 눌러 확인해 주세요. (${refreshError.message || "갱신 오류"})`,
                    "warning"
                );
                Common.ui.toast("저장은 완료했습니다. 보드를 다시 조회해 주세요.", "warning");
                return true;
            }
            Common.ui.setInlineStatus(query("#workforceManagementBoardStatus"), "보드 변경사항을 저장했습니다.", "success");
            Common.ui.toast("투입 배치를 저장했습니다.", "success");
            return true;
        } catch (error) {
            Common.ui.setInlineStatus(query("#workforceManagementBoardStatus"), error.message || "투입 배치를 저장하지 못했습니다.", "error");
            return false;
        } finally {
            mutationBusy = false;
            query("#workforceManagementBoard")?.classList.remove("is-saving");
        }
    }

    async function addWorkerToLane(lane, workerKeyValue, month, options = {}) {
        const worker = workerByKey(workerKeyValue);
        if (!lane || !worker) throw new Error("배치할 인력 또는 프로젝트를 찾지 못했습니다.");
        const duplicate = lane.assignments.some((assignment) => (
            workerKey(assignment) === workerKeyValue
            && assignmentAllocations(assignment).some((allocation) => allocation.month === month)
        ));
        if (duplicate) throw new Error("해당 인력은 선택한 프로젝트와 월에 이미 배치되어 있습니다.");
        const defaultPeriod = monthPeriod(lane, month);
        const startDate = options.startDate || defaultPeriod.startDate;
        const endDate = options.endDate || defaultPeriod.endDate;
        const mm = number(options.mm ?? 1);
        const monthlyAllocations = options.monthlyAllocations?.length
            ? options.monthlyAllocations
            : monthsBetween(startDate, endDate).map((allocationMonth) => ({ month: allocationMonth, mm }));
        if (lane.type === "planning") {
            const project = scenario.projects.find((item) => String(item.scenarioProjectId) === String(lane.scenarioProjectId));
            if (!project) throw new Error("계획 프로젝트를 찾지 못했습니다.");
            project.assignments.push({
                clientKey: `board-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                workerKey: workerKeyValue,
                employeeName: pick(worker, "employeeName", "EMPLOYEE_NAME") || "이름 미정",
                companyName: pick(worker, "companyName", "COMPANY_NAME") || "소속 미정",
                assignmentStartDate: startDate,
                assignmentEndDate: endDate,
                costUnitPrice: integerText(options.costUnitPrice),
                salesUnitPrice: integerText(options.salesUnitPrice),
                projectRoleName: options.projectRoleName || "",
                primaryDuty: options.primaryDuty || "",
                note: options.note || "",
                monthlyAllocations
            });
            await savePlanningScenario();
            return;
        }
        const projectCompanyId = await projectCompanyForWorker(lane, worker);
        await Common.api.request(`/project-assignments/${encodeURIComponent(lane.projectId)}/assignments`, {
            method: "POST",
            body: assignmentRequestBody({}, {
                workerKey: workerKeyValue,
                projectCompanyId,
                startDate,
                endDate,
                assignmentStatusCode: options.assignmentStatusCode || "CONFIRMED",
                monthlyAllocations,
                defaultMm: mm,
                costUnitPrice: options.costUnitPrice,
                salesUnitPrice: options.salesUnitPrice,
                projectRoleName: options.projectRoleName,
                primaryDuty: options.primaryDuty,
                note: options.note,
                versionToken: null
            }),
            signal: controller.signal,
            showLoading: false
        });
    }

    async function removeAssignment(identity) {
        const context = assignmentContext(identity);
        if (!context) throw new Error("해제할 투입정보를 찾지 못했습니다.");
        const { lane, assignment } = context;
        if (lane.type === "planning") {
            const project = scenario.projects.find((item) => String(item.scenarioProjectId) === String(lane.scenarioProjectId));
            project.assignments = project.assignments.filter((item) => item !== assignment);
            await savePlanningScenario();
            return;
        }
        const assignmentId = pick(assignment, "assignmentId", "ASSIGNMENT_ID");
        const versionToken = pick(assignment, "versionToken", "VERSION_TOKEN");
        await Common.api.request(`/project-assignments/${encodeURIComponent(lane.projectId)}/assignments/${encodeURIComponent(assignmentId)}?versionToken=${encodeURIComponent(versionToken)}`, {
            method: "DELETE",
            signal: controller.signal,
            showLoading: false
        });
    }

    async function requestAssignmentRemoval(identity) {
        if (!editMode && !await setEditMode(true)) return;
        toggleAssignmentRemoval(identity);
    }

    async function moveAssignment(identity, targetLane, month) {
        const context = assignmentContext(identity);
        if (!context) throw new Error("이동할 투입정보를 찾지 못했습니다.");
        if (context.lane.key !== targetLane.key) {
            await addWorkerToLane(targetLane, workerKey(context.assignment), month);
            return;
        }
        const { lane, assignment } = context;
        const { startDate, endDate, monthlyAllocations } = movedPeriod(lane, assignment, month);
        if (lane.type === "planning") {
            assignment.assignmentStartDate = startDate;
            assignment.assignmentEndDate = endDate;
            assignment.monthlyAllocations = monthlyAllocations;
            await savePlanningScenario();
            return;
        }
        const assignmentId = pick(assignment, "assignmentId", "ASSIGNMENT_ID");
        await Common.api.request(`/project-assignments/${encodeURIComponent(lane.projectId)}/assignments/${encodeURIComponent(assignmentId)}`, {
            method: "PUT",
            body: assignmentRequestBody(assignment, { startDate, endDate, monthlyAllocations }),
            signal: controller.signal,
            showLoading: false
        });
    }

    function quickRangeMonths() {
        if (!quickContext) return yearMonths();
        const lane = laneByKey(quickContext.laneKey);
        const selectedStart = query("#workforceManagementQuickStart")?.value || "";
        const selectedEnd = query("#workforceManagementQuickEnd")?.value || "";
        const laneStart = lane ? dateText(lane.startDate) : "";
        const laneEnd = lane ? dateText(lane.endDate) : "";
        const rangeStart = selectedStart && (!laneStart || selectedStart < laneStart) ? selectedStart : laneStart;
        const rangeEnd = selectedEnd && (!laneEnd || selectedEnd > laneEnd) ? selectedEnd : laneEnd;
        const months = rangeStart && rangeEnd && rangeStart <= rangeEnd ? monthsBetween(rangeStart, rangeEnd) : [];
        return months.length ? months : yearMonths();
    }

    function quickMonthLabel(month, includeYear = false) {
        return includeYear ? `${month.slice(0, 4)}.${month.slice(5, 7)}` : `${Number(month.slice(5, 7))}월`;
    }

    function renderQuickMonths() {
        const container = query("#workforceManagementQuickMonths");
        if (!container) return;
        const startMonth = query("#workforceManagementQuickStart").value.slice(0, 7);
        const endMonth = query("#workforceManagementQuickEnd").value.slice(0, 7);
        const months = quickRangeMonths();
        const firstMonth = months[0];
        const lastMonth = months[months.length - 1];
        const clippedStart = startMonth < firstMonth ? firstMonth : startMonth > lastMonth ? lastMonth : startMonth;
        const clippedEnd = endMonth > lastMonth ? lastMonth : endMonth < firstMonth ? firstMonth : endMonth;
        const startIndex = Math.max(0, months.indexOf(clippedStart));
        const endIndex = Math.max(startIndex, months.indexOf(clippedEnd));
        container.replaceChildren();
        const boundaries = element("div", "workforce-management-quick-range-boundaries");
        boundaries.append(
            element("strong", "", `FROM ${clippedStart.slice(0, 4)}년 ${Number(clippedStart.slice(5, 7))}월`),
            element("strong", "", `TO ${clippedEnd.slice(0, 4)}년 ${Number(clippedEnd.slice(5, 7))}월`)
        );
        const labels = element("div", "workforce-management-quick-month-labels");
        labels.style.gridTemplateColumns = `repeat(${months.length}, minmax(0, 1fr))`;
        const spansMultipleYears = firstMonth.slice(0, 4) !== lastMonth.slice(0, 4);
        months.forEach((month, index) => {
            if (months.length > 12 && index !== 0 && index !== months.length - 1 && !month.endsWith("-01")) return;
            const label = element("span", month >= clippedStart && month <= clippedEnd ? "is-selected" : "", quickMonthLabel(month, spansMultipleYears));
            label.style.gridColumn = String(index + 1);
            labels.appendChild(label);
        });
        const track = element("div", "workforce-management-quick-range-track");
        track.dataset.quickRangeTrack = "true";
        const selection = element("div", "workforce-management-quick-range-selection");
        selection.style.left = `${startIndex / months.length * 100}%`;
        selection.style.width = `${(endIndex - startIndex + 1) / months.length * 100}%`;
        const startHandle = element("button", `workforce-management-quick-range-handle is-start${quickMonthDragHandle === "start" ? " is-dragging" : ""}`);
        startHandle.type = "button";
        startHandle.dataset.quickRangeHandle = "start";
        startHandle.setAttribute("aria-label", `투입 시작 월 ${clippedStart.slice(0, 4)}년 ${Number(clippedStart.slice(5, 7))}월`);
        startHandle.style.left = `${startIndex / months.length * 100}%`;
        const endHandle = element("button", `workforce-management-quick-range-handle is-end${quickMonthDragHandle === "end" ? " is-dragging" : ""}`);
        endHandle.type = "button";
        endHandle.dataset.quickRangeHandle = "end";
        endHandle.setAttribute("aria-label", `투입 종료 월 ${clippedEnd.slice(0, 4)}년 ${Number(clippedEnd.slice(5, 7))}월`);
        endHandle.style.left = `${(endIndex + 1) / months.length * 100}%`;
        track.append(selection, startHandle, endHandle);
        container.append(boundaries, labels, track);
    }

    function quickRangeMonthAt(clientX) {
        const track = query("#workforceManagementQuickMonths [data-quick-range-track]");
        const months = quickRangeMonths();
        if (!track || !months.length) return "";
        const rect = track.getBoundingClientRect();
        if (!rect.width) return "";
        const ratio = Math.max(0, Math.min(0.999999, (clientX - rect.left) / rect.width));
        return months[Math.floor(ratio * months.length)];
    }

    function nearestQuickRangeHandle(month) {
        const months = quickRangeMonths();
        const targetIndex = months.indexOf(month);
        const startIndex = months.indexOf(query("#workforceManagementQuickStart").value.slice(0, 7));
        const endIndex = months.indexOf(query("#workforceManagementQuickEnd").value.slice(0, 7));
        if (targetIndex < 0) return "";
        if (startIndex < 0) return "start";
        if (endIndex < 0) return "end";
        return targetIndex - startIndex < endIndex - targetIndex ? "start" : "end";
    }

    function setQuickRangeHandleMonth(handle, requestedMonth) {
        if (!quickContext || !requestedMonth) return;
        const lane = laneByKey(quickContext.laneKey);
        const months = quickRangeMonths();
        const startMonth = query("#workforceManagementQuickStart").value.slice(0, 7);
        const endMonth = query("#workforceManagementQuickEnd").value.slice(0, 7);
        const minimumMonth = months[0];
        const maximumMonth = months[months.length - 1];
        if (handle === "start") {
            const targetMonth = requestedMonth < minimumMonth ? minimumMonth : requestedMonth > endMonth ? endMonth : requestedMonth;
            if (targetMonth === startMonth) return;
            query("#workforceManagementQuickStart").value = monthPeriod(lane, targetMonth).startDate;
        } else {
            const targetMonth = requestedMonth > maximumMonth ? maximumMonth : requestedMonth < startMonth ? startMonth : requestedMonth;
            if (targetMonth === endMonth) return;
            query("#workforceManagementQuickEnd").value = monthPeriod(lane, targetMonth).endDate;
        }
        syncQuickPreview();
    }

    function activeQuickMonths() {
        const startDate = query("#workforceManagementQuickStart").value;
        const endDate = query("#workforceManagementQuickEnd").value;
        return startDate && endDate && startDate <= endDate ? monthsBetween(startDate, endDate) : [];
    }

    function ensureQuickMonthlyAllocations() {
        const fallback = number(query("#workforceManagementQuickMm").value);
        const active = new Set(activeQuickMonths());
        active.forEach((month) => {
            if (!quickMonthlyAllocations.has(month)) quickMonthlyAllocations.set(month, fallback);
        });
        Array.from(quickMonthlyAllocations.keys()).forEach((month) => {
            if (!active.has(month)) quickMonthlyAllocations.delete(month);
        });
    }

    function quickAllocationList() {
        return activeQuickMonths().map((month) => ({
            month,
            mm: number(quickMonthlyAllocations.get(month))
        }));
    }

    function quickTotalMm() {
        return quickAllocationList().reduce((total, item) => total + item.mm, 0);
    }

    function renderQuickAllocationInputs() {
        const container = query("#workforceManagementQuickAllocationInputs");
        if (!container) return;
        container.replaceChildren();
        const allocations = quickAllocationList();
        const multipleYears = new Set(allocations.map((allocation) => allocation.month.slice(0, 4))).size > 1;
        allocations.forEach((allocation, index) => {
            const year = allocation.month.slice(0, 4);
            const previousYear = allocations[index - 1]?.month.slice(0, 4);
            const label = element("label", `workforce-management-quick-allocation${multipleYears && year !== previousYear ? " is-year-start" : ""}`);
            label.appendChild(element("span", "", quickMonthLabel(allocation.month, multipleYears)));
            const input = element("input", "input");
            input.type = "number";
            input.min = "0";
            input.max = "1";
            input.step = "0.01";
            input.required = true;
            input.value = allocation.mm;
            input.dataset.allocationMonth = allocation.month;
            input.setAttribute("aria-label", `${allocation.month} M/M`);
            label.appendChild(input);
            container.appendChild(label);
        });
        const totalInput = query("#workforceManagementQuickTotalMm");
        totalInput.max = String(activeQuickMonths().length);
        totalInput.value = quickTotalMm().toFixed(2).replace(/\.00$/, "");
    }

    function updateQuickAllocationPreview() {
        const totalInput = query("#workforceManagementQuickTotalMm");
        totalInput.max = String(activeQuickMonths().length);
        totalInput.value = quickTotalMm().toFixed(2).replace(/\.00$/, "");
        if (!quickContext?.preview) return;
        quickContext.preview.defaultMm = number(query("#workforceManagementQuickMm").value);
        quickContext.preview.totalMm = quickTotalMm();
        quickContext.preview.monthlyAllocations = quickAllocationList();
        renderLanes();
    }

    function applyDefaultMmToQuickMonths() {
        const defaultInput = query("#workforceManagementQuickMm");
        if (!defaultInput.reportValidity()) return;
        if (!activeQuickMonths().length) {
            Common.ui.setInlineStatus(query("#workforceManagementQuickStatus"), "투입 기간을 먼저 선택해 주세요.", "error");
            return;
        }
        const mm = number(defaultInput.value);
        activeQuickMonths().forEach((month) => quickMonthlyAllocations.set(month, mm));
        renderQuickAllocationInputs();
        updateQuickAllocationPreview();
        Common.ui.setInlineStatus(query("#workforceManagementQuickStatus"), `선택한 ${activeQuickMonths().length}개월에 ${mm} M/M을 동일 적용했습니다.`, "success");
    }

    function distributeQuickTotalMm() {
        const months = activeQuickMonths();
        const totalInput = query("#workforceManagementQuickTotalMm");
        if (!months.length) {
            Common.ui.setInlineStatus(query("#workforceManagementQuickStatus"), "투입 기간을 먼저 선택해 주세요.", "error");
            return;
        }
        totalInput.max = String(months.length);
        if (!totalInput.reportValidity()) return;
        const total = Number(totalInput.value);
        const totalCents = Math.round(total * 100);
        if (!Number.isFinite(total) || total < 0 || total > months.length) {
            Common.ui.setInlineStatus(query("#workforceManagementQuickStatus"), `총 M/M은 0부터 ${months.length}까지 입력해 주세요.`, "error");
            totalInput.focus();
            return;
        }
        const baseCents = Math.floor(totalCents / months.length);
        const remainder = totalCents - (baseCents * months.length);
        months.forEach((month, index) => {
            quickMonthlyAllocations.set(month, (baseCents + (index < remainder ? 1 : 0)) / 100);
        });
        renderQuickAllocationInputs();
        updateQuickAllocationPreview();
        Common.ui.setInlineStatus(query("#workforceManagementQuickStatus"), `총 ${totalCents / 100} M/M을 ${months.length}개월에 배분했습니다.`, "success");
    }

    function quickOptions() {
        return {
            startDate: query("#workforceManagementQuickStart").value,
            endDate: query("#workforceManagementQuickEnd").value,
            assignmentStatusCode: query("#workforceManagementQuickAssignmentStatus").value,
            mm: number(query("#workforceManagementQuickMm").value),
            monthlyAllocations: quickAllocationList(),
            costUnitPrice: query("#workforceManagementQuickCost").value,
            salesUnitPrice: query("#workforceManagementQuickSales").value || "0",
            projectRoleName: query("#workforceManagementQuickRole").value.trim(),
            primaryDuty: query("#workforceManagementQuickPrimaryDuty").value.trim(),
            note: query("#workforceManagementQuickNote").value.trim()
        };
    }

    function syncQuickPreview() {
        if (!quickContext) return;
        const options = quickOptions();
        ensureQuickMonthlyAllocations();
        renderQuickMonths();
        renderQuickAllocationInputs();
        if (quickContext.preview && options.startDate && options.endDate && options.startDate <= options.endDate) {
            quickContext.preview.assignmentStartDate = options.startDate;
            quickContext.preview.assignmentEndDate = options.endDate;
            quickContext.preview.assignmentStatusCode = options.assignmentStatusCode;
            quickContext.preview.defaultMm = options.mm;
            quickContext.preview.totalMm = quickTotalMm();
            quickContext.preview.monthlyAllocations = quickAllocationList();
            editorEntry?.module.updateDraft?.({
                startDate: options.startDate,
                endDate: options.endDate,
                assignmentStatusCode: options.assignmentStatusCode,
                totalMm: quickContext.preview.totalMm
            });
            renderMonthHeader();
            renderLanes();
        }
    }

    function fillQuickDialog(context) {
        const lane = laneByKey(context.laneKey);
        const worker = workerByKey(context.workerKey) || context.assignment || {};
        const assignment = context.assignment || context.preview;
        const draftMode = context.mode === "batch-draft" || context.mode === "main-draft";
        query("#workforceManagementQuickTitle").textContent = context.mode === "create"
            ? "투입 빠른 추가"
            : draftMode
                ? "투입 빠른 설정 · 편집중"
                : "투입 빠른 설정";
        query("#workforceManagementQuickProject").textContent = `${lane.name} · ${dateText(lane.startDate)} ~ ${dateText(lane.endDate)}`;
        query("#workforceManagementQuickWorker").textContent = employeeName(worker);
        query("#workforceManagementQuickCompany").textContent = pick(worker, "companyName", "COMPANY_NAME") || "소속 미정";
        query("#workforceManagementQuickStart").removeAttribute("min");
        query("#workforceManagementQuickStart").removeAttribute("max");
        query("#workforceManagementQuickEnd").removeAttribute("min");
        query("#workforceManagementQuickEnd").removeAttribute("max");
        query("#workforceManagementQuickStart").value = dateText(pick(assignment, "assignmentStartDate", "ASSIGNMENT_START_DATE"));
        query("#workforceManagementQuickEnd").value = dateText(pick(assignment, "assignmentEndDate", "ASSIGNMENT_END_DATE"));
        query("#workforceManagementQuickAssignmentStatus").value = assignmentStatusCode(lane, assignment);
        query("#workforceManagementQuickStatusLabel").textContent = "투입 구분";
        query("#workforceManagementQuickStatusHelp").textContent = boardBasis === "project-status" ? "프로젝트 진행상태 자동 적용" : "기존 계획안의 투입 구분";
        query("#workforceManagementQuickAssignmentStatus").disabled = boardBasis === "project-status" || lane.type === "planning";
        query("#workforceManagementQuickAssignmentStatus").title = boardBasis === "project-status" ? "프로젝트 진행상태에서 자동 결정됩니다." : "기존 계획안의 투입 구분";
        const allocations = assignmentAllocations(assignment);
        const mm = allocations[0]?.mm ?? number(pick(assignment, "defaultMm", "DEFAULT_MM") ?? 1);
        quickMonthlyAllocations = new Map(allocations.map((item) => [item.month, number(item.mm)]));
        query("#workforceManagementQuickMm").value = mm;
        query("#workforceManagementQuickMmRange").value = mm;
        query("#workforceManagementQuickCost").value = integerText(pick(assignment, "costUnitPrice", "COST_UNIT_PRICE"));
        query("[data-workforce-admin-cost]").hidden = String(pageContext?.user?.roleCode || "USER").toUpperCase() !== "ADMIN";
        query("#workforceManagementQuickSales").value = integerText(pick(assignment, "salesUnitPrice", "SALES_UNIT_PRICE"));
        query("#workforceManagementQuickRole").value = pick(assignment, "projectRoleName", "PROJECT_ROLE_NAME") || "";
        query("#workforceManagementQuickPrimaryDuty").value = pick(assignment, "primaryDuty", "PRIMARY_DUTY") || "";
        query("#workforceManagementQuickNote").value = pick(assignment, "note", "NOTE") || "";
        const deleteButton = query("#workforceManagementQuickDelete");
        deleteButton.hidden = context.mode === "create";
        deleteButton.textContent = draftMode
            ? "임시 배치 취소"
            : isPendingRemoval(context.identity) ? "투입 해제 취소" : "투입 해제 표시";
        query("#workforceManagementQuickApplyDraft").hidden = !draftMode;
        query("#workforceManagementQuickSubmit").textContent = "저장하고 보드 반영";
        Common.ui.setInlineStatus(
            query("#workforceManagementQuickStatus"),
            draftMode
                ? "설정만 적용하면 편집중 상태로 유지되고, 저장하고 보드 반영을 누르면 이 인력만 즉시 저장됩니다."
                : "기간 막대를 클릭하면 가까운 핸들이 이동하며, 양쪽 핸들을 끌어 시작·종료 월을 각각 조정할 수 있습니다."
        );
        ensureQuickMonthlyAllocations();
        renderQuickMonths();
        renderQuickAllocationInputs();
    }

    function openQuickCreate(lane, workerKeyValue, month) {
        const worker = workerByKey(workerKeyValue);
        if (!lane || !worker) throw new Error("배치할 인력 또는 프로젝트를 찾지 못했습니다.");
        const duplicate = lane.assignments.some((assignment) => workerKey(assignment) === workerKeyValue);
        if (duplicate) {
            const assignment = lane.assignments.find((item) => workerKey(item) === workerKeyValue);
            openQuickEdit(assignmentIdentity(lane, assignment));
            return;
        }
        const period = { startDate: dateText(lane.startDate), endDate: dateText(lane.endDate) };
        const monthlyAllocations = monthsBetween(period.startDate, period.endDate).map((allocationMonth) => ({ month: allocationMonth, mm: 1 }));
        const preview = {
            clientKey: `preview-${Date.now()}`,
            workerKey: workerKeyValue,
            employeeName: pick(worker, "employeeName", "EMPLOYEE_NAME") || "이름 미정",
            companyName: pick(worker, "companyName", "COMPANY_NAME") || "소속 미정",
            assignmentStartDate: period.startDate,
            assignmentEndDate: period.endDate,
            assignmentStatusCode: assignmentStatusCode(lane, {}),
            defaultMm: 1,
            totalMm: monthlyAllocations.length,
            monthlyAllocations
        };
        quickContext = { mode: "create", laneKey: lane.key, workerKey: workerKeyValue, month, preview };
        renderLanes();
        fillQuickDialog(quickContext);
        const dialog = query("#workforceManagementQuickDialog");
        dialog.dataset.dragX = "0";
        dialog.dataset.dragY = "0";
        dialog.style.setProperty("--workforce-quick-x", "0px");
        dialog.style.setProperty("--workforce-quick-y", "0px");
        dialog.showModal();
        query("#workforceManagementQuickStart").focus();
    }

    function openQuickSales(identity) {
        openQuickEdit(identity);
        const field = query("#workforceManagementQuickSales");
        field.focus();
        field.scrollIntoView({block:"center",behavior:"instant"});
        field.select();
    }

    function openQuickEdit(identity) {
        if (String(identity).startsWith("draft:")) {
            const draftKey = String(identity).slice(6);
            const draft = editDrafts.find((item) => item.editDraftKey === draftKey);
            const lane = draft ? laneByKey(draft.laneKey) : null;
            if (!draft || !lane) throw new Error("편집할 임시 투입정보를 찾지 못했습니다.");
            quickContext = {
                mode: "main-draft",
                draftId: draft.editDraftKey,
                laneKey: lane.key,
                workerKey: workerKey(draft),
                assignment: draft
            };
            fillQuickDialog(quickContext);
            const dialog = query("#workforceManagementQuickDialog");
            dialog.dataset.dragX = "0";
            dialog.dataset.dragY = "0";
            dialog.style.setProperty("--workforce-quick-x", "0px");
            dialog.style.setProperty("--workforce-quick-y", "0px");
            dialog.showModal();
            query("#workforceManagementQuickStart").focus();
            return;
        }
        const context = assignmentContext(identity);
        if (!context) throw new Error("수정할 투입정보를 찾지 못했습니다.");
        quickContext = {
            mode: "edit",
            identity,
            laneKey: context.lane.key,
            workerKey: workerKey(context.assignment),
            assignment: context.assignment
        };
        fillQuickDialog(quickContext);
        const dialog = query("#workforceManagementQuickDialog");
        dialog.dataset.dragX = "0";
        dialog.dataset.dragY = "0";
        dialog.style.setProperty("--workforce-quick-x", "0px");
        dialog.style.setProperty("--workforce-quick-y", "0px");
        dialog.showModal();
        query("#workforceManagementQuickStart").focus();
    }

    function openQuickDraft(detail) {
        const lane = laneByKey(`confirmed:${detail.projectId}`);
        if (!lane || !detail.assignment || !detail.workerKey) throw new Error("편집할 임시 투입정보를 찾지 못했습니다.");
        quickContext = {
            mode: "batch-draft",
            draftId: String(detail.draftId || pick(detail.assignment, "assignmentId", "ASSIGNMENT_ID")),
            laneKey: lane.key,
            workerKey: detail.workerKey,
            assignment: detail.assignment
        };
        fillQuickDialog(quickContext);
        const dialog = query("#workforceManagementQuickDialog");
        dialog.dataset.dragX = "0";
        dialog.dataset.dragY = "0";
        dialog.style.setProperty("--workforce-quick-x", "0px");
        dialog.style.setProperty("--workforce-quick-y", "0px");
        dialog.showModal();
        query("#workforceManagementQuickStart").focus();
    }

    function closeQuickDialog() {
        query("#workforceManagementQuickDialog")?.close();
        quickContext = null;
        quickMonthDragHandle = "";
        quickMonthlyAllocations = new Map();
        quickDialogDrag = null;
        renderLanes();
    }

    function handleQuickDialogPointerDown(event) {
        if (event.target.closest("button, input, select, textarea, a")) return;
        const dialog = query("#workforceManagementQuickDialog");
        quickDialogDrag = {
            startX: event.clientX,
            startY: event.clientY,
            baseX: Number(dialog.dataset.dragX || 0),
            baseY: Number(dialog.dataset.dragY || 0)
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.currentTarget.classList.add("is-dragging");
        event.preventDefault();
    }

    function handleQuickDialogPointerMove(event) {
        if (!quickDialogDrag) return;
        const dialog = query("#workforceManagementQuickDialog");
        const nextX = quickDialogDrag.baseX + event.clientX - quickDialogDrag.startX;
        const nextY = quickDialogDrag.baseY + event.clientY - quickDialogDrag.startY;
        dialog.dataset.dragX = String(nextX);
        dialog.dataset.dragY = String(nextY);
        dialog.style.setProperty("--workforce-quick-x", `${nextX}px`);
        dialog.style.setProperty("--workforce-quick-y", `${nextY}px`);
    }

    function handleQuickDialogPointerUp(event) {
        if (!quickDialogDrag) return;
        quickDialogDrag = null;
        event.currentTarget.classList.remove("is-dragging");
        event.currentTarget.releasePointerCapture?.(event.pointerId);
    }

    async function updateAssignmentDetails(identity, options) {
        const context = assignmentContext(identity);
        if (!context) throw new Error("수정할 투입정보를 찾지 못했습니다.");
        const { lane, assignment } = context;
        if (options.startDate > options.endDate) {
            throw new Error("투입 종료일은 시작일보다 빠를 수 없습니다.");
        }
        const monthlyAllocations = options.monthlyAllocations?.length
            ? options.monthlyAllocations
            : monthsBetween(options.startDate, options.endDate).map((month) => ({ month, mm: options.mm }));
        if (lane.type === "planning") {
            assignment.assignmentStartDate = options.startDate;
            assignment.assignmentEndDate = options.endDate;
            assignment.costUnitPrice = integerText(options.costUnitPrice);
            assignment.salesUnitPrice = integerText(options.salesUnitPrice);
            assignment.projectRoleName = options.projectRoleName;
            assignment.primaryDuty = options.primaryDuty;
            assignment.note = options.note;
            assignment.monthlyAllocations = monthlyAllocations;
            await savePlanningScenario();
            return;
        }
        const assignmentId = pick(assignment, "assignmentId", "ASSIGNMENT_ID");
        await Common.api.request(`/project-assignments/${encodeURIComponent(lane.projectId)}/assignments/${encodeURIComponent(assignmentId)}`, {
            method: "PUT",
            body: assignmentRequestBody(assignment, {
                startDate: options.startDate,
                endDate: options.endDate,
                assignmentStatusCode: options.assignmentStatusCode,
                monthlyAllocations,
                defaultMm: options.mm,
                costUnitPrice: options.costUnitPrice,
                salesUnitPrice: options.salesUnitPrice,
                projectRoleName: options.projectRoleName,
                primaryDuty: options.primaryDuty,
                note: options.note
            }),
            signal: controller.signal,
            showLoading: false
        });
    }

    function validatedQuickOptions(form = query("#workforceManagementQuickForm")) {
        if (!quickContext || !form?.reportValidity()) return null;
        const options = quickOptions();
        const lane = laneByKey(quickContext.laneKey);
        if (!lane || options.startDate > options.endDate) {
            Common.ui.setInlineStatus(query("#workforceManagementQuickStatus"), "투입 종료일은 시작일보다 빠를 수 없습니다.", "error");
            return null;
        }
        return { lane, options: { ...options, totalMm: quickTotalMm() } };
    }

    function stageQuickDraftSettings() {
        if (!quickContext || !["batch-draft", "main-draft"].includes(quickContext.mode)) return;
        const validated = validatedQuickOptions();
        if (!validated) return;
        if (quickContext.mode === "main-draft") {
            const draft = editDrafts.find((item) => item.editDraftKey === quickContext.draftId);
            if (!draft) return;
            Object.assign(draft, validated.options, {
                defaultMm: validated.options.mm,
                totalMm: validated.options.totalMm
            });
            renderAll();
            syncEditDraftControls(`${employeeName(draft)}의 세부 설정을 편집중 상태로 적용했습니다.`, "success");
            closeQuickDialog();
            return;
        }
        editorEntry?.module.stageDraftSettings?.({
            draftId: quickContext.draftId,
            ...validated.options,
            defaultMm: validated.options.mm
        });
        closeQuickDialog();
        Common.ui.toast("인력별 설정을 편집중 상태로 적용했습니다.", "success");
    }

    async function confirmedDraftBodies(projectId, drafts) {
        const lane = laneByKey(`confirmed:${projectId}`);
        if (!lane) throw new Error("저장할 프로젝트를 찾지 못했습니다.");
        const detailPayload = await Common.api.request(`/project-assignments?projectId=${encodeURIComponent(projectId)}`, {
            signal: controller.signal,
            showLoading: false
        });
        const availableCompanies = Common.data.get(detailPayload)?.companies || [];
        return Promise.all(drafts.map(async (draft) => {
            const key = workerKey(draft);
            const worker = workerByKey(key) || draft;
            if (!key.startsWith("USER:") && !key.startsWith("COMPANY_EMPLOYEE:")) {
                throw new Error(`${employeeName(draft)} 인력 식별정보를 찾지 못했습니다.`);
            }
            const draftProjectCompanyId = Number(pick(draft, "projectCompanyId", "PROJECT_COMPANY_ID") || 0);
            const projectCompanyId = availableCompanies.some((company) => (
                Number(pick(company, "projectCompanyId", "PROJECT_COMPANY_ID")) === draftProjectCompanyId
            ))
                ? draftProjectCompanyId
                : await projectCompanyForWorker(lane, worker, availableCompanies);
            return assignmentRequestBody(draft, {
                workerKey: key,
                projectCompanyId,
                startDate: dateText(pick(draft, "assignmentStartDate", "ASSIGNMENT_START_DATE")),
                endDate: dateText(pick(draft, "assignmentEndDate", "ASSIGNMENT_END_DATE")),
                assignmentStatusCode: pick(draft, "assignmentStatusCode", "ASSIGNMENT_STATUS_CODE") || "CONFIRMED",
                monthlyAllocations: assignmentAllocations(draft),
                defaultMm: number(pick(draft, "defaultMm", "DEFAULT_MM") ?? 1),
                costUnitPrice: pick(draft, "costUnitPrice", "COST_UNIT_PRICE"),
                salesUnitPrice: pick(draft, "salesUnitPrice", "SALES_UNIT_PRICE"),
                projectRoleName: pick(draft, "projectRoleName", "PROJECT_ROLE_NAME") || "",
                primaryDuty: pick(draft, "primaryDuty", "PRIMARY_DUTY") || "",
                note: pick(draft, "note", "NOTE") || "",
                versionToken: null
            });
        }));
    }

    async function saveConfirmedDrafts(projectId, drafts, { batch = true } = {}) {
        if (mutationBusy) throw new Error("다른 저장 작업이 진행 중입니다.");
        if (!projectId || !Array.isArray(drafts) || !drafts.length) throw new Error("저장할 편집중 투입이 없습니다.");
        if (drafts.some((draft) => String(pick(draft, "projectId", "PROJECT_ID")) !== String(projectId))) {
            throw new Error("한 번에 하나의 프로젝트 투입만 저장할 수 있습니다.");
        }
        mutationBusy = true;
        query("#workforceManagementBoard")?.classList.add("is-saving");
        editorEntry?.module.setSaveFeedback?.(
            batch ? `${drafts.length}명의 변경사항을 저장하고 있습니다.` : `${employeeName(drafts[0])} 투입정보를 저장하고 있습니다.`,
            "",
            true
        );
        Common.ui.setInlineStatus(
            query("#workforceManagementBoardStatus"),
            batch ? `${drafts.length}명의 투입정보를 저장하고 있습니다.` : `${employeeName(drafts[0])} 투입정보를 저장하고 있습니다.`
        );
        try {
            const bodies = await confirmedDraftBodies(projectId, drafts);
            if (batch) {
                await Common.api.request(`/project-assignments/${encodeURIComponent(projectId)}/assignments/batch`, {
                    method: "POST",
                    body: { assignments: bodies },
                    signal: controller.signal,
                    showLoading: false
                });
            } else {
                await Common.api.request(`/project-assignments/${encodeURIComponent(projectId)}/assignments`, {
                    method: "POST",
                    body: bodies[0],
                    signal: controller.signal,
                    showLoading: false
                });
            }
            drafts.forEach((draft) => editorEntry?.module.removeDraft?.(pick(draft, "assignmentId", "ASSIGNMENT_ID")));
            try {
                await loadDashboard(scenario?.scenarioId || "");
                if (editorEntry?.module.refresh) await editorEntry.module.refresh();
            } catch (refreshError) {
                Common.ui.setInlineStatus(
                    query("#workforceManagementBoardStatus"),
                    `저장은 완료했지만 보드를 다시 불러오지 못했습니다. 조회를 눌러 확인해 주세요. (${refreshError.message || "갱신 오류"})`,
                    "warning"
                );
                Common.ui.toast("저장은 완료했습니다. 보드를 다시 조회해 주세요.", "warning");
                editorEntry?.module.setSaveFeedback?.("저장은 완료했습니다. 조회 버튼을 눌러 보드를 갱신해 주세요.", "warning", false);
                return true;
            }
            Common.ui.setInlineStatus(query("#workforceManagementBoardStatus"), `${drafts.length}명의 투입정보를 저장했습니다.`, "success");
            editorEntry?.module.setSaveFeedback?.(`${drafts.length}명의 투입정보를 저장하고 보드에 반영했습니다.`, "success", false);
            Common.ui.toast(batch ? "변경사항을 일괄 저장했습니다." : "투입인력 정보를 저장했습니다.", "success");
            return true;
        } catch (error) {
            Common.ui.setInlineStatus(query("#workforceManagementBoardStatus"), error.message || "투입정보를 저장하지 못했습니다.", "error");
            editorEntry?.module.setSaveFeedback?.(error.message || "투입정보를 저장하지 못했습니다.", "error", false);
            throw error;
        } finally {
            mutationBusy = false;
            query("#workforceManagementBoard")?.classList.remove("is-saving");
        }
    }

    function replaceEditOrderIdentity(previousIdentity, nextIdentity) {
        editOrders.forEach((order, laneKey) => {
            editOrders.set(laneKey, order.map((identity) => identity === previousIdentity ? nextIdentity : identity));
        });
    }

    async function saveMainEditDrafts(targetDrafts = editDrafts, options = {}) {
        const includeOrders = options.includeOrders ?? targetDrafts === editDrafts;
        const drafts = [...targetDrafts];
        const removals = targetDrafts === editDrafts
            ? [...editRemovals.keys()].map((identity) => ({ identity, context: assignmentContext(identity) })).filter((item) => item.context)
            : [];
        const removalIdentities = new Set(removals.map((item) => item.identity));
        if (mutationBusy) throw new Error("다른 저장 작업이 진행 중입니다.");
        if (!drafts.length && !removals.length && (!includeOrders || !editOrders.size)) throw new Error("저장할 편집중 변경사항이 없습니다.");
        mutationBusy = true;
        const requestedChanges = drafts.length + removals.length + (includeOrders ? editOrders.size : 0);
        syncEditDraftControls(`${requestedChanges}건의 편집중 변경사항을 저장하고 있습니다.`);
        query("#workforceManagementBoard")?.classList.add("is-saving");
        const savedKeys = new Set();
        const savedOrderLanes = new Set();
        try {
            const confirmedGroups = new Map();
            drafts.filter((draft) => draft.laneType === "confirmed").forEach((draft) => {
                const key = String(draft.projectId);
                if (!confirmedGroups.has(key)) confirmedGroups.set(key, []);
                confirmedGroups.get(key).push(draft);
            });
            for (const [confirmedProjectId, group] of confirmedGroups) {
                const bodies = await confirmedDraftBodies(confirmedProjectId, group);
                const response = await Common.api.request(`/project-assignments/${encodeURIComponent(confirmedProjectId)}/assignments/batch`, {
                    method: "POST",
                    body: { assignments: bodies },
                    signal: controller.signal,
                    showLoading: false
                });
                const assignmentIds = Common.data.get(response)?.assignmentIds || [];
                if (assignmentIds.length !== group.length) throw new Error("저장된 투입인력의 식별정보를 확인하지 못했습니다.");
                group.forEach((draft, index) => {
                    savedKeys.add(draft.editDraftKey);
                    replaceEditOrderIdentity(`draft:${draft.editDraftKey}`, `confirmed:${assignmentIds[index]}`);
                });
                editDrafts = editDrafts.filter((draft) => !savedKeys.has(draft.editDraftKey));
            }

            const planningDrafts = drafts.filter((draft) => draft.laneType === "planning");
            const planningRemovals = removals.filter((item) => item.context.lane.type === "planning");
            const hasPlanningOrders = includeOrders && [...editOrders.entries()].some(([laneKey, order]) => (
                laneKey.startsWith("planning:") && !order.some((identity) => identity.startsWith("draft:"))
            ));
            if (planningDrafts.length || planningRemovals.length || hasPlanningOrders) {
                if (!scenario) throw new Error("저장할 계획안을 찾지 못했습니다.");
                const backups = new Map();
                planningRemovals.forEach(({ identity, context }) => {
                    const project = scenario.projects.find((item) => String(item.scenarioProjectId) === String(context.lane.scenarioProjectId));
                    if (!project) throw new Error(`${employeeName(context.assignment)}의 계획 프로젝트를 찾지 못했습니다.`);
                    if (!backups.has(project)) backups.set(project, [...(project.assignments || [])]);
                    project.assignments = (project.assignments || []).filter((assignment) => assignment !== context.assignment);
                });
                planningDrafts.forEach((draft) => {
                    const project = scenario.projects.find((item) => String(item.scenarioProjectId) === String(draft.scenarioProjectId));
                    if (!project) throw new Error(`${draft.employeeName}을 배치할 계획 프로젝트를 찾지 못했습니다.`);
                    if (!backups.has(project)) backups.set(project, [...(project.assignments || [])]);
                    project.assignments = project.assignments || [];
                    const savedAssignment = {
                        clientKey: draft.clientKey,
                        workerKey: draft.workerKey,
                        employeeName: draft.employeeName,
                        companyName: draft.companyName,
                        assignmentStartDate: draft.assignmentStartDate,
                        assignmentEndDate: draft.assignmentEndDate,
                        costUnitPrice: integerText(draft.costUnitPrice),
                        salesUnitPrice: integerText(draft.salesUnitPrice),
                        projectRoleName: draft.projectRoleName || "",
                        primaryDuty: draft.primaryDuty || "",
                        note: draft.note || "",
                        monthlyAllocations: draft.monthlyAllocations
                    };
                    project.assignments.push(savedAssignment);
                    replaceEditOrderIdentity(`draft:${draft.editDraftKey}`, `planning:${draft.clientKey}`);
                });
                const applicablePlanningOrders = includeOrders ? [...editOrders.entries()].filter(([laneKey, order]) => (
                    laneKey.startsWith("planning:") && !order.some((identity) => identity.startsWith("draft:"))
                )) : [];
                applicablePlanningOrders.forEach(([laneKey, order]) => {
                    const lane = laneByKey(laneKey);
                    const project = scenario.projects.find((item) => String(item.scenarioProjectId) === String(lane?.scenarioProjectId));
                    if (!project) return;
                    if (!backups.has(project)) backups.set(project, [...(project.assignments || [])]);
                    const byIdentity = new Map((project.assignments || []).map((assignment) => [assignmentIdentity(lane, assignment), assignment]));
                    const ordered = order.filter((identity) => !removalIdentities.has(identity)).map((identity) => byIdentity.get(identity)).filter(Boolean);
                    (project.assignments || []).forEach((assignment) => {
                        if (!ordered.includes(assignment)) ordered.push(assignment);
                    });
                    project.assignments = ordered;
                });
                try {
                    await savePlanningScenario();
                } catch (error) {
                    backups.forEach((assignments, project) => { project.assignments = assignments; });
                    throw error;
                }
                planningDrafts.forEach((draft) => savedKeys.add(draft.editDraftKey));
                editDrafts = editDrafts.filter((draft) => !savedKeys.has(draft.editDraftKey));
                planningRemovals.forEach(({ identity, context }) => {
                    editRemovals.delete(identity);
                    removeIdentityFromOrder(context.lane.key, identity);
                });
                applicablePlanningOrders.forEach(([laneKey]) => {
                    editOrders.delete(laneKey);
                    savedOrderLanes.add(laneKey);
                });
            }

            for (const { identity, context } of removals.filter((item) => item.context.lane.type === "confirmed")) {
                await removeAssignment(identity);
                editRemovals.delete(identity);
                removeIdentityFromOrder(context.lane.key, identity);
            }

            for (const [laneKey, order] of includeOrders ? [...editOrders.entries()] : []) {
                if (!laneKey.startsWith("confirmed:") || order.some((identity) => identity.startsWith("draft:"))) continue;
                const assignmentIds = order
                    .filter((identity) => identity.startsWith("confirmed:") && !removalIdentities.has(identity))
                    .map((identity) => Number(identity.slice("confirmed:".length)));
                if (assignmentIds.some((id) => !Number.isInteger(id) || id <= 0)) continue;
                if (!assignmentIds.length) {
                    editOrders.delete(laneKey);
                    savedOrderLanes.add(laneKey);
                    continue;
                }
                const confirmedProjectId = laneByKey(laneKey)?.projectId || laneKey.slice("confirmed:".length);
                await Common.api.request(`/project-assignments/${encodeURIComponent(confirmedProjectId)}/assignments/reorder`, {
                    method: "PUT",
                    body: { assignmentIds },
                    signal: controller.signal,
                    showLoading: false
                });
                editOrders.delete(laneKey);
                savedOrderLanes.add(laneKey);
            }

            await loadDashboard(scenario?.scenarioId || "");
            const savedCount = savedKeys.size + removals.length + savedOrderLanes.size;
            syncEditDraftControls(`${savedCount}건의 변경사항을 저장하고 보드에 반영했습니다.`, "success");
            Common.ui.toast(`${savedCount}건의 변경사항을 일괄 저장했습니다.`, "success");
            return true;
        } catch (error) {
            if (savedKeys.size || savedOrderLanes.size) {
                try { await loadDashboard(scenario?.scenarioId || ""); } catch (_refreshError) { /* 저장 오류를 우선 표시합니다. */ }
            }
            syncEditDraftControls(error.message || "편집중 변경사항을 저장하지 못했습니다.", "error");
            throw error;
        } finally {
            mutationBusy = false;
            query("#workforceManagementBoard")?.classList.remove("is-saving");
            syncEditDraftControls();
        }
    }

    async function saveQuickAssignment(event) {
        event.preventDefault();
        if (!quickContext) return;
        const context = { ...quickContext };
        const validated = validatedQuickOptions(event.currentTarget);
        if (!validated) return;
        const { lane, options } = validated;
        if (context.mode === "main-draft") {
            const draft = editDrafts.find((item) => item.editDraftKey === context.draftId);
            if (!draft) throw new Error("저장할 편집중 투입정보를 찾지 못했습니다.");
            Object.assign(draft, options, { defaultMm: options.mm, totalMm: options.totalMm });
            await saveMainEditDrafts([draft]);
            closeQuickDialog();
            return;
        }
        if (context.mode === "batch-draft") {
            editorEntry?.module.stageDraftSettings?.({
                draftId: context.draftId,
                ...options,
                defaultMm: options.mm
            });
            const draft = { ...context.assignment, ...options, defaultMm: options.mm, totalMm: options.totalMm };
            await saveConfirmedDrafts(lane.projectId, [draft], { batch: false });
            closeQuickDialog();
            return;
        }
        const saved = await runBoardMutation(
            context.mode === "create" ? "인력을 프로젝트에 배치하고 있습니다." : "투입 세부정보를 저장하고 있습니다.",
            () => context.mode === "create"
                ? addWorkerToLane(lane, context.workerKey, context.month, options)
                : updateAssignmentDetails(context.identity, options)
        );
        if (!saved) {
            Common.ui.setInlineStatus(query("#workforceManagementQuickStatus"), "저장하지 못했습니다. 입력값과 참여회사 정보를 확인해 주세요.", "error");
            return;
        }
        closeQuickDialog();
    }

    function componentHtml(pageCode) {
        return fetch(Common.asset.url(`./pages/${encodeURIComponent(pageCode)}.html`), {
            credentials: "same-origin",
            cache: "no-cache",
            signal: controller.signal
        }).then((response) => {
            if (!response.ok) throw new Error(`${pageCode} 편집 화면을 불러오지 못했습니다. (HTTP ${response.status})`);
            return response.text();
        });
    }

    function componentScript(pageCode) {
        if (window.Pages?.[pageCode]) return Promise.resolve({ module: window.Pages[pageCode], script: null });
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = Common.asset.url(`./js/${encodeURIComponent(pageCode)}.js`);
            script.async = true;
            script.dataset.workforceEditorScript = pageCode;
            script.addEventListener("load", () => {
                const pageModule = window.Pages?.[pageCode];
                if (pageModule) resolve({ module: pageModule, script });
                else reject(new Error(`${pageCode} 편집 모듈이 등록되지 않았습니다.`));
            }, { once: true });
            script.addEventListener("error", () => reject(new Error(`${pageCode} 편집 스크립트를 불러오지 못했습니다.`)), { once: true });
            document.head.appendChild(script);
        });
    }

    async function releaseEditor({ confirmDiscard = true, refresh = true } = {}) {
        if (!editorEntry) {
            query("#workforceManagementEditorHost")?.replaceChildren();
            const emptyEditor = query("#workforceManagementEditor");
            emptyEditor?.classList.remove("is-open", "is-confirmed-editor", "is-planning-editor");
            if (emptyEditor) emptyEditor.hidden = true;
            document.documentElement.classList.remove("has-workforce-management-editor");
            return true;
        }
        if (confirmDiscard && editorEntry.module.hasUnsavedChanges?.()) {
            const confirmed = await Common.ui.confirm(
                "편집 화면에 저장하지 않은 변경사항이 있습니다. 저장하지 않고 대시보드로 돌아가시겠습니까?",
                { title: "변경사항 확인", confirmText: "저장하지 않고 닫기", danger: true }
            );
            if (!confirmed) return false;
            editorEntry.module.discardChanges?.();
        }
        await editorEntry.module.destroy?.({ root: editorEntry.root, closing: true, reason: "workforce editor close" });
        editorEntry.script?.remove();
        if (editorEntry.script) delete window.Pages[editorEntry.pageCode];
        editorEntry = null;
        query("#workforceManagementEditorHost")?.replaceChildren();
        const editor = query("#workforceManagementEditor");
        editor?.classList.remove("is-open", "is-confirmed-editor", "is-planning-editor");
        if (editor) editor.hidden = true;
        document.documentElement.classList.remove("has-workforce-management-editor");
        if (refresh && root) await loadDashboard(scenario?.scenarioId || "");
        return true;
    }

    async function openEditor(mode, options = {}) {
        if (!COMPONENTS[mode] || editorOpening) return;
        if (editorEntry && !(await releaseEditor({ confirmDiscard: true, refresh: false }))) return;
        editorOpening = true;
        const definition = COMPONENTS[mode];
        const editor = query("#workforceManagementEditor");
        editor.classList.add("is-confirmed-editor");
        editor.classList.remove("is-planning-editor");
        editor.classList.remove("is-open");
        editor.hidden = true;
        let editorRevealed = false;
        const revealEditor = () => {
            if (editorRevealed) return;
            editorRevealed = true;
            editor.hidden = false;
            document.documentElement.classList.add("has-workforce-management-editor");
            requestAnimationFrame(() => {
                editor.classList.add("is-open");
                query("[data-workforce-editor-close]")?.focus();
            });
        };
        query("#workforceManagementEditorTitle").textContent = definition.title;
        query("#workforceManagementEditorDescription").textContent = "프로젝트 기본정보와 참여회사 정보만 수정합니다. 인력 배치는 메인 화면의 편집 모드에서 관리합니다.";
        Common.ui.setInlineStatus(query("#workforceManagementEditorStatus"), "편집 작업공간을 준비하고 있습니다.");
        try {
            const [{ module: pageModule, script }, html] = await Promise.all([
                componentScript(definition.pageCode),
                componentHtml(definition.pageCode)
            ]);
            const template = document.createElement("template");
            template.innerHTML = html.trim();
            const componentRoot = template.content.firstElementChild;
            if (!componentRoot) throw new Error("편집 화면 루트를 찾을 수 없습니다.");
            componentRoot.classList.add("is-workforce-compact-editor", `is-${mode}-compact-editor`);
            query("#workforceManagementEditorHost").replaceChildren(componentRoot);
            editorEntry = { mode, pageCode: definition.pageCode, module: pageModule, root: componentRoot, script };
            await pageModule.init?.({
                root: componentRoot,
                user: pageContext.user,
                navigate: pageContext.navigate,
                refreshSession: pageContext.refreshSession,
                routeContext: {
                    planYear: selectedYear(),
                    projectYear: selectedYear(),
                    projectId: options.projectId || null,
                    scenarioId: scenario?.scenarioId || null,
                    compactMode: true
                },
                compactMode: true
            });
            Common.ui.setInlineStatus(query("#workforceManagementEditorStatus"), "");
            revealEditor();
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.setInlineStatus(query("#workforceManagementEditorStatus"), error.message || "편집 화면을 열지 못했습니다.", "error");
                revealEditor();
            }
        } finally {
            editorOpening = false;
        }
    }

    function initializeYears(preferredYear) {
        const currentYear = new Date().getFullYear();
        const requested = Number(preferredYear);
        const minimumYear = Number.isInteger(establishmentYear)
            ? establishmentYear
            : currentYear - 2;
        const requestedYear = Number.isInteger(requested) && requested >= 1900 && requested <= 2100
            ? requested
            : currentYear;
        const targetYear = Math.max(minimumYear, requestedYear);
        const maximumYear = Math.max(currentYear + 4, targetYear, minimumYear);
        querySelects("year").forEach((select) => {
            select.replaceChildren();
            for (let year = maximumYear; year >= minimumYear; year -= 1) {
                const option = element("option", "", `${year}년`);
                option.value = year;
                select.appendChild(option);
            }
            select.value = String(targetYear);
        });
    }

    async function changeDashboardYear(source) {
        const nextYear = String(source.value || "");
        const previousYear = querySelects("year").find((select) => select !== source)?.value || String(selectedYear());
        if (hasMainEditChanges()) {
            const confirmed = await Common.ui.confirm(
                "저장하지 않은 변경사항을 취소하고 조회 연도를 변경하시겠습니까?",
                { title: "조회조건 변경", confirmText: "변경사항 취소 후 조회", danger: true }
            );
            if (!confirmed) {
                source.value = previousYear;
                return;
            }
            discardMainEditChanges({ render: false });
        }
        syncQuerySelects("year", nextYear);
        await loadDashboard(scenario?.scenarioId || "");
    }

    function changeDashboardProject(source) {
        syncQuerySelects("project", source.value);
        renderAll();
    }

    function setBoardView(nextView) {
        if (!["worker", "project"].includes(nextView)) return;
        boardView = nextView;
        const board = query("#workforceManagementBoard");
        board.dataset.view = nextView;
        board.classList.toggle("is-editing", projectEditActive());
        root.querySelectorAll("[data-workforce-view]").forEach((button) => {
            const selected = button.dataset.workforceView === nextView;
            button.classList.toggle("is-active", selected);
            button.setAttribute("aria-pressed", String(selected));
        });
        query("#workforceManagementEditModeButton").hidden = nextView !== "project";
        query("#workforceManagementProjectSortField").hidden = nextView !== "project";
        query("#workforceManagementMatrixWorkerFilters").hidden = nextView !== "worker";
        syncEditDraftControls();
        renderProjectPalette();
        renderMonthHeader();
        renderLanes();
    }

    async function setEditMode(enabled) {
        const nextEditMode = Boolean(enabled);
        if (!nextEditMode && editMode && hasMainEditChanges()) {
            const changeCount = Math.max(1, mainEditChangeCount());
            const confirmed = await Common.ui.confirm(
                `${changeCount}건의 저장하지 않은 변경사항이 있습니다. 변경사항을 취소하고 편집 모드를 종료하시겠습니까?`,
                { title: "편집 종료 확인", confirmText: "저장하지 않고 종료", danger: true }
            );
            if (!confirmed) return false;
            discardMainEditChanges({ render: false });
        }
        editMode = nextEditMode;
        if (editMode) {
            projectDisplay = "expanded";
            projectExpansion.clear();
        }
        const button = query("#workforceManagementEditModeButton");
        button.classList.toggle("is-active", editMode);
        button.setAttribute("aria-pressed", String(editMode));
        button.querySelector("[data-edit-mode-label]").textContent = editMode ? "편집 종료" : "편집 모드";
        button.title = editMode
            ? "편집 모드를 종료합니다. 저장하지 않은 변경사항은 변경사항 저장 버튼으로 먼저 반영해 주세요."
            : "편집 모드를 켜면 인력 추가, 배치 순서 변경 및 일괄 저장을 사용할 수 있습니다.";
        query("#workforceManagementBoard").classList.toggle("is-editing", projectEditActive());
        withRenderCalculationCache(() => {
            renderWorkers();
            renderProjectPalette();
            renderLanes();
        });
        syncEditDraftControls(
            !editMode && !nextEditMode ? "편집 모드를 종료했습니다. 저장된 투입정보만 표시합니다." : "",
            "success"
        );
        return true;
    }

    async function resetBoardToSavedState(triggerButton = null) {
        if (mutationBusy) return;
        const changeCount = mainEditChangeCount();
        const hadUnsavedChanges = hasMainEditChanges();
        if (hadUnsavedChanges) {
            const confirmed = await Common.ui.confirm(
                `${Math.max(1, changeCount)}건의 저장하지 않은 변경사항을 취소하고 저장된 상태로 다시 조회하시겠습니까?`,
                { title: "변경사항 초기화", confirmText: "저장 상태로 다시 조회", danger: true }
            );
            if (!confirmed) return;
        }
        const refreshButtons = [...root.querySelectorAll("[data-workforce-saved-refresh]")];
        refreshButtons.forEach((button) => { button.disabled = true; });
        triggerButton?.classList.add("is-refreshing");
        triggerButton?.setAttribute("aria-busy", "true");
        Common.ui.setInlineStatus(query("#workforceManagementBoardStatus"), "저장된 최신 상태를 다시 조회하고 있습니다.");
        try {
            discardMainEditChanges({ render: false });
            const loaded = await loadDashboard(scenario?.scenarioId || "");
            if (!loaded) return;
            const message = hadUnsavedChanges
                ? "저장하지 않은 변경사항을 취소하고 저장된 상태로 다시 조회했습니다."
                : "저장된 최신 상태로 다시 조회했습니다.";
            syncEditDraftControls(message, "success");
            Common.ui.toast(message, "success");
        } finally {
            triggerButton?.classList.remove("is-refreshing");
            triggerButton?.removeAttribute("aria-busy");
            refreshButtons.forEach((button) => { button.disabled = mutationBusy; });
        }
    }

    function setBoardZoom(nextZoom) {
        boardZoom = Math.min(1.25, Math.max(0.75, nextZoom));
        const labels = { "0.75": "75%", "1": "100%", "1.25": "125%" };
        const key = String(boardZoom);
        query("#workforceManagementBoard").dataset.zoom = boardZoom < 1 ? "compact" : boardZoom > 1 ? "large" : "normal";
        query("#workforceManagementZoomValue").textContent = labels[key] || `${Math.round(boardZoom * 100)}%`;
        applyTimelineScale();
    }

    function scrollTimelineToSelectedYear() {
        const header = query("#workforceManagementMonthHeader");
        const scroll = query(".workforce-management-timeline-scroll");
        const targetIndex = timelineMonths().indexOf(`${selectedYear()}-01`);
        const target = targetIndex >= 0 ? header?.children[targetIndex + 1] : null;
        if (!scroll || !target) return;
        scroll.scrollLeft = Math.max(0, target.offsetLeft - (header.children[0]?.offsetWidth || 0));
    }

    function setBoardRangeMode(mode, { resetZoom = false } = {}) {
        boardRangeMode = mode === "full" ? "full" : "default";
        const fullButton = query("#workforceManagementFullRangeButton");
        query("#workforceManagementBoard").classList.toggle("is-full-range", boardRangeMode === "full");
        fullButton.classList.toggle("is-active", boardRangeMode === "full");
        fullButton.setAttribute("aria-pressed", String(boardRangeMode === "full"));
        fullButton.lastChild.textContent = " 전체기간";
        fullButton.title = boardRangeMode === "full"
            ? "조회된 전체 기간이 보드 너비에 맞게 축소되어 있습니다."
            : "조회된 프로젝트와 투입인력의 전체 기간을 보드 너비에 맞춰 표시합니다.";
        if (resetZoom) setBoardZoom(1);
        renderMonthHeader();
        renderLanes();
        requestAnimationFrame(() => {
            applyTimelineScale();
            if (boardRangeMode === "full") query(".workforce-management-timeline-scroll").scrollLeft = 0;
            else scrollTimelineToSelectedYear();
        });
    }

    function setMaximized(enabled) {
        maximized = Boolean(enabled);
        const board = query("#workforceManagementBoard");
        const button = query("#workforceManagementMaximizeButton");
        board.classList.toggle("is-maximized", maximized);
        document.documentElement.classList.toggle("has-workforce-board-maximized", maximized);
        button.setAttribute("aria-pressed", String(maximized));
        button.lastChild.textContent = maximized ? " 복원" : " 최대화";
        requestAnimationFrame(applyTimelineScale);
    }

    function boardDragPayload(event) {
        try {
            return JSON.parse(event.dataTransfer?.getData("text/plain") || "null");
        } catch (_error) {
            return null;
        }
    }

    function handleBoardDragStart(event) {
        if (!projectEditActive() || mutationBusy) return;
        if (event.target.closest("[data-remove-assignment], [data-worker-detail]")) {
            event.preventDefault();
            return;
        }
        const assignment = event.target.closest("[data-assignment-key]");
        const worker = event.target.closest("[data-worker-key]");
        const project = event.target.closest("[data-lane-key]");
        const payload = assignment
            ? { type: "assignment", assignmentKey: assignment.dataset.assignmentKey, workerKey: assignment.dataset.workerKey, laneKey: assignment.dataset.laneKey }
            : project
                ? { type: "project", laneKey: project.dataset.laneKey }
                : worker
                    ? { type: "worker", workerKey: worker.dataset.workerKey }
                    : null;
        if (!payload || !event.dataTransfer) return;
        activeBoardDrag = payload;
        event.dataTransfer.effectAllowed = payload.type === "assignment" ? "move" : "copy";
        event.dataTransfer.setData("text/plain", JSON.stringify(payload));
        event.target.classList.add("is-dragging");
    }

    function clearBoardDragFeedback() {
        root.querySelectorAll(".is-drag-over").forEach((item) => item.classList.remove("is-drag-over"));
        root.querySelectorAll(".is-drop-blocked").forEach((item) => item.classList.remove("is-drop-blocked"));
        root.querySelectorAll(".workforce-management-insert-indicator").forEach((item) => item.remove());
        root.querySelectorAll(".workforce-management-drop-blocked-indicator").forEach((item) => item.remove());
    }

    function handleBoardDragEnd(event) {
        event.target.closest(".is-dragging")?.classList.remove("is-dragging");
        activeBoardDrag = null;
        clearBoardDragFeedback();
    }

    function showProjectInsertion(article, payload, clientY) {
        const timeline = article.querySelector(".workforce-management-lane-timeline");
        if (!timeline || !["worker", "assignment"].includes(payload?.type)) return;
        root.querySelectorAll(".workforce-management-insert-indicator").forEach((item) => item.remove());
        const bars = [...timeline.querySelectorAll(".workforce-management-assignment")]
            .filter((bar) => bar.dataset.assignmentKey !== payload.assignmentKey)
            .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
        let insertIndex = bars.length;
        for (let index = 0; index < bars.length; index += 1) {
            const rect = bars[index].getBoundingClientRect();
            if (clientY < rect.top + (rect.height / 2)) {
                insertIndex = index;
                break;
            }
        }
        const timelineRect = timeline.getBoundingClientRect();
        let top = 35;
        if (bars.length && insertIndex === 0) {
            top = bars[0].getBoundingClientRect().top - timelineRect.top - 3;
        } else if (bars.length && insertIndex >= bars.length) {
            top = bars[bars.length - 1].getBoundingClientRect().bottom - timelineRect.top + 3;
        } else if (bars.length) {
            const previous = bars[insertIndex - 1].getBoundingClientRect();
            const next = bars[insertIndex].getBoundingClientRect();
            top = ((previous.bottom + next.top) / 2) - timelineRect.top;
        }
        const indicator = element("div", "workforce-management-insert-indicator");
        indicator.style.top = `${Math.max(28, top)}px`;
        indicator.dataset.insertIndex = String(insertIndex);
        indicator.setAttribute("aria-hidden", "true");
        timeline.appendChild(indicator);
    }

    function isDuplicateProjectDrop(lane, payload) {
        if (!lane || !["worker", "assignment"].includes(payload?.type) || !payload.workerKey) return false;
        return boardAssignments(lane).some((assignment) => (
            workerKey(assignment) === payload.workerKey
            && assignmentIdentity(lane, assignment) !== payload.assignmentKey
        ));
    }

    function showBlockedProjectDrop(article) {
        article.classList.add("is-drop-blocked");
        const indicator = element("div", "workforce-management-drop-blocked-indicator");
        indicator.setAttribute("role", "status");
        indicator.setAttribute("aria-label", "이미 등록된 인력이므로 드롭할 수 없습니다.");
        indicator.append(
            element("span", "workforce-management-drop-blocked-icon", "⊘"),
            element("strong", "", "이미 등록된 인력")
        );
        article.appendChild(indicator);
    }

    function handleBoardDragOver(event) {
        if (!projectEditActive() || mutationBusy) return;
        const payload = activeBoardDrag;
        const projectLane = event.target.closest("[data-drop-project-lane]");
        const workerTarget = event.target.closest("[data-drop-worker-key]");
        if (!payload || (!projectLane && !workerTarget)) return;
        if (projectLane && !["worker", "assignment"].includes(payload.type)) return;
        event.preventDefault();
        clearBoardDragFeedback();
        if (projectLane) {
            if (projectLane.classList.contains("is-collapsed")) {
                event.dataTransfer.dropEffect = "none";
                return;
            }
            const lane = laneByKey(projectLane.dataset.dropProjectLane);
            if (isDuplicateProjectDrop(lane, payload)) {
                event.dataTransfer.dropEffect = "none";
                showBlockedProjectDrop(projectLane);
                return;
            }
            event.dataTransfer.dropEffect = payload.type === "assignment" ? "move" : "copy";
            projectLane.classList.add("is-drag-over");
            showProjectInsertion(projectLane, payload, event.clientY);
            return;
        }
        event.dataTransfer.dropEffect = payload.type === "assignment" ? "move" : "copy";
        workerTarget.classList.add("is-drag-over");
    }

    async function handleBoardDrop(event) {
        const projectLane = event.target.closest("[data-drop-project-lane]");
        const workerTarget = event.target.closest("[data-drop-worker-key]");
        const payload = activeBoardDrag || boardDragPayload(event);
        const indicator = projectLane?.querySelector(".workforce-management-insert-indicator");
        const insertIndex = Number(indicator?.dataset.insertIndex ?? Number.MAX_SAFE_INTEGER);
        const target = projectLane || workerTarget;
        const lane = projectLane ? laneByKey(projectLane.dataset.dropProjectLane) : null;
        const duplicateDrop = isDuplicateProjectDrop(lane, payload);
        clearBoardDragFeedback();
        activeBoardDrag = null;
        if (!target || !payload || !projectEditActive() || mutationBusy) return;
        event.preventDefault();
        if (projectLane) {
            if (projectLane.classList.contains("is-collapsed")) {
                Common.ui.setInlineStatus(query("#workforceManagementBoardStatus"), "프로젝트의 인력을 펼친 뒤 배치해 주세요.", "warning");
                return;
            }
            if (duplicateDrop) {
                Common.ui.setInlineStatus(query("#workforceManagementBoardStatus"), "이미 등록된 인력은 같은 프로젝트에 다시 배치할 수 없습니다.", "warning");
                return;
            }
            if (payload.type === "worker") stageWorkerDraft(lane, payload.workerKey, insertIndex);
            if (payload.type === "assignment") {
                if (String(payload.assignmentKey).startsWith("draft:")) {
                    moveEditDraftToLane(String(payload.assignmentKey).slice(6), lane, insertIndex);
                    return;
                }
                if (payload.laneKey === lane.key) {
                    if (stageLaneOrder(lane, payload.assignmentKey, insertIndex)) {
                        renderAll();
                        syncEditDraftControls("인력 배치 순서를 편집중으로 변경했습니다. 변경사항 저장을 눌러 반영해 주세요.", "success");
                    }
                } else {
                    stageWorkerDraft(lane, payload.workerKey, insertIndex);
                }
            }
            return;
        }
        const month = workerTarget?.dataset.dropMonth;
        if (workerTarget?.dataset.dropWorkerKey) {
            if (payload.type === "project") {
                stageWorkerDraft(laneByKey(payload.laneKey), workerTarget.dataset.dropWorkerKey);
            } else if (payload.type === "assignment" && payload.workerKey === workerTarget.dataset.dropWorkerKey) {
                await runBoardMutation("투입 기간을 이동하고 있습니다.", () => moveAssignment(payload.assignmentKey, laneByKey(payload.laneKey), month));
            }
        }
    }

    function bindEvents() {
        query("#workforceManagementBasis").addEventListener("change", (event) => {
            if (hasMainEditChanges() || editorEntry) {
                event.currentTarget.value = boardBasis;
                Common.ui.toast("편집을 저장하거나 종료한 뒤 조회 기준을 변경해 주세요.", "warning");
                return;
            }
            boardBasis = event.currentTarget.value === "legacy-scenario" ? "legacy-scenario" : "project-status";
            projectExpansion.clear();
            renderAll();
            Common.ui.setInlineStatus(query("#workforceManagementBoardStatus"), boardBasis === "legacy-scenario"
                ? "기존 별도 계획안 참고 보기입니다. 홈 실적에는 합산되지 않습니다."
                : "프로젝트 진행상태 기준입니다. 계약·진행·완료는 확정, 계획·입찰은 계획입니다.");
        }, { signal: controller.signal });
        root.querySelectorAll("[data-workforce-project-display]").forEach((button) => {
            button.addEventListener("click", () => {
                projectDisplay = button.dataset.workforceProjectDisplay;
                projectExpansion.clear();
                renderLanes();
            }, { signal: controller.signal });
        });
        root.querySelectorAll("[data-workforce-worker-view]").forEach((button) => {
            button.addEventListener("click", () => {
                workerDisplay = button.dataset.workforceWorkerView;
                renderMonthHeader();
                renderLanes();
            }, { signal: controller.signal });
        });
        root.addEventListener("click", (event) => {
            const button = event.target.closest("[data-workforce-project-toggle]");
            if (!button) return;
            const key = button.dataset.workforceProjectToggle;
            const expanded = !(projectExpansion.get(key) ?? (projectDisplay === "expanded"));
            if (expanded === (projectDisplay === "expanded")) projectExpansion.delete(key);
            else projectExpansion.set(key, expanded);
            renderLanes();
            [...root.querySelectorAll("[data-workforce-project-toggle]")]
                .find((item) => item.dataset.workforceProjectToggle === key)?.focus({ preventScroll: true });
        }, { signal: controller.signal });
        querySelects("year").forEach((select) => {
            select.addEventListener("change", () => {
                changeDashboardYear(select).catch((error) => Common.ui.toast(error.message || "조회 연도를 변경하지 못했습니다.", "error"));
            }, { signal: controller.signal });
        });
        querySelects("project").forEach((select) => {
            select.addEventListener("change", () => changeDashboardProject(select), { signal: controller.signal });
        });
        root.querySelectorAll("[data-workforce-saved-refresh]").forEach((button) => {
            button.addEventListener("click", () => {
                resetBoardToSavedState(button).catch((error) => Common.ui.toast(error.message || "저장된 상태를 다시 조회하지 못했습니다.", "error"));
            }, { signal: controller.signal });
        });
        query("#workforceManagementSearch").addEventListener("input", () => {
            withRenderCalculationCache(() => {
                renderWorkers();
                renderLanes();
            });
        }, { signal: controller.signal });
        [query("#workforceManagementWorkerType"), query("#workforceManagementMatrixWorkerType")].forEach((control) => {
            control.addEventListener("change", (event) => applyWorkerFilters(event.currentTarget.value, workerNameFilter), { signal: controller.signal });
        });
        [query("#workforceManagementWorkerSearch"), query("#workforceManagementMatrixWorkerSearch")].forEach((control) => {
            control.addEventListener("input", (event) => applyWorkerFilters(workerTypeFilter, event.currentTarget.value), { signal: controller.signal });
        });
        query("#workforceManagementProjectSort").addEventListener("change", (event) => {
            projectSort = event.currentTarget.value === "customer" ? "customer" : "start";
            renderLanes();
        }, { signal: controller.signal });
        query("#workforceManagementEditModeButton").addEventListener("click", () => {
            setEditMode(!editMode).catch((error) => Common.ui.toast(error.message || "편집 모드를 변경하지 못했습니다.", "error"));
        }, { signal: controller.signal });
        query("#workforceManagementApplyDraftsButton").addEventListener("click", () => {
            saveMainEditDrafts().catch((error) => Common.ui.toast(error.message || "변경사항을 저장하지 못했습니다.", "error"));
        }, { signal: controller.signal });
        query("#workforceManagementMaximizeButton").addEventListener("click", () => setMaximized(!maximized), { signal: controller.signal });
        query("#workforceManagementFullRangeButton").addEventListener("click", () => {
            setBoardRangeMode("full");
        }, { signal: controller.signal });
        query("#workforceManagementDefaultViewButton").addEventListener("click", () => {
            setBoardRangeMode("default", { resetZoom: true });
        }, { signal: controller.signal });
        root.querySelectorAll("[data-workforce-view]").forEach((button) => {
            button.addEventListener("click", () => setBoardView(button.dataset.workforceView), { signal: controller.signal });
        });
        root.querySelectorAll("[data-workforce-zoom]").forEach((button) => {
            button.addEventListener("click", () => setBoardZoom(boardZoom + (button.dataset.workforceZoom === "in" ? 0.25 : -0.25)), { signal: controller.signal });
        });
        root.querySelectorAll("[data-workforce-filter]").forEach((button) => {
            button.addEventListener("click", () => {
                projectFilter = button.dataset.workforceFilter;
                root.querySelectorAll("[data-workforce-filter]").forEach((item) => {
                    const selected = item === button;
                    item.classList.toggle("is-active", selected);
                    item.setAttribute("aria-pressed", String(selected));
                });
                renderProjectPalette();
                renderMonthHeader();
                renderLanes();
            }, { signal: controller.signal });
        });
        root.addEventListener("dragstart", handleBoardDragStart, { signal: controller.signal });
        root.addEventListener("dragend", handleBoardDragEnd, { signal: controller.signal });
        root.addEventListener("dragover", handleBoardDragOver, { signal: controller.signal });
        root.addEventListener("drop", (event) => {
            handleBoardDrop(event).catch((error) => Common.ui.setInlineStatus(query("#workforceManagementBoardStatus"), error.message, "error"));
        }, { signal: controller.signal });
        root.addEventListener("workforce:open-quick-assignment", (event) => {
            try {
                const detail = event.detail || {};
                if (detail.mode === "batch-draft") {
                    openQuickDraft(detail);
                    return;
                }
                if (detail.mode === "edit" && detail.assignmentId) {
                    openQuickEdit(`confirmed:${detail.assignmentId}`);
                    return;
                }
                const lane = laneByKey(`confirmed:${detail.projectId}`);
                if (!lane || !detail.workerKey) throw new Error("빠른 설정을 열 프로젝트 또는 인력을 찾지 못했습니다.");
                openQuickCreate(lane, detail.workerKey, detail.month || dateText(lane.startDate).slice(0, 7));
            } catch (error) {
                Common.ui.toast(error.message || "투입 빠른 설정을 열지 못했습니다.", "error");
            }
        }, { signal: controller.signal });
        root.addEventListener("workforce:save-assignment-drafts", (event) => {
            const projectId = event.detail?.projectId;
            const drafts = event.detail?.drafts;
            saveConfirmedDrafts(projectId, drafts, { batch: true })
                .catch((error) => {
                    editorEntry?.module.setSaveFeedback?.(error.message || "변경사항을 일괄 저장하지 못했습니다.", "error", false);
                    Common.ui.toast(error.message || "변경사항을 일괄 저장하지 못했습니다.", "error");
                });
        }, { signal: controller.signal });
        root.addEventListener("workforce:remove-assignment", (event) => {
            const assignmentId = event.detail?.assignmentId;
            if (!assignmentId) return;
            (async () => {
                const confirmed = await Common.ui.confirm(
                    "선택한 인력을 프로젝트 투입에서 해제하시겠습니까?",
                    { title: "투입 해제", confirmText: "해제", danger: true }
                );
                if (!confirmed) return;
                await runBoardMutation(
                    "투입 인력을 해제하고 있습니다.",
                    () => removeAssignment(`confirmed:${assignmentId}`)
                );
            })().catch((error) => Common.ui.toast(error.message || "투입 인력을 해제하지 못했습니다.", "error"));
        }, { signal: controller.signal });
        root.addEventListener("workforce:reorder-assignments", (event) => {
            const projectId = event.detail?.projectId;
            const assignmentIds = event.detail?.assignmentIds;
            if (!projectId || !Array.isArray(assignmentIds) || !assignmentIds.length) return;
            runBoardMutation(
                "투입인력 배치 순서를 저장하고 있습니다.",
                () => Common.api.request(`/project-assignments/${encodeURIComponent(projectId)}/assignments/reorder`, {
                    method: "PUT",
                    body: { assignmentIds: assignmentIds.map(Number) },
                    signal: controller.signal,
                    showLoading: false
                })
            ).catch((error) => Common.ui.toast(error.message || "투입인력 배치 순서를 저장하지 못했습니다.", "error"));
        }, { signal: controller.signal });
        root.addEventListener("click", (event) => {
            const workerDetail = event.target.closest("[data-worker-detail]");
            if (workerDetail) {
                event.preventDefault();
                event.stopPropagation();
                const worker = workerByKey(workerDetail.dataset.workerDetail);
                if (worker) openWorkerDetail(worker);
                return;
            }
            const remove = event.target.closest("[data-remove-assignment]");
            if (remove) {
                event.preventDefault();
                event.stopPropagation();
                requestAssignmentRemoval(remove.dataset.removeAssignment)
                    .catch((error) => Common.ui.setInlineStatus(query("#workforceManagementBoardStatus"), error.message || "투입 배치를 해제하지 못했습니다.", "error"));
                return;
            }
            const quickAssignment = event.target.closest("[data-quick-assignment]");
            if (quickAssignment) {
                openQuickSales(quickAssignment.dataset.quickAssignment);
                return;
            }
            const edit = event.target.closest("[data-workforce-editor]");
            if (edit) {
                openEditor(edit.dataset.workforceEditor, { projectId: edit.dataset.projectId }).catch((error) => Common.ui.toast(error.message, "error"));
                return;
            }
            if (event.target.closest("[data-workforce-editor-close]")) {
                releaseEditor().catch((error) => Common.ui.toast(error.message, "error"));
            }
        }, { signal: controller.signal });
        root.addEventListener("keydown", (event) => {
            if (event.target.matches(".workforce-management-assignment, .workforce-management-worker-project-bar") && ["Enter", " "].includes(event.key)) {
                event.preventDefault();
                openQuickSales(event.target.dataset.quickAssignment);
                return;
            }
            const workerDetail = event.target.closest("[data-worker-detail]");
            if (workerDetail && ["Enter", " "].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                const worker = workerByKey(workerDetail.dataset.workerDetail);
                if (worker) openWorkerDetail(worker);
                return;
            }
            const remove = event.target.closest("[data-remove-assignment]");
            if (!remove || !["Enter", " "].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            requestAssignmentRemoval(remove.dataset.removeAssignment)
                .catch((error) => Common.ui.setInlineStatus(query("#workforceManagementBoardStatus"), error.message || "투입 배치를 해제하지 못했습니다.", "error"));
        }, { signal: controller.signal });
        query("#workforceManagementQuickForm").addEventListener("submit", (event) => {
            saveQuickAssignment(event).catch((error) => Common.ui.setInlineStatus(query("#workforceManagementQuickStatus"), error.message, "error"));
        }, { signal: controller.signal });
        root.querySelectorAll("[data-workforce-quick-close]").forEach((button) => {
            button.addEventListener("click", closeQuickDialog, { signal: controller.signal });
        });
        root.querySelectorAll("[data-workforce-worker-detail-close]").forEach((button) => {
            button.addEventListener("click", closeWorkerDetail, { signal: controller.signal });
        });
        const workerDetailDialog = query("#workforceManagementWorkerDetailDialog");
        const workerDetailHeader = query("[data-workforce-worker-detail-drag-handle]");
        workerDetailHeader.addEventListener("pointerdown", handleWorkerDetailPointerDown, { signal: controller.signal });
        workerDetailHeader.addEventListener("pointermove", handleWorkerDetailPointerMove, { signal: controller.signal });
        workerDetailHeader.addEventListener("pointerup", handleWorkerDetailPointerUp, { signal: controller.signal });
        workerDetailHeader.addEventListener("pointercancel", handleWorkerDetailPointerUp, { signal: controller.signal });
        workerDetailDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeWorkerDetail(); }, { signal: controller.signal });
        const quickDialogHeader = query("#workforceManagementQuickDialog .dialog-header");
        quickDialogHeader.addEventListener("pointerdown", handleQuickDialogPointerDown, { signal: controller.signal });
        quickDialogHeader.addEventListener("pointermove", handleQuickDialogPointerMove, { signal: controller.signal });
        quickDialogHeader.addEventListener("pointerup", handleQuickDialogPointerUp, { signal: controller.signal });
        quickDialogHeader.addEventListener("pointercancel", handleQuickDialogPointerUp, { signal: controller.signal });
        query("#workforceManagementQuickDelete").addEventListener("click", async () => {
            if (quickContext?.mode === "main-draft") {
                const draftId = quickContext.draftId;
                closeQuickDialog();
                removeEditDraft(draftId);
                Common.ui.toast("임시 투입을 취소했습니다.", "success");
                return;
            }
            if (quickContext?.mode === "batch-draft") {
                const draftId = quickContext.draftId;
                closeQuickDialog();
                editorEntry?.module.removeDraft?.(draftId);
                Common.ui.toast("임시 투입을 취소했습니다.", "success");
                return;
            }
            if (!quickContext?.identity) return;
            const identity = quickContext.identity;
            closeQuickDialog();
            toggleAssignmentRemoval(identity);
        }, { signal: controller.signal });
        query("#workforceManagementQuickApplyDraft").addEventListener("click", stageQuickDraftSettings, { signal: controller.signal });
        query("#workforceManagementQuickAssignmentStatus").addEventListener("change", syncQuickPreview, { signal: controller.signal });
        [query("#workforceManagementQuickStart"), query("#workforceManagementQuickEnd")].forEach((input) => {
            input.addEventListener("change", syncQuickPreview, { signal: controller.signal });
            input.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                event.stopPropagation();
                if (event.currentTarget.reportValidity()) syncQuickPreview();
            }, { signal: controller.signal });
        });
        query("#workforceManagementQuickMmRange").addEventListener("input", (event) => {
            query("#workforceManagementQuickMm").value = event.currentTarget.value;
            syncQuickPreview();
        }, { signal: controller.signal });
        query("#workforceManagementQuickMm").addEventListener("input", (event) => {
            query("#workforceManagementQuickMmRange").value = event.currentTarget.value;
            syncQuickPreview();
        }, { signal: controller.signal });
        query("#workforceManagementQuickApplyMm").addEventListener("click", applyDefaultMmToQuickMonths, { signal: controller.signal });
        query("#workforceManagementQuickDistributeMm").addEventListener("click", distributeQuickTotalMm, { signal: controller.signal });
        query("#workforceManagementQuickAllocationInputs").addEventListener("input", (event) => {
            const input = event.target.closest("[data-allocation-month]");
            if (!input) return;
            quickMonthlyAllocations.set(input.dataset.allocationMonth, number(input.value));
            updateQuickAllocationPreview();
        }, { signal: controller.signal });
        query("#workforceManagementQuickMonths").addEventListener("pointerdown", (event) => {
            const explicitHandle = event.target.closest("[data-quick-range-handle]")?.dataset.quickRangeHandle;
            const track = event.target.closest("[data-quick-range-track]");
            if ((!explicitHandle && !track) || !quickContext) return;
            event.preventDefault();
            const clickedMonth = quickRangeMonthAt(event.clientX);
            const handle = explicitHandle || nearestQuickRangeHandle(clickedMonth);
            if (!handle) return;
            quickMonthDragHandle = handle;
            if (!explicitHandle) setQuickRangeHandleMonth(handle, clickedMonth);
            query(`#workforceManagementQuickMonths [data-quick-range-handle="${handle}"]`)?.classList.add("is-dragging");
            event.currentTarget.setPointerCapture?.(event.pointerId);
        }, { signal: controller.signal });
        query("#workforceManagementQuickMonths").addEventListener("pointermove", (event) => {
            if (!quickMonthDragHandle) return;
            setQuickRangeHandleMonth(quickMonthDragHandle, quickRangeMonthAt(event.clientX));
        }, { signal: controller.signal });
        const finishQuickRangeDrag = (event) => {
            quickMonthDragHandle = "";
            event.currentTarget.querySelectorAll(".is-dragging").forEach((handle) => handle.classList.remove("is-dragging"));
            event.currentTarget.releasePointerCapture?.(event.pointerId);
        };
        query("#workforceManagementQuickMonths").addEventListener("pointerup", finishQuickRangeDrag, { signal: controller.signal });
        query("#workforceManagementQuickMonths").addEventListener("pointercancel", finishQuickRangeDrag, { signal: controller.signal });
        query("#workforceManagementQuickMonths").addEventListener("keydown", (event) => {
            const handle = event.target.closest("[data-quick-range-handle]")?.dataset.quickRangeHandle;
            if (!handle || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault();
            const currentMonth = handle === "start"
                ? query("#workforceManagementQuickStart").value.slice(0, 7)
                : query("#workforceManagementQuickEnd").value.slice(0, 7);
            setQuickRangeHandleMonth(handle, addMonths(currentMonth, event.key === "ArrowRight" ? 1 : -1));
            query(`#workforceManagementQuickMonths [data-quick-range-handle="${handle}"]`)?.focus();
        }, { signal: controller.signal });
        query("#workforceManagementQuickDialog").addEventListener("cancel", (event) => {
            event.preventDefault();
            closeQuickDialog();
        }, { signal: controller.signal });
        root.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            if (detailLayer?.isOpen()) return;
            if (query("#workforceManagementQuickDialog")?.open) return;
            if (query("#workforceManagementWorkerDetailDialog")?.open) {
                closeWorkerDetail();
            } else if (!query("#workforceManagementEditor")?.hidden) {
                releaseEditor().catch((error) => Common.ui.toast(error.message, "error"));
            } else if (maximized) {
                setMaximized(false);
            }
        }, { signal: controller.signal });
        window.addEventListener("resize", () => requestAnimationFrame(applyTimelineScale), { signal: controller.signal });
    }

    function applyRouteContext(route = {}) {
        route = route || {};
        annualRateReturnYear = route.returnPage === "annual-targets" ? selectedYear() : null;
        const returnButton = query("#workforceManagementAnnualReturn");
        returnButton.hidden = !annualRateReturnYear;
        returnButton.textContent = `${annualRateReturnYear || ""}년 연간 참고 지표로 돌아가기`;
        if (!route.phase && !route.projectId && !route.assignmentId) return;
        boardBasis="project-status";
        query("#workforceManagementBasis").value=boardBasis;
        projectFilter=["confirmed","planning"].includes(route.phase) ? route.phase : "all";
        root.querySelectorAll("[data-workforce-filter]").forEach((button)=>{
            const active=button.dataset.workforceFilter===projectFilter;
            button.classList.toggle("is-active",active);button.setAttribute("aria-pressed",String(active));
        });
        query("#workforceManagementSearch").value="";
        syncQuerySelects("project",route.projectId || "");
        setBoardView("project");
        renderAll();
        if (route.assignmentId) {
            try {
                openQuickEdit(`confirmed:${Number(route.assignmentId)}`);
                const field=query(route.priceField==="allocation" ? "#workforceManagementQuickStart" : route.priceField==="cost" ? "#workforceManagementQuickCost" : "#workforceManagementQuickSales");
                const details=field.closest("details");
                if (details) details.open=true;
                field.focus();
                field.scrollIntoView({block:"center",behavior:"instant"});
                if (route.priceField!=="allocation") field.select();
            } catch (error) {
                Common.ui.setInlineStatus(query("#workforceManagementStatus"),error.message || "해당 투입을 찾지 못했습니다.","error");
            }
        }
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            root = context.root;
            pageContext = context;
            controller = new AbortController();
            detailLayer = Common.ui.createDetailDialog({ root, prefix: "workforceManagementLoadDetail", signal: controller.signal });
            projectFilter = "all";
            boardBasis = "project-status";
            boardView = "project";
            projectSort = "start";
            projectDisplay = "summary";
            projectExpansion = new Map();
            workerDisplay = "individual";
            workerTypeFilter = query("#workforceManagementWorkerType")?.value || "INTERNAL_REGULAR";
            query("#workforceManagementMatrixWorkerType").value = workerTypeFilter;
            workerNameFilter = "";
            boardZoom = 1;
            boardRangeMode = "default";
            editMode = false;
            mutationBusy = false;
            maximized = false;
            editDrafts = [];
            editDraftSequence = 0;
            editOrders = new Map();
            editRemovals = new Map();
            activeBoardDrag = null;
            const initialYear = context.routeContext?.planYear || context.routeContext?.projectYear || new Date().getFullYear();
            initializeYears(initialYear);
            bindEvents();
            query("#workforceManagementAnnualReturn").addEventListener("click", () => {
                if (annualRateReturnYear) App.navigate("annual-targets", { context: { planYear: annualRateReturnYear, view: "workers" } });
            }, { signal: controller.signal });
            [["Project","projects"],["Assignment","assignments"],["Available","available"],["Warning","warnings"]].forEach(([id,kind])=>query(`#workforceManagement${id}Metric`).addEventListener("click",()=>openMetricDetails(kind),{signal:controller.signal}));
            query("#workforceManagementAlertCount").addEventListener("click",()=>openMetricDetails("warnings"),{signal:controller.signal});
            renderAll();
            await loadDashboard(context.routeContext?.scenarioId || "", initialYear);
            applyRouteContext(context.routeContext);
        },

        async beforeLeave() {
            if (quickContext) {
                const confirmed = await Common.ui.confirm("저장하지 않은 빠른 투입 설정이 있습니다. 저장하지 않고 다른 화면으로 이동하시겠습니까?", { title: "변경사항 확인", confirmText: "저장하지 않고 이동", danger: true });
                if (!confirmed) return false;
                closeQuickDialog();
            }
            if (editDrafts.length || editOrders.size || editRemovals.size) {
                const changeCount = editDrafts.length + editOrders.size + editRemovals.size;
                const confirmed = await Common.ui.confirm(
                    `${changeCount}건의 저장하지 않은 투입 변경사항이 있습니다. 저장하지 않고 다른 화면으로 이동하시겠습니까?`,
                    { title: "변경사항 확인", confirmText: "저장하지 않고 이동", danger: true }
                );
                if (!confirmed) return false;
                editDrafts = [];
                editOrders.clear();
                editRemovals.clear();
            }
            if (editorEntry && !(await releaseEditor({ confirmDiscard: true, refresh: false }))) return false;
            detailLayer?.close();
            if (maximized) setMaximized(false);
            return true;
        },

        hasUnsavedChanges() {
            return Boolean(quickContext) || editDrafts.length > 0 || editOrders.size > 0 || editRemovals.size > 0 || editorEntry?.module.hasUnsavedChanges?.() === true;
        },

        discardChanges() {
            if (quickContext) closeQuickDialog();
            editDrafts = [];
            editOrders.clear();
            editRemovals.clear();
            editorEntry?.module.discardChanges?.();
        },

        async activate(context = {}) {
            const requestedYear = Number(context.routeContext?.planYear || context.routeContext?.projectYear);
            const targetYear = Number.isInteger(requestedYear) ? requestedYear : selectedYear();
            await loadDashboard(context.routeContext?.scenarioId || scenario?.scenarioId || "", targetYear);
            applyRouteContext(context.routeContext);
        },

        async destroy() {
            detailLayer?.destroy(); detailLayer=null;
            controller?.abort();
            requestSequence += 1;
            if (editorEntry) await releaseEditor({ confirmDiscard: false, refresh: false });
            if (query("#workforceManagementQuickDialog")?.open) closeQuickDialog();
            if (query("#workforceManagementWorkerDetailDialog")?.open) closeWorkerDetail();
            if (maximized) setMaximized(false);
            controller = null;
            pageContext = null;
            annualRateReturnYear = null;
            root = null;
            confirmedData = { projects: [], assignments: [], companies: [] };
            references = { workers: [], actualCapacity: [] };
            scenarios = [];
            scenario = null;
            projectFilter = "all";
            editorOpening = false;
            establishmentYear = null;
            departments = [];
            projectExpansion.clear();
            boardView = "project";
            projectSort = "start";
            workerTypeFilter = "";
            workerNameFilter = "";
            boardZoom = 1;
            boardRangeMode = "default";
            editMode = false;
            mutationBusy = false;
            maximized = false;
            quickContext = null;
            quickMonthDragHandle = "";
            quickMonthlyAllocations = new Map();
            quickDialogDrag = null;
            workerDetailDrag = null;
            editDrafts = [];
            editDraftSequence = 0;
            editOrders = new Map();
            editRemovals = new Map();
            activeBoardDrag = null;
        }
    };
})();
