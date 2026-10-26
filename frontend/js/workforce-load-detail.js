(function() {
    "use strict";
    let root=null,controller=null,contentController=null,route={},requestId=0,loadedYear=null;
    const query=(selector)=>root?.querySelector(selector);
    const el=(tag,options={},children=[])=>Common.dom.element(tag,options,children);
    const mm=(value)=>Number(value || 0).toLocaleString("ko-KR",{minimumFractionDigits:1,maximumFractionDigits:4});

    function navigationYear() {
        const year=Number(query("#workforceLoadDetailYear").value);
        return Number.isInteger(year) && year>=1900 && year<=2100 ? year : loadedYear || new Date().getFullYear();
    }

    function returnPage() { return route.returnPage==="home" ? "home" : "workforce-management"; }

    function updateLocation(person=null) {
        const labels={home:"경영 현황","workforce-management":"사업·인력 관리"};
        const origin=labels[route.returnPage];
        query("#workforceLoadDetailOrigin").textContent=`${origin ? `${origin}에서 이동` : "사업·인력 관리의 상세 화면"} · ${navigationYear()}년`;
        query("#workforceLoadDetailBack").textContent=returnPage()==="home" ? "← 경영 현황으로 돌아가기" : "← 사업·인력 관리로 돌아가기";
        query("#workforceLoadDetailCurrent").textContent=route.workerKey ? person?.employeeName || "인력 상세" : "초과투입 인력";
        query("#workforceLoadDetailOverview").hidden=!route.workerKey;
        query("#workforceLoadDetailPersonSeparator").hidden=!route.workerKey;
    }

    function openPerson(person) {
        route={...route,workerKey:person.workerKey};
        load();
    }

    function showOverview() {
        route={...route,workerKey:null};
        load();
    }

    function render(people) {
        contentController?.abort();contentController=new AbortController();
        const summary=query("#workforceLoadDetailSummary"),list=query("#workforceLoadDetailPeople"),months=query("#workforceLoadDetailMonths");
        summary.replaceChildren();list.replaceChildren();months.replaceChildren();
        const person=route.workerKey ? people.find((item)=>item.workerKey===route.workerKey) : null;
        updateLocation(person);
        query("#workforceLoadDetailAll").hidden=!route.workerKey;
        query("#workforceLoadDetailAll").textContent=route.projectId ? "조회 프로젝트의 초과 인력" : "전체 초과투입 인력";
        if (!route.workerKey) {
            summary.append(el("h3",{text:`${loadedYear}년 · 초과투입 ${people.length}명`}),el("p",{text:"인력별로 한 번씩 표시합니다. 인력을 선택하면 해당 인력의 모든 초과 월과 원인 배치를 볼 수 있습니다."}));
            if (!people.length) summary.appendChild(el("p",{text:"월 합계 1 M/M을 초과한 인력이 없습니다."}));
            people.forEach((item)=>{
                const button=el("button",{type:"button",className:"workforce-management-alert-item is-high"},[
                    el("div",{},[el("strong",{text:`${item.employeeName} · 총 ${item.months.length}개월 초과투입`}),
                        el("span",{text:Common.workload.monthList(item.months)}),el("span",{text:`최고 ${mm(item.peakMm)} M/M · 상세 →`})])]);
                button.addEventListener("click",()=>openPerson(item),{signal:contentController.signal});
                list.appendChild(el("li",{className:"workforce-management-alert-entry"},[button]));
            });
            return;
        }
        if (!person) {
            summary.append(el("h3",{text:`${loadedYear}년 · 초과투입 없음`}),el("p",{text:"해당 인력의 저장된 투입에는 월 합계 1 M/M 초과 내역이 없습니다. 변경 중인 투입은 저장 후 다시 조회하세요."}));
            return;
        }
        summary.append(el("h3",{text:`${person.employeeName} · 총 ${person.months.length}개월 초과투입`}),
            el("p",{text:Common.workload.monthList(person.months)}),
            el("p",{text:`최고 월 투입 ${mm(person.peakMm)} M/M · 최대 초과량 ${mm(person.peakMm-1)} M/M · 중복 판정 기준 1.0 M/M`}));
        person.warnings.forEach((warning,index)=>{
            const details=el("details",{className:"panel workforce-load-detail-month"});details.open=index===0;
            details.appendChild(el("summary",{text:`${Number(warning.month.slice(5))}월 · 총 ${mm(warning.totalMm)} M/M · ${mm(warning.totalMm-1)} M/M 초과`}));
            const reasons=el("ul",{className:"detail-layer-reasons"});
            (warning.reasons || [`월 합계가 1 M/M을 ${mm(warning.totalMm-1)} M/M 초과했습니다.`]).forEach((text)=>reasons.appendChild(el("li",{text})));
            details.appendChild(reasons);
            const head=el("tr");["프로젝트","구분","투입기간","해당 월 M/M","배치"].forEach((text)=>head.appendChild(el("th",{text,attrs:{scope:"col"}})));
            const body=el("tbody");
            (warning.allocations || []).forEach((assignment)=>{
                const row=el("tr");
                [assignment.projectName,assignment.phase==="confirmed"?"확정":"계획",`${String(assignment.startDate || "—").slice(0,10)} ~ ${String(assignment.endDate || "—").slice(0,10)}`,`${mm(assignment.mm)} M/M`]
                    .forEach((text)=>row.appendChild(el("td",{text})));
                const action=el("td");
                if (assignment.assignmentId) {
                    const button=el("button",{type:"button",className:"button button-secondary button-small",text:`#${assignment.assignmentId} 설정`});
                    button.addEventListener("click",()=>App.navigate("workforce-management",{context:{planYear:loadedYear,projectId:assignment.projectId,assignmentId:assignment.assignmentId,priceField:"allocation"}}),{signal:contentController.signal});
                    action.appendChild(button);
                }
                row.appendChild(action);body.appendChild(row);
            });
            details.appendChild(el("div",{className:"table-wrap"},[el("table",{className:"data-table"},[el("thead",{},[head]),body])]));
            months.appendChild(details);
        });
    }

    async function load() {
        const year=Number(query("#workforceLoadDetailYear").value);
        if (!Number.isInteger(year) || year<1900 || year>2100) return;
        const id=++requestId;query("#workforceLoadDetailRefresh").disabled=true;
        updateLocation();
        Common.ui.setInlineStatus(query("#workforceLoadDetailStatus"),"저장된 투입을 조회하고 있습니다.");
        try {
            const payload=await Common.api.request(`/home/dashboard?planYear=${year}`,{signal:controller.signal,showLoading:false});
            if (!root || id!==requestId) return;
            const data=Common.data.get(payload);
            if (!data?.financials) throw new Error("투입정보를 조회하지 못했습니다. 다시 조회해 주세요.");
            const warnings=(data.financials.warnings || []).filter((warning)=>!route.projectId || (warning.allocations || []).some((a)=>String(a.projectId)===String(route.projectId)));
            loadedYear=year;render(Common.workload.groupOverloads(warnings));
            Common.ui.setInlineStatus(query("#workforceLoadDetailStatus"),`${year}년 저장된 투입 기준입니다.${route.projectId ? " 선택 프로젝트가 포함된 초과 월을 표시하며 월별 투입량은 전체 프로젝트를 합산합니다." : ""}`);
        } catch (error) {
            if (!root || id!==requestId || error.name==="AbortError") return;
            contentController?.abort();
            ["#workforceLoadDetailSummary","#workforceLoadDetailPeople","#workforceLoadDetailMonths"].forEach((selector)=>query(selector).replaceChildren());
            Common.ui.setInlineStatus(query("#workforceLoadDetailStatus"),error.message || "조회하지 못했습니다.","error");
        } finally {if (root && id===requestId) query("#workforceLoadDetailRefresh").disabled=false;}
    }

    window.Pages=window.Pages || {};
    window.Pages["workforce-load-detail"]={
        async init(context) {
            root=context.root;controller=new AbortController();route=context.routeContext || {};loadedYear=null;
            query("#workforceLoadDetailYear").value=route.planYear || new Date().getFullYear();
            query("#workforceLoadDetailForm").addEventListener("submit",(event)=>{event.preventDefault();load();},{signal:controller.signal});
            query("#workforceLoadDetailBack").addEventListener("click",()=>App.navigate(returnPage(),{context:{planYear:navigationYear(),projectId:route.projectId}}),{signal:controller.signal});
            query("#workforceLoadDetailParent").addEventListener("click",()=>App.navigate("workforce-management",{context:{planYear:navigationYear(),projectId:route.projectId}}),{signal:controller.signal});
            query("#workforceLoadDetailOverview").addEventListener("click",showOverview,{signal:controller.signal});
            query("#workforceLoadDetailAll").addEventListener("click",showOverview,{signal:controller.signal});
            await load();
        },
        async activate(context={}) {
            route=context.routeContext || {};
            query("#workforceLoadDetailYear").value=route.planYear || query("#workforceLoadDetailYear").value;
            await load();
        },
        beforeLeave(){return true;},
        destroy(){requestId++;controller?.abort();contentController?.abort();root=null;controller=null;contentController=null;route={};loadedYear=null;}
    };
})();
