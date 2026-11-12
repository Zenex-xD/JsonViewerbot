"""
Direct Web Server for handling files that exceed Telegram Bot API limitations (>20MB uploads / >50MB downloads).
Runs concurrently with the Telegram Bot.
Endpoints:
- GET  /health -> 200 OK
- GET  /upload?token=<user_token> -> Modern web upload form for 175MB+ files
- POST /api/upload -> Direct streaming file receiver
- GET  /download/chunk/<chunk_id>?token=... -> Direct chunk download
- GET  /download/all/<file_id>?token=... -> Direct ZIP download
- GET  /download/original/<file_id>?token=... -> Direct original download
"""
import os
import hmac
import hashlib
import time
import zipfile
import threading
from urllib.parse import urlparse, parse_qs
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from bot.config import (
    PORT, HOST, STORAGE_DIR, UPLOADS_DIR, CHUNKS_DIR, ZIPS_DIR,
    SECRET_KEY, DIRECT_BASE_URL
)
from bot.database import db
from bot.stream_parser import (
    compute_file_sha256, extract_gzip_if_needed, StreamingJsonAnalyzer
)

def generate_user_token(user_id: int) -> str:
    """Generates tamper-proof signature for user_id."""
    msg = f"{user_id}:{SECRET_KEY}".encode()
    return hashlib.sha256(msg).hexdigest()[:24]

def verify_user_token(user_id: int, token: str) -> bool:
    expected = generate_user_token(user_id)
    return hmac.compare_digest(expected, token)

class DirectServerHandler(BaseHTTPRequestHandler):
    # Pass telegram notification callback if configured
    telegram_notify_callback = None

    def log_message(self, format, *args):
        # Quiet logging
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok","service":"json-explorer-bot"}\n')
            return

        if path == "/upload":
            user_id = query.get("user_id", ["0"])[0]
            token = query.get("token", [""])[0]
            
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>JSON Explorer - Direct File Upload</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }}
        .card {{ background: #1e293b; border-radius: 16px; padding: 32px; max-width: 520px; width: 100%; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5); border: 1px solid #334155; }}
        h1 {{ font-size: 22px; margin-top: 0; color: #38bdf8; display: flex; align-items: center; gap: 8px; }}
        p {{ color: #94a3b8; font-size: 14px; line-height: 1.5; }}
        .dropzone {{ border: 2px dashed #0284c7; border-radius: 12px; padding: 40px 20px; text-align: center; cursor: pointer; transition: all 0.2s; background: rgba(2, 132, 199, 0.05); margin: 20px 0; }}
        .dropzone:hover {{ background: rgba(2, 132, 199, 0.12); }}
        input[type=file] {{ display: none; }}
        .btn {{ background: #0284c7; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; cursor: pointer; width: 100%; font-size: 15px; }}
        .btn:disabled {{ opacity: 0.5; cursor: not-allowed; }}
        .progress {{ display: none; margin-top: 15px; background: #334155; border-radius: 999px; height: 10px; overflow: hidden; }}
        .progress-bar {{ width: 0%; height: 100%; background: #38bdf8; transition: width 0.2s; }}
        .status {{ font-size: 13px; margin-top: 10px; text-align: center; color: #cbd5e1; }}
        .badge {{ display: inline-block; padding: 3px 8px; background: #0369a1; border-radius: 6px; font-size: 12px; color: #e0f2fe; margin-bottom: 12px; }}
    </style>
</head>
<body>
    <div class="card">
        <span class="badge">Direct-to-Railway 175MB+ Uploader</span>
        <h1>⚡ JSON Explorer Fast Upload</h1>
        <p>Telegram restricts standard bot downloads to 20MB. Use this secure direct tunnel to upload massive .json or .json.gz files up to 500MB.</p>
        <div class="dropzone" id="dz" onclick="document.getElementById('fileInput').click()">
            <div id="dropText">📁 Click or Drag & Drop your <b>.json</b> or <b>.json.gz</b> file here</div>
            <div id="fileName" style="margin-top: 8px; font-weight: bold; color: #38bdf8;"></div>
            <input type="file" id="fileInput" accept=".json,.gz">
        </div>
        <button id="uploadBtn" class="btn" disabled onclick="startUpload()">Upload & Send to Telegram</button>
        <div class="progress" id="prg"><div class="progress-bar" id="prgBar"></div></div>
        <div class="status" id="status"></div>
    </div>
    <script>
        const fileInput = document.getElementById('fileInput');
        const uploadBtn = document.getElementById('uploadBtn');
        const fileName = document.getElementById('fileName');
        const status = document.getElementById('status');
        const prg = document.getElementById('prg');
        const prgBar = document.getElementById('prgBar');

        fileInput.addEventListener('change', () => {{
            if (fileInput.files.length > 0) {{
                const f = fileInput.files[0];
                const mb = (f.size / (1024*1024)).toFixed(1);
                fileName.textContent = `${{f.name}} (${{mb}} MB)`;
                uploadBtn.disabled = false;
            }}
        }});

        function startUpload() {{
            const file = fileInput.files[0];
            if (!file) return;
            uploadBtn.disabled = true;
            prg.style.display = 'block';
            status.textContent = 'Uploading file directly to Railway storage...';

            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload?user_id={user_id}&token={token}&filename=' + encodeURIComponent(file.name));
            xhr.upload.onprogress = (e) => {{
                if (e.lengthComputable) {{
                    const pct = Math.round((e.loaded / e.total) * 100);
                    prgBar.style.width = pct + '%';
                    status.textContent = `Uploading: ${{pct}}% (${{(e.loaded/(1024*1024)).toFixed(1)}} MB of ${{(e.total/(1024*1024)).toFixed(1)}} MB)`;
                }}
            }};
            xhr.onload = () => {{
                if (xhr.status === 200) {{
                    status.innerHTML = '<span style="color:#4ade80">✅ File uploaded & analyzed successfully! Check your Telegram chat. You can close this window.</span>';
                }} else {{
                    status.innerHTML = '<span style="color:#f87171">❌ Upload failed: ' + xhr.responseText + '</span>';
                    uploadBtn.disabled = false;
                }}
            }};
            xhr.onerror = () => {{
                status.innerHTML = '<span style="color:#f87171">❌ Network error occurred.</span>';
                uploadBtn.disabled = false;
            }};
            xhr.send(file);
        }}
    </script>
</body>
</html>"""
            self.wfile.write(html.encode("utf-8"))
            return

        # Direct download routes
        if path.startswith("/download/"):
            parts = path.strip("/").split("/")
            # /download/<type>/<id>
            if len(parts) >= 3:
                dl_type = parts[1]
                target_id = parts[2]
                user_id_str = query.get("user_id", ["0"])[0]
                token = query.get("token", [""])[0]

                try:
                    user_id = int(user_id_str)
                except ValueError:
                    user_id = 0

                if user_id and not verify_user_token(user_id, token):
                    self.send_error(403, "Invalid security token")
                    return

                if dl_type == "chunk":
                    chunk = db.get_chunk(target_id, int(query.get("index", ["1"])[0]), user_id if user_id else None)
                    if not chunk or not os.path.exists(chunk["file_path"]):
                        self.send_error(404, "Chunk file not found")
                        return
                    self._serve_file(chunk["file_path"], f"chunk_{chunk['chunk_index']}.json")
                    return

                elif dl_type == "all":
                    # Generate or serve ZIP of all chunks for file_id
                    f = db.get_file(target_id, user_id if user_id else None)
                    job = db.get_latest_completed_job(target_id, user_id if user_id else None)
                    if not f or not job:
                        self.send_error(404, "No completed chunks found for this file.")
                        return

                    zip_path = ZIPS_DIR / f"{target_id}_{job['id']}_{job['records_per_chunk']}_all_chunks.zip"
                    if not zip_path.exists():
                        chunks = db.get_chunks_for_job(job["id"])
                        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                            for c in chunks:
                                if os.path.exists(c["file_path"]):
                                    zf.write(c["file_path"], arcname=f"chunk_{c['chunk_index']}.json")
                    self._serve_file(str(zip_path), f"{Path(f['original_name']).stem}_{job['records_per_chunk']}_chunks.zip")
                    return

                elif dl_type == "original":
                    f = db.get_file(target_id, user_id if user_id else None)
                    if not f or not os.path.exists(f["stored_path"]):
                        self.send_error(404, "Original file not found")
                        return
                    self._serve_file(f["stored_path"], f["original_name"])
                    return

        self.send_error(404, "Not Found")

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/upload":
            query = parse_qs(parsed.query)
            user_id = int(query.get("user_id", ["0"])[0])
            token = query.get("token", [""])[0]
            filename = query.get("filename", ["uploaded.json"])[0]

            if user_id and not verify_user_token(user_id, token):
                self.send_error(403, "Invalid upload token")
                return

            # Read stream directly to storage file
            content_length = int(self.headers.get("Content-Length", 0))
            save_path = UPLOADS_DIR / f"direct_{int(time.time())}_{filename}"

            hasher = hashlib.sha256()
            total_read = 0
            with open(save_path, "wb") as f_out:
                remaining = content_length
                while remaining > 0:
                    read_chunk = min(remaining, 1024 * 1024)
                    data = self.rfile.read(read_chunk)
                    if not data:
                        break
                    f_out.write(data)
                    hasher.update(data)
                    total_read += len(data)
                    remaining -= len(data)

            file_size = total_read
            sha256_hash = hasher.hexdigest()

            # Deduplication check
            existing = db.find_file_by_hash(user_id, sha256_hash)
            if existing:
                if os.path.exists(save_path):
                    save_path.unlink()
                file_id = existing["id"]
                db.set_active_file(user_id, file_id)
            else:
                is_gzip = filename.endswith(".gz") or filename.endswith(".gzip")
                file_id = db.register_file(
                    user_id=user_id,
                    original_name=filename,
                    stored_path=str(save_path),
                    file_size=file_size,
                    sha256_hash=sha256_hash,
                    is_gzip=is_gzip
                )

                # Decompress if needed
                effective_path, was_gzip, decomp_size = extract_gzip_if_needed(str(save_path), str(UPLOADS_DIR))
                
                # Analyze structure
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
                    structure_summary=", ".join(analysis["available_sections"]),
                    error_message=analysis["error_message"]
                )

            # Trigger Telegram chat notification if callback is registered
            if DirectServerHandler.telegram_notify_callback:
                DirectServerHandler.telegram_notify_callback(user_id, file_id)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok","message":"File uploaded and registered"}\n')
            return

        self.send_error(404, "Not Found")

    def _serve_file(self, file_path: str, download_name: str):
        size = os.path.getsize(file_path)
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
        self.send_header("Content-Length", str(size))
        self.end_headers()

        with open(file_path, "rb") as f:
            while chunk := f.read(1024 * 1024):
                self.wfile.write(chunk)


def start_direct_server(notify_callback=None):
    DirectServerHandler.telegram_notify_callback = notify_callback
    server = HTTPServer((HOST, PORT), DirectServerHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server
