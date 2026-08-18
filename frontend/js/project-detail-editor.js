(function() {
    "use strict";

    const PAGE_NAME = "project-detail-editor";
    const PARTICIPATION_LABELS = { LEAD: "주관사", CONSORTIUM: "컨소사", SUBCONTRACT: "하도급" };
    let root = null;
    let controller = null;
    let projectId = "";
    let masterCompanies = [];
    let projectCompanies = [];
    let projectDirty = false;
    let companyDirty = false;

    function query(selector) { return root?.querySelector(selector) || null; }
    function value(row, ...keys) { return Common.data.pick(row, ...keys); }
    function setValue(selector, nextValue) {
        const input = query(selector);
        if (input) input.value = nextValue ?? "";
    }
    function dateValue(nextValue) { return nextValue ? String(nextValue).slice(0, 10) : ""; }
    function companyTypeLabel(company) {
        return String(value(company, "companyTypeCode", "COMPANY_TYPE_CODE") || "").toUpperCase() === "HEADQUARTERS"
            ? "본사"
            : "협력업체";
    }
    function markDirty(type, dirty = true) {
        if (type === "project") projectDirty = dirty;
        if (type === "company") companyDirty = dirty;
    }

    function populateCompanyOptions() {
        const select = query("#projectDetailCompanyMaster");
        select.replaceChildren(Common.dom.element("option", { value: "", text: "회사 선택" }));
        masterCompanies.forEach((company) => select.appendChild(Common.dom.element("option", {
            value: value(company, "companyId", "COMPANY_ID"),
            text: `${companyTypeLabel(company)} · ${value(company, "companyName", "COMPANY_NAME") || "회사명 미정"}`
        })));
    }

    function fillProject(project) {
        setValue("#projectDetailId", value(project, "projectId", "PROJECT_ID", "id", "ID") || projectId);
        setValue("#projectDetailYear", value(project, "projectYear", "PROJECT_YEAR"));
        setValue("#projectDetailName", value(project, "projectName", "PROJECT_NAME"));
        setValue("#projectDetailCustomerName", value(project, "customerName", "CUSTOMER_NAME"));
        setValue("#projectDetailStartDate", dateValue(value(project, "projectStartDate", "PROJECT_START_DATE")));
        setValue("#projectDetailEndDate", dateValue(value(project, "projectEndDate", "PROJECT_END_DATE")));
        setValue("#projectDetailOrderAmountVat", value(project, "orderAmountVat", "ORDER_AMOUNT_VAT") ?? 0);
        setValue("#projectDetailContractAmountVat", value(project, "contractAmountVat", "CONTRACT_AMOUNT_VAT") ?? 0);
        setValue("#projectDetailParticipationTypeCode", value(project, "participationTypeCode", "PARTICIPATION_TYPE_CODE") || "LEAD");
        setValue("#projectDetailParticipationRate", value(project, "participationRate", "PARTICIPATION_RATE") ?? 100);
        setValue("#projectDetailOrderDate", dateValue(value(project, "orderDate", "ORDER_DATE")));
        setValue("#projectDetailBidDate", dateValue(value(project, "bidDate", "BID_DATE")));
        setValue("#projectDetailStatusCode", value(project, "statusCode", "STATUS_CODE") || "PLANNED");
        setValue("#projectDetailDescription", value(project, "description", "DESCRIPTION") || "");
        markDirty("project", false);
    }

    function projectPayload() {
        return {
            projectYear: Number(query("#projectDetailYear").value),
            projectName: query("#projectDetailName").value.trim(),
            customerName: query("#projectDetailCustomerName").value.trim(),
            projectStartDate: query("#projectDetailStartDate").value,
            projectEndDate: query("#projectDetailEndDate").value,
            orderAmountVat: query("#projectDetailOrderAmountVat").value,
            contractAmountVat: query("#projectDetailContractAmountVat").value,
            participationTypeCode: query("#projectDetailParticipationTypeCode").value,
            participationRate: query("#projectDetailParticipationRate").value,
            orderDate: query("#projectDetailOrderDate").value || null,
            bidDate: query("#projectDetailBidDate").value || null,
            statusCode: query("#projectDetailStatusCode").value,
            description: query("#projectDetailDescription").value.trim()
        };
    }

    function validateProject() {
        const form = query("#projectDetailForm");
        Common.ui.setInlineStatus(query("#projectDetailStatus"), "");
        if (!form.reportValidity()) return false;
        if (query("#projectDetailStartDate").value > query("#projectDetailEndDate").value) {
            Common.ui.setInlineStatus(query("#projectDetailStatus"), "프로젝트 종료일은 시작일보다 빠를 수 없습니다.", "error");
            query("#projectDetailEndDate").focus();
            return false;
        }
        for (const [selector, label] of [["#projectDetailOrderAmountVat", "발주금액"], ["#projectDetailContractAmountVat", "수주금액"]]) {
            if (!/^\d{1,18}$/.test(query(selector).value.trim())) {
                Common.ui.setInlineStatus(query("#projectDetailStatus"), `${label}은 0 이상의 18자리 이내 정수로 입력해 주세요.`, "error");
                query(selector).focus();
                return false;
            }
        }
        return true;
    }

    function clearCompanyForm() {
        query("#projectDetailCompanyForm").reset();
        setValue("#projectDetailCompanyId", "");
        setValue("#projectDetailCompanyType", "LEAD");
        setValue("#projectDetailCompanyShareRate", 0);
        query("#projectDetailCompanyForm").dataset.versionToken = "";
        markDirty("company", false);
    }

    function fillCompany(company) {
        setValue("#projectDetailCompanyId", value(company, "projectCompanyId", "PROJECT_COMPANY_ID"));
        setValue("#projectDetailCompanyMaster", value(company, "companyId", "COMPANY_ID"));
        setValue("#projectDetailCompanyType", value(company, "participationTypeCode", "PARTICIPATION_TYPE_CODE") || "LEAD");
        setValue("#projectDetailCompanyShareRate", value(company, "shareRate", "SHARE_RATE") ?? 0);
        setValue("#projectDetailCompanyNote", value(company, "note", "NOTE") || "");
        query("#projectDetailCompanyForm").dataset.versionToken = value(company, "versionToken", "VERSION_TOKEN") || "";
        markDirty("company", false);
        renderCompanies(value(company, "projectCompanyId", "PROJECT_COMPANY_ID"));
    }

    function renderCompanies(selectedId = query("#projectDetailCompanyId")?.value || "") {
        const body = query("#projectDetailCompanyTableBody");
        body.replaceChildren();
        if (!projectCompanies.length) {
            const row = Common.dom.element("tr");
            const cell = Common.dom.element("td", { text: "등록된 참여회사가 없습니다. 아래 입력란에서 최초 참여회사를 저장해 주세요." });
            cell.colSpan = 5;
            cell.className = "grid-empty-cell";
            row.appendChild(cell);
            body.appendChild(row);
            return;
        }
        projectCompanies.forEach((company) => {
            const id = value(company, "projectCompanyId", "PROJECT_COMPANY_ID");
            const master = masterCompanies.find((item) => String(value(item, "companyId", "COMPANY_ID")) === String(value(company, "companyId", "COMPANY_ID")));
            const row = Common.dom.element("tr", { attrs: { tabindex: "0", "data-project-detail-company-id": id } });
            row.classList.toggle("is-selected", String(id) === String(selectedId));
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

    async function loadCompanies(preferredId = "") {
        const payload = await Common.api.request(`/project-assignments?projectId=${encodeURIComponent(projectId)}`, {
            signal: controller.signal,
            showLoading: false
        });
        projectCompanies = Common.data.get(payload)?.companies || [];
        clearCompanyForm();
        const selected = projectCompanies.find((company) => String(value(company, "projectCompanyId", "PROJECT_COMPANY_ID")) === String(preferredId))
            || projectCompanies[0];
        if (selected) fillCompany(selected);
        else renderCompanies();
        Common.ui.setInlineStatus(
            query("#projectDetailCompanyStatus"),
            projectCompanies.length ? `${projectCompanies.length}개의 참여회사가 등록되어 있습니다.` : "최초 참여회사를 선택해 저장해 주세요.",
            projectCompanies.length ? "success" : "warning"
        );
    }

    async function saveProject(event) {
        event.preventDefault();
        if (!validateProject()) return;
        const button = query("#saveProjectDetailButton");
        button.disabled = true;
        try {
            const response = await Common.api.request(`/admin/projects/${encodeURIComponent(projectId)}`, {
                method: "PUT",
                body: projectPayload(),
                signal: controller.signal,
                loadingMessage: "프로젝트를 저장하고 있습니다."
            });
            fillProject(Common.data.get(response) || projectPayload());
            Common.ui.setInlineStatus(query("#projectDetailStatus"), "프로젝트 상세정보를 저장했습니다.", "success");
            Common.ui.toast("프로젝트를 저장했습니다.", "success");
        } catch (error) {
            Common.ui.setInlineStatus(query("#projectDetailStatus"), error.message || "프로젝트를 저장하지 못했습니다.", "error");
        } finally {
            button.disabled = false;
        }
    }

    async function saveCompany(event) {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const id = query("#projectDetailCompanyId").value;
        const button = query("#saveProjectDetailCompanyButton");
        button.disabled = true;
        try {
            const response = await Common.api.request(
                `/project-assignments/${encodeURIComponent(projectId)}/companies${id ? `/${encodeURIComponent(id)}` : ""}`,
                {
                    method: id ? "PUT" : "POST",
                    body: {
                        companyId: Number(query("#projectDetailCompanyMaster").value),
                        participationTypeCode: query("#projectDetailCompanyType").value,
                        shareRate: query("#projectDetailCompanyShareRate").value,
                        note: query("#projectDetailCompanyNote").value.trim(),
                        versionToken: id ? form.dataset.versionToken : null
                    },
                    signal: controller.signal,
                    showLoading: false
                }
            );
            const savedId = id || value(Common.data.get(response) || {}, "projectCompanyId", "PROJECT_COMPANY_ID");
            await loadCompanies(savedId);
            Common.ui.setInlineStatus(query("#projectDetailCompanyStatus"), "참여회사 정보를 저장했습니다.", "success");
            Common.ui.toast("프로젝트 참여회사를 저장했습니다.", "success");
        } catch (error) {
            Common.ui.setInlineStatus(query("#projectDetailCompanyStatus"), error.message || "참여회사 정보를 저장하지 못했습니다.", "error");
        } finally {
            button.disabled = false;
        }
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            root = context.root;
            controller = new AbortController();
            projectId = String(context.routeContext?.projectId || "");
            if (!projectId) throw new Error("수정할 프로젝트를 찾지 못했습니다.");
            const [referencePayload, projectPayloadValue] = await Promise.all([
                Common.api.request("/project-assignments/references", { signal: controller.signal, showLoading: false }),
                Common.api.request(`/admin/projects/${encodeURIComponent(projectId)}`, { signal: controller.signal, showLoading: false })
            ]);
            masterCompanies = Common.data.get(referencePayload)?.companies || [];
            populateCompanyOptions();
            fillProject(Common.data.get(projectPayloadValue) || {});
            await loadCompanies();
            query("#projectDetailForm").addEventListener("input", () => markDirty("project"), { signal: controller.signal });
            query("#projectDetailForm").addEventListener("submit", saveProject, { signal: controller.signal });
            query("#projectDetailCompanyForm").addEventListener("input", () => markDirty("company"), { signal: controller.signal });
            query("#projectDetailCompanyForm").addEventListener("submit", saveCompany, { signal: controller.signal });
            query("#projectDetailCompanyTableBody").addEventListener("click", (event) => {
                const id = event.target.closest("[data-project-detail-company-id]")?.dataset.projectDetailCompanyId;
                const company = projectCompanies.find((item) => String(value(item, "projectCompanyId", "PROJECT_COMPANY_ID")) === String(id));
                if (company) fillCompany(company);
            }, { signal: controller.signal });
            query("#projectDetailCompanyTableBody").addEventListener("keydown", (event) => {
                if (!["Enter", " "].includes(event.key)) return;
                const row = event.target.closest("[data-project-detail-company-id]");
                if (!row) return;
                event.preventDefault();
                row.click();
            }, { signal: controller.signal });
        },

        hasUnsavedChanges() { return projectDirty || companyDirty; },
        discardChanges() {
            projectDirty = false;
            companyDirty = false;
        },
        destroy() {
            controller?.abort();
            root = null;
            controller = null;
            projectId = "";
            masterCompanies = [];
            projectCompanies = [];
            projectDirty = false;
            companyDirty = false;
        }
    };
})();
