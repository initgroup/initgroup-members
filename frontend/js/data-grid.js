(function() {
    "use strict";

    function resolveElement(root, value) {
        if (!value) return null;
        return typeof value === "string" ? root.querySelector(value) : value;
    }

    function numeric(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    class ServerDataGrid {
        constructor(options = {}) {
            this.root = options.root;
            this.body = resolveElement(this.root, options.body);
            this.pagination = resolveElement(this.root, options.pagination);
            this.status = resolveElement(this.root, options.status);
            this.pageSizeSelect = resolveElement(this.root, options.pageSizeSelect);
            this.fetchPage = options.fetchPage;
            this.renderRow = options.renderRow;
            this.itemMode = options.itemMode === true;
            this.rowKey = options.rowKey || ((row) => row?.id);
            this.onSelect = options.onSelect || (() => {});
            this.emptyMessage = options.emptyMessage || "조회된 항목이 없습니다.";
            this.loadingMessage = options.loadingMessage || "목록을 불러오고 있습니다.";
            this.errorMessage = options.errorMessage || "목록을 불러오지 못했습니다.";
            this.formatStatus = options.formatStatus;
            this.columnCount = numeric(
                options.columnCount,
                this.body?.closest("table")?.querySelectorAll("thead th").length || 1
            );
            this.state = {
                page: Math.max(1, numeric(options.page, 1)),
                pageSize: Math.max(1, numeric(options.pageSize || this.pageSizeSelect?.value, 20)),
                sortBy: String(options.sortBy || ""),
                sortDirection: options.sortDirection === "asc" ? "asc" : "desc",
                total: 0,
                totalPages: 1,
                rows: []
            };
            this.selectedKey = "";
            this.destroyed = false;
            this.requestId = 0;
            this.loadController = null;
            this.eventController = new AbortController();

            if (!this.root || !this.body || typeof this.fetchPage !== "function" || typeof this.renderRow !== "function") {
                throw new Error("ServerDataGrid requires root, body, fetchPage, and renderRow options.");
            }

            this.bindEvents(options.signal);
            this.updateSortHeaders();
        }

        bindEvents(externalSignal) {
            const signal = this.eventController.signal;
            this.root.querySelectorAll("[data-grid-sort]").forEach((button) => {
                button.addEventListener("click", () => {
                    const sortBy = String(button.dataset.gridSort || "");
                    if (!sortBy) return;
                    if (this.state.sortBy === sortBy) {
                        this.state.sortDirection = this.state.sortDirection === "asc" ? "desc" : "asc";
                    } else {
                        this.state.sortBy = sortBy;
                        this.state.sortDirection = "asc";
                    }
                    this.load({ resetPage: true });
                }, { signal });
            });

            this.pageSizeSelect?.addEventListener("change", () => {
                this.setPageSize(this.pageSizeSelect.value);
            }, { signal });

            this.pagination?.addEventListener("click", (event) => {
                const button = event.target.closest("button[data-grid-page]");
                if (!button || button.disabled) return;
                const nextPage = numeric(button.dataset.gridPage, this.state.page);
                if (nextPage === this.state.page || nextPage < 1 || nextPage > this.state.totalPages) return;
                this.state.page = nextPage;
                this.load();
            }, { signal });

            externalSignal?.addEventListener("abort", () => this.destroy(), { once: true });
        }

        async load(options = {}) {
            if (this.destroyed) return;
            if (options.resetPage) this.state.page = 1;
            const requestId = ++this.requestId;
            this.loadController?.abort();
            this.loadController = new AbortController();
            Common.ui.setInlineStatus(this.status, this.loadingMessage);

            try {
                const payload = await this.fetchPage({
                    page: this.state.page,
                    pageSize: this.state.pageSize,
                    sortBy: this.state.sortBy,
                    sortDirection: this.state.sortDirection,
                    signal: this.loadController.signal
                });
                if (this.destroyed || requestId !== this.requestId) return;

                const data = Common.data.get(payload) || {};
                const rows = Array.isArray(data)
                    ? data
                    : Common.data.rows(payload, "items", "rows");
                const total = Math.max(0, numeric(data.total ?? payload?.total, rows.length));
                const pageSize = Math.max(1, numeric(data.pageSize, this.state.pageSize));
                const totalPages = Math.max(1, numeric(data.totalPages, Math.ceil(total / pageSize) || 1));
                const page = Math.max(1, numeric(data.page, this.state.page));

                if (!rows.length && total > 0 && page > totalPages) {
                    this.state.page = totalPages;
                    await this.load();
                    return;
                }

                this.state = {
                    ...this.state,
                    page,
                    pageSize,
                    total,
                    totalPages,
                    rows
                };
                this.render();
                this.renderPagination();
                this.updateSortHeaders();
                this.updateStatus();
            } catch (error) {
                if (error?.name === "AbortError" || requestId !== this.requestId || this.destroyed) return;
                this.state.rows = [];
                this.state.total = 0;
                this.state.totalPages = 1;
                this.render();
                this.renderPagination();
                Common.ui.setInlineStatus(this.status, error.message || this.errorMessage, "error");
            }
        }

        render() {
            Common.dom.clear(this.body);
            if (!this.state.rows.length) {
                if (this.itemMode) {
                    this.body.appendChild(Common.dom.element("div", {
                        className: "grid-empty-cell",
                        text: this.emptyMessage
                    }));
                    return;
                }
                const row = Common.dom.element("tr");
                const cell = Common.dom.element("td", {
                    className: "grid-empty-cell",
                    text: this.emptyMessage,
                    attrs: { colspan: this.columnCount }
                });
                row.appendChild(cell);
                this.body.appendChild(row);
                return;
            }

            this.state.rows.forEach((record, index) => {
                const row = this.renderRow(record, {
                    index,
                    page: this.state.page,
                    pageSize: this.state.pageSize
                });
                if (!(row instanceof HTMLElement) || (!this.itemMode && !(row instanceof HTMLTableRowElement))) {
                    throw new Error(this.itemMode
                        ? "renderRow must return an HTML element."
                        : "renderRow must return a table row element.");
                }
                const key = String(this.rowKey(record) ?? "");
                row.dataset.gridRowKey = key;
                row.tabIndex = 0;
                row.setAttribute("aria-selected", key && key === this.selectedKey ? "true" : "false");
                row.classList.toggle("is-selected", Boolean(key && key === this.selectedKey));
                row.addEventListener("click", (event) => {
                    if (event.target.closest("a, button, input, select, textarea, label")) return;
                    this.select(record);
                }, { signal: this.eventController.signal });
                row.addEventListener("keydown", (event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    this.select(record);
                }, { signal: this.eventController.signal });
                this.body.appendChild(row);
            });
        }

        select(record) {
            const key = String(this.rowKey(record) ?? "");
            if (!key) return;
            this.selectedKey = key;
            this.updateSelectedRows();
            this.onSelect(record);
        }

        setSelectedKey(value) {
            this.selectedKey = String(value ?? "");
            this.updateSelectedRows();
        }

        clearSelection() {
            this.setSelectedKey("");
        }

        setPageSize(value, options = {}) {
            this.state.pageSize = Math.max(1, numeric(value, this.state.pageSize));
            if (this.pageSizeSelect) this.pageSizeSelect.value = String(this.state.pageSize);
            if (options.reload !== false) this.load({ resetPage: true });
        }

        setSort(sortBy, sortDirection = "asc", options = {}) {
            const nextSortBy = String(sortBy || "");
            if (!nextSortBy) return;
            this.state.sortBy = nextSortBy;
            this.state.sortDirection = sortDirection === "desc" ? "desc" : "asc";
            this.updateSortHeaders();
            if (options.reload !== false) this.load({ resetPage: options.resetPage !== false });
        }

        updateSelectedRows() {
            this.body.querySelectorAll("[data-grid-row-key]").forEach((row) => {
                const selected = Boolean(this.selectedKey && row.dataset.gridRowKey === this.selectedKey);
                row.classList.toggle("is-selected", selected);
                row.setAttribute("aria-selected", selected ? "true" : "false");
            });
        }

        pageButton(label, page, options = {}) {
            return Common.dom.element("button", {
                className: `grid-page-button${options.current ? " is-current" : ""}`,
                text: label,
                type: "button",
                attrs: {
                    "data-grid-page": page,
                    "aria-label": options.ariaLabel,
                    "aria-current": options.current ? "page" : null,
                    disabled: options.disabled ? "" : null
                }
            });
        }

        renderPagination() {
            if (!this.pagination) return;
            Common.dom.clear(this.pagination);
            const { page, totalPages } = this.state;
            this.pagination.append(
                this.pageButton("처음", 1, { disabled: page <= 1, ariaLabel: "첫 페이지" }),
                this.pageButton("이전", page - 1, { disabled: page <= 1, ariaLabel: "이전 페이지" })
            );

            const start = Math.max(1, Math.min(page - 2, totalPages - 4));
            const end = Math.min(totalPages, start + 4);
            for (let number = start; number <= end; number += 1) {
                this.pagination.appendChild(this.pageButton(String(number), number, {
                    current: number === page,
                    ariaLabel: `${number} 페이지`
                }));
            }

            this.pagination.append(
                this.pageButton("다음", page + 1, { disabled: page >= totalPages, ariaLabel: "다음 페이지" }),
                this.pageButton("마지막", totalPages, { disabled: page >= totalPages, ariaLabel: "마지막 페이지" })
            );
        }

        updateSortHeaders() {
            this.root.querySelectorAll("[data-grid-sort]").forEach((button) => {
                const active = button.dataset.gridSort === this.state.sortBy;
                const header = button.closest("th");
                const indicator = button.querySelector("[data-grid-sort-indicator]");
                header?.setAttribute("aria-sort", active
                    ? (this.state.sortDirection === "asc" ? "ascending" : "descending")
                    : "none");
                button.classList.toggle("is-active", active);
                if (indicator) indicator.textContent = active
                    ? (this.state.sortDirection === "asc" ? "▲" : "▼")
                    : "↕";
            });
        }

        updateStatus() {
            const { page, pageSize, total, rows } = this.state;
            const start = total ? ((page - 1) * pageSize) + 1 : 0;
            const end = total ? start + rows.length - 1 : 0;
            const message = typeof this.formatStatus === "function"
                ? this.formatStatus({ ...this.state, start, end })
                : `총 ${total.toLocaleString("ko-KR")}건 중 ${start.toLocaleString("ko-KR")}-${end.toLocaleString("ko-KR")}건`;
            Common.ui.setInlineStatus(this.status, message);
        }

        getState() {
            return { ...this.state, rows: [...this.state.rows] };
        }

        destroy() {
            if (this.destroyed) return;
            this.destroyed = true;
            this.requestId += 1;
            this.loadController?.abort();
            this.eventController.abort();
        }
    }

    class ClientTablePager {
        constructor(table, options = {}) {
            this.table = table;
            this.body = table?.tBodies?.[0] || null;
            this.wrap = table?.closest(".table-wrap") || null;
            this.pageSize = Math.max(1, numeric(options.pageSize, 100));
            this.page = 1;
            this.destroyed = false;
            this.eventController = new AbortController();
            this.pagination = document.createElement("nav");
            this.pagination.className = "grid-pagination client-grid-pagination";
            this.pagination.setAttribute("aria-label", `${table?.getAttribute("aria-label") || "목록"} 페이지`);

            if (!this.table || !this.body || !this.wrap) {
                throw new Error("ClientTablePager requires a table body inside .table-wrap.");
            }

            this.table.dataset.clientGridEnhanced = "true";
            this.wrap.classList.add("grid-five-row-viewport");
            this.wrap.insertAdjacentElement("afterend", this.pagination);
            this.pagination.addEventListener("click", (event) => {
                const button = event.target.closest("button[data-client-grid-page]");
                if (!button || button.disabled) return;
                const nextPage = numeric(button.dataset.clientGridPage, this.page);
                if (nextPage === this.page) return;
                this.page = nextPage;
                this.render();
            }, { signal: this.eventController.signal });
            this.observer = new MutationObserver(() => {
                this.page = 1;
                this.render();
            });
            this.observer.observe(this.body, { childList: true });
            this.render();
        }

        pageButton(label, page, options = {}) {
            return Common.dom.element("button", {
                className: `grid-page-button${options.current ? " is-current" : ""}`,
                text: label,
                type: "button",
                attrs: {
                    "data-client-grid-page": page,
                    "aria-label": options.ariaLabel,
                    "aria-current": options.current ? "page" : null,
                    disabled: options.disabled ? "" : null
                }
            });
        }

        render() {
            if (this.destroyed) return;
            const rows = Array.from(this.body.rows);
            const totalPages = Math.max(1, Math.ceil(rows.length / this.pageSize));
            this.page = Math.min(Math.max(1, this.page), totalPages);
            const startIndex = (this.page - 1) * this.pageSize;
            const endIndex = startIndex + this.pageSize;
            rows.forEach((row, index) => {
                row.hidden = index < startIndex || index >= endIndex;
            });

            Common.dom.clear(this.pagination);
            this.pagination.hidden = totalPages <= 1;
            if (totalPages <= 1) return;
            this.pagination.append(
                this.pageButton("처음", 1, { disabled: this.page <= 1, ariaLabel: "첫 페이지" }),
                this.pageButton("이전", this.page - 1, { disabled: this.page <= 1, ariaLabel: "이전 페이지" })
            );
            const pageStart = Math.max(1, Math.min(this.page - 2, totalPages - 4));
            const pageEnd = Math.min(totalPages, pageStart + 4);
            for (let number = pageStart; number <= pageEnd; number += 1) {
                this.pagination.appendChild(this.pageButton(String(number), number, {
                    current: number === this.page,
                    ariaLabel: `${number} 페이지`
                }));
            }
            this.pagination.append(
                this.pageButton("다음", this.page + 1, { disabled: this.page >= totalPages, ariaLabel: "다음 페이지" }),
                this.pageButton("마지막", totalPages, { disabled: this.page >= totalPages, ariaLabel: "마지막 페이지" })
            );
        }

        destroy() {
            if (this.destroyed) return;
            this.destroyed = true;
            this.observer.disconnect();
            this.eventController.abort();
            Array.from(this.body.rows).forEach((row) => { row.hidden = false; });
            this.wrap.classList.remove("grid-five-row-viewport");
            delete this.table.dataset.clientGridEnhanced;
            this.pagination.remove();
        }
    }

    window.Common = window.Common || {};
    window.Common.grid = {
        create(options) {
            return new ServerDataGrid(options);
        },
        enhanceClientTables(root, options = {}) {
            return Array.from(root?.querySelectorAll('table.data-table:not([data-grid-pagination="off"])') || [])
                .filter((table) => table.dataset.clientGridEnhanced !== "true")
                .map((table) => new ClientTablePager(table, options));
        },
        ServerDataGrid,
        ClientTablePager
    };
})();
