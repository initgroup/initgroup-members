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
        copyText
    };
})();
