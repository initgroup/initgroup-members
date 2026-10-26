(function() {
    "use strict";

    let controller = null;
    let root = null;
    let notices = [];
    let selectedNoticeId = "";
    let attachments = [];
    let detailRequestId = 0;
    let attachmentRequestId = 0;

    function query(selector) {
        return root?.querySelector(selector) || null;
    }

    function value(row, ...keys) {
        return Common.data.pick(row, ...keys);
    }

    function noticeId(row) {
        return value(row, "noticeId", "NOTICE_ID", "id", "ID");
    }

    function setValue(selector, nextValue) {
        const element = query(selector);
        if (element) element.value = nextValue ?? "";
    }

    function renderList() {
        const list = query("#noticeSelectionList");
        Common.dom.clear(list);

        if (!notices.length) {
            list.appendChild(Common.dom.element("div", {
                className: "empty-state",
                text: "조회된 공지사항이 없습니다."
            }));
            return;
        }

        notices.forEach((notice) => {
            const id = noticeId(notice);
            const button = Common.dom.element("button", {
                className: `selection-item${String(id) === String(selectedNoticeId) ? " is-selected" : ""}`,
                type: "button"
            });
            button.append(
                Common.dom.element("strong", { text: value(notice, "title", "TITLE") || "제목 없음" }),
                Common.dom.element("small", {
                    text: `${String(value(notice, "useYn", "USE_YN") || "Y") === "Y" ? "사용" : "중지"} · ${
                        Common.format.dateTime(value(notice, "postStartAt", "POST_START_AT", "createdAt", "CREATED_AT"))
                    }`
                })
            );
            button.addEventListener("click", () => loadNotice(id), { signal: controller.signal });
            list.appendChild(button);
        });
    }

    function renderAttachments() {
        const list = query("#noticeAttachmentList");
        Common.dom.clear(list);
        if (!attachments.length) {
            list.appendChild(Common.dom.element("span", {
                className: "field-help",
                text: selectedNoticeId ? "첨부 파일이 없습니다." : "공지를 저장하면 첨부 파일을 추가할 수 있습니다."
            }));
            return;
        }

        attachments.forEach((file) => {
            const fileId = value(file, "fileId", "FILE_ID", "id", "ID");
            if (!fileId) return;
            const fileName = value(file, "fileName", "FILE_NAME", "name", "NAME") || "첨부 파일";
            const downloadButton = Common.dom.element("button", {
                className: "attachment-button",
                text: `받기 · ${fileName}`,
                type: "button"
            });
            const deleteButton = Common.dom.element("button", {
                className: "attachment-button",
                text: `삭제 · ${fileName}`,
                type: "button"
            });
            downloadButton.addEventListener("click", () => {
                Common.api.download(`/admin/notices/attachments/${encodeURIComponent(fileId)}/download`, fileName)
                    .catch((error) => Common.ui.toast(error.message || "첨부 파일을 내려받지 못했습니다.", "error"));
            }, { signal: controller.signal });
            deleteButton.addEventListener("click", () => deleteAttachment(fileId, fileName), {
                signal: controller.signal
            });
            list.append(downloadButton, deleteButton);
        });
    }

    function fillForm(notice = {}) {
        const id = noticeId(notice) || "";
        selectedNoticeId = String(id);
        setValue("#noticeId", id);
        setValue("#noticeTitle", value(notice, "title", "TITLE") || "");
        setValue("#noticeType", value(notice, "noticeType", "NOTICE_TYPE") || "INFO");
        setValue("#noticeContent", value(notice, "content", "CONTENT") || "");
        setValue("#noticeSortOrder", value(notice, "sortOrder", "SORT_ORDER") ?? 0);
        setValue("#noticePostStartAt", Common.format.dateTimeLocal(value(notice, "postStartAt", "POST_START_AT")));
        setValue("#noticePostEndAt", Common.format.dateTimeLocal(value(notice, "postEndAt", "POST_END_AT")));
        setValue("#noticePinYn", value(notice, "pinYn", "PIN_YN") || "N");
        setValue("#noticeUseYn", value(notice, "useYn", "USE_YN") || "Y");

        query("#noticeEditorDescription").textContent = id
            ? `공지 #${id}을(를) 수정하고 있습니다.`
            : "새 공지를 작성하고 있습니다.";
        query("#deleteNoticeButton").hidden = !id;
        Common.ui.setInlineStatus(query("#noticeEditorStatus"), "");
        attachments = [];
        renderAttachments();
        renderList();
    }

    function newNotice() {
        detailRequestId += 1;
        attachmentRequestId += 1;
        fillForm({
            noticeType: "INFO",
            sortOrder: 0,
            pinYn: "N",
            useYn: "Y"
        });
        Common.ui.setInlineStatus(query("#noticeAttachmentStatus"), "새 공지를 먼저 저장해 주세요.");
        query("#noticeTitle")?.focus();
    }

    async function loadList() {
        const status = query("#noticeListStatus");
        Common.ui.setInlineStatus(status, "공지사항을 불러오고 있습니다.");
        try {
            const queryString = Common.api.query({
                keyword: query("#noticeKeyword").value.trim(),
                useYn: query("#noticeUseFilter").value,
                limit: 200
            });
            const payload = await Common.api.request(`/admin/notices${queryString}`, {
                method: "GET",
                signal: controller.signal,
                showLoading: false
            });
            notices = Common.data.rows(payload, "notices", "items", "rows");
            renderList();
            Common.ui.setInlineStatus(status, `${notices.length.toLocaleString("ko-KR")}건을 조회했습니다.`);
        } catch (error) {
            if (error?.name === "AbortError") return;
            notices = [];
            renderList();
            Common.ui.setInlineStatus(status, error.message || "공지사항을 불러오지 못했습니다.", "error");
        }
    }

    async function loadNotice(id) {
        if (!id) return;
        const requestId = ++detailRequestId;
        attachmentRequestId += 1;
        try {
            const payload = await Common.api.request(`/admin/notices/${encodeURIComponent(id)}`, {
                method: "GET",
                signal: controller.signal,
                showLoading: false
            });
            if (requestId !== detailRequestId) return;
            fillForm(Common.data.get(payload) || {});
            await loadAttachments(id);
            Common.ui.revealEditor(query("#noticeEditorTitle")?.closest(".panel"));
        } catch (error) {
            if (requestId !== detailRequestId) return;
            if (error?.name !== "AbortError") {
                Common.ui.toast(error.message || "공지사항 상세를 불러오지 못했습니다.", "error");
            }
        }
    }

    function formPayload() {
        return {
            title: query("#noticeTitle").value.trim(),
            noticeType: query("#noticeType").value,
            content: query("#noticeContent").value,
            sortOrder: Number(query("#noticeSortOrder").value || 0),
            postStartAt: query("#noticePostStartAt").value || null,
            postEndAt: query("#noticePostEndAt").value || null,
            pinYn: query("#noticePinYn").value,
            useYn: query("#noticeUseYn").value
        };
    }

    async function saveNotice(event) {
        event.preventDefault();
        const status = query("#noticeEditorStatus");
        const id = query("#noticeId").value;
        const payload = formPayload();
        Common.ui.setInlineStatus(status, "");

        if (!payload.title || !payload.content.trim()) {
            Common.ui.setInlineStatus(status, "제목과 내용을 입력해 주세요.", "error");
            return;
        }
        if (payload.postStartAt && payload.postEndAt && payload.postStartAt > payload.postEndAt) {
            Common.ui.setInlineStatus(status, "게시 종료 일시는 게시 시작 이후여야 합니다.", "error");
            return;
        }

        try {
            const response = await Common.api.request(
                id ? `/admin/notices/${encodeURIComponent(id)}` : "/admin/notices",
                {
                    method: id ? "PUT" : "POST",
                    body: payload,
                    signal: controller.signal,
                    loadingMessage: "공지사항을 저장하고 있습니다."
                }
            );
            const saved = Common.data.get(response) || {};
            const savedId = noticeId(saved) || id;
            Common.ui.toast("공지사항을 저장했습니다.", "success");
            await loadList();
            if (savedId) await loadNotice(savedId);
            else newNotice();
        } catch (error) {
            if (error?.name === "AbortError") return;
            Common.ui.setInlineStatus(status, error.message || "공지사항을 저장하지 못했습니다.", "error");
        }
    }

    async function deleteNotice() {
        const id = query("#noticeId").value;
        if (!id || !(await Common.ui.confirm(
            "선택한 공지사항을 삭제하시겠습니까?",
            { title: "공지사항 삭제", confirmText: "삭제", danger: true }
        ))) return;
        try {
            await Common.api.request(`/admin/notices/${encodeURIComponent(id)}`, {
                method: "DELETE",
                signal: controller.signal,
                loadingMessage: "공지사항을 삭제하고 있습니다."
            });
            Common.ui.toast("공지사항을 삭제했습니다.", "success");
            newNotice();
            await loadList();
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.toast(error.message || "공지사항을 삭제하지 못했습니다.", "error");
            }
        }
    }

    async function loadAttachments(id = selectedNoticeId) {
        const status = query("#noticeAttachmentStatus");
        const expectedNoticeId = String(id || "");
        if (expectedNoticeId && String(selectedNoticeId) !== expectedNoticeId) return;
        const requestId = ++attachmentRequestId;
        attachments = [];
        renderAttachments();
        if (!id) {
            Common.ui.setInlineStatus(status, "새 공지를 먼저 저장해 주세요.");
            return;
        }
        Common.ui.setInlineStatus(status, "첨부 파일을 불러오고 있습니다.");
        try {
            const payload = await Common.api.request(`/admin/notices/${encodeURIComponent(id)}/attachments`, {
                method: "GET",
                signal: controller.signal,
                showLoading: false
            });
            if (
                requestId !== attachmentRequestId
                || String(selectedNoticeId) !== expectedNoticeId
            ) {
                return;
            }
            attachments = Common.data.rows(payload, "attachments", "files", "items");
            renderAttachments();
            Common.ui.setInlineStatus(status, `${attachments.length.toLocaleString("ko-KR")}개의 첨부 파일이 있습니다.`);
        } catch (error) {
            if (
                requestId !== attachmentRequestId
                || String(selectedNoticeId) !== expectedNoticeId
            ) {
                return;
            }
            if (error?.name === "AbortError") return;
            Common.ui.setInlineStatus(status, error.message || "첨부 파일을 불러오지 못했습니다.", "error");
        }
    }

    async function uploadAttachment() {
        const id = query("#noticeId").value;
        const fileInput = query("#noticeAttachmentFile");
        const file = fileInput?.files?.[0];
        const status = query("#noticeAttachmentStatus");
        if (!id) {
            Common.ui.setInlineStatus(status, "새 공지를 먼저 저장해 주세요.", "error");
            return;
        }
        if (!file) {
            Common.ui.setInlineStatus(status, "추가할 파일을 선택해 주세요.", "error");
            return;
        }

        const formData = new FormData();
        formData.append("file", file);
        formData.append("sortOrder", String(Number(query("#noticeAttachmentSortOrder").value || 0)));
        try {
            await Common.api.request(`/admin/notices/${encodeURIComponent(id)}/attachments`, {
                method: "POST",
                body: formData,
                signal: controller.signal,
                loadingMessage: "첨부 파일을 저장하고 있습니다."
            });
            fileInput.value = "";
            Common.ui.toast("첨부 파일을 저장했습니다.", "success");
            await loadAttachments(id);
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.setInlineStatus(status, error.message || "첨부 파일을 저장하지 못했습니다.", "error");
            }
        }
    }

    async function deleteAttachment(fileId, fileName) {
        if (!fileId || !(await Common.ui.confirm(
            `"${fileName}" 파일을 삭제하시겠습니까?`,
            { title: "첨부 파일 삭제", confirmText: "삭제", danger: true }
        ))) return;
        try {
            await Common.api.request(`/admin/notices/attachments/${encodeURIComponent(fileId)}`, {
                method: "DELETE",
                signal: controller.signal,
                loadingMessage: "첨부 파일을 삭제하고 있습니다."
            });
            Common.ui.toast("첨부 파일을 삭제했습니다.", "success");
            await loadAttachments();
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.toast(error.message || "첨부 파일을 삭제하지 못했습니다.", "error");
            }
        }
    }

    window.Pages["admin-notices"] = {
        async init(context) {
            root = context.root;
            controller = new AbortController();
            query("#noticeSearchForm")?.addEventListener("submit", (event) => {
                event.preventDefault();
                loadList();
            }, { signal: controller.signal });
            query("#noticeForm")?.addEventListener("submit", saveNotice, { signal: controller.signal });
            query("#noticeForm")?.addEventListener("reset", () => window.setTimeout(newNotice, 0), {
                signal: controller.signal
            });
            query("#newNoticeButton")?.addEventListener("click", newNotice, { signal: controller.signal });
            query("#deleteNoticeButton")?.addEventListener("click", deleteNotice, { signal: controller.signal });
            query("#uploadNoticeAttachmentButton")?.addEventListener("click", uploadAttachment, {
                signal: controller.signal
            });
            newNotice();
            await loadList();
        },

        destroy() {
            detailRequestId += 1;
            attachmentRequestId += 1;
            controller?.abort();
            controller = null;
            root = null;
            notices = [];
            selectedNoticeId = "";
            attachments = [];
        }
    };
})();
