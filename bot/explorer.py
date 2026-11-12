"""
JSON Explorer & Search Engine.
Provides record browsing, pagination, search, and jump-to-record functionality.
Safe against memory overload and Telegram message length limits (4096 chars).
"""
import json
from typing import Dict, Any, List, Optional, Tuple
from bot.database import db
from bot.stream_parser import stream_json_items

class JsonExplorer:
    def __init__(self, file_id: str, user_id: int):
        self.file_id = file_id
        self.user_id = user_id
        self.file_info = db.get_file(file_id, user_id)
        if not self.file_info:
            raise ValueError("File not found or access denied.")

        self.source_path = self.file_info["decompressed_path"] or self.file_info["stored_path"]
        self.records_path = self.file_info["records_path"] or "item"
        self.total_records = self.file_info["total_records"] or 0

    def get_record(self, record_number: int) -> Optional[Dict[str, Any]]:
        """
        Retrieves a 1-indexed record from the file using streaming scan.
        """
        if record_number < 1 or (self.total_records > 0 and record_number > self.total_records):
            return None

        current = 1
        for item in stream_json_items(self.source_path, self.records_path):
            if current == record_number:
                return item
            current += 1
        return None

    def search_records(self, query: str, max_results: int = 10) -> List[Tuple[int, Any]]:
        """
        Streams through records and finds items matching search term in any key or stringified value.
        Returns list of (record_number, matched_item).
        """
        results = []
        q_lower = query.lower().strip()
        if not q_lower:
            return results

        current = 1
        for item in stream_json_items(self.source_path, self.records_path):
            item_str = json.dumps(item, ensure_ascii=False, default=str).lower()
            if q_lower in item_str:
                results.append((current, item))
                if len(results) >= max_results:
                    break
            current += 1

        return results

    def format_record_for_telegram(self, record_number: int, item: Any) -> str:
        """
        Formats record as pretty JSON within Telegram's 4096 character limit.
        """
        formatted = json.dumps(item, indent=2, ensure_ascii=False, default=str)
        # Leave room for header/footer (approx 3000 chars code block)
        if len(formatted) > 3000:
            formatted = formatted[:2950] + "\n  ... [truncated for Telegram display]"

        text = (
            f"📄 *Record #{record_number}* of {self.total_records:,}\n"
            f"📁 *File:* `{self.file_info['original_name']}`\n\n"
            f"```json\n{formatted}\n```"
        )
        return text

    def get_stats_overview(self) -> str:
        """Generates statistical overview of the active dataset."""
        f = self.file_info
        orig_size_mb = f["file_size"] / (1024 * 1024)
        decomp_size_mb = (f["decompressed_size"] or f["file_size"]) / (1024 * 1024)
        
        sections = f["structure_summary"] or "None"
        
        text = (
            f"📊 *Database Statistics & Structure*\n\n"
            f"• *File Name:* `{f['original_name']}`\n"
            f"• *File ID:* `{f['id']}`\n"
            f"• *Compressed:* {'Yes (GZIP)' if f['is_gzip'] else 'No'}\n"
            f"• *Stored Size:* `{orig_size_mb:.2f} MB`\n"
            f"• *Extracted Size:* `{decomp_size_mb:.2f} MB`\n"
            f"• *Root Type:* `{f['root_type']}`\n"
            f"• *Total Records:* `{f['total_records']:,}`\n"
            f"• *Records Path:* `{f['records_path']}`\n"
            f"• *SHA-256:* `{f['sha256'][:16]}...`\n"
        )
        return text
