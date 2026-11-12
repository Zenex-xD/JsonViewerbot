import React from 'react';
import { InlineKeyboardMarkup } from '../types/telegram';

interface TelegramInlineKeyboardProps {
  keyboard: InlineKeyboardMarkup;
  onButtonClick: (callbackData: string) => void;
}

export const TelegramInlineKeyboard: React.FC<TelegramInlineKeyboardProps> = ({
  keyboard,
  onButtonClick,
}) => {
  if (!keyboard || keyboard.length === 0) return null;

  return (
    <div className="mt-2.5 flex flex-col gap-1.5 w-full">
      {keyboard.map((row, rowIndex) => (
        <div key={rowIndex} className="flex gap-1.5 w-full">
          {row.map((btn, btnIndex) => {
            if (btn.url) {
              return (
                <a
                  key={btnIndex}
                  href={btn.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center py-2 px-3 rounded-lg bg-[#242f3d]/80 hover:bg-[#2b3a4a] text-[#38bdf8] text-xs font-medium border border-[#242f3d] transition-all duration-150 active:scale-[0.98] select-none truncate"
                >
                  {btn.text} ↗
                </a>
              );
            }

            return (
              <button
                key={btnIndex}
                onClick={() => btn.callback_data && onButtonClick(btn.callback_data)}
                className="flex-1 text-center py-2 px-3 rounded-lg bg-[#242f3d] hover:bg-[#2b3a4a] text-[#f5f5f5] hover:text-white text-xs font-medium border border-[#242f3d] transition-all duration-150 active:scale-[0.98] active:bg-[#2481cc]/30 select-none truncate"
              >
                {btn.text}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};
