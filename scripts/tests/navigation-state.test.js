"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {test}=require("node:test");
const source=fs.readFileSync(path.join(__dirname,"../../frontend/js/app.js"),"utf8");
const start=source.indexOf("    function updateNavigationState(");
const end=source.indexOf("    function markPageVisited(",start);
assert.ok(start>=0 && end>start);
const update=source.slice(start,end);

test("hidden detail highlights its parent location and clears it when returning home",()=>{
    const links=["home","workforce-management","admin-projects"].map(page=>({dataset:{page},attrs:new Map(),
        setAttribute(name,value){this.attrs.set(name,value);},removeAttribute(name){this.attrs.delete(name);}}));
    const context=vm.createContext({document:{getElementById:()=>({querySelectorAll:()=>links})},
        getPage:code=>code==="workforce-load-detail"?{parentPage:"workforce-management"}:{},visitedPages:new Set(["home","workforce-management"])});
    vm.runInContext(update+'\nupdateNavigationState("workforce-load-detail");',context);
    assert.equal(links[1].attrs.get("aria-current"),"location");
    assert.equal(links[0].attrs.has("aria-current"),false);
    vm.runInContext('updateNavigationState("home");',context);
    assert.equal(links[0].attrs.get("aria-current"),"page");
    assert.equal(links[1].attrs.has("aria-current"),false);
});
