import React, { useState } from 'react';
import JSZip from 'jszip';
import {
  X,
  Download,
  FileCode,
  CheckCircle,
  Copy,
  ExternalLink,
  Layers,
  Terminal,
} from 'lucide-react';

interface DeploymentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const FILE_SNIPPETS: Record<string, string> = {
  'Dockerfile': `# Production Dockerfile for JSON Explorer Telegram Bot
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \\
    PYTHONUNBUFFERED=1 \\
    STORAGE_DIR=/data \\
    PORT=8080

RUN apt-get update && apt-get install -y --no-install-recommends \\
    gcc libyajl-dev curl \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY bot/ /app/bot/
RUN mkdir -p /data/uploads /data/chunks /data/zips

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8080/health || exit 1
CMD ["python", "-m", "bot.main"]`,

  'railway.json': `{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10,
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100
  }
}`,

  'requirements.txt': `python-telegram-bot[all]>=21.0
ijson>=3.3.0
python-dotenv>=1.0.1
aiohttp>=3.9.5`,

  '.env.example': `# Telegram Bot Token from @BotFather
TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"

# Persistent storage mount path (/data on Railway)
STORAGE_DIR="/data"
PORT="8080"
SECRET_KEY="your-random-secret-key"
LOCAL_BOT_API_URL=""`,

  'bot/main.py': `from bot.config import TELEGRAM_BOT_TOKEN
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, CallbackQueryHandler, filters
from bot.handlers import cmd_start, cmd_help, cmd_chunk, cmd_download, handle_document_upload, handle_callback_query
from bot.direct_server import start_direct_server

def main():
    start_direct_server()
    app = ApplicationBuilder().token(TELEGRAM_BOT_TOKEN).build()
    app.add_handler(CommandHandler(["start", "menu"], cmd_start))
    app.add_handler(CommandHandler("chunk", cmd_chunk))
    app.add_handler(CommandHandler("download", cmd_download))
    app.add_handler(MessageHandler(filters.Document.ALL, handle_document_upload))
    app.add_handler(CallbackQueryHandler(handle_callback_query))
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()`
};

export const DeploymentModal: React.FC<DeploymentModalProps> = ({ isOpen, onClose }) => {
  const [selectedFile, setSelectedFile] = useState<string>('Dockerfile');
  const [isZipping, setIsZipping] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleDownloadZip = async () => {
    setIsZipping(true);
    try {
      const zip = new JSZip();

      // Add project files
      zip.file('Dockerfile', FILE_SNIPPETS['Dockerfile']);
      zip.file('railway.json', FILE_SNIPPETS['railway.json']);
      zip.file('requirements.txt', FILE_SNIPPETS['requirements.txt']);
      zip.file('.env.example', FILE_SNIPPETS['.env.example']);
      zip.file(
        'README.md',
        `# JSON Explorer Telegram Bot\nDeploy to Railway with Persistent Volume (/data).\nRefer to full documentation.`
      );

      // Create bot folder
      const botFolder = zip.folder('bot');
      if (botFolder) {
        botFolder.file('__init__.py', '"""JSON Explorer Bot"""\n__version__ = "1.0.0"\n');
        botFolder.file('main.py', FILE_SNIPPETS['bot/main.py']);
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'json-explorer-telegram-bot.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to create ZIP package', err);
    } finally {
      setIsZipping(false);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(FILE_SNIPPETS[selectedFile] || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="bg-[#17212b] border border-[#242f3d] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#242f3d] flex items-center justify-between bg-[#0e1621]/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0284c7]/20 border border-[#0284c7]/40 flex items-center justify-center text-[#38bdf8]">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Railway Deployment Package & Source Code
              </h2>
              <p className="text-xs text-[#708499]">
                Production Python 3.12 codebase, Dockerfile, and Persistent Volume setup
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#708499] hover:text-white hover:bg-[#242f3d] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Quick Action Banner */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-[#0369a1]/20 via-[#0284c7]/15 to-transparent border border-[#0284c7]/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-white text-sm">
                Ready to deploy on Railway in under 2 minutes
              </h3>
              <p className="text-xs text-[#cbd5e1] mt-0.5">
                Download the complete standalone package or link directly to your GitHub repository.
              </p>
            </div>
            <button
              onClick={handleDownloadZip}
              disabled={isZipping}
              className="px-4 py-2 rounded-lg bg-[#0284c7] hover:bg-[#0369a1] active:scale-95 text-white text-xs font-semibold flex items-center gap-2 shadow transition-all shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>{isZipping ? 'Generating ZIP...' : 'Download Project ZIP'}</span>
            </button>
          </div>

          {/* 3 Step Guide */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-[#0e1621] border border-[#242f3d]">
              <div className="text-[#38bdf8] font-bold text-xs mb-1">Step 1: Railway Project</div>
              <p className="text-xs text-[#94a3b8]">
                Create new service on <a href="https://railway.app" target="_blank" rel="noreferrer" className="text-[#38bdf8] underline">railway.app</a> from this code or Dockerfile.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-[#0e1621] border border-[#242f3d]">
              <div className="text-[#38bdf8] font-bold text-xs mb-1">Step 2: Add Volume (/data)</div>
              <p className="text-xs text-[#94a3b8]">
                In Railway Volumes tab, click <strong>Add Volume</strong> with mount path <code className="text-[#38bdf8]">/data</code>.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-[#0e1621] border border-[#242f3d]">
              <div className="text-[#38bdf8] font-bold text-xs mb-1">Step 3: Environment Variables</div>
              <p className="text-xs text-[#94a3b8]">
                Add <code className="text-[#38bdf8]">TELEGRAM_BOT_TOKEN</code> and <code className="text-[#38bdf8]">STORAGE_DIR=/data</code>.
              </p>
            </div>
          </div>

          {/* File Viewer */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {Object.keys(FILE_SNIPPETS).map(fileName => (
                  <button
                    key={fileName}
                    onClick={() => setSelectedFile(fileName)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors ${
                      selectedFile === fileName
                        ? 'bg-[#2481cc] text-white shadow-sm'
                        : 'bg-[#242f3d] text-[#708499] hover:text-[#f5f5f5]'
                    }`}
                  >
                    {fileName}
                  </button>
                ))}
              </div>

              <button
                onClick={handleCopyCode}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#242f3d] hover:bg-[#2b3a4a] text-xs text-[#cbd5e1] font-medium transition-colors shrink-0"
              >
                {copied ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy File</span>
                  </>
                )}
              </button>
            </div>

            <div className="rounded-xl bg-[#0e1621] border border-[#242f3d] p-4 font-mono text-xs text-[#cbd5e1] overflow-x-auto max-h-72">
              <pre>{FILE_SNIPPETS[selectedFile]}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
