(function() {
    "use strict";

    const PAGE_NAME = "init-company";
    const HISTORY_LABELS = { ESTABLISHED: "설립", NAME_CHANGE: "상호 변경", ADDRESS_CHANGE: "주소 변경", CERTIFICATION: "인증", OTHER: "기타" };
    let root = null;
    let controller = null;
    let company = null;
    let histories = [];

    function query(selector) { return root?.querySelector(selector) || null; }
    function value(row, ...keys) { return Common.data.pick(row, ...keys); }
    function cell(text = "") { return Common.dom.element("td", { text }); }
    function dateValue(nextValue) { return nextValue ? String(nextValue).slice(0, 10) : ""; }

    function companyPayload() {
        return { companyName: query("#initCompanyName").value.trim(), businessNumber: query("#initBusinessNumber").value.trim(), representativeName: query("#initRepresentativeName").value.trim(), businessType: query("#initBusinessType").value.trim(), businessItem: query("#initBusinessItem").value.trim(), email: query("#initCompanyEmail").value.trim(), phone: query("#initCompanyPhone").value.trim(), address: query("#initCompanyAddress").value.trim(), websiteUrl: query("#initWebsiteUrl").value.trim(), establishedDate: query("#initEstablishedDate").value || null, useYn: query("#initCompanyUseYn").value, note: query("#initCompanyNote").value.trim() };
    }

    function fillCompany() {
        if (!company) return;
        query("#initCompanyId").value = value(company, "companyId", "COMPANY_ID"); query("#initCompanyName").value = value(company, "companyName", "COMPANY_NAME") || "인아이티";
        query("#initBusinessNumber").value = value(company, "businessNumber", "BUSINESS_NUMBER") || ""; query("#initRepresentativeName").value = value(company, "representativeName", "REPRESENTATIVE_NAME") || "";
        query("#initBusinessType").value = value(company, "businessType", "BUSINESS_TYPE") || ""; query("#initBusinessItem").value = value(company, "businessItem", "BUSINESS_ITEM") || "";
        query("#initCompanyEmail").value = value(company, "email", "EMAIL") || ""; query("#initCompanyPhone").value = value(company, "phone", "PHONE") || "";
        query("#initCompanyAddress").value = value(company, "address", "ADDRESS") || ""; query("#initWebsiteUrl").value = value(company, "websiteUrl", "WEBSITE_URL") || "";
        query("#initEstablishedDate").value = dateValue(value(company, "establishedDate", "ESTABLISHED_DATE")); query("#initCompanyUseYn").value = value(company, "useYn", "USE_YN") || "Y";
        query("#initCompanyNote").value = value(company, "note", "NOTE") || "";
    }

    function renderHistories() {
        const body = query("#initHistoryTableBody"); Common.dom.clear(body);
        if (!histories.length) { const row = Common.dom.element("tr"); const empty = cell("등록된 회사 이력이 없습니다."); empty.colSpan = 4; row.appendChild(empty); body.appendChild(row); return; }
        histories.forEach((history) => { const row = Common.dom.element("tr", { attrs: { tabindex: "0", "data-history-id": value(history, "companyHistoryId", "COMPANY_HISTORY_ID") } }); row.append(cell(dateValue(value(history, "historyDate", "HISTORY_DATE"))), cell(HISTORY_LABELS[value(history, "historyTypeCode", "HISTORY_TYPE_CODE")] || "기타"), cell(value(history, "title", "TITLE")), cell(value(history, "content", "CONTENT") || "-")); body.appendChild(row); });
    }

    function clearHistory() { query("#initHistoryForm").reset(); query("#initHistoryId").value = ""; query("#initHistoryDate").value = new Date().toISOString().slice(0, 10); query("#deleteInitHistoryButton").hidden = true; }
    function fillHistory(history) { query("#initHistoryId").value = value(history, "companyHistoryId", "COMPANY_HISTORY_ID"); query("#initHistoryDate").value = dateValue(value(history, "historyDate", "HISTORY_DATE")); query("#initHistoryType").value = value(history, "historyTypeCode", "HISTORY_TYPE_CODE") || "OTHER"; query("#initHistoryTitleInput").value = value(history, "title", "TITLE") || ""; query("#initHistoryContent").value = value(history, "content", "CONTENT") || ""; query("#deleteInitHistoryButton").hidden = false; }

    async function loadData() {
        const payload = await Common.api.request("/admin/companies/headquarters", { signal: controller.signal, showLoading: false }); const data = Common.data.get(payload) || {};
        company = value(data, "company", "COMPANY") || null; histories = value(data, "histories", "HISTORIES") || [];
        if (company) fillCompany(); renderHistories(); clearHistory(); query("#initHistoryPanel").hidden = !company;
        Common.ui.setInlineStatus(query("#initCompanyStatus"), company ? "본사 정보를 조회했습니다." : "본사 정보를 입력하고 저장해 주세요.");
    }

    async function saveCompany(event) { event.preventDefault(); if (!event.currentTarget.reportValidity()) return; await Common.api.request("/admin/companies/headquarters", { method: "PUT", body: companyPayload(), signal: controller.signal, loadingMessage: "본사 정보를 저장하고 있습니다." }); Common.ui.toast("본사 정보를 저장했습니다.", "success"); await loadData(); }
    async function saveHistory(event) { event.preventDefault(); if (!event.currentTarget.reportValidity() || !company) return; const id = query("#initHistoryId").value; await Common.api.request(`/admin/companies/headquarters/${encodeURIComponent(value(company, "companyId", "COMPANY_ID"))}/histories${id ? `/${encodeURIComponent(id)}` : ""}`, { method: id ? "PUT" : "POST", body: { historyDate: query("#initHistoryDate").value, historyTypeCode: query("#initHistoryType").value, title: query("#initHistoryTitleInput").value.trim(), content: query("#initHistoryContent").value.trim() }, signal: controller.signal }); Common.ui.toast("회사 이력을 저장했습니다.", "success"); await loadData(); }
    async function deleteHistory() { const id = query("#initHistoryId").value; if (!id || !company || !(await Common.ui.confirm("선택한 회사 이력을 삭제하시겠습니까?", { title: "회사 이력 삭제", confirmText: "삭제", danger: true }))) return; await Common.api.request(`/admin/companies/headquarters/${encodeURIComponent(value(company, "companyId", "COMPANY_ID"))}/histories/${encodeURIComponent(id)}`, { method: "DELETE", signal: controller.signal }); await loadData(); }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            root = context.root; controller = new AbortController();
            query("#initCompanyForm").addEventListener("submit", (event) => saveCompany(event).catch((error) => Common.ui.setInlineStatus(query("#initCompanyStatus"), error.message, "error")), { signal: controller.signal });
            query("#initHistoryForm").addEventListener("submit", (event) => saveHistory(event).catch((error) => Common.ui.setInlineStatus(query("#initHistoryStatus"), error.message, "error")), { signal: controller.signal });
            query("#initHistoryTableBody").addEventListener("click", (event) => { const id = event.target.closest("tr[data-history-id]")?.dataset.historyId; const history = histories.find((item) => String(value(item, "companyHistoryId", "COMPANY_HISTORY_ID")) === id); if (history) fillHistory(history); }, { signal: controller.signal });
            query("#newInitHistoryButton").addEventListener("click", clearHistory, { signal: controller.signal }); query("#clearInitHistoryButton").addEventListener("click", clearHistory, { signal: controller.signal });
            query("#deleteInitHistoryButton").addEventListener("click", () => deleteHistory().catch((error) => Common.ui.setInlineStatus(query("#initHistoryStatus"), error.message, "error")), { signal: controller.signal });
            await loadData();
        },
        destroy() { controller?.abort(); controller = null; root = null; company = null; histories = []; }
    };
})();
