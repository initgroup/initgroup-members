(function() {
    "use strict";

    const PAGE_NAME = "freelancer-management";
    let root = null;
    let controller = null;
    let company = null;
    let freelancers = [];

    function query(selector) { return root?.querySelector(selector) || null; }
    function value(row, ...keys) { return Common.data.pick(row, ...keys); }
    function cell(text = "") { return Common.dom.element("td", { text }); }
    function dateValue(nextValue) { return nextValue ? String(nextValue).slice(0, 10) : ""; }

    function render() {
        const body = query("#freelancerTableBody"); Common.dom.clear(body);
        if (!freelancers.length) { const row = Common.dom.element("tr"); const empty = cell("등록된 프리랜서가 없습니다."); empty.colSpan = 6; row.appendChild(empty); body.appendChild(row); return; }
        freelancers.forEach((item) => { const row = Common.dom.element("tr", { attrs: { tabindex: "0", "data-employee-id": value(item, "companyEmployeeId", "COMPANY_EMPLOYEE_ID") } }); row.append(cell(value(item, "employeeName", "EMPLOYEE_NAME")), cell("프리랜서"), cell(value(item, "departmentName", "DEPARTMENT_NAME") || value(item, "jobTitle", "JOB_TITLE") || "-"), cell(value(item, "email", "EMAIL") || "-"), cell(value(item, "mobilePhone", "MOBILE_PHONE") || "-"), cell(value(item, "useYn", "USE_YN") === "Y" ? "사용" : "미사용")); body.appendChild(row); });
    }

    function clearForm() { query("#freelancerForm").reset(); query("#freelancerEmployeeId").value = ""; query("#deleteFreelancerButton").hidden = true; }
    function fill(item) { query("#freelancerEmployeeId").value = value(item, "companyEmployeeId", "COMPANY_EMPLOYEE_ID"); query("#freelancerName").value = value(item, "employeeName", "EMPLOYEE_NAME") || ""; query("#freelancerEmployeeNo").value = value(item, "employeeNo", "EMPLOYEE_NO") || ""; query("#freelancerDepartment").value = value(item, "departmentName", "DEPARTMENT_NAME") || ""; query("#freelancerPosition").value = value(item, "positionName", "POSITION_NAME") || ""; query("#freelancerJobTitle").value = value(item, "jobTitle", "JOB_TITLE") || ""; query("#freelancerEmail").value = value(item, "email", "EMAIL") || ""; query("#freelancerMobile").value = value(item, "mobilePhone", "MOBILE_PHONE") || ""; query("#freelancerJoinDate").value = dateValue(value(item, "joinDate", "JOIN_DATE")); query("#freelancerLeaveDate").value = dateValue(value(item, "leaveDate", "LEAVE_DATE")); query("#freelancerUseYn").value = value(item, "useYn", "USE_YN") || "Y"; query("#freelancerNote").value = value(item, "note", "NOTE") || ""; query("#deleteFreelancerButton").hidden = false; }
    function payload() { return { employeeNo: query("#freelancerEmployeeNo").value.trim(), employeeName: query("#freelancerName").value.trim(), departmentName: query("#freelancerDepartment").value.trim(), positionName: query("#freelancerPosition").value.trim(), jobTitle: query("#freelancerJobTitle").value.trim(), email: query("#freelancerEmail").value.trim(), mobilePhone: query("#freelancerMobile").value.trim(), joinDate: query("#freelancerJoinDate").value || null, leaveDate: query("#freelancerLeaveDate").value || null, useYn: query("#freelancerUseYn").value, note: query("#freelancerNote").value.trim() }; }

    async function loadData() { const response = await Common.api.request("/admin/companies/freelancers", { signal: controller.signal, showLoading: false }); const data = Common.data.get(response) || {}; company = value(data, "company", "COMPANY") || null; freelancers = value(data, "employees", "EMPLOYEES") || []; query("#freelancerCompanyId").value = company ? value(company, "companyId", "COMPANY_ID") : ""; render(); Common.ui.setInlineStatus(query("#freelancerListStatus"), `${freelancers.length}명의 프리랜서를 조회했습니다.`); }
    async function save(event) { event.preventDefault(); if (!event.currentTarget.reportValidity()) return; const id = query("#freelancerEmployeeId").value; const companyId = query("#freelancerCompanyId").value; const path = id ? `/admin/companies/freelancers/${encodeURIComponent(companyId)}/employees/${encodeURIComponent(id)}` : "/admin/companies/freelancers/employees"; await Common.api.request(path, { method: id ? "PUT" : "POST", body: payload(), signal: controller.signal, loadingMessage: "프리랜서를 저장하고 있습니다." }); Common.ui.toast("프리랜서를 저장했습니다.", "success"); clearForm(); await loadData(); }
    async function remove() { const id = query("#freelancerEmployeeId").value; const companyId = query("#freelancerCompanyId").value; if (!id || !companyId || !(await Common.ui.confirm("선택한 프리랜서를 삭제하시겠습니까?", { title: "프리랜서 삭제", confirmText: "삭제", danger: true }))) return; await Common.api.request(`/admin/companies/freelancers/${encodeURIComponent(companyId)}/employees/${encodeURIComponent(id)}`, { method: "DELETE", signal: controller.signal }); clearForm(); await loadData(); }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) { root = context.root; controller = new AbortController(); query("#freelancerTableBody").addEventListener("click", (event) => { const id = event.target.closest("tr[data-employee-id]")?.dataset.employeeId; const item = freelancers.find((row) => String(value(row, "companyEmployeeId", "COMPANY_EMPLOYEE_ID")) === id); if (item) fill(item); }, { signal: controller.signal }); query("#newFreelancerButton").addEventListener("click", clearForm, { signal: controller.signal }); query("#clearFreelancerButton").addEventListener("click", clearForm, { signal: controller.signal }); query("#freelancerForm").addEventListener("submit", (event) => save(event).catch((error) => Common.ui.setInlineStatus(query("#freelancerEditorStatus"), error.message, "error")), { signal: controller.signal }); query("#deleteFreelancerButton").addEventListener("click", () => remove().catch((error) => Common.ui.setInlineStatus(query("#freelancerEditorStatus"), error.message, "error")), { signal: controller.signal }); clearForm(); await loadData(); },
        destroy() { controller?.abort(); controller = null; root = null; company = null; freelancers = []; }
    };
})();
