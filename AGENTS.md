# AGENTS.md

이 문서는 Codex가 이 저장소에서 작업할 때 따라야 할 프로젝트 전용 가이드입니다.

## 작업 원칙

- 작업 전 `git status --short`로 변경 범위를 확인하고 사용자의 기존 변경사항을 되돌리지 않습니다.
- 사용자가 현재 요청에서 명시적으로 승인하지 않은 `git add`, `git commit`, `git push`와 `scripts/git-publish-main.ps1` 실행을 금지합니다. 일반 소스 수정은 VS Code Source Control과 Explorer에 변경 이력이 남도록 미커밋 상태로 유지합니다.
- 요청 범위 밖의 파일을 대량 정리하거나 이름을 바꾸지 않습니다.
- 새 문서와 코드는 UTF-8로 작성합니다.
- 파일 검색은 `rg` 또는 `rg --files`를 우선 사용합니다.
- SQL DDL, 대량 DML, 파일 삭제처럼 영향이 큰 작업은 사용자가 명시한 범위 안에서만 수행합니다.
- `.env`, `secrets/`, `secreats/`, `instantclient/`, Wallet, 인증서, DB 비밀번호, API 키는 읽거나 출력하거나 커밋하지 않습니다.
- 기존 파일에 깨져 보이는 한글이 있어도 요청 범위 밖의 일괄 인코딩 변환을 하지 않습니다.

## 프로젝트 구조

- 앱 진입점은 `main.py`입니다.
- 시스템 DB 연결은 `backend/database.py`에서 관리합니다.
- SQL ID 로더와 공통 실행 함수는 `backend/database_helper.py`에 있습니다.
- 서버 세션 인증/인가는 `backend/auth_context.py`를 기준으로 합니다.
- API 라우터는 `backend/routers/*.py`에 두고 `main.py`에서 semantic API prefix로 등록합니다.
- 정적 SQL은 `database/*.sql`에 `-- [SQL_ID]` 섹션으로 구분합니다.
- 신규 전체 스키마는 `database/INIT_SYSTEM_DDL.sql`, 기존 DB 증분은 `database/INIT_SYSTEM_ALT.sql`, 전체 제거와 데이터 초기화는 각각 `database/INIT_SYSTEM_DROP.sql`, `database/INIT_SYSTEM_TRUC.sql`에서 관리합니다. DROP/TRUC 스크립트는 자동 실행하지 않습니다.
- 프론트는 빌드 과정이 없는 정적 SPA입니다. `frontend/index.html`이 셸이고 `PageManager`가 `frontend/pages/{page-name}.html`과 `frontend/js/{page-name}.js`를 동적으로 로드합니다.
- 메뉴와 페이지 파일 등록은 `frontend/config/menu.config.js`의 `MENU_CONFIG`, `PAGE_FILE_CONFIG.htmlPages`, `PAGE_FILE_CONFIG.scriptPages`에서 관리합니다.

기본 semantic page와 API는 다음과 같습니다.

| Page | Router | API prefix |
|---|---|---|
| `login` | `backend/routers/auth.py` | `/api/auth` |
| `home` | `backend/routers/home.py` | `/api/home` |
| `account` | `backend/routers/account.py` | `/api/account` |
| `admin-users` | `backend/routers/admin_users.py` | `/api/admin/users` |
| `admin-notices` | `backend/routers/admin_notices.py` | `/api/admin/notices` |
| `admin-projects` | `backend/routers/admin_projects.py` | `/api/admin/projects` |
| `workforce-planning` | `backend/routers/planning_scenarios.py` | `/api/planning/scenarios` |
| `project-assignments` | `backend/routers/project_assignments.py` | `/api/project-assignments` |

## 인증·인가 필수 기준

- 사용자 ID, 로그인 ID, 역할은 서버 세션 쿠키와 시스템 DB 조회 결과만 신뢰합니다.
- 브라우저 `sessionStorage`, `localStorage`, GET/POST 파라미터, 임의 사용자 헤더를 인증 또는 관리자 권한의 근거로 사용하지 않습니다.
- 새 `/api/**`는 기본적으로 로그인 세션을 요구합니다.
- 로그인, 가입, 운영자 연락처, 최초 관리자 초기화처럼 공개가 필요한 API만 `main.py`의 공개 예외에 정확한 경로와 HTTP 메서드 단위로 추가합니다.
- 브라우저의 `POST`, `PUT`, `PATCH`, `DELETE` `/api/**` 요청은 `main.py`의 `Origin`/`Referer` 검증을 우회하지 않습니다. 허용 origin은 `INIT_ALLOWED_ORIGINS`의 exact 목록으로 관리하며 wildcard를 사용하지 않습니다.
- 관리자 API는 서버 측 `require_admin_role` 또는 동일한 역할 검증을 반드시 통과해야 합니다. 프론트 메뉴 숨김은 보조 UI일 뿐 보안 경계가 아닙니다.
- 최초 시스템 DDL 실행은 `INIT_ADMIN_KEY` 검증에 성공한 관리자 가입 흐름에서만 허용합니다. 요청에서 받은 키를 로그나 응답에 남기지 않습니다.
- DB 비밀번호, 관리자 키, 외부 API 키는 브라우저 응답, 캐시, 쿠키, JavaScript에 포함하지 않습니다.
- `database/`, `.env`, `secrets/`, `secreats/`, `instantclient/`, Wallet, 인증서, 백엔드 소스를 정적 경로로 마운트하지 않습니다.
- 공지 첨부 파일은 서버에서 관리자 권한, 파일 크기, 안전한 파일명, 콘텐츠 형식을 검증합니다.

## Windows UTF-8 / 셸

Windows PowerShell 5.1에서 한글을 읽거나 검색할 때는 먼저 현재 명령 세그먼트에 UTF-8 가드를 적용합니다.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
. .\scripts\codex-utf8.ps1
Get-Content -Encoding UTF8 frontend/js/app.js
```

스크립트 로드가 어렵다면 같은 명령 세그먼트에 inline 가드를 둡니다.

```powershell
$utf8NoBom=[System.Text.UTF8Encoding]::new($false); [Console]::InputEncoding=$utf8NoBom; [Console]::OutputEncoding=$utf8NoBom; $OutputEncoding=$utf8NoBom; chcp.com 65001 | Out-Null
Get-Content -Encoding UTF8 frontend/js/app.js
```

- 깨진 콘솔 출력을 그대로 `apply_patch`에 포함하지 않습니다.
- VS Code에서 정상으로 보이는 한글 주석이나 라벨은 요청 없이 수정하지 않습니다.
- Python 명령은 기본 `python`보다 `.\venv\Scripts\python.exe`를 우선 사용합니다.

## 백엔드와 SQL

라우터의 기본 구조는 다음 패턴을 따릅니다.

```python
from fastapi import APIRouter, HTTPException, Request

from backend.auth_context import get_request_user_id
from backend.database import get_db_connection
from backend.database_helper import execute_query

router = APIRouter()
```

- 업무 데이터에서 현재 사용자가 필요하면 `get_request_user_id(request)`를 사용합니다.
- 관리자 기능은 라우터 진입 시 서버 역할 검증을 수행합니다.
- 조회와 DML 모두 시스템 DB 커넥션을 명시적으로 얻고 `finally`에서 커서와 커넥션을 닫습니다.
- `HTTPException`은 그대로 다시 raise하고, 예상하지 못한 예외는 로깅한 뒤 일관된 오류 응답으로 변환합니다.
- 성공 응답은 기존 `{ "status": "success", "data": ... }` 계약을 유지합니다.

정적 `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `MERGE`, PL/SQL block은 Python 파일에 새로 작성하지 않고 `database/*.sql`로 분리합니다.

```sql
-- [ACCOUNT_DETAIL]
SELECT USER_ID
     , LOGIN_ID
     , USER_NAME
     , EMAIL
  FROM INIT$_TB_USER
 WHERE USER_ID = :userId
;
```

- SQL 값은 바인드 변수로 전달합니다.
- 사용자 입력을 SQL 문자열에 직접 이어 붙이지 않습니다.
- 동적 식별자가 꼭 필요하면 서버 화이트리스트 또는 엄격한 정규식으로 검증하고 치환 범위를 최소화합니다.
- 일반 사용자 요청으로 임의 SQL, PL/SQL, DDL을 실행하는 API를 만들지 않습니다.
- 기존 SQL 전체를 요청 없이 대량 포맷팅하지 않고 직접 수정한 블록에만 comma-first 스타일을 적용합니다.
- SQL 바인드가 추가·삭제·이름 변경될 때는 요청 모델, 파라미터 생성 함수, 단건 DML, 일괄 DML, 정적 SQL을 반드시 같은 작업에서 함께 수정합니다. 공유 파라미터 딕셔너리를 DML에 그대로 넘기기 전에 해당 SQL의 바인드 계약과 정확히 일치하는지 확인합니다.
- 단건 저장과 일괄 저장이 같은 업무 객체를 저장하면 동일한 SQL ID 또는 명시적으로 등록된 동일 바인드 계약을 사용합니다. 한 경로만 검증하고 다른 경로를 남겨두지 않습니다.
- `DPY-4008`, `ORA-01036` 같은 바인드 오류를 개별 파라미터 삭제로 우회하지 않습니다. 실행 중 SQL 캐시, SQL 파일의 바인드 목록, Python 파라미터 키를 모두 비교해 근본 원인을 수정합니다.
- 외부 `database/*.sql`은 서버 실행 중 변경될 수 있으므로 SQL 로더의 변경 감지와 등록된 바인드 계약 검증을 우회하지 않습니다. 저장 SQL을 변경하면 서버 시작 또는 SQL 재로딩 단계에서 계약 검증이 통과하는지 확인합니다.
- 새 저장 DML이나 바인드가 많은 핵심 DML에는 `SqlLoader.register_bind_contract`로 바인드 집합을 등록합니다. 필수 바인드 누락이나 코드에 없는 SQL 바인드가 있으면 실제 요청 처리 전에 실패하도록 유지합니다.
- `SELECT`의 첫 컬럼은 같은 줄에 두고 두 번째 컬럼부터 `     , 컬럼` 형태로 정렬합니다.
- `WHERE`는 가능하면 `WHERE 1=1`로 시작하고 후속 조건은 `   AND ...`로 정렬합니다.
- `INSERT`, `VALUES`, `UPDATE SET`, `GROUP BY`, `ORDER BY` 목록도 comma-first 정렬을 사용합니다.
- DDL 변경 시 설치, 기존 스키마 보정, 롤백 또는 복구 경로를 함께 확인합니다.

시스템 DB 스키마는 다음 원칙으로 관리합니다.

- `database/INIT_SYSTEM_DDL.sql`은 신규 DB 전체 생성 기준입니다.
- 기존 DB 변경은 테이블을 DROP하거나 다시 만들지 않고 `database/INIT_SYSTEM_ALT.sql`에 존재 여부를 확인하는 idempotent 증분 블록으로 추가합니다.
- 계획 시뮬레이션 데이터는 확정·실제 투입 데이터와 분리합니다. 계획안 전체 저장은 시나리오 행 잠금과 revision 검증 후 하나의 트랜잭션으로 처리하고 월별 M/M은 조회 가능한 행 구조로 저장합니다.
- `INIT_SYSTEM_DROP.sql`과 `INIT_SYSTEM_TRUC.sql`은 정확한 시스템 객체 allowlist만 사용하며 실행 인자로 지정한 DB 소유자와 `SESSION_USER`·`CURRENT_SCHEMA`가 모두 일치해야 합니다. 사용자가 실행을 명시적으로 요청하지 않으면 실행하지 않습니다.
- 새 컬럼은 `INIT_SYSTEM_DDL.sql`의 해당 테이블 맨 뒤와 `INIT_SYSTEM_ALT.sql`에 같은 순서로 추가합니다. Oracle은 기존 컬럼 사이에 새 컬럼을 물리적으로 삽입할 수 없으므로 중간 삽입을 전제로 작성하지 않습니다.
- 컬럼 타입, NULL, DEFAULT 또는 데이터 보정이 필요한 변경은 기존 데이터 영향도를 확인할 수 있도록 별도 버전 블록으로 작성하고 자동 DROP/TRUNCATE를 사용하지 않습니다.

## 프론트엔드

화면 JavaScript는 IIFE와 전역 페이지 객체 패턴을 사용합니다.

```javascript
(function() {
    const PAGE_NAME = "account";
    window.Pages = window.Pages || {};

    window.Pages[PAGE_NAME] = {
        async init({ root }) {
            this.root = root;
            this.formEl = root.querySelector("[data-account-form]");
        },
        destroy() {
            this.formEl = null;
            this.root = null;
        }
    };
})();
```

- page name과 API path는 기능을 설명하는 소문자 kebab-case를 사용합니다.
- 페이지 객체는 `window.Pages[pageName]`에 등록하고 `init({ root, ... })`에서 전달된 `root` 범위 안에서 DOM을 조회합니다.
- 페이지 내부 요소는 전역 `document.querySelector` 대신 `root.querySelector`로 찾습니다.
- DOM ID와 페이지 전용 CSS 선택자에는 page name 또는 해당 화면에 고유한 기능 prefix를 사용해 다른 화면과 충돌하지 않게 합니다.
- API 호출은 `Common.api.request`를 사용합니다.
- 이벤트 리스너, 타이머, observer 같은 화면 리소스는 `destroy()`에서 정리합니다.
- 화면을 추가하면 `MENU_CONFIG`, `PAGE_FILE_CONFIG.htmlPages`, `PAGE_FILE_CONFIG.scriptPages`를 함께 수정합니다.
- 사용자에게 보이는 이름, 이메일, 역할은 로그인 후 서버 응답을 기준으로 표시합니다.

CSS를 수정할 때는 새 override를 계속 추가하지 않습니다. 기존 선택자, 중복 규칙, media query, cascade 순서를 먼저 추적해 원본 규칙을 수정합니다. 불가피한 override는 이유와 범위를 설명하고 관련 중복 규칙을 정리합니다.

이 프로젝트는 build-free 구성을 유지합니다.

- Node.js, npm, 번들러, Tailwind 빌드 단계를 새 필수 조건으로 추가하지 않습니다.
- 실행에 필요한 HTML, CSS, JavaScript와 서드파티 정적 자산은 저장소 안에서 직접 제공되어야 합니다.
- 외부 CDN을 새로 의존할 때는 운영 환경의 CSP, 가용성, 라이선스를 먼저 확인합니다.

## semantic 페이지/API 추가 절차

예를 들어 `reports` 기능을 추가할 때:

1. `frontend/pages/reports.html`을 추가합니다.
2. `frontend/js/reports.js`를 추가합니다.
3. `frontend/config/menu.config.js`의 세 등록 영역을 함께 수정합니다.
4. `database/reports.sql`에 `REPORT_...` SQL ID를 추가합니다.
5. `backend/routers/reports.py`를 작성합니다.
6. `main.py`에 `/api/reports` prefix로 라우터를 등록합니다.
7. 로그인 세션과 필요한 역할 검증을 서버에 적용합니다.
8. 페이지 로딩, API 응답, 권한 거부, 오류 경로를 확인합니다.

## 개발 서버와 검증

```powershell
.\scripts\setup-venv.ps1
.\scripts\validate-source.ps1
.\scripts\run-server.ps1
```

- `venv/`는 생성 결과물이므로 직접 매크로를 추가하거나 커밋하지 않습니다.
- 환경 생성, 검증, 서버 실행, 백업, Git 배포 자동화는 `scripts/*.ps1`과 `.vscode/tasks.json`에서 관리합니다.
- `git-publish-main.ps1`은 커밋과 원격 push를 실제 수행하므로 사용자가 명시적으로 요청했을 때만 실행합니다.

최소 검증:

- `GET /api/health`
- 로그인, 로그아웃, 만료·폐기된 세션 거부
- 최초 관리자 초기화와 일반 사용자 승인
- 본인 계정만 변경 가능한지
- 일반 사용자의 관리자 API 접근이 거부되는지
- 공지 목록, 저장, 삭제, 첨부 업로드·다운로드
- 메뉴에서 각 semantic page가 열리고 이동 후 리소스가 정리되는지

## 금지·주의 작업

- 사용자 요청 없이 `git reset`, 대량 삭제, DB `DROP`/`TRUNCATE` 실행 금지
- 기존 변경사항을 덮어쓰기 위한 파일 전체 rewrite 금지
- 비밀 정보 출력 또는 커밋 금지
- 사용자 입력을 이어 붙인 SQL 실행 금지
- 정적 SQL을 라우터 Python 문자열로 새로 작성하는 작업 금지
- 등록되지 않은 화면 파일만 만들고 메뉴 또는 라우터 등록을 빠뜨리는 작업 금지
- 인증·권한 흐름, 공개 API 범위, 사용자 작업 방식을 바꾸는 개선은 구현 전에 영향과 선택지를 설명

모든 최종 답변 마지막에는 `Usage 확인: VS Code Codex 입력창에서 /status` 문구를 반드시 추가합니다.
