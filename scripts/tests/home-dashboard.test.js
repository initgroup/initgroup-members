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
        this.style = { setProperty() {} };
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

function dataForYear(year) {
    return {
        planYear: year,
        generatedAt: new Date().toISOString(),
        projectSummary: { projectCount: 7, bidTargetCount: 0, awardedCount: 7, contractAmountVat: "2236757952" },
        workforce: { internalCount: 32, partnerCount: 3 },
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
        App: { getUser: () => ({ userName: "Admin" }), isAdmin: () => true },
        fetch: async (url, options) => {
            requests.push({ url, options });
            const year = Number(new URL(url, "http://localhost").searchParams.get("planYear"));
            const data = await responder(year);
            return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ status: "success", data }) };
        }
    });
    context.window = context;
    scripts.forEach(({ name, source }) => vm.runInContext(source, context, { filename: name }));
    return { page: context.Pages.home, root, requests, node: (id) => nodes.get(`#${id}`) };
}

test("current year and empty draft retain registered contracts, workforce and notices", async () => {
    const h = createHarness();
    await h.page.init({ root: h.root });
    assert.equal(h.node("homeYearSelect").value, String(new Date().getFullYear()));
    assert.match(h.requests[0].url, new RegExp(`planYear=${new Date().getFullYear()}$`));
    assert.equal(h.node("homeStatus").textContent, "");
    assert.match(h.node("homeProjectCountDetail").textContent, /7건/);
    assert.equal(h.node("homeAwardLabel").textContent, "등록 수주액");
    assert.equal(h.node("homeWeightedAward").textContent, "2,236,757,952원");
    assert.equal(h.node("homePlannedSales").textContent, "2,236,757,952원");
    assert.equal(h.node("homeOperatingProfit").textContent, "—");
    assert.equal(h.node("homeAssignmentCount").textContent, "—");
    assert.equal(h.node("homeWorkforceTotal").textContent, "35명");
    assert.equal(h.node("homeNoticeSummary").textContent, "2건");
    assert.match(h.node("homeMonthlyPlan").textContent, /사업과 인력 배치를 저장/);
    h.page.destroy();
});

test("missing scenario also retains registered contracts", async () => {
    const h = createHarness((year) => ({ ...dataForYear(year), scenario: null }));
    await h.page.init({ root: h.root });
    assert.equal(h.node("homeWeightedAward").textContent, "2,236,757,952원");
    assert.match(h.node("homeScenarioBadge").textContent, /계획안 없음/);
    h.page.destroy();
});

test("saved planning data keeps precise amounts and monthly chart", async () => {
    const h = createHarness((year) => ({
        ...dataForYear(year),
        scenario: {
            scenarioName: "Saved draft", statusCode: "DRAFT",
            projects: [{ expectedContractAmount: "999999999999999999", winProbability: 100, bidDecisionCode: "BID" }],
            summary: { totalSalesAmount: "999999999999999999", operatingProfit: "199999999999999999", assignmentCount: 2 },
            monthlyFinancials: [{ month: `${year}-01`, salesAmount: "999999999999999999", costAmount: "800000000000000000", operatingProfit: "199999999999999999" }],
            warnings: []
        }
    }));
    await h.page.init({ root: h.root });
    assert.equal(h.node("homeAwardLabel").textContent, "가중 예상수주");
    assert.equal(h.node("homePlannedSales").textContent, "999,999,999,999,999,999원");
    assert.equal(h.node("homeWeightedAward").textContent, "999,999,999,999,999,999원");
    assert.equal(h.node("homeOperatingProfit").textContent, "199,999,999,999,999,999원");
    assert.equal(h.node("homeAssignmentCount").textContent, "2");
    assert.equal(h.node("homeMonthlyPlan").children.length, 12);
    h.page.destroy();
});

test("an intentionally skipped plan remains zero", async () => {
    const h = createHarness((year) => ({
        ...dataForYear(year),
        scenario: { projects: [{ bidDecisionCode: "SKIP", expectedContractAmount: "1000", winProbability: 100 }], summary: { totalSalesAmount: "0" }, warnings: [] }
    }));
    await h.page.init({ root: h.root });
    assert.equal(h.node("homeWeightedAward").textContent, "0원");
    assert.equal(h.node("homePlannedSales").textContent, "0원");
    h.page.destroy();
});

test("reactivation reloads the selected year and updated results", async () => {
    let contractAmountVat = "100";
    const h = createHarness((year) => ({ ...dataForYear(year), projectSummary: { contractAmountVat } }));
    await h.page.init({ root: h.root });
    const selectedYear = new Date().getFullYear() + 1;
    h.node("homeYearSelect").value = String(selectedYear);
    await h.node("homeYearSelect").dispatch("change");
    contractAmountVat = "200";
    await h.page.activate();
    assert.equal(h.requests.length, 3);
    assert.match(h.requests[2].url, new RegExp(`planYear=${selectedYear}$`));
    assert.equal(h.node("homeWeightedAward").textContent, "200원");
    h.page.destroy();
    assert.ok(h.requests[2].options.signal.aborted);
    await h.node("homeRefreshButton").dispatch("click");
    assert.equal(h.requests.length, 3);
});

test("failed refresh shows unavailable data and can recover", async () => {
    let fail = false;
    const h = createHarness((year) => {
        if (fail) throw new Error("조회 오류");
        return dataForYear(year);
    });
    await h.page.init({ root: h.root });
    fail = true;
    await h.node("homeRefreshButton").dispatch("click");
    assert.equal(h.node("homeWeightedAward").textContent, "—");
    assert.equal(h.node("homeWorkforceTotal").textContent, "—");
    assert.equal(h.node("homeNoticeSummary").textContent, "—");
    assert.equal(h.node("homeStatus").textContent, "조회 오류");
    assert.ok(h.node("homeStatus").classList.contains("is-error"));
    assert.equal(h.node("homeRiskList").children[0].tagName, "li");
    fail = false;
    await h.node("homeRefreshButton").dispatch("click");
    assert.equal(h.node("homeStatus").textContent, "");
    assert.equal(h.node("homeWeightedAward").textContent, "2,236,757,952원");
    h.page.destroy();
});
