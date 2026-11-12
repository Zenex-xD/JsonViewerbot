import React from 'react';
import {
  Sparkles,
  Download,
  KeyRound,
  Trash2,
  CheckCircle2,
  HardDrive,
  FileCode,
} from 'lucide-react';

interface TelegramHeaderProps {
  activeFileName?: string;
  totalRecords?: number;
  onOpenSamples: () => void;
  onOpenDeploy: () => void;
  onOpenToken: () => void;
  onClearChat: () => void;
}

export const TelegramHeader: React.FC<TelegramHeaderProps> = ({
  activeFileName,
  totalRecords,
  onOpenSamples,
  onOpenDeploy,
  onOpenToken,
  onClearChat,
}) => {
  return (
    <header className="h-16 bg-[#17212b] border-b border-[#242f3d] flex items-center justify-between px-4 z-20 shrink-0">
      {/* Bot Identity */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#0284c7] via-[#2481cc] to-[#38bdf8] flex items-center justify-center font-bold text-white text-lg shadow-md ring-2 ring-[#2481cc]/30">
            JE
          </div>
          <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[#17212b]"></span>
        </div>

        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="font-semibold text-white text-[15px] leading-tight">
              JSON Explorer
            </h1>
            <CheckCircle2 className="w-4 h-4 text-[#2481cc] fill-[#2481cc]/20" />
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-[#242f3d] text-[#708499]">
              bot
            </span>
          </div>
          <div className="text-xs text-[#708499] flex items-center gap-2">
            <span>@JsonExplorerBot</span>
            {activeFileName && (
              <>
                <span>•</span>
                <span className="text-[#38bdf8] font-mono truncate max-w-[140px] md:max-w-[220px]">
                  {activeFileName} ({totalRecords?.toLocaleString()} recs)
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <button
          onClick={onOpenSamples}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#242f3d] hover:bg-[#2b3a4a] text-xs font-medium text-[#f5f5f5] transition-colors"
          title="Load pre-configured sample datasets"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">Sample Datasets</span>
        </button>

        <button
          onClick={onOpenDeploy}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0284c7]/20 hover:bg-[#0284c7]/30 text-xs font-medium text-[#38bdf8] border border-[#0284c7]/40 transition-colors"
          title="Download complete Python Bot package for Railway deployment"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Railway Deployment Package</span>
          <span className="md:hidden">Deploy</span>
        </button>

        <button
          onClick={onOpenToken}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#242f3d] hover:bg-[#2b3a4a] text-xs font-medium text-[#f5f5f5] transition-colors"
          title="Telegram Bot Token & Live Setup"
        >
          <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden lg:inline">Bot Token</span>
        </button>

        <button
          onClick={onClearChat}
          className="p-1.5 rounded-lg text-[#708499] hover:text-[#f5f5f5] hover:bg-[#242f3d] transition-colors"
          title="Reset chat session"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
