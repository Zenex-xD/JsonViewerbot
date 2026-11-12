import React, { useState, useRef, useEffect } from 'react';
import { Paperclip, Send, Terminal, Sparkles } from 'lucide-react';

interface TelegramInputBarProps {
  onSendMessage: (text: string) => void;
  onFileUpload: (file: File) => void;
  isProcessing?: boolean;
}

const COMMAND_SUGGESTIONS = [
  { cmd: '/start', desc: 'Open main menu' },
  { cmd: '/chunk 40000', desc: 'Split active file into chunks of 40,000 records' },
  { cmd: '/chunk 10000', desc: 'Split into chunks of 10,000 records' },
  { cmd: '/explore', desc: 'Browse records in active dataset' },
  { cmd: '/search customer', desc: 'Search records matching keyword' },
  { cmd: '/download 1', desc: 'Download first chunk' },
  { cmd: '/download all', desc: 'Download all chunks as ZIP' },
  { cmd: '/download original', desc: 'Download complete original file' },
  { cmd: '/database', desc: 'View and switch active databases' },
  { cmd: '/help', desc: 'Show bot usage instructions' },
];

export const TelegramInputBar: React.FC<TelegramInputBarProps> = ({
  onSendMessage,
  onFileUpload,
  isProcessing = false,
}) => {
  const [inputText, setInputText] = useState('');
  const [showCommands, setShowCommands] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputText.startsWith('/')) {
      setShowCommands(true);
    } else {
      setShowCommands(false);
    }
  }, [inputText]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isProcessing) return;
    onSendMessage(inputText.trim());
    setInputText('');
    setShowCommands(false);
  };

  const handleSelectCommand = (cmd: string) => {
    onSendMessage(cmd);
    setInputText('');
    setShowCommands(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileUpload(e.target.files[0]);
      e.target.value = '';
    }
  };

  const filteredCommands = COMMAND_SUGGESTIONS.filter(item =>
    item.cmd.toLowerCase().startsWith(inputText.toLowerCase().trim())
  );

  return (
    <div className="relative p-3 bg-[#17212b] border-t border-[#242f3d] z-10 shrink-0">
      {/* Commands Auto-suggest Popup */}
      {showCommands && filteredCommands.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-[#17212b] border border-[#242f3d] rounded-xl shadow-2xl p-1.5 max-h-56 overflow-y-auto">
          <div className="text-[10px] font-semibold text-[#708499] uppercase tracking-wider px-2 py-1 flex items-center gap-1.5 border-b border-[#242f3d]/60 mb-1">
            <Terminal className="w-3 h-3 text-[#38bdf8]" />
            <span>Bot Commands</span>
          </div>
          {filteredCommands.map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelectCommand(item.cmd)}
              className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#242f3d] flex items-center justify-between group transition-colors"
            >
              <span className="font-mono text-xs font-semibold text-[#38bdf8]">
                {item.cmd}
              </span>
              <span className="text-xs text-[#708499] group-hover:text-[#cbd5e1] truncate max-w-[200px]">
                {item.desc}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Main Input Row */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 max-w-4xl mx-auto"
      >
        {/* Hidden file input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".json,.gz"
          className="hidden"
        />

        {/* Attachment button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
          className="p-2.5 rounded-full text-[#708499] hover:text-[#38bdf8] hover:bg-[#242f3d] transition-colors disabled:opacity-50 shrink-0"
          title="Upload .json or .json.gz file"
        >
          <Paperclip className="w-5 h-5" />
        </button>

        {/* Text input */}
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder={
              isProcessing
                ? 'Processing dataset stream...'
                : 'Write a message or type / to see commands...'
            }
            disabled={isProcessing}
            className="w-full bg-[#0e1621] text-white placeholder-[#708499] text-xs md:text-sm rounded-full py-2.5 pl-4 pr-10 border border-[#242f3d] focus:outline-none focus:border-[#2481cc] transition-colors"
          />

          <button
            type="button"
            onClick={() => setInputText('/')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#708499] hover:text-[#38bdf8] text-xs font-mono font-bold"
            title="Show commands"
          >
            /
          </button>
        </div>

        {/* Send button */}
        <button
          type="submit"
          disabled={!inputText.trim() || isProcessing}
          className="w-10 h-10 rounded-full bg-[#2481cc] hover:bg-[#2a8de0] active:scale-95 disabled:opacity-40 disabled:hover:bg-[#2481cc] text-white flex items-center justify-center transition-all shrink-0 shadow-md"
        >
          <Send className="w-4 h-4 ml-0.5" />
        </button>
      </form>
    </div>
  );
};
