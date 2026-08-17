window.MENU_CONFIG = [
    {
        type: "page",
        page: "home",
        label: "경영 현황",
        title: "경영 현황",
        icon: "⌂"
    },
    {
        type: "page",
        page: "account",
        label: "내 계정",
        title: "내 계정",
        icon: "○"
    },
    {
        type: "group",
        key: "business-planning",
        label: "사업·계획",
        roles: ["ADMIN"],
        children: [
            {
                type: "page",
                page: "admin-projects",
                label: "사업·입찰 관리",
                title: "사업·입찰 관리",
                icon: "▦",
                roles: ["ADMIN"]
            },
            {
                type: "page",
                page: "workforce-planning",
                label: "연간 사업·인력계획",
                title: "연간 사업·인력계획",
                icon: "▥",
                keepAlive: true,
                roles: ["ADMIN"]
            },
            {
                type: "page",
                page: "project-assignments",
                label: "확정 투입 관리",
                title: "확정 투입 관리",
                icon: "♙",
                roles: ["ADMIN"]
            }
        ]
    },
    {
        type: "group",
        key: "workforce-partners",
        label: "인력·파트너",
        roles: ["ADMIN"],
        children: [
            {
                type: "page",
                page: "admin-users",
                label: "임직원 관리",
                title: "임직원 관리",
                icon: "◇",
                roles: ["ADMIN"]
            },
            {
                type: "page",
                page: "partner-management",
                label: "협력업체 관리",
                title: "협력업체 관리",
                icon: "▱",
                roles: ["ADMIN"]
            },
            {
                type: "page",
                page: "init-company",
                label: "인아이티 관리",
                title: "인아이티 관리",
                icon: "▣",
                roles: ["ADMIN"]
            },
            {
                type: "page",
                page: "freelancer-management",
                label: "계약·프리랜스 인력",
                title: "계약·프리랜스 인력",
                icon: "♢",
                roles: ["ADMIN"]
            }
        ]
    },
    {
        type: "group",
        key: "portal-operations",
        label: "포털 운영",
        roles: ["ADMIN"],
        children: [
            {
                type: "page",
                page: "admin-notices",
                label: "공지사항 관리",
                title: "공지사항 관리",
                icon: "□",
                roles: ["ADMIN"]
            },
            {
                type: "page",
                page: "admin-site-settings",
                label: "디자인 설정",
                title: "포털 디자인 설정",
                icon: "✦",
                roles: ["ADMIN"]
            }
        ]
    }
];

window.PAGE_FILE_CONFIG = {
    htmlPages: ["login", "home", "account", "admin-users", "admin-projects", "workforce-planning", "project-assignments", "partner-management", "init-company", "freelancer-management", "admin-notices", "admin-site-settings"],
    scriptPages: ["login", "home", "account", "admin-users", "admin-projects", "workforce-planning", "project-assignments", "partner-management", "init-company", "freelancer-management", "admin-notices", "admin-site-settings"]
};
