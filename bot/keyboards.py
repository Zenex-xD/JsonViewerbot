"""
Telegram Inline Keyboard Markups for JSON Explorer Bot.
Implements modern keyboard layouts, pagination, and action buttons.
"""
from typing import List, Dict, Any, Optional
from telegram import InlineKeyboardButton, InlineKeyboardMarkup

def get_main_menu_keyboard() -> InlineKeyboardMarkup:
    """The 8 core options from the specification."""
    keyboard = [
        [
            InlineKeyboardButton("📤 Upload File", callback_data="menu_upload"),
            InlineKeyboardButton("🗄️ My Database", callback_data="menu_database")
        ],
        [
            InlineKeyboardButton("✂️ Generate Chunks", callback_data="menu_chunks"),
            InlineKeyboardButton("🔍 Explore JSON", callback_data="menu_explore")
        ],
        [
            InlineKeyboardButton("🔎 Search Data", callback_data="menu_search"),
            InlineKeyboardButton("📥 Download Files", callback_data="menu_download")
        ],
        [
            InlineKeyboardButton("📜 History", callback_data="menu_history"),
            InlineKeyboardButton("⚙️ Settings", callback_data="menu_settings")
        ]
    ]
    return InlineKeyboardMarkup(keyboard)

def get_chunk_preset_keyboard(file_id: str, total_records: int) -> InlineKeyboardMarkup:
    """Preset chunk buttons as requested."""
    keyboard = [
        [
            InlineKeyboardButton("5,000 records", callback_data=f"chunk_preset:{file_id}:5000"),
            InlineKeyboardButton("10,000 records", callback_data=f"chunk_preset:{file_id}:10000")
        ],
        [
            InlineKeyboardButton("20,000 records", callback_data=f"chunk_preset:{file_id}:20000"),
            InlineKeyboardButton("40,000 records", callback_data=f"chunk_preset:{file_id}:40000")
        ],
        [
            InlineKeyboardButton("50,000 records", callback_data=f"chunk_preset:{file_id}:50000"),
            InlineKeyboardButton("✏️ Custom Amount", callback_data=f"chunk_custom:{file_id}")
        ],
        [
            InlineKeyboardButton("🔙 Back to Menu", callback_data="main_menu")
        ]
    ]
    return InlineKeyboardMarkup(keyboard)

def get_explorer_keyboard(file_id: str, current_page: int, total_records: int) -> InlineKeyboardMarkup:
    """Navigation for records explorer."""
    nav_row = []
    
    # Prev buttons
    if current_page > 1:
        if current_page > 2:
            nav_row.append(InlineKeyboardButton("⏮ 1", callback_data=f"exp_page:{file_id}:1"))
        nav_row.append(InlineKeyboardButton("◀ Prev", callback_data=f"exp_page:{file_id}:{current_page - 1}"))
    
    # Current indicator / Jump button
    nav_row.append(InlineKeyboardButton(f"#{current_page:,}/{total_records:,}", callback_data=f"exp_jump:{file_id}"))

    # Next buttons
    if current_page < total_records:
        nav_row.append(InlineKeyboardButton("Next ▶", callback_data=f"exp_page:{file_id}:{current_page + 1}"))
        if current_page < total_records - 1:
            nav_row.append(InlineKeyboardButton(f"{total_records:,} ⏭", callback_data=f"exp_page:{file_id}:{total_records}"))

    keyboard = [
        nav_row,
        [
            InlineKeyboardButton("🔎 Search in File", callback_data=f"exp_search:{file_id}"),
            InlineKeyboardButton("📊 Stats & Summary", callback_data=f"exp_stats:{file_id}")
        ],
        [
            InlineKeyboardButton("🔙 Main Menu", callback_data="main_menu")
        ]
    ]
    return InlineKeyboardMarkup(keyboard)

def get_download_keyboard(file_id: str, chunks: List[Dict[str, Any]], page: int = 0, job_id: Optional[str] = None) -> InlineKeyboardMarkup:
    """Download menu with individual chunks, Download All ZIP, and Download Original."""
    effective_job_id = job_id or (chunks[0]["job_id"] if chunks else "")
    keyboard = [
        [
            InlineKeyboardButton("📦 Download All (ZIP)", callback_data=f"dl_all:{file_id}:{effective_job_id}"),
            InlineKeyboardButton("📄 Download Original", callback_data=f"dl_orig:{file_id}")
        ]
    ]

    # Chunk buttons paginated 6 per page
    per_page = 6
    total_chunks = len(chunks)
    start = page * per_page
    end = min(start + per_page, total_chunks)
    page_chunks = chunks[start:end]

    chunk_rows = []
    for i in range(0, len(page_chunks), 2):
        row = []
        c1 = page_chunks[i]
        size_kb = c1["file_size"] / 1024
        size_str = f"{size_kb:.0f}KB" if size_kb < 1024 else f"{(size_kb/1024):.1f}MB"
        row.append(InlineKeyboardButton(
            f"Chunk #{c1['chunk_index']} ({c1['record_count']:,} rec, {size_str})",
            callback_data=f"dl_chunk:{effective_job_id}:{c1['chunk_index']}"
        ))
        if i + 1 < len(page_chunks):
            c2 = page_chunks[i + 1]
            size_kb2 = c2["file_size"] / 1024
            size_str2 = f"{size_kb2:.0f}KB" if size_kb2 < 1024 else f"{(size_kb2/1024):.1f}MB"
            row.append(InlineKeyboardButton(
                f"Chunk #{c2['chunk_index']} ({c2['record_count']:,} rec, {size_str2})",
                callback_data=f"dl_chunk:{effective_job_id}:{c2['chunk_index']}"
            ))
        chunk_rows.append(row)

    keyboard.extend(chunk_rows)

    # Chunk pagination row if more than 6 chunks
    if total_chunks > per_page:
        nav = []
        if page > 0:
            nav.append(InlineKeyboardButton("◀ Prev Chunks", callback_data=f"dl_page:{file_id}:{page - 1}"))
        if end < total_chunks:
            nav.append(InlineKeyboardButton("Next Chunks ▶", callback_data=f"dl_page:{file_id}:{page + 1}"))
        if nav:
            keyboard.append(nav)

    keyboard.append([InlineKeyboardButton("🔙 Main Menu", callback_data="main_menu")])
    return InlineKeyboardMarkup(keyboard)

def get_file_select_keyboard(files: List[Dict[str, Any]], action_prefix: str) -> InlineKeyboardMarkup:
    """Shows user list of their uploaded files to select from."""
    keyboard = []
    for f in files:
        size_mb = f["file_size"] / (1024 * 1024)
        name = f["original_name"]
        if len(name) > 20:
            name = name[:18] + ".."
        keyboard.append([
            InlineKeyboardButton(
                f"📄 {name} ({f['total_records']:,} recs, {size_mb:.1f}MB)",
                callback_data=f"{action_prefix}:{f['id']}"
            )
        ])
    keyboard.append([InlineKeyboardButton("🔙 Back to Main Menu", callback_data="main_menu")])
    return InlineKeyboardMarkup(keyboard)

def get_back_button() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Main Menu", callback_data="main_menu")]])
