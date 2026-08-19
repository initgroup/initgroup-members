# INIT Members

FastAPI, Oracle 시스템 DB, 정적 HTML/CSS/JavaScript로 구성한 인아이티 경영진용 인트라넷입니다. 임직원·협력업체·계약 및 프리랜스 인력, 사업·입찰, 프로젝트, 실제 투입과 연간 사업·인력계획을 통합 관리합니다.

프론트엔드는 빌드 과정 없이 `frontend/`의 정적 파일을 그대로 서비스하며 Node.js나 npm 설치는 필요하지 않습니다. 기업 홈페이지는 별도 `init-homepage` 프로젝트에서 관리합니다.

## 제공 범위

- `HttpOnly` 쿠키와 서버 DB 세션을 이용한 로그인/로그아웃
- 최초 관리자 가입과 시스템 테이블 초기화
- 일반 사용자 가입 및 관리자 승인
- 내 계정 정보, 이름, 이메일, 비밀번호 관리
- 관리자 사용자 관리
- 본사·협력업체·계약 및 프리랜스 인력 관리
- 사업·입찰·수주 프로젝트 관리
- 참여회사와 확정 프로젝트 투입 관리
- 계획 시나리오별 사업·인력 드래그 앤 드롭 시뮬레이션
- 월별 M/M, 예상 매출·원가·영업이익과 인력 과부하 계산
- 공지사항과 첨부 파일 관리
- 입찰 파이프라인·예상 손익·인력 위험을 요약하는 경영 대시보드
- hash route와 페이지 수명주기를 사용하는 인증 업무 SPA
- `database/*.sql`의 SQL ID를 이용한 정적 SQL 분리

## 프로젝트 구조

```text
.
├─ main.py
├─ backend/
│  ├─ database.py                 # Oracle 시스템 DB 연결 풀
│  ├─ database_helper.py          # SQL ID 로더와 공통 실행 함수
│  ├─ auth_context.py             # 서버 세션 인증/인가
│  ├─ passwords.py                # 비밀번호 해시와 검증
│  ├─ rate_limit.py               # 로그인·가입 요청의 프로세스 내 제한
│  └─ routers/
│     ├─ auth.py
│     ├─ home.py
│     ├─ account.py
│     ├─ admin_users.py
│     ├─ admin_companies.py
│     ├─ admin_projects.py
│     ├─ project_assignments.py
│     ├─ planning_scenarios.py
│     └─ admin_notices.py
├─ database/                      # SQL ID별 정적 SQL과 시스템 DB 수명주기
│  ├─ INIT_SYSTEM_DDL.sql         # 신규 DB 전체 원본
│  ├─ INIT_SYSTEM_ALT.sql         # 기존 DB idempotent 증분 변경
│  ├─ INIT_SYSTEM_DROP.sql        # 전체 시스템 객체 제거(수동 실행)
│  └─ INIT_SYSTEM_TRUC.sql        # 전체 데이터 초기화(수동 실행)
├─ frontend/
│  ├─ index.html                  # 인증 업무 SPA 셸 (/)
│  ├─ config/app.config.js        # 프론트 표시 이름과 공통 UI 설정
│  ├─ config/menu.config.js       # 메뉴와 페이지 리소스 등록
│  ├─ pages/{page-name}.html
│  ├─ js/{page-name}.js
│  └─ css/
├─ scripts/
│  ├─ setup-venv.ps1              # venv 생성과 의존성 설치
│  ├─ run-server.ps1              # 개발 서버 실행
│  ├─ validate-source.ps1          # Python/JS/SQL ID/매크로 검증
│  ├─ backup-source.ps1            # Git 또는 작업 소스 백업
│  └─ git-publish-main.ps1         # main 브랜치 커밋·rebase·push
├─ .env.example
└─ requirements.txt
```

## 환경 준비

Python 3.12 이상과 접속 가능한 Oracle Database가 필요합니다.

```powershell
python -m venv venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

PowerShell 매크로로 한 번에 준비하려면 다음 명령을 사용합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-venv.ps1
```

기본 생성 명령은 Windows Python Launcher의 `py -3.12`를 사용합니다. 다른 Python 3.12 실행 파일을 사용하려면 `-PythonCommand D:\path\to\python.exe`를 지정합니다. 이미 정상적인 `venv`가 있으면 전역 Python을 다시 찾지 않고 해당 환경의 의존성만 확인·설치합니다.

`venv/`는 생성 결과물이므로 매크로 파일을 그 안에 넣거나 Git에 커밋하지 않습니다. Python 실행, 백업, 배포 매크로는 재생성되지 않는 `scripts/`에서 관리합니다.

`.env.example`을 `.env`로 복사하고 현재 환경의 값을 입력합니다.

```powershell
Copy-Item .env.example .env
```

주요 설정은 다음과 같습니다.

- `APP_NAME`: 서버와 API 문서에 표시할 서비스 이름
- `LOG_LEVEL`: 서버 로그 수준(기본값 `INFO`)
- `DB_MODE`: `local` 또는 `cloud`
- `DB_USER_LOC`, `DB_PASSWORD_LOC`, `DB_HOST`, `DB_PORT`, `DB_SERVICE`: 로컬 Oracle 접속 정보
- `DB_USER_CLD`, `DB_PASSWORD_CLD`, `DB_DSN_CLD`: Oracle Cloud 접속 정보
- `DB_WALLET_PATH`, `DB_WALLET_PASSWORD`: Wallet 접속을 사용할 때만 설정
- `DB_POOL_*`: 시스템 DB 연결 풀 크기와 대기 시간
- `INIT_ALLOWED_ORIGINS`: 허용할 정확한 HTTP(S) origin의 쉼표 구분 목록. `*` wildcard와 URL path는 지원하지 않습니다.
- `INIT_SESSION_*`: 로그인 세션 수명과 갱신 정책
- `INIT_COOKIE_SECURE`: 세션 쿠키의 `Secure` 적용 여부
- `INIT_COOKIE_SAMESITE`: `lax` 또는 `strict`만 지원하는 세션 쿠키의 SameSite 정책
- `INIT_AUTH_RATE_LIMIT_WINDOW_SECONDS`: 로그인·가입 요청 횟수를 집계할 시간 구간
- `INIT_LOGIN_RATE_LIMIT_MAX_ATTEMPTS`, `INIT_SIGNUP_RATE_LIMIT_MAX_ATTEMPTS`: 한 구간에서 클라이언트별로 허용할 요청 수
- `INIT_AUTH_RATE_LIMIT_MAX_CLIENTS`: 프로세스 메모리에 유지할 클라이언트 버킷 수
- `INIT_ADMIN_CONTACT_*`: 로그인 화면에 표시할 운영자 연락처
- `INIT_ADMIN_KEY`: 최초 관리자 가입과 초기 DDL 실행을 승인하는 별도 인증키
- `APP_NOTICE_FILE_MAX_BYTES`: 공지 첨부 파일 하나의 최대 바이트 수

비밀번호, Wallet 비밀번호, 관리자 키는 저장소에 커밋하지 않습니다. Cloud Wallet 경로는 환경마다 다르므로 코드나 예제에 특정 계정명 또는 PC 경로를 넣지 않습니다.

운영 HTTPS 환경, 특히 같은 호스트의 reverse proxy 뒤에서는 요청 주소 추론에 맡기지 말고 `INIT_COOKIE_SECURE=Y`를 명시합니다.

기본 인증 요청 제한은 프로세스 메모리에만 저장됩니다. 서버 재시작 시 초기화되고 여러 worker 사이에서 공유되지 않으므로, 인터넷 공개 또는 다중 프로세스 운영 환경에서는 reverse proxy나 공유 저장소 기반 rate limiter를 함께 적용합니다.

`APP_NOTICE_FILE_MAX_BYTES`는 multipart 처리 후 handler가 읽는 파일 하나의 한도이며, 들어오는 HTTP body 자체를 차단하는 ingress 한도가 아닙니다. 인터넷 운영 환경에서는 reverse proxy 또는 ASGI 계층의 request-body limit와 사용자별 업로드 quota를 별도로 설정합니다. 현재 첨부 다운로드는 최대 50MB로 제한된 BLOB 전체를 메모리 응답으로 만들므로, 동시 다운로드 수와 서버 메모리도 함께 산정합니다.

브라우저 셸의 표시 이름은 `frontend/config/app.config.js`의 `window.APP_NAME`에서 관리합니다. 서버 환경변수 `APP_NAME`과 같은 이름을 사용하려면 두 값을 함께 변경합니다.

## 개발 서버 실행

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-server.ps1
```

- 로그인·업무 포털: `http://127.0.0.1:8100/#/login`
- API 문서: `http://127.0.0.1:8100/docs`
- 상태 확인: `http://127.0.0.1:8100/api/health`

## 개발 자동화 매크로

VS Code의 `Terminal: Run Task`에서 다음 작업을 바로 실행할 수 있습니다.

- `INIT Members: Setup Venv`: Python 3.12 `venv` 생성과 `requirements.txt` 설치
- `INIT Members: Run Server`: `venv` Python으로 개발 서버 실행
- `INIT Members: Validate Source`: Python, JavaScript, SQL ID, PowerShell, VS Code 설정 검증
- `INIT Members: Backup Source`: `Working` 또는 `Git` 백업 방식 선택
- `INIT Members: Backup Working Source`: 미커밋 변경을 포함하되 비밀 파일과 생성물을 제외하고 백업
- `INIT Members: Backup Git Source`: 현재 `HEAD`의 추적 소스와 전체 Git 이력 bundle 백업
- `INIT Members: Publish Main (Explicit Commit + Push)`: 사용자가 배포를 명시적으로 요청했을 때만 변경 전체를 커밋하고 `main`을 rebase한 뒤 원격 저장소로 push

동일한 작업은 터미널에서도 실행할 수 있습니다.

```powershell
.\scripts\validate-source.ps1
.\scripts\backup-source.ps1 -Mode Working
.\scripts\backup-source.ps1 -Mode Git
.\scripts\git-publish-main.ps1
```

백업은 다른 프로젝트의 백업 폴더를 건드리지 않고 다음 프로젝트 전용 경로에 생성됩니다.

- Working 백업: `D:\work\backup\initgroup-members_WORKING_BACKUP\<yyyyMMdd-HHmmss>`
- Git 백업: `D:\work\backup\initgroup-members_GIT_BACKUP\<yyyyMMdd-HHmmss>`

`Working` 백업은 현재 미커밋 변경과 신규 파일을 포함하고 `.git`, `venv`, `.env`, 비밀 파일, 지갑, Instant Client와 생성 캐시는 제외합니다. `Git` 백업에는 현재 `HEAD`의 파일과 전체 브랜치·태그 이력을 복원할 수 있는 `repository.bundle`이 함께 저장됩니다.

이 작업공간은 VS Code Explorer의 Git 변경 배지·색상, Source Control 변경 건수와 파일 Timeline의 Local History를 사용합니다. 커밋하지 않은 수정 파일은 Explorer에 `M`, 신규 파일은 `U`로 표시되며, 워킹트리가 clean이면 표시가 없는 것이 정상입니다.

처음 한 번만 로컬 저장소와 GitHub 원격 저장소를 연결합니다.

```powershell
git init -b main
git remote add origin https://github.com/initgroup/initgroup-members.git
```

`git-publish-main.ps1`을 터미널이나 VS Code 배포 작업에서 실행하면 추가 확인 없이 `git add -A`, 커밋, `pull --rebase`, `push`를 수행합니다. 커밋 메시지는 저장소 폴더명을 시스템명으로 사용해 `initgroup-members-20260731-1`처럼 `시스템명-현재날짜-순번` 형식으로 자동 생성되며, 같은 날짜의 후속 커밋은 순번이 증가합니다. 스크립트는 기본 배포 대상이 `https://github.com/initgroup/initgroup-members.git`인지 확인하고 다른 원격이 설정되어 있으면 중단합니다. 따라서 실행 전에 `git status --short`로 포함될 변경 파일을 확인해야 합니다. Codex는 사용자가 현재 요청에서 커밋 또는 배포를 명시적으로 승인하지 않으면 이 스크립트를 실행하지 않고 변경을 워킹트리에 남깁니다. 비어 있는 새 GitHub 저장소에는 최초 `main` 브랜치를 만들고 upstream을 자동 설정하며, 이후 실행부터는 원격 `main`을 fetch/rebase한 뒤 push합니다. `.git` 메타데이터가 없는 소스 묶음에서는 `Git` 백업과 Git 배포가 안전하게 중단됩니다.

JavaScript 검증에는 Node.js가 있을 때 `node --check`를 사용합니다. Node.js가 없어도 웹 애플리케이션 실행에는 영향이 없으며 검증 매크로는 해당 단계만 건너뜁니다.

## Render 자동 배포

이 프로젝트는 `data-editing-system`과 동일하게 GitHub의 `main` 브랜치를 Render Web Service에 직접 연결합니다. Render에서 새 Web Service를 만들 때 다음 값을 사용합니다.

| 설정 | 값 |
| --- | --- |
| Repository | `https://github.com/initgroup/initgroup-members` |
| Branch | `main` |
| Root Directory | 비워 둠 |
| Language | `Python 3` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/api/health` |
| Auto-Deploy | `On Commit` |

Render의 기본 Python 버전 변경으로 빌드 결과가 달라지지 않도록 저장소 루트의 `.python-version`에서 Python 3.12 계열을 사용합니다.

Render에서는 로컬 `.env`가 배포되지 않습니다. 기존 `data-editing-system`과 같은 Oracle Cloud 시스템 DB를 사용한다면 Render의 Environment Group을 연결하거나 해당 서비스의 환경변수를 이 서비스에도 별도로 등록합니다. 최소한 `DB_MODE=cloud`, `DB_USER_CLD`, `DB_PASSWORD_CLD`, `DB_DSN_CLD`가 필요하며 TNS 별칭을 사용할 때는 Wallet 파일을 Render Secret Files로 등록하고 `DB_WALLET_PATH=/etc/secrets`를 설정합니다. 운영 HTTPS에서는 `INIT_COOKIE_SECURE=Y`를 사용합니다. 비밀번호, Wallet 비밀번호, 관리자 키를 Git 또는 `render.yaml`에 저장하지 않습니다.

이후 아래 배포 매크로로 `main`에 push하면 Render가 자동으로 새 빌드를 시작합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\git-publish-main.ps1
```

## 최초 관리자 가입

시스템 테이블이 아직 없는 새 DB에서는 최초 관리자만 초기화를 승인할 수 있습니다.

1. `.env`의 `INIT_ADMIN_KEY`에 충분히 긴 임의 문자열을 설정합니다.
2. 서버를 실행하고 로그인 화면에서 관리자 가입을 선택합니다.
3. 가입 폼에 같은 관리자 인증키를 입력합니다.
4. 서버가 키를 비교 검증한 뒤에만 시스템 DDL 초기화와 최초 관리자 생성을 진행합니다.
5. 최초 관리자로 로그인한 뒤 일반 사용자의 가입 요청은 `admin-users` 화면에서 승인합니다.

`INIT_ADMIN_KEY`는 DB 비밀번호가 아니며 브라우저 저장소나 응답에 남겨서는 안 됩니다. 초기 설치 후에도 환경변수 저장소에서 보호하고 필요하면 교체합니다. 운영 환경에서는 예측 가능한 값이나 다른 서비스에서 사용한 키를 재사용하지 않습니다.

자동 초기화는 핵심 테이블과 앱 필수 컬럼의 존재 여부를 확인하지만, 같은 이름의 레거시 테이블에 누락된 컬럼을 임의로 추가하거나 컬럼 타입과 제약조건을 자동으로 변경하지 않습니다. 기존 사용자 데이터가 있는 불완전 스키마는 공개 가입 흐름에서 초기화하지 않습니다. 기존 DB를 재사용할 때는 먼저 백업하고 `database/INIT_SYSTEM_DDL.sql`과 실제 테이블 정의를 비교한 뒤, 시스템 DB 소유자 권한으로 `database/INIT_SYSTEM_ALT.sql`을 실행합니다.

`INIT_SYSTEM_DDL.sql`은 신규 DB의 전체 생성 기준이고, `INIT_SYSTEM_ALT.sql`은 기존 DB를 DROP하지 않고 테이블·컬럼·제약조건을 추가하는 증분 스크립트입니다. Oracle은 기존 컬럼 사이에 새 컬럼을 물리적으로 삽입할 수 없으므로 신규 컬럼은 두 파일 모두 해당 테이블의 맨 뒤에 같은 순서로 추가합니다. 기존 컬럼의 타입·NULL·DEFAULT 변경이나 데이터 보정이 필요하면 영향도를 확인한 별도 버전 블록으로 작성하며 자동 DROP이나 테이블 재생성은 하지 않습니다.

전체 재설치가 필요할 때만 `@database/INIT_SYSTEM_DROP.sql <DB_OWNER>` 형식으로 소유자명을 명시해 수동 실행합니다. 스키마를 유지하고 모든 데이터를 초기화할 때는 `@database/INIT_SYSTEM_TRUC.sql <DB_OWNER>`를 사용합니다. 두 스크립트는 실행 인자·`SESSION_USER`·`CURRENT_SCHEMA`가 모두 일치하지 않으면 중단됩니다. Oracle FK를 임의로 비활성화하지 않기 위해 `INIT_SYSTEM_TRUC.sql`은 이름과 달리 자식 테이블부터 안전하게 `DELETE`하고 마지막에 한 번 커밋합니다. 두 스크립트 모두 애플리케이션 API나 서버 시작 과정에서 자동 실행하지 않습니다.

## 기본 페이지와 API

| 페이지 | API prefix | 접근 범위 |
|---|---|---|
| `login` | `/api/auth` | 로그인·가입 등 명시된 작업만 공개 |
| `home` | `/api/home` | 로그인 사용자 |
| `account` | `/api/account` | 로그인 사용자 본인 |
| `admin-users` | `/api/admin/users` | 관리자 |
| `admin-notices` | `/api/admin/notices` | 관리자 |
| `admin-projects` | `/api/admin/projects` | 관리자 |
| `workforce-planning` | `/api/planning/scenarios` | 관리자 |
| `project-assignments` | `/api/project-assignments` | 관리자 |

`workforce-planning`은 계획 시나리오를 실제 확정 투입과 분리합니다. 사용자는 사업 후보와 내부·협력업체·프리랜스 인력을 작업공간에서 배치하고 월별 M/M 및 손익을 확인한 뒤, 전체 계획안을 하나의 트랜잭션으로 임시 저장하거나 최종 확정합니다. `revisionNo`로 동시수정 충돌을 방지하며 확정안은 직접 수정하지 않습니다.

`project-assignments`의 `확정 투입 배치 보드`는 계획 화면의 인력 풀·프로젝트 월 타임라인 개념을 재사용합니다. 인력을 프로젝트 월에 배치하거나 기존 배치 카드를 선택·이동하면 기존 상세 편집기로 연결되며, 참여회사·단가·M/M을 검토한 뒤 저장합니다. 참여회사와 실제 투입 수정·삭제는 `versionToken`을 비교해 오래된 화면이 다른 관리자의 최신 변경을 덮어쓰지 못하게 합니다.

Oracle `NUMBER(18)` 금액은 브라우저의 JSON number 안전 범위를 넘을 수 있으므로 계획·투입 API는 금액 요청과 응답을 10진수 문자열로 전달합니다. 프론트도 금액 합계와 손익 계산에 `BigInt`를 사용해 18자리 금액의 반올림 손실을 막습니다.

`home`은 기준연도별 입찰 대상, 가중 예상수주, 월별 계획 매출·원가·영업이익, 인력 부족·과부하와 보유인력 구성을 요약합니다. 회사·계획 증분 스키마가 아직 적용되지 않은 초기 DB에서는 홈 전체를 실패시키지 않고 해당 영역에 `INIT_SYSTEM_ALT.sql` 적용 필요 상태를 표시합니다.

관리자 메뉴를 화면에서 숨기는 것은 보조 UI일 뿐 보안 경계가 아닙니다. 관리자 API는 서버 세션의 역할을 다시 검증해야 합니다.

## semantic 페이지 추가

`reports` 페이지를 추가하는 예시는 다음과 같습니다.

1. `frontend/pages/reports.html`을 추가합니다.
2. `frontend/js/reports.js`에 `init()`과 `destroy()`를 가진 페이지 객체를 등록합니다.
3. `frontend/config/menu.config.js`의 `MENU_CONFIG`, `PAGE_FILE_CONFIG.htmlPages`, `PAGE_FILE_CONFIG.scriptPages`에 `reports`를 함께 등록합니다.
4. 페이지 전용 DOM ID와 CSS 선택자에는 `reports`처럼 semantic page name을 포함해 다른 화면과 충돌하지 않게 합니다.
5. API가 필요하면 `backend/routers/reports.py`를 만들고 `main.py`에 `/api/reports` prefix로 등록합니다.
6. 정적 SQL은 `database/reports.sql`에 `-- [REPORT_...]` SQL ID로 분리합니다.
7. 프론트 API 호출은 `Common.api.request`를 사용해 세션 쿠키 정책을 일관되게 적용합니다.

페이지 JavaScript는 다음 형태로 등록하고 전달받은 `root` 안에서만 DOM을 조회합니다.

```javascript
(function() {
    const PAGE_NAME = "reports";
    window.Pages = window.Pages || {};

    window.Pages[PAGE_NAME] = {
        async init({ root }) {
            this.root = root;
            this.listEl = root.querySelector("[data-report-list]");
        },
        destroy() {
            this.listEl = null;
            this.root = null;
        }
    };
})();
```

새 API는 기본적으로 로그인 세션을 요구합니다. 공개 API가 꼭 필요할 때만 `main.py`의 공개 예외를 정확한 경로와 HTTP 메서드 단위로 좁게 추가합니다.

## 보안 기준

- 사용자 ID와 역할은 서버 세션 쿠키와 시스템 DB 조회 결과만 신뢰합니다.
- `sessionStorage`, `localStorage`, 요청 파라미터, 임의 사용자 헤더를 인증 또는 관리자 권한의 근거로 사용하지 않습니다.
- 관리자 기능은 서버에서 관리자 역할을 검증합니다.
- 저장된 비밀번호·해시와 인증키를 브라우저 응답, 캐시, 쿠키, JavaScript에 포함하지 않습니다. 관리자 비밀번호 초기화에서 생성한 일회용 임시 비밀번호만 `no-store` 관리자 응답으로 한 번 반환하며 프론트 저장소에는 보관하지 않습니다.
- `.env`, `secrets/`, Wallet, 인증서, DB 접속 정보와 백엔드 소스를 정적 URL로 노출하지 않습니다.
- SQL 값은 바인드 변수로 전달합니다. 사용자 입력을 SQL 문자열에 직접 이어 붙이지 않습니다.
- 파일 업로드는 서버에서 크기, 파일명, 콘텐츠 형식과 접근 권한을 다시 검증합니다.

## 검증

```powershell
.\scripts\validate-source.ps1
.\venv\Scripts\python.exe -m unittest discover -s backend/tests -p "test_*.py"
.\venv\Scripts\python.exe -c "import main; print(main.app.title)"
.\scripts\run-server.ps1
```

서버 실행 후 다음 항목을 확인합니다.

- `GET /api/health`가 성공하는지
- 최초 관리자 초기화와 로그인 세션이 정상인지
- 일반 사용자 가입 후 관리자 승인 전에는 로그인할 수 없는지
- `account`에서 본인 정보만 변경되는지
- 일반 사용자가 `/api/admin/users`, `/api/admin/notices`에 접근할 수 없는지
- 공지 첨부 파일의 업로드 크기 제한과 다운로드 권한이 적용되는지

## Windows UTF-8

PowerShell 출력에서 한글이 깨지면 파일 인코딩을 변경하기 전에 다음 가드를 적용해 다시 확인합니다.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
. .\scripts\codex-utf8.ps1
```

파일은 UTF-8로 유지하며, 콘솔 표시 문제를 파일 손상으로 오인해 전체 파일을 일괄 변환하지 않습니다.
