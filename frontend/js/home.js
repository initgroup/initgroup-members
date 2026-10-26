(function() {
    "use strict";

    let controller = null;
    let root = null;
    let dashboardRequestId = 0;
    let dashboardData = null;
    let detailLayer = null;
    let kpiObserver = null;
    let kpiFrame = 0;

    function fitKpiAmounts() {
        if (!root?.querySelectorAll || typeof requestAnimationFrame !== "function") return;
        if (kpiFrame) cancelAnimationFrame(kpiFrame);
        kpiFrame=requestAnimationFrame(()=>{
            kpiFrame=0;
            if (!root) return;
            root.querySelectorAll(".executive-kpi-card > .executive-kpi-value, .executive-kpi-card > strong, .executive-kpi-breakdown dd").forEach((node)=>{
                node.style.fontSize="";
                const width=node.clientWidth;
                if (width>0 && node.scrollWidth>width) {
                    const size=parseFloat(getComputedStyle(node).fontSize);
                    node.style.fontSize=`${Math.max(9,Math.floor(size*width/node.scrollWidth*0.97))}px`;
                }
                node.title=node.textContent;
            });
            root.querySelectorAll(".executive-kpi-card small").forEach((node)=>{node.title=node.textContent;});
        });
    }

    function openWorkforceBoard(phase = null) {
        App.navigate("workforce-management", {
            context: { planYear: Number(query("#homeYearSelect").value), ...(["confirmed","planning"].includes(phase) ? { phase } : {}) }
        });
    }

    function openAnnualDetails(view, year = null) {
        App.navigate("annual-targets", { context: { planYear: year ?? Number(query("#homeYearSelect").value), view } });
    }

    function openProjectList(statusCode) {
        App.navigate("admin-projects", { context: { planYear: Number(query("#homeYearSelect").value), statusCode } });
    }

    function openProjectRevenue(projectId) {
        App.navigate("admin-projects",{context:{projectId,planYear:Number(query("#homeYearSelect").value),view:"revenue"}});
    }
    function openFinancialIssues() {
        const missing=dashboardData?.annualPerformance?.missingRevenue || [];
        detailLayer.open({title:"연간 매출 미등록 프로젝트",description:"매출이 발생한 프로젝트는 해당 결산연도의 VAT 포함 매출 합계를 입력하세요. 발생 전이라면 미등록으로 둘 수 있습니다.",
            groups:missing.map(issue=>({title:issue.projectName,reasons:[issue.reason],facts:[["결산연도",`${issue.year}년`]],
                actions:[{key:`revenue-${issue.projectId}`,label:`${issue.year}년 매출 입력`,run:()=>openProjectRevenue(issue.projectId)}]}))});
    }

    function query(selector) {
        return root?.querySelector(selector) || null;
    }

    function pick(source, ...keys) {
        return Common.data.pick(source, ...keys);
    }

    function formattedNumber(value) {
        const numeric = Number(value || 0);
        return Number.isFinite(numeric) ? numeric.toLocaleString("ko-KR") : "0";
    }

    function noticeValue(notice, ...keys) {
        return pick(notice, ...keys);
    }

    function renderAttachments(container, notice) {
        const files = noticeValue(notice, "files", "FILES", "attachments", "ATTACHMENTS") || [];
        if (!Array.isArray(files) || files.length === 0) return;

        files.forEach((file) => {
            const fileId = noticeValue(file, "fileId", "FILE_ID", "id", "ID");
            if (!fileId) return;
            const fileName = noticeValue(file, "fileName", "FILE_NAME", "name", "NAME") || "첨부 파일";
            const button = Common.dom.element("button", {
                className: "attachment-button",
                text: `첨부 · ${fileName}`,
                type: "button"
            });
            button.addEventListener("click", () => {
                Common.api.download(`/home/notice-files/${encodeURIComponent(fileId)}/download`, fileName)
                    .catch((error) => Common.ui.toast(error.message || "첨부 파일을 내려받지 못했습니다.", "error"));
            }, { signal: controller.signal });
            container.appendChild(button);
        });
    }

    function renderNotices(notices) {
        const list = query("#homeNoticeList");
        Common.dom.clear(list);
        const rows = Array.isArray(notices) ? notices : [];
        query("#homeNoticeSummary").textContent = `${formattedNumber(rows.length)}건`;
        if (!rows.length) {
            list.appendChild(Common.dom.element("div", {
                className: "empty-state dashboard-empty-state",
                text: "게시된 공지사항이 없습니다."
            }));
            return;
        }

        rows.forEach((notice, index) => {
            const details = Common.dom.element("details", { className: "notice-card" });
            if (index === 0) details.open = true;

            const summary = Common.dom.element("summary");
            const title = Common.dom.element("span", {
                text: noticeValue(notice, "title", "TITLE") || "제목 없음"
            });
            const metaText = Common.format.dateTime(
                noticeValue(notice, "postStartAt", "POST_START_AT", "createdAt", "CREATED_AT")
            );
            summary.appendChild(title);
            if (metaText && metaText !== "-") {
                summary.appendChild(Common.dom.element("span", {
                    className: "notice-meta",
                    text: metaText
                }));
            }

            const body = Common.dom.element("div", { className: "notice-body" });
            body.appendChild(Common.dom.element("p", {
                className: "notice-content",
                text: noticeValue(notice, "content", "CONTENT") || ""
            }));
            const attachments = Common.dom.element("div", { className: "attachment-list" });
            renderAttachments(attachments, notice);
            body.appendChild(attachments);
            details.append(summary, body);
            list.appendChild(details);
        });
    }

    function integerAmount(value) {
        const text = String(value ?? "0").trim();
        try {
            return BigInt(/^-?\d+$/.test(text) ? text : String(Math.round(Number(text) || 0)));
        } catch (_error) {
            return 0n;
        }
    }

    function money(value) {
        return `${integerAmount(value).toLocaleString("ko-KR")}원`;
    }

    function profitRate(profit, sales) {
        const denominator = integerAmount(sales);
        if (denominator === 0n) return 0;
        return Number(integerAmount(profit) * 10000n / denominator) / 100;
    }

    function emptyState(text, tagName = "div") {
        return Common.dom.element(tagName, {
            className: "empty-state dashboard-empty-state",
            text
        });
    }

    function renderAnnualRevenue() {
        const chart=query("#homeAnnualRevenueChart"),body=query("#homeAnnualRevenueBody"),trendBody=query("#homeAnnualTrendBody");Common.dom.clear(chart);Common.dom.clear(body);Common.dom.clear(trendBody);
        const annual=dashboardData.annualPerformance,summary=annual?.summary;
        if (!summary) {query("#homeAnnualRevenueDetails").hidden=true;chart.appendChild(emptyState("연간 매출을 조회할 수 없습니다. 새로고침해 주세요."));return;}
        query("#homeAnnualRevenueDetails").hidden=false;
        const trend=dashboardData.annualTrend || [];
        const metrics=[{key:"targetAmount",flag:"targetRecorded",label:"연간 목표",style:"target",view:"staff"},
            {key:"salesAmount",flag:"revenueRecorded",label:"매출",style:"sales",view:"projects"},
            {key:"netProfit",flag:"profitRecorded",label:"관리 순이익",style:"profit",view:"company"}];
        const recorded=(year,metric)=>Boolean(year[metric.flag] ?? year.revenueRecorded);
        const amounts=trend.flatMap(year=>metrics.filter(metric=>recorded(year,metric)).map(metric=>integerAmount(year[metric.key])));
        const positive=amounts.reduce((a,b)=>b>a?b:a,0n),negative=amounts.reduce((a,b)=>b<a?b:a,0n);
        const range=(positive-negative)*11n/10n || 1n;
        const percent=value=>`${Number(value*10000n/range)/100}%`;
        const zero=percent(-negative);
        trend.forEach(year=>{
            const column=Common.dom.element("div",{className:"executive-trend-year",attrs:{"data-trend-year":year.year}});
            const bars=Common.dom.element("div",{className:"executive-trend-bars"});bars.style.setProperty("--trend-zero",zero);
            metrics.forEach((metric,index)=>{
                const known=recorded(year,metric),amount=known?integerAmount(year[metric.key]):0n;
                const description=known?money(amount):metric.style==="target"?"미설정":metric.style==="profit"?"순이익 미입력":"매출 미등록";
                const button=Common.dom.element("button",{type:"button",className:`executive-trend-bar is-${metric.style}${amount<0n?" is-loss":""}${known?"":" is-unregistered"}`,
                    attrs:{title:`${year.year}년 ${metric.label} ${description}${year.missingRevenueCount?` · 매출 ${year.missingRevenueCount}개 프로젝트 미등록`:""}`,"aria-label":`${year.year}년 ${metric.label} ${description} · 상세 열기`,"data-trend-metric":metric.style}});
                button.style.setProperty("--trend-height",percent(amount<0n?-amount:amount));
                button.style.setProperty("--trend-bottom",percent(-negative+(amount<0n?amount:0n)));
                button.style.setProperty("--trend-left",`${12+index*27}%`);
                button.addEventListener("click",()=>openAnnualDetails(year.revenueBasis==="HISTORICAL_TOTALS" || (!year.revenueRecorded && year.historicalAvailable)?"historical":metric.view,year.year),{signal:controller.signal});bars.appendChild(button);
            });
            bars.appendChild(Common.dom.element("small",{className:"executive-trend-zero",text:"0"}));
            const state=year.revenueBasis==="HISTORICAL_TOTALS"?`소급 총액${year.closed?" · 마감":""}`:year.closed?"마감":year.year===new Date().getFullYear()?"집계 중":"미마감";
            column.append(bars,Common.dom.element("span",{text:`${year.year}년 · ${state}`}));chart.appendChild(column);
            const row=Common.dom.element("tr");
            [year.year,year.targetRecorded?money(year.targetAmount):"미설정",year.revenueRecorded?money(year.salesAmount):"미등록",
                year.revenueRecorded&&year.targetRecorded&&integerAmount(year.targetAmount)>0n?`${profitRate(year.salesAmount,year.targetAmount).toFixed(1)}%`:"—",
                (year.profitRecorded ?? year.revenueRecorded)?money(year.netProfit):"미입력",`${state}${year.missingRevenueCount?` · 매출 ${year.missingRevenueCount}개 미등록`:""}${year.revenueBasis==="LEGACY_WORKER_RATE"?" · 당시 집계 기준":""}`]
                .forEach(text=>row.appendChild(Common.dom.element("td",{text})));trendBody.appendChild(row);
        });
        if (!trend.length) chart.appendChild(emptyState("최근 3년 자료를 조회할 수 없습니다. 새로고침해 주세요."));
        query("#homeAnnualRevenueDescription").textContent=trend.length?`${trend[0].year}–${trend.at(-1).year}년 · VAT 포함`:"연간 자료 조회 필요";
        (annual.projects || []).filter(p=>["CONTRACTED","IN_PROGRESS","COMPLETED"].includes(p.status)).forEach(project=>{
            const row=Common.dom.element("tr"),button=Common.dom.element("button",{type:"button",className:"button button-secondary button-small",text:"매출 입력"});
            button.addEventListener("click",()=>openProjectRevenue(project.projectId),{signal:controller.signal});
            const missing=(annual.missingRevenue || []).some(item=>Number(item.projectId)===Number(project.projectId));
            row.append(Common.dom.element("td",{text:project.name}),Common.dom.element("td",{text:missing?"미등록":money(project.salesAmount)}),Common.dom.element("td",{},[button]));body.appendChild(row);
        });

    }

    function openWorkerLoadDetail(workerKey = null) {
        App.navigate("workforce-load-detail",{context:{planYear:Number(query("#homeYearSelect").value),workerKey,returnPage:"home"}});
    }

    function projectDecisionGroups(projects) {
        const status={PLANNED:"계획",BIDDING:"입찰",CONTRACTED:"계약",IN_PROGRESS:"진행",COMPLETED:"완료",CANCELLED:"취소"};
        return projects.map((project)=>({title:project.projectName || "사업명 미정",reasons:[
            ["PLANNED","BIDDING"].includes(project.statusCode)?`현재 ${status[project.statusCode]} 단계이며 선택 연도와 수행기간이 겹치므로 수주 확정 전 검토 대상에 포함됩니다.`:`현재 단계는 ${status[project.statusCode] || "확인 필요"}입니다. 원본 프로젝트에서 진행상태와 검토 필요 여부를 확인해 주세요.`],
            facts:[["발주처",project.customerName || "미지정"],["수행기간",`${project.projectStartDate || "—"} ~ ${project.projectEndDate || "—"}`],
                ["발주금액",money(project.orderAmountVat)],["당사 수주금액",money(project.contractAmountVat)]]}));
    }

    function openDecisionDetails(projects) {
        detailLayer.open({title:"검토 대상 프로젝트 상세",description:"사업·입찰 관리 원본의 진행단계와 수행기간을 기준으로 선정합니다.",groups:projectDecisionGroups(projects),
            actions:projects.length===1?[{key:"project",label:"사업·입찰 관리에서 열기",run:()=>App.navigate("admin-projects",{context:{projectId:projects[0].projectId}})}]:[]});
    }

    function renderRisks(scenario) {
        const list=query("#homeRiskList");Common.dom.clear(list);
        const people=Common.workload.groupOverloads(scenario?.warnings || []);
        query("#homeRiskCount").textContent=`${formattedNumber(people.length)}명`;
        query("#homeRiskCount").disabled=!people.length;
        if (!scenario) {list.appendChild(emptyState("등록 투입 정보를 조회할 수 없습니다.","li"));return;}
        if (!people.length) {list.appendChild(emptyState("월 합계 1 M/M을 초과한 인력이 없습니다. 0.5 + 0.5 투입은 정상입니다.","li"));return;}
        people.forEach((person)=>{
            const item=Common.dom.element("li");
            const button=Common.dom.element("button",{type:"button",className:"executive-risk-item is-capacity"});
            button.append(Common.dom.element("strong",{text:`${person.employeeName} · 총 ${person.months.length}개월 초과투입`}),
                Common.dom.element("span",{text:Common.workload.monthList(person.months)}),
                Common.dom.element("span",{text:`최고 월 투입 ${person.peakMm.toLocaleString("ko-KR",{maximumFractionDigits:4})} M/M · ${person.projectNames.join(" / ")}`}),
                Common.dom.element("span",{text:"인력별 초과투입 상세 →"}));
            button.addEventListener("click",()=>openWorkerLoadDetail(person.workerKey),{signal:controller.signal});
            item.appendChild(button);list.appendChild(item);
        });
    }

    function renderDecisions(projects) {
        const list = query("#homeDecisionList");
        Common.dom.clear(list);
        const rows = Array.isArray(projects) ? projects : [];
        query("#homeDecisionCount").textContent = `${formattedNumber(rows.length)}건`;
        query("#homeDecisionCount").disabled = !rows.length;
        if (!rows.length) {
            list.appendChild(emptyState("입찰 판단이 필요한 사업이 없습니다."));
            return;
        }
        rows.forEach((project) => {
            const item = Common.dom.element("article", { className: "executive-decision-item" });
            const heading = Common.dom.element("div");
            heading.append(
                Common.dom.element("span", {
                    className: `executive-project-status is-${String(project.statusCode || "planned").toLowerCase()}`,
                    text: project.statusCode === "BIDDING" ? "입찰 중" : "검토"
                }),
                Common.dom.element("strong", { text: project.projectName || "사업명 미정" })
            );
            item.append(
                heading,
                Common.dom.element("span", { text: project.customerName || "발주처 미정" }),
                Common.dom.element("b", { text: money(project.orderAmountVat) })
            );
            const button = Common.dom.element("button", { className: "button button-secondary button-small", text: "검토 사유·상세", type: "button" });
            button.addEventListener("click", () => openDecisionDetails([project]), { signal: controller.signal });
            item.appendChild(button);
            list.appendChild(item);
        });
    }

    function renderWorkforce(workforce, available) {
        const container = query("#homeWorkforceComposition");
        Common.dom.clear(container);
        const rows = [
            ["내부 임직원", Number(workforce?.internalCount || 0), "internal"],
            ["협력업체 인력", Number(workforce?.partnerCount || 0), "partner"]
        ];
        const total = rows.reduce((sum, item) => sum + item[1], 0);
        query("#homeWorkforceTotal").textContent = `${formattedNumber(total)}명`;
        rows.forEach(([label, count, type]) => {
            const row = Common.dom.element("div", { className: "executive-workforce-row" });
            const heading = Common.dom.element("div");
            heading.append(
                Common.dom.element("span", { text: label }),
                Common.dom.element("strong", { text: `${formattedNumber(count)}명` })
            );
            const track = Common.dom.element("span", { className: "executive-workforce-track" });
            const bar = Common.dom.element("i", { className: `is-${type}` });
            bar.style.setProperty("--workforce-width", `${total ? count / total * 100 : 0}%`);
            track.appendChild(bar);
            row.append(heading, track);
            container.appendChild(row);
        });
        if (!available) {
            container.appendChild(Common.dom.element("p", {
                className: "executive-inline-warning",
                text: "협력업체·외부인력 스키마 적용 후 전체 인력 구성을 확인할 수 있습니다."
            }));
        }
    }

    function renderSchemaWarnings(warnings) {
        const container = query("#homeSchemaWarnings");
        Common.dom.clear(container);
        const rows = Array.isArray(warnings) ? warnings : [];
        container.hidden = !rows.length;
        rows.forEach((warning) => {
            container.appendChild(Common.dom.element("p", {
                text: `${warning} database/INIT_SYSTEM_ALT.sql 적용이 필요합니다.`
            }));
        });
    }

    function renderFinancialSection() {
        if (!dashboardData) return;
        const missing=dashboardData.annualPerformance?.missingRevenue || [];
        const button=query("#homeFinancialDetailsButton");button.hidden=!missing.length;
        button.textContent=`매출 미등록 ${formattedNumber(missing.length)}건`;
        button.setAttribute("aria-label",`${formattedNumber(missing.length)}개 프로젝트 연간 매출 입력`);
        Common.ui.setInlineStatus(query("#homeFinancialNotice"),missing.length?"매출 발생 후 연간 합계를 입력하세요. 미등록 프로젝트는 합계에서 제외됩니다.":"");
        renderAnnualRevenue();
    }

    function renderDashboard(data) {
        dashboardData = data;
        const projectSummary = data.projectSummary || {};
        const annual = data.annualPerformance;
        const confirmed = data.financials?.confirmed?.summary;
        const planning = data.financials?.planning?.summary;
        const sales = confirmed?.totalSalesAmount;
        const profit = confirmed?.operatingProfit;
        const target=annual?.summary?.targetAmount ?? confirmed?.targetAmount;
        query("#homeAnnualGoal").textContent = target == null ? "—" : annual?.targetSaved === false ? "미설정" : money(target);
        query("#homeAnnualGoalDetail").textContent = integerAmount(target) ? `달성률 ${profitRate(sales,target).toFixed(1)}%` : "목표 미설정";
        const breakdown=annual?.targetBreakdown;
        query("#homeStaffTarget").textContent=breakdown ? money(breakdown.staffAmount) : "—";
        query("#homeDepartmentTarget").textContent=breakdown ? money(breakdown.departmentExtra) : "—";
        query("#homeCompanyTarget").textContent=breakdown ? money(breakdown.companyExtra) : "—";
        query("#homeLaborCost").textContent=confirmed?.costBreakdownAvailable===false?"상세 없음":confirmed ? money(confirmed.laborCostAmount ?? (integerAmount(confirmed.totalCostAmount)-integerAmount(confirmed.otherCost))) : "—";
        query("#homeOtherCost").textContent=confirmed?.costBreakdownAvailable===false?"상세 없음":confirmed ? money(confirmed.otherCost) : "—";
        const workforce = data.workforce || {};
        const availableWorkforce = Number(workforce.internalCount || 0)
            + Number(workforce.partnerCount || 0);



        query("#homeAwardLabel").textContent = "확정 수주금액";
        query("#homeWeightedAward").textContent = money(projectSummary.contractAmountVat);
        query("#homeAwardDetail").textContent = `확정 ${formattedNumber(projectSummary.awardedCount || 0)}건 · VAT 포함`;
        query("#homeSalesLabel").textContent = annual?.revenueBasis==="HISTORICAL_TOTALS"?"과거 회사 매출 총액":"연간 프로젝트 매출";
        query("#homePlannedSales").textContent = confirmed ? money(sales) : "—";
        const missing=annual?.missingRevenue || [];
        query("#homeSalesDetail").textContent=annual?.revenueBasis==="HISTORICAL_TOTALS"?"과거 소급 · VAT 포함":missing.length?`매출 미등록 ${missing.length}개 프로젝트`:"결산연도 기준 · VAT 포함";
        query("#homeSalesDetail").classList.toggle("is-incomplete",Boolean(missing.length));
        query("#homeOperatingProfit").textContent = confirmed ? profit==null?"미입력":money(profit) : "—";
        query("#homeProfitRate").textContent=annual?.revenueBasis==="HISTORICAL_TOTALS"?profit==null?"과거 소급 · 순이익 미입력":"과거 소급 · 입력한 순이익 기준":confirmed?`이익률 ${profitRate(profit,sales).toFixed(1)}% · 입력 원가·비용 기준`:"연간 자료 조회 필요";
        query("#homeProfitRate").classList.remove("is-incomplete");
        query("#homeAssignmentCount").textContent = confirmed ? `${formattedNumber(confirmed.assignmentCount)}건` : "—";
        query("#homeShortageCount").textContent = planning ? `${formattedNumber(planning.assignmentCount)}건` : "—";
        query("#homeWorkforceDetail").textContent = `등록 인력 ${formattedNumber(availableWorkforce)}명 · 가용 상세`;
        query("#homeScenarioBadge").textContent = `${data.planYear}년 · ${annual?.revenueBasis==="HISTORICAL_TOTALS"?"과거 총액 소급":"프로젝트 진행상태 기준"}`;
        query("#homeScenarioBadge").classList.toggle("is-empty", !confirmed);
        query("#homeUpdatedAt").textContent = `${new Intl.DateTimeFormat("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }).format(new Date(data.generatedAt || Date.now()))} 기준`;

        renderFinancialSection();
        renderRisks(data.financials);
        renderDecisions(data.decisionProjects);
        renderWorkforce(workforce, data.companySchemaAvailable !== false);
        renderSchemaWarnings(data.schemaWarnings);
        renderNotices(data.notices);
        fitKpiAmounts();
    }

    function renderDashboardError() {
        dashboardData = null;
        query("#homeRiskCount").disabled = true;
        query("#homeDecisionCount").disabled = true;

        Common.ui.setInlineStatus(query("#homeFinancialNotice"), "");
        query("#homeFinancialDetailsButton").hidden = true;


        Common.dom.clear(query("#homeAnnualRevenueBody"));
        Common.dom.clear(query("#homeAnnualTrendBody"));

        query("#homeAnnualRevenueDetails").hidden = true;
        query("#homeAnnualRevenueDescription").textContent = "매출 자료를 조회하지 못했습니다.";
        [
            "#homeAnnualGoal", "#homeStaffTarget", "#homeDepartmentTarget", "#homeCompanyTarget", "#homeLaborCost", "#homeOtherCost", "#homeWeightedAward", "#homePlannedSales",
            "#homeOperatingProfit", "#homeAssignmentCount", "#homeShortageCount",
            "#homeRiskCount", "#homeDecisionCount", "#homeWorkforceTotal", "#homeNoticeSummary"
        ].forEach((selector) => { query(selector).textContent = "—"; });
        [
            "#homeAnnualGoalDetail", "#homeAwardDetail", "#homeSalesDetail",
            "#homeProfitRate", "#homeWorkforceDetail", "#homeScenarioBadge", "#homeUpdatedAt"
        ].forEach((selector) => { query(selector).textContent = "조회 실패"; });
        [
            "#homeAnnualRevenueChart", "#homeRiskList", "#homeDecisionList",
            "#homeWorkforceComposition", "#homeNoticeList"
        ].forEach((selector) => {
            const container = query(selector);
            Common.dom.clear(container);
            container.appendChild(emptyState("데이터를 불러오지 못했습니다. 새로고침해 주세요.", selector === "#homeRiskList" ? "li" : "div"));
        });
        renderSchemaWarnings([]);
    }

    async function loadDashboard() {
        detailLayer?.close();
        const requestId = ++dashboardRequestId;
        const status = query("#homeStatus");
        const planYear = Number(query("#homeYearSelect").value);
        Common.ui.setInlineStatus(status, `${planYear}년 경영 현황을 불러오고 있습니다.`);
        try {
            const payload = await Common.api.request(`/home/dashboard?planYear=${encodeURIComponent(planYear)}`, {
                method: "GET",
                signal: controller.signal,
                showLoading: false
            });
            if (requestId !== dashboardRequestId) return;
            renderDashboard(Common.data.get(payload) || {});
            Common.ui.setInlineStatus(status, "");
        } catch (error) {
            if (error?.name === "AbortError" || requestId !== dashboardRequestId) return;
            renderDashboardError();
            Common.ui.setInlineStatus(status, error.message || "경영 현황을 불러오지 못했습니다.", "error");
        }
    }

    function initializeYears(preferredYear) {
        const select = query("#homeYearSelect");
        const requestedYear=Number(preferredYear);
        const currentYear = Number.isInteger(requestedYear) && requestedYear>=1900 && requestedYear<=2100 ? requestedYear : new Date().getFullYear();
        for (let year = Math.max(1900,currentYear - 1); year <= Math.min(2100,currentYear + 4); year += 1) {
            const option = document.createElement("option");
            option.value = String(year);
            option.textContent = `${year}년`;
            select.appendChild(option);
        }
        select.value = String(currentYear);
    }

    window.Pages.home = {
        async init(context) {
            root = context.root;
            controller = new AbortController();
            detailLayer = Common.ui.createDetailDialog({root,prefix:"homeRiskDetail",signal:controller.signal});
            if (typeof ResizeObserver === "function") {
                kpiObserver=new ResizeObserver(fitKpiAmounts);
                kpiObserver.observe(query(".executive-kpi-grid"));
            }
            query("#homeRiskCount").addEventListener("click",()=>openWorkerLoadDetail(),{signal:controller.signal});
            query("#homeDecisionCount").addEventListener("click",()=>openDecisionDetails(dashboardData?.decisionProjects || []),{signal:controller.signal});

            if (!App.isAdmin()) throw new Error("관리자 권한이 필요합니다.");

            initializeYears(context.routeContext?.planYear);
            query("#homeYearSelect").addEventListener("change", loadDashboard, { signal: controller.signal });
            query("#homeRefreshButton").addEventListener("click", loadDashboard, { signal: controller.signal });
            query("#homeOpenPlanningButton").addEventListener("click", openWorkforceBoard, { signal: controller.signal });

            query("#homeFinancialDetailsButton").addEventListener("click",openFinancialIssues,{signal:controller.signal});
            query("#homeHistoricalTotalsButton").addEventListener("click",()=>openAnnualDetails("historical",Math.max(1900,Math.min(Number(query("#homeYearSelect").value),new Date().getFullYear()-1))),{signal:controller.signal});
            [["homeAnnualGoal",()=>openAnnualDetails("staff")],["homeStaffTarget",()=>openAnnualDetails("staff")],
                ["homeDepartmentTarget",()=>openAnnualDetails("department-extra")],["homeCompanyTarget",()=>openAnnualDetails("company-extra")],
                ["homeWeightedAward",()=>openProjectList("POST_CONTRACT")],["homePlannedSales",()=>openAnnualDetails("projects")],
                ["homeOperatingProfit",()=>openAnnualDetails("company")],["homeAssignmentCount",()=>openWorkforceBoard("confirmed")],
                ["homeShortageCount",()=>openWorkforceBoard("planning")]].forEach(([id,handler])=>query(`#${id}`).addEventListener("click",handler,{signal:controller.signal}));
            await loadDashboard();
        },

        async beforeLeave() { detailLayer?.close(); return true; },

        async activate(context = {}) {
            if (!root) return;
            const year=Number(context.routeContext?.planYear);
            if (Number.isInteger(year) && year>=1900 && year<=2100) {
                const select=query("#homeYearSelect");
                if (![...select.children].some((option)=>Number(option.value)===year)) select.appendChild(Common.dom.element("option",{text:`${year}년`,attrs:{value:String(year)}}));
                select.value=String(year);
            }
            await loadDashboard();
        },

        destroy() {
            kpiObserver?.disconnect();kpiObserver=null;
            if (kpiFrame) cancelAnimationFrame(kpiFrame);
            kpiFrame=0;
            detailLayer?.destroy(); detailLayer=null;
            dashboardRequestId += 1;
            controller?.abort();
            controller = null;
            dashboardData = null;
            root = null;
        }
    };
})();
