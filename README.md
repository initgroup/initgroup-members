# (주) 인아이티 경영정보 시스템

FastAPI, Oracle 시스템 DB, 정적 HTML/CSS/JavaScript로 구성한 인아이티 경영진용 인트라넷입니다. 임직원·협력업체·계약 및 프리랜스 인력, 사업·입찰, 프로젝트, 실제 투입과 연간 사업·인력계획을 통합 관리합니다.

정식 서비스 명칭은 **(주) 인아이티 경영정보 시스템**입니다. 사용 승인된 **관리자(`ADMIN`) 등급만 로그인**할 수 있으며, 일반 등급의 기존 세션도 인증 단계에서 거부합니다. 계정 신청은 관리자 등급 부여와 사용 승인이 모두 필요하며 일반 등급은 임직원 데이터 관리용으로 유지합니다.

**모든 금액은 원 단위의 VAT 별도 금액**으로 입력·저장·집계·표시합니다. 발주·수주·연간 매출·목표·원가·비용·단가·손익·과거 소급 총액에도 같은 기준을 적용하고 VAT를 자동 가산하거나 차감하지 않습니다. 기존 `*AmountVat` API 필드와 `*_AMOUNT_VAT` DB 컬럼은 호환성을 위해 이름을 유지합니다. 기존 저장액과 마감 스냅샷을 자동 환산하지 않으므로, 과거에 VAT 포함 금액을 입력했다면 원본 증빙을 확인해 수정 가능한 영역에서 보정해야 합니다. 마감 스냅샷은 기존 보호 정책을 유지합니다.

프론트엔드는 빌드 과정 없이 `frontend/`의 정적 파일을 그대로 서비스하며 Node.js나 npm 설치는 필요하지 않습니다. 기업 홈페이지는 별도 `init-homepage` 프로젝트에서 관리합니다.

## 제공 범위

- `HttpOnly` 쿠키와 서버 DB 세션을 이용한 로그인/로그아웃
- 최초 관리자 가입과 시스템 테이블 초기화
- 이용 권한 신청, 관리자 등급 부여 및 사용 승인
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
│  ├─ config/departments.json     # 내부 임직원 부서 코드·라벨·출력순서
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

- 정식 서비스 이름: 서버는 `backend/site_identity.py`, 브라우저는 `frontend/config/app.config.js`에서 관리합니다. 기존 `APP_NAME` 환경변수로 정식 명칭을 변경하지 않습니다.
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

브라우저 셸의 표시 이름은 `frontend/config/app.config.js`의 `window.APP_NAME`에서 관리하며 서버의 `backend/site_identity.py`와 같은 정식 명칭을 사용합니다. 브라우저 탭 제목은 `window.APP_BROWSER_TITLE`의 `인아이티 | 경영정보시스템`으로 고정하고 로그인·메뉴 이동 시에도 유지합니다. 탭 아이콘은 `frontend/assets/favicon.svg`에 기존 인아이티 로고의 심볼을 표시합니다. 사이드바에서는 작은 인아이티 로고 오른쪽에 `경영정보시스템`을 큰 글씨 한 줄로 강조하고, 접근성 이름과 툴팁에는 정식 명칭 전체를 표시합니다.

내부 임직원 부서는 `frontend/config/departments.json`의 `code`, `label`, `displayOrder`로 관리합니다. 라벨이나 출력순서 변경은 서버 재시작 후 반영되며, 기존 코드를 변경할 때는 `database/INIT_SYSTEM_ALT.sql`의 데이터 보정 경로도 함께 수정해야 합니다.

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
5. 최초 관리자로 로그인한 뒤 이용 권한 신청은 `admin-users` 화면에서 관리자 등급 부여와 사용 승인을 모두 적용합니다. 사용 승인만 한 일반 등급은 로그인할 수 없습니다.

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

프로젝트와 인력 투입은 한 번 등록합니다. 프로젝트 진행상태 `PLANNED`·`BIDDING`은 계획, `CONTRACTED`·`IN_PROGRESS`·`COMPLETED`는 확정/실적으로 자동 분류하며 `CANCELLED`는 집계에서 제외합니다. 상태 변경 후 조회하면 같은 투입이 새 구분으로 표시되므로 계획과 확정을 중복 입력하지 않습니다. 기존 `workforce-planning` 시나리오는 별도 참고 자료로 보존하며 운영 투입 집계에 더하지 않습니다. 기존 계획안 저장의 `revisionNo` 동시수정 검증과 트랜잭션은 유지됩니다.

`project-assignments`는 프로젝트의 등록 투입을 관리합니다. 인력을 프로젝트 월에 배치하거나 기존 배치 카드를 선택·이동하면 상세 편집기로 연결되며, 참여회사·단가·M/M을 검토한 뒤 저장합니다. 투입 구분은 프로젝트 진행상태에서 자동 결정하고 단건·일괄 저장 모두 서버에서 적용합니다. 참여회사와 투입 수정·삭제는 `versionToken`을 비교해 오래된 화면이 다른 관리자의 최신 변경을 덮어쓰지 못하게 합니다.

Oracle `NUMBER(18)` 금액은 브라우저의 JSON number 안전 범위를 넘을 수 있으므로 계획·투입 API는 금액 요청과 응답을 10진수 문자열로 전달합니다. 프론트도 금액 합계와 손익 계산에 `BigInt`를 사용해 18자리 금액의 반올림 손실을 막습니다.

`home`은 올해를 기본 기준연도로 조회하며 회사 연간 목표, 확정 수주금액, 연간 매출·관리 순이익, 확정/계획 투입 건수와 과부하를 요약합니다. 메인은 상단 카드와 선택 연도까지 최근 3년의 목표·매출·관리 순이익 추이를 표시하고 회사 연간 기타비용을 한 번 차감합니다. 연간 합계 표·목표 요약 박스·입찰 검토 대상 카드는 표시하지 않습니다. 다른 화면에서 돌아오면 선택 연도의 데이터를 다시 조회하고 실패는 `—`로 표시합니다. 누락 스키마는 적용 필요 상태로 안내합니다.

관리자 메뉴를 화면에서 숨기는 것은 보조 UI일 뿐 보안 경계가 아닙니다. 관리자 API는 서버 세션의 역할을 다시 검증해야 합니다.

## semantic 페이지 추가

일반 메뉴의 화면 이동 정보(`routeContext`)는 `null`이며 상세 링크에서만 연도·대상 등이 전달될 수 있습니다. 각 화면은 메뉴 최초 진입과 캐시된 화면 재활성화 모두 빈 이동 정보를 허용합니다. 회귀 검증은 `scripts/tests/dashboard-browser.cjs`에서 메뉴의 `null`·생략된 컨텍스트와 상세 링크를 함께 확인합니다.



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
- 사용 승인 여부와 관계없이 일반 등급의 신규 로그인과 기존 세션이 거부되는지
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

## 경영 현황과 보드 보기

연간 목표·실적의 **팀원별 목표와 선택 단가 기준 참고매출 보기 → 단가 입력**에서 해당 팀원의 프로젝트별 확정 투입을 확인합니다. **매출단가 입력**을 누르면 해당 연도·프로젝트·투입의 **사업·인력 관리 → 빠른 설정 → 개인 참고매출 단가 (원/M/M · VAT 별도)**가 열립니다. **저장하고 보드 반영** 후 **연간 참고 지표로 돌아가기**를 누르면 개인 참고매출(확정 투입 M/M × 저장 단가), 참고 달성률(참고매출 ÷ 연간 목표), 참고손익(참고매출 − 전체 인력원가)이 갱신됩니다. 일부만 입력했다면 입력분 계산값에 **일부 단가 미입력**을 표시하고, 모든 단가가 없으면 계산 대기로 표시합니다. 확정 투입 자체가 없으면 활동 0으로 구분합니다. 마감 기록은 조회만 제공하며 회사·사업부 매출에 개인 참고매출을 더하지 않습니다. 단가 입력 이동과 복귀 시 연간 목표·비용의 미저장 초안과 원래 revision을 보존합니다.

경영 현황의 회사 매출은 **사업·입찰 관리 → 프로젝트 상세 → 연도별 매출**에 직접 입력한 VAT 별도 연간 매출액입니다. 상세 자료가 없는 과거 연도에 한해 과거 회사 총액 소급을 사용합니다. 수주금액은 계약 총액으로 별도 관리하고, 개인 매출단가로 회사 매출을 대신 계산하지 않습니다. 인력원가는 해당 연도의 저장 투입 M/M × 원가단가이며 수행기간과 투입기간의 교집합만 반영합니다. 회사 연간 기타비용은 순이익에서 한 번 차감합니다. 계획·입찰은 계획, 계약·진행·완료의 프로젝트 매출만 실적으로 합산하며 취소는 제외합니다.

사업·인력 보드의 기본 조회 기준은 프로젝트 진행상태입니다. 기존 별도 계획안에 사업이 있으면 참고 보기 선택기를 제공하여 기존 자료를 조회할 수 있습니다. DB 데이터를 복제하거나 일괄 수정하지 않고 현재 프로젝트 상태를 조회 시 적용하므로 별도 데이터 이관이나 DDL 실행은 필요하지 않습니다.

사업·입찰 관리의 프로젝트를 선택하면 이동 가능한 상세 팝업이 열립니다. 제목 표시줄을 드래그해 위치를 옮기고, 기본 정보·참여회사 버튼으로 영역을 이동합니다. 저장하지 않은 입력이 있으면 닫기 전에 확인합니다.

인력·프로젝트·기간 보드의 프로젝트 탭은 요약 상태로 시작합니다. 각 프로젝트의 인력 펼치기·접기로 개별 전환하며, 프로젝트 정렬 왼쪽의 프로젝트 요약·전체 인력 펼치기로 일괄 전환합니다. 편집 모드를 켜면 배치 순서를 확인할 수 있도록 전체 인력을 펼칩니다. 접힌 프로젝트에 인력을 배치하려면 먼저 펼쳐야 합니다.

인력 탭은 개인별·사업부별 요약을 전환합니다. 사업부는 `frontend/config/departments.json` 순서를 따르며 협력업체는 회사별, 부서가 없는 내부 인력은 부서 미지정으로 구분합니다. 요약은 조회 인력과 필터가 적용된 프로젝트의 투입 인원·M/M을 보여주고, 가용량과 과부하는 해당 인력의 전체 프로젝트 투입을 기준으로 계산합니다. 가용량은 등록된 가용기간 안에서 월 1 M/M을 기준으로 하며 휴가·근무일별 정밀 가용량은 아닙니다.

종합 검토와 후속 개선 우선순위는 [경영 현황 검토 기록](reference/management-review.md)을 참고하세요. 회귀 검증은 `node --test scripts/tests/*.test.js`, 브라우저 검증은 `node scripts/tests/dashboard-browser.cjs`로 실행합니다. 브라우저 검증은 별도 프로필과 합성 데이터를 사용하며 결과 이미지는 Git 제외 경로인 `test-results/dashboard-review/`에 생성합니다. Node와 Edge는 이 선택적 개발 검증에만 사용하며 서비스 실행 조건은 바뀌지 않습니다.

개인별 인력 보드의 왼쪽 요약은 사진과 이름·소속을 나란히 표시하고, 하단에 참여 사업 수와 `인력정보`·`투입내역` 버튼을 한 줄로 배치합니다. 같은 프로젝트의 여러 배치는 사업 수에서 한 번만 계산합니다. 축소 보기에서도 버튼 문구는 줄바꿈하지 않으며, 긴 이름·소속은 말줄임과 마우스 설명으로 확인합니다.

사업부별 요약의 좌측에는 조회 인원, 표시 기간의 중복 없는 투입 인원·참여 프로젝트 수, 누적 투입 M/M·잔여 가용 M/M, 과부하 인원·발생 월 수를 표시합니다. 하단에 집계 기간을 명시하며 가용 합계는 현재 가용인원이 아닌 표시 기간 전체의 잔여 M/M입니다. 동일 프로젝트의 확정·계획 행은 참여 프로젝트 수에서 한 번만 계산합니다.

중복·과부하는 **같은 인력의 같은 달 전체 프로젝트 합계가 1 M/M을 초과할 때**만 표시합니다. `0.5 + 0.5 = 1.0`은 정상 분할 투입입니다. 같은 프로젝트의 복수 배치도 합산하며 0 M/M·해제 예정 행과 취소 사업은 제외합니다. 가용기간 밖의 월은 잔여 가용량 계산에 0을 사용하지만, 중복·과부하 판정 기준은 1 M/M입니다.

보드와 메인의 알림은 선택 연도 기준으로 **한 인력당 한 박스**를 표시하고 일부 월만 잘라 보여주지 않습니다. 예: `홍길동 · 총 4개월 초과투입 / 1월, 4월, 5월, 6월`. 인원 수와 인·월 합계를 구분합니다. 박스나 인원 수를 누르면 `workforce-load-detail`의 별도 상세 화면에서 인력별 모든 초과 월, 합산 M/M·초과량·판정 사유와 원인 배치를 확인합니다. 프로젝트 필터로 들어오면 같은 범위를 유지하되 해당 월의 투입량은 전체 프로젝트를 합산합니다. 배치 설정과 요약 화면 복귀도 제공합니다. 상단에 `사업·계획 → 사업·인력 관리 → 초과투입 인력 → 선택 인력` 경로와 실제 진입 화면을 표시합니다. 경로에서 상위 목록으로 이동할 수 있고, 복귀 버튼에는 목적지를 명시하며 연도·프로젝트 조건을 유지합니다. 직접 접근해 진입 화면을 알 수 없으면 소속 상세 화면임을 표시합니다. 관리자의 인증된 페이지 목록에 등록하며 사이드 메뉴에는 별도 항목을 표시하지 않고 상위 사업·인력 관리 메뉴를 활성화합니다. 기존 `/api/home/dashboard` 조회를 사용하므로 새 저장 API나 DB 구조는 추가하지 않습니다.

프로젝트·사업부 월별 요약, 사업부 좌측 집계, 상단 프로젝트·투입·가용 숫자, 인력 월별 표시와 배치의 **사유** 버튼은 기존 **상세 사유 레이어**를 제공합니다. 인력·월별 합산 투입, 판정 기준, 초과량, 원인 프로젝트와 배치 번호·투입기간·M/M을 함께 표시합니다.

상세 레이어는 현재 필터 밖의 배치도 포함하고 조회 범위·저장 상태를 표시합니다. 보드의 미저장 변경·설정 미리보기는 레이어에서 확인하며, 별도 상세 페이지와 메인은 저장된 운영 투입을 조회합니다. 미저장 변경이 있으면 기존 화면 이탈 확인을 유지하므로 저장 후 상세를 조회합니다. 메인의 입찰 검토 목록에서도 선정 사유와 대상 자료를 확인할 수 있습니다. 레이어는 제목으로 이동하고 검색·펼침·Esc 닫기를 지원하며 조회만 수행합니다. 새로고침·페이지 이탈 시 닫고 화면 종료 시 리스너를 정리합니다.

## 연간 목표·실적 관리

관리자 메뉴 **사업·계획 → 연간 목표·실적**에서 직원별 **연간** 목표를 한 번 입력합니다. 사업부는 직원 목표를 자동 합산하며 필요한 경우 사업부·회사 추가목표를 더합니다. 월 목표를 직접 입력하지 않습니다.

`사업부 연간 목표 = 소속 직원 연간 목표 합계 + 사업부 연간 추가목표`

`회사 연간 목표 = 전체 사업부 목표 합계 + 회사 연간 추가목표`

- **직원 연간 목표 저장**: 직원(정규직·임원)의 연간 금액을 입력합니다. 사업부 필터·이름 검색으로 찾을 수 있고 금액은 쉼표로 표시합니다. 계약직·외부인력은 실적만 반영합니다. 목표 귀속 사업부는 저장 시점의 연도별 소속 이력을 사용하고 이후 이동·퇴사로 자동 재배분하지 않습니다.
- **사업부 추가목표 저장**: 직원 합계에 더할 금액만 입력합니다. 추가목표가 없으면 0원으로 두며 직원 목표를 다시 입력하지 않습니다.
- **회사 추가목표 저장**: 사업부 합계에 더할 회사 금액만 입력합니다. 직원·사업부 합계와 최종 회사 목표를 입력 중에도 확인할 수 있습니다.
- **연간 비용 저장**: 회사 전체 기타비용의 연간 금액과 내역을 한 번 입력합니다. 인력원가에 포함된 비용은 중복 입력하지 않습니다. 회사 관리 순이익은 `매출 − 인력원가 − 회사 기타비용`, 사업부·팀원·프로젝트 투입 손익은 `매출 − 인력원가`입니다.

각 영역은 저장 버튼과 수정 버전이 독립되어 있습니다. 한 영역을 저장해도 다른 영역의 미저장 입력은 남아 있습니다. 같은 영역을 다른 사용자가 수정했을 때는 충돌을 알려 재조회를 요구합니다. 상단 실적 카드·비교 표와 메인은 저장 기준이며 입력 중 합계는 별도 표시합니다.

목표·매출·인력원가·회사 비용·순이익은 선택 연도의 연간 합계로 계산합니다. 메인과 연간 화면은 같은 집계를 사용합니다. 메인의 월별·누적 매출 그래프와 실적/계획 전환, 단가 확인은 제거하고 선택 연도를 포함한 **최근 3년의 연간 목표·프로젝트 등록 매출·관리 순이익**을 같은 금액 축의 막대로 표시합니다. 예를 들어 기준연도 2026년이면 2024·2025·2026년을 비교합니다. 손실은 0선 아래 빨간 막대로 표시하고, 미등록은 저장된 0원과 구분합니다. 마감 연도는 당시 스냅샷을 사용하며 해당 연도의 막대를 누르면 연도를 유지해 목표·매출·순이익 상세를 엽니다. 펼침 표에서 연도별 정확한 금액·달성률·미등록 상태와 선택 연도의 프로젝트별 매출을 확인합니다. 연간 목표나 프로젝트 매출을 월별로 균등 분할하지 않습니다. 회사 비용은 사업부·팀원·프로젝트에 배분하지 않습니다.

과거 상세 자료가 없으면 메인의 **과거 총액 입력** 또는 **연간 목표·실적 → 과거 총액 소급**에서 연간 회사 매출 총액(VAT 별도)을 입력합니다. 목표 총액과 순이익은 선택 항목이며, 비우면 미입력으로 유지합니다. 손실은 순이익에 음수로 입력합니다. 원가나 사업부·인력·프로젝트 내역을 역산하거나 생성하지 않습니다. 순이익을 입력한 연도만 순이익 막대와 금액을 표시하고, 총액 출처는 **소급 총액**으로 표시합니다. 메인과 연간 화면은 같은 총액을 사용합니다.

소급은 현재 연도보다 이전이며 프로젝트별 매출 행이 없고 마감하지 않은 연도만 허용합니다. 기존 직원·사업부·회사 목표가 있으면 그 합계를 유지하고 소급 목표 총액은 추가 입력하지 않습니다. 총액 적용 중에는 상세 매출·목표·비용 입력을 막아 중복을 방지합니다. 상세 자료가 확보되면 **총액 적용 해제** 후 상세를 입력합니다. 해제는 논리 상태와 revision을 갱신해 원본 총액을 보존하며, 오래된 초기 revision으로 다시 덮어쓰지 못하게 합니다. 마감 스냅샷은 소급 총액과 미입력 상태도 보존합니다.

프로젝트 상세의 **연도별 매출**에서 수행기간에 따라 `1차년 · 2025년`, `2차년 · 2026년`, `3차년 · 2027년` 행을 표시합니다. 세금결산 기준 당사 매출 합계(VAT 별도)와 내역을 각 연도마다 따로 저장합니다. 실제 결산연도가 수행기간 밖이면 **연도 추가**로 입력할 수 있습니다. 총수주금액과 여러 연도의 등록 매출 합계를 함께 보여주며, 미등록과 확인된 0원 매출을 구분합니다. 다른 연도의 미저장 입력은 저장 시 보존하고, 같은 연도의 동시 수정은 revision 검증으로 거부합니다. 마감 연도는 수정하지 않습니다.

메인의 **매출 미등록 N건**은 선택 연도와 수행기간이 겹치는 계약 이후 프로젝트 중 해당 연도의 매출 행이 없는 대상을 표시합니다. 현재·과거 연도를 대상으로 안내하며, 매출 발생 전일 수 있으므로 오류로 단정하지 않습니다. 프로젝트별 버튼을 누르면 해당 연도 입력란으로 바로 이동합니다. 매출 발생 후 합계를 입력하거나, 해당 연도에 매출이 없음을 확인했다면 0원으로 저장할 수 있습니다.

상단은 회사 연간 목표·확정 수주·연간 매출·관리 순이익·확정/계획 투입의 5개 카드로 구성합니다. **회사 연간 목표** 카드에는 직원·사업부 추가·회사 추가목표 금액과 달성률을 함께 표시하고, **관리 순이익** 카드에는 인력원가와 회사 기타비용을 표시합니다. 금액은 원 단위와 쉼표를 유지해 한 줄로 표시하며 카드 크기에 맞춰 글자 크기를 조정합니다. 설명은 짧은 한 줄로 표시하고 긴 내용은 마우스를 올려 확인할 수 있습니다. 카드 숫자를 누르면 선택 연도를 유지해 직원·사업부 추가·회사 추가목표 입력, 계약 이후 프로젝트 목록, 프로젝트별 매출, 회사 순이익 비교, 확정·계획 투입 보드로 각각 이동합니다. 목표·매출 막대에서도 해당 상세를 열 수 있습니다. 프로젝트 목록의 ‘계획·입찰’·‘계약·진행·완료’는 조회용 묶음이며 프로젝트의 저장 상태는 기존 여섯 단계를 사용합니다.

개인 매출단가는 **선택 항목**이며 `투입 M/M × 개인 단가`로 직원 목표 대비 **개인 참고매출**만 비교합니다. 회사·사업부 매출에 다시 합산하지 않습니다. 사업부 매출은 프로젝트별 연간 매출을 해당 연도의 소속·고용 이력과 투입 M/M 비중으로 귀속하며, 직원·계약직/외부 귀속분과 인력 미배분 매출을 구분합니다. 해당 연도에 투입 인력이 없으면 프로젝트 담당 사업부에 귀속합니다. 원 단위 합계를 보존하며, 원가와 회사 비용을 차감한 값은 입력 자료 기준의 관리 순이익입니다.

사업·인력 관리 보드의 투입 막대 기본 클릭과 **매출단가 수정** 버튼은 선택 개인 단가 입력란을 엽니다. 이름 링크는 인력 상세를 엽니다. 투입 해제 **×**는 항상 표시하고 저장 전 취소할 수 있습니다. 단가와 프로젝트 매출은 서로 다른 값으로 유지합니다.

프로젝트 금액·진행단계는 **사업·입찰 관리**의 원본만 입력·조회합니다. 연간 화면에서 수주 목표·결과를 다시 등록하지 않습니다. 계약·진행·완료는 확정 실적, 계획·입찰은 계획, 취소는 제외합니다. 외부인력 실적 귀속은 프로젝트의 **담당 사업부**, 내부 임직원 실적은 해당 날짜의 소속·고용 이력으로 계산합니다. 수주금액을 연간 매출에 더하지 않습니다.

소속·고용 이력은 **임직원 관리 → 임직원 상세 → 소속·고용 이력 보기**에서 조회·추가·수정·삭제합니다. 도입 초기값은 당시 인사정보이므로 필요한 과거 이동을 보정해야 합니다. 현재 적용 이력 변경은 기본정보에도 함께 반영합니다. 마지막 이력과 마감월에 영향을 주는 이력은 보호합니다. 기본정보의 적용일을 비우면 오늘부터 이력을 기록합니다.

종료된 연도는 자료를 확인한 뒤 **연도 마감**합니다. 당시 연간 목표·비용·실적을 JSON으로 보존하며 이후 인사·프로젝트 변경에도 유지됩니다. 마감한 연도의 목표·비용과 그 연도에 영향을 주는 인사 이력은 수정할 수 없습니다. 일반 화면에서 마감을 취소하지 않습니다. 프로젝트 수주금액·연간 매출은 VAT 별도으로 통일합니다. 이미 마감한 연도는 변경 전 집계 스냅샷을 보존합니다.

과거 소급 총액은 `INIT$_TB_YEAR_HISTORY_TOTAL`에 저장하며 DDL/ALT와 수동 복구용 allowlist에 등록했습니다. 현재 DB에는 2026-10-26 적용했습니다. 적용·해제·대금액 정밀도·동시 수정·마감 보호 검증은 롤백했으며 실제 과거 금액은 임의로 입력하지 않았습니다. 설치는 아래 스크립트 또는 연간 목표 스키마 설치 스크립트에서 명시적으로 수행합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\apply-historical-totals.ps1
```

프로젝트 연간 매출 스키마는 `INIT$_TB_PROJECT_REV_YEAR` 한 테이블이며 DDL/ALT에 기록했습니다. 기존 DB에는 명시적 설치 스크립트로 적용하며 요청 처리나 일반 서버 시작에서 DDL을 실행하지 않습니다. 2026-10-26 현재 환경에 적용했고 기존 프로젝트·투입·목표·마감 자료는 변경하지 않았습니다. 잘못된 배포의 복구 시 매출 행은 보존하고 검증된 이전 소스로 되돌리며 자동 DROP/TRUNCATE를 실행하지 않습니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\apply-project-revenue.ps1
```

전체 스키마는 `INIT_SYSTEM_DDL.sql`, 증분은 `INIT_SYSTEM_ALT.sql`에 관리합니다. V4에서 회사 연간 비용 테이블과 연간 마감 보존 컬럼을 추가했고 이 환경에는 2026-10-24 적용했습니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\apply-annual-targets.ps1
```

V1·V2 월별 직원 목표는 직원별 연간 합계로 이관하고 기존 사업부 목표에서 직원 합계를 뺀 금액만 사업부 추가목표로 이관합니다. 연도 모델 버전으로 중복 이관을 막습니다. 기존 월 목표 테이블과 프로젝트 목표·사업부 비용 테이블은 보존용으로 유지하며 새 저장은 연간 목표만 기록합니다. V4는 기존 월별 회사 비용을 연간 합계로 한 번 이관하고 기존 월 비용과 마감 JSON을 보존합니다. 과거 월 마감의 투입 실적은 연간 실제 합계에 한 번만 반영합니다.

Oracle DDL은 커밋되므로 부분 실패 시 추가된 객체를 유지한 채 재실행합니다. 복구 시에는 스키마와 마감 자료를 보존하고 V4 호환 소스를 사용합니다. 과거 소스로 되돌려 월 목표를 다시 편집하지 않습니다. `DROP`/`TRUC`는 자동 실행하지 않습니다.

검증: `scripts/validate-source.ps1`, 백엔드 단위 테스트, `scripts/tests/dashboard-browser.cjs`. 실제 DB 검증은 `.\venv\Scripts\python.exe scripts/tests/annual-targets-db-check.py`이며 미사용 2099년의 영역별 저장·연간 합산·연간 비용 1회 차감·연도 마감 보존·이력 CRUD를 확인하고 전부 롤백합니다. 업무용 목표·비용·연도 마감은 임의 등록하지 않았습니다.

## 자주 쓰는 PowerShell 명령어

프로젝트 루트의 PowerShell 터미널에서 필요한 명령어를 각각 실행합니다.

### 서비스 시작

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-server.ps1
```

### Git 배포

전체 변경사항을 스테이징하고 커밋한 뒤, 원격 main 브랜치와 rebase하고 push합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\git-publish-main.ps1
```

### 백업

미커밋 변경사항을 포함한 작업 소스를 프로젝트 상위의 `backup` 폴더에 백업합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\backup-source.ps1 -Mode Working
```
