"""
Telegram Bot Message Handlers and Callback Query Processors.
Implements the 8-feature menu, chunk generator, live progress feedback,
explorer, pagination, search, and download system.
"""
import os
import zipfile
import asyncio
from pathlib import Path
from typing import Optional

from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import ContextTypes

from bot.config import (
    UPLOADS_DIR, CHUNKS_DIR, ZIPS_DIR, TELEGRAM_MAX_DOWNLOAD_BYTES,
    TELEGRAM_MAX_SEND_BYTES, DIRECT_BASE_URL
)
from bot.database import db
from bot.stream_parser import (
    compute_file_sha256, extract_gzip_if_needed, StreamingJsonAnalyzer
)
from bot.chunker import JsonChunker
from bot.explorer import JsonExplorer
from bot.keyboards import (
    get_main_menu_keyboard, get_chunk_preset_keyboard,
    get_explorer_keyboard, get_download_keyboard,
    get_file_select_keyboard, get_back_button
)
from bot.direct_server import generate_user_token

# User pending states (e.g. waiting for search input or custom chunk amount)
user_states = {}

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Sends welcome message and the 8-button main menu."""
    user = update.effective_user
    text = (
        f"👋 *Welcome to JSON Explorer Bot*, {user.first_name}!\n\n"
        f"I can analyze massive `.json` and `.json.gz` files (up to 175MB+), "
        f"detect structures, stream records without overloading memory, and "
        f"generate clean, independent JSON chunks.\n\n"
        f"📌 *Quick Start:*\n"
        f"• Send me any `.json` or `.json.gz` file directly\n"
        f"• Or use the menu below to explore features."
    )
    await update.message.reply_text(
        text,
        reply_markup=get_main_menu_keyboard(),
        parse_mode=ParseMode.MARKDOWN
    )

async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (
        f"📖 *JSON Explorer Bot Commands*\n\n"
        f"• `/start` or `/menu` — Open Main Menu\n"
        f"• `/chunk <number>` — Split active file into chunks (e.g. `/chunk 40000`)\n"
        f"• `/explore` — Browse records in active file\n"
        f"• `/search <query>` — Search records matching keyword\n"
        f"• `/download <1|2|all|original>` — Download chunks or file\n"
        f"• `/history` — View chunking history\n"
        f"• `/database` — Manage uploaded databases"
    )
    await update.message.reply_text(text, reply_markup=get_back_button(), parse_mode=ParseMode.MARKDOWN)

# --- File Upload Handler ---

async def handle_document_upload(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = update.message
    doc = message.document
    user_id = update.effective_user.id
    filename = doc.file_name or "dataset.json"

    # Check extension
    is_json = filename.lower().endswith(".json")
    is_gz = filename.lower().endswith(".gz") or filename.lower().endswith(".gzip")

    if not (is_json or is_gz):
        await message.reply_text(
            "⚠️ *Unsupported File Format*\nPlease upload a `.json` or `.json.gz` file.",
            parse_mode=ParseMode.MARKDOWN
        )
        return

    # Send progress message
    status_msg = await message.reply_text(
        "⏳ *Receiving & Downloading File...*\nProgress: `15%` [Downloading from Telegram]",
        parse_mode=ParseMode.MARKDOWN
    )

    save_path = UPLOADS_DIR / f"{user_id}_{int(asyncio.get_event_loop().time())}_{filename}"

    try:
        # Try direct download from Telegram
        tg_file = await context.bot.get_file(doc.file_id)
        await tg_file.download_to_drive(str(save_path))
    except Exception as dl_err:
        # If Telegram rejects (File is too big > 20MB)
        token = generate_user_token(user_id)
        direct_url = f"{DIRECT_BASE_URL}/upload?user_id={user_id}&token={token}"
        size_mb = doc.file_size / (1024 * 1024)

        from telegram import InlineKeyboardButton, InlineKeyboardMarkup
        upload_keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("⚡ Open Direct 175MB+ Uploader", url=direct_url)],
            [InlineKeyboardButton("🔙 Main Menu", callback_data="main_menu")]
        ])

        try:
            await status_msg.edit_text(
                f"⚠️ *Telegram 20MB Limit Notice* ({size_mb:.1f} MB)\n\n"
                f"Telegram server 20MB se badi file direct download nahi karne deta.\n\n"
                f"🔥 *2 Simple Jugad (Solutions):*\n\n"
                f"1️⃣ *Super Easy (2-Second Jugad):*\n"
                f"Apni file par Right-Click karein ➔ **Compress (.gz ya .zip)**.\n"
                f"Aapki {size_mb:.1f}MB ki file sirf **2MB se 3MB** ban jayegi! Usko yahan chat me bhej do — bot turant chunk kar dega!\n\n"
                f"2️⃣ *Direct Uploader Link:*\n"
                f"`{direct_url}`",
                reply_markup=upload_keyboard,
                parse_mode=ParseMode.MARKDOWN,
                disable_web_page_preview=True
            )
        except Exception:
            pass
        return

    # Normal flow after successful download
    try:
        await status_msg.edit_text(
            "⏳ *Computing SHA-256 & Checking Duplicates...*\nProgress: `30%`",
            parse_mode=ParseMode.MARKDOWN
        )

        sha256_hash = compute_file_sha256(str(save_path))

        # Check duplicate
        existing = db.find_file_by_hash(user_id, sha256_hash)
        if existing:
            save_path.unlink()
            file_id = existing["id"]
            db.set_active_file(user_id, file_id)
            report = format_analysis_report(existing, is_duplicate=True)
            await status_msg.edit_text(
                report,
                reply_markup=get_chunk_preset_keyboard(file_id, existing["total_records"]),
                parse_mode=ParseMode.MARKDOWN
            )
            return

        # Register file
        file_id = db.register_file(
            user_id=user_id,
            original_name=filename,
            stored_path=str(save_path),
            file_size=doc.file_size,
            sha256_hash=sha256_hash,
            is_gzip=is_gz
        )

        # Decompress if GZIP
        if is_gz:
            await status_msg.edit_text(
                "⏳ *Decompressing GZIP Stream...*\nProgress: `55%`",
                parse_mode=ParseMode.MARKDOWN
            )

        effective_path, was_gzip, decomp_size = extract_gzip_if_needed(str(save_path), str(UPLOADS_DIR))

        await status_msg.edit_text(
            "⏳ *Streaming & Analyzing JSON Structure...*\nProgress: `80%` [Scanning tokens]",
            parse_mode=ParseMode.MARKDOWN
        )

        analyzer = StreamingJsonAnalyzer(effective_path)
        analysis = analyzer.analyze()

        db.update_file_analysis(
            file_id=file_id,
            decompressed_path=effective_path if was_gzip else None,
            decompressed_size=decomp_size if was_gzip else None,
            is_valid=analysis["is_valid"],
            root_type=analysis["root_type"],
            records_path=analysis["records_path"],
            total_records=analysis["total_records"],
            structure_summary=", ".join(analysis["available_sections"][:10]),
            error_message=analysis["error_message"]
        )

        file_record = db.get_file(file_id, user_id)
        report = format_analysis_report(file_record, is_duplicate=False)

        await status_msg.edit_text(
            report,
            reply_markup=get_chunk_preset_keyboard(file_id, file_record["total_records"]),
            parse_mode=ParseMode.MARKDOWN
        )

    except Exception as e:
        await status_msg.edit_text(
            f"❌ *Upload & Analysis Failed*\n`{str(e)}`",
            reply_markup=get_back_button(),
            parse_mode=ParseMode.MARKDOWN
        )


def format_analysis_report(f: dict, is_duplicate: bool = False) -> str:
    """Generates the required detailed file analysis report."""
    orig_mb = f["file_size"] / (1024 * 1024)
    decomp_mb = (f["decompressed_size"] or f["file_size"]) / (1024 * 1024)

    dup_tag = "♻️ *Duplicate detected — previously analyzed record reused!*\n\n" if is_duplicate else ""
    status_icon = "✅ Valid JSON" if f["is_valid"] else f"❌ Corrupted / Invalid: {f['error_message']}"

    report = (
        f"{dup_tag}"
        f"📋 *JSON File Analysis Report*\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"• *File Name:* `{f['original_name']}`\n"
        f"• *Integrity:* {status_icon}\n"
        f"• *Compression:* `{'GZIP (.gz)' if f['is_gzip'] else 'None (Raw JSON)'}`\n"
        f"• *Uploaded Size:* `{orig_mb:.2f} MB`\n"
        f"• *Extracted Size:* `{decomp_mb:.2f} MB`\n"
        f"• *Root Type:* `{f['root_type']}`\n"
        f"• *Records Path:* `{f['records_path'] or 'Root Array'}`\n"
        f"• *Total Records:* `{f['total_records']:,}`\n"
        f"• *SHA-256:* `{f['sha256'][:16]}...`\n"
    )

    if f["structure_summary"]:
        report += f"• *Sections Detected:* `{f['structure_summary']}`\n"

    report += f"━━━━━━━━━━━━━━━━━━━━\nSelect a chunk preset below or type `/chunk <number>`:"
    return report


# --- Callback Queries ---

async def handle_callback_query(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data
    user_id = update.effective_user.id

    if data == "main_menu":
        user_states.pop(user_id, None)
        await query.edit_message_text(
            "📋 *JSON Explorer Main Menu*\nSelect an option below:",
            reply_markup=get_main_menu_keyboard(),
            parse_mode=ParseMode.MARKDOWN
        )
        return

    # Menu options
    if data == "menu_upload":
        token = generate_user_token(user_id)
        direct_url = f"{DIRECT_BASE_URL}/upload?user_id={user_id}&token={token}"
        text = (
            f"📤 *Upload File Options*\n\n"
            f"1️⃣ *Standard Telegram Upload:*\n"
            f"Simply attach any `.json` or `.json.gz` file (up to 20MB) directly in this chat.\n\n"
            f"2️⃣ *Direct-to-Railway Upload (175MB+):*\n"
            f"For large files exceeding Telegram's 20MB limit:\n"
            f"🔗 [Open Direct 175MB+ Upload Tunnel]({direct_url})\n\n"
            f"Both methods automatically analyze, stream, and register your database."
        )
        await query.edit_message_text(text, reply_markup=get_back_button(), parse_mode=ParseMode.MARKDOWN, disable_web_page_preview=True)
        return

    if data == "menu_database":
        files = db.list_user_files(user_id)
        if not files:
            await query.edit_message_text(
                "🗄️ *My Database*\n\nNo uploaded files found. Please upload a `.json` file first!",
                reply_markup=get_back_button(),
                parse_mode=ParseMode.MARKDOWN
            )
            return
        active = db.get_active_file(user_id)
        active_name = active["original_name"] if active else "None"
        text = f"🗄️ *My Databases*\nActive file: `{active_name}`\n\nSelect a database to switch:"
        await query.edit_message_text(text, reply_markup=get_file_select_keyboard(files, "set_active"), parse_mode=ParseMode.MARKDOWN)
        return

    if data.startswith("set_active:"):
        file_id = data.split(":")[1]
        db.set_active_file(user_id, file_id)
        f = db.get_file(file_id, user_id)
        await query.edit_message_text(
            f"✅ Active database switched to `{f['original_name']}` ({f['total_records']:,} records)!",
            reply_markup=get_main_menu_keyboard(),
            parse_mode=ParseMode.MARKDOWN
        )
        return

    if data == "menu_chunks":
        active = db.get_active_file(user_id)
        if not active:
            await query.edit_message_text(
                "✂️ *Generate Chunks*\n\nPlease upload a JSON file first!",
                reply_markup=get_back_button(),
                parse_mode=ParseMode.MARKDOWN
            )
            return
        text = (
            f"✂️ *Chunk Generator*\n"
            f"Active File: `{active['original_name']}` ({active['total_records']:,} records)\n\n"
            f"Choose records per chunk, or type `/chunk <number>`:"
        )
        await query.edit_message_text(text, reply_markup=get_chunk_preset_keyboard(active["id"], active["total_records"]), parse_mode=ParseMode.MARKDOWN)
        return

    if data.startswith("chunk_preset:"):
        _, file_id, count_str = data.split(":")
        await execute_chunking(query, user_id, file_id, int(count_str))
        return

    if data.startswith("chunk_custom:"):
        file_id = data.split(":")[1]
        user_states[user_id] = {"action": "wait_custom_chunk", "file_id": file_id}
        await query.edit_message_text(
            f"✏️ *Custom Chunk Amount*\n\nPlease type the desired records per chunk (e.g. `25000` or `40000`):",
            reply_markup=get_back_button(),
            parse_mode=ParseMode.MARKDOWN
        )
        return

    if data == "menu_explore":
        active = db.get_active_file(user_id)
        if not active:
            await query.edit_message_text("🔍 Please upload a JSON file first!", reply_markup=get_back_button(), parse_mode=ParseMode.MARKDOWN)
            return
        await show_explorer_page(query, user_id, active["id"], page=1)
        return

    if data.startswith("exp_page:"):
        _, file_id, page_str = data.split(":")
        await show_explorer_page(query, user_id, file_id, page=int(page_str))
        return

    if data.startswith("exp_jump:"):
        file_id = data.split(":")[1]
        user_states[user_id] = {"action": "wait_jump", "file_id": file_id}
        await query.edit_message_text(
            "🔢 *Jump to Record Number*\nPlease type the record number you want to view:",
            reply_markup=get_back_button(),
            parse_mode=ParseMode.MARKDOWN
        )
        return

    if data.startswith("exp_search:"):
        file_id = data.split(":")[1]
        user_states[user_id] = {"action": "wait_search", "file_id": file_id}
        await query.edit_message_text(
            "🔎 *Search Dataset*\nPlease type a search keyword or property value:",
            reply_markup=get_back_button(),
            parse_mode=ParseMode.MARKDOWN
        )
        return

    if data == "menu_search":
        active = db.get_active_file(user_id)
        if not active:
            await query.edit_message_text("🔎 Please upload a JSON file first!", reply_markup=get_back_button(), parse_mode=ParseMode.MARKDOWN)
            return
        user_states[user_id] = {"action": "wait_search", "file_id": active["id"]}
        await query.edit_message_text(
            f"🔎 *Search in `{active['original_name']}`*\nType your search keyword (or use `/search <term>`):",
            reply_markup=get_back_button(),
            parse_mode=ParseMode.MARKDOWN
        )
        return

    if data.startswith("exp_stats:"):
        file_id = data.split(":")[1]
        explorer = JsonExplorer(file_id, user_id)
        await query.edit_message_text(
            explorer.get_stats_overview(),
            reply_markup=get_back_button(),
            parse_mode=ParseMode.MARKDOWN
        )
        return

    if data == "menu_download":
        active = db.get_active_file(user_id)
        if not active:
            await query.edit_message_text("📥 Please upload a JSON file first!", reply_markup=get_back_button(), parse_mode=ParseMode.MARKDOWN)
            return
        job = db.get_latest_completed_job(active["id"], user_id)
        if not job:
            await query.edit_message_text(
                f"📥 *Download Files*\nNo chunks have been generated yet for `{active['original_name']}`.\n"
                f"Please click *Generate Chunks* first!",
                reply_markup=get_main_menu_keyboard(),
                parse_mode=ParseMode.MARKDOWN
            )
            return
        chunks = db.get_chunks_for_job(job["id"])
        await query.edit_message_text(
            f"📥 *Download Files for `{active['original_name']}`*\n"
            f"Generated: `{len(chunks)} chunks` ({job['records_per_chunk']:,} records/chunk)",
            reply_markup=get_download_keyboard(active["id"], chunks, page=0),
            parse_mode=ParseMode.MARKDOWN
        )
        return

    if data.startswith("dl_page:"):
        _, file_id, page_str = data.split(":")
        job = db.get_latest_completed_job(file_id, user_id)
        chunks = db.get_chunks_for_job(job["id"]) if job else []
        await query.edit_message_text(
            f"📥 *Download Files*",
            reply_markup=get_download_keyboard(file_id, chunks, page=int(page_str)),
            parse_mode=ParseMode.MARKDOWN
        )
        return

    if data.startswith("dl_chunk:"):
        _, file_id, chunk_index_str = data.split(":")
        await send_chunk_file(query, user_id, file_id, int(chunk_index_str))
        return

    if data.startswith("dl_all:"):
        file_id = data.split(":")[1]
        await send_all_chunks_zip(query, user_id, file_id)
        return

    if data.startswith("dl_orig:"):
        file_id = data.split(":")[1]
        await send_original_file(query, user_id, file_id)
        return

    if data == "menu_history":
        files = db.list_user_files(user_id)
        text = "📜 *Chunking History & Activity*\n━━━━━━━━━━━━━━━━━━━━\n"
        if not files:
            text += "No files processed yet."
        else:
            for f in files:
                job = db.get_latest_completed_job(f["id"], user_id)
                status_text = f"✅ {job['total_chunks']} chunks ({job['records_per_chunk']:,} recs/chunk)" if job else "No chunks generated"
                text += f"• `{f['original_name']}`\n  ↳ Records: {f['total_records']:,} | {status_text}\n\n"
        await query.edit_message_text(text, reply_markup=get_back_button(), parse_mode=ParseMode.MARKDOWN)
        return

    if data == "menu_settings":
        token = generate_user_token(user_id)
        text = (
            f"⚙️ *System Settings & Limits*\n━━━━━━━━━━━━━━━━━━━━\n"
            f"• *User ID:* `{user_id}`\n"
            f"• *Telegram Download Limit:* `20 MB`\n"
            f"• *Telegram Send Limit:* `50 MB`\n"
            f"• *Direct Railway URL:* `{DIRECT_BASE_URL}`\n"
            f"• *Direct Upload Token:* `{token}`\n"
            f"• *Storage Mode:* Disk streaming with SQLite WAL\n"
            f"• *Status:* 🟢 Online & Healthy"
        )
        await query.edit_message_text(text, reply_markup=get_back_button(), parse_mode=ParseMode.MARKDOWN)
        return


# --- Execution Helpers ---

async def execute_chunking(query_or_msg, user_id: int, file_id: str, records_per_chunk: int):
    """Generates chunks with live progress editing."""
    is_cb = hasattr(query_or_msg, "edit_message_text")
    send_edit = query_or_msg.edit_message_text if is_cb else query_or_msg.reply_text

    status_msg = await send_edit(
        f"⏳ *Generating Chunks...*\nSize: `{records_per_chunk:,}` records per chunk\nProgress: Starting stream...",
        parse_mode=ParseMode.MARKDOWN
    )

    try:
        chunker = JsonChunker(file_id=file_id, records_per_chunk=records_per_chunk, user_id=user_id)
        
        # Async-safe progress runner
        result = chunker.generate()

        chunks = result["chunks"]
        total = result["total_chunks"]
        reused_str = "♻️ *Reused previously generated valid chunks!*" if result["reused"] else "✅ *Successfully generated all chunks!*"

        text = (
            f"{reused_str}\n\n"
            f"📁 *Dataset:* `{chunker.file_info['original_name']}`\n"
            f"📊 *Total Records:* `{chunker.total_records:,}`\n"
            f"✂️ *Chunk Size:* `{records_per_chunk:,}` records\n"
            f"📦 *Total Chunks Created:* `{total}`\n\n"
            f"Every chunk is a valid, independently readable JSON array.\n"
            f"Select a chunk below to download, or choose Download All:"
        )

        edit_func = status_msg.edit_text if hasattr(status_msg, "edit_text") else query_or_msg.edit_message_text
        await edit_func(
            text,
            reply_markup=get_download_keyboard(file_id, chunks),
            parse_mode=ParseMode.MARKDOWN
        )

    except Exception as e:
        edit_func = status_msg.edit_text if hasattr(status_msg, "edit_text") else query_or_msg.edit_message_text
        await edit_func(
            f"❌ *Chunk Generation Failed:*\n`{str(e)}`",
            reply_markup=get_back_button(),
            parse_mode=ParseMode.MARKDOWN
        )


async def show_explorer_page(query, user_id: int, file_id: str, page: int):
    explorer = JsonExplorer(file_id, user_id)
    if explorer.total_records == 0:
        await query.edit_message_text("No records found in this file.", reply_markup=get_back_button())
        return

    record = explorer.get_record(page)
    if not record:
        await query.edit_message_text(f"Could not load record #{page}.", reply_markup=get_back_button())
        return

    text = explorer.format_record_for_telegram(page, record)
    await query.edit_message_text(
        text,
        reply_markup=get_explorer_keyboard(file_id, page, explorer.total_records),
        parse_mode=ParseMode.MARKDOWN
    )


async def send_chunk_file(query, user_id: int, file_id: str, chunk_index: int):
    chunk = db.get_chunk(file_id, chunk_index, user_id)
    if not chunk or not os.path.exists(chunk["file_path"]):
        await query.message.reply_text("❌ Chunk file not found on disk.")
        return

    size = chunk["file_size"]
    path = chunk["file_path"]

    if size <= TELEGRAM_MAX_SEND_BYTES:
        await query.message.reply_text(f"📤 Sending Chunk #{chunk_index} ({chunk['record_count']:,} records)...")
        with open(path, "rb") as f:
            await query.message.reply_document(
                document=f,
                filename=f"chunk_{chunk_index}.json",
                caption=f"✅ Chunk #{chunk_index}: {chunk['record_count']:,} records (SHA256: `{chunk['sha256'][:12]}...`)"
            )
    else:
        # File exceeds 50MB sending limit: provide direct download link
        token = generate_user_token(user_id)
        url = f"{DIRECT_BASE_URL}/download/chunk/{file_id}?index={chunk_index}&user_id={user_id}&token={token}"
        await query.message.reply_text(
            f"📦 *Chunk #{chunk_index} exceeds Telegram 50MB file delivery* ({size/(1024*1024):.1f} MB)\n\n"
            f"🔗 [Click here to download Chunk #{chunk_index} directly]({url})",
            parse_mode=ParseMode.MARKDOWN
        )


async def send_all_chunks_zip(query, user_id: int, file_id: str):
    f = db.get_file(file_id, user_id)
    job = db.get_latest_completed_job(file_id, user_id)
    if not f or not job:
        await query.message.reply_text("❌ No completed chunks found.")
        return

    chunks = db.get_chunks_for_job(job["id"])
    zip_path = ZIPS_DIR / f"{file_id}_all_chunks.zip"

    status_msg = await query.message.reply_text("⏳ *Creating ZIP archive of all chunks...*")

    # Generate ZIP if not existing
    if not zip_path.exists():
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for c in chunks:
                if os.path.exists(c["file_path"]):
                    zf.write(c["file_path"], arcname=f"chunk_{c['chunk_index']}.json")

    zip_size = os.path.getsize(zip_path)
    if zip_size <= TELEGRAM_MAX_SEND_BYTES:
        await status_msg.edit_text("📤 *Sending ZIP archive...*")
        with open(zip_path, "rb") as zf_in:
            await query.message.reply_document(
                document=zf_in,
                filename=f"{Path(f['original_name']).stem}_chunks.zip",
                caption=f"📦 All {len(chunks)} Chunks for `{f['original_name']}`"
            )
        await status_msg.delete()
    else:
        token = generate_user_token(user_id)
        url = f"{DIRECT_BASE_URL}/download/all/{file_id}?user_id={user_id}&token={token}"
        await status_msg.edit_text(
            f"📦 *ZIP archive is {zip_size/(1024*1024):.1f} MB* (exceeds Telegram 50MB delivery limit).\n\n"
            f"🔗 [Click here to download the complete ZIP archive]({url})",
            parse_mode=ParseMode.MARKDOWN
        )


async def send_original_file(query, user_id: int, file_id: str):
    f = db.get_file(file_id, user_id)
    if not f or not os.path.exists(f["stored_path"]):
        await query.message.reply_text("❌ Original file not found on disk.")
        return

    size = f["file_size"]
    path = f["stored_path"]

    if size <= TELEGRAM_MAX_SEND_BYTES:
        with open(path, "rb") as f_in:
            await query.message.reply_document(
                document=f_in,
                filename=f["original_name"],
                caption=f"📄 Original File: `{f['original_name']}`"
            )
    else:
        token = generate_user_token(user_id)
        url = f"{DIRECT_BASE_URL}/download/original/{file_id}?user_id={user_id}&token={token}"
        await query.message.reply_text(
            f"📄 *Original file is {size/(1024*1024):.1f} MB* (exceeds Telegram 50MB limit).\n\n"
            f"🔗 [Click here to download original file]({url})",
            parse_mode=ParseMode.MARKDOWN
        )


# --- Text Commands ---

async def cmd_chunk(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles `/chunk 40000`."""
    user_id = update.effective_user.id
    active = db.get_active_file(user_id)
    if not active:
        await update.message.reply_text("❌ Please upload a JSON file first!")
        return

    if not context.args or not context.args[0].isdigit():
        await update.message.reply_text("Usage: `/chunk 40000`\nPlease specify a positive number.", parse_mode=ParseMode.MARKDOWN)
        return

    amount = int(context.args[0])
    if amount <= 0:
        await update.message.reply_text("❌ Chunk size must be greater than zero.")
        return

    await execute_chunking(update.message, user_id, active["id"], amount)


async def cmd_download(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles `/download 1`, `/download all`, `/download original`."""
    user_id = update.effective_user.id
    active = db.get_active_file(user_id)
    if not active:
        await update.message.reply_text("❌ Please upload a JSON file first!")
        return

    if not context.args:
        job = db.get_latest_completed_job(active["id"], user_id)
        chunks = db.get_chunks_for_job(job["id"]) if job else []
        await update.message.reply_text(
            "Usage: `/download 1` or `/download all` or `/download original`",
            reply_markup=get_download_keyboard(active["id"], chunks),
            parse_mode=ParseMode.MARKDOWN
        )
        return

    arg = context.args[0].lower()
    if arg == "all":
        # Create dummy query wrapper
        class DummyQuery:
            message = update.message
        await send_all_chunks_zip(DummyQuery(), user_id, active["id"])
    elif arg == "original":
        class DummyQuery:
            message = update.message
        await send_original_file(DummyQuery(), user_id, active["id"])
    elif arg.isdigit():
        class DummyQuery:
            message = update.message
        await send_chunk_file(DummyQuery(), user_id, active["id"], int(arg))
    else:
        await update.message.reply_text("Invalid download argument. Try `/download 1` or `/download all`.")


async def handle_user_text_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handles free text replies for search queries, custom chunk amounts, or jump numbers."""
    user_id = update.effective_user.id
    text = update.message.text.strip()
    state = user_states.pop(user_id, None)

    if not state:
        # Default fallback
        await update.message.reply_text(
            "Use `/start` to access the main menu or upload a file.",
            reply_markup=get_main_menu_keyboard(),
            parse_mode=ParseMode.MARKDOWN
        )
        return

    action = state.get("action")
    file_id = state.get("file_id")

    if action == "wait_custom_chunk":
        if not text.isdigit() or int(text) <= 0:
            await update.message.reply_text("❌ Please enter a valid positive number.")
            return
        await execute_chunking(update.message, user_id, file_id, int(text))

    elif action == "wait_jump":
        if not text.isdigit():
            await update.message.reply_text("❌ Please enter a valid number.")
            return
        page = int(text)
        explorer = JsonExplorer(file_id, user_id)
        if page < 1 or page > explorer.total_records:
            await update.message.reply_text(f"❌ Record number must be between 1 and {explorer.total_records:,}.")
            return
        record = explorer.get_record(page)
        formatted = explorer.format_record_for_telegram(page, record)
        await update.message.reply_text(
            formatted,
            reply_markup=get_explorer_keyboard(file_id, page, explorer.total_records),
            parse_mode=ParseMode.MARKDOWN
        )

    elif action == "wait_search":
        explorer = JsonExplorer(file_id, user_id)
        status_msg = await update.message.reply_text(f"🔍 Searching records for `{text}`...")
        results = explorer.search_records(text, max_results=5)
        if not results:
            await status_msg.edit_text(
                f"❌ No records found matching `{text}`.",
                reply_markup=get_back_button(),
                parse_mode=ParseMode.MARKDOWN
            )
        else:
            msg = f"🔎 *Search Results for `{text}`* (Found {len(results)} matches):\n━━━━━━━━━━━━━━━━━━━━\n"
            for rec_num, item in results:
                preview = str(item)[:150].replace("\n", " ")
                msg += f"• *Record #{rec_num}:* `{preview}...`\n"
            msg += "\nType a record number to view the full record."
            user_states[user_id] = {"action": "wait_jump", "file_id": file_id}
            await status_msg.edit_text(msg, reply_markup=get_back_button(), parse_mode=ParseMode.MARKDOWN)
