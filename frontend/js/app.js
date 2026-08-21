(function() {
    "use strict";

    window.Pages = window.Pages || {};

    const state = {
        user: null,
        sessionChecked: false,
        handlingUnauthorized: false,
        sitePreferences: {
            homepageSkin: window.DEFAULT_HOMEPAGE_SKIN || "national-intelligence"
        }
    };

    const pageMap = new Map();
    const loadedScripts = new Map();
    const registeredHtmlPages = new Set();
    const registeredScriptPages = new Set();
    const bootstrapNavigation = Array.isArray(window.MENU_CONFIG) ? window.MENU_CONFIG : [];
    const bootstrapPageFiles = {
        htmlPages: [...(window.PAGE_FILE_CONFIG?.htmlPages || [])],
        scriptPages: [...(window.PAGE_FILE_CONFIG?.scriptPages || [])]
    };
    const DEFAULT_PAGE_CODE = "home";
    const PAGE_ALIASES = {
        "project-assignments": { pageCode: "workforce-management", context: { initialMode: "confirmed" } },
        "workforce-planning": { pageCode: "workforce-management", context: { initialMode: "planning" } }
    };
    const HISTORY_INDEX_KEY = "initMembersHistoryIndex";
    let currentHistoryIndex = Number(window.history.state?.[HISTORY_INDEX_KEY]);
    if (!Number.isInteger(currentHistoryIndex)) currentHistoryIndex = 0;

    function collectPages(items = []) {
        items.forEach((item) => {
            if (item.type === "page" && item.page) pageMap.set(item.page, item);
            if (Array.isArray(item.children)) collectPages(item.children);
        });
    }

    function installPortalAccess(navigation, pageFiles) {
        const safeNavigation = Array.isArray(navigation) ? navigation : [];
        const htmlPages = Array.isArray(pageFiles?.htmlPages) ? pageFiles.htmlPages : [];
        const scriptPages = Array.isArray(pageFiles?.scriptPages) ? pageFiles.scriptPages : [];

        window.MENU_CONFIG = safeNavigation;
        window.PAGE_FILE_CONFIG = { htmlPages: [...htmlPages], scriptPages: [...scriptPages] };
        pageMap.clear();
        collectPages(safeNavigation);
        pageMap.set("login", { type: "page", page: "login", label: "로그인", title: "로그인", public: true });
        registeredHtmlPages.clear();
        registeredScriptPages.clear();
        htmlPages.forEach((pageCode) => registeredHtmlPages.add(String(pageCode)));
        scriptPages.forEach((pageCode) => registeredScriptPages.add(String(pageCode)));
        registeredHtmlPages.add("login");
        registeredScriptPages.add("login");
    }

    function resetPortalAccess() {
        installPortalAccess(bootstrapNavigation, bootstrapPageFiles);
    }

    function applyPortalAccess(payload) {
        const data = Common.data.get(payload) || {};
        const access = data.portalAccess || payload?.portalAccess;
        if (!access || !Array.isArray(access.navigation) || !access.pageFiles) {
            throw new Error("서버에서 화면 접근 권한을 확인하지 못했습니다.");
        }
        installPortalAccess(access.navigation, access.pageFiles);
    }

    resetPortalAccess();

    const visitedPages = new Set();

    function homepageSkinTemplates() {
        return Array.isArray(window.APP_SKIN_TEMPLATES) ? window.APP_SKIN_TEMPLATES : [];
    }

    function normalizeHomepageSkin(value) {
        const requested = String(value || "").trim().toLowerCase();
        const fallback = String(window.DEFAULT_HOMEPAGE_SKIN || "national-intelligence");
        return homepageSkinTemplates().some((template) => template.code === requested) ? requested : fallback;
    }

    function applyHomepageSkin(value) {
        const homepageSkin = normalizeHomepageSkin(value);
        state.sitePreferences.homepageSkin = homepageSkin;
        document.documentElement.dataset.homeSkin = homepageSkin;
        window.dispatchEvent(new CustomEvent("app:homepage-skin-change", {
            detail: { homepageSkin }
        }));
        return homepageSkin;
    }

    async function loadSitePreferences() {
        try {
            const payload = await Common.api.request("/site/preferences", {
                method: "GET",
                showLoading: false
            });
            const data = Common.data.get(payload) || {};
            applyHomepageSkin(data.homepageSkin);
        } catch (error) {
            console.warn("[App] 포털 디자인 설정을 불러오지 못해 기본 스킨을 사용합니다.", error);
            applyHomepageSkin(state.sitePreferences.homepageSkin);
        }
        return { ...state.sitePreferences };
    }

    function roleCode() {
        return String(state.user?.roleCode || "USER").toUpperCase();
    }

    function requiresPasswordChange() {
        return Boolean(state.user) && String(state.user.passwordChangeYn || "N").toUpperCase() !== "Y";
    }

    function isAllowed(item) {
        const roles = Array.isArray(item?.roles) ? item.roles.map((value) => String(value).toUpperCase()) : [];
        return roles.length === 0 || roles.includes(roleCode());
    }

    function getPage(pageCode) {
        return pageMap.get(pageCode) || null;
    }

    function hasRegisteredPageFiles(pageCode) {
        return registeredHtmlPages.has(pageCode) && registeredScriptPages.has(pageCode);
    }

    function routeFromHash() {
        try {
            const value = decodeURIComponent(window.location.hash.replace(/^#\/?/, "")).trim();
            return pageMap.has(value) ? value : "";
        } catch (_error) {
            return "";
        }
    }

    function updateHash(pageCode, replace = false) {
        const next = `#/${pageCode}`;
        const sameHash = window.location.hash === next;
        if (!replace && !sameHash) currentHistoryIndex += 1;
        const nextState = {
            ...(window.history.state || {}),
            pageCode,
            [HISTORY_INDEX_KEY]: currentHistoryIndex
        };
        if (sameHash) {
            if (replace) window.history.replaceState(nextState, "", next);
            return;
        }
        const method = replace ? "replaceState" : "pushState";
        window.history[method](nextState, "", next);
    }

    function setSidebarOpen(open) {
        const mobile = window.matchMedia("(max-width: 1024px)").matches;
        const wasOpen = document.body.classList.contains("sidebar-open");
        const enabled = mobile && Boolean(open);
        const toggle = document.getElementById("sidebarToggle");
        const closeButton = document.getElementById("sidebarClose");
        const backdrop = document.getElementById("sidebarBackdrop");
        const sidebar = document.getElementById("appSidebar");
        const main = document.querySelector(".app-main");
        document.body.classList.toggle("sidebar-open", enabled);
        if (toggle) {
            toggle.setAttribute("aria-expanded", String(enabled));
            toggle.setAttribute("aria-label", enabled ? "메뉴 닫기" : "메뉴 열기");
        }
        if (backdrop) backdrop.hidden = !enabled;
        if (sidebar) {
            sidebar.inert = mobile && !enabled;
            sidebar.setAttribute("aria-hidden", String(mobile && !enabled));
        }
        if (main) main.inert = enabled;

        if (enabled) {
            window.requestAnimationFrame(() => closeButton?.focus());
        } else if (wasOpen && mobile) {
            window.requestAnimationFrame(() => toggle?.focus());
        }
    }

    function keepFocusInSidebar(event) {
        if (event.key !== "Tab" || !document.body.classList.contains("sidebar-open")) return;
        const sidebar = document.getElementById("appSidebar");
        const focusable = Array.from(sidebar?.querySelectorAll(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []).filter((element) => !element.hidden && element.getClientRects().length > 0);
        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function pageLink(item) {
        const link = Common.dom.element("a", {
            className: "nav-link",
            attrs: {
                href: `#/${encodeURIComponent(item.page)}`,
                "data-page": item.page,
                "data-visited": visitedPages.has(item.page) ? "true" : null,
                "aria-current": PageManager.current?.pageCode === item.page ? "page" : null
            }
        });
        const icon = Common.dom.element("span", {
            className: "nav-icon",
            text: item.icon || "•",
            attrs: { "aria-hidden": "true" }
        });
        const label = Common.dom.element("span", { text: item.label || item.title || item.page });
        link.append(icon, label);
        link.addEventListener("click", (event) => {
            if (
                event.defaultPrevented
                || event.button !== 0
                || event.metaKey
                || event.ctrlKey
                || event.shiftKey
                || event.altKey
            ) {
                return;
            }
            event.preventDefault();
            App.navigate(item.page);
        });
        return link;
    }

    function renderNavigation() {
        const navigation = document.getElementById("appNavigation");
        if (!navigation) return;
        navigation.replaceChildren();
        if (!state.user || requiresPasswordChange()) return;

        (window.MENU_CONFIG || []).forEach((item) => {
            if (item.type === "page") {
                if (isAllowed(item)) navigation.appendChild(pageLink(item));
                return;
            }

            if (item.type === "group") {
                if (!isAllowed(item)) return;
                const children = (item.children || []).filter(isAllowed);
                if (!children.length) return;

                const section = Common.dom.element("section", {
                    className: "nav-group",
                    attrs: { "aria-label": item.label || "메뉴 그룹" }
                });
                section.appendChild(Common.dom.element("span", {
                    className: "nav-group-label",
                    text: item.label || ""
                }));
                children.forEach((child) => section.appendChild(pageLink(child)));
                navigation.appendChild(section);
            }
        });
    }

    function updateNavigationState(pageCode) {
        const navigation = document.getElementById("appNavigation");
        if (!navigation) return;
        navigation.querySelectorAll(".nav-link[data-page]").forEach((link) => {
            const linkPage = link.dataset.page || "";
            if (linkPage === pageCode) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }
            if (visitedPages.has(linkPage)) {
                link.dataset.visited = "true";
            } else {
                delete link.dataset.visited;
            }
        });
    }

    function markPageVisited(pageCode) {
        if (!pageMap.has(pageCode) || pageCode === "login") return;
        visitedPages.add(pageCode);
        updateNavigationState(pageCode);
    }

    function unmarkPageVisited(pageCode) {
        visitedPages.delete(pageCode);
        updateNavigationState(PageManager.current?.pageCode || "");
    }

    function updateShell(pageCode) {
        const page = getPage(pageCode);
        const isLogin = pageCode === "login";
        const appName = window.APP_NAME || "웹 사이트";

        document.body.classList.toggle("auth-screen", isLogin);
        document.title = isLogin ? `로그인 · ${appName}` : `${page?.title || page?.label || appName} · ${appName}`;

        const title = document.getElementById("pageTitle");
        const eyebrow = document.getElementById("appHeaderEyebrow");
        const headerUser = document.getElementById("headerUserName");
        const sidebarUser = document.getElementById("sidebarUserName");
        const sidebarRole = document.getElementById("sidebarUserRole");

        if (title) title.textContent = page?.title || page?.label || "";
        if (eyebrow) eyebrow.textContent = appName;
        if (headerUser) headerUser.textContent = state.user?.userName || state.user?.loginId || "";
        if (sidebarUser) sidebarUser.textContent = state.user?.userName || state.user?.loginId || "로그인 사용자";
        if (sidebarRole) sidebarRole.textContent = roleCode() === "ADMIN" ? "관리자" : "사용자";

        updateNavigationState(pageCode);
    }

    function loadPageScript(pageCode) {
        if (window.Pages[pageCode]) return Promise.resolve(window.Pages[pageCode]);
        if (loadedScripts.has(pageCode)) return loadedScripts.get(pageCode).promise;

        const record = {
            module: null,
            promise: null,
            script: null
        };
        record.promise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            record.script = script;
            script.src = Common.asset.url(`./js/${encodeURIComponent(pageCode)}.js`);
            script.async = true;
            script.dataset.pageScript = pageCode;
            script.addEventListener("load", () => {
                const currentRecord = loadedScripts.get(pageCode);
                if (currentRecord !== record) {
                    if (currentRecord?.module) window.Pages[pageCode] = currentRecord.module;
                    else delete window.Pages[pageCode];
                    const staleLoadError = new Error(`${pageCode} 화면 로드가 취소되었습니다.`);
                    staleLoadError.name = "AbortError";
                    reject(staleLoadError);
                    return;
                }
                const pageModule = window.Pages[pageCode];
                if (!pageModule) {
                    reject(new Error(`${pageCode} 화면 모듈이 등록되지 않았습니다.`));
                    return;
                }
                record.module = pageModule;
                resolve(pageModule);
            }, { once: true });
            script.addEventListener("error", () => {
                reject(new Error(`${pageCode} 화면 스크립트를 불러오지 못했습니다.`));
            }, { once: true });
            document.head.appendChild(script);
        }).catch((error) => {
            if (loadedScripts.get(pageCode) === record) {
                loadedScripts.delete(pageCode);
                record.script?.remove();
                PageManager.updateControls();
            }
            throw error;
        });

        loadedScripts.set(pageCode, record);
        PageManager.updateControls();
        return record.promise;
    }

    function releasePageScript(pageCode, expectedModule = null) {
        const record = loadedScripts.get(pageCode);
        record?.script?.remove();
        loadedScripts.delete(pageCode);
        document.querySelectorAll("script[data-page-script]").forEach((script) => {
            if (script.dataset.pageScript === pageCode) script.remove();
        });
        if (!expectedModule || window.Pages[pageCode] === expectedModule) {
            delete window.Pages[pageCode];
        }
        PageManager.updateControls();
    }

    async function loadPageHtml(pageCode, signal) {
        const response = await fetch(Common.asset.url(`./pages/${encodeURIComponent(pageCode)}.html`), {
            method: "GET",
            credentials: "same-origin",
            cache: "no-cache",
            signal
        });
        if (!response.ok) throw new Error(`${pageCode} 화면을 불러오지 못했습니다. (HTTP ${response.status})`);
        return response.text();
    }

    // A page is initialized once, deactivated while cached, activated when restored,
    // and destroyed only when it is explicitly closed or the workspace is cleared.
    const PageManager = {
        current: null,
        pages: new Map(),
        requestId: 0,
        controller: null,
        activationSequence: 0,

        updateControls() {
            const currentCloseButton = document.getElementById("closeCurrentPageButton");
            const allCloseButton = document.getElementById("closeAllPagesButton");
            const openPageCount = Array.from(new Set([
                ...this.pages.keys(),
                ...loadedScripts.keys()
            ])).filter((pageCode) => pageCode !== "login" && pageCode !== DEFAULT_PAGE_CODE).length;
            if (currentCloseButton) {
                const canCloseCurrent = Boolean(
                    this.current
                    && this.current.pageCode !== "login"
                    && this.current.pageCode !== DEFAULT_PAGE_CODE
                );
                currentCloseButton.disabled = !canCloseCurrent;
                currentCloseButton.setAttribute(
                    "aria-label",
                    canCloseCurrent ? `${getPage(this.current.pageCode)?.title || "현재"} 페이지 닫기` : "현재 페이지 닫기"
                );
            }
            if (allCloseButton) {
                allCloseButton.disabled = openPageCount === 0;
                allCloseButton.setAttribute("aria-label", `전체 페이지 닫기 · ${openPageCount}개 열림`);
            }
        },

        lifecycleContext(entry, extra = {}) {
            return {
                root: entry.root,
                user: state.user,
                navigate: App.navigate,
                refreshSession: App.refreshSession,
                ...extra
            };
        },

        async destroyPage(pageCode, options = {}) {
            const entry = this.pages.get(pageCode);
            if (!entry) return;
            if (this.current === entry && entry.active) {
                await this.hideCurrent("", { closing: true, reason: options.reason || "page close" });
            }
            if (this.current === entry) this.current = null;
            try {
                entry.clientTablePagers?.forEach((pager) => pager.destroy());
                entry.clientTablePagers = [];
                if (typeof entry.module.destroy === "function") {
                    await entry.module.destroy(this.lifecycleContext(entry, {
                        closing: true,
                        reason: options.reason || "page close"
                    }));
                }
            } catch (error) {
                console.warn("[PageManager] 화면 정리 중 오류가 발생했습니다.", error);
            } finally {
                entry.root.replaceChildren();
                entry.root.remove();
                this.pages.delete(pageCode);
                releasePageScript(pageCode, entry.module);
                unmarkPageVisited(pageCode);
                this.updateControls();
            }
        },

        async clear(options = {}) {
            this.requestId += 1;
            this.controller?.abort();
            this.controller = null;
            const pageCodes = Array.from(this.pages.keys());
            for (const pageCode of pageCodes) {
                await this.destroyPage(pageCode, { reason: options.reason || "workspace clear" });
            }
            Array.from(loadedScripts.keys()).forEach((pageCode) => releasePageScript(pageCode));
            document.querySelectorAll("script[data-page-script]").forEach((script) => script.remove());
            document.getElementById("pageHost")?.replaceChildren();
            this.current = null;
            this.updateControls();
        },

        async hideCurrent(nextPageCode, options = {}) {
            if (!this.current || this.current.pageCode === nextPageCode) return;
            const entry = this.current;
            entry.scrollY = window.scrollY;
            try {
                if (typeof entry.module.deactivate === "function") {
                    await entry.module.deactivate(this.lifecycleContext(entry, {
                        nextPageCode,
                        closing: options.closing === true,
                        reason: options.reason || "page switch"
                    }));
                }
            } catch (error) {
                console.warn("[PageManager] 화면 비활성화 중 오류가 발생했습니다.", error);
            }
            entry.root.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
            entry.root.hidden = true;
            entry.root.setAttribute("aria-hidden", "true");
            entry.active = false;
        },

        async show(entry, options = {}) {
            await this.hideCurrent(entry.pageCode);
            entry.root.hidden = false;
            entry.root.removeAttribute("aria-hidden");
            entry.active = true;
            entry.lastActivatedOrder = ++this.activationSequence;
            this.current = entry;

            if (options.fromHash && Number.isInteger(options.historyIndex)) {
                currentHistoryIndex = options.historyIndex;
            }

            markPageVisited(entry.pageCode);
            updateShell(entry.pageCode);
            if (!options.fromHash) {
                updateHash(entry.pageCode, options.replaceHash);
            } else if (routeFromHash() !== entry.pageCode) {
                updateHash(entry.pageCode, true);
            }
            setSidebarOpen(false);

            const explicitFocusTarget = entry.root.querySelector("[data-page-focus]");
            const focusTarget = explicitFocusTarget || entry.root.querySelector("h1, h2") || entry.root;
            if (!explicitFocusTarget) focusTarget.setAttribute?.("tabindex", "-1");
            focusTarget.focus?.({ preventScroll: true });
            window.scrollTo({ top: entry.scrollY || 0, behavior: "auto" });
            this.updateControls();
        },

        async canLeaveCurrent(nextPageCode, options = {}) {
            if (
                options.skipBeforeLeave
                || !this.current
                || (
                    this.current.pageCode === nextPageCode
                    && !options.force
                )
                || typeof this.current.module.beforeLeave !== "function"
            ) {
                return true;
            }
            const allowed = await this.current.module.beforeLeave({
                nextPageCode,
                force: options.force === true,
                closing: options.closing === true,
                preservesState: options.force !== true && options.closing !== true
            });
            if (allowed === false) {
                if (options.fromHash && Number.isInteger(options.historyIndex)) {
                    const restoreDelta = currentHistoryIndex - options.historyIndex;
                    if (restoreDelta) window.history.go(restoreDelta);
                    else updateHash(this.current.pageCode, true);
                } else if (options.fromHash) {
                    window.history.forward();
                } else {
                    updateHash(this.current.pageCode, true);
                }
                setSidebarOpen(false);
                return false;
            }
            return true;
        },

        fallbackPageCode(excludedPageCode = "") {
            const recentEntry = Array.from(this.pages.values())
                .filter((entry) => entry.pageCode !== "login" && entry.pageCode !== excludedPageCode)
                .sort((left, right) => (right.lastActivatedOrder || 0) - (left.lastActivatedOrder || 0))[0];
            return recentEntry?.pageCode || DEFAULT_PAGE_CODE;
        },

        async closeCurrent() {
            const entry = this.current;
            if (!entry || entry.pageCode === "login" || entry.pageCode === DEFAULT_PAGE_CODE) return;
            const fallbackPageCode = this.fallbackPageCode(entry.pageCode);
            if (!(await this.canLeaveCurrent(fallbackPageCode, { force: true, closing: true }))) return;
            this.requestId += 1;
            this.controller?.abort();
            this.controller = null;
            await this.destroyPage(entry.pageCode, { reason: "close current page" });
            await this.load(fallbackPageCode, {
                replaceHash: true,
                skipBeforeLeave: true
            });
        },

        async closeAll() {
            const pageCodes = Array.from(new Set([
                ...this.pages.keys(),
                ...loadedScripts.keys()
            ])).filter((pageCode) => pageCode !== "login" && pageCode !== DEFAULT_PAGE_CODE);
            if (!pageCodes.length) return;
            const confirmed = await Common.ui.confirm(
                `열려 있는 ${pageCodes.length}개 페이지를 모두 닫으시겠습니까? 저장하지 않은 화면 상태는 사라집니다.`,
                { title: "전체 페이지 닫기", confirmText: "전체 닫기", danger: true }
            );
            if (!confirmed) return;
            this.requestId += 1;
            this.controller?.abort();
            this.controller = null;
            for (const pageCode of pageCodes) {
                if (this.pages.has(pageCode)) {
                    await this.destroyPage(pageCode, { reason: "close all pages" });
                } else {
                    releasePageScript(pageCode);
                }
            }
            await this.load(DEFAULT_PAGE_CODE, {
                replaceHash: true,
                skipBeforeLeave: true
            });
        },

        async load(requestedPageCode, options = {}) {
            let pageCode = String(requestedPageCode || "").trim();
            const alias = PAGE_ALIASES[pageCode];
            if (alias) {
                pageCode = alias.pageCode;
                options = {
                    ...options,
                    context: {
                        ...alias.context,
                        ...(options.context || {})
                    }
                };
            }
            let page = getPage(pageCode);

            if (!state.user && pageCode !== "login") {
                pageCode = "login";
                page = getPage(pageCode);
            } else if (requiresPasswordChange()) {
                pageCode = "login";
                page = getPage(pageCode);
            } else if (state.user && pageCode === "login") {
                pageCode = "home";
                page = getPage(pageCode);
            }

            if (!page) {
                pageCode = state.user ? "home" : "login";
                page = getPage(pageCode);
            }

            if (!hasRegisteredPageFiles(pageCode)) {
                Common.ui.toast("등록되지 않은 화면입니다.", "error");
                pageCode = state.user ? "home" : "login";
                page = getPage(pageCode);
            }

            if (!isAllowed(page)) {
                Common.ui.toast("이 메뉴에 접근할 권한이 없습니다.", "warning");
                pageCode = "home";
                page = getPage(pageCode);
            }

            if (this.current?.pageCode === pageCode && !options.force) {
                if (options.fromHash && Number.isInteger(options.historyIndex)) {
                    currentHistoryIndex = options.historyIndex;
                }
                if (options.fromHash && routeFromHash() !== pageCode) {
                    updateHash(pageCode, true);
                }
                setSidebarOpen(false);
                return;
            }

            if (!(await this.canLeaveCurrent(pageCode, options))) return;

            const requestId = ++this.requestId;
            this.controller?.abort();
            const cached = !options.force ? this.pages.get(pageCode) : null;
            if (cached) {
                this.controller = null;
                await this.show(cached, options);
                if (typeof cached.module.activate === "function") {
                    try {
                        await cached.module.activate(this.lifecycleContext(cached, {
                            routeContext: options.context || null
                        }));
                    } catch (error) {
                        if (requestId !== this.requestId || this.current !== cached) return;
                        console.error("[PageManager] 화면 재활성화 실패", error);
                        Common.ui.toast(error.message || "화면 데이터를 새로 불러오지 못했습니다.", "error");
                    }
                }
                if (requestId !== this.requestId || this.current !== cached) return;
                return;
            }

            if (options.force && this.pages.has(pageCode)) {
                await this.destroyPage(pageCode, { reason: "page refresh" });
            }

            this.controller = new AbortController();
            Common.ui.showLoading("화면을 불러오고 있습니다.");

            let createdEntry = null;
            try {
                const [html, pageModule] = await Promise.all([
                    loadPageHtml(pageCode, this.controller.signal),
                    loadPageScript(pageCode)
                ]);
                if (requestId !== this.requestId) return;

                if (pageCode !== "login") await this.destroyPage("login");
                if (requestId !== this.requestId) return;

                const host = document.getElementById("pageHost");
                const template = document.createElement("template");
                template.innerHTML = html.trim();
                const root = template.content.firstElementChild;
                if (!root) throw new Error(`${pageCode} 화면의 루트 요소를 찾을 수 없습니다.`);
                root.hidden = true;
                host.appendChild(root);
                createdEntry = {
                    pageCode,
                    module: pageModule,
                    root,
                    scrollY: 0,
                    active: false,
                    lastActivatedOrder: 0
                };
                this.pages.set(pageCode, createdEntry);
                await this.show(createdEntry, options);

                if (typeof pageModule.init === "function") {
                    await pageModule.init(this.lifecycleContext(createdEntry, {
                        routeContext: options.context || null
                    }));
                }
                createdEntry.clientTablePagers = Common.grid.enhanceClientTables(createdEntry.root, {
                    pageSize: 100
                });
                if (requestId !== this.requestId) {
                    await this.destroyPage(createdEntry.pageCode, { reason: "stale page load" });
                    return;
                }

                await this.show(createdEntry, options);
            } catch (error) {
                if (error?.name === "AbortError") return;
                if (createdEntry) await this.destroyPage(createdEntry.pageCode);
                console.error("[PageManager] 화면 로드 실패", error);
                Common.ui.toast(error.message || "화면을 불러오지 못했습니다.", "error", { duration: 0 });

                const fallback = state.user ? "home" : "login";
                if (pageCode !== fallback) {
                    await this.load(fallback, { replaceHash: true });
                }
            } finally {
                Common.ui.hideLoading();
            }
        },

        refresh() {
            if (!this.current?.pageCode) return Promise.resolve();
            return this.load(this.current.pageCode, { force: true, replaceHash: true });
        }
    };

    async function refreshSession(options = {}) {
        try {
            const payload = await Common.api.request("/auth/session", {
                method: "GET",
                showLoading: options.showLoading === true
            });
            const sessionUser = Common.data.normalizeUser(payload);
            if (!sessionUser) throw new Error("로그인 사용자 정보를 확인하지 못했습니다.");
            applyPortalAccess(payload);
            state.user = sessionUser;
        } catch (error) {
            if (!(error instanceof Common.ApiError) || error.status !== 401) {
                if (!options.silent) Common.ui.toast(error.message || "세션을 확인하지 못했습니다.", "error");
            }
            state.user = null;
            resetPortalAccess();
        } finally {
            state.sessionChecked = true;
            renderNavigation();
        }
        return state.user;
    }

    async function logout() {
        if (!(await PageManager.canLeaveCurrent("login", { closing: true, destructive: true }))) return;
        try {
            await Common.api.request("/auth/logout", {
                method: "POST",
                loadingMessage: "로그아웃하고 있습니다."
            });
        } catch (error) {
            if (!(error instanceof Common.ApiError) || error.status !== 401) {
                Common.ui.toast(error.message || "로그아웃하지 못했습니다.", "error");
                return;
            }
        }

        state.user = null;
        resetPortalAccess();
        renderNavigation();
        await PageManager.clear({ reason: "logout" });
        await PageManager.load("login", { replaceHash: true });
        Common.ui.toast("로그아웃했습니다.", "success");
    }

    const App = {
        navigate(pageCode, options = {}) {
            return PageManager.load(pageCode, options);
        },
        refreshPage() {
            return PageManager.refresh();
        },
        closeCurrentPage() {
            return PageManager.closeCurrent();
        },
        closeAllPages() {
            return PageManager.closeAll();
        },
        refreshSession,
        logout,
        getUser() {
            return state.user ? { ...state.user } : null;
        },
        getSitePreferences() {
            return { ...state.sitePreferences };
        },
        getHomepageSkinTemplates() {
            return homepageSkinTemplates().map((template) => ({
                ...template,
                titleLines: [...(template.titleLines || [])],
                colors: [...(template.colors || [])]
            }));
        },
        applyHomepageSkin,
        setSessionUser(user) {
            state.user = Common.data.normalizeUser(user);
            renderNavigation();
            if (PageManager.current?.pageCode) updateShell(PageManager.current.pageCode);
            return state.user;
        },
        isAdmin() {
            return roleCode() === "ADMIN";
        },
        requiresPasswordChange,
        touchSessionFromResponse() {
            // Authentication state is owned by the HttpOnly server session cookie.
        },
        PageManager
    };

    window.App = App;

    async function handleUnauthorized() {
        if (!state.sessionChecked || state.handlingUnauthorized || PageManager.current?.pageCode === "login") return;
        state.handlingUnauthorized = true;
        try {
            state.user = null;
            resetPortalAccess();
            renderNavigation();
            Common.ui.toast("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.", "warning");
            await PageManager.clear({ reason: "session expired" });
            await PageManager.load("login", { replaceHash: true });
        } finally {
            state.handlingUnauthorized = false;
        }
    }

    function bindShellEvents() {
        document.getElementById("sidebarToggle")?.addEventListener("click", () => {
            setSidebarOpen(!document.body.classList.contains("sidebar-open"));
        });
        document.getElementById("sidebarBackdrop")?.addEventListener("click", () => setSidebarOpen(false));
        document.getElementById("sidebarClose")?.addEventListener("click", () => setSidebarOpen(false));
        document.getElementById("refreshPageButton")?.addEventListener("click", () => App.refreshPage());
        document.getElementById("closeCurrentPageButton")?.addEventListener("click", () => App.closeCurrentPage());
        document.getElementById("closeAllPagesButton")?.addEventListener("click", () => App.closeAllPages());
        document.getElementById("logoutButton")?.addEventListener("click", () => App.logout());

        window.addEventListener("popstate", (event) => {
            const pageCode = routeFromHash() || (state.user ? "home" : "login");
            const historyIndex = Number(event.state?.[HISTORY_INDEX_KEY]);
            PageManager.load(pageCode, {
                fromHash: true,
                historyIndex: Number.isInteger(historyIndex) ? historyIndex : undefined
            });
        });
        window.addEventListener("app:unauthorized", handleUnauthorized);
        window.addEventListener("resize", () => {
            setSidebarOpen(document.body.classList.contains("sidebar-open"));
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") setSidebarOpen(false);
            keepFocusInSidebar(event);
        });
        setSidebarOpen(false);
    }

    async function boot() {
        const appName = window.APP_NAME || "웹 사이트";
        const brandName = document.getElementById("appBrandName");
        if (brandName) brandName.textContent = appName;
        window.history.replaceState(
            {
                ...(window.history.state || {}),
                [HISTORY_INDEX_KEY]: currentHistoryIndex
            },
            "",
            window.location.href
        );
        bindShellEvents();

        // 포털 스킨은 보조 설정이므로 DB 장애 시 인증 화면 표시를 막지 않는다.
        void loadSitePreferences();
        await refreshSession({ silent: true });
        const requested = routeFromHash();
        const initialPage = state.user && !requiresPasswordChange()
            ? (requested && requested !== "login" ? requested : "home")
            : "login";

        await PageManager.load(initialPage, {
            fromHash: window.location.hash === `#/${initialPage}`,
            replaceHash: true
        });
        document.body.classList.remove("app-booting");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
})();
