(function() {
    "use strict";

    const API_PREFIX = "/api";
    let loadingCount = 0;
    const messageDialogQueue = [];
    let activeMessageDialog = null;

    class ApiError extends Error {
        constructor(message, status = 0, payload = null) {
            super(message);
            this.name = "ApiError";
            this.status = status;
            this.payload = payload;
        }
    }

    function apiUrl(path) {
        const value = String(path || "");
        if (/^https?:\/\//i.test(value) || value.startsWith("/api/") || value === "/api") {
            return value;
        }
        return `${API_PREFIX}${value.startsWith("/") ? value : `/${value}`}`;
    }

    function assetUrl(path) {
        const value = String(path || "");
        const version = String(window.APP_ASSET_VERSION || "").trim();
        if (!version) return value;
        return `${value}${value.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
    }

    function formatError(payload, fallback = "요청을 처리하지 못했습니다.") {
        if (!payload) return fallback;
        if (typeof payload === "string") return payload || fallback;

        const detail = payload.detail ?? payload.message ?? payload.error;
        if (typeof detail === "string" && detail.trim()) return detail;
        if (Array.isArray(detail)) {
            const messages = detail
                .map((item) => item?.msg || item?.message || String(item || ""))
                .filter(Boolean);
            if (messages.length) return messages.join("\n");
        }
        if (detail && typeof detail === "object") {
            return detail.message || detail.msg || fallback;
        }
        return fallback;
    }

    async function parseResponse(response) {
        if (response.status === 204) return null;
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            return response.json().catch(() => null);
        }
        const text = await response.text();
        return text || null;
    }

    function showLoading(message = "잠시만 기다려 주세요.") {
        loadingCount += 1;
        const layer = document.getElementById("appLoading");
        const messageElement = document.getElementById("loadingMessage");
        if (messageElement) messageElement.textContent = message;
        if (layer) layer.hidden = false;
    }

    function hideLoading() {
        loadingCount = Math.max(0, loadingCount - 1);
        if (loadingCount > 0) return;
        const layer = document.getElementById("appLoading");
        if (layer) layer.hidden = true;
    }

    async function request(path, options = {}) {
        const {
            method = "GET",
            body,
            headers: requestedHeaders = {},
            signal,
            showLoading: useLoading = true,
            loadingMessage,
            credentials = "include"
        } = options;

        const headers = {
            Accept: "application/json",
            ...requestedHeaders
        };
        const init = {
            method: String(method || "GET").toUpperCase(),
            headers,
            credentials,
            signal
        };

        if (body !== undefined && body !== null) {
            if (body instanceof FormData || body instanceof Blob || typeof body === "string") {
                init.body = body;
            } else {
                if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
                    headers["Content-Type"] = "application/json";
                }
                init.body = JSON.stringify(body);
            }
        }

        if (useLoading) showLoading(loadingMessage);
        try {
            const response = await fetch(apiUrl(path), init);
            const payload = await parseResponse(response);

            window.App?.touchSessionFromResponse?.(response);

            if (!response.ok) {
                const error = new ApiError(
                    formatError(payload, `요청에 실패했습니다. (HTTP ${response.status})`),
                    response.status,
                    payload
                );
                if (response.status === 401) {
                    window.dispatchEvent(new CustomEvent("app:unauthorized", { detail: { path } }));
                }
                throw error;
            }
            return payload ?? {};
        } finally {
            if (useLoading) hideLoading();
        }
    }

    async function requestBlob(path, options = {}) {
        const {
            signal,
            showLoading: useLoading = true,
            loadingMessage,
            credentials = "include"
        } = options;

        if (useLoading) showLoading(loadingMessage);
        try {
            const response = await fetch(apiUrl(path), {
                method: "GET",
                credentials,
                signal,
                headers: { Accept: "image/*" }
            });
            window.App?.touchSessionFromResponse?.(response);
            if (!response.ok) {
                const payload = await parseResponse(response);
                if (response.status === 401) {
                    window.dispatchEvent(new CustomEvent("app:unauthorized", { detail: { path } }));
                }
                throw new ApiError(
                    formatError(payload, `요청에 실패했습니다. (HTTP ${response.status})`),
                    response.status,
                    payload
                );
            }
            return response.blob();
        } finally {
            if (useLoading) hideLoading();
        }
    }

    function getData(payload) {
        if (payload && Object.prototype.hasOwnProperty.call(payload, "data")) {
            return payload.data;
        }
        return payload;
    }

    function pick(source, ...keys) {
        if (!source || typeof source !== "object") return undefined;
        for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
                return source[key];
            }
        }
        return undefined;
    }

    function getRows(payload, ...keys) {
        const data = getData(payload);
        if (Array.isArray(data)) return data;
        for (const key of keys) {
            const rows = pick(data, key, key.toUpperCase());
            if (Array.isArray(rows)) return rows;
        }
        return [];
    }

    function normalizeUser(source) {
        const data = getData(source) || {};
        const row = data.user || data.sessionUser || source?.user || data;
        if (!row || typeof row !== "object") return null;

        const user = {
            userId: pick(row, "userId", "USER_ID", "id", "ID"),
            loginId: String(pick(row, "loginId", "LOGIN_ID", "username", "USER_NAME_ID") || ""),
            userName: String(pick(row, "userName", "USER_NAME", "name", "NAME") || ""),
            email: String(pick(row, "email", "EMAIL", "userEmail", "USER_EMAIL") || ""),
            roleCode: String(pick(row, "roleCode", "ROLE_CODE", "role", "ROLE") || "USER").toUpperCase(),
            useYn: String(pick(row, "useYn", "USE_YN") || "Y").toUpperCase(),
            passwordChangeYn: String(
                pick(row, "passwordChangeYn", "PASSWORD_CHANGE_YN") || "N"
            ).toUpperCase()
        };

        if (!user.userId && !user.loginId && !user.userName) return null;
        return user;
    }

    function buildQuery(params = {}) {
        const search = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value === undefined || value === null || value === "") return;
            search.set(key, String(value));
        });
        const text = search.toString();
        return text ? `?${text}` : "";
    }

    async function download(path, fallbackName = "download") {
        showLoading("파일을 준비하고 있습니다.");
        try {
            const response = await fetch(apiUrl(path), {
                method: "GET",
                credentials: "include",
                headers: { Accept: "*/*" }
            });
            window.App?.touchSessionFromResponse?.(response);
            if (!response.ok) {
                const payload = await parseResponse(response);
                if (response.status === 401) {
                    window.dispatchEvent(new CustomEvent("app:unauthorized", { detail: { path } }));
                }
                throw new ApiError(formatError(payload, "파일을 내려받지 못했습니다."), response.status, payload);
            }

            const blob = await response.blob();
            const disposition = response.headers.get("content-disposition") || "";
            const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i);
            const quoted = disposition.match(/filename="?([^";]+)"?/i);
            let fileName = fallbackName;
            if (encoded?.[1]) {
                try {
                    fileName = decodeURIComponent(encoded[1]);
                } catch (_error) {
                    fileName = encoded[1];
                }
            } else if (quoted?.[1]) {
                fileName = quoted[1];
            }

            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = objectUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(objectUrl);
        } finally {
            hideLoading();
        }
    }

    function toast(message, type = "info", options = {}) {
        const region = document.getElementById("toastRegion");
        if (!region || !message) return null;

        const item = document.createElement("article");
        item.className = `toast is-${type}`;
        item.setAttribute("role", type === "error" ? "alert" : "status");

        const text = document.createElement("span");
        text.className = "toast-message";
        text.textContent = String(message);

        const close = document.createElement("button");
        close.type = "button";
        close.className = "toast-close";
        close.setAttribute("aria-label", "알림 닫기");
        close.textContent = "×";
        close.addEventListener("click", () => item.remove());

        item.append(text, close);
        region.appendChild(item);

        const duration = Number(options.duration ?? (type === "error" ? 7000 : 4000));
        if (duration > 0) window.setTimeout(() => item.remove(), duration);
        return item;
    }

    function setInlineStatus(element, message = "", type = "") {
        if (!element) return;
        element.textContent = message;
        element.classList.add("inline-status");
        element.classList.remove("is-error", "is-success", "is-warning");
        if (type) element.classList.add(`is-${type}`);
    }

    function openNextMessageDialog() {
        if (activeMessageDialog || messageDialogQueue.length === 0) return;
        const dialog = document.getElementById("commonMessageDialog");
        if (!dialog) {
            const pending = messageDialogQueue.shift();
            pending.resolve(pending.mode === "confirm" ? false : undefined);
            openNextMessageDialog();
            return;
        }

        activeMessageDialog = messageDialogQueue.shift();
        const isConfirm = activeMessageDialog.mode === "confirm";
        const title = document.getElementById("commonMessageDialogTitle");
        const text = document.getElementById("commonMessageDialogText");
        const icon = document.getElementById("commonMessageDialogIcon");
        const cancelButton = document.getElementById("commonMessageDialogCancel");
        const confirmButton = document.getElementById("commonMessageDialogConfirm");

        if (title) title.textContent = activeMessageDialog.options.title || (isConfirm ? "작업 확인" : "알림");
        if (text) text.textContent = activeMessageDialog.message;
        if (icon) icon.textContent = activeMessageDialog.options.icon || (isConfirm ? "?" : "i");
        if (cancelButton) {
            cancelButton.hidden = !isConfirm;
            cancelButton.textContent = activeMessageDialog.options.cancelText || "취소";
        }
        if (confirmButton) {
            confirmButton.textContent = activeMessageDialog.options.confirmText || "확인";
            confirmButton.className = `button ${activeMessageDialog.options.danger ? "button-danger" : "button-primary"}`;
        }

        dialog.returnValue = "cancel";
        dialog.showModal();
        window.setTimeout(() => confirmButton?.focus(), 0);
    }

    function completeMessageDialog() {
        if (!activeMessageDialog) return;
        const dialog = document.getElementById("commonMessageDialog");
        const pending = activeMessageDialog;
        activeMessageDialog = null;
        pending.resolve(pending.mode === "confirm" ? dialog?.returnValue === "confirm" : undefined);
        openNextMessageDialog();
    }

    function showMessageDialog(message, mode, options = {}) {
        return new Promise((resolve) => {
            messageDialogQueue.push({
                message: String(message ?? ""),
                mode,
                options,
                resolve
            });
            openNextMessageDialog();
        });
    }

    function confirmMessage(message, options = {}) {
        return showMessageDialog(message, "confirm", options);
    }

    function alertMessage(message, options = {}) {
        return showMessageDialog(message, "alert", options);
    }

    function configureDateInput(input) {
        if (!(input instanceof HTMLInputElement) || input.type !== "date") return;
        if (!input.max || input.max > "9999-12-31") input.max = "9999-12-31";
        input.dataset.fourDigitYear = "true";
    }

    function normalizeDateInputYear(input) {
        configureDateInput(input);
        const match = String(input.value || "").match(/^(\d{5,})-(\d{2})-(\d{2})$/);
        if (!match) return;
        input.value = `${match[1].slice(0, 4)}-${match[2]}-${match[3]}`;
    }

    document.addEventListener("focusin", (event) => configureDateInput(event.target));
    document.addEventListener("input", (event) => normalizeDateInputYear(event.target));
    document.querySelectorAll('input[type="date"]').forEach(configureDateInput);

    document.getElementById("commonMessageDialog")?.addEventListener("close", completeMessageDialog);
    document.getElementById("commonMessageDialog")?.addEventListener("cancel", (event) => {
        event.currentTarget.returnValue = "cancel";
    });

    function clear(element) {
        if (element) element.replaceChildren();
    }

    function element(tagName, options = {}, children = []) {
        const node = document.createElement(tagName);
        if (options.className) node.className = options.className;
        if (options.text !== undefined) node.textContent = String(options.text ?? "");
        if (options.type) node.type = options.type;
        if (options.value !== undefined) node.value = String(options.value ?? "");
        if (options.attrs) {
            Object.entries(options.attrs).forEach(([name, value]) => {
                if (value !== undefined && value !== null) node.setAttribute(name, String(value));
            });
        }
        const items = Array.isArray(children) ? children : [children];
        items.filter(Boolean).forEach((child) => {
            node.append(child instanceof Node ? child : document.createTextNode(String(child)));
        });
        return node;
    }

    function formatDateTime(value) {
        if (!value) return "-";
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat("ko-KR", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    }

    function toDateTimeLocal(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        const offset = date.getTimezoneOffset() * 60_000;
        return new Date(date.getTime() - offset).toISOString().slice(0, 16);
    }

    async function copyText(value) {
        const text = String(value ?? "");
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const input = document.createElement("textarea");
        input.value = text;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
    }

    function revealEditor(target) {
        if (!target) return;
        target.setAttribute("tabindex", "-1");
        target.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            block: "start"
        });
        target.focus({ preventScroll: true });
    }

    function bindDraggableDialog(dialog, handle, signal) {
        let drag = null;
        function position(left, top) {
            const rect = dialog.getBoundingClientRect();
            dialog.style.margin = "0";
            dialog.style.left = `${Math.max(8, Math.min(left, window.innerWidth - rect.width - 8))}px`;
            dialog.style.top = `${Math.max(8, Math.min(top, window.innerHeight - rect.height - 8))}px`;
        }
        handle.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || event.target.closest("button, input, select, a")) return;
            const rect = dialog.getBoundingClientRect();
            drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
            handle.setPointerCapture(event.pointerId);
            event.preventDefault();
        }, { signal });
        handle.addEventListener("pointermove", (event) => {
            if (drag?.id === event.pointerId) position(event.clientX - drag.x, event.clientY - drag.y);
        }, { signal });
        function release() { drag = null; }
        ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) => handle.addEventListener(type, release, { signal }));
        dialog.addEventListener("close", () => {
            release();
            ["margin", "left", "top"].forEach((property) => dialog.style.removeProperty(property));
        }, { signal });
        window.addEventListener("resize", () => {
            if (!dialog.open || !dialog.style.left) return;
            const rect = dialog.getBoundingClientRect();
            position(rect.left, rect.top);
        }, { signal });
    }

    function createDetailDialog({ root, prefix, signal }) {
        const lifecycle = new AbortController();
        const dialog = element("dialog", { className: "dialog detail-layer", attrs: { id: `${prefix}Dialog`, "aria-labelledby": `${prefix}Title` } });
        const title = element("h3", { attrs: { id: `${prefix}Title`, tabindex: "-1" } });
        const description = element("p");
        const closeButton = element("button", { text: "×", className: "dialog-close", type: "button", attrs: { "aria-label": "상세 레이어 닫기" } });
        const header = element("header", { className: "dialog-header" }, [element("div", {}, [title, description]), closeButton]);
        const body = element("div", { className: "dialog-body detail-layer-body" });
        const footer = element("footer", { className: "dialog-footer" });
        dialog.append(header, body, footer); root.appendChild(dialog);
        let opener = null, contentController = null, destroyed = false;
        const close = () => { if (dialog.open) dialog.close(); };
        closeButton.addEventListener("click", close, { signal: lifecycle.signal });
        dialog.addEventListener("cancel", (event) => { event.preventDefault(); event.stopPropagation(); close(); }, { signal: lifecycle.signal });
        dialog.addEventListener("close", () => {
            // A queued close event may arrive after another detail has already reopened.
            if (dialog.open) return;
            contentController?.abort(); contentController = null;
            body.replaceChildren(); footer.replaceChildren();
            if (opener?.isConnected) opener.focus({ preventScroll: true });
            opener = null;
        }, { signal: lifecycle.signal });
        bindDraggableDialog(dialog, header, lifecycle.signal);
        function open({ title: heading, description: copy = "", groups = [], actions = [] }) {
            if (destroyed) return;
            contentController?.abort(); contentController = new AbortController();
            title.textContent = heading; description.textContent = copy;
            body.replaceChildren(); footer.replaceChildren();
            const search = element("input", { className: "input", type: "search", attrs: { placeholder: "이름·프로젝트·월·사유 검색", "aria-label": "상세 대상 검색" } });
            const count = element("p", { className: "detail-layer-count", text: `전체 ${groups.length}건` });
            const list = element("div", { className: "detail-layer-groups" });
            const nodes = groups.map((group, index) => {
                const section = element("details", { className: `detail-layer-group${group.severity === "danger" ? " is-danger" : ""}` });
                section.open = groups.length <= 3 || index === 0;
                section.appendChild(element("summary", { text: group.title }));
                const reasons = element("ul", { className: "detail-layer-reasons" });
                (group.reasons || []).forEach((reason) => reasons.appendChild(element("li", { text: reason })));
                if (reasons.childElementCount) section.appendChild(reasons);
                const facts = element("dl", { className: "detail-layer-facts" });
                (group.facts || []).forEach(([label, value]) => facts.appendChild(element("div", {}, [element("dt", { text: label }), element("dd", { text: value })])));
                if (facts.childElementCount) section.appendChild(facts);
                if (group.columns?.length) {
                    const head = element("tr"); group.columns.forEach((column) => head.appendChild(element("th", { text: column, attrs: { scope: "col" } })));
                    const rows = element("tbody");
                    (group.rows || []).forEach((row) => {
                        const tr = element("tr"); row.forEach((value) => tr.appendChild(element("td", { text: value }))); rows.appendChild(tr);
                    });
                    section.appendChild(element("div", { className: "table-wrap" }, [element("table", { className: "data-table" }, [element("thead", {}, [head]), rows])]));
                }
                if (group.actions?.length) {
                    const actionsRow=element("div",{className:"detail-layer-actions"});
                    group.actions.forEach((action)=>{
                        const button=element("button",{className:"button button-secondary button-small",text:action.label,type:"button",attrs:{"data-detail-action":action.key || "open"}});
                        button.addEventListener("click",()=>{close();action.run();},{signal:contentController.signal});
                        actionsRow.appendChild(button);
                    });
                    section.appendChild(actionsRow);
                }
                list.appendChild(section);
                return { node: section, text: section.textContent.toLocaleLowerCase("ko-KR") };
            });
            body.append(search, count, list);
            if (!groups.length) list.appendChild(element("p", { className: "empty-state", text: "상세 대상이 없습니다." }));
            search.addEventListener("input", () => {
                const term = search.value.trim().toLocaleLowerCase("ko-KR");
                let visible = 0;
                nodes.forEach((item) => { item.node.hidden = !item.text.includes(term); if (!item.node.hidden) visible++; });
                count.textContent = `전체 ${groups.length}건 중 ${visible}건`;
            }, { signal: contentController.signal });
            actions.forEach((action) => {
                const button = element("button", { className: "button button-secondary", text: action.label, type: "button", attrs: { "data-detail-action": action.key || "open" } });
                button.addEventListener("click", () => { close(); action.run(); }, { signal: contentController.signal }); footer.appendChild(button);
            });
            const done = element("button", { className: "button button-primary", text: "닫기", type: "button" });
            done.addEventListener("click", close, { signal: contentController.signal }); footer.appendChild(done);
            if (!dialog.open) { opener = document.activeElement; dialog.showModal(); }
            body.scrollTop = 0; title.focus({ preventScroll: true });
        }
        function destroy() {
            if (destroyed) return;
            close(); destroyed = true; contentController?.abort(); lifecycle.abort(); dialog.remove();
            signal?.removeEventListener("abort", destroy);
        }
        signal?.addEventListener("abort", destroy, { once: true });
        return { open, close, destroy, isOpen: () => dialog.open };
    }

    function groupWorkloadOverloads(warnings = []) {
        const people=new Map();
        warnings.forEach((warning)=>{
            if (!(Number(warning.totalMm) > 1 + 0.000001)) return;
            const key=String(warning.workerKey || `NAME:${warning.employeeName || "이름 미정"}`);
            if (!people.has(key)) people.set(key,{workerKey:key,employeeName:warning.employeeName || "이름 미정",byMonth:new Map()});
            const person=people.get(key),previous=person.byMonth.get(warning.month);
            if (!previous || Number(previous.totalMm)<Number(warning.totalMm)) person.byMonth.set(warning.month,warning);
        });
        return [...people.values()].map((person)=>{
            const rows=[...person.byMonth.values()].sort((a,b)=>String(a.month).localeCompare(String(b.month)));
            const names=new Set(rows.flatMap((row)=>row.projects instanceof Map ? [...row.projects.values()].map((p)=>p.name) : (row.allocations || []).map((a)=>a.projectName)));
            return {workerKey:person.workerKey,employeeName:person.employeeName,warnings:rows,months:rows.map((r)=>r.month),
                peakMm:Math.max(...rows.map((r)=>Number(r.totalMm))),projectNames:[...names].filter(Boolean)};
        }).sort((a,b)=>b.months.length-a.months.length || b.peakMm-a.peakMm || a.employeeName.localeCompare(b.employeeName,"ko"));
    }

    function workloadMonthList(months = []) {
        const keys=[...new Set(months)].sort(),multipleYears=new Set(keys.map((month)=>String(month).slice(0,4))).size>1;
        return keys.map((month)=>`${multipleYears ? `${String(month).slice(0,4)}년 ` : ""}${Number(String(month).slice(5,7))}월`).join(", ");
    }

    window.Common = {
        ApiError,
        asset: {
            url: assetUrl,
            version: String(window.APP_ASSET_VERSION || "")
        },
        api: {
            request,
            blob: requestBlob,
            download,
            url: apiUrl,
            query: buildQuery
        },
        data: {
            get: getData,
            rows: getRows,
            pick,
            normalizeUser
        },
        dom: {
            clear,
            element
        },
        ui: {
            revealEditor,
            bindDraggableDialog,
            createDetailDialog,
            showLoading,
            hideLoading,
            toast,
            setInlineStatus,
            alert: alertMessage,
            confirm: confirmMessage
        },
        format: {
            error: formatError,
            dateTime: formatDateTime,
            dateTimeLocal: toDateTimeLocal
        },
        copyText,
        workload: { groupOverloads: groupWorkloadOverloads, monthList: workloadMonthList }
    };
})();
