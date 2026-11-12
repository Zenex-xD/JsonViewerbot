import React, { useState } from 'react';
import { TelegramMessage } from '../types/telegram';
import { TelegramInlineKeyboard } from './TelegramInlineKeyboard';
import { FileText, Download, Check, Copy, Loader2 } from 'lucide-react';

interface TelegramMessageItemProps {
  message: TelegramMessage;
  onButtonClick: (callbackData: string) => void;
  onDownloadDocument?: (doc: NonNullable<TelegramMessage['document']>) => void;
}

export const TelegramMessageItem: React.FC<TelegramMessageItemProps> = ({
  message,
  onButtonClick,
  onDownloadDocument,
}) => {
  const isUser = message.sender === 'user';
  const [copied, setCopied] = useState(false);

  // Markdown renderer for Telegram style text
  const renderFormattedText = (raw: string) => {
    // Check for code blocks ```json ... ```
    const codeBlockRegex = /```([a-z]*)\n([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(raw)) !== null) {
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: raw.substring(lastIndex, match.index),
        });
      }
      parts.push({
        type: 'code_block',
        lang: match[1] || 'json',
        content: match[2],
      });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < raw.length) {
      parts.push({
        type: 'text',
        content: raw.substring(lastIndex),
      });
    }

    return parts.map((part, idx) => {
      if (part.type === 'code_block') {
        return (
          <div
            key={idx}
            className="my-2 rounded-lg bg-[#0e1621] border border-[#242f3d] p-3 font-mono text-[11px] md:text-xs text-[#cbd5e1] overflow-x-auto relative group"
          >
            <div className="flex justify-between items-center mb-1 text-[10px] text-[#708499] uppercase tracking-wider font-semibold border-b border-[#242f3d] pb-1">
              <span>{part.lang}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(part.content);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex items-center gap-1 hover:text-white transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" /> Copy
                  </>
                )}
              </button>
            </div>
            <pre className="whitespace-pre overflow-x-auto leading-relaxed">
              {part.content}
            </pre>
          </div>
        );
      }

      // Inline markdown: *bold*, `code`, URLs, line breaks
      const formattedLines = part.content.split('\n').map((line, lIdx) => {
        // Parse *bold* and `code`
        const tokens = line.split(/(\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
        return (
          <div key={lIdx} className={line === '' ? 'h-2' : 'min-h-[1.25rem]'}>
            {tokens.map((token, tIdx) => {
              if (token.startsWith('*') && token.endsWith('*')) {
                return (
                  <strong key={tIdx} className="font-semibold text-white">
                    {token.slice(1, -1)}
                  </strong>
                );
              }
              if (token.startsWith('`') && token.endsWith('`')) {
                return (
                  <code
                    key={tIdx}
                    className="px-1.5 py-0.5 rounded bg-[#0e1621]/80 text-[#38bdf8] font-mono text-[11px] mx-0.5"
                  >
                    {token.slice(1, -1)}
                  </code>
                );
              }
              // Markdown link [text](url)
              const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
              if (linkMatch) {
                return (
                  <a
                    key={tIdx}
                    href={linkMatch[2]}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#38bdf8] hover:underline font-medium"
                  >
                    {linkMatch[1]}
                  </a>
                );
              }
              return <span key={tIdx}>{token}</span>;
            })}
          </div>
        );
      });

      return <div key={idx}>{formattedLines}</div>;
    });
  };

  return (
    <div
      className={`flex items-end gap-2 mb-3.5 ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      {/* Bot avatar for incoming messages */}
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#0284c7] to-[#2481cc] flex items-center justify-center font-bold text-white text-xs shrink-0 select-none shadow">
          JE
        </div>
      )}

      {/* Message Bubble Container */}
      <div
        className={`max-w-[85%] md:max-w-[70%] rounded-2xl p-3 shadow-md relative text-xs md:text-sm leading-relaxed ${
          isUser
            ? 'bg-[#2b5278] text-white rounded-br-none ml-12'
            : 'bg-[#182533] text-[#e0e6ed] rounded-bl-none border border-[#242f3d]/60'
        }`}
      >
        {/* Document attachment if present */}
        {message.document && (
          <div className="mb-2.5 p-2.5 rounded-xl bg-[#0e1621]/60 border border-[#242f3d] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-9 h-9 rounded-lg bg-[#2481cc]/20 border border-[#2481cc]/30 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5 text-[#38bdf8]" />
              </div>
              <div className="overflow-hidden">
                <p className="font-semibold text-white text-xs truncate">
                  {message.document.name}
                </p>
                <p className="text-[10px] text-[#708499]">
                  {(message.document.sizeBytes / (1024 * 1024) >= 1
                    ? `${(message.document.sizeBytes / (1024 * 1024)).toFixed(2)} MB`
                    : `${(message.document.sizeBytes / 1024).toFixed(1)} KB`
                  )}
                </p>
              </div>
            </div>

            {onDownloadDocument && (
              <button
                onClick={() => onDownloadDocument(message.document!)}
                className="p-2 rounded-lg bg-[#242f3d] hover:bg-[#2481cc] text-[#38bdf8] hover:text-white transition-colors shrink-0"
                title="Download file"
              >
                <Download className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Progress bar for live streaming extraction/analysis */}
        {message.isProgress && (
          <div className="mb-2">
            <div className="flex items-center gap-2 text-xs text-[#38bdf8] font-medium mb-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Processing Stream...</span>
            </div>
            <div className="w-full bg-[#0e1621] rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-[#38bdf8] h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${message.progressPercent || 25}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* Text content */}
        <div className="break-words select-text">
          {renderFormattedText(message.text)}
        </div>

        {/* Timestamp */}
        <div
          className={`text-[10px] text-right mt-1.5 select-none ${
            isUser ? 'text-[#a2c0dc]' : 'text-[#708499]'
          }`}
        >
          {message.timestamp}
        </div>

        {/* Inline Keyboard (buttons attached to bot messages) */}
        {message.replyMarkup && (
          <TelegramInlineKeyboard
            keyboard={message.replyMarkup}
            onButtonClick={onButtonClick}
          />
        )}
      </div>
    </div>
  );
};
