"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(repoRoot, "frontend/pages/home.html"), "utf8");
const scripts = ["common.js", "home.js"].map((name) => ({
    name,
    source: fs.readFileSync(path.join(repoRoot, "frontend/js", name), "utf8")
}));

class Element {
    constructor(tagName = "div") {
        this.tagName = tagName;
        this.children = [];
        this.listeners = new Map();
        this.value = "";
        this._text = "";
        const classes = new Set();
        this.classList = {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name)),
            contains: (name) => classes.has(name),
            toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
        };
        const properties = new Map();
        this.style = { setProperty: (name,value)=>properties.set(name,value), getPropertyValue: (name)=>properties.get(name) };
    }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); return child; }
    replaceChildren(...children) { this._text = ""; this.children = [...children]; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(type, callback, options = {}) {
        const listeners = this.listeners.get(type) || [];
        listeners.push({ callback, signal: options.signal });
        this.listeners.set(type, listeners);
    }
    async dispatch(type) {
        for (const listener of this.listeners.get(type) || []) {
            if (!listener.signal?.aborted) await listener.callback({ target: this });
        }
    }
}

function salesForYear(year,goal="1200",firstSales="1000") {
    const amount=BigInt(goal||0),q=amount/12n,r=amount%12n;
    return Array.from({length:12},(_,i)=>({month:`${year}-${String(i+1).padStart(2,"0")}`,salesAmount:i?"0":firstSales,cumulativeSalesAmount:firstSales,
        targetReference:goal==null?null:String(q+(BigInt(i)<r?1n:0n)),cumulativeTargetReference:goal==null?null:String(q*BigInt(i+1)+(BigInt(i+1)<r?BigInt(i+1):r))}));
}

function dataForYear(year) {
    return {
        planYear: year,
        annualTrend:[year-2,year-1,year].map((value,index)=>({year:value,closed:index===0,targetRecorded:true,revenueRecorded:true,missingRevenueCount:0,revenueBasis:"PROJECT_YEAR",targetAmount:"1200",salesAmount:String(800+index*100),netProfit:index===1?"-100":"200"})),
        annualPerformance:{revenueBasis:"PROJECT_YEAR",summary:{targetAmount:"1200",salesAmount:"1000"},missingRevenue:[],projects:[{projectId:7,name:"Project",status:"CONTRACTED",salesAmount:"1000"}]},
        generatedAt: new Date().toISOString(),
        projectSummary: { projectCount: 7, bidTargetCount: 0, awardedCount: 7, orderAmountVat: "12000000000", contractAmountVat: "2236757952" },
        workforce: { internalCount: 32, partnerCount: 3 },
        financials: {
            confirmed: { monthlySales:salesForYear(year),summary: { targetAmount:"1200", assignmentCount: 1, totalSalesAmount: "1000", totalCostAmount: "800", laborCostAmount: "800", otherCost: "0", operatingProfit: "200" } },
            planning: { monthlySales:salesForYear(year,null,"0"),summary: { assignmentCount: 0, totalSalesAmount: "0", totalCostAmount:"0", operatingProfit: "0" } },
            warnings: []
        },
        scenario: { scenarioName: "Empty draft", statusCode: "DRAFT", projects: [], summary: { totalSalesAmount: "0" }, warnings: [] },
        decisionProjects: [],
        schemaWarnings: [],
        notices: [1, 2].map((noticeId) => ({ noticeId, title: `Notice ${noticeId}`, content: "Text", attachments: [] }))
    };
}

function createHarness(responder = dataForYear) {
    const nodes = new Map([...html.matchAll(/<([a-z0-9]+)[^>]*\bid="([^"]+)"/gi)]
        .map((match) => [`#${match[2]}`, new Element(match[1])]));
    const requests = [];
    let navigation=null;
    const root = { querySelector: (selector) => nodes.get(selector) || null };
    const context = vm.createContext({
        AbortController, Date, Intl, Node: Element,
        document: {
            createElement: (tagName) => new Element(tagName),
            addEventListener() {},
            querySelectorAll: () => [],
            getElementById: () => null
        },
        Pages: {},
        App: { getUser: () => ({ userName: "Admin" }), isAdmin: () => true, navigate: (page,options)=>{navigation={page,...options};} },
        fetch: async (url, options) => {
            requests.push({ url, options });
            const year = Number(new URL(url, "http://localhost").searchParams.get("planYear"));
            const data = await responder(year);
            return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ status: "success", data }) };
        }
    });
    context.window = context;
    scripts.forEach(({ name, source }) => vm.runInContext(source, context, { filename: name }));
    let detailModel = null;
    context.Common.ui.createDetailDialog = () => ({ open(model) { detailModel = model; }, close() {}, destroy() {}, isOpen() { return false; } });
    return { page: context.Pages.home, root, requests, node: (id) => nodes.get(`#${id}`), details: () => detailModel, navigation:()=>navigation };
}

test("registered annual financials populate home with an empty legacy plan",async()=>{
    const h=createHarness();await h.page.init({root:h.root});
    assert.equal(h.node("homeYearSelect").value,String(new Date().getFullYear()));
    assert.match(h.node("homeWeightedAward").textContent,/2,236,757,952원/);
    assert.equal(h.node("homePlannedSales").textContent,"1,000원");
    assert.equal(h.node("homeOperatingProfit").textContent,"200원");
    assert.equal(h.node("homeAnnualGoal").textContent,"1,200원");
    assert.equal(h.node("homeAnnualFinancialBody"),undefined);h.page.destroy();
});

test("annual report preserves exact large amounts and ignores legacy plan money",async()=>{
    const h=createHarness(year=>({...dataForYear(year),scenario:{summary:{totalSalesAmount:"123"}},financials:{...dataForYear(year).financials,
        confirmed:{summary:{totalSalesAmount:"999999999999999999",totalCostAmount:"800000000000000000",laborCostAmount:"799999999999999899",otherCost:"101",operatingProfit:"199999999999999999",assignmentCount:1}}}}));
    await h.page.init({root:h.root});
    assert.equal(h.node("homePlannedSales").textContent,"999,999,999,999,999,999원");
    assert.equal(h.node("homeOperatingProfit").textContent,"199,999,999,999,999,999원");
    assert.equal(h.node("homeOtherCost").textContent,"101원");h.page.destroy();
});

test("home exposes annual revenue without monthly and planning switches",async()=>{
    const h=createHarness();await h.page.init({root:h.root});
    assert.equal(h.node("homeMonthlySalesView"),undefined);assert.equal(h.node("homePlanningViewButton"),undefined);
    assert.equal(h.node("homeAnnualRevenueChart").children.length,3);
    assert.match(h.node("homeAnnualRevenueBody").textContent,/1,000원/);h.page.destroy();
});

test("reactivation reloads the selected year and annual results",async()=>{
    let count=0;const h=createHarness(year=>{count++;return {...dataForYear(year),financials:{...dataForYear(year).financials,confirmed:{summary:{totalSalesAmount:String(count),totalCostAmount:"0",operatingProfit:String(count),assignmentCount:1}}}};});
    await h.page.init({root:h.root});h.node("homeYearSelect").value="2027";await h.page.activate();
    assert.match(h.requests.at(-1).url,/planYear=2027/);assert.equal(h.node("homePlannedSales").textContent,"2원");h.page.destroy();
});

test("returning from a person's detail keeps its requested year on a new or cached home page",async()=>{
    const h=createHarness();await h.page.init({root:h.root,routeContext:{planYear:2024}});
    assert.equal(h.node("homeYearSelect").value,"2024");assert.match(h.requests.at(-1).url,/planYear=2024/);
    await h.page.activate({routeContext:{planYear:2027}});
    assert.equal(h.node("homeYearSelect").value,"2027");assert.match(h.requests.at(-1).url,/planYear=2027/);
    h.page.destroy();
});

test("failed refresh shows unavailable annual data and can recover",async()=>{
    let failed=false;const h=createHarness(year=>{if(failed)throw new Error("Refresh failed");return dataForYear(year);});
    await h.page.init({root:h.root});failed=true;await h.page.activate();
    assert.equal(h.node("homePlannedSales").textContent,"—");assert.match(h.node("homeStatus").textContent,/Refresh failed/);
    failed=false;await h.page.activate();assert.equal(h.node("homePlannedSales").textContent,"1,000원");h.page.destroy();
});

test("yearly company cost without assignments produces a single annual loss",async()=>{
    const h=createHarness(year=>({...dataForYear(year),annualPerformance:{targetSaved:true,summary:{targetAmount:"1560",salesAmount:"0"},targetBreakdown:{staffAmount:"1200",departmentExtra:"120",companyExtra:"240"}},
        financials:{...dataForYear(year).financials,confirmed:{summary:{assignmentCount:0,totalSalesAmount:"0",laborCostAmount:"0",otherCost:"101",totalCostAmount:"101",operatingProfit:"-101",targetAmount:"1560"}}}}));
    await h.page.init({root:h.root});
    assert.equal(h.node("homeStaffTarget").textContent,"1,200원");
    assert.equal(h.node("homeDepartmentTarget").textContent,"120원");
    assert.equal(h.node("homeCompanyTarget").textContent,"240원");
    assert.equal(h.node("homeOperatingProfit").textContent,"-101원");
    assert.equal(h.node("homeOtherCost").textContent,"101원");
    assert.match(h.node("homeAnnualGoalDetail").textContent,/0.0%/);h.page.destroy();
});

test("optional missing worker rates never trigger the main revenue reminder",async()=>{
    const h=createHarness(year=>{const data=dataForYear(year);data.financials.confirmed.summary.zeroSalesPriceCount=32;return data;});
    await h.page.init({root:h.root});assert.equal(h.node("homeFinancialDetailsButton").hidden,true);
    assert.doesNotMatch(h.node("homeSalesDetail").textContent,/단가/);h.page.destroy();
});

test("annual figures are consolidated in KPI cards without duplicate panels",()=>{
    assert.ok(!html.includes('id="homeAnnualFinancialBody"'));
    assert.ok(!html.includes('homeAnnualTargetSummary'));
    assert.ok(!html.includes('homeBidTargetCount'));
    assert.ok(html.includes('id="homeStaffTarget"'));
    assert.ok(html.includes('id="homeAnnualRevenueChart"'));
    assert.ok(!html.includes('id="homeCumulativeSalesView"'));
});


test("risk count opens the people detail page and each person card identifies the worker",async()=>{
    const warning={type:"OVER_CAPACITY",workerKey:"USER:1",employeeName:"Test",month:"2026-01",totalMm:2,capacityMm:1,overloadMm:1,projectCount:1,
        reasons:["같은 프로젝트의 2개 투입 행 합계가 2 M/M으로 가용 1 M/M을 초과합니다."],allocations:[{projectName:"Project",phase:"confirmed",mm:1,assignmentId:1},{projectName:"Project",phase:"confirmed",mm:1,assignmentId:2}]};
    const h=createHarness(year=>({...dataForYear(year),financials:{...dataForYear(year).financials,warnings:[warning]}}));
    await h.page.init({root:h.root});await h.node("homeRiskCount").dispatch("click");
    assert.equal(h.node("homeRiskCount").textContent,"1명");
    assert.equal(h.navigation().page,"workforce-load-detail");
    await h.node("homeRiskList").children[0].children[0].dispatch("click");
    assert.equal(h.navigation().context.workerKey,"USER:1");h.page.destroy();
});

test("four exceeded months are one person card while normal split months do not alert",async()=>{
    const warnings=[1,4,5,6].map(month=>({workerKey:"USER:1",employeeName:"홍길동",month:`2026-${String(month).padStart(2,"0")}`,totalMm:1.2}));
    warnings.push({workerKey:"USER:2",employeeName:"정상",month:"2026-01",totalMm:1,type:"MULTI_PROJECT"});
    const h=createHarness(year=>({...dataForYear(year),financials:{...dataForYear(year).financials,warnings}}));
    await h.page.init({root:h.root});
    assert.equal(h.node("homeRiskList").children.length,1);
    assert.match(h.node("homeRiskList").textContent,/홍길동 · 총 4개월 초과투입/);
    assert.match(h.node("homeRiskList").textContent,/1월, 4월, 5월, 6월/);
    h.page.destroy();
});

test("KPI links keep the selected year and open the matching detail scope",async()=>{
    const h=createHarness();await h.page.init({root:h.root});
    h.node("homeYearSelect").value="2027";
    const cases=[
        ["homeAnnualGoal","annual-targets","view","staff"],["homePlannedSales","annual-targets","view","projects"],
        ["homeOperatingProfit","annual-targets","view","company"],["homeStaffTarget","annual-targets","view","staff"],
        ["homeDepartmentTarget","annual-targets","view","department-extra"],["homeCompanyTarget","annual-targets","view","company-extra"],
        ["homeWeightedAward","admin-projects","statusCode","POST_CONTRACT"],["homeAssignmentCount","workforce-management","phase","confirmed"],
        ["homeShortageCount","workforce-management","phase","planning"]
    ];
    for (const [id,page,key,scope] of cases) {
        await h.node(id).dispatch("click");assert.equal(h.navigation().page,page);
        assert.equal(h.navigation().context.planYear,2027);assert.equal(h.navigation().context[key],scope);
    }
    h.page.destroy();
});

test("three annual groups share a signed scale and open the clicked year's detail",async()=>{
    const h=createHarness();await h.page.init({root:h.root});
    const columns=h.node("homeAnnualRevenueChart").children;
    assert.equal(columns.length,3);
    const target=columns[2].children[0].children[0],sales=columns[2].children[0].children[1],loss=columns[1].children[0].children[2];
    assert.ok(parseFloat(target.style.getPropertyValue("--trend-height"))>parseFloat(sales.style.getPropertyValue("--trend-height")));
    assert.equal(loss.style.getPropertyValue("--trend-bottom"),"0%");assert.ok(loss.className.includes("is-loss"));
    await target.dispatch("click");assert.equal(h.navigation().context.view,"staff");assert.equal(h.navigation().context.planYear,new Date().getFullYear());
    await loss.dispatch("click");assert.equal(h.navigation().context.view,"company");assert.equal(h.navigation().context.planYear,new Date().getFullYear()-1);
    assert.match(h.node("homeAnnualTrendBody").textContent,/-100원/);h.page.destroy();
});

test("missing revenue is marked separately from an explicitly saved zero",async()=>{
    const h=createHarness(year=>{const data=dataForYear(year);data.annualTrend[0].revenueRecorded=false;data.annualTrend[1].salesAmount="0";return data;});
    await h.page.init({root:h.root});
    const groups=h.node("homeAnnualRevenueChart").children;
    assert.ok(groups[0].children[0].children[1].className.includes("is-unregistered"));
    assert.ok(!groups[1].children[0].children[1].className.includes("is-unregistered"));
    assert.match(h.node("homeAnnualTrendBody").textContent,/미등록/);assert.match(h.node("homeAnnualTrendBody").textContent,/0원/);h.page.destroy();
});

test("missing project revenue opens the matching fiscal year without a write",async()=>{
    const h=createHarness(year=>{const data=dataForYear(year);data.annualPerformance.missingRevenue=[{projectId:7,projectName:"Project",year,reason:"매출 발생 후 입력하세요."}];return data;});
    await h.page.init({root:h.root});assert.equal(h.node("homeFinancialDetailsButton").hidden,false);
    assert.match(h.node("homeSalesDetail").textContent,/매출 미등록 1개/);
    await h.node("homeFinancialDetailsButton").dispatch("click");h.details().groups[0].actions[0].run();
    assert.equal(h.navigation().page,"admin-projects");assert.equal(h.navigation().context.projectId,7);
    assert.equal(h.navigation().context.view,"revenue");assert.equal(h.navigation().context.planYear,new Date().getFullYear());
    assert.ok(h.requests.every(({options})=>options.method==="GET"));h.page.destroy();
});

test("past totals open the retrospective editor and unknown profit never becomes zero",async()=>{
    const h=createHarness(year=>{
        const data=dataForYear(year);data.annualTrend[0]={...data.annualTrend[0],revenueBasis:"HISTORICAL_TOTALS",historicalAvailable:true,profitRecorded:false,netProfit:null};return data;
    });
    await h.page.init({root:h.root});await h.node("homeHistoricalTotalsButton").dispatch("click");
    assert.equal(h.navigation().context.view,"historical");assert.equal(h.navigation().context.planYear,new Date().getFullYear()-1);
    const first=h.node("homeAnnualRevenueChart").children[0].children[0];
    assert.ok(first.children[2].className.includes("is-unregistered"));
    await first.children[1].dispatch("click");assert.equal(h.navigation().context.view,"historical");
    assert.equal(h.navigation().context.planYear,new Date().getFullYear()-2);
    assert.match(h.node("homeAnnualTrendBody").textContent,/소급 총액/);assert.match(h.node("homeAnnualTrendBody").textContent,/미입력/);h.page.destroy();
});
