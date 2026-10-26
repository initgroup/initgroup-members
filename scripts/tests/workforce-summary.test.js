"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function harness() {
    const source = fs.readFileSync(path.join(__dirname, "../../frontend/js/workforce-management.js"), "utf8");
    const context = vm.createContext({
        window: {},
        Common: { data: { pick: (row, ...keys) => keys.map((key) => row?.[key]).find((value) => value !== undefined) } }
    });
    vm.runInContext(source.replace("    window.Pages = window.Pages || {};", `
        window.summaryTest = {
            projectMonthSummary, departmentMonthSummary, departmentPeriodSummary, departmentGroups, allocationState,
            laneCategory, assignmentStatusCode, allLanes, loadDetailGroups, workerMonthlyCapacity, assignmentHasOverlap,
            configure(options = {}) {
                departments = options.departments || [];
                references = {workers: options.workers || [], actualCapacity: []};
                boardBasis = options.boardBasis || "project-status";
                confirmedData = options.confirmed || { projects: [], assignments: [] };
                scenario = options.scenario || null;
                editRemovals = new Map((options.removals || []).map((id) => [id, true]));
            }
        };
        window.Pages = window.Pages || {};
    `), context);
    return context.window.summaryTest;
}

test("project summary follows project status, counts distinct people and ignores zero and pending removals", () => {
    const h = harness();
    h.configure({ removals: ["confirmed:4"] });
    const lane = { type: "confirmed", key: "confirmed:1", status: "CONTRACTED" };
    const assignments = [
        { assignmentId: 1, workerKey: "USER:1", monthlyAllocations: [{ month: "2026-01", mm: 0.5 }] },
        { assignmentId: 2, workerKey: "USER:1", assignmentStatusCode: "PLANNED", monthlyAllocations: [{ month: "2026-01", mm: 0.25 }] },
        { assignmentId: 3, workerKey: "USER:2", monthlyAllocations: [{ month: "2026-01", mm: 0 }, { month: "2026-02", mm: 1 }] },
        { assignmentId: 4, workerKey: "USER:3", monthlyAllocations: [{ month: "2026-01", mm: 1 }] }
    ];
    const capacity = new Map([["USER:1|2026-01", { totalMm: 1.25 }]]);
    const result = h.projectMonthSummary(lane, assignments, ["2026-01"], capacity);
    const january = result.get("2026-01");
    assert.equal(january.workers.size, 1);
    assert.equal(january.confirmed, 0.75);
    assert.equal(january.planned, 0);
    assert.equal(january.overloaded.size, 1);
    assert.equal(result.size, 1);
    lane.status = "BIDDING";
    const beforeContract = h.projectMonthSummary(lane, assignments, ["2026-01"], capacity).get("2026-01");
    assert.equal(beforeContract.confirmed, 0);
    assert.equal(beforeContract.planned, 0.75);
});

test("default ledger uses project stages, excludes cancellation and retains optional legacy reference", () => {
    const h = harness();
    const confirmed = { projects: ["PLANNED", "BIDDING", "CONTRACTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map((statusCode, i) => ({ projectId: i + 1, statusCode })), assignments: [] };
    const scenario = { projects: [{ projectId: 1, scenarioProjectId: 10, assignments: [] }] };
    h.configure({ confirmed, scenario });
    const lanes = h.allLanes();
    assert.equal(lanes.length, 5);
    assert.equal(lanes.filter((lane) => h.laneCategory(lane) === "confirmed").length, 3);
    assert.equal(lanes.filter((lane) => h.laneCategory(lane) === "planning").length, 2);
    assert.equal(h.assignmentStatusCode(lanes[1], { assignmentStatusCode: "CONFIRMED" }), "PLANNED");
    assert.equal(h.assignmentStatusCode(lanes[2], { assignmentStatusCode: "PLANNED" }), "CONFIRMED");
    h.configure({ confirmed, scenario, boardBasis: "legacy-scenario" });
    assert.equal(h.allLanes().length, 6);
});

test("department availability uses all projects and employment window, without netting away overload", () => {
    const h = harness();
    const workers = [
        { workerKey: "USER:1" },
        { workerKey: "USER:2" },
        { workerKey: "USER:3", availableStartDate: "2026-02-01" }
    ];
    const shown = new Map([["USER:1|2026-01", { totalMm: 0.5 }]]);
    const all = new Map([["USER:1|2026-01", { totalMm: 1.5 }], ["USER:2|2026-01", { totalMm: 0.25 }]]);
    const result = h.departmentMonthSummary(workers, "2026-01", shown, all);
    assert.equal(result.assigned, 1);
    assert.equal(result.mm, 0.5);
    assert.equal(result.available, 0.75);
    assert.equal(result.overloaded, 1);
});

test("department codes, canonical order, unknown departments and partner companies remain separate", () => {
    const h = harness();
    h.configure({ departments: [
        { code: "APP", label: "APP사업부", displayOrder: 20 },
        { code: "DATA", label: "데이터사업부", displayOrder: 10 }
    ] });
    const groups = h.departmentGroups([
        { workerKey: "USER:1", departmentCode: "APP", departmentName: "Old name" },
        { workerKey: "USER:2", departmentName: "데이터사업부" },
        { workerKey: "USER:3" },
        { workerKey: "COMPANY_EMPLOYEE:1", departmentCode: "APP", companyName: "Partner" }
    ]);
    assert.equal(groups.length, 4);
    assert.equal(groups[0].label, "데이터사업부");
    assert.equal(groups[1].label, "APP사업부");
    assert.equal(groups[2].label, "부서 미지정");
    assert.equal(groups[3].label, "협력업체 · Partner");
});

test("allocation state aggregates repeated placements for a worker in one project", () => {
    const h = harness();
    const lane = { key: "confirmed:1", type: "confirmed", projectId: 1, name: "Project", assignments: [
        { assignmentId: 1, workerKey: "USER:1", monthlyAllocations: [{ month: "2026-01", mm: 0.6 }] },
        { assignmentId: 2, workerKey: "USER:1", monthlyAllocations: [{ month: "2026-01", mm: 0.6 }] }
    ] };
    const { capacity } = h.allocationState([lane]);
    assert.equal(capacity.get("USER:1|2026-01").totalMm, 1.2);
    assert.equal(capacity.get("USER:1|2026-01").projects.size, 1);
    assert.equal(capacity.get("USER:1|2026-01").projects.get("confirmed:1").type, "planning");
    lane.status = "CONTRACTED";
    assert.equal(h.allocationState([lane]).capacity.get("USER:1|2026-01").projects.get("confirmed:1").type, "confirmed");
});

test("department period summary deduplicates people and projects and respects period, removals and hidden workload", () => {
    const h = harness();
    h.configure({ removals: ["confirmed:2"] });
    const workers = [{ workerKey: "USER:1" }, { workerKey: "USER:2" }, { workerKey: "USER:3", availableStartDate: "2026-02-01" }];
    const assignment = (id, worker, allocations) => ({ assignmentId: id, planAssignmentId: id, workerKey: worker, monthlyAllocations: allocations.map(([month, mm]) => ({ month, mm })) });
    const lanes = [
        { type: "confirmed", key: "confirmed:10", projectId: 10, assignments: [
            assignment(1, "USER:1", [["2026-01", 0.5], ["2026-02", 0.5]]),
            assignment(2, "USER:2", [["2026-01", 1], ["2026-02", 1]])
        ] },
        { type: "planning", key: "planning:10", projectId: 10, assignments: [assignment(3, "USER:1", [["2026-01", 0.25], ["2026-02", 0.25]])] },
        { type: "confirmed", key: "confirmed:20", projectId: 20, assignments: [assignment(4, "USER:2", [["2026-01", 0.5]])] },
        { type: "confirmed", key: "confirmed:30", projectId: 30, assignments: [assignment(5, "USER:1", [["2027-01", 1]])] },
        { type: "confirmed", key: "confirmed:40", projectId: 40, assignments: [assignment(6, "USER:9", [["2026-01", 1]])] },
        { type: "confirmed", key: "confirmed:50", projectId: 50, assignments: [assignment(7, "USER:1", [["2026-01", 0]])] }
    ];
    const { capacity: shown } = h.allocationState(lanes);
    const all = new Map(shown);
    all.set("USER:1|2026-01", { totalMm: 1.25 });
    all.set("USER:1|2026-02", { totalMm: 1.5 });
    const result = h.departmentPeriodSummary(workers, ["2026-01", "2026-02"], lanes, shown, all);
    assert.equal(result.assigned, 2);
    assert.equal(result.projectCount, 2);
    assert.equal(result.totalMm, 2);
    assert.equal(result.availableMm, 2.5);
    assert.equal(result.overloaded, 1);
    assert.equal(result.overloadedMonths, 2);
    assert.equal(result.monthly.size, 2);
    assert.equal(result.monthly.get("2026-01").mm + result.monthly.get("2026-02").mm, result.totalMm);
});

test("department with no assignments retains available capacity without inventing project counts", () => {
    const h = harness();
    const result = h.departmentPeriodSummary([{ workerKey: "USER:1" }], ["2026-01", "2026-02"], [], new Map(), new Map());
    assert.equal(result.assigned, 0);
    assert.equal(result.projectCount, 0);
    assert.equal(result.totalMm, 0);
    assert.equal(result.availableMm, 2);
    assert.equal(result.overloaded, 0);
    assert.equal(result.overloadedMonths, 0);
});


test("split placements of 0.5 plus 0.5 are normal even across hidden projects",()=>{
    const h=harness();
    const a=(id,p,mm)=>({assignmentId:id,projectId:p,workerKey:"USER:1",employeeName:"Test",assignmentStartDate:"2026-01-01",assignmentEndDate:"2026-01-31",monthlyAllocations:[{month:"2026-01",mm}]});
    h.configure({confirmed:{projects:[{projectId:1,projectName:"Shown",statusCode:"CONTRACTED"},{projectId:2,projectName:"Hidden",statusCode:"BIDDING"}],assignments:[a(1,1,0.5),a(2,2,0.5)]},workers:[{workerKey:"USER:1",employeeName:"Test"}]});
    const groups=h.loadDetailGroups({workerKeys:["USER:1"],months:["2026-01"],scopeLanes:[h.allLanes()[0]]});
    assert.equal(groups.length,1);assert.equal(groups[0].severity,"info");
    assert.match(groups[0].reasons.join(" "),/정상 분할 투입/);
    assert.match(groups[0].reasons.join(" "),/숨겨진 프로젝트/);
    assert.equal(groups[0].rows[1].at(-1),"필터 밖 포함");
    const lanes=h.allLanes(),state=h.allocationState(lanes);
    assert.equal(state.warnings.length,0);
    assert.equal(h.loadDetailGroups({workerKeys:["USER:1"],months:["2026-01"],onlyWarnings:true}).length,0);
    assert.equal(h.assignmentHasOverlap(lanes[0].assignments[0],lanes[0],state.capacity),false);
});

test("same-project repeated rows explain overload and availability window zero",()=>{
    const h=harness();const row=(id)=>({assignmentId:id,projectId:1,workerKey:"USER:1",employeeName:"Test",monthlyAllocations:[{month:"2026-01",mm:0.6}]});
    h.configure({confirmed:{projects:[{projectId:1,projectName:"Project",statusCode:"CONTRACTED"}],assignments:[row(1),row(2)]},workers:[{workerKey:"USER:1",employeeName:"Test",availableStartDate:"2026-02-01"}]});
    const groups=h.loadDetailGroups({workerKeys:["USER:1"],months:["2026-01"],onlyWarnings:true});
    assert.equal(groups[0].severity,"danger");assert.match(groups[0].reasons.join(" "),/가용량이 0/);
    assert.match(groups[0].reasons.join(" "),/같은 프로젝트의 여러 배치 행/);
    assert.equal(groups[0].rows.length,2);
    const state=h.allocationState(h.allLanes());assert.equal(state.warnings.length,1);
    h.configure({removals:["confirmed:2"],confirmed:{projects:[{projectId:1,projectName:"Project",statusCode:"CONTRACTED"}],assignments:[row(1),row(2)]}});
    assert.equal(h.loadDetailGroups({workerKeys:["USER:1"],months:["2026-01"],onlyWarnings:true}).length,0);
});

test("zero-MM placements do not create a duplicate warning or appear as contributing rows",()=>{
    const h=harness();
    h.configure({confirmed:{projects:[{projectId:1,statusCode:"CONTRACTED"},{projectId:2,statusCode:"BIDDING"}],assignments:[
        {assignmentId:1,projectId:1,workerKey:"USER:1",monthlyAllocations:[{month:"2026-01",mm:1}]},
        {assignmentId:2,projectId:2,workerKey:"USER:1",monthlyAllocations:[{month:"2026-01",mm:0}]}
    ]}});
    assert.equal(h.allocationState(h.allLanes()).warnings.length,0);
    const groups=h.loadDetailGroups({workerKeys:["USER:1"],months:["2026-01"]});
    assert.equal(groups[0].rows.length,1);
    assert.equal(groups[0].facts.find(([key])=>key==="프로젝트")[1],"1개");
});

test("detail reasons retain hundredth-MM excess instead of displaying zero overload",()=>{
    const h=harness();
    h.configure({confirmed:{projects:[{projectId:1,statusCode:"CONTRACTED"}],assignments:[0.51,0.5].map((mm,i)=>({assignmentId:i+1,projectId:1,workerKey:"USER:1",monthlyAllocations:[{month:"2026-01",mm}]}))}});
    const [group]=h.loadDetailGroups({workerKeys:["USER:1"],months:["2026-01"],onlyWarnings:true});
    assert.match(group.reasons[0],/1.01 M\/M.*0.01 M\/M 초과/);
    assert.equal(group.facts.find(([key])=>key==="초과량")[1],"0.01 M/M");
});
