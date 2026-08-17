(function() {
    "use strict";

    let controller = null;
    let root = null;
    let dashboardRequestId = 0;

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

    function monthlyPlan(scenario, planYear) {
        const rows = new Map(
            Array.from({ length: 12 }, (_, index) => [
                `${planYear}-${String(index + 1).padStart(2, "0")}`,
                { sales: 0n, cost: 0n, profit: 0n }
            ])
        );
        if (Array.isArray(scenario?.monthlyFinancials)) {
            scenario.monthlyFinancials.forEach((allocation) => {
                const target = rows.get(String(allocation.month || "").slice(0, 7));
                if (!target) return;
                target.sales += integerAmount(allocation.salesAmount);
                target.cost += integerAmount(allocation.costAmount);
                target.profit += integerAmount(allocation.operatingProfit);
            });
            return rows;
        }
        (scenario?.projects || []).forEach((project) => {
            (project.assignments || []).forEach((assignment) => {
                (assignment.monthlyAllocations || []).forEach((allocation) => {
                    const target = rows.get(allocation.month);
                    if (!target) return;
                    target.sales += integerAmount(allocation.salesAmount);
                    target.cost += integerAmount(allocation.costAmount);
                    target.profit += integerAmount(allocation.operatingProfit);
                });
            });
        });
        return rows;
    }

    function renderMonthlyPlan(scenario, planYear) {
        const chart = query("#homeMonthlyPlan");
        Common.dom.clear(chart);
        if (!scenario) {
            chart.appendChild(emptyState(`${planYear}년 계획안을 만들면 월별 예상 손익이 표시됩니다.`));
            return;
        }
        const rows = monthlyPlan(scenario, planYear);
        const maxValue = [...rows.values()].reduce((maximum, item) => {
            const values = [item.sales, item.cost, item.profit < 0n ? -item.profit : item.profit];
            return values.reduce((result, value) => value > result ? value : result, maximum);
        }, 0n);
        rows.forEach((item, month) => {
            const column = Common.dom.element("div", { className: "executive-month-column" });
            const bars = Common.dom.element("div", {
                className: "executive-month-bars",
                attrs: {
                    role: "img",
                    "aria-label": `${month}, 매출 ${money(item.sales)}, 원가 ${money(item.cost)}, 이익 ${money(item.profit)}`
                }
            });
            [
                ["sales", item.sales],
                ["cost", item.cost],
                ["profit", item.profit]
            ].forEach(([type, rawValue]) => {
                const absolute = rawValue < 0n ? -rawValue : rawValue;
                const height = maxValue ? Number(absolute * 100n / maxValue) : 0;
                const bar = Common.dom.element("i", {
                    className: `executive-month-bar is-${type}${rawValue < 0n ? " is-negative" : ""}`,
                    attrs: { title: money(rawValue) }
                });
                bar.style.setProperty("--executive-bar-height", `${Math.max(rawValue ? 4 : 0, height)}%`);
                bars.appendChild(bar);
            });
            column.append(bars, Common.dom.element("span", { text: `${Number(month.slice(5))}월` }));
            chart.appendChild(column);
        });
    }

    function renderRisks(scenario) {
        const list = query("#homeRiskList");
        Common.dom.clear(list);
        const warnings = Array.isArray(scenario?.warnings) ? scenario.warnings : [];
        query("#homeRiskCount").textContent = `${formattedNumber(warnings.length)}건`;
        if (!scenario) {
            list.appendChild(emptyState("선택 연도의 계획안이 없습니다.", "li"));
            return;
        }
        if (!warnings.length) {
            list.appendChild(emptyState("현재 과부하 또는 목표인원 부족 경고가 없습니다.", "li"));
            return;
        }
        warnings.slice(0, 8).forEach((warning) => {
            const item = Common.dom.element("li", {
                className: `executive-risk-item is-${warning.type === "OVER_CAPACITY" ? "capacity" : "staffing"}`
            });
            item.append(
                Common.dom.element("strong", {
                    text: warning.type === "OVER_CAPACITY" ? "월 투입 과부하" : "목표인원 부족"
                }),
                Common.dom.element("span", { text: warning.message || "계획 조건을 확인해 주세요." })
            );
            list.appendChild(item);
        });
    }

    function renderDecisions(projects) {
        const list = query("#homeDecisionList");
        Common.dom.clear(list);
        const rows = Array.isArray(projects) ? projects : [];
        query("#homeDecisionCount").textContent = `${formattedNumber(rows.length)}건`;
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
            list.appendChild(item);
        });
    }

    function renderWorkforce(workforce, available) {
        const container = query("#homeWorkforceComposition");
        Common.dom.clear(container);
        const rows = [
            ["내부 임직원", Number(workforce?.internalCount || 0), "internal"],
            ["협력업체 인력", Number(workforce?.partnerCount || 0), "partner"],
            ["계약·프리랜스", Number(workforce?.freelancerCount || 0), "freelancer"]
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

    function renderDashboard(data) {
        const projectSummary = data.projectSummary || {};
        const scenario = data.scenario || null;
        const scenarioSummary = scenario?.summary || {};
        const projects = scenario?.projects || [];
        const weightedAward = projects.reduce((sum, project) => {
            if (String(project.bidDecisionCode || "").toUpperCase() === "SKIP") return sum;
            const probability = BigInt(Math.round(Number(project.winProbability || 0) * 100));
            return sum + (integerAmount(project.expectedContractAmount) * probability + 5000n) / 10000n;
        }, 0n);
        const shortageCount = (scenario?.warnings || [])
            .filter((warning) => warning.type === "UNDERSTAFFED")
            .reduce((sum, warning) => sum + Number(warning.shortageHeadcount || 0), 0);
        const sales = scenario ? scenarioSummary.totalSalesAmount : projectSummary.contractAmountVat;
        const profit = scenario ? scenarioSummary.operatingProfit : 0;
        const workforce = data.workforce || {};
        const availableWorkforce = Number(workforce.internalCount || 0)
            + Number(workforce.partnerCount || 0)
            + Number(workforce.freelancerCount || 0);

        query("#homeBidTargetCount").textContent = formattedNumber(projectSummary.bidTargetCount || 0);
        query("#homeProjectCountDetail").textContent = `등록 사업 ${formattedNumber(projectSummary.projectCount || 0)}건 · 수주 ${formattedNumber(projectSummary.awardedCount || 0)}건`;
        query("#homeWeightedAward").textContent = money(scenario ? weightedAward : projectSummary.contractAmountVat);
        query("#homeAwardDetail").textContent = scenario ? "수주 확률을 반영한 계획값" : "계획안 없음 · 현재 수주액";
        query("#homePlannedSales").textContent = money(sales);
        query("#homeSalesDetail").textContent = scenario ? "월별 인력 매출단가 합계" : "현재 프로젝트 수주액";
        query("#homeOperatingProfit").textContent = money(profit);
        query("#homeProfitRate").textContent = `이익률 ${profitRate(profit, sales).toFixed(1)}%`;
        query("#homeAssignmentCount").textContent = formattedNumber(scenarioSummary.assignmentCount || 0);
        query("#homeShortageCount").textContent = formattedNumber(shortageCount);
        query("#homeWorkforceDetail").textContent = `가용 등록인력 ${formattedNumber(availableWorkforce)}명`;
        query("#homeScenarioBadge").textContent = scenario
            ? `${scenario.scenarioName} · ${scenario.statusCode === "DRAFT" ? "임시안" : "확정안"}`
            : `${data.planYear}년 계획안 없음`;
        query("#homeScenarioBadge").classList.toggle("is-empty", !scenario);
        query("#homeUpdatedAt").textContent = `${new Intl.DateTimeFormat("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }).format(new Date(data.generatedAt || Date.now()))} 기준`;

        renderMonthlyPlan(scenario, Number(data.planYear));
        renderRisks(scenario);
        renderDecisions(data.decisionProjects);
        renderWorkforce(workforce, data.companySchemaAvailable !== false);
        renderSchemaWarnings(data.schemaWarnings);
        renderNotices(data.notices);
        query("#homeOpenPlanningButton").disabled = data.planningSchemaAvailable === false;
    }

    async function loadDashboard() {
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
            renderDashboard({
                planYear,
                generatedAt: Date.now(),
                projectSummary: {},
                workforce: {},
                decisionProjects: [],
                schemaWarnings: [],
                notices: []
            });
            Common.ui.setInlineStatus(status, error.message || "경영 현황을 불러오지 못했습니다.", "error");
        }
    }

    function initializeYears() {
        const select = query("#homeYearSelect");
        const currentYear = new Date().getFullYear();
        for (let year = currentYear - 1; year <= currentYear + 4; year += 1) {
            const option = document.createElement("option");
            option.value = String(year);
            option.textContent = `${year}년`;
            select.appendChild(option);
        }
        select.value = String(currentYear + 1);
    }

    window.Pages.home = {
        async init(context) {
            root = context.root;
            controller = new AbortController();
            const user = App.getUser();
            query("#homeGreeting").textContent = `${user?.userName || user?.loginId || "사용자"}님, 사업 파이프라인과 인력계획의 주요 변화를 확인하세요.`;
            initializeYears();
            query("#homeYearSelect").addEventListener("change", loadDashboard, { signal: controller.signal });
            query("#homeRefreshButton").addEventListener("click", loadDashboard, { signal: controller.signal });
            query("#homeOpenPlanningButton").addEventListener("click", () => App.navigate("workforce-planning", {
                context: { planYear: Number(query("#homeYearSelect").value) }
            }), { signal: controller.signal });
            await loadDashboard();
        },

        activate() {
            return loadDashboard();
        },

        destroy() {
            dashboardRequestId += 1;
            controller?.abort();
            controller = null;
            root = null;
        }
    };
})();
