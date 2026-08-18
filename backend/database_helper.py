from __future__ import annotations

import logging
import re
import threading
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)


class SqlLoader:
    _query_map: dict[str, str] = {}
    _source_map: dict[str, str] = {}
    _source_mtime_map: dict[str, int] = {}
    _bind_contracts: dict[str, frozenset[str]] = {}
    _reload_lock = threading.RLock()
    _sql_dir = Path(__file__).resolve().parent.parent / "database"
    _section_pattern = re.compile(
        r"(?ms)^-- \[([A-Za-z0-9_]+)\][ \t]*\r?\n(.*?)(?=^-- \[[A-Za-z0-9_]+\][ \t]*\r?$|\Z)"
    )
    _bind_pattern = re.compile(r"(?<!:):([A-Za-z][A-Za-z0-9_]*)")
    _non_code_pattern = re.compile(r"'(?:''|[^'])*'|--[^\r\n]*|/\*.*?\*/", re.DOTALL)

    @classmethod
    def normalize_loaded_sql(cls, query: str) -> str:
        text = str(query or "").strip()
        if re.match(r"(?is)^\s*(declare|begin)\b", text):
            return re.sub(r"(?m)^\s*/\s*$", "", text).strip()
        text = re.sub(r"(?m)^[ \t]*;[ \t]*(?:\r?\n|$)", "", text).strip()
        return text.rstrip(";").strip()

    @classmethod
    def reload_queries(cls) -> None:
        with cls._reload_lock:
            if not cls._sql_dir.is_dir():
                raise RuntimeError(f"SQL directory was not found: {cls._sql_dir}")

            query_map: dict[str, str] = {}
            source_map: dict[str, str] = {}
            source_mtime_map: dict[str, int] = {}
            duplicates: list[str] = []
            sql_files = sorted(cls._sql_dir.glob("*.sql"), key=lambda path: path.name.lower())
            for file_path in sql_files:
                content = file_path.read_text(encoding="utf-8")
                source_mtime_map[file_path.name] = file_path.stat().st_mtime_ns
                for match in cls._section_pattern.finditer(content):
                    sql_id = match.group(1).strip()
                    if sql_id in query_map:
                        duplicates.append(
                            f"{sql_id} ({source_map[sql_id]}, {file_path.name})"
                        )
                        continue
                    query = cls.normalize_loaded_sql(match.group(2))
                    if not query:
                        raise RuntimeError(f"SQL ID {sql_id} is empty in {file_path.name}.")
                    query_map[sql_id] = query
                    source_map[sql_id] = file_path.name

            if duplicates:
                raise RuntimeError("Duplicate SQL IDs were found: " + ", ".join(duplicates))
            if not query_map:
                raise RuntimeError(f"No SQL sections were loaded from {cls._sql_dir}.")

            cls._query_map = query_map
            cls._source_map = source_map
            cls._source_mtime_map = source_mtime_map
            cls._validate_registered_bind_contracts()
            logger.info("Loaded %s SQL statements from %s files.", len(query_map), len(sql_files))

    @classmethod
    def bind_names(cls, sql_id: str) -> frozenset[str]:
        sql = cls.get_sql(sql_id)
        return cls._extract_bind_names(sql)

    @classmethod
    def _extract_bind_names(cls, sql: str) -> frozenset[str]:
        executable_sql = cls._non_code_pattern.sub(" ", sql)
        return frozenset(name.lower() for name in cls._bind_pattern.findall(executable_sql))

    @classmethod
    def register_bind_contract(cls, sql_id: str, bind_names: set[str] | frozenset[str]) -> None:
        contract = frozenset(str(name).lower() for name in bind_names)
        with cls._reload_lock:
            cls._bind_contracts[sql_id] = contract
            cls._validate_bind_contract(sql_id, contract)

    @classmethod
    def bind_contract_count(cls) -> int:
        return len(cls._bind_contracts)

    @classmethod
    def _validate_bind_contract(cls, sql_id: str, expected: frozenset[str]) -> None:
        sql = cls._query_map.get(sql_id)
        if not sql:
            raise RuntimeError(f"Undefined SQL ID in bind contract: {sql_id}")
        actual = cls._extract_bind_names(sql)
        if actual == expected:
            return
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        raise RuntimeError(
            f"SQL bind contract failed: {sql_id}. "
            f"MissingInSql={missing}, MissingInCode={unexpected}"
        )

    @classmethod
    def _validate_registered_bind_contracts(cls) -> None:
        for sql_id, expected in cls._bind_contracts.items():
            cls._validate_bind_contract(sql_id, expected)

    @classmethod
    def _reload_if_source_changed(cls, sql_id: str) -> None:
        source_name = cls._source_map.get(sql_id)
        if not source_name:
            return
        source_path = cls._sql_dir / source_name
        try:
            current_mtime = source_path.stat().st_mtime_ns
        except OSError:
            cls.reload_queries()
            return
        if current_mtime == cls._source_mtime_map.get(source_name):
            return
        with cls._reload_lock:
            try:
                latest_mtime = source_path.stat().st_mtime_ns
            except OSError:
                latest_mtime = -1
            if latest_mtime != cls._source_mtime_map.get(source_name):
                logger.info("SQL source changed. Reloading queries. source=%s", source_name)
                cls.reload_queries()

    @classmethod
    def get_sql(cls, sql_id: str) -> str:
        cls._reload_if_source_changed(sql_id)
        sql = cls._query_map.get(sql_id)
        if not sql:
            raise ValueError(f"Undefined SQL ID: {sql_id}")
        return sql


SqlLoader.reload_queries()


def execute_query(
    conn,
    sql_id: str,
    params: dict[str, Any] | None = None,
    *,
    is_dml: bool = False,
) -> dict[str, Any]:
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql(sql_id), params or {})
        if is_dml:
            conn.commit()
            return {
                "status": "success",
                "data": [],
                "columns": [],
                "total": max(0, int(cursor.rowcount or 0)),
            }

        columns = [description[0] for description in cursor.description or []]
        rows = cursor.fetchall() if cursor.description else []
        data = [
            {
                column: value.read() if hasattr(value, "read") else value
                for column, value in zip(columns, row)
            }
            for row in rows
        ]
        return {
            "status": "success",
            "data": data,
            "columns": columns,
            "total": len(data),
        }
    except Exception:
        if is_dml:
            conn.rollback()
        logger.exception("SQL execution failed. sql_id=%s", sql_id)
        raise
    finally:
        if cursor:
            cursor.close()
