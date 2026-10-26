(function() {
    "use strict";

    const PAGE_NAME = "admin-projects";
    const STATUS_LABELS = {
        PLANNED: "계획",
        BIDDING: "입찰",
        CONTRACTED: "계약",
        IN_PROGRESS: "진행",
        COMPLETED: "완료",
        CANCELLED: "취소"
    };
    const PARTICIPATION_LABELS = {
        LEAD: "주관사",
        CONSORTIUM: "컨소사",
        SUBCONTRACT: "하도급"
    };

    let root = null;
    let controller = null;
    let grid = null;
    let detailRequestId = 0;
    let projectViewMode = "list";
    let masterCompanies = [];
    let projectCompanies = [];
    let projectBaseline = "";
    let companyBaseline = "";
    let companyRequestId = 0;
    let mutationBusy = false;
    let revenueData = null;
    let revenueRequestId = 0;
    let revenueBaselines = new Map();

    function revenueSnapshot(row) {
        return JSON.stringify([row.querySelector("[data-revenue-amount]").value, row.querySelector("[data-revenue-note]").value]);
    }
    function revenueChanged() {
        return [...(query("#adminProjectRevenueRows")?.rows || [])].some(row => revenueSnapshot(row) !== revenueBaselines.get(row.dataset.revenueYear));
    }
    function revenueRow(item) {
        const make=Common.dom.element;
        const row=make("tr", {attrs:{"data-revenue-year":item.year, "data-revenue-revision":item.revision}});
        const amount=make("input", {className:"input",attrs:{type:"number",min:0,max:"999999999999999999",step:1,"data-revenue-amount":"", "aria-label":`${item.year}년 매출액`, placeholder:"미등록"}});
        amount.value=item.saved ? item.totalAmount : ""; amount.disabled=item.closed;
        const note=make("input", {className:"input",attrs:{maxlength:2000,"data-revenue-note":"", "aria-label":`${item.year}년 결산 내역`}});
        note.value=item.note || "";note.disabled=item.closed;
        const save=make("button",{className:"button button-primary button-small",type:"button",text:item.closed?"마감됨":"매출 저장",attrs:{"data-revenue-save":item.year}});save.disabled=item.closed;
        row.append(make("td",{text:`${item.ordinal ? `${item.ordinal}차년 · ` : ""}${item.year}년${item.saved ? "" : " · 미등록"}`}));
        row.append(make("td",{},[amount]),make("td",{},[note]),make("td",{},[save]));
        revenueBaselines.set(String(item.year),revenueSnapshot(row));
        return row;
    }
    function revenueSummary() {
        const money=value=>`${BigInt(value || 0).toLocaleString("ko-KR")}원`;
        query("#adminProjectRevenueSummary").textContent=revenueData ? `총수주금액 ${money(revenueData.contractAmountVat)} · 등록 매출 합계 ${money(revenueData.totalAmount)}` : "프로젝트를 먼저 저장해 주세요.";
    }
    function revealRevenue(year) {
        Common.ui.revealEditor(query("#adminProjectRevenuePanel"));
        const row=[...query("#adminProjectRevenueRows").rows].find(row=>Number(row.dataset.revenueYear)===Number(year));
        row?.querySelector("[data-revenue-amount]")?.focus();
    }
    async function loadRevenue(id, preserve=false) {
        const sequence=++revenueRequestId;
        const drafts=new Map();
        if (preserve) [...query("#adminProjectRevenueRows").rows].forEach(row=>{
            if (revenueSnapshot(row)!==revenueBaselines.get(row.dataset.revenueYear)) drafts.set(row.dataset.revenueYear,{snapshot:revenueSnapshot(row),revision:row.dataset.revenueRevision,baseline:revenueBaselines.get(row.dataset.revenueYear)});
        });
        if (!id) {revenueData=null;revenueBaselines.clear();query("#adminProjectRevenueRows").replaceChildren();revenueSummary();return;}
        try {
            const payload=await Common.api.request(`/admin/projects/${encodeURIComponent(id)}/revenue`,{signal:controller.signal,showLoading:false});
            if (!root || sequence!==revenueRequestId) return;
            revenueData=Common.data.get(payload); revenueBaselines.clear();
            const rows=revenueData.years.map(item=>revenueRow(item));
            drafts.forEach((draft,year)=>{
                const row=rows.find(row=>row.dataset.revenueYear===year);
                if (!row) return;
                const [amount,note]=JSON.parse(draft.snapshot);row.querySelector("[data-revenue-amount]").value=amount;row.querySelector("[data-revenue-note]").value=note;
                row.dataset.revenueRevision=draft.revision;revenueBaselines.set(year,draft.baseline);
            });
            query("#adminProjectRevenueRows").replaceChildren(...rows);revenueSummary();
            query("#adminProjectRevenueAddYear").value=new Date().getFullYear();
            Common.ui.setInlineStatus(query("#adminProjectRevenueStatus"),"연도마다 따로 저장합니다. 매출이 없음을 확인한 연도는 0원으로 저장할 수 있습니다.");
        } catch(error) {if(sequence===revenueRequestId && error.name!=="AbortError") Common.ui.setInlineStatus(query("#adminProjectRevenueStatus"),error.message,"error");}
    }
    async function saveRevenue(button) {
        if (mutationBusy) return;
        const row=button.closest("tr"),amount=row.querySelector("[data-revenue-amount]").value.trim();
        if (!/^\d{1,18}$/.test(amount)) {Common.ui.setInlineStatus(query("#adminProjectRevenueStatus"),"연간 매출액을 원 단위로 입력하세요. 매출이 없으면 0을 입력하세요.","error");return;}
        mutationBusy=true;button.disabled=true;
        try {
            const payload=await Common.api.request(`/admin/projects/${query("#projectId").value}/revenue/${row.dataset.revenueYear}`,{method:"PUT",body:{revision:Number(row.dataset.revenueRevision),amount,note:row.querySelector("[data-revenue-note]").value},signal:controller.signal});
            const updated=Common.data.get(payload),item=updated.years.find(item=>String(item.year)===row.dataset.revenueYear);
            revenueData=updated;row.replaceWith(revenueRow(item));revenueSummary();
            Common.ui.setInlineStatus(query("#adminProjectRevenueStatus"),`${item.year}년 매출을 저장했습니다. 메인·연간 실적에 반영됩니다.`,"success");
        } catch(error) {if(error.name!=="AbortError") Common.ui.setInlineStatus(query("#adminProjectRevenueStatus"),error.message,"error");}
        finally {mutationBusy=false;button.disabled=false;}
    }

    function formSnapshot(selector) {
        return JSON.stringify([...query(selector).querySelectorAll("input, select, textarea")].map((input) => [input.id, input.value]));
    }

    function hasChanges() {
        return Boolean(query("#adminProjectDetailDialog")?.open) && (
            projectBaseline !== formSnapshot("#projectForm") || companyBaseline !== formSnapshot("#adminProjectCompanyForm") || revenueChanged()
        );
    }

    async function confirmDiscard() {
        if (mutationBusy) {
            Common.ui.toast("저장 처리가 끝난 뒤 닫아 주세요.", "warning");
            return false;
        }
        return !hasChanges() || await Common.ui.confirm("저장하지 않은 프로젝트·참여회사·매출 입력을 닫으시겠습니까?", {
            title: "변경사항 확인", confirmText: "저장하지 않고 닫기", danger: true
        });
    }

    function openProjectDialog() {
        const dialog = query("#adminProjectDetailDialog");
        if (!dialog.open) dialog.showModal();
        query("#adminProjectDialogTitle").focus({ preventScroll: true });
    }

    async function closeProjectDialog() {
        if (!(await confirmDiscard())) return;
        detailRequestId += 1;
        companyRequestId += 1;
        query("#adminProjectDetailDialog").close();
        revenueRequestId += 1;
    }

    function query(selector) {
        return root?.querySelector(selector) || null;
    }

    function value(row, ...keys) {
        return Common.data.pick(row, ...keys);
    }

    function projectId(row) {
        return value(row, "projectId", "PROJECT_ID", "id", "ID");
    }

    function setValue(selector, nextValue) {
        const element = query(selector);
        if (element) element.value = nextValue ?? "";
    }

    function setDefaultProjectPeriodYearFilters({ force = false } = {}) {
        const currentYear = String(new Date().getFullYear());
        ["#projectPeriodYearFromFilter", "#projectPeriodYearToFilter"].forEach((selector) => {
            const input = query(selector);
            if (input && (force || !input.value)) input.value = currentYear;
        });
    }

    function applyListContext(route = {}) {
        route = route || {};
        if (!route.planYear && !route.statusCode) return false;
        query("#projectSearchForm").reset();
        setDefaultProjectPeriodYearFilters({force:true});
        const year=Number(route.planYear);
        if (Number.isInteger(year) && year>=1900 && year<=2100) {
            query("#projectPeriodYearFromFilter").value=String(year);
            query("#projectPeriodYearToFilter").value=String(year);
        }
        if ([...query("#projectStatusFilter").options].some((option)=>option.value===route.statusCode)) query("#projectStatusFilter").value=route.statusCode;
        setDetailSearchExpanded(false);
        return true;
    }

    function dateValue(nextValue) {
        return nextValue ? String(nextValue).slice(0, 10) : "";
    }

    function formatDate(nextValue) {
        const normalized = dateValue(nextValue);
        return normalized || "-";
    }

    function formatAmount(nextValue) {
        if (nextValue === null || nextValue === undefined || nextValue === "") return "-";
        const amount = String(nextValue);
        if (/^\d+$/.test(amount)) {
            return `${amount.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}원`;
        }
        return amount;
    }

    function projectFact(label, text, className = "") {
        const fact = Common.dom.element("div", {
            className: `project-card-fact${className ? ` ${className}` : ""}`
        });
        fact.append(
            Common.dom.element("dt", { text: label }),
            Common.dom.element("dd", { text: text ?? "-" })
        );
        return fact;
    }

    function companyTypeLabel(company) {
        return String(value(company, "companyTypeCode", "COMPANY_TYPE_CODE") || "").toUpperCase() === "HEADQUARTERS"
            ? "본사"
            : "협력업체";
    }

    function populateCompanyOptions() {
        const select = query("#adminProjectCompanyMaster");
        if (!select) return;
        select.replaceChildren(Common.dom.element("option", { value: "", text: "회사 선택" }));
        masterCompanies.forEach((company) => select.appendChild(Common.dom.element("option", {
            value: value(company, "companyId", "COMPANY_ID"),
            text: `${companyTypeLabel(company)} · ${value(company, "companyName", "COMPANY_NAME") || "회사명 미정"}`
        })));
    }

    function clearProjectCompanyForm() {
        query("#adminProjectCompanyForm")?.reset();
        setValue("#adminProjectCompanyId", "");
        setValue("#adminProjectCompanyType", "LEAD");
        setValue("#adminProjectCompanyShareRate", 0);
        query("#adminProjectCompanyForm").dataset.versionToken = "";
        query("#deleteAdminProjectCompanyButton").hidden = true;
        syncProjectCompanySelection();
        Common.ui.setInlineStatus(query("#adminProjectCompanyStatus"), "");
        companyBaseline = formSnapshot("#adminProjectCompanyForm");
    }

    function syncProjectCompanySelection(selectedId = query("#adminProjectCompanyId")?.value || "") {
        root.querySelectorAll("#adminProjectCompanyTableBody [data-project-company-id]").forEach((row) => {
            const selected = Boolean(selectedId) && String(row.dataset.projectCompanyId) === String(selectedId);
            row.classList.toggle("is-selected", selected);
            row.setAttribute("aria-selected", String(selected));
        });
    }

    function fillProjectCompanyForm(company) {
        setValue("#adminProjectCompanyId", value(company, "projectCompanyId", "PROJECT_COMPANY_ID"));
        setValue("#adminProjectCompanyMaster", value(company, "companyId", "COMPANY_ID"));
        setValue("#adminProjectCompanyType", value(company, "participationTypeCode", "PARTICIPATION_TYPE_CODE") || "LEAD");
        setValue("#adminProjectCompanyShareRate", value(company, "shareRate", "SHARE_RATE") ?? 0);
        setValue("#adminProjectCompanyNote", value(company, "note", "NOTE") || "");
        query("#adminProjectCompanyForm").dataset.versionToken = value(company, "versionToken", "VERSION_TOKEN") || "";
        query("#deleteAdminProjectCompanyButton").hidden = false;
        syncProjectCompanySelection();
        Common.ui.setInlineStatus(query("#adminProjectCompanyStatus"), `${value(company, "companyName", "COMPANY_NAME") || "참여회사"} 정보를 수정하고 있습니다.`);
        companyBaseline = formSnapshot("#adminProjectCompanyForm");
        Common.ui.revealEditor(query("#adminProjectCompanyForm"));
    }

    function renderProjectCompanies() {
        const body = query("#adminProjectCompanyTableBody");
        body.replaceChildren();
        if (!projectCompanies.length) {
            const row = Common.dom.element("tr");
            const empty = Common.dom.element("td", { text: "등록된 참여회사가 없습니다. 아래에서 인아이티(본사) 또는 해당 협력업체를 등록해 주세요." });
            empty.colSpan = 5;
            empty.className = "grid-empty-cell";
            row.appendChild(empty);
            body.appendChild(row);
            return;
        }
        projectCompanies.forEach((company) => {
            const row = Common.dom.element("tr", {
                attrs: {
                    tabindex: "0",
                    "data-project-company-id": value(company, "projectCompanyId", "PROJECT_COMPANY_ID"),
                    "aria-selected": "false"
                }
            });
            const master = masterCompanies.find((item) => String(value(item, "companyId", "COMPANY_ID")) === String(value(company, "companyId", "COMPANY_ID")));
            [
                value(company, "companyName", "COMPANY_NAME") || "회사명 미정",
                companyTypeLabel(master || company),
                PARTICIPATION_LABELS[value(company, "participationTypeCode", "PARTICIPATION_TYPE_CODE")] || "-",
                `${value(company, "shareRate", "SHARE_RATE") ?? 0}%`,
                value(company, "note", "NOTE") || "-"
            ].forEach((text) => row.appendChild(Common.dom.element("td", { text })));
            body.appendChild(row);
        });
    }

    async function loadProjectCompanies(id) {
        const requestId = ++companyRequestId;
        const panel = query("#projectCompanyEditorPanel");
        panel.hidden = !id;
        projectCompanies = [];
        clearProjectCompanyForm();
        if (!id) {
            renderProjectCompanies();
            return;
        }
        Common.ui.setInlineStatus(query("#adminProjectCompanyStatus"), "참여회사 정보를 불러오고 있습니다.");
        try {
            const payload = await Common.api.request(`/project-assignments?projectId=${encodeURIComponent(id)}`, {
                signal: controller.signal,
                showLoading: false
            });
            if (requestId !== companyRequestId) return;
            projectCompanies = Common.data.get(payload)?.companies || [];
            renderProjectCompanies();
            Common.ui.setInlineStatus(
                query("#adminProjectCompanyStatus"),
                projectCompanies.length ? `${projectCompanies.length}개의 참여회사가 등록되어 있습니다.` : "투입인력을 배치하려면 참여회사를 먼저 등록해 주세요.",
                projectCompanies.length ? "success" : "warning"
            );
        } catch (error) {
            if (requestId !== companyRequestId || error?.name === "AbortError") return;
            Common.ui.setInlineStatus(query("#adminProjectCompanyStatus"), error.message || "참여회사 정보를 불러오지 못했습니다.", "error");
        }
    }

    function renderProjectRow(project) {
        const statusCode = String(value(project, "statusCode", "STATUS_CODE") || "PLANNED");
        const participationType = String(
            value(project, "participationTypeCode", "PARTICIPATION_TYPE_CODE") || ""
        );
        const item = Common.dom.element("article", { className: "project-card" });
        item.setAttribute("role", "option");

        const heading = Common.dom.element("header", { className: "project-card-heading" });
        const badges = Common.dom.element("div", { className: "project-card-badges" });
        badges.append(
            Common.dom.element("span", {
                className: `project-status-badge is-${statusCode.toLowerCase().replaceAll("_", "-")}`,
                text: STATUS_LABELS[statusCode] || statusCode
            }),
            Common.dom.element("span", {
                className: "project-year-badge",
                text: `등록 ${value(project, "projectYear", "PROJECT_YEAR") || "-"}년`
            })
        );
        heading.append(
            badges,
            Common.dom.element("h4", {
                className: "project-card-title",
                text: value(project, "projectName", "PROJECT_NAME") || "이름 없음"
            }),
            Common.dom.element("p", {
                text: `${value(project, "customerName", "CUSTOMER_NAME") || "발주처 미등록"} · ${PARTICIPATION_LABELS[participationType] || participationType || "참여유형 미등록"}`
            })
        );

        const facts = Common.dom.element("dl", { className: "project-card-facts" });
        facts.append(
            projectFact(
                "프로젝트 기간",
                `${formatDate(value(project, "projectStartDate", "PROJECT_START_DATE"))} ~ ${formatDate(value(project, "projectEndDate", "PROJECT_END_DATE"))}`,
                "project-card-period"
            ),
            projectFact("발주금액", formatAmount(value(project, "orderAmountVat", "ORDER_AMOUNT_VAT")), "project-card-amount"),
            projectFact("수주금액", formatAmount(value(project, "contractAmountVat", "CONTRACT_AMOUNT_VAT")), "project-card-amount"),
            projectFact("참여비중", `${value(project, "participationRate", "PARTICIPATION_RATE") ?? 0}%`),
            projectFact("발주일", formatDate(value(project, "orderDate", "ORDER_DATE"))),
            projectFact("입찰일", formatDate(value(project, "bidDate", "BID_DATE")))
        );

        const action = Common.dom.element("span", {
            className: "project-card-action",
            text: "상세 보기"
        });
        action.setAttribute("aria-hidden", "true");
        item.append(heading, facts, action);
        return item;
    }

    function setProjectView(mode) {
        projectViewMode = mode === "list" ? "list" : "panel";
        const collection = query("#projectCollection");
        collection?.classList.toggle("is-panel-view", projectViewMode === "panel");
        collection?.classList.toggle("is-list-view", projectViewMode === "list");
        root?.querySelectorAll("[data-project-view]").forEach((button) => {
            const active = button.dataset.projectView === projectViewMode;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
        });
    }

    function changeProjectSort() {
        const selected = String(query("#projectSortSelect")?.value || "projectStartDate:desc");
        const [sortBy, sortDirection] = selected.split(":");
        grid?.setSort(sortBy, sortDirection);
    }

    function searchParameters() {
        return {
            periodYearFrom: query("#projectPeriodYearFromFilter").value,
            periodYearTo: query("#projectPeriodYearToFilter").value,
            keyword: query("#projectKeyword").value.trim(),
            statusCode: query("#projectStatusFilter").value,
            participationTypeCode: query("#projectParticipationFilter").value,
            periodStart: query("#projectPeriodStartFilter").value,
            periodEnd: query("#projectPeriodEndFilter").value,
            bidDateFrom: query("#projectBidDateFromFilter").value,
            bidDateTo: query("#projectBidDateToFilter").value,
            contractAmountMin: query("#projectContractAmountMinFilter").value,
            contractAmountMax: query("#projectContractAmountMaxFilter").value
        };
    }

    function validateRange(fromSelector, toSelector, message) {
        const from = query(fromSelector).value;
        const to = query(toSelector).value;
        if (!from || !to || from <= to) return true;
        Common.ui.setInlineStatus(query("#projectListStatus"), message, "error");
        query(toSelector).focus();
        return false;
    }

    function validateSearch() {
        const form = query("#projectSearchForm");
        if (!form.reportValidity()) return false;
        if (!validateRange(
            "#projectPeriodYearFromFilter",
            "#projectPeriodYearToFilter",
            "프로젝트 수행연도 To는 From보다 빠를 수 없습니다."
        )) return false;
        if (!validateRange(
            "#projectPeriodStartFilter",
            "#projectPeriodEndFilter",
            "프로젝트 기간의 종료 범위를 확인해 주세요."
        )) return false;
        if (!validateRange(
            "#projectBidDateFromFilter",
            "#projectBidDateToFilter",
            "입찰일의 종료 범위를 확인해 주세요."
        )) return false;

        const minimum = query("#projectContractAmountMinFilter").value;
        const maximum = query("#projectContractAmountMaxFilter").value;
        for (const [amount, selector] of [
            [minimum, "#projectContractAmountMinFilter"],
            [maximum, "#projectContractAmountMaxFilter"]
        ]) {
            if (amount && !/^\d{1,18}$/.test(amount)) {
                Common.ui.setInlineStatus(
                    query("#projectListStatus"),
                    "수주금액은 0 이상의 18자리 이내 정수로 입력해 주세요.",
                    "error"
                );
                query(selector).focus();
                return false;
            }
        }
        if (minimum && maximum && BigInt(minimum) > BigInt(maximum)) {
            Common.ui.setInlineStatus(query("#projectListStatus"), "수주금액 범위를 확인해 주세요.", "error");
            query("#projectContractAmountMaxFilter").focus();
            return false;
        }
        return true;
    }

    function setDetailSearchExpanded(expanded) {
        const fields = query("#projectDetailSearchFields");
        const button = query("#toggleProjectDetailSearchButton");
        if (!fields || !button) return;
        fields.hidden = !expanded;
        button.setAttribute("aria-expanded", String(expanded));
        button.textContent = expanded ? "상세조회 접기" : "상세조회";
    }

    async function fetchProjectPage(state) {
        const queryString = Common.api.query({
            ...searchParameters(),
            page: state.page,
            pageSize: state.pageSize,
            sortBy: state.sortBy,
            sortDirection: state.sortDirection
        });
        return Common.api.request(`/admin/projects${queryString}`, {
            method: "GET",
            signal: state.signal,
            showLoading: false
        });
    }

    function auditText(project, prefix) {
        const name = value(project, `${prefix}ByName`, `${prefix.toUpperCase()}_BY_NAME`);
        const userId = value(project, `${prefix}By`, `${prefix.toUpperCase()}_BY`);
        const timestamp = value(project, `${prefix}At`, `${prefix.toUpperCase()}_AT`);
        if (!timestamp && !name && !userId) return "-";
        const actor = name || (userId ? `사용자 #${userId}` : "시스템");
        return `${actor} · ${Common.format.dateTime(timestamp)}`;
    }

    function fillProjectForm(project = {}) {
        const id = projectId(project) || "";
        setValue("#projectId", id);
        setValue("#projectYear", value(project, "projectYear", "PROJECT_YEAR") || new Date().getFullYear());
        setValue("#projectName", value(project, "projectName", "PROJECT_NAME") || "");
        setValue("#projectCustomerName", value(project, "customerName", "CUSTOMER_NAME") || "");
        setValue("#projectStartDate", dateValue(value(project, "projectStartDate", "PROJECT_START_DATE")));
        setValue("#projectEndDate", dateValue(value(project, "projectEndDate", "PROJECT_END_DATE")));
        setValue("#projectOrderAmountVat", value(project, "orderAmountVat", "ORDER_AMOUNT_VAT") ?? 0);
        setValue("#projectContractAmountVat", value(project, "contractAmountVat", "CONTRACT_AMOUNT_VAT") ?? 0);
        setValue(
            "#projectParticipationTypeCode",
            value(project, "participationTypeCode", "PARTICIPATION_TYPE_CODE") || "LEAD"
        );
        setValue("#projectParticipationRate", value(project, "participationRate", "PARTICIPATION_RATE") ?? 100);
        setValue("#projectOrderDate", dateValue(value(project, "orderDate", "ORDER_DATE")));
        setValue("#projectBidDate", dateValue(value(project, "bidDate", "BID_DATE")));
        setValue("#projectStatusCode", value(project, "statusCode", "STATUS_CODE") || "PLANNED");
        setValue("#projectDepartmentCode", value(project, "departmentCode", "DEPARTMENT_CODE") || "");
        setValue("#projectDescription", value(project, "description", "DESCRIPTION") || "");

        query("#projectEditorTitle").textContent = id ? "프로젝트 상세 및 수정" : "프로젝트 등록";
        query("#projectEditorDescription").textContent = id
            ? `프로젝트 #${id}을(를) 수정하고 있습니다.`
            : "새 프로젝트를 등록하고 있습니다.";
        query("#deleteProjectButton").hidden = !id;
        query("#adminProjectCompanyJump").disabled = !id;
        query("#adminProjectRevenueJump").disabled = !id;
        query("#adminProjectRevenueAdd").disabled = !id;
        query("#projectAuditInfo").hidden = !id;
        query("#projectCreatedAudit").textContent = id ? auditText(project, "created") : "-";
        query("#projectUpdatedAudit").textContent = id ? auditText(project, "updated") : "-";
        Common.ui.setInlineStatus(query("#projectEditorStatus"), "");
        grid?.setSelectedKey(id);
        projectBaseline = formSnapshot("#projectForm");
        query("#adminProjectDialogTitle").textContent = id ? value(project, "projectName", "PROJECT_NAME") || "프로젝트 상세" : "새 프로젝트 등록";
    }

    function newProject(options = {}) {
        detailRequestId += 1;
        query("#projectForm")?.reset();
        grid?.clearSelection();
        fillProjectForm();
        loadProjectCompanies("");
        loadRevenue("");
        query("#adminProjectDialogFields").disabled = false;
        if (options.focus !== false) {
            openProjectDialog();
            query("#projectName")?.focus();
        }
    }

    async function loadProject(id) {
        if (!id) return;
        if (!(await confirmDiscard())) return;
        const requestId = ++detailRequestId;
        fillProjectForm();
        loadProjectCompanies("");
        loadRevenue("");
        query("#adminProjectDialogTitle").textContent = "프로젝트 상세 불러오는 중";
        query("#adminProjectDialogFields").disabled = true;
        openProjectDialog();
        grid?.setSelectedKey(id);
        Common.ui.setInlineStatus(query("#projectEditorStatus"), "프로젝트 상세를 불러오고 있습니다.");
        try {
            const payload = await Common.api.request(`/admin/projects/${encodeURIComponent(id)}`, {
                method: "GET",
                signal: controller.signal,
                showLoading: false
            });
            if (requestId !== detailRequestId) return;
            fillProjectForm(Common.data.get(payload) || {});
            await loadProjectCompanies(id);
            await loadRevenue(id);
            if (requestId !== detailRequestId) return;
            query("#adminProjectDialogFields").disabled = false;
            query("#adminProjectDialogTitle").focus({ preventScroll: true });
        } catch (error) {
            if (requestId !== detailRequestId || error?.name === "AbortError") return;
            query("#adminProjectDialogTitle").textContent = "프로젝트 조회 실패";
            Common.ui.setInlineStatus(
                query("#projectEditorStatus"),
                error.message || "프로젝트 상세를 불러오지 못했습니다.",
                "error"
            );
        }
    }

    function validWholeAmount(selector, label) {
        const element = query(selector);
        const amount = element.value.trim();
        if (/^\d{1,18}$/.test(amount)) return true;
        Common.ui.setInlineStatus(
            query("#projectEditorStatus"),
            `${label}은 0 이상의 18자리 이내 정수로 입력해 주세요.`,
            "error"
        );
        element.focus();
        return false;
    }

    function projectPayload() {
        return {
            projectYear: Number(query("#projectYear").value),
            projectName: query("#projectName").value.trim(),
            customerName: query("#projectCustomerName").value.trim(),
            projectStartDate: query("#projectStartDate").value,
            projectEndDate: query("#projectEndDate").value,
            orderAmountVat: query("#projectOrderAmountVat").value,
            contractAmountVat: query("#projectContractAmountVat").value,
            participationTypeCode: query("#projectParticipationTypeCode").value,
            participationRate: query("#projectParticipationRate").value,
            orderDate: query("#projectOrderDate").value || null,
            bidDate: query("#projectBidDate").value || null,
            statusCode: query("#projectStatusCode").value,
            departmentCode: query("#projectDepartmentCode").value || null,
            description: query("#projectDescription").value.trim()
        };
    }

    function validateProjectForm() {
        const form = query("#projectForm");
        Common.ui.setInlineStatus(query("#projectEditorStatus"), "");
        if (!form.reportValidity()) return false;
        if (query("#projectStartDate").value > query("#projectEndDate").value) {
            Common.ui.setInlineStatus(
                query("#projectEditorStatus"),
                "프로젝트 종료일은 시작일보다 빠를 수 없습니다.",
                "error"
            );
            query("#projectEndDate").focus();
            return false;
        }
        return validWholeAmount("#projectOrderAmountVat", "발주금액")
            && validWholeAmount("#projectContractAmountVat", "수주금액");
    }

    async function saveProject(event) {
        event.preventDefault();
        if (mutationBusy) return;
        if (!validateProjectForm()) return;
        const id = query("#projectId").value;
        const button = query("#saveProjectButton");
        button.disabled = true;
        mutationBusy = true;
        try {
            const response = await Common.api.request(
                id ? `/admin/projects/${encodeURIComponent(id)}` : "/admin/projects",
                {
                    method: id ? "PUT" : "POST",
                    body: projectPayload(),
                    signal: controller.signal,
                    loadingMessage: "프로젝트를 저장하고 있습니다."
                }
            );
            const saved = Common.data.get(response) || {};
            const savedId = projectId(saved) || id;
            fillProjectForm(saved);
            Common.ui.toast("프로젝트를 저장했습니다.", "success");
            await grid.load();
            grid.setSelectedKey(savedId);
            await loadProjectCompanies(savedId);
            await loadRevenue(savedId, Boolean(id));
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.setInlineStatus(
                    query("#projectEditorStatus"),
                    error.message || "프로젝트를 저장하지 못했습니다.",
                    "error"
                );
            }
        } finally {
            mutationBusy = false;
            button.disabled = false;
        }
    }

    async function deleteProject() {
        if (mutationBusy) return;
        const id = query("#projectId").value;
        const name = query("#projectName").value.trim() || "선택한 프로젝트";
        if (!id || !(await Common.ui.confirm(
            `“${name}” 프로젝트를 삭제하시겠습니까?`,
            { title: "프로젝트 삭제", confirmText: "삭제", danger: true }
        ))) return;

        const button = query("#deleteProjectButton");
        button.disabled = true;
        mutationBusy = true;
        try {
            await Common.api.request(`/admin/projects/${encodeURIComponent(id)}`, {
                method: "DELETE",
                signal: controller.signal,
                loadingMessage: "프로젝트를 삭제하고 있습니다."
            });
            Common.ui.toast("프로젝트를 삭제했습니다.", "success");
            newProject({ focus: false });
            query("#adminProjectDetailDialog").close();
            await grid.load();
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.setInlineStatus(
                    query("#projectEditorStatus"),
                    error.message || "프로젝트를 삭제하지 못했습니다.",
                    "error"
                );
            }
        } finally {
            mutationBusy = false;
            button.disabled = false;
        }
    }

    function projectCompanyPayload() {
        return {
            companyId: Number(query("#adminProjectCompanyMaster").value),
            participationTypeCode: query("#adminProjectCompanyType").value,
            shareRate: query("#adminProjectCompanyShareRate").value,
            note: query("#adminProjectCompanyNote").value.trim(),
            versionToken: query("#adminProjectCompanyId").value
                ? query("#adminProjectCompanyForm").dataset.versionToken
                : null
        };
    }

    async function saveProjectCompany(event) {
        event.preventDefault();
        if (mutationBusy) return;
        const projectIdValue = query("#projectId").value;
        const form = event.currentTarget;
        if (!projectIdValue) {
            Common.ui.setInlineStatus(query("#adminProjectCompanyStatus"), "프로젝트를 먼저 저장해 주세요.", "warning");
            return;
        }
        if (!form.reportValidity()) return;
        const companyId = query("#adminProjectCompanyId").value;
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        mutationBusy = true;
        try {
            await Common.api.request(
                `/project-assignments/${encodeURIComponent(projectIdValue)}/companies${companyId ? `/${encodeURIComponent(companyId)}` : ""}`,
                {
                    method: companyId ? "PUT" : "POST",
                    body: projectCompanyPayload(),
                    signal: controller.signal,
                    showLoading: false
                }
            );
            await loadProjectCompanies(projectIdValue);
            Common.ui.setInlineStatus(query("#adminProjectCompanyStatus"), "참여회사를 저장했습니다. 이제 해당 회사 인력을 프로젝트에 배치할 수 있습니다.", "success");
            Common.ui.toast("프로젝트 참여회사를 저장했습니다.", "success");
        } catch (error) {
            Common.ui.setInlineStatus(query("#adminProjectCompanyStatus"), error.message || "참여회사를 저장하지 못했습니다.", "error");
        } finally {
            mutationBusy = false;
            button.disabled = false;
        }
    }

    async function deleteProjectCompany() {
        if (mutationBusy) return;
        const projectIdValue = query("#projectId").value;
        const companyId = query("#adminProjectCompanyId").value;
        if (!projectIdValue || !companyId || !(await Common.ui.confirm(
            "선택한 참여회사를 프로젝트에서 삭제하시겠습니까?",
            { title: "참여회사 삭제", confirmText: "삭제", danger: true }
        ))) return;
        const button = query("#deleteAdminProjectCompanyButton");
        button.disabled = true;
        mutationBusy = true;
        try {
            await Common.api.request(
                `/project-assignments/${encodeURIComponent(projectIdValue)}/companies/${encodeURIComponent(companyId)}?versionToken=${encodeURIComponent(query("#adminProjectCompanyForm").dataset.versionToken || "")}`,
                { method: "DELETE", signal: controller.signal, showLoading: false }
            );
            await loadProjectCompanies(projectIdValue);
            Common.ui.toast("프로젝트 참여회사를 삭제했습니다.", "success");
        } catch (error) {
            Common.ui.setInlineStatus(query("#adminProjectCompanyStatus"), error.message || "참여회사를 삭제하지 못했습니다.", "error");
        } finally {
            mutationBusy = false;
            button.disabled = false;
        }
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            root = context.root;
            controller = new AbortController();
            const departmentResponse = await fetch("/config/departments.json", { signal: controller.signal, credentials: "same-origin" });
            if (!departmentResponse.ok) throw new Error("사업부 설정을 불러오지 못했습니다.");
            const departmentConfig = await departmentResponse.json();
            departmentConfig.departments.forEach((d) => query("#projectDepartmentCode").append(Common.dom.element("option", { text: d.label, attrs: { value: d.code } })));
            const dialog = query("#adminProjectDetailDialog");
            Common.ui.bindDraggableDialog(dialog, query("#adminProjectDialogHandle"), controller.signal);
            root.querySelectorAll("[data-admin-project-close]").forEach((button) => {
                button.addEventListener("click", closeProjectDialog, { signal: controller.signal });
            });
            root.querySelectorAll("[data-admin-project-section]").forEach((button) => {
                button.addEventListener("click", () => Common.ui.revealEditor(query(`#${button.dataset.adminProjectSection}`)), { signal: controller.signal });
            });
            query("#adminProjectRevenueRows").addEventListener("click",event=>{const button=event.target.closest("[data-revenue-save]");if(button) saveRevenue(button);},{signal:controller.signal});
            query("#adminProjectRevenueAdd").addEventListener("click",()=>{
                const year=Number(query("#adminProjectRevenueAddYear").value);
                if (!Number.isInteger(year) || year<1900 || year>2100 || !revenueData) return;
                let row=[...query("#adminProjectRevenueRows").rows].find(row=>Number(row.dataset.revenueYear)===year);
                if (!row) {row=revenueRow({year,revision:0,saved:false});query("#adminProjectRevenueRows").appendChild(row);}
                row.querySelector("[data-revenue-amount]").focus();
            },{signal:controller.signal});
            dialog.addEventListener("cancel", (event) => {
                event.preventDefault();
                closeProjectDialog();
            }, { signal: controller.signal });
            setDefaultProjectPeriodYearFilters();
            const referencePayload = await Common.api.request("/project-assignments/references", {
                signal: controller.signal,
                showLoading: false
            });
            masterCompanies = Common.data.get(referencePayload)?.companies || [];
            populateCompanyOptions();
            grid = Common.grid.create({
                root,
                body: "#projectTableBody",
                pagination: "#projectPagination",
                status: "#projectListStatus",
                pageSizeSelect: "#projectPageSize",
                itemMode: true,
                pageSize: 100,
                sortBy: "projectStartDate",
                sortDirection: "desc",
                fetchPage: fetchProjectPage,
                renderRow: renderProjectRow,
                rowKey: projectId,
                onSelect: (project) => loadProject(projectId(project)),
                emptyMessage: "조회된 프로젝트가 없습니다.",
                loadingMessage: "프로젝트 목록을 불러오고 있습니다.",
                signal: controller.signal
            });

            query("#projectSearchForm")?.addEventListener("submit", (event) => {
                event.preventDefault();
                if (!validateSearch()) return;
                newProject({ focus: false });
                grid.load({ resetPage: true });
            }, { signal: controller.signal });
            query("#resetProjectSearchButton")?.addEventListener("click", () => {
                query("#projectSearchForm")?.reset();
                setDefaultProjectPeriodYearFilters({ force: true });
                setDetailSearchExpanded(false);
                newProject({ focus: false });
                grid.setPageSize(query("#projectPageSize").value, { reload: false });
                grid.load({ resetPage: true });
            }, { signal: controller.signal });
            query("#toggleProjectDetailSearchButton")?.addEventListener("click", () => {
                const expanded = query("#toggleProjectDetailSearchButton").getAttribute("aria-expanded") === "true";
                setDetailSearchExpanded(!expanded);
            }, { signal: controller.signal });
            query("#projectSortSelect")?.addEventListener("change", changeProjectSort, {
                signal: controller.signal
            });
            root.querySelectorAll("[data-project-view]").forEach((button) => {
                button.addEventListener("click", () => setProjectView(button.dataset.projectView), {
                    signal: controller.signal
                });
            });
            query("#newProjectButton")?.addEventListener("click", () => newProject(), {
                signal: controller.signal
            });
            query("#clearProjectButton")?.addEventListener("click", async () => { if (await confirmDiscard()) newProject(); }, {
                signal: controller.signal
            });
            query("#projectForm")?.addEventListener("submit", saveProject, {
                signal: controller.signal
            });
            query("#deleteProjectButton")?.addEventListener("click", deleteProject, {
                signal: controller.signal
            });
            query("#adminProjectCompanyForm")?.addEventListener("submit", saveProjectCompany, { signal: controller.signal });
            query("#clearAdminProjectCompanyButton")?.addEventListener("click", clearProjectCompanyForm, { signal: controller.signal });
            query("#deleteAdminProjectCompanyButton")?.addEventListener("click", deleteProjectCompany, { signal: controller.signal });
            query("#adminProjectCompanyTableBody")?.addEventListener("click", (event) => {
                const id = event.target.closest("[data-project-company-id]")?.dataset.projectCompanyId;
                const company = projectCompanies.find((item) => String(value(item, "projectCompanyId", "PROJECT_COMPANY_ID")) === String(id));
                if (company) fillProjectCompanyForm(company);
            }, { signal: controller.signal });
            query("#adminProjectCompanyTableBody")?.addEventListener("keydown", (event) => {
                if (!["Enter", " "].includes(event.key)) return;
                const row = event.target.closest("[data-project-company-id]");
                if (!row) return;
                event.preventDefault();
                row.click();
            }, { signal: controller.signal });

            newProject({ focus: false });
            setProjectView(projectViewMode);
            applyListContext(context.routeContext);
            await grid.load();
            if (context.routeContext?.projectId) {await loadProject(context.routeContext.projectId);if(context.routeContext.view==="revenue") revealRevenue(context.routeContext.planYear);}
        },

        async activate(context = {}) {
            if (applyListContext(context.routeContext)) await grid.load({resetPage:true});
            if (context.routeContext?.projectId) {await loadProject(context.routeContext.projectId);if(context.routeContext.view==="revenue") revealRevenue(context.routeContext.planYear);}
        },

        async beforeLeave() {
            if (!(await confirmDiscard())) return false;
            detailRequestId += 1;
            companyRequestId += 1;
            revenueRequestId += 1;
            query("#adminProjectDetailDialog")?.close();
            return true;
        },
        deactivate() { query("#adminProjectDetailDialog")?.close(); },
        hasUnsavedChanges() { return mutationBusy || hasChanges(); },
        discardChanges() {
            projectBaseline = formSnapshot("#projectForm");
            companyBaseline = formSnapshot("#adminProjectCompanyForm");
            [...query("#adminProjectRevenueRows").rows].forEach(row=>revenueBaselines.set(row.dataset.revenueYear,revenueSnapshot(row)));
        },

        destroy() {
            detailRequestId += 1;
            companyRequestId += 1;
            revenueRequestId += 1;revenueData=null;revenueBaselines.clear();
            query("#adminProjectDetailDialog")?.close();
            mutationBusy = false;
            grid?.destroy();
            controller?.abort();
            grid = null;
            projectViewMode = "list";
            masterCompanies = [];
            projectCompanies = [];
            controller = null;
            root = null;
        }
    };
})();
