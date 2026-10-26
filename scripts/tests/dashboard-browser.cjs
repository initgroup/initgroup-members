// Optional browser regression check: node scripts/tests/dashboard-browser.cjs [path-to-Chrome-or-Edge]
// Uses an isolated browser profile and synthetic API responses; no production data is read or written.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../..");
const output = path.join(root, "test-results/dashboard-review");
const browserPath = process.argv[2] || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const departments = JSON.parse(fs.readFileSync(path.join(root, "frontend/config/departments.json"), "utf8")).departments;
const projects = [1, 2].map((id) => ({ projectId: id, projectName: id === 1 ? "2026년 경영정보시스템 구축 및 유지관리 프로젝트" : "데이터 분석 플랫폼 고도화", customerName: "검증용 발주처", projectYear: 2026, projectStartDate: "2026-01-01", projectEndDate: "2026-12-31", statusCode: id === 1 ? "IN_PROGRESS" : "BIDDING", orderAmountVat: "3000000000", contractAmountVat: "900000000", participationRate: 30, participationTypeCode: "CONSORTIUM" }));
const workers = Array.from({ length: 14 }, (_, i) => ({ workerKey: `USER:${i + 1}`, userId: i + 1, employeeName: `검증인력 ${i + 1}`, companyName: "검증회사", workerTypeCode: "INTERNAL", employmentTypeCode: "REGULAR", departmentCode: departments[i % 3].code, departmentName: departments[i % 3].label, technicalGradeCode: "ADVANCED", positionName: "책임", availableStartDate: "2026-01-01" }));
const assignments = Array.from({ length: 14 }, (_, i) => ({ assignmentId: i + 1, projectId: i < 12 ? 1 : 2, ...workers[i], employeeUserId: i + 1, assignmentStartDate: "2026-01-01", assignmentEndDate: "2026-12-31", totalMm: 12, assignmentStatusCode: i === 10 ? "PLANNED" : "CONFIRMED", monthlyAllocations: Array.from({ length: 12 }, (_, m) => ({ month: `2026-${String(m + 1).padStart(2, "0")}`, mm: 1 })) }));
assignments.push({ ...assignments[0], assignmentId: 20, totalMm: 1, monthlyAllocations: [{ month: "2026-01", mm: 1 }] });
const bootstrap = { establishmentYear: 2020, departments, confirmed: { projects, assignments, companies: [] }, references: { workers, actualCapacity: [] }, scenarios: [], scenario: { scenarioId: 1, projects: [{ ...projects[0], scenarioProjectId: 1, plannedStartDate: "2026-01-01", plannedEndDate: "2026-12-31", assignments: [] }] } };
function monthlyRevenueFixture(year,annualTarget,amounts) {
    let cumulative=0n,targetCumulative=0n;
    const goal=BigInt(annualTarget||0),q=goal/12n,r=goal%12n;
    return Array.from({length:12},(_,i)=>{
        const value=BigInt(amounts[i]||0),target=q+(BigInt(i)<r?1n:0n);cumulative+=value;targetCumulative+=target;
        return {month:`${year}-${String(i+1).padStart(2,"0")}`,salesAmount:String(value),cumulativeSalesAmount:String(cumulative),
            targetReference:annualTarget==null?null:String(target),cumulativeTargetReference:annualTarget==null?null:String(targetCumulative)};
    });
}
const riskFixture={type:"OVER_CAPACITY",employeeName:"검증인력 1",workerKey:"USER:1",month:"2026-01",totalMm:2,capacityMm:1,overloadMm:1,projectCount:1,
    reasons:["전체 프로젝트 투입 2 M/M이 월 가용 1 M/M을 1 M/M 초과했습니다.","동일 프로젝트의 여러 투입 행도 각각 합산했습니다."],
    allocations:[1,20].map(id=>({assignmentId:id,projectId:1,projectName:projects[0].projectName,phase:"confirmed",startDate:"2026-01-01",endDate:"2026-12-31",mm:1})),
    message:"검증인력 1님의 2026-01 총 투입량이 2 M/M입니다."};
const home = { planYear: 2026, generatedAt: new Date().toISOString(), workforce: { internalCount: 14, partnerCount: 0 }, projectSummary: { projectCount: 2, awardedCount: 2, orderAmountVat: "6000000000", contractAmountVat: "1800000000" }, scenario: { scenarioId: 1, scenarioName: "2026 기준 계획", projects: [], summary: {}, warnings: [riskFixture] }, notices: [], decisionProjects: [{...projects[0],statusCode:"BIDDING"}], schemaWarnings: [] };
home.financials={
    confirmed:{summary:{targetAmount:"144000000",assignmentCount:1,totalSalesAmount:"120000000",laborCostAmount:"72000000",totalCostAmount:"84000000",otherCost:"12000000",operatingProfit:"36000000"},
        monthlySales:monthlyRevenueFixture(2026,"144000000",[12000000,24000000,36000000,24000000,12000000,12000000])},
    planning:{summary:{assignmentCount:1,totalSalesAmount:"500",totalCostAmount:"400",operatingProfit:"100"},monthlySales:monthlyRevenueFixture(2026,null,[500])},warnings:home.scenario.warnings
};
home.annualPerformance={revenueBasis:"PROJECT_YEAR",projects:[{projectId:1,name:projects[0].projectName,status:"CONTRACTED",salesAmount:"120000000"}],missingRevenue:[],targetSaved:true,summary:{targetAmount:"144000000",salesAmount:"120000000"},targetBreakdown:{staffAmount:"120000000",departmentExtra:"12000000",companyExtra:"12000000"}};
home.annualTrend=[2024,2025,2026].map((year,index)=>({year,closed:index===0,revenueBasis:"PROJECT_YEAR",targetRecorded:true,revenueRecorded:true,missingRevenueCount:0,targetAmount:"144000000",salesAmount:String(100000000+index*10000000),netProfit:index===1?"-20000000":"32000000"}));
const annualTotals={targetAmount:"120000000",salesAmount:"144000000",costAmount:"84000000",otherCost:"12000000",netProfit:"48000000",staffSalesAmount:"120000000",contractSalesAmount:"24000000",plannedSalesAmount:"36000000"};
const annual={year:2025,revision:1,saved:true,departments,revisions:{staff:0,"department-extras":0,"company-extra":0,expenses:0},
    staffRoster:[{userId:1,name:"검증 직원",department:departments[0].code,departmentName:departments[0].label,employmentType:"REGULAR",amount:"0"}],
    staffTargets:[{userId:1,name:"검증 직원",department:departments[0].code,departmentName:departments[0].label,employmentType:"REGULAR",amount:"120000000"}],
    departmentExtras:[],companyExtra:{amount:"0",note:""},annualExpense:{amount:"12000000",note:"연간 회사 비용"},
    projects:[{projectId:1,name:projects[0].projectName,status:"CONTRACTED",contractAmount:"180000000",orderAmount:"300000000",department:departments[0].code}],
    performance:{summary:annualTotals,closed:false,year:2025,targetBreakdown:{staffAmount:"120000000",departmentExtra:"0",companyExtra:"0"},warnings:[],
        departments:[{key:departments[0].code,name:departments[0].label,...annualTotals,staffTargetAmount:"120000000",extraTargetAmount:"0"}],
        workers:[{key:"USER:1",name:"검증 직원",department:departments[0].code,employmentType:"REGULAR",...annualTotals}],
        projects:[{projectId:1,name:projects[0].projectName,salesAmount:"144000000",costAmount:"84000000",laborMargin:"60000000"}],facts:[]}
};
const userFixture = {userId:1, userName:"검증 직원", loginId:"test", email:"test@example.com", roleCode:"USER", useYn:"Y", employmentTypeCode:"REGULAR", employmentStatusCode:"ACTIVE", departmentCode:departments[0].code, departmentName:departments[0].label};
const historyFixture = [{user_id:1,user_name:"검증 직원",effective_from:"2026-01-01",department_code:departments[0].code,department_name:departments[0].label,employment_type_code:"REGULAR",employment_status_code:"ACTIVE",hire_date:"2026-01-01",retirement_date:null,source_code:"VERIFIED",version_token:"v1"}];
function fixture(page, menuEntry = false) {
    const markup = fs.readFileSync(path.join(root, "frontend/pages", `${page}.html`), "utf8");
    return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/frontend/css/style.css"><style>body{padding:24px;background:#f4f7fb}#fixture-root{max-width:1800px;margin:auto}</style><body><main id="fixture-root">${markup}</main><script src="/frontend/js/common.js"></script><script src="/frontend/js/data-grid.js"></script><script>
    let employeeHistory = ${JSON.stringify(historyFixture)};
    window.Pages={};window.App={getUser:()=>({userName:'검증 관리자'}),isAdmin:()=>true,navigate:(page,options)=>{window.navigation={page,options}}};
    window.apiCalls=[];window.apiFailures=false;window.confirmResult=true;
    window.annualFixture=${JSON.stringify(annual)};
    Common.ui.confirm=async()=>window.confirmResult;
    Common.api.request=async(url,options={})=>{
        window.apiCalls.push({url,method:options.method||'GET',body:options.body});
        if(window.apiFailures) throw new Error('검증용 조회 실패');
        if(url.startsWith('/planning/annual-targets/')) {
            const section=url.split('/').pop();
            if(section==='historical-totals') {
                const h=annualFixture.historicalTotals;
                if(options.body.revision!==h.revision) throw new Error('다른 사용자가 과거 총액을 수정했습니다.');
                if(options.method==='PUT') {
                    window.normalAnnualPerformance=window.normalAnnualPerformance || structuredClone(annualFixture.performance);
                    Object.assign(h,options.body,{revision:h.revision+1,saved:true});
                    Object.assign(annualFixture.performance,{revenueBasis:'HISTORICAL_TOTALS',costBreakdownAvailable:false,targetRecorded:options.body.targetAmount!=null,profitRecorded:options.body.netProfit!=null,
                        targetBreakdown:null,departments:[],workers:[],projects:[],facts:[],summary:{...annualFixture.performance.summary,targetAmount:options.body.targetAmount||'0',salesAmount:options.body.salesAmount,netProfit:options.body.netProfit,costAmount:'0',otherCost:'0'}});
                } else {
                    Object.assign(h,{revision:h.revision+1,saved:false,targetAmount:null,salesAmount:null,netProfit:null,note:''});
                    annualFixture.performance=structuredClone(normalAnnualPerformance);
                }
                annualFixture.revision++;return {data:structuredClone(annualFixture)};
            }
            if(url.endsWith('/close')) {
                annualFixture.performance.closed=true;annualFixture.revision++;
                Object.keys(annualFixture.revisions).forEach(key=>annualFixture.revisions[key]++);
            }
            if(options.method==='PUT') {
                if(options.body.revision!==annualFixture.revisions[section]) throw new Error('이 영역은 다른 사용자가 변경했습니다.');
                if(section==='staff') annualFixture.staffTargets=options.body.staff.map(p=>({...annualFixture.staffRoster.find(r=>r.userId===p.userId),amount:p.amount}));
                if(section==='department-extras') annualFixture.departmentExtras=options.body.extras;
                if(section==='company-extra') annualFixture.companyExtra={amount:options.body.amount,note:options.body.note};
                if(section==='expenses') annualFixture.annualExpense={amount:options.body.amount,note:options.body.note};
                annualFixture.revisions[section]++;annualFixture.revision++;
                const staff=annualFixture.staffTargets.reduce((s,r)=>s+BigInt(r.amount),0n);
                const extra=annualFixture.departmentExtras.reduce((s,r)=>s+BigInt(r.amount),0n);
                const company=BigInt(annualFixture.companyExtra.amount);
                annualFixture.performance.targetBreakdown={staffAmount:String(staff),departmentExtra:String(extra),companyExtra:String(company)};
                annualFixture.performance.summary.targetAmount=String(staff+extra+company);
                annualFixture.performance.summary.otherCost=annualFixture.annualExpense.amount;
                annualFixture.performance.summary.netProfit=String(BigInt(annualFixture.performance.summary.salesAmount)-BigInt(annualFixture.performance.summary.costAmount)-BigInt(annualFixture.annualExpense.amount));
            }
            return {data:structuredClone(annualFixture)};
        }
        if(url.startsWith('/admin/users/1/history')) {
            if(options.method==='POST') employeeHistory.push({ ...employeeHistory[0], effective_from:options.body.effectiveFrom, department_code:options.body.department, version_token:'v2' });
            if(options.method==='PUT') { const event=employeeHistory.find(e=>url.endsWith(e.effective_from));event.department_code=options.body.department;event.version_token='v3'; }
            if(options.method==='DELETE') employeeHistory=employeeHistory.filter(e=>!url.includes('/'+e.effective_from+'?'));
            return {data:{items:structuredClone(employeeHistory),lastClosedMonth:null}};
        }
        if(url.startsWith('/admin/users')) return {data:{users:[${JSON.stringify(userFixture)}],total:1,page:1,totalPages:1}};
        if(url.startsWith('/workforce-management/bootstrap')) return {data:window.boardFixture||${JSON.stringify(bootstrap)}};
        if(url.startsWith('/home/dashboard')) return {data:window.homeFixture||${JSON.stringify(home)}};
        if(url==='/project-assignments/references') return {data:{companies:[]}};
        if(url.startsWith('/project-assignments')) return {data:{companies:[],assignments:[]}};
        if(url.startsWith('/admin/projects/') && url.includes('/revenue')) {
            window.revenueFixture=window.revenueFixture || {projectId:1,contractAmountVat:'1800000000',totalAmount:'0',years:[2026,2027,2028].map((year,i)=>({year,ordinal:i+1,revision:0,saved:false,closed:false,note:'',totalAmount:'0'}))};
            if(options.method==='PUT') {
                const year=Number(url.split('/').pop()),item=revenueFixture.years.find(y=>y.year===year);
                if(item.revision!==options.body.revision) throw new Error('다른 사용자가 이 연도 매출을 수정했습니다.');
                Object.assign(item,{revision:item.revision+1,saved:true,totalAmount:options.body.amount,note:options.body.note});
                revenueFixture.totalAmount=String(revenueFixture.years.reduce((sum,y)=>sum+BigInt(y.totalAmount),0n));
            }
            return {data:JSON.parse(JSON.stringify(revenueFixture))};
        }
        if(url.startsWith('/admin/projects/') && Number.isInteger(Number(url.split('/').pop()))) return {data:{...${JSON.stringify(projects[0])},...options.body}};
        if(url.startsWith('/admin/projects')) {
            const status=new URL(url,'http://localhost').searchParams.get('statusCode') || 'ALL';
            const allowed=status==='PRE_CONTRACT'?['PLANNED','BIDDING']:status==='POST_CONTRACT'?['CONTRACTED','IN_PROGRESS','COMPLETED']:null;
            const items=${JSON.stringify(projects)}.filter(p=>status==='ALL' || (allowed?allowed.includes(p.statusCode):p.statusCode===status));
            return {data:{projects:items,items,total:items.length,totalCount:items.length,page:1,pageSize:100,totalPages:1}};
        }
        throw new Error('Unexpected API: '+url);
    };
    </script><script src="/frontend/js/${page}.js"></script><script>
    window.qaErrors=[];window.addEventListener('error',e=>window.qaErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.qaErrors.push(String(e.reason)));
    Pages[${JSON.stringify(page)}].init({root:document.querySelector('#fixture-root'),user:{roleCode:'ADMIN'},routeContext:${menuEntry ? "null" : JSON.stringify({planYear:page === "annual-targets" ? 2025 : 2026})}}).then(()=>window.qaReady=true).catch(e=>window.qaErrors.push(e.stack));
    </script></body></html>`;
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname === "/") {
            const page = url.searchParams.get("page") || "workforce-management";
            if (!["workforce-management", "workforce-load-detail", "admin-projects", "home", "annual-targets", "admin-users"].includes(page)) { res.writeHead(404).end(); return; }
            res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(fixture(page,url.searchParams.get("entry")==="menu")); return;
        }
        if (url.pathname === "/config/departments.json") {res.setHeader("Content-Type", "application/json");res.end(JSON.stringify({departments}));return;}
        if (!/^\/frontend\/(css|js)\/[a-z0-9.-]+\.(css|js)$/.test(url.pathname)) { res.writeHead(404).end(); return; }
        const file = path.join(root, url.pathname);
        if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
        res.setHeader("Content-Type", file.endsWith("css") ? "text/css" : "text/javascript");
        res.end(fs.readFileSync(file));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "init-members-ui-"));
    const browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
    let socket;
    try {
        for (let i = 0; i < 100 && !fs.existsSync(path.join(profile, "DevToolsActivePort")); i++) await delay(100);
        const port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0];
        const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        socket = new WebSocket(tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        let id = 0;
        const pending = new Map();
        socket.onmessage = ({ data }) => {
            const message = JSON.parse(data);
            if (!pending.has(message.id)) return;
            const entry = pending.get(message.id); pending.delete(message.id);
            clearTimeout(entry.timer);
            if (message.error) entry.reject(new Error(JSON.stringify(message.error))); else entry.resolve(message.result);
        };
        function send(method, params = {}) {
            return new Promise((resolve, reject) => {
                const requestId = ++id;
                const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timeout: ${method}`)); }, 15000);
                pending.set(requestId, { resolve, reject, timer });
                socket.send(JSON.stringify({ id: requestId, method, params }));
            });
        }
        async function evaluate(expression) {
            const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        }
        async function open(page, menuEntry = false) {
            await send("Page.navigate", { url: `${baseUrl}/?page=${page}${menuEntry ? "&entry=menu" : ""}` });
            for (let i = 0; i < 100; i++) {
                if (await evaluate("window.qaReady === true")) break;
                await delay(50);
            }
            assert.equal(await evaluate("window.qaReady === true"), true, JSON.stringify(await evaluate("window.qaErrors")));
        }
        async function screenshot(name) {
            const result = await send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(result.data, "base64"));
        }
        await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
        // The real menu sends null; dashboard detail links supply an object.
        for (const page of ["annual-targets","admin-projects","workforce-management"]) {
            await open(page,true);
            await evaluate(`Pages[${JSON.stringify(page)}].activate({routeContext:null})`);
            await evaluate(`Pages[${JSON.stringify(page)}].activate({})`);
            assert.deepEqual(await evaluate("qaErrors"),[]);
            assert.ok(await evaluate("apiCalls.every(call=>call.method==='GET')"));
            await evaluate(`Pages[${JSON.stringify(page)}].destroy()`);
        }
        await open("workforce-management");
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-lane.is-collapsed').length"), 2,
            JSON.stringify(await evaluate("({status:document.querySelector('#workforceManagementStatus').textContent,errors:qaErrors,calls:apiCalls})")));
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-assignment').length"), 0);
        await evaluate("document.querySelector('[data-workforce-filter=planning]').click()");
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-lane').length"), 1);
        assert.match(await evaluate("document.querySelector('.workforce-management-lane').textContent"), /입찰/);
        await evaluate("document.querySelector('[data-workforce-filter=confirmed]').click()");
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-lane').length"), 1);
        await evaluate("document.querySelector('[data-workforce-filter=all]').click();document.querySelector('#workforceManagementBasis').value='legacy-scenario';document.querySelector('#workforceManagementBasis').dispatchEvent(new Event('change'))");
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-lane').length"), 3);
        await evaluate("document.querySelector('#workforceManagementBasis').value='project-status';document.querySelector('#workforceManagementBasis').dispatchEvent(new Event('change'))");
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-lane').length"), 2);
        assert.match(await evaluate("document.querySelector('.workforce-management-project-summary').textContent"), /12명/);
        await screenshot("project-summary");
        await evaluate("document.querySelector('.workforce-management-summary-month.has-overload').focus();document.querySelector('.workforce-management-summary-month.has-overload').click()");
        assert.equal(await evaluate("document.querySelector('#workforceManagementLoadDetailDialog').open"),true);
        assert.match(await evaluate("document.querySelector('.detail-layer-group.is-danger .detail-layer-reasons').textContent"),/2.0 M\/M.*1.0 M\/M.*1.0 M\/M.*초과/);
        assert.equal(await evaluate("document.querySelector('.detail-layer-group.is-danger tbody').rows.length"),2);
        await screenshot("workforce-load-reasons");
        const loadHandle=await evaluate("(()=>{const r=document.querySelector('#workforceManagementLoadDetailDialog .dialog-header').getBoundingClientRect();return {x:r.left+70,y:r.top+30}})()");
        await send("Input.dispatchMouseEvent",{type:"mousePressed",x:loadHandle.x,y:loadHandle.y,button:"left",clickCount:1});
        await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:loadHandle.x+80,y:loadHandle.y+20,button:"left",buttons:1});
        await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:loadHandle.x+80,y:loadHandle.y+20,button:"left",clickCount:1});
        assert.ok(await evaluate("document.querySelector('#workforceManagementLoadDetailDialog').style.left !== ''"));
        await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
        await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
        assert.equal(await evaluate("document.querySelector('#workforceManagementLoadDetailDialog').open"),false);
        assert.equal(await evaluate("document.activeElement.matches('.workforce-management-summary-month.has-overload')"),true);
        await evaluate("document.querySelector('#workforceManagementWarningMetric').click()");
        assert.equal(await evaluate("navigation.page"),"workforce-load-detail");
        assert.equal(await evaluate("document.querySelector('#workforceManagementWarningMetric').textContent"),"1명");
        assert.equal(await evaluate("document.querySelectorAll('#workforceManagementAlertList li').length"),1);
        await evaluate("document.querySelector('#workforceManagementAlertList button').click()");
        assert.equal(await evaluate("navigation.options.context.workerKey"),"USER:1");
        await evaluate("document.querySelector('[data-workforce-project-toggle]').click()");
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-assignment').length"), 13);
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-assignment-remove').length"),13);
        assert.equal(await evaluate("document.querySelector('#workforceManagementEditModeButton').getAttribute('aria-pressed')"),"false");
        await evaluate("document.querySelector('.workforce-management-assignment-remove').click()");
        assert.equal(await evaluate("document.querySelector('#workforceManagementEditModeButton').getAttribute('aria-pressed')"),"true");
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-assignment.is-pending-removal').length"),1);
        assert.equal(await evaluate("document.querySelector('#workforceManagementQuickDialog').open"),false);
        await evaluate("document.querySelector('.workforce-management-assignment.is-pending-removal .workforce-management-assignment-remove').click();document.querySelector('#workforceManagementEditModeButton').click()");
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-assignment.is-pending-removal').length"),0);
        assert.equal(await evaluate("document.querySelector('.workforce-management-assignment-settings').textContent"),"매출단가 수정");
        await evaluate("document.querySelector('.workforce-management-assignment-person small').click()");
        assert.equal(await evaluate("document.querySelector('#workforceManagementQuickDialog').open"),true);
        assert.equal(await evaluate("document.activeElement.id"),"workforceManagementQuickSales");
        assert.equal(await evaluate("document.querySelector('#workforceManagementWorkerDetailDialog').open"),false);
        await evaluate("document.querySelector('[data-workforce-quick-close]').click();document.querySelector('.workforce-management-assignment-name').click()");
        assert.equal(await evaluate("document.querySelector('#workforceManagementWorkerDetailDialog').open"),true);
        assert.equal(await evaluate("document.querySelector('#workforceManagementQuickDialog').open"),false);
        await evaluate("document.querySelector('[data-workforce-worker-detail-close]').click();document.querySelector('.workforce-management-assignment-settings').click()");
        assert.equal(await evaluate("document.activeElement.id"),"workforceManagementQuickSales");
        await evaluate("document.querySelector('[data-workforce-quick-close]').click();document.querySelector('.workforce-management-assignment').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
        assert.equal(await evaluate("document.activeElement.id"),"workforceManagementQuickSales");
        await evaluate("document.querySelector('[data-workforce-quick-close]').click()");
        await evaluate("document.querySelector('.workforce-management-assignment-warning').click()");
        assert.equal(await evaluate("document.querySelector('#workforceManagementLoadDetailDialog').open"),true);
        assert.equal(await evaluate("document.querySelector('#workforceManagementQuickDialog').open"),false);
        await evaluate("document.querySelector('#workforceManagementLoadDetailDialog .dialog-close').click()");
        await evaluate("document.querySelector('[data-workforce-project-display=expanded]').click()");
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-assignment').length"), 15);
        await screenshot("project-expanded");
        await evaluate("document.querySelector('[data-workforce-project-display=summary]').click();document.querySelector('#workforceManagementEditModeButton').click()");
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-assignment').length"), 15);
        await evaluate("document.querySelector('#workforceManagementEditModeButton').click()");
        await evaluate("document.querySelector('[data-workforce-view=worker]').click()");
        assert.equal(await evaluate("document.querySelector('#workforceManagementProjectSummaryControls').hidden"), true);
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-worker-project-bar').length"), 15);
        assert.equal(await evaluate("document.querySelector('.workforce-management-worker-row-footer > small').textContent"),"1개 사업");
        const summaryFits="[...document.querySelectorAll('.workforce-management-worker-row-info.is-person')].every(c=>c.scrollWidth<=c.clientWidth && [...c.querySelectorAll('.workforce-management-worker-row-footer button')].every(b=>{const range=document.createRange();range.selectNodeContents(b);return b.scrollWidth<=b.clientWidth && range.getClientRects().length===1}) && c.querySelector('.workforce-management-worker-row-footer').getBoundingClientRect().height<=28)";
        assert.equal(await evaluate(summaryFits),true);
        await evaluate("document.querySelector('#workforceManagementLanes').scrollIntoView({block:'start'})");
        await screenshot("worker-summary-restyled");
        await evaluate("document.querySelector('.workforce-management-worker-row-footer [data-worker-detail]').click()");
        assert.equal(await evaluate("document.querySelector('#workforceManagementWorkerDetailDialog').open"),true);
        await evaluate("document.querySelector('#workforceManagementWorkerDetailDialog [data-workforce-worker-detail-close]').click()");
        await evaluate("document.querySelector('.workforce-management-worker-load-button').click()");
        assert.equal(await evaluate("document.querySelector('#workforceManagementLoadDetailDialog').open"),true);
        await evaluate("document.querySelector('#workforceManagementLoadDetailDialog .dialog-close').click();document.querySelector('[data-workforce-zoom=out]').click()");
        await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        assert.equal(await evaluate(summaryFits),true);
        await screenshot("worker-summary-compact");
        await evaluate("document.querySelector('[data-workforce-zoom=in]').click()");
        await evaluate("document.querySelector('[data-workforce-worker-view=department]').click()");
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-department-row').length"), 3);
        assert.match(await evaluate("document.querySelector('.workforce-management-department-row').textContent"), /과부하 1명/);
        assert.deepEqual(await evaluate("[...document.querySelectorAll('.workforce-management-department-row:first-child .workforce-management-department-metrics dd')].map(node=>node.textContent)"), ["5명", "2개", "61.0 M/M", "0.0 M/M", "1명 · 1개월"]);
        await screenshot("department-summary");
        await evaluate("document.querySelector('.workforce-management-department-row .has-overload').click()");
        assert.match(await evaluate("document.querySelector('#workforceManagementLoadDetailDialog').textContent"),/과부하/);
        await evaluate("document.querySelector('.detail-layer-body input').value='없는 대상';document.querySelector('.detail-layer-body input').dispatchEvent(new Event('input'))");
        assert.equal(await evaluate("document.querySelectorAll('.detail-layer-group:not([hidden])').length"),0);
        await evaluate("document.querySelector('#workforceManagementLoadDetailDialog .dialog-close').click()");
        await evaluate("document.querySelector('.workforce-management-department-metrics > div:last-child').click()");
        assert.equal(await evaluate("document.querySelectorAll('.detail-layer-group').length"),1);
        await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:false});
        assert.equal(await evaluate("(()=>{const r=document.querySelector('#workforceManagementLoadDetailDialog').getBoundingClientRect(),f=document.querySelector('#workforceManagementLoadDetailDialog .dialog-footer').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight && f.bottom<=r.bottom})()"),true);
        assert.equal(await evaluate("(()=>{const b=document.querySelector('.detail-layer-body');return b.scrollWidth<=b.clientWidth})()"),true);
        await screenshot("workforce-load-reasons-mobile");
        await evaluate("document.querySelector('#workforceManagementLoadDetailDialog .dialog-close').click()");
        await send("Emulation.setDeviceMetricsOverride",{width:1600,height:1100,deviceScaleFactor:1,mobile:false});
        await evaluate("document.querySelector('#workforceManagementMatrixWorkerSearch').value='없는 인력';document.querySelector('#workforceManagementMatrixWorkerSearch').dispatchEvent(new Event('input'))");
        assert.match(await evaluate("document.querySelector('#workforceManagementLanes').textContent"), /해당하는 인력이 없습니다/);
        await evaluate(`window.boardFixture=${JSON.stringify({ ...bootstrap, confirmed: { ...bootstrap.confirmed, projects: projects.map((project) => ({ ...project, statusCode: "CONTRACTED" })) } })};document.querySelector('#workforceManagementMatrixWorkerSearch').value='';document.querySelector('#workforceManagementMatrixWorkerSearch').dispatchEvent(new Event('input'));document.querySelector('[data-workforce-view=project]').click();document.querySelector('#workforceManagementRefreshButton').click()`);
        for (let i = 0; i < 50 && await evaluate("document.querySelector('#workforceManagementRefreshButton').disabled"); i++) await delay(50);
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-lane.is-confirmed').length"), 2);
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-lane.is-planning').length"), 0);
        assert.equal(await evaluate("document.querySelector('#workforceManagementProjectMetricNote').textContent"), "확정 2 · 계획 0");
        await evaluate(`window.boardFixture=${JSON.stringify({...bootstrap,confirmed:{...bootstrap.confirmed,assignments:[...assignments,{...assignments[0],assignmentId:21,projectId:2,totalMm:0.5,monthlyAllocations:[{month:"2026-01",mm:0.5}]}]}})};document.querySelector('#workforceManagementRefreshButton').click()`);
        for (let i=0;i<50 && await evaluate("document.querySelector('#workforceManagementRefreshButton').disabled");i++) await delay(50);
        await evaluate("document.querySelector('#workforceManagementProject').value='1';document.querySelector('#workforceManagementProject').dispatchEvent(new Event('change'))");
        await delay(50);
        await evaluate("document.querySelector('#workforceManagementAlertCount').click()");
        assert.equal(await evaluate("navigation.page"),"workforce-load-detail");
        await evaluate("document.querySelector('[data-workforce-project-display=summary]').click();document.querySelector('.workforce-management-summary-month.has-overload').click()");
        assert.equal(await evaluate("document.querySelectorAll('.detail-layer-group.is-danger').length"),1);
        assert.match(await evaluate("document.querySelector('.detail-layer-group.is-danger .detail-layer-reasons').textContent"),/숨겨진 프로젝트의 0.5 M\/M/);
        assert.match(await evaluate("document.querySelector('.detail-layer-group.is-danger tbody').textContent"),/필터 밖 포함/);
        assert.equal(await evaluate("document.querySelector('.detail-layer-group.is-danger tbody').rows.length"),3);
        assert.equal(await evaluate("Pages['workforce-management'].beforeLeave()"),true);
        assert.equal(await evaluate("document.querySelector('#workforceManagementLoadDetailDialog').open"),false);
        await evaluate("Pages['workforce-management'].activate({routeContext:{planYear:2026,phase:'planning'}})");
        assert.equal(await evaluate("document.querySelectorAll('.workforce-management-lane').length"),1);
        assert.equal(await evaluate("document.querySelector('[data-workforce-filter=planning]').getAttribute('aria-pressed')"),"true");
        await evaluate("Pages['workforce-management'].activate({routeContext:{planYear:2026,projectId:1,assignmentId:1,priceField:'sales'}})");
        assert.equal(await evaluate("document.querySelector('#workforceManagementQuickDialog').open"),true);
        assert.equal(await evaluate("document.activeElement.id"),"workforceManagementQuickSales");
        assert.equal(await evaluate("document.querySelector('#workforceManagementQuickSales').closest('details')"),null);
        assert.equal(await evaluate("(()=>{const field=document.querySelector('#workforceManagementQuickSales').getBoundingClientRect(),body=document.querySelector('#workforceManagementQuickDialog .dialog-body').getBoundingClientRect();return field.top>=body.top && field.bottom<=body.bottom})()"),true);
        await screenshot("workforce-sales-price-input");
        await evaluate("Pages['workforce-management'].activate({routeContext:{planYear:2026,projectId:1,assignmentId:1,priceField:'cost'}})");
        assert.equal(await evaluate("document.activeElement.id"),"workforceManagementQuickCost");
        assert.equal(await evaluate("document.querySelector('#workforceManagementProject').value"),"1");
        assert.equal(await evaluate("Pages['workforce-management'].beforeLeave()"),true);
        const boardPeopleFixture={...bootstrap,confirmed:{...bootstrap.confirmed,assignments:[
            ...assignments.map(row=>row.assignmentId===20?{...row,monthlyAllocations:[1,4,5,6].map(m=>({month:`2026-${String(m).padStart(2,'0')}`,mm:1}))}:
                row.assignmentId===3?{...row,monthlyAllocations:row.monthlyAllocations.map(a=>a.month==='2026-01'?{...a,mm:0.5}:a)}:row),
            {...assignments[1],assignmentId:22,projectId:2,monthlyAllocations:[{month:'2026-02',mm:0.5}]},
            {...assignments[2],assignmentId:23,projectId:2,monthlyAllocations:[{month:'2026-01',mm:0.5}]}
        ]}};
        await evaluate(`window.boardFixture=${JSON.stringify(boardPeopleFixture)};Pages['workforce-management'].activate({routeContext:{planYear:2026,projectId:1}})`);
        assert.equal(await evaluate("document.querySelectorAll('#workforceManagementAlertList li').length"),2);
        assert.equal(await evaluate("document.querySelector('#workforceManagementWarningMetric').textContent"),"2명");
        assert.equal(await evaluate("document.querySelector('#workforceManagementAlertCount').textContent"),"2명 · 5인·월");
        assert.match(await evaluate("document.querySelector('#workforceManagementAlertList li:first-child').textContent"),/총 4개월.*1월, 4월, 5월, 6월/);
        await evaluate("document.querySelector('#workforceManagementAlerts').scrollIntoView({block:'center'})");
        await screenshot("workforce-overload-people");
        assert.ok(await evaluate("apiCalls.every(call=>call.method==='GET')"));
        assert.deepEqual(await evaluate("window.qaErrors"), []);
        await evaluate("Pages['workforce-management'].destroy()");
        assert.equal(await evaluate("document.querySelector('#workforceManagementLoadDetailDialog')===null"),true);

        await open("admin-projects");
        await evaluate("Pages['admin-projects'].activate({routeContext:{planYear:2026,statusCode:'PRE_CONTRACT'}})");
        assert.equal(await evaluate("document.querySelector('#projectStatusFilter').value"),"PRE_CONTRACT");
        assert.equal(await evaluate("document.querySelectorAll('.project-card').length"),1);
        assert.match(await evaluate("document.querySelector('.project-card').textContent"),/데이터 분석 플랫폼/);
        await evaluate("Pages['admin-projects'].activate({routeContext:{planYear:2026,statusCode:'POST_CONTRACT'}})");
        assert.equal(await evaluate("document.querySelector('#projectPeriodYearFromFilter').value"),"2026");
        assert.match(await evaluate("apiCalls.filter(c=>c.url.startsWith('/admin/projects?')).at(-1).url"),/statusCode=POST_CONTRACT/);
        await evaluate("document.querySelector('.project-card').click()");
        await delay(150);
        assert.equal(await evaluate("document.querySelector('#adminProjectDetailDialog').open"), true);
        assert.equal(await evaluate("document.querySelector('#projectId').value"), "1");
        await evaluate("document.querySelector('#projectName').value='저장 검증';document.querySelector('#projectForm').requestSubmit()");
        await delay(100);
        assert.equal(await evaluate("apiCalls.find(call=>call.method==='PUT').body.projectName"), "저장 검증");
        assert.equal(await evaluate("Pages['admin-projects'].hasUnsavedChanges()"), false);
        assert.equal(await evaluate("document.querySelectorAll('#adminProjectRevenueRows tr').length"),3);
        await evaluate("document.querySelector('#adminProjectRevenueJump').click();document.querySelector('[data-revenue-year=\"2026\"] [data-revenue-amount]').value='100000000';document.querySelector('[data-revenue-year=\"2027\"] [data-revenue-amount]').value='200000000';document.querySelector('[data-revenue-save=\"2026\"]').click()");
        await delay(100);
        assert.equal(await evaluate("document.querySelector('[data-revenue-year=\"2027\"] [data-revenue-amount]').value"),"200000000");
        assert.equal(await evaluate("Pages['admin-projects'].hasUnsavedChanges()"),true);
        await evaluate("document.querySelector('[data-revenue-save=\"2027\"]').click()");await delay(100);
        assert.equal(await evaluate("Pages['admin-projects'].hasUnsavedChanges()"),false);
        assert.match(await evaluate("document.querySelector('#adminProjectRevenueSummary').textContent"),/300,000,000원/);
        await screenshot("project-annual-revenue-input");
        await screenshot("project-detail");
        const rect = await evaluate("(()=>{const r=document.querySelector('#adminProjectDialogHandle').getBoundingClientRect();return {x:r.left+60,y:r.top+30}})()");
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x + 90, y: rect.y + 25, button: "left", buttons: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x + 90, y: rect.y + 25, button: "left", clickCount: 1 });
        assert.ok(await evaluate("document.querySelector('#adminProjectDetailDialog').style.left !== ''"));
        await evaluate("document.querySelector('#projectName').value='수정중';window.confirmResult=false;document.querySelector('[data-admin-project-close]').click()");
        assert.equal(await evaluate("document.querySelector('#adminProjectDetailDialog').open"), true);
        await evaluate("window.confirmResult=true;document.querySelector('[data-admin-project-close]').click()");
        assert.equal(await evaluate("document.querySelector('#adminProjectDetailDialog').open"), false);
        await evaluate("window.apiFailures=true;document.querySelector('.project-card').click()");
        await delay(100);
        assert.equal(await evaluate("document.querySelector('#adminProjectDialogTitle').textContent"), "프로젝트 조회 실패");
        assert.equal(await evaluate("document.querySelector('#adminProjectDialogFields').disabled"), true);
        await evaluate("window.apiFailures=false;document.querySelector('[data-admin-project-close]').click()");
        await evaluate("document.querySelector('#newProjectButton').click()");
        assert.equal(await evaluate("document.querySelector('#projectId').value"), "");
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        assert.equal(await evaluate("document.querySelector('#adminProjectDetailDialog').open"), false);
        await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
        await evaluate("document.querySelector('.project-card').click()"); await delay(150);
        assert.equal(await evaluate("document.querySelector('#adminProjectDetailDialog').getBoundingClientRect().right <= innerWidth"), true);
        await screenshot("project-detail-mobile");
        assert.deepEqual(await evaluate("window.qaErrors"), []);
        assert.equal(await evaluate("Pages['admin-projects'].beforeLeave()"), true);
        assert.equal(await evaluate("document.querySelector('#adminProjectDetailDialog').open"), false);
        await evaluate("Pages['admin-projects'].destroy()");

        await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
        await open("home");
        assert.equal(await evaluate("document.querySelector('#homeAnnualGoal').textContent"),"144,000,000원");
        for (const [id,page,key,value] of [
            ['homeAnnualGoal','annual-targets','view','staff'],['homePlannedSales','annual-targets','view','projects'],
            ['homeOperatingProfit','annual-targets','view','company'],['homeWeightedAward','admin-projects','statusCode','POST_CONTRACT'],
            ['homeStaffTarget','annual-targets','view','staff'],['homeDepartmentTarget','annual-targets','view','department-extra'],
            ['homeCompanyTarget','annual-targets','view','company-extra'],['homeAssignmentCount','workforce-management','phase','confirmed'],
            ['homeShortageCount','workforce-management','phase','planning']]) {
            await evaluate(`document.querySelector('#${id}').click()`);
            assert.equal(await evaluate("navigation.page"),page);
            assert.equal(await evaluate(`navigation.options.context.${key}`),value);
            assert.equal(await evaluate("navigation.options.context.planYear"),2026);
        }
        assert.equal(await evaluate("document.querySelectorAll('#homeAnnualRevenueChart [data-trend-metric=target]').length"),3);
        assert.ok(await evaluate("document.querySelector('.executive-trend-bar.is-target').getBoundingClientRect().height>10"));
        await evaluate("document.querySelector('.executive-trend-bar.is-target').click()");
        assert.equal(await evaluate("navigation.options.context.view"),"staff");
        await send("Emulation.setDeviceMetricsOverride",{width:1920,height:1100,deviceScaleFactor:1,mobile:false});
        await evaluate("window.scrollTo(0,0)");
        assert.equal(await evaluate("document.querySelectorAll('.executive-kpi-card').length"),5);
        assert.equal(await evaluate("document.querySelector('#homeBidTargetCount')===null && document.querySelector('#homeAnnualFinancialTable')===null && document.querySelector('.executive-target-strip')===null"),true);
        assert.equal(await evaluate("[...document.querySelectorAll('.executive-kpi-value')].every(b=>b.scrollWidth<=b.clientWidth)"),true);
        const layoutFixture={...home,projectSummary:{...home.projectSummary,contractAmountVat:"2236757952"},annualPerformance:{targetSaved:true,summary:{targetAmount:"1560000000",salesAmount:"120000000"},targetBreakdown:{staffAmount:"1560000000",departmentExtra:"0",companyExtra:"0"}},financials:{...home.financials,confirmed:{...home.financials.confirmed,summary:{...home.financials.confirmed.summary,targetAmount:"1560000000"}}}};
        await evaluate(`window.homeFixture=${JSON.stringify(layoutFixture)};document.querySelector('#fixture-root').style.maxWidth='calc(100vw - 300px)';Pages.home.activate()`);
        await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        assert.equal(await evaluate("[...document.querySelectorAll('.executive-kpi-value')].every(b=>{const r=document.createRange();r.selectNodeContents(b);return r.getClientRects().length===1 && b.scrollWidth<=b.clientWidth})"),true);
        assert.equal(await evaluate("document.querySelector('#homeStaffTarget').textContent"),"1,560,000,000원");
        assert.equal(await evaluate("[...document.querySelectorAll('.executive-kpi-card small')].every(b=>b.getBoundingClientRect().height<20)"),true);
        await screenshot("home-kpi-consolidated");
        await evaluate("document.querySelector('#fixture-root').style.maxWidth='900px'");
        await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        assert.equal(await evaluate("[...document.querySelectorAll('.executive-kpi-value,.executive-kpi-breakdown dd')].every(b=>b.scrollWidth<=b.clientWidth)"),true);
        const longAmounts={...layoutFixture,annualPerformance:{...layoutFixture.annualPerformance,summary:{...layoutFixture.annualPerformance.summary,targetAmount:"999999999999999999"},targetBreakdown:{staffAmount:"999999999999999999",departmentExtra:"0",companyExtra:"0"}},projectSummary:{...layoutFixture.projectSummary,contractAmountVat:"999999999999999999"},financials:{...layoutFixture.financials,confirmed:{...layoutFixture.financials.confirmed,summary:{...layoutFixture.financials.confirmed.summary,totalSalesAmount:"999999999999999999",operatingProfit:"-999999999999999999",laborCostAmount:"999999999999999999"}}}};
        await evaluate(`window.homeFixture=${JSON.stringify(longAmounts)};Pages.home.activate()`);
        await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        assert.equal(await evaluate("[...document.querySelectorAll('.executive-kpi-value,.executive-kpi-breakdown dd')].every(b=>b.scrollWidth<=b.clientWidth)"),true);
        const compactFixture={...layoutFixture,financials:{...layoutFixture.financials,confirmed:{summary:{...layoutFixture.financials.confirmed.summary,totalSalesAmount:"0",operatingProfit:"0",laborCostAmount:"0",otherCost:"0",zeroPriceCount:32,zeroSalesPriceCount:32,zeroCostPriceCount:32},
            monthlySales:monthlyRevenueFixture(2026,"1560000000",[]),dataQualityIssues:Array.from({length:32},(_,i)=>({assignmentId:i+1,projectId:1,employeeName:`검증인력 ${i+1}`,projectName:projects[0].projectName,salesUnitPrice:"0",costUnitPrice:"0",reasons:["매출단가와 원가단가가 0원입니다."]}))}}};
        await send("Emulation.setDeviceMetricsOverride",{width:1366,height:768,deviceScaleFactor:1,mobile:false});
        await evaluate(`window.homeFixture=${JSON.stringify(compactFixture)};document.querySelector('#fixture-root').style.maxWidth='calc(100vw - 280px)';window.scrollTo(0,0);Pages.home.activate()`);
        await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        const compactBounds=await evaluate("(()=>{const p=document.querySelector('.executive-annual-panel').getBoundingClientRect(),c=document.querySelector('#homeAnnualRevenueChart').getBoundingClientRect();return {chartTop:c.top,chartBottom:c.bottom,controlsHeight:c.top-p.top,viewport:innerHeight}})()");
        assert.ok(compactBounds.controlsHeight<100,JSON.stringify(compactBounds));
        assert.ok(compactBounds.chartBottom+76<=compactBounds.viewport,JSON.stringify(compactBounds));
        assert.equal(await evaluate("document.querySelector('.executive-risk-panel').getBoundingClientRect().bottom+76<=innerHeight"),true);
        assert.equal(await evaluate("document.querySelector('#homeFinancialDetailsButton').hidden"),true);
        assert.equal(await evaluate("[...document.querySelectorAll('.executive-kpi-value,.executive-kpi-breakdown dd')].every(b=>b.scrollWidth<=b.clientWidth)"),true);
        await screenshot("home-compact-above-fold");
        await evaluate(`window.homeFixture=${JSON.stringify(home)};document.querySelector('#fixture-root').style.maxWidth='';Pages.home.activate()`);
        await send("Emulation.setDeviceMetricsOverride",{width:1600,height:1100,deviceScaleFactor:1,mobile:false});
        assert.equal(await evaluate("document.querySelector('#homeOtherCost').textContent"),"12,000,000원");
        assert.equal(await evaluate("document.querySelectorAll('#homeAnnualRevenueChart [data-trend-metric=sales]').length"),3);
        assert.equal(await evaluate("document.querySelectorAll('#homeAnnualRevenueBody tr').length"),1);
        assert.equal(await evaluate("document.querySelector('#homeMonthlySalesView')"),null);
        await evaluate("document.querySelector('#homeAnnualRevenueChart').scrollIntoView({block:'center'})");
        assert.equal(await evaluate("document.querySelectorAll('#homeAnnualTrendBody tr').length"),3);
        assert.equal(await evaluate("document.querySelectorAll('#homeAnnualRevenueChart .is-loss').length"),1);
        await evaluate("document.querySelector('[data-trend-year=\"2024\"] [data-trend-metric=sales]').click()");
        assert.equal(await evaluate("navigation.options.context.planYear"),2024);
        assert.equal(await evaluate("navigation.options.context.view"),"projects");
        await evaluate("document.querySelector('[data-trend-year=\"2025\"] [data-trend-metric=profit]').click()");
        assert.equal(await evaluate("navigation.options.context.planYear"),2025);
        assert.equal(await evaluate("navigation.options.context.view"),"company");
        await screenshot("home-project-annual-revenue");
        await evaluate("document.querySelector('#homeDecisionList button').click()");
        assert.equal(await evaluate("document.querySelector('#homeRiskDetailDialog').open"),true);
        assert.match(await evaluate("document.querySelector('.detail-layer-reasons').textContent"),/입찰.*수주 확정 전 검토/);
        await evaluate("document.querySelector('[data-detail-action=project]').click()");
        assert.equal(await evaluate("window.navigation.options.context.projectId"),1);
        await evaluate("document.querySelector('#homeRiskCount').click()");
        assert.equal(await evaluate("navigation.page"),"workforce-load-detail");
        await evaluate("document.querySelector('#homeRiskList button').click()");
        assert.equal(await evaluate("navigation.options.context.workerKey"),"USER:1");
        const personMonths=[1,4,5,6].map(month=>({...riskFixture,month:`2026-${String(month).padStart(2,'0')}`}));
        await evaluate(`window.homeFixture=${JSON.stringify({...home,financials:{...home.financials,warnings:[...personMonths,{...riskFixture,workerKey:"USER:2",employeeName:"검증인력 2",month:"2026-02"},{...riskFixture,workerKey:"USER:3",employeeName:"정상 분할",totalMm:1}]}})};Pages.home.activate()`);
        assert.equal(await evaluate("document.querySelectorAll('#homeRiskList li').length"),2);
        assert.equal(await evaluate("document.querySelector('#homeRiskCount').textContent"),"2명");
        assert.match(await evaluate("document.querySelector('#homeRiskList li:first-child').textContent"),/총 4개월.*1월, 4월, 5월, 6월/);
        await evaluate("document.querySelector('#homeRiskList').scrollIntoView({block:'center'})");
        await screenshot("home-overload-people");
        await evaluate(`window.homeFixture=${JSON.stringify({...home,financials:{...home.financials,warnings:Array.from({length:9},(_,i)=>({...riskFixture,workerKey:`USER:${i+1}`,employeeName:`검증인력 ${i+1}`}))}})};Pages.home.activate()`);
        assert.equal(await evaluate("document.querySelectorAll('#homeRiskList li').length"),9);
        await evaluate("document.querySelector('#homeRiskList li:last-child button').click()");
        assert.equal(await evaluate("navigation.page"),"workforce-load-detail");
        assert.equal(await evaluate("navigation.options.context.workerKey"),"USER:9");
        await evaluate(`window.homeFixture=${JSON.stringify({...home,financials:{...home.financials,confirmed:{summary:{totalSalesAmount:"0",laborCostAmount:"0",otherCost:"101",totalCostAmount:"101",operatingProfit:"-101",assignmentCount:0}}}})};Pages.home.activate()`);
        assert.match(await evaluate("document.querySelector('#homeOperatingProfit').textContent"),/-101원/);
        await screenshot("home-annual-cost");
        await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:false});
        await evaluate(`window.homeFixture=${JSON.stringify(home)};Pages.home.activate()`);
        await evaluate("window.scrollTo(0,0);new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('.executive-kpi-value,.executive-kpi-breakdown dd')].every(b=>b.scrollWidth<=b.clientWidth)"),true);
        await screenshot("home-kpi-mobile");
        await evaluate("document.querySelector('#homeAnnualRevenueChart').scrollIntoView({block:'center'})");
        assert.equal(await evaluate("document.querySelector('#homeAnnualRevenueChart').scrollWidth<=document.querySelector('#homeAnnualRevenueChart').clientWidth"),true);
        await screenshot("home-monthly-mobile");
        await send("Emulation.setDeviceMetricsOverride",{width:1600,height:1100,deviceScaleFactor:1,mobile:false});
        const missing={projectId:1,projectName:projects[0].projectName,year:2026,reason:'2026년 매출 발생 후 결산액을 입력하세요.'};
        await evaluate(`window.homeFixture=${JSON.stringify({...home,annualPerformance:{...home.annualPerformance,missingRevenue:[{projectId:1,projectName:projects[0].projectName,year:2026,reason:'2026년 매출 발생 후 결산액을 입력하세요.'}]}})};Pages.home.activate()`);
        assert.match(await evaluate("document.querySelector('#homeSalesDetail').textContent"),/매출 미등록 1개/);
        await evaluate("document.querySelector('#homeFinancialDetailsButton').click()");
        assert.match(await evaluate("document.querySelector('.detail-layer-reasons').textContent"),/결산액/);
        await screenshot("home-missing-project-revenue");
        await evaluate("document.querySelector('[data-detail-action=revenue-1]').click()");
        assert.equal(await evaluate("navigation.page"),"admin-projects");
        assert.equal(await evaluate("navigation.options.context.projectId"),1);
        assert.equal(await evaluate("navigation.options.context.planYear"),2026);
        assert.equal(await evaluate("navigation.options.context.view"),"revenue");
        assert.deepEqual(await evaluate("window.qaErrors"),[]);
        await evaluate("Pages.home.destroy()");
        await open("workforce-load-detail");
        assert.match(await evaluate("document.querySelector('#workforceLoadDetailOrigin').textContent"),/사업·인력 관리의 상세 화면/);
        const peopleFixture={...home,financials:{...home.financials,warnings:[...personMonths,{...riskFixture,workerKey:"USER:2",employeeName:"검증인력 2",month:"2026-02",allocations:riskFixture.allocations.map(a=>({...a,projectId:2,projectName:projects[1].projectName}))},{...riskFixture,workerKey:"USER:3",employeeName:"정상 분할",totalMm:1}]}};
        await evaluate(`window.homeFixture=${JSON.stringify(peopleFixture)};Pages['workforce-load-detail'].activate({routeContext:{planYear:2026,returnPage:'home'}})`);
        assert.equal(await evaluate("document.querySelectorAll('#workforceLoadDetailPeople li').length"),2);
        await evaluate("Pages['workforce-load-detail'].activate({routeContext:{planYear:2026,projectId:2,returnPage:'home'}})");
        assert.equal(await evaluate("document.querySelectorAll('#workforceLoadDetailPeople li').length"),1);
        assert.match(await evaluate("document.querySelector('#workforceLoadDetailPeople').textContent"),/검증인력 2/);
        await evaluate("Pages['workforce-load-detail'].activate({routeContext:{planYear:2026,returnPage:'home'}})");
        await evaluate("document.querySelector('#workforceLoadDetailPeople button').click()");
        for(let i=0;i<50 && await evaluate("document.querySelector('#workforceLoadDetailRefresh').disabled");i++) await delay(20);
        assert.match(await evaluate("document.querySelector('#workforceLoadDetailSummary').textContent"),/총 4개월.*1월, 4월, 5월, 6월/);
        assert.equal(await evaluate("document.querySelectorAll('.workforce-load-detail-month').length"),4);
        assert.equal(await evaluate("document.querySelector('.workforce-load-detail-month tbody').rows.length"),2);
        assert.match(await evaluate("document.querySelector('.workforce-load-detail-breadcrumb').textContent"),/사업·계획[\s\S]*사업·인력 관리[\s\S]*초과투입 인력[\s\S]*검증인력 1/);
        assert.match(await evaluate("document.querySelector('#workforceLoadDetailOrigin').textContent"),/경영 현황에서 이동/);
        assert.match(await evaluate("document.querySelector('#workforceLoadDetailBack').textContent"),/경영 현황으로 돌아가기/);
        await evaluate("document.querySelector('#workforceLoadDetailOverview').click()");
        for(let i=0;i<50 && await evaluate("document.querySelector('#workforceLoadDetailRefresh').disabled");i++) await delay(20);
        assert.equal(await evaluate("document.querySelectorAll('#workforceLoadDetailPeople li').length"),2);
        assert.equal(await evaluate("document.querySelector('#workforceLoadDetailCurrent').textContent"),"초과투입 인력");
        await evaluate("document.querySelector('#workforceLoadDetailPeople button').click()");
        for(let i=0;i<50 && await evaluate("document.querySelector('#workforceLoadDetailRefresh').disabled");i++) await delay(20);
        await screenshot("workforce-person-load-detail");
        await evaluate("Pages['workforce-load-detail'].activate({routeContext:{planYear:2026,workerKey:'USER:1',projectId:1,returnPage:'workforce-management'}})");
        assert.match(await evaluate("document.querySelector('#workforceLoadDetailOrigin').textContent"),/사업·인력 관리에서 이동/);
        assert.match(await evaluate("document.querySelector('#workforceLoadDetailBack').textContent"),/사업·인력 관리로 돌아가기/);
        await evaluate("document.querySelector('#workforceLoadDetailBack').click()");
        assert.equal(await evaluate("navigation.page"),"workforce-management");
        assert.equal(await evaluate("navigation.options.context.projectId"),1);
        await evaluate("document.querySelector('#workforceLoadDetailParent').click()");
        assert.equal(await evaluate("navigation.options.context.planYear"),2026);
        await evaluate("document.querySelector('.workforce-load-detail-month tbody button').click()");
        assert.equal(await evaluate("navigation.page"),"workforce-management");
        assert.equal(await evaluate("navigation.options.context.assignmentId"),1);
        await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:false});
        assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"));
        await screenshot("workforce-person-load-mobile");
        await evaluate("window.apiFailures=true;document.querySelector('#workforceLoadDetailForm').requestSubmit()");await delay(100);
        assert.equal(await evaluate("document.querySelectorAll('.workforce-load-detail-month').length"),0);
        assert.match(await evaluate("document.querySelector('#workforceLoadDetailStatus').textContent"),/조회 실패/);
        await evaluate("window.apiFailures=false;Pages['workforce-load-detail'].activate({routeContext:{planYear:2026,workerKey:'USER:3',returnPage:'home'}})");
        assert.match(await evaluate("document.querySelector('#workforceLoadDetailSummary').textContent"),/초과투입 없음/);
        await evaluate("document.querySelector('#workforceLoadDetailBack').click()");
        assert.equal(await evaluate("navigation.page"),"home");
        assert.equal(await evaluate("navigation.options.context.planYear"),2026);
        assert.ok(await evaluate("apiCalls.every(call=>call.method==='GET')"));
        assert.deepEqual(await evaluate("qaErrors"),[]);
        await evaluate("Pages['workforce-load-detail'].destroy()");
        await send("Emulation.setDeviceMetricsOverride",{width:1600,height:1100,deviceScaleFactor:1,mobile:false});
        await open("annual-targets");
        for (const [view,id] of [['company','annualTargetsCompanyResults'],['projects','annualTargetsProjectResults'],['staff','annualTargetsStaffForm']]) {
            await evaluate(`Pages['annual-targets'].activate({routeContext:{planYear:2025,view:'${view}'}})`);
            assert.equal(await evaluate("document.activeElement.id"),id);
        }
        await evaluate("window.scrollTo(0,0)");
        assert.equal(await evaluate("document.querySelectorAll('#annualTargetsYearResult tr').length"),1);
        assert.equal(await evaluate("document.querySelectorAll('#annualTargetsPeriod, #annualTargetsMonths, #annualTargetsCompanyMonthly').length"),0);
        assert.match(await evaluate("document.querySelector('#annualTargetsKpis').textContent"),/120,000,000원/);
        assert.equal(await evaluate("document.querySelectorAll('#annualTargetsEditMonth, #annualTargetsSave, #annualTargetsProjects input').length"),0);
        assert.equal(await evaluate("document.querySelectorAll('#annualTargetsEditor tr').length"),1);
        await screenshot("annual-targets-overview");
        await evaluate("document.querySelector('#annualTargetsExpenseForm').scrollIntoView({block:'start'})");
        await screenshot("annual-cost-input");
        await evaluate("document.querySelector('#annualTargetsProjects button').click()");
        assert.equal(await evaluate("window.navigation.options.context.projectId"),1);
        await evaluate("document.querySelector('#annualTargetsEditor input').value='240,000,000';document.querySelector('#annualTargetsEditor input').dispatchEvent(new Event('input'));document.querySelector('#annualTargetsBudgetEditor input').value='1,200';document.querySelector('#annualTargetsBudgetEditor input').dispatchEvent(new Event('input'));document.querySelector('#annualTargetsCompanyAmount').value='2,400';document.querySelector('#annualTargetsCompanyAmount').dispatchEvent(new Event('input'));document.querySelector('#annualTargetsExpenseAmount').value='50,000';document.querySelector('#annualTargetsExpenseAmount').dispatchEvent(new Event('input'))");
        assert.equal(await evaluate("document.querySelector('#annualTargetsCompanyGoal').textContent"),"240,003,600원");
        await evaluate("window.confirmResult=false");
        assert.equal(await evaluate("Pages['annual-targets'].beforeLeave()"),false);
        await evaluate("window.confirmResult=true;document.querySelector('#annualTargetsStaffForm').requestSubmit()");
        await delay(100);
        assert.equal(await evaluate("apiCalls.find(call=>call.url.endsWith('/staff')&&call.method==='PUT').body.staff[0].amount"),"240000000");
        assert.equal(await evaluate("document.querySelector('#annualTargetsBudgetEditor input').value"),"1,200");
        assert.equal(await evaluate("document.querySelector('#annualTargetsCompanyAmount').value"),"2,400");
        assert.equal(await evaluate("document.querySelector('#annualTargetsExpenseAmount').value"),"50,000");
        assert.equal(await evaluate("Pages['annual-targets'].hasUnsavedChanges()"),true);
        for(const name of ['Dept','Company','Expense']) {
            await evaluate(`document.querySelector('#annualTargets${name}Form').requestSubmit()`);await delay(100);
        }
        assert.equal(await evaluate("Pages['annual-targets'].hasUnsavedChanges()"),false);
        assert.equal(await evaluate("apiCalls.filter(c=>c.method==='PUT').length"),4);
        assert.equal(await evaluate("apiCalls.find(c=>c.url.endsWith('/expenses')&&c.method==='PUT').body.amount"),"50000");
        // A response from another area must not replace a dirty employee draft or its original revision.
        await evaluate("document.querySelector('#annualTargetsEditor input').value='300,000,000';document.querySelector('#annualTargetsEditor input').dispatchEvent(new Event('input'));document.querySelector('#annualTargetsBudgetEditor input').value='3,600';document.querySelector('#annualTargetsBudgetEditor input').dispatchEvent(new Event('input'));annualFixture.revisions.staff++;annualFixture.staffTargets[0].amount='360000000';document.querySelector('#annualTargetsDeptForm').requestSubmit()");
        await delay(100);
        assert.equal(await evaluate("document.querySelector('#annualTargetsEditor input').value"),"300,000,000");
        await evaluate("document.querySelector('#annualTargetsStaffForm').requestSubmit()");
        await delay(100);
        assert.match(await evaluate("document.querySelector('#annualTargetsStaffStatus').textContent"),/다른 사용자가 변경/);
        assert.equal(await evaluate("document.querySelector('#annualTargetsEditor input').value"),"300,000,000");
        assert.equal(await evaluate("Pages['annual-targets'].hasUnsavedChanges()"),true);
        await evaluate("document.querySelector('#annualTargetsRefresh').click()");await delay(100);
        assert.equal(await evaluate("document.querySelector('#annualTargetsEditor input').value"),"360,000,000");
        await evaluate("document.querySelector('#annualTargetsStaffSearch').value='없는 직원';document.querySelector('#annualTargetsStaffSearch').dispatchEvent(new Event('input'))");
        assert.match(await evaluate("document.querySelector('#annualTargetsEditor').textContent"),/해당하는 직원이 없습니다/);
        await evaluate("document.querySelector('#annualTargetsStaffSearch').value='';document.querySelector('#annualTargetsStaffSearch').dispatchEvent(new Event('input'));document.querySelector('#annualTargetsCloseYear').click()");
        await delay(100);
        assert.equal(await evaluate("document.querySelector('#annualTargetsEditor input').disabled"),true);
        assert.equal(await evaluate("document.querySelector('#annualTargetsExpenseAmount').disabled"),true);
        assert.equal(await evaluate("document.querySelector('#annualTargetsCloseYear').textContent"),"연도 마감 완료");
        await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
        await screenshot("annual-targets-mobile");
        await evaluate("annualFixture.projects=[];Pages['annual-targets'].activate()");
        assert.match(await evaluate("document.querySelector('#annualTargetsProjects').textContent"), /마감 보존/);
        assert.equal(await evaluate("document.querySelector('#annualTargetsProjects button').disabled"), true);
        assert.deepEqual(await evaluate("window.qaErrors"), []);
        await evaluate("Pages['annual-targets'].destroy()");
        await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
        await open("annual-targets");
        await evaluate("annualFixture.year=2024;annualFixture.staffTargets=[];annualFixture.projects=[];annualFixture.performance.closed=false;annualFixture.historicalTotals={revision:0,saved:false,available:true,reason:'',targetEditable:true,targetAmount:null,salesAmount:null,netProfit:null,note:''};Pages['annual-targets'].activate({routeContext:{planYear:2024,view:'historical'}})");
        assert.equal(await evaluate("document.activeElement.id"),"annualTargetsHistoricalTarget");
        await evaluate("document.querySelector('#annualTargetsHistoricalTarget').value='1,000,000';document.querySelector('#annualTargetsHistoricalTarget').dispatchEvent(new Event('input'));document.querySelector('#annualTargetsHistoricalSales').value='800,000';document.querySelector('#annualTargetsHistoricalSales').dispatchEvent(new Event('input'));document.querySelector('#annualTargetsHistoricalProfit').value='-50,000';document.querySelector('#annualTargetsHistoricalProfit').dispatchEvent(new Event('input'));document.querySelector('#annualTargetsHistoricalForm').requestSubmit()");
        await delay(100);
        assert.equal(await evaluate("apiCalls.find(c=>c.url.endsWith('/historical-totals')&&c.method==='PUT').body.netProfit"),"-50000");
        assert.match(await evaluate("document.querySelector('#annualTargetsKpis').textContent"),/-50,000원/);
        assert.equal(await evaluate("document.querySelector('#annualTargetsStaffForm').hidden"),true);
        assert.match(await evaluate("document.querySelector('#annualTargetsYearResult').textContent"),/상세 없음/);
        await screenshot("historical-company-totals");
        await evaluate("document.querySelector('#annualTargetsHistoricalProfit').value='';document.querySelector('#annualTargetsHistoricalProfit').dispatchEvent(new Event('input'));document.querySelector('#annualTargetsHistoricalForm').requestSubmit()");await delay(100);
        assert.match(await evaluate("document.querySelector('#annualTargetsKpis').textContent"),/미입력/);
        await evaluate("document.querySelector('#annualTargetsHistoricalSales').value='900,000';document.querySelector('#annualTargetsHistoricalSales').dispatchEvent(new Event('input'));annualFixture.historicalTotals.revision++;document.querySelector('#annualTargetsHistoricalForm').requestSubmit()");await delay(100);
        assert.match(await evaluate("document.querySelector('#annualTargetsHistoricalStatus').textContent"),/다른 사용자가/);
        assert.equal(await evaluate("document.querySelector('#annualTargetsHistoricalSales').value"),"900,000");
        await evaluate("window.confirmResult=false");assert.equal(await evaluate("Pages['annual-targets'].beforeLeave()"),false);
        await evaluate("window.confirmResult=true;document.querySelector('#annualTargetsRefresh').click()");await delay(100);
        await evaluate("document.querySelector('#annualTargetsHistoricalDisable').click()");await delay(100);
        assert.equal(await evaluate("document.querySelector('#annualTargetsStaffForm').hidden"),false);
        assert.equal(await evaluate("document.querySelector('#annualTargetsHistoricalDisable').hidden"),true);
        assert.deepEqual(await evaluate("window.qaErrors"),[]);
        await evaluate("Pages['annual-targets'].destroy()");
        await open("admin-users");
        await evaluate("document.querySelector('#userTableBody tr').click()");
        await delay(100);
        assert.equal(await evaluate("document.querySelector('#adminUsersHistoryPanel').hidden"), false);
        assert.equal(await evaluate("document.querySelectorAll('#adminUsersHistoryRows tr').length"), 1);
        await evaluate("document.querySelector('#adminUsersHistoryFrom').value='2026-02-01';document.querySelector('#adminUsersHistoryForm').requestSubmit()");
        await delay(150);
        assert.equal(await evaluate("document.querySelectorAll('#adminUsersHistoryRows tr').length"), 2);
        await evaluate("document.querySelector('#adminUsersHistoryRows tr:last-child button').click();document.querySelector('#adminUsersHistoryDept').selectedIndex=2;document.querySelector('#adminUsersHistoryForm').requestSubmit()");
        await delay(150);
        assert.equal(await evaluate("apiCalls.find(call=>call.method==='PUT').body.versionToken"), "v2");
        await screenshot("employee-history");
        await evaluate("document.querySelector('#adminUsersHistoryFrom').value='2026-03-01';document.querySelector('#adminUsersHistoryFrom').dispatchEvent(new Event('input',{bubbles:true}));window.confirmResult=false;document.querySelector('#newUserButton').click()");
        await delay(20);
        assert.equal(await evaluate("document.querySelector('#userId').value"), "1");
        assert.equal(await evaluate("Pages['admin-users'].beforeLeave()"), false);
        await evaluate("window.confirmResult=true;document.querySelector('#adminUsersHistoryNew').click()");
        await delay(20);
        await evaluate("document.querySelector('#adminUsersHistoryRows tr:last-child button:last-child').click()");
        await delay(150);
        assert.equal(await evaluate("document.querySelectorAll('#adminUsersHistoryRows tr').length"), 1);
        assert.deepEqual(await evaluate("window.qaErrors"), []);
        await evaluate("Pages['admin-users'].destroy()");
        console.log("Browser checks passed: direct menu init and cached activation with null/omitted routeContext, detail links, compact dashboard and KPI layout, overload summaries, normal split allocations, annual goals and costs, history, closing and mobile.");
        await send("Browser.close");
    } finally {
        socket?.close();
        browser.kill();
        await new Promise((resolve) => server.close(resolve));
        for (let i = 0; i < 30 && browser.exitCode === null; i++) await delay(100);
        const resolvedProfile = fs.realpathSync(profile);
        const resolvedTemp = fs.realpathSync(os.tmpdir());
        if (path.dirname(resolvedProfile).toLowerCase() === resolvedTemp.toLowerCase()
            && path.basename(resolvedProfile).startsWith("init-members-ui-")) {
            try { fs.rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
            catch { console.warn("Browser profile remains in temporary storage:", resolvedProfile); }
        }
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
