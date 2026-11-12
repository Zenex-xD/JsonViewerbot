"""
Configuration settings for JSON Explorer Telegram Bot
Supports local development, Railway persistent volumes, and Local Telegram Bot API Server.
"""
import os
from pathlib import Path
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Telegram Bot Token
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()

# Railway persistent volume mount path or local storage
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", "/data" if os.path.exists("/data") else "./storage"))
STORAGE_DIR.mkdir(parents=True, exist_ok=True)

# Subdirectories for uploads, chunks, zips, and sqlite db
UPLOADS_DIR = STORAGE_DIR / "uploads"
CHUNKS_DIR = STORAGE_DIR / "chunks"
ZIPS_DIR = STORAGE_DIR / "zips"
DB_PATH = STORAGE_DIR / "json_explorer.db"

for path in [UPLOADS_DIR, CHUNKS_DIR, ZIPS_DIR]:
    path.mkdir(parents=True, exist_ok=True)

# File size limits (bytes)
# Standard Telegram Bot API limits: 20MB download, 50MB sendDocument
TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
TELEGRAM_MAX_SEND_BYTES = 50 * 1024 * 1024

# Local Telegram Bot API Server (Optional: allows up to 2GB downloads via Telegram directly)
# e.g., http://localhost:8081
LOCAL_BOT_API_URL = os.getenv("LOCAL_BOT_API_URL", "").strip()

# Direct Web Server URL for uploads/downloads exceeding Telegram limits
# In Railway: RAILWAY_PUBLIC_DOMAIN is automatically provided
RAILWAY_PUBLIC_DOMAIN = os.getenv("RAILWAY_PUBLIC_DOMAIN", "").strip() or os.getenv("RAILWAY_STATIC_URL", "").strip()
APP_URL = os.getenv("APP_URL", "").strip()

if RAILWAY_PUBLIC_DOMAIN and not APP_URL:
    domain = RAILWAY_PUBLIC_DOMAIN.replace("https://", "").replace("http://", "")
    DIRECT_BASE_URL = f"https://{domain}"
elif APP_URL:
    DIRECT_BASE_URL = APP_URL.rstrip("/")
else:
    DIRECT_BASE_URL = "http://localhost:8080"

# Direct server HTTP port
PORT = int(os.getenv("PORT", "8080"))
HOST = os.getenv("HOST", "0.0.0.0")

# Security key for direct upload token validation
SECRET_KEY = os.getenv("SECRET_KEY", "json-explorer-secret-key-salt")

# Default chunk sizes
DEFAULT_CHUNK_SIZES = [5000, 10000, 20000, 40000, 50000]
