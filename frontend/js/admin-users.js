(function() {
    "use strict";

    let controller = null;
    let root = null;
    let users = [];
    let temporaryAccess = null;
    let reloadUsersAfterTemporaryDialog = false;
    let selectedUserId = null;
    let pendingPasswordResetUserId = null;
    let localPhotoUrl = null;
    let photoPreviewRequestId = 0;
    let userPage = 1;
    let userTotal = 0;
    let userTotalPages = 1;
    let departments = [];
    let historySequence = 0, historyItems = [], historyEditing = null, historyDirty = false, historyBusy = false, profileBaseline = "";
    const EMPLOYMENT_STATUS_LABELS = { ACTIVE: "재직", LEAVE: "휴직", RETIRED: "퇴직" };
    const EMPLOYMENT_TYPE_LABELS = {
        REGULAR: "정규직", CONTRACT: "계약직", EXECUTIVE: "임원",
        INTERN: "인턴", DISPATCH: "파견직", OTHER: "기타"
    };
    const TECHNICAL_GRADE_LABELS = {
        PROFESSIONAL_ENGINEER: "기술사", SPECIAL: "특급", ADVANCED: "고급",
        INTERMEDIATE: "중급", BEGINNER: "초급"
    };

    function query(selector) {
        return root?.querySelector(selector) || null;
    }

    function value(row, ...keys) {
        return Common.data.pick(row, ...keys);
    }

    function userId(row) {
        return value(row, "userId", "USER_ID", "id", "ID");
    }

    function cell(text = "", className = "") {
        return Common.dom.element("td", { text: text ?? "", className });
    }

    function passwordChangeLabel(passwordChangeYn) {
        return String(passwordChangeYn || "N").toUpperCase() === "Y" ? "변경 완료" : "변경 필요";
    }

    function dateValue(nextValue) {
        return nextValue ? String(nextValue).slice(0, 10) : "";
    }

    function setValue(selector, nextValue) {
        const element = query(selector);
        if (element) element.value = nextValue ?? "";
    }

    async function loadDepartmentConfig() {
        const response = await fetch("/config/departments.json", {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal
        });
        if (!response.ok) throw new Error("부서 설정을 불러오지 못했습니다.");
        const payload = await response.json();
        departments = Array.isArray(payload?.departments)
            ? [...payload.departments].sort((left, right) => Number(left.displayOrder) - Number(right.displayOrder))
            : [];
        if (!departments.length) throw new Error("등록된 부서 설정이 없습니다.");
        const select = query("#userDepartmentCode");
        select.replaceChildren(Common.dom.element("option", { text: "선택 안 함", attrs: { value: "" } }));
        departments.forEach((department) => {
            select.appendChild(Common.dom.element("option", {
                text: department.label,
                attrs: { value: department.code }
            }));
        });
    }

    function departmentCode(row) {
        const code = String(value(row, "departmentCode", "DEPARTMENT_CODE") || "").toUpperCase();
        if (departments.some((department) => department.code === code)) return code;
        const label = String(value(row, "departmentName", "DEPARTMENT_NAME") || "");
        return departments.find((department) => department.label === label)?.code || "";
    }

    function updateAge() {
        const birthDate = query("#userBirthDate")?.value;
        if (!birthDate) {
            setValue("#userAge", "-");
            return;
        }
        const [year, month, day] = birthDate.split("-").map(Number);
        const today = new Date();
        let age = today.getFullYear() - year;
        if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
        setValue("#userAge", age >= 0 ? `만 ${age}세` : "-");
    }

    function clearLocalPhotoUrl() {
        if (localPhotoUrl) URL.revokeObjectURL(localPhotoUrl);
        localPhotoUrl = null;
    }

    async function setPhotoPreview(row = {}) {
        const requestId = ++photoPreviewRequestId;
        clearLocalPhotoUrl();
        const id = userId(row);
        const hasPhoto = Boolean(value(row, "photoFileName", "PHOTO_FILE_NAME"));
        const image = query("#userPhotoPreview");
        const placeholder = query("#userPhotoPlaceholder");
        query("#userPhotoFile").value = "";
        query("#userPhotoFile").disabled = !id;
        query("#uploadUserPhotoButton").disabled = !id;
        query("#deleteUserPhotoButton").hidden = !id || !hasPhoto;
        if (id && hasPhoto) {
            const version = encodeURIComponent(value(row, "photoUpdatedAt", "PHOTO_UPDATED_AT") || Date.now());
            image.removeAttribute("src");
            image.hidden = true;
            placeholder.hidden = false;
            try {
                const photoBlob = await Common.api.blob(
                    `/admin/users/${encodeURIComponent(id)}/photo?v=${version}`,
                    { signal: controller.signal, showLoading: false }
                );
                if (requestId !== photoPreviewRequestId) return;
                localPhotoUrl = URL.createObjectURL(photoBlob);
                image.src = localPhotoUrl;
                image.hidden = false;
                placeholder.hidden = true;
            } catch (error) {
                if (error?.name === "AbortError" || requestId !== photoPreviewRequestId) return;
                image.removeAttribute("src");
                image.hidden = true;
                placeholder.hidden = false;
                Common.ui.setInlineStatus(
                    query("#userEditorStatus"),
                    error.message || "저장된 프로필 사진을 불러오지 못했습니다.",
                    "error"
                );
            }
        } else {
            image.removeAttribute("src");
            image.hidden = true;
            placeholder.hidden = false;
        }
    }

    function fillUserForm(row = {}) {
        const id = userId(row) || "";
        const passwordChangeYn = value(row, "passwordChangeYn", "PASSWORD_CHANGE_YN");
        query("#userForm")?.reset();
        query("#userId").value = id;
        query("#userLoginId").value = value(row, "loginId", "LOGIN_ID") || "";
        query("#userName").value = value(row, "userName", "USER_NAME") || "";
        query("#userEmail").value = value(row, "email", "EMAIL") || "";
        query("#userRoleCode").value = String(value(row, "roleCode", "ROLE_CODE") || "USER").toUpperCase();
        query("#userActiveYn").value = String(value(row, "useYn", "USE_YN") || "Y").toUpperCase();
        query("#userPasswordChangeStatus").value = id ? passwordChangeLabel(passwordChangeYn) : "-";
        setValue("#userEmployeeNo", value(row, "employeeNo", "EMPLOYEE_NO"));
        setValue("#userGenderCode", String(value(row, "genderCode", "GENDER_CODE") || "").toUpperCase());
        setValue("#userBirthDate", dateValue(value(row, "birthDate", "BIRTH_DATE")));
        setValue("#userBirthCalendarCode", String(value(row, "birthCalendarCode", "BIRTH_CALENDAR_CODE") || "SOLAR").toUpperCase());
        setValue("#userHireDate", dateValue(value(row, "hireDate", "HIRE_DATE")));
        setValue("#userProfileEffectiveDate", "");
        setValue("#userRetirementDate", dateValue(value(row, "retirementDate", "RETIREMENT_DATE")));
        setValue("#userEmploymentStatusCode", String(value(row, "employmentStatusCode", "EMPLOYMENT_STATUS_CODE") || "ACTIVE").toUpperCase());
        setValue("#userEmploymentTypeCode", String(value(row, "employmentTypeCode", "EMPLOYMENT_TYPE_CODE") || "").toUpperCase());
        setValue("#userDepartmentCode", departmentCode(row));
        setValue("#userPositionName", value(row, "positionName", "POSITION_NAME"));
        setValue("#userJobTitle", value(row, "jobTitle", "JOB_TITLE"));
        setValue("#userTechnicalGradeCode", String(value(row, "technicalGradeCode", "TECHNICAL_GRADE_CODE") || "").toUpperCase());
        setValue("#userCareerMonths", value(row, "careerMonths", "CAREER_MONTHS"));
        setValue("#userWorkLocation", value(row, "workLocation", "WORK_LOCATION"));
        setValue("#userMobilePhone", value(row, "mobilePhone", "MOBILE_PHONE"));
        setValue("#userOfficePhone", value(row, "officePhone", "OFFICE_PHONE"));
        setValue("#userHrNote", value(row, "hrNote", "HR_NOTE"));
        updateAge();
        setPhotoPreview(row);
        query("#userEditorTitle").textContent = id ? "임직원 상세 및 수정" : "임직원 등록";
        query("#userEditorDescription").textContent = id
            ? `${query("#userName").value || query("#userLoginId").value} 계정을 수정하고 있습니다.`
            : "새 임직원을 등록하고 있습니다.";
        query("#deleteUserButton").hidden = !id;
        query("#resetUserPasswordButton").hidden = !id;
        Common.ui.setInlineStatus(query("#userEditorStatus"), "");
        selectedUserId = id ? String(id) : null;
        updateSelectedRow();
        profileBaseline = profileSnapshot();
        loadHistory(id);
    }

    const historyStatus = (message, type = "") => Common.ui.setInlineStatus(query("#adminUsersHistoryStatus"), message, type);
    const profileSnapshot = () => JSON.stringify([...root.querySelectorAll("#userForm input:not([type=file]), #userForm select, #userForm textarea")].map((n) => n.value));

    function editHistory(item = null) {
        historyEditing = item; historyDirty = false;
        const latest = item || historyItems.at(-1) || {};
        query("#adminUsersHistoryEditorTitle").textContent = item ? `${item.effective_from} 이력 수정` : "이력 추가";
        setValue("#adminUsersHistoryFrom", item?.effective_from || "");
        setValue("#adminUsersHistoryDept", latest.department_code || "UNASSIGNED");
        setValue("#adminUsersHistoryType", latest.employment_type_code || "REGULAR");
        setValue("#adminUsersHistoryState", latest.employment_status_code || "ACTIVE");
        setValue("#adminUsersHistoryHire", latest.hire_date || "");
        setValue("#adminUsersHistoryRetire", latest.retirement_date || "");
    }

    async function loadHistory(id) {
        const seq = ++historySequence;
        historyItems = []; editHistory();
        query("#adminUsersHistoryRows").replaceChildren();
        query("#adminUsersHistoryPanel").hidden = !id;
        query("#adminUsersHistoryJump").hidden = !id;
        query("#adminUsersHistoryForm").inert = true;
        if (!id) return;
        historyStatus("이력을 불러오고 있습니다.");
        try {
            const result = Common.data.get(await Common.api.request(`/admin/users/${encodeURIComponent(id)}/history`, { signal: controller.signal, showLoading: false }));
            if (!root || seq !== historySequence || String(id) !== selectedUserId) return;
            historyItems = result.items;
            historyItems.forEach((item) => {
                const tr = Common.dom.element("tr");
                const locked = result.lastClosedMonth && item.effective_from.slice(0, 7) <= result.lastClosedMonth;
                tr.append(cell(item.effective_from), cell(item.department_name), cell(EMPLOYMENT_TYPE_LABELS[item.employment_type_code]), cell(EMPLOYMENT_STATUS_LABELS[item.employment_status_code]), cell(item.hire_date || "—"), cell(item.retirement_date || "—"), cell(item.source_code === "BASELINE" ? "초기값 · 검토 필요" : "확인된 이력"));
                const actions = cell();
                ["수정", "삭제"].forEach((label) => {
                    const button = Common.dom.element("button", { text: label, className: "button button-secondary button-small", type: "button" });
                    button.disabled = Boolean(locked) || (label === "삭제" && historyItems.length <= 1);
                    button.addEventListener("click", async () => {
                        if (historyBusy) return;
                        if (label === "삭제") { await saveHistory(null, item); return; }
                        if (historyDirty && !(await Common.ui.confirm("입력 중인 이력을 버리고 다른 이력을 수정할까요?"))) return;
                        editHistory(item); query("#adminUsersHistoryFrom").focus();
                    }, { signal: controller.signal });
                    actions.append(button);
                });
                if (locked) actions.append(document.createTextNode(" 마감 보존"));
                tr.append(actions); query("#adminUsersHistoryRows").append(tr);
            });
            editHistory(); query("#adminUsersHistoryForm").inert = false;
            historyStatus(result.lastClosedMonth ? `${result.lastClosedMonth}까지 마감된 이력은 변경할 수 없습니다.` : "이력 적용일을 기준으로 사업부·고용형태별 실적을 계산합니다.");
        } catch (error) { if (seq === historySequence && error.name !== "AbortError") historyStatus(error.message || "이력 조회 실패", "error"); }
    }

    async function saveHistory(event, deletion = null) {
        event?.preventDefault();
        if (historyBusy || !selectedUserId) return;
        if (profileSnapshot() !== profileBaseline) { historyStatus("위 임직원 기본정보의 변경사항을 먼저 저장해 주세요.", "error"); return; }
        const id = selectedUserId;
        if (deletion && !(await Common.ui.confirm(`${deletion.effective_from} 이력을 삭제할까요? 이전 이력의 적용기간이 연장됩니다.`))) return;
        if (id !== selectedUserId) return;
        historyBusy = true; query("#userEditorPanel").inert = true;
        try {
            const base = `/admin/users/${encodeURIComponent(id)}/history`;
            if (deletion) await Common.api.request(`${base}/${deletion.effective_from}?versionToken=${encodeURIComponent(deletion.version_token)}`, { method: "DELETE", signal: controller.signal });
            else await Common.api.request(`${base}${historyEditing ? `/${historyEditing.effective_from}` : ""}`, { method: historyEditing ? "PUT" : "POST", signal: controller.signal, body: {
                effectiveFrom: query("#adminUsersHistoryFrom").value, department: query("#adminUsersHistoryDept").value,
                employmentType: query("#adminUsersHistoryType").value, employmentStatus: query("#adminUsersHistoryState").value,
                hireDate: query("#adminUsersHistoryHire").value || null, retirementDate: query("#adminUsersHistoryRetire").value || null,
                versionToken: historyEditing?.version_token || null
            } });
            historyDirty = false;
            if (root && id === selectedUserId) { await loadUsers({ historySaved: true }); Common.ui.toast("소속·고용 이력을 반영했습니다.", "success"); }
        } catch (error) { if (error.name !== "AbortError") historyStatus(error.message || "이력 처리 실패", "error"); }
        finally { historyBusy = false; if (root) query("#userEditorPanel").inert = false; }
    }

    function updateSelectedRow() {
        root?.querySelectorAll("#userTableBody tr[data-user-id]").forEach((row) => {
            const selected = Boolean(selectedUserId) && row.dataset.userId === selectedUserId;
            row.classList.toggle("is-selected", selected);
            row.setAttribute("aria-selected", String(selected));
        });
    }

    async function selectUser(row) {
        if (historyBusy) return;
        if (historyDirty && !(await Common.ui.confirm("입력 중인 이력을 버리고 이동할까요?"))) return;
        fillUserForm(row);
        Common.ui.revealEditor(query("#userEditorPanel"));
    }

    function renderUsers() {
        const body = query("#userTableBody");
        Common.dom.clear(body);

        if (!users.length) {
            const row = Common.dom.element("tr");
            const empty = cell("조회된 임직원이 없습니다.");
            empty.colSpan = 15;
            empty.style.textAlign = "center";
            row.appendChild(empty);
            body.appendChild(row);
            return;
        }

        users.forEach((row) => {
            const id = userId(row);
            const role = String(value(row, "roleCode", "ROLE_CODE") || "USER").toUpperCase();
            const useYn = String(value(row, "useYn", "USE_YN") || "Y").toUpperCase();
            const passwordChangeYn = String(value(row, "passwordChangeYn", "PASSWORD_CHANGE_YN") || "N").toUpperCase();
            const employmentStatus = String(
                value(row, "employmentStatusCode", "EMPLOYMENT_STATUS_CODE") || "ACTIVE"
            ).toUpperCase();
            const employmentType = String(
                value(row, "employmentTypeCode", "EMPLOYMENT_TYPE_CODE") || ""
            ).toUpperCase();
            const tableRow = Common.dom.element("tr", {
                attrs: { tabindex: "0", "data-user-id": String(id), "aria-selected": "false" }
            });
            tableRow.append(
                cell(id),
                cell(value(row, "employeeNo", "EMPLOYEE_NO") || "-"),
                cell(value(row, "loginId", "LOGIN_ID") || "-"),
                cell(value(row, "userName", "USER_NAME") || "-", "user-name-cell"),
                cell(value(row, "departmentName", "DEPARTMENT_NAME") || "-"),
                cell(value(row, "positionName", "POSITION_NAME") || "-"),
                cell(value(row, "jobTitle", "JOB_TITLE") || "-"),
                cell(TECHNICAL_GRADE_LABELS[String(value(row, "technicalGradeCode", "TECHNICAL_GRADE_CODE") || "").toUpperCase()] || "-"),
                cell(value(row, "careerMonths", "CAREER_MONTHS") ?? "-"),
                cell(EMPLOYMENT_STATUS_LABELS[employmentStatus] || employmentStatus),
                cell(EMPLOYMENT_TYPE_LABELS[employmentType] || "-"),
                cell(value(row, "email", "EMAIL") || "-"),
                cell(role === "ADMIN" ? "관리자" : "사용자"),
                cell(useYn === "Y" ? "사용" : "중지"),
                cell(passwordChangeLabel(passwordChangeYn))
            );
            body.appendChild(tableRow);
        });
        updateSelectedRow();
    }

    function userPageButton(label, page, options = {}) {
        return Common.dom.element("button", {
            className: `grid-page-button${options.current ? " is-current" : ""}`,
            text: label,
            type: "button",
            attrs: {
                "data-user-page": page,
                "aria-label": options.ariaLabel,
                "aria-current": options.current ? "page" : null,
                disabled: options.disabled ? "" : null
            }
        });
    }

    function renderUserPagination() {
        const pagination = query("#userPagination");
        Common.dom.clear(pagination);
        pagination.append(
            userPageButton("처음", 1, { disabled: userPage <= 1, ariaLabel: "첫 페이지" }),
            userPageButton("이전", userPage - 1, { disabled: userPage <= 1, ariaLabel: "이전 페이지" })
        );
        const start = Math.max(1, Math.min(userPage - 2, userTotalPages - 4));
        const end = Math.min(userTotalPages, start + 4);
        for (let number = start; number <= end; number += 1) {
            pagination.appendChild(userPageButton(String(number), number, {
                current: number === userPage,
                ariaLabel: `${number} 페이지`
            }));
        }
        pagination.append(
            userPageButton("다음", userPage + 1, { disabled: userPage >= userTotalPages, ariaLabel: "다음 페이지" }),
            userPageButton("마지막", userTotalPages, { disabled: userPage >= userTotalPages, ariaLabel: "마지막 페이지" })
        );
    }

    async function loadUsers(options = {}) {
        if (historyBusy && !options.historySaved) return;
        if (historyDirty && !(await Common.ui.confirm("입력 중인 이력을 버리고 목록을 조회할까요?"))) return;
        if (options.resetPage) userPage = 1;
        const status = query("#userListStatus");
        Common.ui.setInlineStatus(status, "임직원 목록을 불러오고 있습니다.");
        try {
            const queryString = Common.api.query({
                keyword: query("#userKeyword").value.trim(),
                employmentTypeCode: query("#userEmploymentTypeFilter").value,
                useYn: query("#userUseYn").value,
                page: userPage,
                pageSize: query("#userLimit").value
            });
            const payload = await Common.api.request(`/admin/users${queryString}`, {
                method: "GET",
                signal: controller.signal,
                showLoading: false
            });
            const data = Common.data.get(payload) || {};
            users = Common.data.rows(payload, "users", "items", "rows");
            userPage = Number(data.page || userPage);
            userTotal = Number(data.total ?? payload?.total ?? users.length);
            userTotalPages = Math.max(1, Number(data.totalPages || Math.ceil(userTotal / 100) || 1));
            if (!users.length && userTotal > 0 && userPage > userTotalPages) {
                userPage = userTotalPages;
                await loadUsers();
                return;
            }
            renderUsers();
            renderUserPagination();
            if (selectedUserId) {
                const selectedUser = users.find((row) => String(userId(row)) === selectedUserId);
                if (selectedUser) fillUserForm(selectedUser);
                else fillUserForm();
            }
            const start = userTotal ? ((userPage - 1) * 100) + 1 : 0;
            const end = userTotal ? start + users.length - 1 : 0;
            Common.ui.setInlineStatus(status, `총 ${userTotal.toLocaleString("ko-KR")}명 중 ${start.toLocaleString("ko-KR")}-${end.toLocaleString("ko-KR")}명`);
        } catch (error) {
            if (error?.name === "AbortError") return;
            users = [];
            userTotal = 0;
            userTotalPages = 1;
            renderUsers();
            renderUserPagination();
            Common.ui.setInlineStatus(status, error.message || "임직원 목록을 불러오지 못했습니다.", "error");
        }
    }

    function userPayload() {
        return {
            loginId: query("#userLoginId").value.trim(),
            userName: query("#userName").value.trim(),
            email: query("#userEmail").value.trim(),
            roleCode: query("#userRoleCode").value,
            useYn: query("#userActiveYn").value,
            employeeNo: query("#userEmployeeNo").value.trim() || null,
            genderCode: query("#userGenderCode").value || null,
            birthDate: query("#userBirthDate").value || null,
            birthCalendarCode: query("#userBirthCalendarCode").value,
            hireDate: query("#userHireDate").value || null,
            profileEffectiveDate: query("#userProfileEffectiveDate").value || null,
            retirementDate: query("#userRetirementDate").value || null,
            employmentStatusCode: query("#userEmploymentStatusCode").value,
            employmentTypeCode: query("#userEmploymentTypeCode").value || null,
            departmentCode: query("#userDepartmentCode").value || null,
            positionName: query("#userPositionName").value.trim() || null,
            jobTitle: query("#userJobTitle").value.trim() || null,
            workLocation: query("#userWorkLocation").value.trim() || null,
            mobilePhone: query("#userMobilePhone").value.trim() || null,
            officePhone: query("#userOfficePhone").value.trim() || null,
            hrNote: query("#userHrNote").value.trim() || null
            , technicalGradeCode: query("#userTechnicalGradeCode").value || null
            , careerMonths: query("#userCareerMonths").value === "" ? null : Number(query("#userCareerMonths").value)
        };
    }

    function validateUserForm(form) {
        if (!form.reportValidity()) return false;
        const birthDate = query("#userBirthDate").value;
        const today = new Date().toISOString().slice(0, 10);
        if (birthDate && birthDate > today) {
            Common.ui.setInlineStatus(query("#userEditorStatus"), "생년월일은 오늘보다 늦을 수 없습니다.", "error");
            query("#userBirthDate").focus();
            return false;
        }
        const hireDate = query("#userHireDate").value;
        const retirementDate = query("#userRetirementDate").value;
        if (hireDate && retirementDate && retirementDate < hireDate) {
            Common.ui.setInlineStatus(query("#userEditorStatus"), "퇴사일은 입사일보다 빠를 수 없습니다.", "error");
            query("#userRetirementDate").focus();
            return false;
        }
        return true;
    }

    async function saveUser(event) {
        event.preventDefault();
        if (historyBusy) return;
        if (historyDirty) {
            Common.ui.setInlineStatus(query("#userEditorStatus"), "입력 중인 이력을 저장하거나 ‘새 이력 입력’으로 취소한 뒤 기본정보를 저장해 주세요.", "error");
            return;
        }
        const form = event.currentTarget;
        if (!validateUserForm(form)) return;
        const id = query("#userId").value;
        const button = query("#saveUserButton");
        const status = query("#userEditorStatus");
        button.disabled = true;
        Common.ui.setInlineStatus(status, id ? "임직원 정보를 저장하고 있습니다." : "임직원을 등록하고 있습니다.");
        try {
            const payload = await Common.api.request(id ? `/admin/users/${encodeURIComponent(id)}` : "/admin/users", {
                method: id ? "PATCH" : "POST",
                body: userPayload(),
                signal: controller.signal,
                loadingMessage: id ? "임직원 정보를 저장하고 있습니다." : "임직원을 등록하고 있습니다."
            });
            const data = Common.data.get(payload) || {};
            Common.ui.toast(id ? "임직원 정보를 저장했습니다." : "임직원을 등록했습니다.", "success");
            if (id) {
                selectedUserId = String(id);
                await loadUsers();
            } else {
                const password = value(data, "temporaryPassword", "TEMPORARY_PASSWORD", "password", "PASSWORD");
                if (!password) throw new Error("서버 응답에서 임시 비밀번호를 확인하지 못했습니다.");
                fillUserForm(data);
                showTemporaryPassword(password, data);
                reloadUsersAfterTemporaryDialog = true;
            }
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.setInlineStatus(status, error.message || "임직원 정보를 저장하지 못했습니다.", "error");
            }
        } finally {
            button.disabled = false;
        }
    }

    function showTemporaryPassword(password, identity = {}) {
        const loginId = String(value(identity, "loginId", "LOGIN_ID") || "");
        const userName = String(value(identity, "userName", "USER_NAME") || "");
        temporaryAccess = {
            siteUrl: window.location.origin,
            loginId,
            userName,
            password: String(password)
        };
        query("#temporarySiteUrl").textContent = temporaryAccess.siteUrl;
        query("#temporaryLoginId").textContent = temporaryAccess.loginId;
        query("#temporaryPasswordValue").textContent = String(password);
        query("#temporaryPasswordDialog")?.showModal();
    }

    function previewSelectedPhoto() {
        const file = query("#userPhotoFile")?.files?.[0];
        if (!file) return;
        photoPreviewRequestId += 1;
        clearLocalPhotoUrl();
        localPhotoUrl = URL.createObjectURL(file);
        query("#userPhotoPreview").src = localPhotoUrl;
        query("#userPhotoPreview").hidden = false;
        query("#userPhotoPlaceholder").hidden = true;
    }

    async function uploadUserPhoto() {
        const id = query("#userId").value;
        const fileInput = query("#userPhotoFile");
        const file = fileInput?.files?.[0];
        if (!id) {
            Common.ui.setInlineStatus(query("#userEditorStatus"), "임직원 정보를 먼저 저장해 주세요.", "error");
            return;
        }
        if (!file) {
            Common.ui.setInlineStatus(query("#userEditorStatus"), "저장할 프로필 사진을 선택해 주세요.", "error");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            Common.ui.setInlineStatus(query("#userEditorStatus"), "프로필 사진은 5MB 이하여야 합니다.", "error");
            return;
        }
        const formData = new FormData();
        formData.append("file", file);
        const button = query("#uploadUserPhotoButton");
        button.disabled = true;
        try {
            await Common.api.request(`/admin/users/${encodeURIComponent(id)}/photo`, {
                method: "POST",
                body: formData,
                signal: controller.signal,
                loadingMessage: "프로필 사진을 저장하고 있습니다."
            });
            Common.ui.toast("프로필 사진을 저장했습니다.", "success");
            selectedUserId = String(id);
            await loadUsers();
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.setInlineStatus(
                    query("#userEditorStatus"),
                    error.message || "프로필 사진을 저장하지 못했습니다.",
                    "error"
                );
            }
        } finally {
            button.disabled = false;
        }
    }

    async function deleteUserPhoto() {
        const id = query("#userId").value;
        if (!id || !(await Common.ui.confirm(
            "선택한 임직원의 프로필 사진을 삭제하시겠습니까?",
            { title: "프로필 사진 삭제", confirmText: "삭제", danger: true }
        ))) return;
        const button = query("#deleteUserPhotoButton");
        button.disabled = true;
        try {
            await Common.api.request(`/admin/users/${encodeURIComponent(id)}/photo`, {
                method: "DELETE",
                signal: controller.signal,
                loadingMessage: "프로필 사진을 삭제하고 있습니다."
            });
            Common.ui.toast("프로필 사진을 삭제했습니다.", "success");
            selectedUserId = String(id);
            await loadUsers();
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.setInlineStatus(
                    query("#userEditorStatus"),
                    error.message || "프로필 사진을 삭제하지 못했습니다.",
                    "error"
                );
            }
        } finally {
            button.disabled = false;
        }
    }

    async function deleteUser() {
        const id = query("#userId").value;
        const userLabel = query("#userName").value.trim() || query("#userLoginId").value.trim();
        const button = query("#deleteUserButton");
        if (!id) return;
        const confirmed = await Common.ui.confirm(
            `${userLabel || "선택한 임직원"} 계정을 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
            { title: "임직원 삭제", confirmText: "삭제", danger: true }
        );
        if (!confirmed) return;

        button.disabled = true;
        try {
            await Common.api.request(`/admin/users/${encodeURIComponent(id)}`, {
                method: "DELETE",
                signal: controller.signal,
                loadingMessage: "임직원을 삭제하고 있습니다."
            });
            Common.ui.toast("임직원을 삭제했습니다.", "success");
            fillUserForm();
            await loadUsers();
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.setInlineStatus(
                    query("#userEditorStatus"),
                    error.message || "임직원을 삭제하지 못했습니다.",
                    "error"
                );
            }
        } finally {
            button.disabled = false;
        }
    }

    function openPasswordResetDialog() {
        const id = query("#userId").value;
        if (!id) return;
        pendingPasswordResetUserId = id;
        query("#resetPasswordUserName").textContent = query("#userName").value.trim()
            || query("#userLoginId").value.trim()
            || "선택한 임직원";
        query("#resetPasswordDialog")?.showModal();
    }

    async function resetPassword() {
        const id = pendingPasswordResetUserId;
        const button = query("#confirmResetPasswordButton");
        if (!id) return;
        button.disabled = true;
        try {
            const payload = await Common.api.request(`/admin/users/${encodeURIComponent(id)}/reset-password`, {
                method: "POST",
                signal: controller.signal,
                loadingMessage: "임시 비밀번호를 만들고 있습니다."
            });
            const data = Common.data.get(payload) || {};
            const password = value(data, "temporaryPassword", "TEMPORARY_PASSWORD", "password", "PASSWORD");
            if (!password) throw new Error("서버 응답에서 임시 비밀번호를 확인하지 못했습니다.");

            query("#resetPasswordDialog")?.close();
            showTemporaryPassword(password, data);
            reloadUsersAfterTemporaryDialog = true;
        } catch (error) {
            if (error?.name !== "AbortError") {
                Common.ui.toast(error.message || "비밀번호를 초기화하지 못했습니다.", "error");
            }
        } finally {
            button.disabled = false;
        }
    }

    window.Pages["admin-users"] = {
        async init(context) {
            root = context.root;
            controller = new AbortController();
            await loadDepartmentConfig();
            query("#adminUsersHistoryJump").addEventListener("click", () => Common.ui.revealEditor(query("#adminUsersHistoryPanel")), { signal: controller.signal });
            const today = new Date();
            query("#adminUsersHistoryFrom").max = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
            const options = (selector, entries) => entries.forEach(([code, label]) => query(selector).append(Common.dom.element("option", { text: label, attrs: { value: code } })));
            options("#adminUsersHistoryDept", [["UNASSIGNED", "미지정"], ...departments.map((d) => [d.code, d.label])]);
            options("#adminUsersHistoryType", Object.entries(EMPLOYMENT_TYPE_LABELS));
            options("#adminUsersHistoryState", Object.entries(EMPLOYMENT_STATUS_LABELS));
            query("#adminUsersHistoryForm").addEventListener("submit", saveHistory, { signal: controller.signal });
            query("#adminUsersHistoryForm").addEventListener("input", () => { historyDirty = true; }, { signal: controller.signal });
            query("#adminUsersHistoryNew").addEventListener("click", async () => {
                if (!historyDirty || await Common.ui.confirm("입력 중인 이력을 버리고 새로 입력할까요?")) editHistory();
            }, { signal: controller.signal });
            query("#userSearchForm")?.addEventListener("submit", (event) => {
                event.preventDefault();
                loadUsers({ resetPage: true });
            }, { signal: controller.signal });
            query("#userPagination")?.addEventListener("click", (event) => {
                const button = event.target.closest("button[data-user-page]");
                if (!button || button.disabled) return;
                const nextPage = Number(button.dataset.userPage);
                if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > userTotalPages || nextPage === userPage) return;
                userPage = nextPage;
                loadUsers();
            }, { signal: controller.signal });
            query("#userTableBody")?.addEventListener("click", (event) => {
                const tableRow = event.target.closest("tr[data-user-id]");
                const row = users.find((item) => String(userId(item)) === tableRow?.dataset.userId);
                if (row) selectUser(row);
            }, { signal: controller.signal });
            query("#userTableBody")?.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                const tableRow = event.target.closest("tr[data-user-id]");
                const row = users.find((item) => String(userId(item)) === tableRow?.dataset.userId);
                if (!row) return;
                event.preventDefault();
                selectUser(row);
            }, { signal: controller.signal });
            query("#newUserButton")?.addEventListener("click", async () => {
                if (historyBusy) return;
                if (historyDirty && !(await Common.ui.confirm("입력 중인 이력을 버리고 새로 입력할까요?"))) return;
                fillUserForm();
                query("#userLoginId")?.focus();
            }, { signal: controller.signal });
            query("#clearUserButton")?.addEventListener("click", async () => {
                if (historyBusy) return;
                if (historyDirty && !(await Common.ui.confirm("입력 중인 이력을 버리고 새로 입력할까요?"))) return;
                fillUserForm();
                query("#userLoginId")?.focus();
            }, { signal: controller.signal });
            query("#userForm")?.addEventListener("submit", saveUser, {
                signal: controller.signal
            });
            query("#userBirthDate")?.addEventListener("change", updateAge, { signal: controller.signal });
            query("#userPhotoFile")?.addEventListener("change", previewSelectedPhoto, {
                signal: controller.signal
            });
            query("#uploadUserPhotoButton")?.addEventListener("click", uploadUserPhoto, {
                signal: controller.signal
            });
            query("#deleteUserPhotoButton")?.addEventListener("click", deleteUserPhoto, {
                signal: controller.signal
            });
            query("#userPhotoPreview")?.addEventListener("error", () => {
                query("#userPhotoPreview").hidden = true;
                query("#userPhotoPlaceholder").hidden = false;
            }, { signal: controller.signal });
            query("#deleteUserButton")?.addEventListener("click", deleteUser, { signal: controller.signal });
            query("#resetUserPasswordButton")?.addEventListener("click", openPasswordResetDialog, {
                signal: controller.signal
            });
            query("#confirmResetPasswordButton")?.addEventListener("click", resetPassword, {
                signal: controller.signal
            });
            root.querySelectorAll("[data-dialog-close]").forEach((button) => {
                button.addEventListener("click", () => button.closest("dialog")?.close(), { signal: controller.signal });
            });
            query("#temporaryPasswordDialog")?.addEventListener("close", () => {
                query("#temporaryPasswordValue").textContent = "";
                query("#temporaryLoginId").textContent = "";
                query("#temporarySiteUrl").textContent = "";
                temporaryAccess = null;
                if (reloadUsersAfterTemporaryDialog) {
                    reloadUsersAfterTemporaryDialog = false;
                    loadUsers();
                }
            }, { signal: controller.signal });
            query("#resetPasswordDialog")?.addEventListener("close", () => {
                pendingPasswordResetUserId = null;
                query("#resetPasswordUserName").textContent = "";
            }, { signal: controller.signal });
            query("#copyTemporaryPasswordButton")?.addEventListener("click", async () => {
                await Common.copyText(query("#temporaryPasswordValue").textContent || "");
                Common.ui.toast("임시 비밀번호를 복사했습니다.", "success");
            }, { signal: controller.signal });
            query("#copyTemporaryAccessGuideButton")?.addEventListener("click", async () => {
                if (!temporaryAccess) return;
                const guide = [
                    `[${window.APP_NAME} 계정 안내]`,
                    `접속 주소: ${temporaryAccess.siteUrl}`,
                    `로그인 ID: ${temporaryAccess.loginId}`,
                    `임시 비밀번호: ${temporaryAccess.password}`,
                    "관리자 등급이며 사용 승인된 계정만 로그인할 수 있습니다.",
                    "최초 로그인 후 안내에 따라 새 비밀번호로 반드시 변경해 주세요."
                ].join("\n");
                await Common.copyText(guide);
                Common.ui.toast("접속 안내문을 복사했습니다.", "success");
            }, { signal: controller.signal });
            query("#userBirthDate").max = new Date().toISOString().slice(0, 10);
            fillUserForm();
            await loadUsers();
        },

        hasUnsavedChanges() { return historyDirty; },
        async beforeLeave() { if (historyBusy) return false; return !historyDirty || await Common.ui.confirm("입력 중인 이력을 버리고 이동할까요?"); },
        destroy() {
            historySequence++; historyItems = []; historyEditing = null; historyDirty = false; historyBusy = false;
            photoPreviewRequestId += 1;
            controller?.abort();
            controller = null;
            root = null;
            users = [];
            temporaryAccess = null;
            reloadUsersAfterTemporaryDialog = false;
            selectedUserId = null;
            pendingPasswordResetUserId = null;
            userPage = 1;
            userTotal = 0;
            userTotalPages = 1;
            departments = [];
            clearLocalPhotoUrl();
        }
    };
})();
