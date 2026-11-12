"""
SQLite Database Layer for Metadata, Duplicate Detection, and Chunk Tracking.
Features:
- User isolation (files linked to telegram user_id)
- SHA-256 deduplication
- Persistent chunk generation status (pending, processing, completed, failed)
- Crash recovery: detects incomplete jobs and cleans up orphan records
- WAL mode for concurrent reads/writes
"""
import sqlite3
import uuid
import time
from typing import Optional, List, Dict, Any
from pathlib import Path
from bot.config import DB_PATH

class Database:
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_db(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            
            # Files table
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                original_name TEXT NOT NULL,
                stored_path TEXT NOT NULL,
                decompressed_path TEXT,
                file_size INTEGER NOT NULL,
                decompressed_size INTEGER,
                sha256 TEXT NOT NULL,
                is_gzip INTEGER DEFAULT 0,
                is_valid INTEGER DEFAULT 0,
                root_type TEXT,
                records_path TEXT,
                total_records INTEGER DEFAULT 0,
                structure_summary TEXT,
                created_at REAL NOT NULL,
                error_message TEXT
            )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256)")

            # Chunk jobs table
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS chunk_jobs (
                id TEXT PRIMARY KEY,
                file_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                records_per_chunk INTEGER NOT NULL,
                total_chunks INTEGER DEFAULT 0,
                status TEXT NOT NULL, -- pending, processing, completed, failed
                error_message TEXT,
                created_at REAL NOT NULL,
                completed_at REAL,
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
            )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_jobs_file_chunk ON chunk_jobs(file_id, records_per_chunk)")

            # Individual chunks table
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                file_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                chunk_index INTEGER NOT NULL,
                record_start INTEGER NOT NULL,
                record_end INTEGER NOT NULL,
                record_count INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                created_at REAL NOT NULL,
                FOREIGN KEY (job_id) REFERENCES chunk_jobs(id) ON DELETE CASCADE,
                FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
            )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_chunks_job ON chunks(job_id, chunk_index)")

            # User active file preference
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_sessions (
                user_id INTEGER PRIMARY KEY,
                active_file_id TEXT,
                last_active REAL NOT NULL,
                FOREIGN KEY (active_file_id) REFERENCES files(id) ON DELETE SET NULL
            )
            """)

            # Recovery check: mark any job that was "processing" at startup as "failed"
            cursor.execute("""
            UPDATE chunk_jobs 
            SET status = 'failed', error_message = 'Interrupted by server restart' 
            WHERE status = 'processing'
            """)
            conn.commit()

    # --- File Management ---

    def register_file(self, user_id: int, original_name: str, stored_path: str,
                      file_size: int, sha256_hash: str, is_gzip: bool) -> str:
        file_id = f"f_{uuid.uuid4().hex[:12]}"
        now = time.time()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO files (id, user_id, original_name, stored_path, file_size, sha256, is_gzip, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (file_id, user_id, original_name, stored_path, file_size, sha256_hash, 1 if is_gzip else 0, now))
            
            # Set as active file
            cursor.execute("""
            INSERT INTO user_sessions (user_id, active_file_id, last_active)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET active_file_id = excluded.active_file_id, last_active = excluded.last_active
            """, (user_id, file_id, now))
            conn.commit()
        return file_id

    def find_file_by_hash(self, user_id: int, sha256_hash: str) -> Optional[Dict[str, Any]]:
        """Look for existing file with identical SHA-256 for this user to avoid redundant processing."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            SELECT * FROM files WHERE user_id = ? AND sha256 = ? AND is_valid = 1
            ORDER BY created_at DESC LIMIT 1
            """, (user_id, sha256_hash))
            row = cursor.fetchone()
            return dict(row) if row else None

    def update_file_analysis(self, file_id: str, decompressed_path: Optional[str],
                             decompressed_size: Optional[int], is_valid: bool,
                             root_type: str, records_path: str, total_records: int,
                             structure_summary: str, error_message: Optional[str] = None):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            UPDATE files SET 
                decompressed_path = ?,
                decompressed_size = ?,
                is_valid = ?,
                root_type = ?,
                records_path = ?,
                total_records = ?,
                structure_summary = ?,
                error_message = ?
            WHERE id = ?
            """, (decompressed_path, decompressed_size, 1 if is_valid else 0,
                  root_type, records_path, total_records, structure_summary, error_message, file_id))
            conn.commit()

    def get_file(self, file_id: str, user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            if user_id is not None:
                cursor.execute("SELECT * FROM files WHERE id = ? AND user_id = ?", (file_id, user_id))
            else:
                cursor.execute("SELECT * FROM files WHERE id = ?", (file_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def get_active_file(self, user_id: int) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            SELECT f.* FROM files f
            JOIN user_sessions s ON s.active_file_id = f.id
            WHERE s.user_id = ?
            """, (user_id,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            # Fallback to latest file
            cursor.execute("SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC LIMIT 1", (user_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    def set_active_file(self, user_id: int, file_id: str):
        now = time.time()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO user_sessions (user_id, active_file_id, last_active)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET active_file_id = excluded.active_file_id, last_active = excluded.last_active
            """, (user_id, file_id, now))
            conn.commit()

    def list_user_files(self, user_id: int, limit: int = 10) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
            """, (user_id, limit))
            return [dict(row) for row in cursor.fetchall()]

    # --- Chunk Job Management ---

    def find_completed_chunk_job(self, file_id: str, records_per_chunk: int) -> Optional[Dict[str, Any]]:
        """Duplicate protection: check if valid completed chunk job already exists."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            SELECT * FROM chunk_jobs 
            WHERE file_id = ? AND records_per_chunk = ? AND status = 'completed'
            ORDER BY created_at DESC LIMIT 1
            """, (file_id, records_per_chunk))
            row = cursor.fetchone()
            return dict(row) if row else None

    def create_chunk_job(self, file_id: str, user_id: int, records_per_chunk: int) -> str:
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        now = time.time()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO chunk_jobs (id, file_id, user_id, records_per_chunk, status, created_at)
            VALUES (?, ?, ?, ?, 'processing', ?)
            """, (job_id, file_id, user_id, records_per_chunk, now))
            conn.commit()
        return job_id

    def complete_chunk_job(self, job_id: str, total_chunks: int):
        now = time.time()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            UPDATE chunk_jobs SET status = 'completed', total_chunks = ?, completed_at = ?
            WHERE id = ?
            """, (total_chunks, now, job_id))
            conn.commit()

    def fail_chunk_job(self, job_id: str, error_message: str):
        now = time.time()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            UPDATE chunk_jobs SET status = 'failed', error_message = ?, completed_at = ?
            WHERE id = ?
            """, (error_message, now, job_id))
            conn.commit()

    def save_chunk(self, job_id: str, file_id: str, user_id: int, chunk_index: int,
                   record_start: int, record_end: int, record_count: int,
                   file_path: str, file_size: int, sha256_hash: str) -> str:
        chunk_id = f"c_{uuid.uuid4().hex[:12]}"
        now = time.time()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO chunks (id, job_id, file_id, user_id, chunk_index,
                                record_start, record_end, record_count, file_path, file_size, sha256, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (chunk_id, job_id, file_id, user_id, chunk_index,
                  record_start, record_end, record_count, file_path, file_size, sha256_hash, now))
            conn.commit()
        return chunk_id

    def get_chunks_for_job(self, job_id: str) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
            SELECT * FROM chunks WHERE job_id = ? ORDER BY chunk_index ASC
            """, (job_id,))
            return [dict(row) for row in cursor.fetchall()]

    def get_chunk(self, file_id_or_job_id: str, chunk_index: int, user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            query = """
            SELECT c.* FROM chunks c
            JOIN chunk_jobs j ON j.id = c.job_id
            WHERE (c.file_id = ? OR c.job_id = ?) AND c.chunk_index = ? AND j.status = 'completed'
            """
            params = [file_id_or_job_id, file_id_or_job_id, chunk_index]
            if user_id is not None:
                query += " AND c.user_id = ?"
                params.append(user_id)
            query += " ORDER BY c.created_at DESC LIMIT 1"
            cursor.execute(query, tuple(params))
            row = cursor.fetchone()
            return dict(row) if row else None

    def get_latest_completed_job(self, file_id: str, user_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            query = """
            SELECT * FROM chunk_jobs
            WHERE file_id = ? AND status = 'completed'
            """
            params = [file_id]
            if user_id is not None:
                query += " AND user_id = ?"
                params.append(user_id)
            query += " ORDER BY completed_at DESC LIMIT 1"
            cursor.execute(query, tuple(params))
            row = cursor.fetchone()
            return dict(row) if row else None

# Singleton instance
db = Database()
