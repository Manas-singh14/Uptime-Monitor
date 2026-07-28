import sqlite3
from contextlib import contextmanager

DB_PATH = "/data/monitor.db"


def init_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS urls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                url TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS checks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url_id INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
                status_code INTEGER,
                response_time_ms REAL,
                is_up INTEGER NOT NULL,
                reason TEXT NOT NULL DEFAULT '',
                checked_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Migration for DBs created before the `reason` column existed
        existing_cols = [r["name"] for r in conn.execute("PRAGMA table_info(checks)")]
        if "reason" not in existing_cols:
            conn.execute("ALTER TABLE checks ADD COLUMN reason TEXT NOT NULL DEFAULT ''")
        conn.commit()


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()