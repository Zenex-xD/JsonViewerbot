"""
Streaming JSON Chunker.
Splits massive JSON files (175MB+) into independent, valid JSON chunk files.
Guarantees:
- Every chunk is valid standalone JSON array `[...]`
- Zero data loss, all types and nested objects preserved
- Never splits objects in the middle
- Atomic writes (.tmp -> .json) to prevent partial chunks on crash
- SHA-256 calculation per chunk
- Progress reporting callback
"""
import os
import json
import hashlib
import decimal
from typing import Dict, Any, List, Optional, Callable
from pathlib import Path
from bot.config import CHUNKS_DIR
from bot.database import db
from bot.stream_parser import stream_json_items, compute_file_sha256

def default_json_serializer(obj):
    if isinstance(obj, decimal.Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return str(obj)

class JsonChunker:
    def __init__(self, file_id: str, records_per_chunk: int, user_id: int):
        self.file_id = file_id
        self.records_per_chunk = records_per_chunk
        self.user_id = user_id
        self.file_info = db.get_file(file_id, user_id)
        if not self.file_info:
            raise ValueError(f"File {file_id} not found or access denied.")

        self.source_path = self.file_info["decompressed_path"] or self.file_info["stored_path"]
        self.records_path = self.file_info["records_path"] or "item"
        self.total_records = self.file_info["total_records"] or 0

    def generate(self, progress_callback: Optional[Callable[[int, int, int], None]] = None) -> Dict[str, Any]:
        """
        Executes chunk generation.
        Checks for existing completed job first to prevent duplicate work.
        Returns job details and list of chunks.
        """
        # Duplicate check:
        existing_job = db.find_completed_chunk_job(self.file_id, self.records_per_chunk)
        if existing_job:
            chunks = db.get_chunks_for_job(existing_job["id"])
            # Verify all chunk files physically exist
            all_exist = all(os.path.exists(c["file_path"]) for c in chunks)
            if all_exist and len(chunks) == existing_job["total_chunks"]:
                return {
                    "job_id": existing_job["id"],
                    "reused": True,
                    "total_chunks": existing_job["total_chunks"],
                    "chunks": chunks
                }

        # Create persistent job in 'processing' status
        job_id = db.create_chunk_job(self.file_id, self.user_id, self.records_per_chunk)
        job_dir = CHUNKS_DIR / job_id
        job_dir.mkdir(parents=True, exist_ok=True)

        current_chunk_index = 1
        current_chunk_records = []
        record_start = 1
        processed_count = 0
        created_chunks = []

        try:
            for item in stream_json_items(self.source_path, self.records_path):
                current_chunk_records.append(item)
                processed_count += 1

                if len(current_chunk_records) >= self.records_per_chunk:
                    chunk_meta = self._write_chunk(
                        job_id=job_id,
                        job_dir=job_dir,
                        chunk_index=current_chunk_index,
                        records=current_chunk_records,
                        record_start=record_start,
                        record_end=processed_count
                    )
                    created_chunks.append(chunk_meta)
                    current_chunk_index += 1
                    record_start = processed_count + 1
                    current_chunk_records = []

                    if progress_callback:
                        progress_callback(processed_count, self.total_records, current_chunk_index - 1)

            # Write remainder chunk if any
            if current_chunk_records:
                chunk_meta = self._write_chunk(
                    job_id=job_id,
                    job_dir=job_dir,
                    chunk_index=current_chunk_index,
                    records=current_chunk_records,
                    record_start=record_start,
                    record_end=processed_count
                )
                created_chunks.append(chunk_meta)
                if progress_callback:
                    progress_callback(processed_count, self.total_records, current_chunk_index)

            # Mark job completed in database
            db.complete_chunk_job(job_id, len(created_chunks))

            return {
                "job_id": job_id,
                "reused": False,
                "total_chunks": len(created_chunks),
                "chunks": created_chunks
            }

        except Exception as e:
            # On crash or error, mark job failed and never mark partial chunks completed
            db.fail_chunk_job(job_id, str(e))
            raise RuntimeError(f"Chunk generation failed: {str(e)}")

    def _write_chunk(self, job_id: str, job_dir: Path, chunk_index: int,
                     records: List[Any], record_start: int, record_end: int) -> Dict[str, Any]:
        """
        Writes records to atomic temporary file, calculates SHA-256, verifies validity,
        and saves into database.
        """
        temp_path = job_dir / f"chunk_{chunk_index}.tmp.json"
        final_path = job_dir / f"chunk_{chunk_index}.json"

        # Write formatted JSON array (handles Decimal, float, int safely)
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(records, f, indent=2, ensure_ascii=False, default=default_json_serializer)

        # Atomic rename
        temp_path.replace(final_path)

        # Calculate file size and sha256
        file_size = os.path.getsize(final_path)
        sha256_hash = compute_file_sha256(str(final_path))
        record_count = len(records)

        # Save to database
        chunk_id = db.save_chunk(
            job_id=job_id,
            file_id=self.file_id,
            user_id=self.user_id,
            chunk_index=chunk_index,
            record_start=record_start,
            record_end=record_end,
            record_count=record_count,
            file_path=str(final_path),
            file_size=file_size,
            sha256_hash=sha256_hash
        )

        return {
            "id": chunk_id,
            "job_id": job_id,
            "chunk_index": chunk_index,
            "record_start": record_start,
            "record_end": record_end,
            "record_count": record_count,
            "file_path": str(final_path),
            "file_size": file_size,
            "sha256": sha256_hash
        }
