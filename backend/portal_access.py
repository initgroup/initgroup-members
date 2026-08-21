from __future__ import annotations

from copy import deepcopy
from typing import Any


COMMON_NAVIGATION = [
    {
        "type": "page",
        "page": "home",
        "label": "경영 현황",
        "title": "경영 현황",
        "icon": "⌂",
    },
    {
        "type": "page",
        "page": "account",
        "label": "내 계정",
        "title": "내 계정",
        "icon": "○",
    },
]

ADMIN_NAVIGATION = [
    {
        "type": "group",
        "key": "business-planning",
        "label": "사업·계획",
        "children": [
            {
                "type": "page",
                "page": "admin-projects",
                "label": "사업·입찰 관리",
                "title": "사업·입찰 관리",
                "icon": "▦",
            },
            {
                "type": "page",
                "page": "workforce-management",
                "label": "사업·인력 관리",
                "title": "사업·인력 관리",
                "icon": "♙",
            },
        ],
    },
    {
        "type": "group",
        "key": "workforce-partners",
        "label": "인력·파트너",
        "children": [
            {
                "type": "page",
                "page": "init-company",
                "label": "인아이티 관리",
                "title": "인아이티 관리",
                "icon": "▣",
            },
            {
                "type": "page",
                "page": "admin-users",
                "label": "임직원 관리",
                "title": "임직원 관리",
                "icon": "◇",
            },
            {
                "type": "page",
                "page": "partner-management",
                "label": "협력업체 관리",
                "title": "협력업체 관리",
                "icon": "▱",
            },
        ],
    },
    {
        "type": "group",
        "key": "portal-operations",
        "label": "포털 운영",
        "children": [
            {
                "type": "page",
                "page": "admin-notices",
                "label": "공지사항 관리",
                "title": "공지사항 관리",
                "icon": "□",
            },
            {
                "type": "page",
                "page": "admin-site-settings",
                "label": "디자인 설정",
                "title": "포털 디자인 설정",
                "icon": "✦",
            },
        ],
    },
]

COMMON_PAGE_CODES = ("home", "account")
ADMIN_PAGE_CODES = (
    "admin-users",
    "admin-projects",
    "workforce-management",
    "workforce-planning",
    "project-assignments",
    "project-detail-editor",
    "partner-management",
    "init-company",
    "admin-notices",
    "admin-site-settings",
)


def portal_access_for_role(role_code: str) -> dict[str, Any]:
    is_admin = str(role_code or "USER").strip().upper() == "ADMIN"
    page_codes = [*COMMON_PAGE_CODES]
    navigation = deepcopy(COMMON_NAVIGATION)
    if is_admin:
        navigation.extend(deepcopy(ADMIN_NAVIGATION))
        page_codes.extend(ADMIN_PAGE_CODES)
    return {
        "navigation": navigation,
        "pageFiles": {
            "htmlPages": page_codes,
            "scriptPages": page_codes,
        },
    }

