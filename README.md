# JSON Explorer Telegram Bot

A production-ready Python Telegram Bot built with `python-telegram-bot`, `ijson`, and SQLite. Designed to stream, analyze, explore, and split massive JSON datasets (including 175MB+ extracted `.json` and `.json.gz` files) into valid, downloadable chunks without overloading system memory.

---

## 🌟 Key Features

1. **Large-File Streaming & Analysis (175MB+)**
   - Supports raw `.json` and compressed `.json.gz` files.
   - Automatically decompresses GZIP files in disk-buffered streams.
   - Detects root structure (`array` vs `object` key paths), record counts, nested keys, and corrupted/truncated JSON.
   - Employs `ijson` and streaming token generators — never loads 175MB into RAM at once.

2. **Chunk Generator**
   - User-chosen records per chunk: `5,000`, `10,000`, `20,000`, `40,000`, `50,000`, or arbitrary custom numbers (`/chunk 40000`).
   - Generates independent, valid JSON files (`[record, record, ...]`).
   - Remainder chunks handled cleanly (e.g. 500,000 items with 40,000 size yields 12 full chunks + 1 chunk of 20,000).
   - Atomic writes (`.tmp` → `.json`) ensure crash resilience: incomplete chunks are never marked completed.

3. **Deduplication & Crash Recovery**
   - Computes streaming SHA-256 hashes for all uploaded files and generated chunks.
   - Reuses completed chunk jobs immediately when identical chunk sizes are requested.
   - SQLite WAL database tracks all files, jobs, and chunks persistently.
   - Automatically detects interrupted jobs upon restart and cleans up stale processing states.

4. **Interactive JSON Explorer & Search**
   - Browse records one by one with inline pagination (`[⏮ 1]` `[◀ Prev]` `[# Jump]` `[Next ▶]`).
   - Jump directly to any record index.
   - Stream search records across any attribute or substring.
   - Clean, syntax-highlighted Markdown code blocks with Telegram 4096-character truncation safeguards.

5. **Flexible Download System**
   - Download individual chunks (`/download 1`, `/download 2`).
   - Download all chunks in a single compressed ZIP archive (`/download all`).
   - Download the original file (`/download original`).
   - Integrated direct HTTP tunnel for files exceeding Telegram's 50MB document send limit.

6. **Telegram File Size Limit Handling**
   - Standard Telegram Bot API limits incoming downloads to 20MB.
   - This bot includes a concurrent direct-to-Railway upload server (`/upload?token=...`) allowing users to upload 175MB+ files directly from their browser or `curl`.
   - Compatible with custom Local Telegram Bot API Servers (`LOCAL_BOT_API_URL`) for direct 2GB uploads inside Telegram chat.

---

## 🚀 Railway Deployment Guide

### Step 1: Create a New Project on Railway
1. Go to [railway.app](https://railway.app) and sign in.
2. Click **New Project** → **Deploy from GitHub repo** (or push this codebase via Railway CLI).

### Step 2: Add a Persistent Volume
1. In your Railway service dashboard, click on **Volumes**.
2. Click **Add Volume**.
3. Set the Mount Path to:
   ```
   /data
   ```
4. This ensures that uploaded files, SQLite database, and generated chunks persist across container restarts and redeployments!

### Step 3: Configure Environment Variables
In the Railway service **Variables** tab, add:

| Variable Name | Value | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `123456789:ABC...` | From [@BotFather](https://t.me/BotFather) |
| `STORAGE_DIR` | `/data` | Path to Railway Persistent Volume |
| `PORT` | `8080` | Internal HTTP server port (Railway auto-routes) |
| `SECRET_KEY` | *(Random 32-char string)* | Secures direct upload/download tokens |
| `LOCAL_BOT_API_URL` | *(Optional)* | Custom Telegram Bot API Server (up to 2GB) |

Railway will automatically provision a public HTTPS domain (e.g. `your-app.up.railway.app`) and inject `RAILWAY_PUBLIC_DOMAIN`.

### Step 4: Deploy & Verify
1. Railway detects the `Dockerfile` and builds the Python 3.12 image.
2. The bot starts and registers polling with Telegram.
3. Open Telegram and send `/start` to your bot.

---

## 💻 Local Development Setup

```bash
# 1. Clone repository
git clone <repo-url>
cd json-explorer-bot

# 2. Create virtual environment
python3 -m venv venv
source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Copy .env
cp .env.example .env
# Edit .env with your TELEGRAM_BOT_TOKEN

# 5. Run the bot
python -m bot.main
```

---

## 🛠️ Direct 175MB+ File Upload via cURL

Users can also upload files directly to the Railway service:

```bash
curl -X POST "https://your-service.up.railway.app/api/upload?user_id=YOUR_TELEGRAM_USER_ID&token=YOUR_TOKEN&filename=large_dataset.json.gz" \
  --data-binary "@large_dataset.json.gz" \
  -H "Content-Type: application/octet-stream"
```

The bot will immediately analyze the file and send an interactive inline menu directly to your Telegram chat.
