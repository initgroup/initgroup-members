(function() {
    "use strict";
    let root, controller, data, drafts, busy = false, sequence = 0;
    let rateDetails = null, rateNavigationPending = false;
    const dirty = new Set();
    const sections = {
        staff: { form: "Staff", label: "직원 목표" },
        "department-extras": { form: "Dept", label: "사업부 추가목표" },
        "company-extra": { form: "Company", label: "회사 추가목표" },
        expenses: { form: "Expense", label: "회사 비용" },
        "historical-totals": { form: "Historical", label: "과거 연간 총액" }
    };
    const query = (selector) => root?.querySelector(selector);
    const el = (tag, text, className) => Common.dom.element(tag, { text, className });
    const labels = { REGULAR: "정규직", EXECUTIVE: "임원", CONTRACT: "계약직", EXTERNAL: "외부인력", INTERN: "인턴", DISPATCH: "파견직", OTHER: "기타", ACTIVE: "재직", LEAVE: "휴직", RETIRED: "퇴직", PLANNED: "계획", BIDDING: "입찰", CONTRACTED: "계약", IN_PROGRESS: "진행", COMPLETED: "완료", CANCELLED: "취소" };
    const amountValue = (value) => /^\d+$/.test(String(value)) ? BigInt(value) : 0n;
    const money = (value) => `${BigInt(value || 0).toLocaleString("ko-KR")}원`;
    const rate = (actual, target) => BigInt(target || 0) ? `${Number(BigInt(actual || 0) * 1000n / BigInt(target)) / 10}%` : "목표 없음";
    const departmentName = (code) => data.departments.find((d) => d.code === code)?.label || "미지정";
    const status = (text, type = "") => Common.ui.setInlineStatus(query("#annualTargetsStatus"), text, type);
    const sectionStatus = (section, text, type = "") => Common.ui.setInlineStatus(query(`#annualTargets${sections[section].form}Status`), text, type);

    function changed(section) {
        dirty.add(section);
        sectionStatus(section, "저장하지 않은 변경사항이 있습니다.");
        status(`저장 대기: ${[...dirty].map((s) => sections[s].label).join(" · ")}. 각 영역에서 저장해 주세요.`);
        updatePreview();
    }

    function moneyField(value, section, callback, disabled = false) {
        const node = el("input", "", "input annual-targets-money-input");
        setupMoney(node, value, section, callback);
        node.disabled = disabled;
        return node;
    }

    function setupMoney(node, value, section, callback) {
        node.type = "text"; node.inputMode = "numeric"; node.maxLength = 31;
        node.pattern = "[0-9,]*"; node.value = BigInt(value || 0).toLocaleString("en-US");
        node.addEventListener("input", () => {
            const raw = node.value.replace(/,/g, "").trim();
            const valid = /^\d{0,24}$/.test(raw);
            node.setCustomValidity(valid ? "" : "0 이상의 24자리 이내 정수로 입력해 주세요.");
            if (valid) callback(raw || "0");
            changed(section);
        }, { signal: controller.signal });
        node.addEventListener("blur", () => {
            if (node.validity.valid) node.value = BigInt(node.value.replace(/,/g, "") || 0).toLocaleString("en-US");
        }, { signal: controller.signal });
    }

    function noteField(value, section, callback, disabled = false) {
        const node = el("input", "", "input"); node.type = "text"; node.maxLength = 1000; node.value = value || ""; node.disabled = disabled;
        node.addEventListener("input", () => { callback(node.value); changed(section); }, { signal: controller.signal });
        return node;
    }

    function row(container, values) {
        const tr = el("tr");
        values.forEach((value) => {
            const td = el("td");
            if (value instanceof Node) td.append(value); else td.textContent = String(value ?? "");
            tr.append(td);
        });
        container.append(tr);
        return tr;
    }

    function workerFacts(worker) {
        return (data.performance.facts || []).filter((fact) => fact.phase === "confirmed"
            && fact.workerKey === worker.key && fact.department === worker.department
            && fact.employmentType === worker.employmentType);
    }

    function referenceValue(value, incomplete) {
        const node = el("span", value);
        if (incomplete) node.append(el("small", "일부 단가 미입력"));
        return node;
    }

    async function editReferenceRate(fact) {
        rateNavigationPending = true;
        try {
            await App.navigate("workforce-management", { context: {
                planYear: data.year, phase: "confirmed", projectId: fact.projectId,
                assignmentId: fact.assignmentId, priceField: "sales", returnPage: "annual-targets"
            } });
        } finally { rateNavigationPending = false; }
    }

    function openWorkerRates(worker) {
        const groups = new Map();
        workerFacts(worker).forEach((fact) => {
            const editable = !data.performance.closed && fact.rateEditable !== false && Boolean(fact.assignmentId);
            const key = JSON.stringify([fact.assignmentId, fact.projectId, fact.salesUnitPrice ?? null, editable]);
            if (!groups.has(key)) groups.set(key, { fact, editable, items: [] });
            groups.get(key).items.push(fact);
        });
        rateDetails.open({
            title: `${worker.name} · ${data.year}년 개인 참고매출 단가`,
            description: "확정 투입 기준 · VAT 별도. 매출단가는 원/M/M입니다. 단가 저장 후 ‘연간 참고 지표로 돌아가기’를 누르면 재계산됩니다. 참고손익에서는 단가 미입력 투입의 원가도 차감합니다.",
            groups: [...groups.values()].map(({ fact, editable, items }) => ({
                title: `${fact.projectName} · 투입 #${fact.assignmentId || "마감 기록"}`,
                reasons: [items.some((item) => item.salesRateProvided === false)
                    ? "매출단가가 미입력되어 이 투입의 참고매출은 계산되지 않았습니다."
                    : "저장한 매출단가와 월별 투입 M/M으로 참고매출을 계산합니다.",
                    ...(!editable ? ["마감 당시 기록입니다. 이 화면에서 단가를 변경하지 않습니다."] : [])],
                facts: [["매출단가 (원/M/M)", fact.salesUnitPrice == null ? "마감 자료 참고" : BigInt(fact.salesUnitPrice || 0) > 0n ? money(fact.salesUnitPrice) : "미입력"],
                    ["선택 연도 투입 M/M", String(Number(items.reduce((sum, item) => sum + Number(item.mm || 0), 0).toFixed(4)))]],
                columns: ["월", "투입 M/M", "참고매출", "인력원가"],
                rows: items.map((item) => [item.month, String(Number(Number(item.mm || 0).toFixed(4))), money(item.salesAmount), money(item.costAmount)]),
                actions: editable ? [{ key: `sales-${fact.assignmentId}`, label: fact.salesRateProvided === false ? "매출단가 입력" : "매출단가 확인·수정", run: () => editReferenceRate(fact) }] : []
            }))
        });
    }

    function renderWorker(worker, container) {
        const facts = workerFacts(worker);
        const hasAssignments = worker.salesReferenceAssignmentCount == null ? facts.length > 0 : worker.salesReferenceAssignmentCount > 0;
        const available = worker.salesReferenceAvailable !== false;
        const incomplete = available && worker.salesReferenceIncomplete === true;
        const action = el("span", data.performance.closed ? "마감 기록" : "확정 투입 없음");
        if (hasAssignments || facts.length) {
            const missing = worker.salesReferenceMissingAssignmentCount || 0;
            const readOnly = data.performance.closed || (facts.length > 0 && facts.every((fact) => fact.rateEditable === false));
            const button = el("button", readOnly ? "마감 단가 보기" : missing ? `단가 입력 (${missing}건)` : "단가 확인·수정", "button button-secondary button-small");
            button.type = "button";
            button.setAttribute("aria-haspopup", "dialog");
            button.setAttribute("aria-label", `${worker.name} · ${data.year}년 매출단가 확인 및 입력`);
            button.addEventListener("click", () => openWorkerRates(worker), { signal: controller.signal });
            action.replaceChildren(button);
        }
        row(container, [worker.name, worker.departmentName || departmentName(worker.department), labels[worker.employmentType] || worker.employmentType,
            money(worker.targetAmount), available ? referenceValue(money(worker.salesAmount), incomplete) : "단가 입력 필요",
            available ? referenceValue(rate(worker.salesAmount, worker.targetAmount), incomplete) : "계산 대기",
            money(worker.costAmount), available ? referenceValue(money(BigInt(worker.salesAmount) - BigInt(worker.costAmount)), incomplete) : "계산 대기", action]);
    }

    function renderReports() {
        const summary = data.performance.summary;
        const historical=data.performance.revenueBasis==="HISTORICAL_TOTALS";
        query("#annualTargetsIntroduction").textContent=historical?"과거 결산자료의 회사 연간 총액을 비교합니다. 목표·순이익은 확인한 금액만 입력하세요.":"직원별 연간 목표를 입력하면 사업부·회사 목표가 자동 합산됩니다. 필요한 추가목표만 별도로 더하세요.";
        query("#annualTargetsReportDescription").textContent=historical?"입력한 과거 결산 총액 기준입니다. 상세 원가·사업부·인력 내역은 제공하지 않습니다.":"저장된 연간 목표·비용과 프로젝트 매출을 비교합니다.";
        query("#annualTargetsCompanyResultDescription").textContent=historical?"과거 결산 총액 · 순이익은 직접 입력한 값이며 상세 원가를 역산하지 않습니다.":"연간 관리 순이익 = 연간 매출 − 연간 인력원가 − 회사 연간 기타비용";
        root.querySelectorAll("[data-annual-targets-jump]").forEach(button=>{if(["annualTargetsStaffForm","annualTargetsDeptForm","annualTargetsCompanyForm","annualTargetsExpenseForm"].includes(button.dataset.annualTargetsJump)) button.hidden=historical;});
        const kpis = query("#annualTargetsKpis"); kpis.replaceChildren();
        [["회사 연간 목표 (저장 기준)", data.performance.targetRecorded===false?"미설정":money(summary.targetAmount)], ["연간 매출", money(summary.salesAmount)], ["목표 달성률", rate(summary.salesAmount, summary.targetAmount)], ["연간 관리 순이익", summary.netProfit==null?"미입력":money(summary.netProfit)]].forEach(([title, value]) => {
            const card = el("article"); card.append(el("span", title), el("strong", value)); kpis.append(card);
        });
        const breakdown = data.performance.targetBreakdown || {};
        query("#annualTargetsSavedBreakdown").textContent = historical ? "과거 총액 소급 · 회사 연간 합계만 보존하며 사업부·인력·프로젝트 내역이나 원가를 임의 생성하지 않습니다." : `저장 기준: 직원 목표 ${money(breakdown.staffAmount)} + 사업부 추가 ${money(breakdown.departmentExtra)} + 회사 추가 ${money(breakdown.companyExtra)}`;
        query("#annualTargetsDepartments").closest("section").hidden=historical;
        query("#annualTargetsProjectResults").closest("section").hidden=historical;
        const deptBody = query("#annualTargetsDepartments"); deptBody.replaceChildren();
        data.performance.departments.forEach((d) => row(deptBody, [d.name, money(d.staffTargetAmount), money(d.extraTargetAmount), money(d.targetAmount), money(d.staffSalesAmount), money(d.contractSalesAmount), money(d.unattributedSalesAmount || 0), money(d.salesAmount), rate(d.salesAmount, d.targetAmount), money(d.costAmount), money(BigInt(d.salesAmount) - BigInt(d.costAmount))]));
        const workerBody = query("#annualTargetsWorkers"); workerBody.replaceChildren();
        data.performance.workers.forEach((worker) => renderWorker(worker, workerBody));
        const body = query("#annualTargetsYearResult"); body.replaceChildren();
        row(body, [data.year, data.performance.targetRecorded===false?"미설정":money(summary.targetAmount), money(summary.salesAmount), rate(summary.salesAmount, summary.targetAmount), historical?"상세 없음":money(summary.costAmount), historical?"상세 없음":money(summary.otherCost), summary.netProfit==null?"미입력":money(summary.netProfit), historical?"과거 총액 소급":data.performance.revenueBasis === "PROJECT_YEAR" ? "프로젝트 연도별 매출" : "마감 당시 기준"]);
        query("#annualTargetsCloseYear").disabled = data.performance.closed || data.year >= new Date().getFullYear() || !data.saved;
        query("#annualTargetsCloseYear").textContent = data.performance.closed ? "연도 마감 완료" : "연도 마감";
        query("#annualTargetsYearCloseStatus").textContent = data.performance.closed ? "마감 당시 연간 목표·비용·실적을 보존합니다." : historical?"과거 결산 총액과 근거를 확인한 뒤 연도 마감하면 당시 금액을 보존합니다.":"종료된 연도는 이력·투입·목표·비용을 확인한 뒤 마감할 수 있습니다.";
        renderProjects();
    }

    function renderProjects() {
        const body = query("#annualTargetsProjects"); body.replaceChildren();
        const results = new Map(data.performance.projects.map((p) => [p.projectId, p]));
        const projects = [...data.projects];
        const registered = new Set(projects.map((p) => p.projectId));
        results.forEach((result, id) => {
            if (id && !registered.has(id)) projects.push({ projectId: id, name: result.name, status: result.status, archived: true });
        });
        projects.forEach((project) => {
            const result = results.get(project.projectId) || {};
            const name = el("div"); name.append(el("strong", project.name), el("small", labels[project.status] || project.status));
            const link = el("button", "사업·입찰 관리에서 보기", "button button-secondary button-small");
            link.type = "button";
            link.disabled = Boolean(project.archived);
            if (project.archived) link.textContent = "마감 기록 보존";
            link.addEventListener("click", () => App.navigate("admin-projects", { context: { projectId: project.projectId,planYear:data.year,view:"revenue" } }), { signal: controller.signal });
            const phase = project.archived ? "마감 보존" : ["CONTRACTED", "IN_PROGRESS", "COMPLETED"].includes(project.status) ? "확정" : project.status === "CANCELLED" ? "제외" : "계획";
            row(body, [name, project.archived ? "—" : money(project.orderAmount), project.archived ? "—" : money(project.contractAmount), phase, money(result.salesAmount), money(BigInt(result.salesAmount || 0) - BigInt(result.costAmount || 0)), link]);
        });
        if (!body.children.length) row(body, ["선택 연도에 수행하는 프로젝트가 없습니다."]);
    }

    function prepareDraft(section) {
        const revision = data.revisions[section];
        if (section === "historical-totals") {
            const h=data.historicalTotals || {};
            drafts[section]={revision:h.revision || 0,targetAmount:h.targetAmount ?? null,salesAmount:h.salesAmount ?? null,netProfit:h.netProfit ?? null,note:h.note || ""};
        } else if (section === "staff") {
            const people = new Map(data.staffRoster.map((p) => [p.userId, { ...p, amount: "0" }]));
            data.staffTargets.forEach((p) => people.set(p.userId, { ...p }));
            drafts[section] = { revision, staff: [...people.values()] };
        } else if (section === "department-extras") {
            const items = new Map(data.departments.map((d) => [d.code, { department: d.code, amount: "0", note: "" }]));
            data.departmentExtras.forEach((d) => items.set(d.department, { department: d.department, amount: d.amount, note: d.note }));
            drafts[section] = { revision, extras: [...items.values()] };
        } else if (section === "company-extra") drafts[section] = { revision, ...data.companyExtra };
        else drafts[section] = { revision, ...data.annualExpense };
    }

    function updatePreview() {
        if (!drafts) return;
        const staff = drafts.staff.staff.reduce((n, r) => n + amountValue(r.amount), 0n);
        const extras = drafts["department-extras"].extras.reduce((n, r) => n + amountValue(r.amount), 0n);
        const company = amountValue(drafts["company-extra"].amount);
        query("#annualTargetsStaffTotal").textContent = `직원 연간 목표 합계 ${money(staff)}`;
        query("#annualTargetsCompanyBase").textContent = money(staff + extras);
        query("#annualTargetsCompanyGoal").textContent = money(staff + extras + company);
        query("#annualTargetsExpenseProfit").textContent = data.performance.revenueBasis==="HISTORICAL_TOTALS" ? "과거 총액 기준 · 상세 비용 없음" : money(BigInt(data.performance.summary.salesAmount) - BigInt(data.performance.summary.costAmount) - amountValue(drafts.expenses.amount));
        root.querySelectorAll("[data-annual-department-base]").forEach((node) => {
            const code = node.dataset.annualDepartmentBase;
            const base = drafts.staff.staff.filter((p) => p.department === code).reduce((n, r) => n + amountValue(r.amount), 0n);
            const extra = drafts["department-extras"].extras.find((d) => d.department === code)?.amount || "0";
            node.textContent = money(base);
            node.closest("tr").querySelector("[data-annual-department-total]").textContent = money(base + amountValue(extra));
        });
    }

    function renderStaff() {
        const body = query("#annualTargetsEditor"); body.replaceChildren();
        const department = query("#annualTargetsStaffDepartment").value;
        const search = query("#annualTargetsStaffSearch").value.trim().toLocaleLowerCase();
        drafts.staff.staff.filter((p) => (department === "all" || p.department === department) && p.name.toLocaleLowerCase().includes(search)).forEach((person) => {
            const field = moneyField(person.amount, "staff", (value) => person.amount = value);
            field.setAttribute("aria-label", `${person.name} 연간 목표금액`); field.dataset.userId = person.userId;
            row(body, [person.name, person.departmentName || departmentName(person.department), labels[person.employmentType] || person.employmentType, field]);
        });
        if (!body.children.length) row(body, ["해당하는 직원이 없습니다. 소속·고용 이력은 임직원 상세에서 관리합니다."]);
        updatePreview();
    }

    function renderEditors() {
        const filter = query("#annualTargetsStaffDepartment"), previous = filter.value;
        filter.replaceChildren(el("option", "전체 사업부")); filter.firstChild.value = "all";
        const departments = new Map(data.departments.map((d) => [d.code, d.label]));
        drafts.staff.staff.forEach((p) => departments.set(p.department, p.departmentName || departmentName(p.department)));
        departments.forEach((name, code) => { const option = el("option", name); option.value = code; filter.append(option); });
        filter.value = departments.has(previous) ? previous : "all";
        renderStaff();
        const budgets = query("#annualTargetsBudgetEditor"); budgets.replaceChildren();
        drafts["department-extras"].extras.forEach((extra) => {
            const base = el("span"); base.dataset.annualDepartmentBase = extra.department;
            const total = el("strong"); total.dataset.annualDepartmentTotal = "";
            const amount = moneyField(extra.amount, "department-extras", (v) => extra.amount = v);
            amount.setAttribute("aria-label", `${departmentName(extra.department)} 연간 추가목표`);
            row(budgets, [departmentName(extra.department), base, amount, total, noteField(extra.note, "department-extras", (v) => extra.note = v)]);
        });
        // Replacing the two static company inputs clears their previous listeners.
        ["Amount", "Note"].forEach((suffix) => { const node = query(`#annualTargetsCompany${suffix}`); node.replaceWith(node.cloneNode(false)); });
        setupMoney(query("#annualTargetsCompanyAmount"), drafts["company-extra"].amount, "company-extra", (v) => drafts["company-extra"].amount = v);
        const note = query("#annualTargetsCompanyNote"); note.value = drafts["company-extra"].note;
        note.addEventListener("input", () => { drafts["company-extra"].note = note.value; changed("company-extra"); }, { signal: controller.signal });
        ["Amount", "Note"].forEach((suffix) => { const node = query(`#annualTargetsExpense${suffix}`); node.replaceWith(node.cloneNode(false)); });
        setupMoney(query("#annualTargetsExpenseAmount"), drafts.expenses.amount, "expenses", (v) => drafts.expenses.amount = v);
        const expenseNote = query("#annualTargetsExpenseNote"); expenseNote.value = drafts.expenses.note;
        expenseNote.addEventListener("input", () => { drafts.expenses.note = expenseNote.value; changed("expenses"); }, { signal: controller.signal });
        Object.keys(sections).forEach((section) => {
            const form = query(`#annualTargets${sections[section].form}Form`);
            form.querySelectorAll("input:not([type=search]), button[type=submit]").forEach((node) => { node.disabled = Boolean(data.performance.closed) || (section!=="historical-totals" && data.performance.revenueBasis==="HISTORICAL_TOTALS"); });
            if(section!=="historical-totals") form.hidden=data.performance.revenueBasis==="HISTORICAL_TOTALS";
        });
        Object.keys(sections).forEach((section) => sectionStatus(section, dirty.has(section) ? "저장하지 않은 변경사항이 있습니다." : ""));
        renderHistorical();
        updatePreview();
    }

    function renderHistorical() {
        const h=data.historicalTotals || {},draft=drafts["historical-totals"],closed=data.performance.closed;
        const past=data.year<new Date().getFullYear();
        query("#annualTargetsHistoricalForm").hidden=!past;
        query("#annualTargetsHistoricalJump").hidden=!past;
        [["Target","targetAmount",false],["Sales","salesAmount",false],["Profit","netProfit",true],["Note","note",null]].forEach(([suffix,key,signed])=>{
            const old=query(`#annualTargetsHistorical${suffix}`);old.replaceWith(old.cloneNode(false));
            const node=query(`#annualTargetsHistorical${suffix}`),targetLocked=key==="targetAmount" && h.targetEditable===false;
            node.value=targetLocked?money(data.performance.summary.targetAmount).replace(/원$/,""):draft[key]==null?"":signed===null?draft[key]:BigInt(draft[key]).toLocaleString("en-US");
            node.disabled=!h.available || closed || targetLocked;
            node.title=targetLocked?"이미 등록한 직원·사업부·회사 목표 합계를 유지합니다.":"";
            if(signed!==null) {node.maxLength=32;node.pattern=signed?"-?[0-9,]*":"[0-9,]*";}
            node.addEventListener("input",()=>{
                if(signed===null) draft[key]=node.value;
                else {
                    const raw=node.value.replace(/,/g,"").trim(),valid=raw==="" || (signed?/^-?\d{1,24}$/:/^\d{1,24}$/).test(raw);
                    node.setCustomValidity(valid?"":"24자리 이내 원 단위 정수로 입력하세요. 손실은 순이익에 음수로 입력할 수 있습니다.");
                    if(valid) draft[key]=raw===""?null:raw;
                }
                changed("historical-totals");
            },{signal:controller.signal});
            if(signed!==null) node.addEventListener("blur",()=>{if(node.validity.valid && node.value.trim()) node.value=BigInt(node.value.replace(/,/g,"")).toLocaleString("en-US");},{signal:controller.signal});
        });
        query("#annualTargetsHistoricalSave").disabled=!h.available || closed;
        const disable=query("#annualTargetsHistoricalDisable");disable.hidden=!h.saved;disable.disabled=closed || !past;
        if(!dirty.has("historical-totals")) sectionStatus("historical-totals",h.reason || `${h.saved?"과거 회사 총액을 적용 중입니다. 상세 자료를 입력하려면 먼저 총액 적용을 해제하세요.":"과거 연도의 회사 매출 합계를 입력하세요. 빈 목표·순이익은 미입력으로 유지합니다."}${h.targetEditable===false?" 기존 직원·사업부·회사 목표 합계는 유지합니다.":""}`);
    }

    function render() {
        const notice = query("#annualTargetsWarnings"); notice.textContent = data.performance.warnings.join(" "); notice.hidden = !notice.textContent;
        renderEditors(); renderReports();
    }

    async function request(path, options = {}) {
        return Common.data.get(await Common.api.request(`/planning/annual-targets/${data.year}${path}`, { ...options, signal: controller.signal }));
    }

    async function run(callback, section = null) {
        if (busy) return;
        busy = true; root.inert = true; root.setAttribute("aria-busy", "true");
        try { await callback(); }
        catch (error) {
            if (error.name !== "AbortError") {
                if (section) sectionStatus(section, error.message || "저장하지 못했습니다.", "error");
                status(error.message || "처리하지 못했습니다.", "error");
            }
        } finally { busy = false; if (root) { root.inert = false; root.setAttribute("aria-busy", "false"); } }
    }

    async function load() {
        if (busy) return;
        rateDetails?.close();
        if (dirty.size && !(await Common.ui.confirm("저장하지 않은 변경을 버리고 조회할까요?"))) { query("#annualTargetsYear").value = data.year; return; }
        const id = ++sequence;
        await run(async () => {
            const year = query("#annualTargetsYear").value;
            const result = Common.data.get(await Common.api.request(`/planning/annual-targets/${encodeURIComponent(year)}`, { signal: controller.signal }));
            if (!root || id !== sequence) return;
            data = result; drafts = {}; dirty.clear(); Object.keys(sections).forEach(prepareDraft); render();
            status(data.saved ? "저장된 목표와 실적을 조회했습니다." : "직원 연간 목표부터 입력하세요. 사업부·회사 추가목표는 선택 사항입니다.");
        });
    }

    async function save(section, event) {
        event.preventDefault();
        if (!data || busy) return;
        if (String(data.year) !== query("#annualTargetsYear").value) { sectionStatus(section, "변경한 기준연도를 먼저 조회해 주세요.", "error"); return; }
        if (!query(`#annualTargets${sections[section].form}Form`).reportValidity()) return;
        await run(async () => {
            const draft = drafts[section];
            const body = section === "staff" ? { revision: draft.revision, staff: draft.staff.map(({ userId, amount }) => ({ userId, amount })) } : draft;
            const result = await request(`/${section}`, { method: "PUT", body });
            data = result; dirty.delete(section);
            Object.keys(sections).forEach((key) => { if (!dirty.has(key)) prepareDraft(key); });
            render(); sectionStatus(section, `${sections[section].label}를 저장했습니다.`, "success");
            status(dirty.size ? `저장 대기: ${[...dirty].map((key) => sections[key].label).join(" · ")}` : "저장한 목표·비용을 실적 비교와 메인 현황에 반영했습니다.", "success");
        }, section);
    }

    async function closeYear() {
        if (dirty.size) { status("각 영역의 변경사항을 먼저 저장한 뒤 마감해 주세요.", "error"); return; }
        if (!(await Common.ui.confirm(data.performance.revenueBasis==="HISTORICAL_TOTALS"?`${data.year}년 과거 총액과 근거를 확인했나요? 마감하면 당시 총액을 보존합니다.`:`${data.year}년의 이력·투입·연간 목표·연간 비용을 확인했나요? 마감하면 당시 연간 기록을 보존합니다.`))) return;
        await run(async () => {
            data = await request("/close", { method: "POST", body: { revision: data.revision, reviewedHistory: true } });
            Object.keys(sections).forEach(prepareDraft); render(); status(`${data.year}년 기록을 마감했습니다.`, "success");
        });
    }

    async function disableHistorical() {
        if(!data || busy) return;
        if(!(await Common.ui.confirm("과거 총액 적용을 해제할까요? 프로젝트·목표·비용 자료는 유지하며, 이후 상세 자료를 입력할 수 있습니다."))) return;
        await run(async()=>{
            data=await request("/historical-totals",{method:"DELETE",body:{revision:drafts["historical-totals"].revision}});
            dirty.delete("historical-totals");Object.keys(sections).forEach(key=>{if(!dirty.has(key)) prepareDraft(key);});render();
            sectionStatus("historical-totals","과거 총액 적용을 해제했습니다.","success");
        },"historical-totals");
    }

    function revealRouteView(route = {}) {
        route = route || {};
        if(data?.performance.revenueBasis==="HISTORICAL_TOTALS" && ["staff","department-extra","company-extra","projects"].includes(route.view)) route={...route,view:"historical"};
        const views={historical:"annualTargetsHistoricalForm",staff:"annualTargetsStaffForm","department-extra":"annualTargetsDeptForm","company-extra":"annualTargetsCompanyForm",reports:"annualTargetsReports",company:"annualTargetsCompanyResults",projects:"annualTargetsProjectResults"};
        if (views[route.view]) Common.ui.revealEditor(query(`#${views[route.view]}`));
        if(route.view==="historical") query("#annualTargetsHistoricalForm input:not(:disabled)")?.focus({preventScroll:true});
        if (route.view === "workers") {
            const details = query("#annualTargetsWorkerReferences");
            details.open = true;
            Common.ui.revealEditor(details);
        }
    }

    window.Pages = window.Pages || {};
    window.Pages["annual-targets"] = {
        async init(context) {
            root = context.root; controller = new AbortController(); data = null; drafts = null; dirty.clear(); busy = false;
            rateNavigationPending = false;
            rateDetails = Common.ui.createDetailDialog({ root, prefix: "annualTargetsRates", signal: controller.signal });
            query("#annualTargetsYear").value = context.routeContext?.planYear || new Date().getFullYear();
            query("#annualTargetsRefresh").addEventListener("click", load, { signal: controller.signal });
            Object.keys(sections).forEach((section) => query(`#annualTargets${sections[section].form}Form`).addEventListener("submit", (event) => save(section, event), { signal: controller.signal }));
            root.querySelectorAll("[data-annual-targets-jump]").forEach((button) => button.addEventListener("click", () => Common.ui.revealEditor(query(`#${button.dataset.annualTargetsJump}`)), { signal: controller.signal }));
            query("#annualTargetsCloseYear").addEventListener("click", closeYear, { signal: controller.signal });
            query("#annualTargetsHistoricalDisable").addEventListener("click",disableHistorical,{signal:controller.signal});
            query("#annualTargetsStaffDepartment").addEventListener("change", renderStaff, { signal: controller.signal });
            query("#annualTargetsStaffSearch").addEventListener("input", renderStaff, { signal: controller.signal });
            await load();
            revealRouteView(context.routeContext);
        },
        async activate(context = {}) {
            if (!root || busy) return;
            const year=Number(context.routeContext?.planYear);
            if (Number.isInteger(year) && year>=1900 && year<=2100 && (!dirty.size || year!==Number(data?.year))) {
                query("#annualTargetsYear").value=String(year);
                await load();
            } else if (!dirty.size) await load();
            else await run(async () => {
                const id = ++sequence;
                const fresh = Common.data.get(await Common.api.request(`/planning/annual-targets/${data.year}`, { signal: controller.signal }));
                if (!root || id !== sequence) return;
                // Keep every editing draft and its original revision; only refresh reports.
                data = { ...data, performance: fresh.performance, projects: fresh.projects };
                renderReports(); updatePreview();
                status("미저장 목표·비용과 원래 버전을 유지하고 참고 지표를 갱신했습니다.");
            });
            if (!year || year===Number(data?.year)) revealRouteView(context.routeContext);
        },
        hasUnsavedChanges() { return dirty.size > 0; },
        async beforeLeave(context = {}) {
            if (busy) return false;
            if (rateNavigationPending && context.nextPageCode === "workforce-management" && context.preservesState) { rateDetails?.close(); return true; }
            const allowed = !dirty.size || await Common.ui.confirm("저장하지 않은 변경을 버리고 이동할까요?");
            if (allowed) rateDetails?.close();
            return allowed;
        },
        deactivate() { rateDetails?.close(); },
        destroy() { sequence++; rateDetails?.destroy(); rateDetails = null; controller?.abort(); controller = null; root = null; data = null; drafts = null; dirty.clear(); }
    };
})();
