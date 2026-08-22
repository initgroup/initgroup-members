from __future__ import annotations

import os
import time
import logging
from pathlib import Path
from threading import Lock
from typing import Optional

import oracledb
from dotenv import load_dotenv


load_dotenv()
# Business queries read complete CLOB/BLOB values. Fetching them directly as
# str/bytes avoids a separate LOB round trip for every row.
oracledb.defaults.fetch_lobs = False


PROJECT_ROOT = Path(__file__).resolve().parent.parent
_pool = None
_pool_lock = Lock()
logger = logging.getLogger(__name__)


def _pool_snapshot(pool) -> str:
    parts = []
    for name in (
        "opened",
        "busy",
        "max",
        "min",
        "increment",
        "timeout",
        "max_lifetime_session",
        "ping_interval",
        "ping_timeout",
    ):
        value = getattr(pool, name, None)
        if value is not None:
            parts.append(f"{name}={value}")
    return ", ".join(parts) or "pool_stats=unavailable"


def _resolve_project_path(path_value: Optional[str]) -> Optional[str]:
    if not path_value:
        return None

    normalized_value = str(path_value).strip()
    if not normalized_value:
        return None

    project_path = (PROJECT_ROOT / normalized_value.lstrip("/\\")).resolve()
    path = Path(path_value)
    if path.is_absolute():
        if path.exists() or not project_path.exists():
            return str(path)
        return str(project_path)

    return str(project_path)


def _get_cloud_connect_args(user: str, password: str, dsn: str) -> dict:
    wallet_path = _resolve_project_path(os.getenv("DB_WALLET_PATH"))
    oracle_mode = os.getenv("DB_ORACLE_MODE", "thin").lower()

    if oracle_mode == "thick":
        client_path = _resolve_project_path(os.getenv("DB_CLIENT_PATH"))
        if not client_path:
            raise ValueError("DB_ORACLE_MODE=thick requires DB_CLIENT_PATH.")

        try:
            oracledb.init_oracle_client(lib_dir=client_path, config_dir=wallet_path)
        except oracledb.ProgrammingError:
            pass

        return {"user": user, "password": password, "dsn": dsn}

    connect_args = {
        "user": user,
        "password": password,
        "dsn": dsn,
        "tcp_connect_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "10")),
        "retry_count": int(os.getenv("DB_RETRY_COUNT", "1")),
        "retry_delay": int(os.getenv("DB_RETRY_DELAY", "1")),
    }

    if wallet_path and Path(wallet_path).exists():
        connect_args["config_dir"] = wallet_path
        connect_args["wallet_location"] = wallet_path
        wallet_password = os.getenv("DB_WALLET_PASSWORD")
        if wallet_password:
            connect_args["wallet_password"] = wallet_password
    elif dsn and "/" not in dsn and ":" not in dsn:
        raise ValueError(
            f"DB_WALLET_PATH directory not found or inaccessible: {wallet_path}. "
            "A TNS alias such as DB_DSN_CLD requires tnsnames.ora in this directory."
        )

    return connect_args


def _get_connect_args() -> tuple[str, dict]:
    db_mode = str(os.getenv("DB_MODE", "local")).strip().lower()
    if db_mode not in {"local", "cloud"}:
        raise ValueError("DB_MODE must be either 'local' or 'cloud'.")

    if db_mode == "cloud":
        user = str(os.getenv("DB_USER_CLD") or "").strip()
        password = str(os.getenv("DB_PASSWORD_CLD") or "")
        dsn = str(os.getenv("DB_DSN_CLD") or "").strip()
    else:
        user = str(os.getenv("DB_USER_LOC") or "").strip()
        password = str(os.getenv("DB_PASSWORD_LOC") or "")
        host = str(os.getenv("DB_HOST", "127.0.0.1")).strip()
        port = str(os.getenv("DB_PORT", "1521")).strip()
        service = str(os.getenv("DB_SERVICE") or "").strip()
        if not all([host, port, service]):
            raise ValueError("DB_HOST, DB_PORT, and DB_SERVICE are required for local mode.")
        dsn = f"{host}:{port}/{service}"

    if not all([user, password, dsn]):
        raise ValueError("Database connection environment variables are missing.")

    if db_mode == "cloud":
        return db_mode, _get_cloud_connect_args(user, password, dsn)

    return db_mode, {"user": user, "password": password, "dsn": dsn}


def get_db_pool():
    global _pool

    if _pool is not None:
        return _pool

    with _pool_lock:
        if _pool is not None:
            return _pool

        db_mode, connect_args = _get_connect_args()
        wait_timeout_ms = max(
            1000,
            min(30000, int(os.getenv("DB_POOL_WAIT_TIMEOUT_MS", "30000"))),
        )
        pool_min = max(1, int(os.getenv("DB_POOL_MIN", "3")))
        pool_max = max(pool_min, int(os.getenv("DB_POOL_MAX", "6")))
        pool_increment = max(
            1,
            min(
                pool_max - pool_min or 1,
                int(os.getenv("DB_POOL_INCREMENT", "2")),
            ),
        )
        pool_args = {
            **connect_args,
            "min": pool_min,
            "max": pool_max,
            "increment": pool_increment,
            "getmode": oracledb.POOL_GETMODE_TIMEDWAIT,
            "wait_timeout": wait_timeout_ms,
            "timeout": max(
                60,
                int(os.getenv("DB_POOL_IDLE_TIMEOUT_SECONDS", "300")),
            ),
            "max_lifetime_session": max(
                300,
                int(os.getenv("DB_POOL_MAX_LIFETIME_SECONDS", "3600")),
            ),
            "ping_interval": max(
                0,
                int(os.getenv("DB_POOL_PING_INTERVAL_SECONDS", "60")),
            ),
            "ping_timeout": max(
                1000,
                int(os.getenv("DB_POOL_PING_TIMEOUT_MS", "5000")),
            ),
        }

        logger.info(
            "Oracle connection pool initializing. mode=%s min=%s max=%s wait_timeout_ms=%s",
            db_mode,
            pool_args["min"],
            pool_args["max"],
            wait_timeout_ms,
        )
        candidate_pool = oracledb.create_pool(**pool_args)
        warm_connection = None
        try:
            warm_connection = candidate_pool.acquire()
            warm_connection.ping()
        except Exception:
            logger.exception(
                "Oracle connection pool warm-up failed. %s. "
                "Check Oracle Cloud availability, network access, DSN, Wallet, and credentials.",
                _pool_snapshot(candidate_pool),
            )
            candidate_pool.close(force=True)
            raise
        finally:
            if warm_connection:
                warm_connection.close()

        _pool = candidate_pool
        logger.info("Oracle connection pool ready. %s", _pool_snapshot(_pool))
        return _pool


def initialize_db_pool() -> None:
    """Create and verify the system DB pool before accepting API requests."""
    get_db_pool()


def close_db_pool():
    global _pool

    with _pool_lock:
        if _pool is not None:
            # A leaked/unfinished checkout must not block process shutdown or
            # leave the reload parent waiting indefinitely.
            _pool.close(force=True)
            _pool = None


def get_db_connection():
    """
    Acquire a connection from the Oracle pool.

    Existing callers can keep using conn.close(); python-oracledb returns pooled
    connections to the pool on close.
    """
    try:
        pool = get_db_pool()
        started_at = time.monotonic()
        logger.info("[DB] acquire start. %s", _pool_snapshot(pool))
        connection = pool.acquire()
        # A pooled connection keeps session attributes between checkouts. Reset
        # the call timeout on every acquire so one stalled system-DB request
        # cannot occupy a pool slot indefinitely.
        connection.call_timeout = max(
            0,
            int(os.getenv("DB_CALL_TIMEOUT_MS", "60000")),
        )
        elapsed = time.monotonic() - started_at
        warn_seconds = float(os.getenv("DB_POOL_ACQUIRE_WARN_SECONDS", "1"))
        log_method = logger.warning if elapsed >= warn_seconds else logger.info
        log_method("[DB] acquire done. elapsed=%.3fs, %s", elapsed, _pool_snapshot(pool))

        return connection
    except oracledb.Error:
        logger.exception("Oracle database connection failed.")
        raise
