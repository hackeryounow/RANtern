"""
db.py — PostgreSQL connection and schema bootstrap for RANtern.

Stores:
- users: authentication (email/password), department, status
- test_history: test run records (replaces file-based JSON storage)
- call_records: SIP call logs from Asterisk
- feedbacks: user feedback/ratings (same as VoxEra)
"""

import os
import json
from typing import Any, Dict, List, Optional
from datetime import datetime

from loguru import logger

try:
    import psycopg2
    from psycopg2 import pool, extras
    _PG_AVAILABLE = True
except ImportError:
    _PG_AVAILABLE = False

_pool: Optional[Any] = None


def get_pool():
    """Get or create the connection pool."""
    global _pool
    if _pool is None:
        db_url = os.environ.get("DATABASE_URL")
        if not db_url:
            raise RuntimeError("DATABASE_URL environment variable is not set")
        if not _PG_AVAILABLE:
            raise RuntimeError("psycopg2 is not installed. Run: pip install psycopg2-binary")

        _pool = pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=10,
            dsn=db_url,
        )
        logger.info("PostgreSQL connection pool created")
    return _pool


async def init_db():
    """Bootstrap database schema (idempotent)."""
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor() as cur:
                # Users table (same schema as VoxEra)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS users (
                        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        name          VARCHAR(255) NOT NULL,
                        email         VARCHAR(255) UNIQUE NOT NULL,
                        password_hash VARCHAR(255) NOT NULL,
                        department    VARCHAR(255) NOT NULL DEFAULT 'engineering',
                        status        VARCHAR(50)  NOT NULL DEFAULT 'available',
                        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
                    );
                    CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
                """)

                # Test history (migrated from file-based JSON)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS test_history (
                        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        mode          VARCHAR(10)  NOT NULL,
                        core_network  VARCHAR(50)  NOT NULL,
                        profile       VARCHAR(255),
                        ue_count      INTEGER NOT NULL DEFAULT 0,
                        status        VARCHAR(50)  NOT NULL DEFAULT 'completed',
                        duration_sec  FLOAT,
                        result_json   JSONB,
                        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
                    );
                    CREATE INDEX IF NOT EXISTS idx_test_history_created ON test_history (created_at DESC);
                    CREATE INDEX IF NOT EXISTS idx_test_history_mode ON test_history (mode);
                """)

                # SIP call records
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS call_records (
                        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        caller        VARCHAR(50)  NOT NULL,
                        callee        VARCHAR(50)  NOT NULL,
                        direction     VARCHAR(10)  NOT NULL DEFAULT 'outbound',
                        status        VARCHAR(50)  NOT NULL DEFAULT 'completed',
                        duration_sec  FLOAT,
                        started_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                        ended_at      TIMESTAMPTZ,
                        sip_code      INTEGER,
                        sip_reason    VARCHAR(255)
                    );
                    CREATE INDEX IF NOT EXISTS idx_call_records_started ON call_records (started_at DESC);
                """)

                # Feedbacks (same as VoxEra)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS feedbacks (
                        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        name       VARCHAR(255) NOT NULL,
                        rating     SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
                        message    VARCHAR(500) NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    CREATE INDEX IF NOT EXISTS idx_feedbacks_created_at ON feedbacks (created_at DESC);
                """)

                # NF components — persistent catalog of network-function
                # building blocks (seeded from the built-in nf_registry
                # catalog; users may add/edit custom components).
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS nf_components (
                        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        kind          VARCHAR(64)  NOT NULL,
                        label         VARCHAR(128) NOT NULL,
                        category      VARCHAR(64)  NOT NULL DEFAULT 'network',
                        cores         JSONB        NOT NULL DEFAULT '[]',
                        runtime       JSONB        NOT NULL DEFAULT '{}',
                        interfaces    JSONB        NOT NULL DEFAULT '[]',
                        config_fields JSONB,
                        description   TEXT         NOT NULL DEFAULT '',
                        built_in      BOOLEAN      NOT NULL DEFAULT FALSE,
                        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                        updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
                    );
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_nf_components_kind_cores
                        ON nf_components (kind, cores);
                """)

            conn.commit()
            logger.info("PostgreSQL schema ready")
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.warning(f"PostgreSQL init failed ({e}); falling back to file-based storage")


async def check_db() -> bool:
    """Health check — returns True if DB is reachable."""
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
            return True
        finally:
            p.putconn(conn)
    except Exception:
        return False


def db_configured() -> bool:
    """True when PostgreSQL is usable (driver installed + DATABASE_URL set).

    Cheap, silent check so callers (e.g. the NF registry) can skip DB access
    and use their static fallbacks without flooding the log with errors.
    """
    return _PG_AVAILABLE and bool(os.environ.get("DATABASE_URL"))


# ── Users ──

def find_user_by_email(email: str) -> Optional[Dict]:
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM users WHERE LOWER(email) = LOWER(%s)", [email.strip()])
                return dict(cur.fetchone()) if cur.rowcount else None
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error: {e}")
        return None


def find_user_by_id(user_id: str) -> Optional[Dict]:
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, name, email, department, status, created_at FROM users WHERE id = %s",
                    [user_id],
                )
                return dict(cur.fetchone()) if cur.rowcount else None
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error: {e}")
        return None


def create_user(name: str, email: str, password_hash: str, department: str = "engineering") -> Optional[Dict]:
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute(
                    """INSERT INTO users (name, email, password_hash, department)
                       VALUES (%s, %s, %s, %s)
                       RETURNING id, name, email, department, status, created_at""",
                    [name.strip(), email.strip().lower(), password_hash, department.strip()],
                )
                row = cur.fetchone()
                conn.commit()
                return dict(row) if row else None
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error: {e}")
        return None


def list_users() -> List[Dict]:
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT name, email, department, status FROM users ORDER BY created_at DESC")
                return [dict(r) for r in cur.fetchall()]
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error: {e}")
        return []


# ── Test History ──

def save_test_record(record: Dict) -> Optional[str]:
    """Save a test record to PostgreSQL. Returns the record ID."""
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO test_history (mode, core_network, profile, ue_count, status, duration_sec, result_json)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)
                       RETURNING id""",
                    [
                        record.get("mode", "5g"),
                        record.get("core_network", ""),
                        record.get("profile", ""),
                        len(record.get("ue_details", [])),
                        record.get("status", "completed"),
                        record.get("duration_sec"),
                        extras.Json(record) if _PG_AVAILABLE else str(record),
                    ],
                )
                row_id = str(cur.fetchone()[0])
                conn.commit()
                return row_id
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error saving test record: {e}")
        return None


def list_test_records(limit: int = 100) -> List[Dict]:
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, mode, core_network, profile, ue_count, status, duration_sec, created_at FROM test_history ORDER BY created_at DESC LIMIT %s",
                    [limit],
                )
                return [dict(r) for r in cur.fetchall()]
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error: {e}")
        return []


def get_test_record(record_id: str) -> Optional[Dict]:
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM test_history WHERE id = %s", [record_id])
                return dict(cur.fetchone()) if cur.rowcount else None
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error: {e}")
        return None


def delete_test_record(record_id: str) -> bool:
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM test_history WHERE id = %s", [record_id])
                conn.commit()
                return cur.rowcount > 0
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error: {e}")
        return False


def clear_test_records() -> int:
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM test_history")
                deleted = cur.rowcount
                conn.commit()
                return deleted
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error: {e}")
        return 0


# ── Call Records ──

def save_call_record(caller: str, callee: str, direction: str = "outbound",
                     status: str = "completed", duration_sec: float = None,
                     sip_code: int = None, sip_reason: str = None) -> Optional[str]:
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO call_records (caller, callee, direction, status, duration_sec, sip_code, sip_reason, ended_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                       RETURNING id""",
                    [caller, callee, direction, status, duration_sec, sip_code, sip_reason,
                     datetime.utcnow() if status == "completed" else None],
                )
                row_id = str(cur.fetchone()[0])
                conn.commit()
                return row_id
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error saving call record: {e}")
        return None


def list_call_records(limit: int = 100) -> List[Dict]:
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM call_records ORDER BY started_at DESC LIMIT %s",
                    [limit],
                )
                return [dict(r) for r in cur.fetchall()]
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error: {e}")
        return []


# ── Feedbacks ──

def create_feedback(name: str, rating: int, message: str) -> Optional[Dict]:
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute(
                    """INSERT INTO feedbacks (name, rating, message)
                       VALUES (%s, %s, %s)
                       RETURNING id, name, rating, message, created_at""",
                    [name.strip(), rating, message.strip()[:500]],
                )
                row = cur.fetchone()
                conn.commit()
                return dict(row) if row else None
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error: {e}")
        return None


def list_feedbacks(limit: int = 100) -> List[Dict]:
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, name, rating, message, created_at FROM feedbacks ORDER BY created_at DESC LIMIT %s",
                    [limit],
                )
                return [dict(r) for r in cur.fetchall()]
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error: {e}")
        return []


def get_feedback_stats() -> Dict:
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT COUNT(*)::int AS total, COALESCE(AVG(rating), 0) AS avg_rating FROM feedbacks")
                row = dict(cur.fetchone())
                return {"total": row["total"], "avgRating": f"{float(row['avg_rating']):.1f}"}
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error: {e}")
        return {"total": 0, "avgRating": "0.0"}


# ── NF components (persistent NF catalog) ──

def _row_to_component(row: Dict) -> Dict:
    """Normalise a DB row into a catalog-shaped component dict."""
    comp = dict(row)
    for key in ("cores", "runtime", "interfaces", "config_fields"):
        if isinstance(comp.get(key), str):
            try:
                comp[key] = json.loads(comp[key])
            except Exception:
                pass
    comp["id"] = str(comp.get("id"))
    return comp


def seed_nf_components() -> int:
    """Seed the built-in NF catalog into PostgreSQL (idempotent).

    Existing rows are never overwritten, so user edits to built-in
    components persist across restarts. Returns rows inserted.
    """
    from coresimrunner import nf_registry  # deferred: avoid circular import

    if not db_configured():
        logger.info("PostgreSQL not configured; NF catalog stays static")
        return 0
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            inserted = 0
            with conn.cursor() as cur:
                for nf in nf_registry.NF_CATALOG:
                    kind = nf.get("kind")
                    config_fields = nf_registry.component_config_fields(kind)
                    cur.execute(
                        """INSERT INTO nf_components
                               (kind, label, category, cores, runtime, interfaces,
                                config_fields, description, built_in)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, TRUE)
                           ON CONFLICT (kind, cores) DO NOTHING""",
                        [
                            kind,
                            nf.get("label", kind),
                            nf.get("category", "network"),
                            extras.Json(nf.get("cores", [])),
                            extras.Json(nf.get("runtime", {})),
                            extras.Json(nf.get("interfaces", [])),
                            extras.Json(config_fields) if config_fields else None,
                            nf.get("description", ""),
                        ],
                    )
                    inserted += cur.rowcount
            conn.commit()
            if inserted:
                logger.info(f"Seeded {inserted} built-in NF components")
            return inserted
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.warning(f"NF component seed failed ({e}); using static catalog")
        return 0


def list_nf_components(core: Optional[str] = None) -> List[Dict]:
    """All components, optionally filtered to those supporting ``core``."""
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                if core:
                    cur.execute(
                        "SELECT * FROM nf_components WHERE cores @> %s::jsonb ORDER BY category, kind",
                        [json.dumps(core)],
                    )
                else:
                    cur.execute("SELECT * FROM nf_components ORDER BY category, kind")
                return [_row_to_component(r) for r in cur.fetchall()]
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error listing NF components: {e}")
        return []


def get_nf_component(core: str, kind: str) -> Optional[Dict]:
    """The component entry for a (core, kind) pair, or None."""
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM nf_components WHERE kind = %s AND cores @> %s::jsonb LIMIT 1",
                    [kind, json.dumps(core)],
                )
                row = cur.fetchone()
                return _row_to_component(row) if row else None
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error fetching NF component: {e}")
        return None


def create_nf_component(data: Dict) -> Optional[Dict]:
    """Insert a user-defined component. Returns the created row."""
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute(
                    """INSERT INTO nf_components
                           (kind, label, category, cores, runtime, interfaces,
                            config_fields, description, built_in)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, FALSE)
                       RETURNING *""",
                    [
                        data.get("kind"),
                        data.get("label") or data.get("kind"),
                        data.get("category", "network"),
                        extras.Json(data.get("cores", [])),
                        extras.Json(data.get("runtime", {})),
                        extras.Json(data.get("interfaces", [])),
                        extras.Json(data["config_fields"]) if data.get("config_fields") else None,
                        data.get("description", ""),
                    ],
                )
                row = cur.fetchone()
                conn.commit()
                return _row_to_component(row) if row else None
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error creating NF component: {e}")
        return None


def update_nf_component(component_id: str, data: Dict) -> Optional[Dict]:
    """Update mutable fields of a component. Returns the updated row."""
    sets, params = [], []
    for col in ("label", "category", "description"):
        if col in data:
            sets.append(f"{col} = %s")
            params.append(data[col])
    for col in ("cores", "runtime", "interfaces", "config_fields"):
        if col in data:
            sets.append(f"{col} = %s")
            params.append(extras.Json(data[col]))
    if not sets:
        return get_nf_component_by_id(component_id)
    sets.append("updated_at = NOW()")
    params.append(component_id)
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute(
                    f"UPDATE nf_components SET {', '.join(sets)} WHERE id = %s RETURNING *",
                    params,
                )
                row = cur.fetchone()
                conn.commit()
                return _row_to_component(row) if row else None
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error updating NF component: {e}")
        return None


def get_nf_component_by_id(component_id: str) -> Optional[Dict]:
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor(cursor_factory=extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM nf_components WHERE id = %s", [component_id])
                row = cur.fetchone()
                return _row_to_component(row) if row else None
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error fetching NF component: {e}")
        return None


def delete_nf_component(component_id: str) -> bool:
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM nf_components WHERE id = %s", [component_id])
                conn.commit()
                return cur.rowcount > 0
        finally:
            p.putconn(conn)
    except Exception as e:
        logger.error(f"DB error deleting NF component: {e}")
        return False


def close_pool():
    """Close the connection pool on shutdown."""
    global _pool
    if _pool:
        _pool.closeall()
        _pool = None
        logger.info("PostgreSQL connection pool closed")
