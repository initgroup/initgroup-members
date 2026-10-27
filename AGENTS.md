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
- 내부 임직원 부서의 코드, 표시 라벨, 출력순서는 `frontend/config/departments.json`을 단일 원본으로 관리합니다. 기존 부서 코드를 변경할 때는 `DEPARTMENT_CODE` 데이터 보정과 하위 호환 영향을 함께 확인합니다.

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
| `annual-targets` | `backend/routers/annual_targets.py` | `/api/planning/annual-targets` |
| `workforce-load-detail` | `backend/routers/home.py` 조회 재사용 | `/api/home/dashboard` |
| `project-assignments` | `backend/routers/project_assignments.py` | `/api/project-assignments` |

## 인증·인가 필수 기준

- 정식 서비스 명칭은 `(주) 인아이티 경영정보 시스템`입니다. 서버의 `backend/site_identity.py`와 브라우저의 `frontend/config/app.config.js`에 같은 명칭을 유지하고 환경변수로 다른 명칭을 노출하지 않습니다.
- 사용 승인된 `ADMIN` 등급만 로그인할 수 있습니다. 신규 로그인과 기존 세션의 DB 조회·요청 캐시·공유 캐시 경로에서 모두 역할을 검증합니다. 계정 신청만으로 관리자 권한을 부여하지 않으며 일반 등급의 임직원 데이터는 보존합니다.
- 모든 금액은 VAT 별도 기준으로 입력·저장·집계·표시합니다. 기존 `*AmountVat`/`*_AMOUNT_VAT` 식별자는 호환성을 위해 유지하며 세금을 자동 가산·차감하지 않습니다. 기존 저장액·마감 스냅샷의 일괄 환산은 별도 명시적 요청 없이 수행하지 않습니다.

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
- 조회와 DML 모두 `conn = None`, `cursor = None`으로 초기화하고 `try` 내부에서 시스템 DB 커넥션과 커서를 얻습니다. `finally`에서는 생성된 커서와 커넥션만 닫습니다.
- 트랜잭션 소유자는 업무 단위의 라우터 또는 서비스 함수입니다. 여러 SQL로 구성된 저장은 같은 커넥션에서 실행하고 업무가 모두 성공한 마지막 지점에서 한 번만 `commit()`합니다.
- `HTTPException`과 예상하지 못한 예외 모두 활성 트랜잭션을 `rollback()`한 뒤 처리합니다. 예상하지 못한 예외는 서버 로그에 원인을 남기고 Oracle 원문을 포함하지 않은 일관된 오류 응답으로 변환합니다.
- `execute_query(..., is_dml=True)`는 그 호출 하나가 독립 트랜잭션인 경우에만 사용합니다. 여러 SQL을 하나의 업무 트랜잭션으로 묶을 때는 사용하지 않으며 라우터 또는 서비스가 직접 commit/rollback을 소유합니다.
- Oracle 오류 응답은 `backend/database_errors.py`의 공통 분류를 사용합니다. 명시한 제약조건 충돌만 409, 스키마 누락과 연결·풀 장애는 503, 그 밖의 예상하지 못한 DB 오류는 500으로 처리합니다.
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
- 운영 프로젝트·인력 투입은 한 번 등록하며 프로젝트 `STATUS_CODE`를 분류의 단일 기준으로 사용합니다. `PLANNED`·`BIDDING`은 계획, `CONTRACTED`·`IN_PROGRESS`·`COMPLETED`는 확정/실적, `CANCELLED`는 집계 제외입니다. 투입별 저장 상태를 분류 근거로 사용하지 않습니다. 단건·일괄 저장과 조회가 같은 기준을 따라야 합니다.
- 기존 별도 계획 시뮬레이션 데이터는 참고 기능으로 보존하고 운영 투입과 합산하지 않습니다. 기존 계획안 전체 저장은 시나리오 행 잠금과 revision 검증 후 하나의 트랜잭션으로 처리하고 월별 M/M은 조회 가능한 행 구조로 저장합니다.
- 목표는 직원(정규직·임원)별 연간 금액을 한 번 입력하고 사업부·회사로 자동 합산합니다. 사업부·회사는 합계에 더할 연간 추가목표만 입력합니다. 월 목표를 별도 입력하거나 인원 비례로 생성하지 않습니다. 목표·회사 비용은 연간 값으로 저장하며 손익도 연간 기준입니다. 메인에는 선택 연도를 포함한 최근 3년의 연간 목표·프로젝트 매출·관리 순이익을 같은 금액 축의 막대로 비교합니다. 각 연도는 동일한 연간 원장/마감 스냅샷을 조회하며 선택 연도 집계는 재사용합니다. 손실은 0선 아래에 표시하고, 미등록과 저장된 0원을 구분하며 막대 상세 이동 시 해당 연도를 유지합니다. 월별 매출 그래프·월 환산은 제공하지 않고 연간 매출을 균등 분할하지 않습니다. 계약직·외부인력은 실적만 반영합니다.
- 직원 목표·사업부 추가목표·회사 추가목표·회사 기타비용은 독립 영역별 API와 저장 버튼을 사용합니다. 영역별 revision과 연도 행 잠금을 검증하고 다른 영역의 미저장 입력·원래 revision을 보존합니다. 조회 시 버전을 편집 데이터보다 먼저 읽어 오래된 데이터에 새 버전이 붙는 일을 방지합니다. 연도 마감은 모든 영역 revision을 올려 변경을 감지하도록 합니다.
- 회사 기타비용은 연간 금액과 내역을 한 번만 입력하고 연간 순이익에서 한 번 차감하며 사업부·팀원·프로젝트에 배분하지 않습니다. 프로젝트 수주 정보는 사업·입찰 관리 원본만 사용하며 별도 목표/결과 입력을 만들지 않습니다. 메인과 연간 화면은 같은 연간 목표·비용·실적 집계를 사용합니다. 회사 매출은 프로젝트 관리의 결산연도별 VAT 별도 매출액만 합산하며 수주금액과 구분합니다. 개인 매출단가는 선택 항목으로 목표 대비 참고매출만 계산하고 회사·사업부 매출에 더하지 않습니다. 인력원가는 프로젝트·투입기간의 교집합 및 선택 연도에 제한합니다. 사업부 매출은 프로젝트 연간 매출을 소속·고용 이력에 따른 해당 연도 투입 M/M 비중으로 원 단위 합계를 보존해 귀속하며 투입이 없으면 프로젝트 담당 사업부로 귀속합니다. 소속 이력과 과거 월 마감 스냅샷을 보존하고 종료 연도는 연간 스냅샷으로 마감합니다. 마감 연도의 목표·비용·인사 이력은 일반 API에서 변경하지 않습니다.
- 메인 차트는 제목을 한 번만 표시하고 연간 목표·프로젝트 매출 비교와 매출 미등록 입력 링크를 간결하게 배치합니다. 긴 설명은 툴팁·접근성 설명·상세로 제공하고, 1366×768 등 대표 데스크톱에서 앱 헤더·사이드바 공간을 감안해 그래프와 요약이 첫 화면에 들어오는지 검증합니다. 좁은 화면에서는 컨트롤을 감싸되 기능·금액을 잘라 숨기지 않습니다.
- 메인의 연간 목표 구성·달성률은 목표 카드, 인력원가·회사 기타비용은 순이익 카드에 통합합니다. 별도 연간 합계 표·목표 요약 박스·입찰 검토 대상 카드를 다시 추가하지 않습니다. 원 단위 금액은 줄바꿈·잘림 없이 표시하고 카드 폭이 바뀌면 글자 크기를 조정합니다. 설명은 짧은 한 줄을 우선하며 목표 구성 금액은 각각 해당 입력 영역으로 이동합니다.
- 메인의 목표·매출은 같은 축의 막대로 비교하고 KPI 상세 이동 시 기준연도·단계 필터를 유지합니다. `PRE_CONTRACT`·`POST_CONTRACT`는 프로젝트 목록의 조회 전용 묶음이며 프로젝트 저장 상태로 허용하지 않습니다. 메인의 단가 확인은 제거하고 현재·과거 연도의 계약 이후 프로젝트에서 연간 매출 행이 없을 때 미등록 안내와 해당 연도 입력 링크를 제공합니다. 매출 발생 전일 수 있으므로 오류로 단정하지 않습니다. 연간 매출 0원 저장과 미등록을 구분합니다. 수주금액이나 개인 단가를 회사 매출로 대체하지 않습니다. 투입 빠른 설정의 매출·원가단가는 상단에 항상 표시하며 원/M/M 단위와 저장 방법을 안내합니다. 보드 투입 막대의 기본 클릭·Enter/Space는 매출단가 입력란을 열고 초점을 둡니다. 프로젝트 기준 막대는 이름 링크만 인력 상세를 열며 오른쪽에 매출단가 수정 텍스트 버튼을 제공합니다. 과부하·해제 등 개별 동작은 기본 클릭보다 우선합니다. 프로젝트 막대의 ×는 항상 표시하며 비편집 상태에서 누르면 편집 모드를 활성화하고 해제 대상으로만 표시합니다. 즉시 삭제하지 않고 기존 저장·취소 흐름을 유지합니다. 이름 링크는 주변 정보와 비슷한 크기와 굵기를 사용합니다.
- 소속·고용 이력 CRUD는 임직원 상세에서만 제공합니다. 적용일별 이력과 현재 기본정보는 한 트랜잭션으로 일치시키며 마감월 보호·동시 수정 버전 검증을 유지합니다. 목표 금액은 이력 변경으로 자동 재배분하지 않습니다. 외부인력 귀속 사업부는 프로젝트 원본에서 관리합니다.
- 상세 자료가 없는 과거 연도는 `INIT$_TB_YEAR_HISTORY_TOTAL`의 회사 매출 총액과 선택 목표·순이익으로 소급합니다. 현재·미래 연도, 프로젝트 매출 행이 있는 연도와 월/연 마감은 소급 저장을 거부합니다. 기존 연간 목표 행이 있으면 그 합계를 유지하고 소급 목표를 별도로 입력하지 않습니다. 원가·사업부·개인 상세를 역산하지 않고 `costBreakdownAvailable=false`와 nullable 순이익/기록 여부를 유지하며 메인·연간 화면에 출처를 표시합니다. 소급 총액과 상세 매출은 합산하지 않습니다. 총액 적용 중에는 정상 목표·비용·프로젝트 매출 저장을 막고, 논리 적용 해제 후 전환합니다. 적용 해제·연도 마감에도 revision을 올려 ABA 충돌을 방지하며 과거 마감 스냅샷을 보존합니다. 메인의 과거 총액 입력과 과거 미등록 막대는 연도를 유지해 연간 목표·실적의 소급 영역으로 이동합니다. 설치는 `scripts/apply-historical-totals.ps1` 또는 명시적 연간 목표 설치에서만 실행합니다.
- 프로젝트 연간 매출은 `INIT$_TB_PROJECT_REV_YEAR`와 `scripts/apply-project-revenue.ps1`로 관리합니다. 프로젝트·연도별 독립 저장/revision을 사용하고 다른 연도의 미저장 입력을 보존합니다. 연도 잠금 → 프로젝트 잠금 순서를 유지하고 연도 마감·과거 월 마감 보호를 적용합니다. 입력은 사업·입찰 관리에서만 제공하며 1차년·2차년처럼 수행기간별 결산연도를 자동 표시하고 추가 결산연도도 지원합니다.
- 연간 목표 신규 스키마는 `scripts/apply-annual-targets.ps1`로 명시적으로 적용하며 API 요청이나 일반 서버 시작에서 DDL을 실행하지 않습니다. 관리자 메뉴/페이지 파일 목록은 `backend/portal_access.py`가 로그인 역할에 따라 제공하므로 공용 정적 메뉴에 관리자 페이지를 노출하지 않습니다.
- `INIT_SYSTEM_DROP.sql`과 `INIT_SYSTEM_TRUC.sql`은 정확한 시스템 객체 allowlist만 사용하며 실행 인자로 지정한 DB 소유자와 `SESSION_USER`·`CURRENT_SCHEMA`가 모두 일치해야 합니다. 사용자가 실행을 명시적으로 요청하지 않으면 실행하지 않습니다.
- 새 컬럼은 `INIT_SYSTEM_DDL.sql`의 해당 테이블 맨 뒤와 `INIT_SYSTEM_ALT.sql`에 같은 순서로 추가합니다. Oracle은 기존 컬럼 사이에 새 컬럼을 물리적으로 삽입할 수 없으므로 중간 삽입을 전제로 작성하지 않습니다.
- 컬럼 타입, NULL, DEFAULT 또는 데이터 보정이 필요한 변경은 기존 데이터 영향도를 확인할 수 있도록 별도 버전 블록으로 작성하고 자동 DROP/TRUNCATE를 사용하지 않습니다.

## 프론트엔드

- 연간 팀원 참고 지표의 단가 입력은 기존 운영 투입의 매출단가 저장을 재사용합니다. 연도·프로젝트·투입 ID를 유지해 빠른 설정으로 이동하고 연간 참고 지표로 복귀합니다. 일부 단가만 입력하면 입력분 참고매출·달성률과 전체 인력원가를 차감한 참고손익에 `일부 단가 미입력`을 표시합니다. 확정 투입 없음과 단가 누락을 구분하며 월/연 마감 기록은 수정하지 않습니다. 단가 입력 이동·복귀 시 목표·비용의 미저장 초안과 원래 revision을 보존하고 보고서만 갱신합니다.

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
- 일반 메뉴 진입과 캐시 화면 재활성화의 `routeContext`는 `null`일 수 있습니다. 경로 처리 함수는 `null`·`undefined`를 빈 컨텍스트로 처리하고, 기본 인자 `route = {}`만으로 `null`까지 처리된다고 가정하지 않습니다. 상세 링크뿐 아니라 메뉴 최초 진입·재진입도 검증합니다.
- 페이지 내부 요소는 전역 `document.querySelector` 대신 `root.querySelector`로 찾습니다.
- DOM ID와 페이지 전용 CSS 선택자에는 page name 또는 해당 화면에 고유한 기능 prefix를 사용해 다른 화면과 충돌하지 않게 합니다.
- API 호출은 `Common.api.request`를 사용합니다.
- 이벤트 리스너, 타이머, observer 같은 화면 리소스는 `destroy()`에서 정리합니다.
- 화면을 추가하면 `MENU_CONFIG`, `PAGE_FILE_CONFIG.htmlPages`, `PAGE_FILE_CONFIG.scriptPages`를 함께 수정합니다.
- `workforce-management`의 프로젝트 접힘 상태와 인력 사업부 요약은 표시 상태이며 저장 DML을 발생시키지 않습니다. 투입 인원은 중복 인력을 제거하고 M/M은 배분별로 합산합니다. 가용량·과부하는 필터 밖 프로젝트의 투입도 반영하며, 부서 라벨·순서는 `frontend/config/departments.json`을 따릅니다.
- 개인별 인력 보드의 왼쪽 요약은 사진·이름·소속 영역과 하단 요약·버튼 영역을 구분합니다. 버튼은 줄바꿈·축소되지 않게 배치하고 일반·축소 보기에서 폭을 검증합니다. 참여 사업 수는 프로젝트 ID로 중복 제거하며 긴 소속은 말줄임·툴팁을 제공합니다.
- 중복·과부하는 월 합산 `M/M > 1`만 판정합니다. 복수 프로젝트라도 `0.5 + 0.5`는 정상이며 동일 프로젝트 복수 배치도 합산하고 0 M/M·해제 예정 행은 제외합니다. 가용기간은 잔여 가용량에만 별도 반영합니다. 메인과 보드 알림은 `Common.workload.groupOverloads`로 인력 ID별 한 박스에 모든 초과 월을 요약하고 목록을 임의로 잘라 표시하지 않습니다. 동명이인은 합치지 않으며 인원 수와 인·월을 구분합니다.
- 알림 인력 박스와 인원 수는 관리자용 `workforce-load-detail`로 이동해 월별 판정 사유와 원인 배치를 표시합니다. 연도·프로젝트 필터를 유지하고 기존 인증된 `/api/home/dashboard`의 저장 투입을 조회합니다. `backend/portal_access.py`에서 메뉴 메타데이터·HTML·스크립트 목록에 등록하고 `hidden`은 메뉴 표시만 제어합니다. 숨김 상세의 `parentPage`는 사이드 메뉴의 현재 위치 표시용이며 권한을 상속하지 않습니다. 초과투입 상세에는 상위 경로와 실제 진입 화면, 목적지가 명확한 복귀 버튼을 제공하고 연도·프로젝트 조건을 유지합니다. 같은 페이지의 인력 선택·전체 목록 전환은 내부 상태를 갱신해 처리합니다. 월별 보드 셀·배치의 기존 `Common.ui.createDetailDialog` 레이어는 미저장 변경도 표시하며 범위·상태를 명시합니다. 새로고침·이탈·종료 시 레이어와 상세 페이지 리스너를 정리합니다.
- 목록의 상세를 아래 편집 영역에 표시할 때는 `Common.ui.revealEditor`로 이동과 초점을 함께 처리합니다. 모달은 페이지 이탈·종료 시 닫고 미저장 입력 확인 및 리스너 정리를 유지합니다.
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

- `.\venv\Scripts\python.exe -m unittest discover -s backend/tests -p "test_*.py"`
- `GET /api/health`
- 로그인, 로그아웃, 만료·폐기된 세션 거부
- 최초 관리자 초기화와 신청 계정의 관리자 등급 부여·사용 승인
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
