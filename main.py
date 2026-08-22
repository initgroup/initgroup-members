from __future__ import annotations

import logging
import os
import posixpath
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from backend.auth_context import (
    authenticate_request,
    get_session_ttl_seconds,
    refresh_session_cookie,
)
from backend.database import close_db_pool, initialize_db_pool
from backend.portal_access import ADMIN_PAGE_CODES
from backend.rate_limit import check_auth_rate_limit
from backend.routers import (
    account,
    admin_companies,
    admin_notices,
    admin_projects,
    admin_users,
    auth,
    home,
    planning_scenarios,
    project_assignments,
    site_settings,
    workforce_management,
)


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())
logger = logging.getLogger(__name__)
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
PORTAL_SITE_FILE = FRONTEND_DIR / "index.html"


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        await run_in_threadpool(initialize_db_pool)
    except Exception:
        logger.exception(
            "System database startup verification failed. "
            "Check Oracle network access, DSN, Wallet, and credentials."
        )
        raise
    yield
    try:
        close_db_pool()
    except Exception:
        logger.exception("System database pool shutdown failed.")


app = FastAPI(
    title=os.getenv("APP_NAME", "INIT Members"),
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(_, exc: RequestValidationError):
    errors = [
        {key: value for key, value in error.items() if key != "input"}
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content=jsonable_encoder({"detail": errors}),
    )


def _normalized_origin(value: str, *, allow_path: bool = False) -> str | None:
    raw_value = str(value or "").strip()
    if not raw_value or raw_value.lower() == "null":
        return None
    try:
        parsed = urlsplit(raw_value)
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or (
            not allow_path
            and (
                parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
            )
        )
    ):
        return None

    scheme = parsed.scheme.lower()
    host = parsed.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    default_port = 443 if scheme == "https" else 80
    port_suffix = f":{port}" if port and port != default_port else ""
    return f"{scheme}://{host}{port_suffix}"


def _allowed_origins() -> list[str]:
    configured = str(os.getenv("INIT_ALLOWED_ORIGINS", ""))
    origins = [item.strip() for item in configured.split(",") if item.strip()]
    if origins:
        if "*" in origins:
            raise RuntimeError(
                "INIT_ALLOWED_ORIGINS must contain explicit origins; "
                "'*' is not allowed with credentialed CORS."
            )
    else:
        origins = [
            "http://127.0.0.1:8100",
            "http://localhost:8100",
        ]

    normalized_origins: list[str] = []
    for origin in origins:
        normalized = _normalized_origin(origin)
        if not normalized:
            raise RuntimeError(
                f"INIT_ALLOWED_ORIGINS contains an invalid origin: {origin!r}"
            )
        if normalized not in normalized_origins:
            normalized_origins.append(normalized)
    return normalized_origins


ALLOWED_ORIGINS = _allowed_origins()


PUBLIC_API_ROUTES = {
    ("GET", "/api/health"),
    ("GET", "/api/auth/admin-contact"),
    ("GET", "/api/site/preferences"),
    ("POST", "/api/auth/signup"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),
}

AUTH_RATE_LIMIT_ROUTES = {
    ("POST", "/api/auth/login"): "login",
    ("POST", "/api/auth/signup"): "signup",
}

UNSAFE_API_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

PASSWORD_CHANGE_ALLOWED_API_ROUTES = {
    ("GET", "/api/auth/session"),
    ("POST", "/api/auth/logout"),
    ("PUT", "/api/account/password"),
}

SENSITIVE_DIRECT_PATH_PREFIXES = (
    "/.env",
    "/backend",
    "/database",
    "/instantclient",
    "/secreats",
    "/secrets",
    "/Wallet",
)

ADMIN_API_PATH_PREFIXES = (
    "/api/admin",
    "/api/planning",
    "/api/project-assignments",
    "/api/workforce-management",
    "/api/home/dashboard",
)

ADMIN_PAGE_ASSET_PATHS = frozenset(
    [f"/pages/{page_code}.html" for page_code in ADMIN_PAGE_CODES]
    + [f"/js/{page_code}.js" for page_code in ADMIN_PAGE_CODES]
)

def _matches_path_prefix(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(f"{prefix}/")


def _normalized_direct_path(path: str) -> str:
    slash_path = f"/{str(path or '').replace(chr(92), '/').lstrip('/')}"
    return f"/{posixpath.normpath(slash_path).lstrip('/')}".lower()


def _has_allowed_request_source(request) -> bool:
    request_origin = _normalized_origin(str(request.base_url), allow_path=True)
    accepted_origins = set(ALLOWED_ORIGINS)
    if request_origin:
        accepted_origins.add(request_origin)

    if "origin" in request.headers:
        origin = _normalized_origin(request.headers.get("origin", ""))
        return bool(origin and origin in accepted_origins)

    if "referer" in request.headers:
        referer_origin = _normalized_origin(
            request.headers.get("referer", ""),
            allow_path=True,
        )
        return bool(referer_origin and referer_origin in accepted_origins)

    return True


@app.middleware("http")
async def enforce_api_authentication(request, call_next):
    path = request.url.path
    normalized_direct_path = _normalized_direct_path(path)
    if path.startswith(SENSITIVE_DIRECT_PATH_PREFIXES):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    method = request.method.upper()
    if (
        path.startswith("/api/")
        and method in UNSAFE_API_METHODS
        and not _has_allowed_request_source(request)
    ):
        return JSONResponse(
            status_code=403,
            content={"detail": "Request origin is not allowed."},
        )

    rate_limit_scope = AUTH_RATE_LIMIT_ROUTES.get((method, path))
    if rate_limit_scope:
        try:
            check_auth_rate_limit(request, rate_limit_scope)
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail},
                headers=exc.headers,
            )

    session_authenticated = False
    protected_admin_asset = normalized_direct_path in ADMIN_PAGE_ASSET_PATHS
    protected_api = (
        path.startswith("/api/")
        and (method, path) not in PUBLIC_API_ROUTES
        and method != "OPTIONS"
    )
    if protected_api or protected_admin_asset:
        try:
            session_user = await run_in_threadpool(
                authenticate_request,
                request,
                touch=protected_api,
            )
            session_authenticated = True
            if (
                str(session_user.get("passwordChangeYn") or "N").strip().upper() != "Y"
                and (method, path) not in PASSWORD_CHANGE_ALLOWED_API_ROUTES
            ):
                response = JSONResponse(
                    status_code=403,
                    content={"detail": "초기 비밀번호를 먼저 변경해 주세요."},
                )
                if getattr(request.state, "auth_session_touched", False):
                    refresh_session_cookie(request, response)
                response.headers["X-INIT-Session-TTL-Seconds"] = str(
                    get_session_ttl_seconds()
                )
                return response
            if (
                protected_admin_asset
                or any(
                    _matches_path_prefix(path, prefix)
                    for prefix in ADMIN_API_PATH_PREFIXES
                )
            ) and str(session_user.get("roleCode") or "USER").strip().upper() != "ADMIN":
                response = JSONResponse(
                    status_code=403,
                    content={"detail": "관리자 권한이 필요합니다."},
                )
                if getattr(request.state, "auth_session_touched", False):
                    refresh_session_cookie(request, response)
                response.headers["X-INIT-Session-TTL-Seconds"] = str(
                    get_session_ttl_seconds()
                )
                return response
        except Exception as exc:
            status_code = int(getattr(exc, "status_code", 401))
            detail = getattr(exc, "detail", "로그인 세션이 필요합니다.")
            return JSONResponse(status_code=status_code, content={"detail": detail})

    response = await call_next(request)
    if session_authenticated:
        if getattr(request.state, "auth_session_touched", False):
            refresh_session_cookie(request, response)
        response.headers["X-INIT-Session-TTL-Seconds"] = str(
            get_session_ttl_seconds()
        )
    return response


@app.middleware("http")
async def add_cache_headers(request, call_next):
    response = await call_next(request)
    path = request.url.path
    if (
        path.startswith("/api/")
        or path in {"/", "/app", "/index.html"}
        or path.startswith(("/js/", "/css/", "/pages/", "/config/"))
        or path.endswith((".html", ".js", ".css"))
    ) and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
    expose_headers=["X-INIT-Session-TTL-Seconds"],
)


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(home.router, prefix="/api/home", tags=["home"])
app.include_router(account.router, prefix="/api/account", tags=["account"])
app.include_router(site_settings.public_router, prefix="/api/site", tags=["site"])
app.include_router(
    admin_companies.router,
    prefix="/api/admin/companies",
    tags=["admin-companies"],
)
app.include_router(admin_users.router, prefix="/api/admin/users", tags=["admin-users"])
app.include_router(
    admin_projects.router,
    prefix="/api/admin/projects",
    tags=["admin-projects"],
)
app.include_router(
    planning_scenarios.router,
    prefix="/api/planning/scenarios",
    tags=["planning-scenarios"],
)
app.include_router(
    project_assignments.router,
    prefix="/api/project-assignments",
    tags=["project-assignments"],
)
app.include_router(
    workforce_management.router,
    prefix="/api/workforce-management",
    tags=["workforce-management"],
)
app.include_router(
    admin_notices.router,
    prefix="/api/admin/notices",
    tags=["admin-notices"],
)
app.include_router(
    site_settings.admin_router,
    prefix="/api/admin/site-settings",
    tags=["admin-site-settings"],
)


@app.get("/api/health")
def health():
    return {
        "status": "success",
        "message": "API server is running.",
        "appName": os.getenv("APP_NAME", "INIT Members"),
    }


@app.get("/app", include_in_schema=False)
def authenticated_portal():
    return FileResponse(PORTAL_SITE_FILE)


@app.get("/app/", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
def redirect_to_authenticated_portal():
    return RedirectResponse(url="/app", status_code=308)


app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
