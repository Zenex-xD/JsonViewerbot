"""
Main Application Entry Point for JSON Explorer Telegram Bot.
Boots the python-telegram-bot application, initializes the database,
and launches the concurrent direct upload/download server.
"""
import sys
import logging
import asyncio
from telegram.ext import (
    ApplicationBuilder, CommandHandler, MessageHandler,
    CallbackQueryHandler, filters
)

from bot.config import TELEGRAM_BOT_TOKEN, LOCAL_BOT_API_URL
from bot.database import db
from bot.handlers import (
    cmd_start, cmd_help, cmd_chunk, cmd_download,
    handle_document_upload, handle_callback_query, handle_user_text_input,
    format_analysis_report
)
from bot.keyboards import get_chunk_preset_keyboard
from bot.direct_server import start_direct_server

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger("JsonExplorerBot")

def main():
    if not TELEGRAM_BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN environment variable is not set!")
        logger.info("Please set TELEGRAM_BOT_TOKEN in your environment or Railway dashboard.")
        sys.exit(1)

    logger.info("Initializing JSON Explorer Bot...")

    # Build Telegram Bot application
    builder = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN)
    
    # Custom Local Bot API Server if configured (enables up to 2GB Telegram downloads directly)
    if LOCAL_BOT_API_URL:
        logger.info(f"Using Local Bot API Server at: {LOCAL_BOT_API_URL}")
        builder.base_url(f"{LOCAL_BOT_API_URL}/bot")
        builder.base_file_url(f"{LOCAL_BOT_API_URL}/file/bot")

    app = builder.build()

    # Web upload notification callback
    def on_direct_upload(user_id: int, file_id: str):
        try:
            f = db.get_file(file_id, user_id)
            if f:
                report = format_analysis_report(f, is_duplicate=False)
                # Schedule message send in bot's event loop
                asyncio.run_coroutine_threadsafe(
                    app.bot.send_message(
                        chat_id=user_id,
                        text=f"⚡ *Direct Upload Received & Analyzed!*\n\n{report}",
                        reply_markup=get_chunk_preset_keyboard(file_id, f["total_records"]),
                        parse_mode="Markdown"
                    ),
                    app.loop
                )
        except Exception as e:
            logger.error(f"Failed to send direct upload notification: {e}")

    # Start direct upload/download HTTP server
    logger.info("Starting direct HTTP upload/download server...")
    start_direct_server(notify_callback=on_direct_upload)

    # Register handlers
    app.add_handler(CommandHandler(["start", "menu"], cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("chunk", cmd_chunk))
    app.add_handler(CommandHandler("download", cmd_download))
    app.add_handler(CommandHandler(["explore", "search", "history", "database"], cmd_start))

    # File uploads (.json, .gz)
    app.add_handler(MessageHandler(filters.Document.ALL, handle_document_upload))

    # Inline keyboard callbacks
    app.add_handler(CallbackQueryHandler(handle_callback_query))

    # Free text input (search terms, jump numbers, custom chunk sizes)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_user_text_input))

    logger.info("Bot started successfully. Listening for updates...")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
