"""
Streaming JSON & GZIP Parser.
Analyzes large files (175MB+) using streaming iterators without loading full file into RAM.
Detects root structure, nested arrays, total record count, schema keys, and corruption.
"""
import gzip
import json
import os
import hashlib
from typing import Dict, Any, Generator, Tuple, Optional, List
from pathlib import Path

# Try importing ijson, with pure python fallback
try:
    import ijson
    HAS_IJSON = True
except ImportError:
    HAS_IJSON = False

def compute_file_sha256(filepath: str, chunk_size: int = 1024 * 1024) -> str:
    """Computes SHA-256 hash using streaming chunks (O(1) memory)."""
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(chunk_size):
            hasher.update(chunk)
    return hasher.hexdigest()

def extract_gzip_if_needed(source_path: str, target_dir: str) -> Tuple[str, bool, int]:
    """
    Checks if file is GZIP. If so, decompresses it to disk in streaming chunks.
    Returns (effective_path, is_gzip, decompressed_size).
    """
    is_gz = False
    with open(source_path, "rb") as f:
        magic = f.read(2)
        if magic == b"\x1f\x8b":
            is_gz = True

    if not is_gz:
        size = os.path.getsize(source_path)
        return source_path, False, size

    # Decompress stream to target_dir
    filename = Path(source_path).stem
    if not filename.endswith(".json"):
        filename += ".json"
    decompressed_path = os.path.join(target_dir, f"extracted_{filename}")

    decompressed_size = 0
    with gzip.open(source_path, "rb") as gz_in:
        with open(decompressed_path, "wb") as f_out:
            while chunk := gz_in.read(1024 * 1024):
                f_out.write(chunk)
                decompressed_size += len(chunk)

    return decompressed_path, True, decompressed_size


class StreamingJsonAnalyzer:
    """
    Analyzes JSON structure and counts records without loading the entire file into RAM.
    """
    def __init__(self, filepath: str):
        self.filepath = filepath
        self.file_size = os.path.getsize(filepath)

    def analyze(self) -> Dict[str, Any]:
        """
        Scans file and returns:
        - is_valid: bool
        - root_type: 'array' | 'object'
        - records_path: e.g. 'item' or 'records.item'
        - total_records: int
        - available_sections: list of dict keys
        - sample_schema: dict of field names -> data type
        - error_message: str if corrupted
        """
        try:
            if HAS_IJSON:
                return self._analyze_with_ijson()
            else:
                return self._analyze_fallback()
        except Exception as e:
            return {
                "is_valid": False,
                "root_type": "unknown",
                "records_path": "",
                "total_records": 0,
                "available_sections": [],
                "sample_schema": {},
                "error_message": f"Syntax / Parse Error: {str(e)}"
            }

    def _analyze_with_ijson(self) -> Dict[str, Any]:
        """Streaming analysis using ijson with multi-section database backup detection."""
        root_type = "unknown"
        records_path = ""
        sections = []
        section_counts = {}
        sample_schema = {}
        sample_records = []
        total_records = 0

        with open(self.filepath, "rb") as f:
            parser = ijson.parse(f)
            first_event = None

            for prefix, event, value in parser:
                if first_event is None:
                    first_event = (prefix, event, value)
                    if event == "start_array":
                        root_type = "array"
                        records_path = "item"
                    elif event == "start_map":
                        root_type = "object"

                if root_type == "object":
                    # Detect top-level sections
                    if prefix and "." not in prefix and event == "map_key":
                        if value not in sections:
                            sections.append(value)

                    # Count items in every top-level array in a single streaming pass
                    if prefix.endswith(".item") and event in ("start_map", "start_array", "string", "number", "boolean", "null"):
                        sec_name = prefix.split(".")[0]
                        section_counts[sec_name] = section_counts.get(sec_name, 0) + 1
                elif root_type == "array":
                    if prefix == "item" and event in ("start_map", "start_array", "string", "number", "boolean", "null"):
                        total_records += 1

        if root_type == "object":
            if section_counts:
                # Pick the array with the LARGEST record count (e.g. 'stealer': 1,500,000)
                max_sec = max(section_counts, key=section_counts.get)
                records_path = f"{max_sec}.item"
                total_records = section_counts[max_sec]
            else:
                records_path = "item"

        # Pass 2: Sample schema from primary array
        target_path = records_path if records_path else "item"
        with open(self.filepath, "rb") as f:
            items_iter = ijson.items(f, target_path, use_float=True)
            for idx, item in enumerate(items_iter):
                if idx >= 5:
                    break
                sample_records.append(item)
                if isinstance(item, dict):
                    for k, v in item.items():
                        if k not in sample_schema:
                            sample_schema[k] = type(v).__name__

        # Build detailed sections summary string
        section_summaries = []
        if section_counts:
            sorted_secs = sorted(section_counts.items(), key=lambda x: x[1], reverse=True)
            for s_name, s_count in sorted_secs:
                tag = " (Selected ⭐)" if s_name == records_path.split(".")[0] else ""
                section_summaries.append(f"{s_name}: {s_count:,}{tag}")
        elif sections:
            section_summaries = sections[:10]

        return {
            "is_valid": True,
            "root_type": root_type,
            "records_path": target_path,
            "total_records": total_records,
            "available_sections": sections,
            "structure_summary": " | ".join(section_summaries) if section_summaries else "Root Array",
            "sample_schema": sample_schema,
            "error_message": None
        }

    def _analyze_fallback(self) -> Dict[str, Any]:
        """
        Pure Python fallback for analyzing JSON files in streaming chunks.
        Never reads > 64KB at once.
        """
        with open(self.filepath, "r", encoding="utf-8", errors="replace") as f:
            # Find first non-whitespace character
            first_char = ""
            while True:
                ch = f.read(1)
                if not ch:
                    break
                if not ch.isspace():
                    first_char = ch
                    break

        if first_char == "[":
            root_type = "array"
            records_path = "item"
        elif first_char == "{":
            root_type = "object"
            records_path = "records.item"
        else:
            return {
                "is_valid": False,
                "root_type": "invalid",
                "records_path": "",
                "total_records": 0,
                "available_sections": [],
                "sample_schema": {},
                "error_message": f"Expected JSON root [ or {{, found '{first_char}'"
            }

        # Stream items using Python's streaming generator
        total_records = 0
        sample_schema = {}
        sections = []

        try:
            for idx, item in enumerate(stream_json_items(self.filepath, records_path)):
                total_records += 1
                if idx < 5 and isinstance(item, dict):
                    for k, v in item.items():
                        if k not in sample_schema:
                            sample_schema[k] = type(v).__name__
        except Exception as e:
            return {
                "is_valid": False,
                "root_type": root_type,
                "records_path": records_path,
                "total_records": total_records,
                "available_sections": sections,
                "sample_schema": sample_schema,
                "error_message": f"Malformed JSON: {str(e)}"
            }

        return {
            "is_valid": True,
            "root_type": root_type,
            "records_path": records_path,
            "total_records": total_records,
            "available_sections": sections,
            "sample_schema": sample_schema,
            "error_message": None
        }


def stream_json_items(filepath: str, records_path: str = "item") -> Generator[Any, None, None]:
    """
    Generator yielding individual JSON records from a large file without loading full file into memory.
    Uses ijson when available, or a memory-bounded streaming tokenizer fallback.
    """
    if HAS_IJSON:
        with open(filepath, "rb") as f:
            for item in ijson.items(f, records_path, use_float=True):
                yield item
    else:
        # Fallback memory-bounded reader
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            # Skip leading characters until '['
            in_array = False
            while True:
                ch = f.read(1)
                if not ch:
                    break
                if ch == "[":
                    in_array = True
                    break

            if not in_array:
                return

            decoder = json.JSONDecoder()
            buf = ""
            while True:
                # Read chunks
                chunk = f.read(65536)
                if not chunk and not buf.strip():
                    break
                buf += chunk
                
                while True:
                    # Strip leading spaces and commas
                    buf = buf.lstrip(" \t\r\n,")
                    if not buf:
                        break
                    if buf.startswith("]"):
                        return  # End of array

                    try:
                        obj, end_pos = decoder.raw_decode(buf)
                        yield obj
                        buf = buf[end_pos:]
                    except json.JSONDecodeError:
                        # Need more data in buffer unless EOF
                        if not chunk:
                            # EOF reached and couldn't decode
                            if buf.strip() and buf.strip() != "]":
                                raise ValueError("Unexpected end of JSON stream")
                            return
                        break
