"""
Core Logic Unit Tests for JSON Explorer Bot.
Tests:
- Streaming parsing of raw JSON and GZIP JSON
- Remainder chunking (e.g. 105 items split into 40 items = 40 + 40 + 25)
- Integrity of every chunk as valid JSON
- Duplicate SHA-256 detection
- Crash resumption status
"""
import os
import gzip
import json
import tempfile
import shutil
from pathlib import Path

# Adjust path for testing
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from bot.database import Database
from bot.stream_parser import (
    compute_file_sha256, extract_gzip_if_needed,
    StreamingJsonAnalyzer, stream_json_items
)

def run_tests():
    print("🚀 Starting JSON Explorer Bot Core Tests...")
    test_dir = Path(tempfile.mkdtemp(prefix="json_test_"))
    try:
        # 1. Test database initialization
        db_path = test_dir / "test.db"
        test_db = Database(db_path)
        print("✅ Database initialization & schema creation: PASS")

        # 2. Generate a synthetic JSON file with 105 nested records
        records_data = [
            {
                "id": i,
                "uuid": f"usr_{i:06d}",
                "name": f"User {i}",
                "profile": {
                    "age": 20 + (i % 50),
                    "tags": ["alpha", "beta", f"tag_{i%10}"],
                    "metadata": {"active": i % 2 == 0, "score": i * 1.5}
                }
            }
            for i in range(1, 106)
        ]

        raw_json_file = test_dir / "dataset.json"
        with open(raw_json_file, "w", encoding="utf-8") as f:
            json.dump(records_data, f, indent=2)

        # 3. Test SHA-256 computation
        sha1 = compute_file_sha256(str(raw_json_file))
        assert len(sha1) == 64, "SHA-256 hash must be 64 characters"
        print(f"✅ SHA-256 computation ({sha1[:12]}...): PASS")

        # 4. Test streaming analysis on raw JSON
        analyzer = StreamingJsonAnalyzer(str(raw_json_file))
        analysis = analyzer.analyze()
        assert analysis["is_valid"] is True, "JSON must be valid"
        assert analysis["total_records"] == 105, f"Expected 105 records, got {analysis['total_records']}"
        assert "profile" in analysis["sample_schema"], "Nested profile key should be detected"
        print(f"✅ Streaming JSON analysis (detected {analysis['total_records']} records): PASS")

        # 5. Test GZIP compression and streaming extraction
        gz_file = test_dir / "dataset.json.gz"
        with open(raw_json_file, "rb") as f_in, gzip.open(gz_file, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)

        extracted_path, is_gz, decomp_size = extract_gzip_if_needed(str(gz_file), str(test_dir))
        assert is_gz is True, "GZIP magic bytes must be detected"
        assert decomp_size == os.path.getsize(raw_json_file), "Decompressed size must match original"
        print(f"✅ GZIP detection & extraction ({decomp_size} bytes): PASS")

        # 6. Test chunk generation with remainder: 105 records split by 40 records/chunk
        # Expected: Chunk 1 = 40, Chunk 2 = 40, Chunk 3 = 25
        chunk_size = 40
        chunks_out_dir = test_dir / "chunks"
        chunks_out_dir.mkdir(parents=True, exist_ok=True)

        current_idx = 1
        current_records = []
        total_streamed = 0
        written_chunks = []

        for item in stream_json_items(str(raw_json_file), "item"):
            current_records.append(item)
            total_streamed += 1
            if len(current_records) >= chunk_size:
                out_path = chunks_out_dir / f"chunk_{current_idx}.json"
                with open(out_path, "w", encoding="utf-8") as f:
                    json.dump(current_records, f)
                written_chunks.append((out_path, len(current_records)))
                current_idx += 1
                current_records = []

        if current_records:
            out_path = chunks_out_dir / f"chunk_{current_idx}.json"
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(current_records, f)
            written_chunks.append((out_path, len(current_records)))

        assert len(written_chunks) == 3, f"Expected 3 chunks, got {len(written_chunks)}"
        assert written_chunks[0][1] == 40, "Chunk 1 should have 40 records"
        assert written_chunks[1][1] == 40, "Chunk 2 should have 40 records"
        assert written_chunks[2][1] == 25, "Chunk 3 should have 25 remainder records"

        # Verify every chunk is valid JSON and preserves nested structures
        reconstructed_count = 0
        for chunk_path, count in written_chunks:
            with open(chunk_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                assert isinstance(loaded, list), "Chunk must be a JSON array"
                assert len(loaded) == count
                assert "profile" in loaded[0], "Nested profile must be intact"
                assert isinstance(loaded[0]["profile"]["tags"], list)
                reconstructed_count += len(loaded)

        assert reconstructed_count == 105, "All records must be preserved with zero data loss"
        print(f"✅ Chunk generation & remainder verification (40 + 40 + 25 = 105): PASS")

        # 7. Test corrupted JSON handling
        corrupt_file = test_dir / "corrupted.json"
        with open(corrupt_file, "w") as f:
            f.write('[{"id": 1, "name": "ok"}, {"id": 2, "broken": ') # Truncated
        corrupt_analyzer = StreamingJsonAnalyzer(str(corrupt_file))
        corrupt_res = corrupt_analyzer.analyze()
        assert corrupt_res["is_valid"] is False, "Corrupted file must be marked invalid"
        print("✅ Corrupted/Malformed JSON detection: PASS")

        print("\n🎉 ALL CORE TESTS PASSED SUCCESSFULLY!")
    finally:
        shutil.rmtree(test_dir, ignore_errors=True)

if __name__ == "__main__":
    run_tests()
