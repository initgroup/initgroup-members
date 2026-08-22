(function() {
    "use strict";

    const PAGE_NAME = "my-project-assignments";
    let controller = null;
    let root = null;
    let requestSequence = 0;
    let detailRequestSequence = 0;
    let detailDrag = null;

    function query(selector) {
        return root?.querySelector(selector) || null;
    }

    function formattedNumber(value) {
        const numeric = Number(value || 0);
        return Number.isFinite(numeric) ? numeric.toLocaleString("ko-KR") : "0";
    }

    function formattedMm(value) {
        const numeric = Number(value || 0);
        if (!Number.isFinite(numeric)) return "0";
        return numeric.toLocaleString("ko-KR", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        });
    }

    function emptyState(text) {
        return Common.dom.element("div", {
            className: "empty-state dashboard-empty-state",
            text
        });
    }

    function timelineLabel(statusCode) {
        const status = String(statusCode || "COMPLETED").toUpperCase();
        if (status === "ACTIVE") return "투입 중";
        if (status === "UPCOMING") return "투입 예정";
        return "투입 완료";
    }

    function projectStatusLabel(statusCode) {
        const labels = {
            PLANNED: "계획",
            BIDDING: "입찰",
            CONTRACTED: "계약",
            IN_PROGRESS: "수행 중",
            COMPLETED: "완료"
        };
        return labels[String(statusCode || "").toUpperCase()] || "상태 미정";
    }

    function participationLabel(typeCode) {
        const labels = {
            LEAD: "주관",
            CONSORTIUM: "공동수급",
            SUBCONTRACT: "하도급"
        };
        return labels[String(typeCode || "").toUpperCase()] || "-";
    }

    function assignmentStatusLabel(statusCode) {
        return String(statusCode || "CONFIRMED").toUpperCase() === "PLANNED"
            ? "계획 투입"
            : "확정 투입";
    }

    function appendDetailField(list, label, value) {
        const field = Common.dom.element("div");
        field.append(
            Common.dom.element("dt", { text: label }),
            Common.dom.element("dd", { text: value === null || value === undefined || value === "" ? "-" : String(value) })
        );
        list.appendChild(field);
    }

    function renderProjectWorkforce(workforce, projectId) {
        const list = query("#myProjectAssignmentsWorkforceList");
        const rows = Array.isArray(workforce) ? workforce : [];
        Common.dom.clear(list);
        query("#myProjectAssignmentsWorkforceCount").textContent = formattedNumber(rows.length) + "명";
        if (!rows.length) {
            list.appendChild(emptyState("등록된 투입인력이 없습니다."));
            return;
        }

        rows.forEach((worker) => {
            const card = Common.dom.element("article", {
                className: "personal-project-worker-card" + (worker.currentUserYn === "Y" ? " is-current-user" : "")
            });
            const avatar = Common.dom.element("span", {
                className: "personal-project-worker-avatar"
            });
            const avatarPlaceholder = Common.dom.element("span", {
                text: String(worker.employeeName || "인").trim().slice(0, 1) || "인"
            });
            avatar.appendChild(avatarPlaceholder);
            if (worker.userId && worker.photoFileName) {
                const image = Common.dom.element("img", {
                    attrs: {
                        alt: (worker.employeeName || "인력") + " 프로필 사진",
                        loading: "lazy",
                        decoding: "async"
                    }
                });
                image.fetchPriority = "low";
                image.src = "/api/home/my-projects/" + encodeURIComponent(projectId)
                    + "/users/" + encodeURIComponent(worker.userId)
                    + "/photo?v=" + encodeURIComponent(worker.photoUpdatedAt || "");
                image.addEventListener("load", () => {
                    avatarPlaceholder.hidden = true;
                });
                image.addEventListener("error", () => {
                    image.remove();
                    avatarPlaceholder.hidden = false;
                });
                avatar.prepend(image);
            }
            const identity = Common.dom.element("div", { className: "personal-project-worker-identity" });
            const nameLine = Common.dom.element("div", { className: "personal-project-worker-name" });
            nameLine.appendChild(Common.dom.element("strong", { text: worker.employeeName || "이름 미정" }));
            if (worker.currentUserYn === "Y") {
                nameLine.appendChild(Common.dom.element("span", { text: "나" }));
            }
            const organization = [worker.companyName, worker.departmentName, worker.positionName, worker.jobTitle]
                .filter(Boolean)
                .join(" · ");
            identity.append(
                nameLine,
                Common.dom.element("p", { text: organization || "소속 정보 없음" })
            );
            const meta = Common.dom.element("div", { className: "personal-project-worker-meta" });
            meta.append(
                Common.dom.element("span", { text: assignmentStatusLabel(worker.assignmentStatusCode) }),
                Common.dom.element("span", {
                    text: (worker.assignmentStartDate || "-") + " ~ " + (worker.assignmentEndDate || "-")
                }),
                Common.dom.element("strong", { text: formattedMm(worker.totalMm) + " M/M" })
            );
            const duty = [worker.projectRoleName, worker.primaryDuty].filter(Boolean).join(" · ");
            card.append(
                avatar,
                identity,
                meta,
                Common.dom.element("p", {
                    className: "personal-project-worker-duty",
                    text: duty || "담당 역할과 업무가 등록되지 않았습니다."
                })
            );
            list.appendChild(card);
        });
    }

    function renderProjectDetail(data) {
        const project = data.project || {};
        query("#myProjectAssignmentsDetailTitle").textContent = project.projectName || "프로젝트 상세정보";
        query("#myProjectAssignmentsDetailSubtitle").textContent = [
            project.customerName,
            (project.projectStartDate || "-") + " ~ " + (project.projectEndDate || "-")
        ].filter(Boolean).join(" · ");
        query("#myProjectAssignmentsDetailProjectStatus").textContent = projectStatusLabel(project.statusCode);
        const fields = query("#myProjectAssignmentsDetailFields");
        Common.dom.clear(fields);
        appendDetailField(fields, "프로젝트 연도", project.projectYear ? String(project.projectYear) + "년" : "-");
        appendDetailField(fields, "고객사", project.customerName);
        appendDetailField(fields, "수행기간", (project.projectStartDate || "-") + " ~ " + (project.projectEndDate || "-"));
        appendDetailField(fields, "참여유형", participationLabel(project.participationTypeCode));
        appendDetailField(fields, "참여율", project.participationRate === null || project.participationRate === undefined ? "-" : formattedMm(project.participationRate) + "%");
        appendDetailField(fields, "입찰일", project.bidDate);
        appendDetailField(fields, "수주일", project.orderDate);
        appendDetailField(fields, "상태", projectStatusLabel(project.statusCode));
        const description = query("#myProjectAssignmentsDetailDescription");
        description.hidden = !project.description;
        description.textContent = project.description ? "프로젝트 설명\n" + project.description : "";
        renderProjectWorkforce(data.workforce, project.projectId);
    }

    function resetProjectDetailPosition() {
        const dialog = query("#myProjectAssignmentsDetailDialog");
        dialog.dataset.dragX = "0";
        dialog.dataset.dragY = "0";
        dialog.style.setProperty("--personal-project-detail-x", "0px");
        dialog.style.setProperty("--personal-project-detail-y", "0px");
    }

    async function openProjectDetail(projectId) {
        const dialog = query("#myProjectAssignmentsDetailDialog");
        const status = query("#myProjectAssignmentsDetailStatus");
        const currentRequest = ++detailRequestSequence;
        resetProjectDetailPosition();
        query("#myProjectAssignmentsDetailTitle").textContent = "프로젝트 상세정보";
        query("#myProjectAssignmentsDetailSubtitle").textContent = "프로젝트 기본 정보와 투입인력을 불러오고 있습니다.";
        Common.dom.clear(query("#myProjectAssignmentsDetailFields"));
        Common.dom.clear(query("#myProjectAssignmentsWorkforceList"));
        query("#myProjectAssignmentsWorkforceCount").textContent = "0명";
        query("#myProjectAssignmentsDetailProjectStatus").textContent = "";
        query("#myProjectAssignmentsDetailDescription").hidden = true;
        Common.ui.setInlineStatus(status, "프로젝트 상세정보를 불러오고 있습니다.");
        if (!dialog.open) dialog.showModal();
        try {
            const payload = await Common.api.request("/home/my-projects/" + encodeURIComponent(projectId), {
                method: "GET",
                signal: controller.signal,
                showLoading: false
            });
            if (currentRequest !== detailRequestSequence) return;
            renderProjectDetail(Common.data.get(payload) || {});
            Common.ui.setInlineStatus(status, "");
        } catch (error) {
            if (error?.name === "AbortError" || currentRequest !== detailRequestSequence) return;
            Common.ui.setInlineStatus(status, error.message || "프로젝트 상세정보를 불러오지 못했습니다.", "error");
        }
    }

    function closeProjectDetail() {
        detailRequestSequence += 1;
        detailDrag = null;
        query("#myProjectAssignmentsDetailDialog")?.close();
    }

    function handleDetailPointerDown(event) {
        if (event.target.closest("button, input, select, textarea, a")) return;
        const dialog = query("#myProjectAssignmentsDetailDialog");
        detailDrag = {
            startX: event.clientX,
            startY: event.clientY,
            baseX: Number(dialog.dataset.dragX || 0),
            baseY: Number(dialog.dataset.dragY || 0)
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.currentTarget.classList.add("is-dragging");
        event.preventDefault();
    }

    function handleDetailPointerMove(event) {
        if (!detailDrag) return;
        const dialog = query("#myProjectAssignmentsDetailDialog");
        const nextX = detailDrag.baseX + event.clientX - detailDrag.startX;
        const nextY = detailDrag.baseY + event.clientY - detailDrag.startY;
        dialog.dataset.dragX = String(nextX);
        dialog.dataset.dragY = String(nextY);
        dialog.style.setProperty("--personal-project-detail-x", nextX + "px");
        dialog.style.setProperty("--personal-project-detail-y", nextY + "px");
    }

    function handleDetailPointerUp(event) {
        if (!detailDrag) return;
        detailDrag = null;
        event.currentTarget.classList.remove("is-dragging");
        event.currentTarget.releasePointerCapture?.(event.pointerId);
    }

    function renderMonthlyAllocations(allocations) {
        const chart = query("#myProjectAssignmentsMonthlyChart");
        Common.dom.clear(chart);
        const rows = Array.isArray(allocations) ? allocations : [];
        const maximum = Math.max(1, ...rows.map((item) => Number(item.mm || 0)));
        rows.forEach((item) => {
            const mm = Number(item.mm || 0);
            const month = String(item.month || "");
            const column = Common.dom.element("div", { className: "personal-month-column" });
            const track = Common.dom.element("div", {
                className: "personal-month-bar-track",
                attrs: {
                    role: "img",
                    "aria-label": `${month}, ${formattedMm(mm)} M/M`
                }
            });
            const bar = Common.dom.element("i", {
                className: `personal-month-bar${mm > 1 ? " is-overallocated" : ""}`,
                attrs: { title: `${formattedMm(mm)} M/M` }
            });
            const height = maximum ? mm / maximum * 100 : 0;
            bar.style.setProperty("--personal-mm-height", `${Math.max(mm ? 4 : 0, height)}%`);
            track.appendChild(bar);
            column.append(
                track,
                Common.dom.element("span", { text: `${Number(month.slice(5)) || "-"}월` })
            );
            chart.appendChild(column);
        });
        if (!rows.length) chart.appendChild(emptyState("표시할 월별 투입 정보가 없습니다."));
    }

    function renderAssignments(assignments) {
        const list = query("#myProjectAssignmentsList");
        Common.dom.clear(list);
        const rows = Array.isArray(assignments) ? assignments : [];
        query("#myProjectAssignmentsListCount").textContent = `${formattedNumber(rows.length)}건`;
        if (!rows.length) {
            list.appendChild(emptyState("등록된 개인 투입 프로젝트가 없습니다."));
            return;
        }

        rows.forEach((assignment) => {
            const timelineStatus = String(assignment.timelineStatusCode || "COMPLETED").toLowerCase();
            const card = Common.dom.element("article", { className: "personal-assignment-card" });
            const heading = Common.dom.element("div", { className: "personal-assignment-heading" });
            heading.append(
                Common.dom.element("span", {
                    className: `personal-assignment-status is-${timelineStatus}`,
                    text: timelineLabel(assignment.timelineStatusCode)
                }),
                Common.dom.element("strong", { text: assignment.projectName || "프로젝트명 미정" })
            );
            const assignmentType = String(assignment.assignmentStatusCode || "CONFIRMED").toUpperCase() === "PLANNED"
                ? "계획 투입"
                : "확정 투입";
            const customer = assignment.customerName || "고객사 미정";
            const period = `${assignment.assignmentStartDate || "-"} ~ ${assignment.assignmentEndDate || "-"}`;
            const duty = [assignment.projectRoleName, assignment.primaryDuty].filter(Boolean).join(" · ");
            card.append(
                heading,
                Common.dom.element("strong", {
                    className: "personal-assignment-mm",
                    text: `${formattedMm(assignment.totalMm)} M/M`
                }),
                Common.dom.element("p", {
                    className: "personal-assignment-meta",
                    text: `${customer} · ${assignmentType} · ${period}`
                }),
                Common.dom.element("p", {
                    className: "personal-assignment-duty",
                    text: duty || "담당 역할과 업무가 등록되지 않았습니다."
                })
            );
            card.appendChild(Common.dom.element("button", {
                className: "button button-secondary personal-assignment-detail-button",
                text: "상세",
                attrs: {
                    type: "button",
                    "data-my-project-detail": assignment.projectId,
                    "aria-label": (assignment.projectName || "프로젝트") + " 상세정보 보기"
                }
            }));
            if (assignment.allocationDataQualityError) {
                card.appendChild(Common.dom.element("p", {
                    className: "personal-assignment-warning",
                    text: "월별 배분 정보를 확인할 수 없어 관리자 확인이 필요합니다."
                }));
            }
            list.appendChild(card);
        });
    }

    function renderDashboard(data) {
        const summary = data.summary || {};
        const currentMonth = String(data.currentMonth || "");
        query("#myProjectAssignmentsActiveCount").textContent = formattedNumber(summary.activeProjectCount);
        query("#myProjectAssignmentsUpcomingCount").textContent = formattedNumber(summary.upcomingProjectCount);
        query("#myProjectAssignmentsCurrentMm").textContent = formattedMm(summary.currentMonthMm);
        query("#myProjectAssignmentsTotalCount").textContent = formattedNumber(summary.totalProjectCount);
        query("#myProjectAssignmentsCurrentMonth").textContent = currentMonth
            ? `${Number(currentMonth.slice(5))}월 배분 합계`
            : "이번 달 배분 합계";
        query("#myProjectAssignmentsUpdatedAt").textContent = `${new Intl.DateTimeFormat("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }).format(new Date(data.generatedAt || Date.now()))} 기준`;
        renderMonthlyAllocations(data.monthlyAllocations);
        renderAssignments(data.assignments);
    }

    async function loadDashboard() {
        const currentRequest = ++requestSequence;
        const status = query("#myProjectAssignmentsStatus");
        Common.ui.setInlineStatus(status, "나의 프로젝트 투입 현황을 불러오고 있습니다.");
        try {
            const payload = await Common.api.request("/home/my-dashboard", {
                method: "GET",
                signal: controller.signal,
                showLoading: false
            });
            if (currentRequest !== requestSequence) return;
            const data = Common.data.get(payload) || {};
            if (data.dashboardType !== "personal") {
                throw new Error("개인 프로젝트 투입 데이터를 확인하지 못했습니다.");
            }
            renderDashboard(data);
            Common.ui.setInlineStatus(status, "");
        } catch (error) {
            if (error?.name === "AbortError" || currentRequest !== requestSequence) return;
            renderDashboard({
                generatedAt: Date.now(),
                summary: {},
                monthlyAllocations: [],
                assignments: []
            });
            Common.ui.setInlineStatus(
                status,
                error.message || "개인 프로젝트 투입 현황을 불러오지 못했습니다.",
                "error"
            );
        }
    }

    window.Pages = window.Pages || {};
    window.Pages[PAGE_NAME] = {
        async init({ root: pageRoot }) {
            root = pageRoot;
            controller = new AbortController();
            const user = App.getUser();
            query("#myProjectAssignmentsGreeting").textContent =
                `${user?.userName || user?.loginId || "사용자"}님, 본인의 프로젝트 투입 일정과 월별 M/M을 확인하세요.`;
            query("#myProjectAssignmentsRefreshButton").addEventListener(
                "click",
                loadDashboard,
                { signal: controller.signal }
            );
            root.addEventListener("click", (event) => {
                const detailButton = event.target.closest("[data-my-project-detail]");
                if (detailButton) {
                    openProjectDetail(detailButton.dataset.myProjectDetail);
                    return;
                }
                if (event.target.closest("[data-my-project-detail-close]")) {
                    closeProjectDetail();
                }
            }, { signal: controller.signal });
            const detailDialog = query("#myProjectAssignmentsDetailDialog");
            const detailHeader = query("[data-my-project-detail-drag-handle]");
            detailHeader.addEventListener("pointerdown", handleDetailPointerDown, { signal: controller.signal });
            detailHeader.addEventListener("pointermove", handleDetailPointerMove, { signal: controller.signal });
            detailHeader.addEventListener("pointerup", handleDetailPointerUp, { signal: controller.signal });
            detailHeader.addEventListener("pointercancel", handleDetailPointerUp, { signal: controller.signal });
            detailDialog.addEventListener("cancel", (event) => {
                event.preventDefault();
                closeProjectDetail();
            }, { signal: controller.signal });
            await loadDashboard();
        },
        async activate() {
            await loadDashboard();
        },
        destroy() {
            requestSequence += 1;
            detailRequestSequence += 1;
            detailDrag = null;
            query("#myProjectAssignmentsDetailDialog")?.close();
            controller?.abort();
            controller = null;
            root = null;
        }
    };
})();
