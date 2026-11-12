export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type InlineKeyboardMarkup = InlineKeyboardButton[][];

export interface TelegramMessage {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  timestamp: string;
  replyMarkup?: InlineKeyboardMarkup;
  document?: {
    name: string;
    sizeBytes: number;
    mimeType?: string;
    downloadUrl?: string;
  };
  isProgress?: boolean;
  progressPercent?: number;
}

export interface StoredJsonFile {
  id: string;
  name: string;
  originalSize: number;
  decompressedSize?: number;
  sha256: string;
  isGzip: boolean;
  isValid: boolean;
  rootType: 'array' | 'object' | 'unknown';
  recordsPath: string;
  totalRecords: number;
  records: any[];
  availableSections: string[];
  sampleSchema: Record<string, string>;
  createdAt: number;
  errorMessage?: string;
}

export interface StoredChunkJob {
  id: string;
  fileId: string;
  recordsPerChunk: number;
  totalChunks: number;
  status: 'processing' | 'completed' | 'failed';
  createdAt: number;
  chunks: {
    index: number;
    recordStart: number;
    recordEnd: number;
    recordCount: number;
    sizeBytes: number;
    sha256: string;
    records: any[];
  }[];
}
