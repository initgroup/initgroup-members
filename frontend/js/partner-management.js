(function() {
    "use strict";

    const PAGE_NAME = "partner-management";
    let root = null;
    let controller = null;
    let companies = [];
    let employees = [];

    function query(selector) { return root?.querySelector(selector) || null; }
    function value(row, ...keys) { return Common.data.pick(row, ...keys); }
    function cell(text = "") { return Common.dom.element("td", { text }); }
    function dateValue(nextValue) { return nextValue ? String(nextValue).slice(0, 10) : ""; }
    function selectedCompanyId() { return query("#partnerCompanyId").value; }

    function companyPayload() {
        return {
            companyName: query("#partnerCompanyName").value.trim(), businessNumber: query("#partnerBusinessNumber").value.trim(),
            representativeName: query("#partnerRepresentativeName").value.trim(), businessType: query("#partnerBusinessType").value.trim(),
            businessItem: query("#partnerBusinessItem").value.trim(), email: query("#partnerEmail").value.trim(), phone: query("#partnerPhone").value.trim(),
            address: query("#partnerAddress").value.trim(), websiteUrl: query("#partnerWebsiteUrl").value.trim(), establishedDate: query("#partnerEstablishedDate").value || null,
            useYn: query("#partnerUseYn").value, note: query("#partnerNote").value.trim()
        };
    }

    function employeePayload() {
        return {
            employeeNo: query("#partnerEmployeeNo").value.trim(), employeeName: query("#partnerEmployeeName").value.trim(),
            departmentName: query("#partnerEmployeeDepartment").value.trim(), positionName: query("#partnerEmployeePosition").value.trim(),
            jobTitle: query("#partnerEmployeeJobTitle").value.trim(), email: query("#partnerEmployeeEmail").value.trim(),
            mobilePhone: query("#partnerEmployeeMobile").value.trim(), joinDate: query("#partnerEmployeeJoinDate").value || null,
            leaveDate: query("#partnerEmployeeLeaveDate").value || null, useYn: query("#partnerEmployeeUseYn").value,
            note: query("#partnerEmployeeNote").value.trim()
        };
    }

    function renderCompanies() {
        const body = query("#partnerTableBody"); Common.dom.clear(body);
        if (!companies.length) { const row = Common.dom.element("tr"); const empty = cell("등록된 협력업체가 없습니다."); empty.colSpan = 5; row.appendChild(empty); body.appendChild(row); return; }
        companies.forEach((company) => {
            const row = Common.dom.element("tr", { attrs: { tabindex: "0", "data-company-id": value(company, "companyId", "COMPANY_ID") } });
            row.append(cell(value(company, "companyName", "COMPANY_NAME")), cell(value(company, "businessNumber", "BUSINESS_NUMBER") || "-"), cell(value(company, "representativeName", "REPRESENTATIVE_NAME") || "-"), cell(value(company, "phone", "PHONE") || "-"), cell(value(company, "useYn", "USE_YN") === "Y" ? "사용" : "미사용"));
            body.appendChild(row);
        });
    }

    function renderEmployees() {
        const body = query("#partnerEmployeeTableBody"); Common.dom.clear(body);
        if (!employees.length) { const row = Common.dom.element("tr"); const empty = cell("등록된 직원이 없습니다."); empty.colSpan = 6; row.appendChild(empty); body.appendChild(row); return; }
        employees.forEach((employee) => {
            const row = Common.dom.element("tr", { attrs: { tabindex: "0", "data-employee-id": value(employee, "companyEmployeeId", "COMPANY_EMPLOYEE_ID") } });
            row.append(cell(value(employee, "employeeName", "EMPLOYEE_NAME")), cell(value(employee, "employeeNo", "EMPLOYEE_NO") || "-"), cell(value(employee, "departmentName", "DEPARTMENT_NAME") || "-"), cell(`${value(employee, "positionName", "POSITION_NAME") || "-"} / ${value(employee, "jobTitle", "JOB_TITLE") || "-"}`), cell(value(employee, "mobilePhone", "MOBILE_PHONE") || value(employee, "email", "EMAIL") || "-"), cell(value(employee, "useYn", "USE_YN") === "Y" ? "재직" : "퇴사/미사용"));
            body.appendChild(row);
        });
    }

    function clearEmployeeForm() {
        query("#partnerEmployeeForm").reset(); query("#partnerEmployeeId").value = ""; query("#deletePartnerEmployeeButton").hidden = true;
    }

    function fillEmployee(employee) {
        query("#partnerEmployeeId").value = value(employee, "companyEmployeeId", "COMPANY_EMPLOYEE_ID");
        query("#partnerEmployeeName").value = value(employee, "employeeName", "EMPLOYEE_NAME") || ""; query("#partnerEmployeeNo").value = value(employee, "employeeNo", "EMPLOYEE_NO") || "";
        query("#partnerEmployeeDepartment").value = value(employee, "departmentName", "DEPARTMENT_NAME") || ""; query("#partnerEmployeePosition").value = value(employee, "positionName", "POSITION_NAME") || "";
        query("#partnerEmployeeJobTitle").value = value(employee, "jobTitle", "JOB_TITLE") || ""; query("#partnerEmployeeEmail").value = value(employee, "email", "EMAIL") || "";
        query("#partnerEmployeeMobile").value = value(employee, "mobilePhone", "MOBILE_PHONE") || ""; query("#partnerEmployeeJoinDate").value = dateValue(value(employee, "joinDate", "JOIN_DATE"));
        query("#partnerEmployeeLeaveDate").value = dateValue(value(employee, "leaveDate", "LEAVE_DATE")); query("#partnerEmployeeUseYn").value = value(employee, "useYn", "USE_YN") || "Y";
        query("#partnerEmployeeNote").value = value(employee, "note", "NOTE") || ""; query("#deletePartnerEmployeeButton").hidden = false;
    }

    async function loadEmployees(company) {
        const companyId = value(company, "companyId", "COMPANY_ID");
        const payload = await Common.api.request(`/admin/companies/partners/${encodeURIComponent(companyId)}/employees`, { signal: controller.signal, showLoading: false });
        employees = Common.data.pick(Common.data.get(payload) || {}, "employees", "EMPLOYEES") || [];
        renderEmployees(); clearEmployeeForm(); query("#partnerEmployeePanel").hidden = false;
        query("#partnerEmployeeDescription").textContent = `${value(company, "companyName", "COMPANY_NAME")} 소속 직원을 관리합니다.`;
    }

    function fillCompany(company) {
        query("#partnerCompanyId").value = value(company, "companyId", "COMPANY_ID"); query("#partnerCompanyName").value = value(company, "companyName", "COMPANY_NAME") || "";
        query("#partnerBusinessNumber").value = value(company, "businessNumber", "BUSINESS_NUMBER") || ""; query("#partnerRepresentativeName").value = value(company, "representativeName", "REPRESENTATIVE_NAME") || "";
        query("#partnerBusinessType").value = value(company, "businessType", "BUSINESS_TYPE") || ""; query("#partnerBusinessItem").value = value(company, "businessItem", "BUSINESS_ITEM") || "";
        query("#partnerEmail").value = value(company, "email", "EMAIL") || ""; query("#partnerPhone").value = value(company, "phone", "PHONE") || ""; query("#partnerAddress").value = value(company, "address", "ADDRESS") || "";
        query("#partnerWebsiteUrl").value = value(company, "websiteUrl", "WEBSITE_URL") || ""; query("#partnerEstablishedDate").value = dateValue(value(company, "establishedDate", "ESTABLISHED_DATE"));
        query("#partnerUseYn").value = value(company, "useYn", "USE_YN") || "Y"; query("#partnerNote").value = value(company, "note", "NOTE") || ""; query("#deletePartnerButton").hidden = false;
        loadEmployees(company).catch((error) => Common.ui.setInlineStatus(query("#partnerEmployeeStatus"), error.message, "error"));
    }

    function clearCompanyForm() {
        query("#partnerForm").reset(); query("#partnerCompanyId").value = ""; query("#deletePartnerButton").hidden = true; query("#partnerEmployeePanel").hidden = true; employees = [];
    }

    async function loadCompanies(selectId = "") {
        const payload = await Common.api.request("/admin/companies/partners", { signal: controller.signal, showLoading: false });
        companies = Common.data.pick(Common.data.get(payload) || {}, "companies", "COMPANIES") || []; renderCompanies();
        Common.ui.setInlineStatus(query("#partnerListStatus"), `${companies.length}개 협력업체를 조회했습니다.`);
        if (selectId) { const company = companies.find((item) => String(value(item, "companyId", "COMPANY_ID")) === String(selectId)); if (company) fillCompany(company); }
    }

    async function saveCompany(event) {
        event.preventDefault(); if (!event.currentTarget.reportValidity()) return;
        const id = selectedCompanyId(); const payload = await Common.api.request(`/admin/companies/partners${id ? `/${encodeURIComponent(id)}` : ""}`, { method: id ? "PUT" : "POST", body: companyPayload(), signal: controller.signal, loadingMessage: "협력업체를 저장하고 있습니다." });
        const savedId = id || value(Common.data.get(payload) || {}, "companyId", "COMPANY_ID"); Common.ui.toast("협력업체를 저장했습니다.", "success"); await loadCompanies(savedId);
    }

    async function deleteCompany() {
        const id = selectedCompanyId(); if (!id || !(await Common.ui.confirm("선택한 협력업체를 삭제하시겠습니까?", { title: "협력업체 삭제", confirmText: "삭제", danger: true }))) return;
        await Common.api.request(`/admin/companies/partners/${encodeURIComponent(id)}`, { method: "DELETE", signal: controller.signal, loadingMessage: "협력업체를 삭제하고 있습니다." }); clearCompanyForm(); await loadCompanies();
    }

    async function saveEmployee(event) {
        event.preventDefault(); if (!event.currentTarget.reportValidity() || !selectedCompanyId()) return;
        const id = query("#partnerEmployeeId").value; await Common.api.request(`/admin/companies/partners/${encodeURIComponent(selectedCompanyId())}/employees${id ? `/${encodeURIComponent(id)}` : ""}`, { method: id ? "PUT" : "POST", body: employeePayload(), signal: controller.signal, loadingMessage: "직원 정보를 저장하고 있습니다." });
        Common.ui.toast("직원 정보를 저장했습니다.", "success"); const company = companies.find((item) => String(value(item, "companyId", "COMPANY_ID")) === selectedCompanyId()); await loadEmployees(company);
    }

    async function deleteEmployee() {
        const id = query("#partnerEmployeeId").value; if (!id || !(await Common.ui.confirm("선택한 직원을 삭제하시겠습니까?", { title: "직원 삭제", confirmText: "삭제", danger: true }))) return;
        await Common.api.request(`/admin/companies/partners/${encodeURIComponent(selectedCompanyId())}/employees/${encodeURIComponent(id)}`, { method: "DELETE", signal: controller.signal });
        const company = companies.find((item) => String(value(item, "companyId", "COMPANY_ID")) === selectedCompanyId()); await loadEmployees(company);
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init(context) {
            root = context.root; controller = new AbortController();
            query("#partnerTableBody").addEventListener("click", (event) => { const id = event.target.closest("tr[data-company-id]")?.dataset.companyId; const company = companies.find((item) => String(value(item, "companyId", "COMPANY_ID")) === id); if (company) fillCompany(company); }, { signal: controller.signal });
            query("#partnerEmployeeTableBody").addEventListener("click", (event) => { const id = event.target.closest("tr[data-employee-id]")?.dataset.employeeId; const employee = employees.find((item) => String(value(item, "companyEmployeeId", "COMPANY_EMPLOYEE_ID")) === id); if (employee) fillEmployee(employee); }, { signal: controller.signal });
            query("#newPartnerButton").addEventListener("click", clearCompanyForm, { signal: controller.signal }); query("#clearPartnerButton").addEventListener("click", clearCompanyForm, { signal: controller.signal });
            query("#partnerForm").addEventListener("submit", (event) => saveCompany(event).catch((error) => Common.ui.setInlineStatus(query("#partnerEditorStatus"), error.message, "error")), { signal: controller.signal });
            query("#deletePartnerButton").addEventListener("click", () => deleteCompany().catch((error) => Common.ui.setInlineStatus(query("#partnerEditorStatus"), error.message, "error")), { signal: controller.signal });
            query("#newPartnerEmployeeButton").addEventListener("click", clearEmployeeForm, { signal: controller.signal }); query("#clearPartnerEmployeeButton").addEventListener("click", clearEmployeeForm, { signal: controller.signal });
            query("#partnerEmployeeForm").addEventListener("submit", (event) => saveEmployee(event).catch((error) => Common.ui.setInlineStatus(query("#partnerEmployeeStatus"), error.message, "error")), { signal: controller.signal });
            query("#deletePartnerEmployeeButton").addEventListener("click", () => deleteEmployee().catch((error) => Common.ui.setInlineStatus(query("#partnerEmployeeStatus"), error.message, "error")), { signal: controller.signal });
            clearCompanyForm(); await loadCompanies();
        },
        destroy() { controller?.abort(); controller = null; root = null; companies = []; employees = []; }
    };
})();
