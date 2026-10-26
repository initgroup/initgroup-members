"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {test}=require("node:test");
const window={};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../../frontend/js/common.js"),"utf8"),{window,Map,Set,Intl,Date,AbortController,document:{addEventListener(){},querySelectorAll(){return [];},getElementById(){return null;}}});
const {groupOverloads,monthList}=window.Common.workload;

test("a person with four excessive months gets one summary and normal shared months are excluded",()=>{
    const rows=[1,4,5,6].map(m=>({workerKey:"USER:1",employeeName:"홍길동",month:`2026-${String(m).padStart(2,"0")}`,totalMm:1.2}));
    rows.push({workerKey:"USER:1",employeeName:"홍길동",month:"2026-02",totalMm:1});
    const people=groupOverloads(rows);
    assert.equal(people.length,1);assert.equal(people[0].months.length,4);
    assert.equal(monthList(people[0].months),"1월, 4월, 5월, 6월");
});

test("two distinct workers with identical names remain two boxes and repeated month rows do not inflate counts",()=>{
    const people=groupOverloads([
        {workerKey:"USER:1",employeeName:"동명이인",month:"2026-01",totalMm:1.1},
        {workerKey:"USER:1",employeeName:"동명이인",month:"2026-01",totalMm:1.1},
        {workerKey:"COMPANY_EMPLOYEE:1",employeeName:"동명이인",month:"2026-01",totalMm:1.2}
    ]);
    assert.equal(people.length,2);assert.ok(people.every(person=>person.months.length===1));
});

test("the whole people list is retained and months spanning years are unambiguous",()=>{
    const rows=Array.from({length:13},(_,i)=>({workerKey:`USER:${i+1}`,employeeName:`Worker ${i+1}`,month:"2026-01",totalMm:1.2}));
    assert.equal(groupOverloads(rows).length,13);
    assert.equal(monthList(["2027-01","2026-01"]),"2026년 1월, 2027년 1월");
});
