window.MENU_CONFIG = [
    {
        type: "group",
        key: "my-account",
        label: "내 계정",
        children: [
            {
                type: "page",
                page: "account",
                label: "계정 정보",
                title: "내 계정",
                icon: "○"
            },
            {
                type: "page",
                page: "my-project-assignments",
                label: "프로젝트 투입현황",
                title: "개인별 프로젝트 투입현황",
                icon: "▤"
            }
        ]
    }
];

window.PAGE_FILE_CONFIG = {
    htmlPages: ["login", "account", "my-project-assignments"],
    scriptPages: ["login", "account", "my-project-assignments"]
};
