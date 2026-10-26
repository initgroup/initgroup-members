"""Explicit, additive migration for annual targets. Never executed by an API request."""
from backend.database import get_db_connection
from backend.database_helper import SqlLoader


def apply_migration():
    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(SqlLoader.get_sql("INIT_ANNUAL_TARGETS_V1"))
        cursor.execute(SqlLoader.get_sql("INIT_ANNUAL_TARGETS_V2"))
        cursor.execute(SqlLoader.get_sql("INIT_ANNUAL_TARGETS_V3"))
        cursor.execute(SqlLoader.get_sql("INIT_ANNUAL_TARGETS_V4"))
        cursor.execute(SqlLoader.get_sql("INIT_PROJECT_REVENUE_V1"))
        cursor.execute(SqlLoader.get_sql("INIT_HISTORICAL_TOTALS_V1"))
        cursor.execute(SqlLoader.get_sql("ANNUAL_MIGRATION_LOCK"))
        cursor.execute(SqlLoader.get_sql("ANNUAL_HISTORY_LOCK"))
        cursor.execute(SqlLoader.get_sql("ANNUAL_HISTORY_SEED"))
        seeded = cursor.rowcount
        cursor.execute(SqlLoader.get_sql("ANNUAL_SOURCE_LOCK"))
        cursor.execute(SqlLoader.get_sql("ANNUAL_V2_MIGRATE_TARGETS"))
        migrated_targets = cursor.rowcount
        cursor.execute(SqlLoader.get_sql("ANNUAL_V2_MIGRATE_EXPENSES"))
        migrated_expenses = cursor.rowcount
        cursor.execute(SqlLoader.get_sql("ANNUAL_V2_MIGRATE_PROJECT_DEPT"))
        cursor.execute(SqlLoader.get_sql("ANNUAL_V2_MARK_MIGRATED"))
        cursor.execute(SqlLoader.get_sql("ANNUAL_V3_MIGRATE_STAFF"))
        migrated_staff = cursor.rowcount
        cursor.execute(SqlLoader.get_sql("ANNUAL_V3_MIGRATE_EXTRAS"))
        migrated_extras = cursor.rowcount
        cursor.execute(SqlLoader.get_sql("ANNUAL_V3_MARK_MIGRATED"))
        cursor.execute(SqlLoader.get_sql("ANNUAL_V4_MIGRATE_EXPENSES"))
        migrated_year_expenses = cursor.rowcount
        cursor.execute(SqlLoader.get_sql("ANNUAL_V4_MARK_MIGRATED"))
        conn.commit()
        cursor.execute(SqlLoader.get_sql("ANNUAL_SCHEMA_STATUS"))
        count = int(cursor.fetchone()[0])
        if count != 11:
            raise RuntimeError("Annual target schema validation failed.")
        return {"schemaTables": count, "initialHistoryRows": seeded, "migratedDepartmentTargets": migrated_targets, "migratedCompanyExpenses": migrated_expenses, "migratedAnnualStaff": migrated_staff, "migratedAnnualExtras": migrated_extras, "migratedAnnualCosts": migrated_year_expenses}
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
