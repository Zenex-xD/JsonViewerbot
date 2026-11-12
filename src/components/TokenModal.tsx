import React, { useState } from 'react';
import { X, KeyRound, Check, ExternalLink, ShieldCheck, Copy } from 'lucide-react';

interface TokenModalProps {
  isOpen: boolean;
  onClose: () => void;
  botToken: string;
  onSaveToken: (token: string) => void;
}

export const TokenModal: React.FC<TokenModalProps> = ({
  isOpen,
  onClose,
  botToken,
  onSaveToken,
}) => {
  const [tokenInput, setTokenInput] = useState(botToken);
  const [saved, setSaved] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveToken(tokenInput.trim());
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="bg-[#17212b] border border-[#242f3d] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#242f3d] flex items-center justify-between bg-[#0e1621]/60">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">
              Telegram Bot Token Setup
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#708499] hover:text-white hover:bg-[#242f3d] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="p-3.5 rounded-xl bg-[#0e1621] border border-[#242f3d] text-xs text-[#cbd5e1] space-y-2">
            <div className="font-semibold text-white flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#38bdf8]" />
              How to obtain a free Telegram Bot Token:
            </div>
            <ol className="list-decimal list-inside space-y-1 text-[#94a3b8] leading-relaxed">
              <li>
                Open Telegram and search for{' '}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#38bdf8] underline"
                >
                  @BotFather
                </a>
              </li>
              <li>Send the command <code className="text-[#38bdf8]">/newbot</code></li>
              <li>Follow prompts to choose a Name and Username (e.g. <code className="text-[#38bdf8]">MyJsonExplorerBot</code>)</li>
              <li>BotFather will reply with your HTTP API token: <code className="text-amber-300">123456789:ABC...</code></li>
            </ol>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#cbd5e1] mb-1.5">
              TELEGRAM_BOT_TOKEN
            </label>
            <input
              type="text"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder="e.g. 7123456789:AAFsK9m0jLq7x..."
              className="w-full bg-[#0e1621] border border-[#242f3d] focus:border-[#2481cc] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-[#708499] font-mono focus:outline-none transition-colors"
            />
            <p className="text-[11px] text-[#708499] mt-1">
              Used when deploying the bot or running the live bot poller.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-xs font-medium text-[#708499] hover:bg-[#242f3d] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#2481cc] hover:bg-[#2a8de0] text-white flex items-center gap-1.5 shadow transition-all"
            >
              {saved ? (
                <>
                  <Check className="w-4 h-4 text-emerald-300" />
                  <span>Saved!</span>
                </>
              ) : (
                <span>Save Token</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
