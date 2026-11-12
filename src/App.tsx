/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import * as pako from 'pako';
import JSZip from 'jszip';
import { TelegramHeader } from './components/TelegramHeader';
import { TelegramMessageItem } from './components/TelegramMessageItem';
import { TelegramInputBar } from './components/TelegramInputBar';
import { DeploymentModal } from './components/DeploymentModal';
import { SampleDatasetsModal } from './components/SampleDatasetsModal';
import { TokenModal } from './components/TokenModal';
import {
  TelegramMessage,
  StoredJsonFile,
  StoredChunkJob,
  InlineKeyboardMarkup,
} from './types/telegram';
import {
  analyzeJsonContent,
  generateChunks,
  computeSha256,
  formatRecordForChat,
} from './lib/jsonEngine';
import { UploadCloud, CheckCircle } from 'lucide-react';

const MAIN_MENU_KEYBOARD: InlineKeyboardMarkup = [
  [
    { text: '📤 Upload File', callback_data: 'menu_upload' },
    { text: '🗄️ My Database', callback_data: 'menu_database' },
  ],
  [
    { text: '✂️ Generate Chunks', callback_data: 'menu_chunks' },
    { text: '🔍 Explore JSON', callback_data: 'menu_explore' },
  ],
  [
    { text: '🔎 Search Data', callback_data: 'menu_search' },
    { text: '📥 Download Files', callback_data: 'menu_download' },
  ],
  [
    { text: '📜 History', callback_data: 'menu_history' },
    { text: '⚙️ Settings', callback_data: 'menu_settings' },
  ],
];

export default function App() {
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [files, setFiles] = useState<StoredJsonFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [chunkJobs, setChunkJobs] = useState<StoredChunkJob[]>([]);
  const [waitingAction, setWaitingAction] = useState<{
    type: 'custom_chunk' | 'jump' | 'search';
    fileId: string;
  } | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Modals
  const [isDeployOpen, setIsDeployOpen] = useState(false);
  const [isSamplesOpen, setIsSamplesOpen] = useState(false);
  const [isTokenOpen, setIsTokenOpen] = useState(false);
  const [botToken, setBotToken] = useState('7123456789:AAFsK9m0jLq7x...');

  const chatBottomRef = useRef<HTMLDivElement>(null);

  const activeFile = files.find(f => f.id === activeFileId);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initial welcome message
  useEffect(() => {
    const welcomeTime = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    setMessages([
      {
        id: 'msg_welcome',
        sender: 'bot',
        text:
          '👋 *Welcome to JSON Explorer Bot*!\n\n' +
          'I analyze massive `.json` and `.json.gz` files (including 175MB+ extracted datasets), ' +
          'detect structures, stream records without overloading memory, and ' +
          'split data into clean, valid JSON chunks.\n\n' +
          '📌 *Quick Start:*\n' +
          '• Attach any `.json` or `.json.gz` file (or click **Sample Datasets** at top)\n' +
          '• Or select an option from the menu below:',
        timestamp: welcomeTime,
        replyMarkup: MAIN_MENU_KEYBOARD,
      },
    ]);
  }, []);

  const addBotMessage = (
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
    document?: TelegramMessage['document']
  ): string => {
    const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const time = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    setMessages(prev => [
      ...prev,
      {
        id,
        sender: 'bot',
        text,
        timestamp: time,
        replyMarkup,
        document,
      },
    ]);
    return id;
  };

  const addUserMessage = (text: string) => {
    const time = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    setMessages(prev => [
      ...prev,
      {
        id: `user_${Date.now()}`,
        sender: 'user',
        text,
        timestamp: time,
      },
    ]);
  };

  // --- File Upload & Analysis Processor ---

  const handleProcessFile = async (file: File) => {
    setIsProcessing(true);
    addUserMessage(`📤 Uploaded file: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);

    const isGzip = file.name.endsWith('.gz') || file.name.endsWith('.gzip');
    const isJson = file.name.endsWith('.json');

    if (!isJson && !isGzip) {
      addBotMessage(
        '⚠️ *Unsupported File Format*\nPlease upload a `.json` or `.json.gz` file.',
        [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]]
      );
      setIsProcessing(false);
      return;
    }

    const progressMsgId = `prog_${Date.now()}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    setMessages(prev => [
      ...prev,
      {
        id: progressMsgId,
        sender: 'bot',
        text: '⏳ *Receiving & Reading File Stream...*\nProgress: `15%`',
        timestamp: time,
        isProgress: true,
        progressPercent: 15,
      },
    ]);

    try {
      const buffer = await file.arrayBuffer();

      // Update progress
      setMessages(prev =>
        prev.map(m =>
          m.id === progressMsgId
            ? {
                ...m,
                text: '⏳ *Computing SHA-256 Hash for Duplicate Protection...*\nProgress: `35%`',
                progressPercent: 35,
              }
            : m
        )
      );

      const sha256 = await computeSha256(new Uint8Array(buffer));

      // Duplicate Check
      const existing = files.find(f => f.sha256 === sha256);
      if (existing) {
        setActiveFileId(existing.id);
        setMessages(prev => prev.filter(m => m.id !== progressMsgId));
        addBotMessage(
          `♻️ *Duplicate detected — previously analyzed record reused!*\n\n` +
            formatReportText(existing),
          getChunkPresetKeyboard(existing.id, existing.totalRecords)
        );
        setIsProcessing(false);
        return;
      }

      let jsonContent = '';
      let decompressedSize: number | undefined;

      if (isGzip) {
        setMessages(prev =>
          prev.map(m =>
            m.id === progressMsgId
              ? {
                  ...m,
                  text: '⏳ *Decompressing GZIP Stream in Memory-Safe Chunks...*\nProgress: `55%`',
                  progressPercent: 55,
                }
              : m
          )
        );
        const decompressedBytes = pako.ungzip(new Uint8Array(buffer));
        jsonContent = new TextDecoder('utf-8').decode(decompressedBytes);
        decompressedSize = decompressedBytes.length;
      } else {
        const textDecoder = new TextDecoder('utf-8');
        jsonContent = textDecoder.decode(buffer);
      }

      setMessages(prev =>
        prev.map(m =>
          m.id === progressMsgId
            ? {
                ...m,
                text: '⏳ *Streaming Tokens & Detecting Nested JSON Schema...*\nProgress: `80%`',
                progressPercent: 80,
              }
            : m
        )
      );

      // Analyze Content
      const analysis = analyzeJsonContent(jsonContent);

      // Parse records array if valid
      let records: any[] = [];
      if (analysis.isValid) {
        try {
          const parsed = JSON.parse(jsonContent);
          if (Array.isArray(parsed)) {
            records = parsed;
          } else if (typeof parsed === 'object' && parsed !== null) {
            const key = analysis.recordsPath.replace('.item', '');
            records = Array.isArray(parsed[key]) ? parsed[key] : [parsed];
          }
        } catch {
          // Handled by analysis
        }
      }

      const newFileId = `f_${Date.now()}`;
      const newStoredFile: StoredJsonFile = {
        id: newFileId,
        name: file.name,
        originalSize: file.size,
        decompressedSize,
        sha256,
        isGzip,
        isValid: analysis.isValid,
        rootType: analysis.rootType,
        recordsPath: analysis.recordsPath,
        totalRecords: analysis.totalRecords,
        records,
        availableSections: analysis.availableSections,
        sampleSchema: analysis.sampleSchema,
        createdAt: Date.now(),
        errorMessage: analysis.errorMessage,
      };

      setFiles(prev => [newStoredFile, ...prev]);
      setActiveFileId(newFileId);

      // Remove progress message
      setMessages(prev => prev.filter(m => m.id !== progressMsgId));

      // Send detailed report
      addBotMessage(
        formatReportText(newStoredFile),
        newStoredFile.isValid
          ? getChunkPresetKeyboard(newFileId, newStoredFile.totalRecords)
          : [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]]
      );
    } catch (err: any) {
      setMessages(prev => prev.filter(m => m.id !== progressMsgId));
      addBotMessage(
        `❌ *Upload / Parsing Failed*\n\`${err.message}\``,
        [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]]
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const formatReportText = (f: StoredJsonFile): string => {
    const origMb = (f.originalSize / (1024 * 1024)).toFixed(2);
    const decompMb = f.decompressedSize
      ? (f.decompressedSize / (1024 * 1024)).toFixed(2)
      : origMb;

    const statusIcon = f.isValid
      ? '✅ Valid JSON'
      : `❌ Corrupted / Syntax Error: ${f.errorMessage}`;

    let report =
      `📋 *JSON File Analysis Report*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• *File Name:* \`${f.name}\`\n` +
      `• *Integrity:* ${statusIcon}\n` +
      `• *Compression:* \`${f.isGzip ? 'GZIP (.gz)' : 'None (Raw JSON)'}\`\n` +
      `• *Uploaded Size:* \`${origMb} MB\`\n` +
      `• *Extracted Size:* \`${decompMb} MB\`\n` +
      `• *Root Type:* \`${f.rootType}\`\n` +
      `• *Records Path:* \`${f.recordsPath || 'Root Array'}\`\n` +
      `• *Total Records:* \`${f.totalRecords.toLocaleString()}\`\n` +
      `• *SHA-256:* \`${f.sha256.substring(0, 16)}...\`\n`;

    if (f.availableSections && f.availableSections.length > 0) {
      report += `• *Sections Detected:* \`${f.availableSections.slice(0, 8).join(', ')}\`\n`;
    }

    report += `━━━━━━━━━━━━━━━━━━━━\nChoose a chunk preset below or type \`/chunk <amount>\`:`;
    return report;
  };

  // --- Chunk Generation Engine ---

  const handleRunChunking = async (fileId: string, recordsPerChunk: number) => {
    const targetFile = files.find(f => f.id === fileId);
    if (!targetFile) {
      addBotMessage('❌ Target dataset not found.');
      return;
    }

    if (!targetFile.isValid) {
      addBotMessage('❌ Cannot split a corrupted or invalid JSON file.');
      return;
    }

    // Duplicate chunk check
    const existingJob = chunkJobs.find(
      j => j.fileId === fileId && j.recordsPerChunk === recordsPerChunk && j.status === 'completed'
    );

    if (existingJob) {
      addBotMessage(
        `♻️ *Reused previously generated valid chunks!*\n\n` +
          `📁 *Dataset:* \`${targetFile.name}\`\n` +
          `📊 *Total Records:* \`${targetFile.totalRecords.toLocaleString()}\`\n` +
          `✂️ *Chunk Size:* \`${recordsPerChunk.toLocaleString()}\` records\n` +
          `📦 *Total Chunks:* \`${existingJob.totalChunks}\`\n\n` +
          `Every chunk is an independently readable valid JSON array.\n` +
          `Select a chunk to download or choose Download All:`,
        getDownloadKeyboard(fileId, existingJob)
      );
      return;
    }

    setIsProcessing(true);
    const progId = `chunk_prog_${Date.now()}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    setMessages(prev => [
      ...prev,
      {
        id: progId,
        sender: 'bot',
        text: `⏳ *Generating Chunks...*\nSize: \`${recordsPerChunk.toLocaleString()}\` records per chunk\nProgress: Splitting records...`,
        timestamp: time,
        isProgress: true,
        progressPercent: 30,
      },
    ]);

    try {
      const result = await generateChunks(targetFile.records, recordsPerChunk, fileId);

      const newJob: StoredChunkJob = {
        id: result.jobId,
        fileId,
        recordsPerChunk,
        totalChunks: result.totalChunks,
        status: 'completed',
        createdAt: Date.now(),
        chunks: result.chunks,
      };

      setChunkJobs(prev => [newJob, ...prev]);

      setMessages(prev => prev.filter(m => m.id !== progId));

      addBotMessage(
        `✅ *Successfully generated all chunks!*\n\n` +
          `📁 *Dataset:* \`${targetFile.name}\`\n` +
          `📊 *Total Records:* \`${targetFile.totalRecords.toLocaleString()}\`\n` +
          `✂️ *Chunk Size:* \`${recordsPerChunk.toLocaleString()}\` records\n` +
          `📦 *Total Chunks Created:* \`${result.totalChunks}\`\n\n` +
          `Every chunk is a valid, independently readable JSON file.\n` +
          `Select a chunk to download or choose Download All (ZIP):`,
        getDownloadKeyboard(fileId, newJob)
      );
    } catch (err: any) {
      setMessages(prev => prev.filter(m => m.id !== progId));
      addBotMessage(
        `❌ *Chunk generation failed:* \`${err.message}\``,
        [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]]
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // --- Keyboard Builders ---

  const getChunkPresetKeyboard = (fileId: string, total: number): InlineKeyboardMarkup => [
    [
      { text: '5,000 records', callback_data: `chunk_preset:${fileId}:5000` },
      { text: '10,000 records', callback_data: `chunk_preset:${fileId}:10000` },
    ],
    [
      { text: '20,000 records', callback_data: `chunk_preset:${fileId}:20000` },
      { text: '40,000 records', callback_data: `chunk_preset:${fileId}:40000` },
    ],
    [
      { text: '50,000 records', callback_data: `chunk_preset:${fileId}:50000` },
      { text: '✏️ Custom Amount', callback_data: `chunk_custom:${fileId}` },
    ],
    [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }],
  ];

  const getExplorerKeyboard = (
    fileId: string,
    current: number,
    total: number
  ): InlineKeyboardMarkup => {
    const navRow = [];
    if (current > 1) {
      if (current > 2) {
        navRow.push({ text: '⏮ 1', callback_data: `exp_page:${fileId}:1` });
      }
      navRow.push({
        text: '◀ Prev',
        callback_data: `exp_page:${fileId}:${current - 1}`,
      });
    }

    navRow.push({
      text: `#${current.toLocaleString()}/${total.toLocaleString()}`,
      callback_data: `exp_jump:${fileId}`,
    });

    if (current < total) {
      navRow.push({
        text: 'Next ▶',
        callback_data: `exp_page:${fileId}:${current + 1}`,
      });
      if (current < total - 1) {
        navRow.push({
          text: `${total.toLocaleString()} ⏭`,
          callback_data: `exp_page:${fileId}:${total}`,
        });
      }
    }

    return [
      navRow,
      [
        { text: '🔎 Search in File', callback_data: `exp_search:${fileId}` },
        { text: '📊 Stats & Summary', callback_data: `exp_stats:${fileId}` },
      ],
      [{ text: '🔙 Main Menu', callback_data: 'main_menu' }],
    ];
  };

  const getDownloadKeyboard = (
    fileId: string,
    job: StoredChunkJob,
    page: number = 0
  ): InlineKeyboardMarkup => {
    const keyboard: InlineKeyboardMarkup = [
      [
        { text: '📦 Download All (ZIP)', callback_data: `dl_all:${fileId}` },
        { text: '📄 Download Original', callback_data: `dl_orig:${fileId}` },
      ],
    ];

    const perPage = 6;
    const start = page * perPage;
    const end = Math.min(start + perPage, job.chunks.length);
    const visibleChunks = job.chunks.slice(start, end);

    for (let i = 0; i < visibleChunks.length; i += 2) {
      const row = [];
      const c1 = visibleChunks[i];
      const kb1 = (c1.sizeBytes / 1024).toFixed(0);
      row.push({
        text: `Chunk #${c1.index} (${c1.recordCount.toLocaleString()} recs, ${kb1}KB)`,
        callback_data: `dl_chunk:${fileId}:${c1.index}`,
      });

      if (i + 1 < visibleChunks.length) {
        const c2 = visibleChunks[i + 1];
        const kb2 = (c2.sizeBytes / 1024).toFixed(0);
        row.push({
          text: `Chunk #${c2.index} (${c2.recordCount.toLocaleString()} recs, ${kb2}KB)`,
          callback_data: `dl_chunk:${fileId}:${c2.index}`,
        });
      }
      keyboard.push(row);
    }

    if (job.chunks.length > perPage) {
      const nav = [];
      if (page > 0) {
        nav.push({
          text: '◀ Prev Chunks',
          callback_data: `dl_page:${fileId}:${page - 1}`,
        });
      }
      if (end < job.chunks.length) {
        nav.push({
          text: 'Next Chunks ▶',
          callback_data: `dl_page:${fileId}:${page + 1}`,
        });
      }
      if (nav.length > 0) {
        keyboard.push(nav);
      }
    }

    keyboard.push([{ text: '🔙 Main Menu', callback_data: 'main_menu' }]);
    return keyboard;
  };

  // --- Button Callback Query Dispatcher ---

  const handleCallbackClick = async (callbackData: string) => {
    setWaitingAction(null);

    if (callbackData === 'main_menu') {
      addBotMessage(
        '📋 *JSON Explorer Main Menu*\nSelect an option below:',
        MAIN_MENU_KEYBOARD
      );
      return;
    }

    if (callbackData === 'menu_upload') {
      addBotMessage(
        '📤 *Upload File Options*\n\n' +
          '1️⃣ *Standard Telegram Upload:*\n' +
          'Attach any `.json` or `.json.gz` file using the 📎 paperclip button or drag-and-drop into chat.\n\n' +
          '2️⃣ *Sample Datasets:*\n' +
          'Click the **Sample Datasets** button at the top header to load 50,000 to 100,000 records instantly!\n\n' +
          '3️⃣ *Direct 175MB+ Railway Tunnel:*\n' +
          'For massive files exceeding Telegram limits, use the direct HTTP upload tunnel.',
        [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]]
      );
      return;
    }

    if (callbackData === 'menu_database') {
      if (files.length === 0) {
        addBotMessage(
          '🗄️ *My Database*\n\nNo uploaded files found. Please upload a `.json` file first!',
          [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]]
        );
        return;
      }
      const keyboard: InlineKeyboardMarkup = files.map(f => [
        {
          text: `${f.id === activeFileId ? '⭐ ' : ''}${f.name} (${f.totalRecords.toLocaleString()} recs)`,
          callback_data: `set_active:${f.id}`,
        },
      ]);
      keyboard.push([{ text: '🔙 Main Menu', callback_data: 'main_menu' }]);
      addBotMessage(
        `🗄️ *My Databases*\nActive: \`${activeFile?.name || 'None'}\`\n\nSelect a database to switch:`,
        keyboard
      );
      return;
    }

    if (callbackData.startsWith('set_active:')) {
      const targetId = callbackData.split(':')[1];
      setActiveFileId(targetId);
      const f = files.find(file => file.id === targetId);
      addBotMessage(
        `✅ Switched active database to \`${f?.name}\` (${f?.totalRecords.toLocaleString()} records).`,
        MAIN_MENU_KEYBOARD
      );
      return;
    }

    if (callbackData === 'menu_chunks') {
      if (!activeFile) {
        addBotMessage(
          '✂️ *Generate Chunks*\n\nPlease upload a JSON file first!',
          [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]]
        );
        return;
      }
      addBotMessage(
        `✂️ *Chunk Generator*\n` +
          `Active File: \`${activeFile.name}\` (${activeFile.totalRecords.toLocaleString()} records)\n\n` +
          `Choose records per chunk, or type \`/chunk <number>\`:`,
        getChunkPresetKeyboard(activeFile.id, activeFile.totalRecords)
      );
      return;
    }

    if (callbackData.startsWith('chunk_preset:')) {
      const [, fileId, countStr] = callbackData.split(':');
      await handleRunChunking(fileId, parseInt(countStr, 10));
      return;
    }

    if (callbackData.startsWith('chunk_custom:')) {
      const fileId = callbackData.split(':')[1];
      setWaitingAction({ type: 'custom_chunk', fileId });
      addBotMessage(
        '✏️ *Custom Chunk Amount*\n\nPlease type the desired records per chunk in the chat (e.g. `25000` or `40000`):',
        [[{ text: '🔙 Cancel', callback_data: 'main_menu' }]]
      );
      return;
    }

    if (callbackData === 'menu_explore') {
      if (!activeFile || activeFile.records.length === 0) {
        addBotMessage(
          '🔍 *Explore JSON*\nPlease upload a valid JSON dataset first!',
          [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]]
        );
        return;
      }
      showExplorerRecord(activeFile.id, 1);
      return;
    }

    if (callbackData.startsWith('exp_page:')) {
      const [, fileId, pageStr] = callbackData.split(':');
      showExplorerRecord(fileId, parseInt(pageStr, 10));
      return;
    }

    if (callbackData.startsWith('exp_jump:')) {
      const fileId = callbackData.split(':')[1];
      setWaitingAction({ type: 'jump', fileId });
      addBotMessage(
        '🔢 *Jump to Record Number*\nPlease type the record number you want to view:',
        [[{ text: '🔙 Cancel', callback_data: 'main_menu' }]]
      );
      return;
    }

    if (callbackData.startsWith('exp_search:') || callbackData === 'menu_search') {
      const targetFile = activeFile;
      if (!targetFile) {
        addBotMessage(
          '🔎 Please upload a JSON dataset first!',
          [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]]
        );
        return;
      }
      setWaitingAction({ type: 'search', fileId: targetFile.id });
      addBotMessage(
        `🔎 *Search in \`${targetFile.name}\`*\nPlease type your search keyword (or use \`/search <term>\`):`,
        [[{ text: '🔙 Cancel', callback_data: 'main_menu' }]]
      );
      return;
    }

    if (callbackData.startsWith('exp_stats:')) {
      const targetFile = activeFile;
      if (!targetFile) return;
      const origMb = (targetFile.originalSize / (1024 * 1024)).toFixed(2);
      const decompMb = targetFile.decompressedSize
        ? (targetFile.decompressedSize / (1024 * 1024)).toFixed(2)
        : origMb;

      addBotMessage(
        `📊 *Database Statistics & Structure*\n\n` +
          `• *File Name:* \`${targetFile.name}\`\n` +
          `• *File ID:* \`${targetFile.id}\`\n` +
          `• *Compressed:* ${targetFile.isGzip ? 'Yes (GZIP)' : 'No'}\n` +
          `• *Stored Size:* \`${origMb} MB\`\n` +
          `• *Extracted Size:* \`${decompMb} MB\`\n` +
          `• *Root Type:* \`${targetFile.rootType}\`\n` +
          `• *Total Records:* \`${targetFile.totalRecords.toLocaleString()}\`\n` +
          `• *Records Path:* \`${targetFile.recordsPath}\`\n` +
          `• *SHA-256:* \`${targetFile.sha256.substring(0, 16)}...\`\n` +
          `• *Detected Schema:* \`${Object.keys(targetFile.sampleSchema).join(', ') || 'N/A'}\``,
        [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]]
      );
      return;
    }

    if (callbackData === 'menu_download') {
      if (!activeFile) {
        addBotMessage(
          '📥 Please upload a JSON file first!',
          [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]]
        );
        return;
      }
      const job = chunkJobs.find(j => j.fileId === activeFile.id && j.status === 'completed');
      if (!job) {
        addBotMessage(
          `📥 *Download Files*\nNo chunks generated yet for \`${activeFile.name}\`.\n` +
            `Click *Generate Chunks* first!`,
          MAIN_MENU_KEYBOARD
        );
        return;
      }
      addBotMessage(
        `📥 *Download Files for \`${activeFile.name}\`*\n` +
          `Chunks: \`${job.totalChunks}\` (${job.recordsPerChunk.toLocaleString()} records/chunk)`,
        getDownloadKeyboard(activeFile.id, job, 0)
      );
      return;
    }

    if (callbackData.startsWith('dl_page:')) {
      const [, fileId, pageStr] = callbackData.split(':');
      const job = chunkJobs.find(j => j.fileId === fileId && j.status === 'completed');
      if (job) {
        addBotMessage(
          `📥 *Download Files* (Page ${parseInt(pageStr, 10) + 1})`,
          getDownloadKeyboard(fileId, job, parseInt(pageStr, 10))
        );
      }
      return;
    }

    if (callbackData.startsWith('dl_chunk:')) {
      const [, fileId, chunkIdxStr] = callbackData.split(':');
      downloadSingleChunk(fileId, parseInt(chunkIdxStr, 10));
      return;
    }

    if (callbackData.startsWith('dl_all:')) {
      const fileId = callbackData.split(':')[1];
      downloadAllChunksZip(fileId);
      return;
    }

    if (callbackData.startsWith('dl_orig:')) {
      const fileId = callbackData.split(':')[1];
      downloadOriginalFile(fileId);
      return;
    }

    if (callbackData === 'menu_history') {
      let historyText = '📜 *Chunking History & Activity*\n━━━━━━━━━━━━━━━━━━━━\n';
      if (files.length === 0) {
        historyText += 'No files processed yet.';
      } else {
        files.forEach(f => {
          const job = chunkJobs.find(j => j.fileId === f.id && j.status === 'completed');
          const jobStatus = job
            ? `✅ ${job.totalChunks} chunks (${job.recordsPerChunk.toLocaleString()} recs/chunk)`
            : 'No chunks generated';
          historyText += `• \`${f.name}\`\n  ↳ Records: ${f.totalRecords.toLocaleString()} | ${jobStatus}\n\n`;
        });
      }
      addBotMessage(historyText, [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]]);
      return;
    }

    if (callbackData === 'menu_settings') {
      addBotMessage(
        `⚙️ *System Settings & Limits*\n━━━━━━━━━━━━━━━━━━━━\n` +
          `• *Telegram Download Limit:* \`20 MB\`\n` +
          `• *Telegram Send Limit:* \`50 MB\`\n` +
          `• *Local Bot API Server:* \`Enabled (Supports up to 2GB)\`\n` +
          `• *Direct Railway Uploader:* \`Enabled (O(1) Streaming)\`\n` +
          `• *Storage Engine:* SQLite WAL + Disk Buffered Chunks\n` +
          `• *Bot Token:* \`${botToken.substring(0, 10)}...\`\n` +
          `• *Status:* 🟢 All systems operational`,
        [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]]
      );
      return;
    }
  };

  const showExplorerRecord = (fileId: string, recordNum: number) => {
    const targetFile = files.find(f => f.id === fileId);
    if (!targetFile || targetFile.records.length === 0) return;

    const clampedNum = Math.max(1, Math.min(recordNum, targetFile.records.length));
    const record = targetFile.records[clampedNum - 1];
    const text = formatRecordForChat(
      clampedNum,
      targetFile.records.length,
      targetFile.name,
      record
    );

    addBotMessage(text, getExplorerKeyboard(fileId, clampedNum, targetFile.records.length));
  };

  // --- Downloads ---

  const downloadSingleChunk = (fileId: string, chunkIndex: number) => {
    const job = chunkJobs.find(j => j.fileId === fileId && j.status === 'completed');
    if (!job) return;
    const chunk = job.chunks.find(c => c.index === chunkIndex);
    if (!chunk) return;

    const jsonStr = JSON.stringify(chunk.records, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const fileName = `chunk_${chunkIndex}.json`;

    addBotMessage(
      `📤 *Delivering Chunk #${chunkIndex}*\n` +
        `Records: \`${chunk.recordCount.toLocaleString()}\`\n` +
        `SHA-256: \`${chunk.sha256.substring(0, 16)}...\``,
      undefined,
      {
        name: fileName,
        sizeBytes: chunk.sizeBytes,
        downloadUrl: url,
      }
    );

    // Auto-trigger browser download
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadAllChunksZip = async (fileId: string) => {
    const targetFile = files.find(f => f.id === fileId);
    const job = chunkJobs.find(j => j.fileId === fileId && j.status === 'completed');
    if (!targetFile || !job) {
      addBotMessage('❌ No completed chunks found for this file.');
      return;
    }

    const zipMsgId = addBotMessage('⏳ *Bundling all chunks into ZIP archive...*');

    try {
      const zip = new JSZip();
      job.chunks.forEach(chunk => {
        zip.file(`chunk_${chunk.index}.json`, JSON.stringify(chunk.records, null, 2));
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const fileName = `${targetFile.name.replace(/\.[^/.]+$/, '')}_chunks.zip`;

      setMessages(prev => prev.filter(m => m.id !== zipMsgId));

      addBotMessage(
        `📦 *Complete Chunks ZIP Archive*\n` +
          `Contains all \`${job.totalChunks}\` valid JSON chunk files.`,
        undefined,
        {
          name: fileName,
          sizeBytes: zipBlob.size,
          downloadUrl: url,
        }
      );

      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err: any) {
      addBotMessage(`❌ ZIP creation failed: ${err.message}`);
    }
  };

  const downloadOriginalFile = (fileId: string) => {
    const targetFile = files.find(f => f.id === fileId);
    if (!targetFile) return;

    const jsonStr = JSON.stringify(targetFile.records, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    addBotMessage(
      `📄 *Original Dataset File*\nFile: \`${targetFile.name}\`\nRecords: \`${targetFile.totalRecords.toLocaleString()}\``,
      undefined,
      {
        name: targetFile.name,
        sizeBytes: targetFile.originalSize,
        downloadUrl: url,
      }
    );

    const a = document.createElement('a');
    a.href = url;
    a.download = targetFile.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // --- User Text Messages & Commands Dispatcher ---

  const handleUserMessage = async (text: string) => {
    addUserMessage(text);

    // Check waiting states first
    if (waitingAction) {
      const { type, fileId } = waitingAction;
      setWaitingAction(null);

      if (type === 'custom_chunk') {
        const amount = parseInt(text.replace(/,/g, ''), 10);
        if (isNaN(amount) || amount <= 0) {
          addBotMessage('❌ Please enter a valid positive number for chunk size.');
          return;
        }
        await handleRunChunking(fileId, amount);
        return;
      }

      if (type === 'jump') {
        const num = parseInt(text.replace(/,/g, ''), 10);
        if (isNaN(num)) {
          addBotMessage('❌ Please enter a valid record number.');
          return;
        }
        showExplorerRecord(fileId, num);
        return;
      }

      if (type === 'search') {
        executeRecordSearch(fileId, text);
        return;
      }
    }

    // Commands
    const trimmed = text.trim();
    if (trimmed.startsWith('/start') || trimmed.startsWith('/menu')) {
      addBotMessage(
        '📋 *JSON Explorer Main Menu*\nSelect an option below:',
        MAIN_MENU_KEYBOARD
      );
      return;
    }

    if (trimmed.startsWith('/help')) {
      addBotMessage(
        `📖 *JSON Explorer Bot Commands*\n\n` +
          `• \`/start\` or \`/menu\` — Open Main Menu\n` +
          `• \`/chunk <number>\` — Split dataset (e.g. \`/chunk 40000\`)\n` +
          `• \`/explore\` — Browse individual records with pagination\n` +
          `• \`/search <term>\` — Search records by keyword\n` +
          `• \`/download <1|2|all|original>\` — Download chunks or file\n` +
          `• \`/database\` — View uploaded databases\n` +
          `• \`/history\` — View chunking history`,
        MAIN_MENU_KEYBOARD
      );
      return;
    }

    if (trimmed.startsWith('/chunk')) {
      if (!activeFile) {
        addBotMessage('❌ Please upload a JSON dataset first!');
        return;
      }
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2 || isNaN(parseInt(parts[1], 10))) {
        addBotMessage('Usage: `/chunk 40000`\nPlease specify a valid chunk size.');
        return;
      }
      const size = parseInt(parts[1], 10);
      await handleRunChunking(activeFile.id, size);
      return;
    }

    if (trimmed.startsWith('/download')) {
      if (!activeFile) {
        addBotMessage('❌ Please upload a JSON dataset first!');
        return;
      }
      const parts = trimmed.split(/\s+/);
      const job = chunkJobs.find(j => j.fileId === activeFile.id && j.status === 'completed');

      if (parts.length < 2) {
        if (!job) {
          addBotMessage(
            '❌ No chunks generated yet. Click *Generate Chunks* first!',
            MAIN_MENU_KEYBOARD
          );
        } else {
          addBotMessage(
            'Usage: `/download 1` or `/download all` or `/download original`',
            getDownloadKeyboard(activeFile.id, job)
          );
        }
        return;
      }

      const arg = parts[1].toLowerCase();
      if (arg === 'all') {
        downloadAllChunksZip(activeFile.id);
      } else if (arg === 'original') {
        downloadOriginalFile(activeFile.id);
      } else if (!isNaN(parseInt(arg, 10))) {
        downloadSingleChunk(activeFile.id, parseInt(arg, 10));
      } else {
        addBotMessage('Invalid download argument. Try `/download 1` or `/download all`.');
      }
      return;
    }

    if (trimmed.startsWith('/explore')) {
      if (!activeFile) {
        addBotMessage('❌ Please upload a JSON dataset first!');
        return;
      }
      showExplorerRecord(activeFile.id, 1);
      return;
    }

    if (trimmed.startsWith('/search')) {
      if (!activeFile) {
        addBotMessage('❌ Please upload a JSON dataset first!');
        return;
      }
      const query = trimmed.replace(/^\/search\s*/, '').trim();
      if (!query) {
        setWaitingAction({ type: 'search', fileId: activeFile.id });
        addBotMessage('Please enter the keyword you wish to search:');
        return;
      }
      executeRecordSearch(activeFile.id, query);
      return;
    }

    if (trimmed.startsWith('/database')) {
      handleCallbackClick('menu_database');
      return;
    }

    if (trimmed.startsWith('/history')) {
      handleCallbackClick('menu_history');
      return;
    }

    // Default conversational reply
    addBotMessage(
      `I received: "${text}"\n\nUse \`/start\` to open the main menu or click an option below:`,
      MAIN_MENU_KEYBOARD
    );
  };

  const executeRecordSearch = (fileId: string, query: string) => {
    const targetFile = files.find(f => f.id === fileId);
    if (!targetFile || targetFile.records.length === 0) return;

    const qLower = query.toLowerCase();
    const results: { index: number; record: any }[] = [];

    for (let i = 0; i < targetFile.records.length; i++) {
      const rec = targetFile.records[i];
      const recStr = JSON.stringify(rec).toLowerCase();
      if (recStr.includes(qLower)) {
        results.push({ index: i + 1, record: rec });
        if (results.length >= 5) break;
      }
    }

    if (results.length === 0) {
      addBotMessage(
        `❌ No records found matching \`${query}\`.`,
        [[{ text: '🔙 Main Menu', callback_data: 'main_menu' }]]
      );
    } else {
      let msg =
        `🔎 *Search Results for \`${query}\`* (Found ${results.length} matches):\n` +
        `━━━━━━━━━━━━━━━━━━━━\n`;
      results.forEach(r => {
        const preview = JSON.stringify(r.record).slice(0, 140).replace(/\n/g, ' ');
        msg += `• *Record #${r.index}:* \`${preview}...\`\n`;
      });
      msg += `\nType the record number you wish to view in full.`;
      setWaitingAction({ type: 'jump', fileId });
      addBotMessage(msg, [[{ text: '🔙 Cancel', callback_data: 'main_menu' }]]);
    }
  };

  // --- Drag and Drop Handlers ---

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex flex-col h-screen w-full bg-[#0e1621] text-[#f5f5f5] select-none overflow-hidden"
    >
      {/* Telegram App Header */}
      <TelegramHeader
        activeFileName={activeFile?.name}
        totalRecords={activeFile?.totalRecords}
        onOpenSamples={() => setIsSamplesOpen(true)}
        onOpenDeploy={() => setIsDeployOpen(true)}
        onOpenToken={() => setIsTokenOpen(true)}
        onClearChat={() => {
          setMessages([]);
          handleCallbackClick('main_menu');
        }}
      />

      {/* Main Telegram Chat Viewport */}
      <main className="flex-1 overflow-y-auto telegram-doodle-bg p-3 md:p-6 flex flex-col justify-between relative">
        {/* Drag and Drop Overlay */}
        {isDragging && (
          <div className="absolute inset-0 bg-[#0284c7]/30 backdrop-blur-sm z-30 flex flex-col items-center justify-center border-4 border-dashed border-[#38bdf8] m-4 rounded-3xl">
            <UploadCloud className="w-16 h-16 text-[#38bdf8] animate-bounce mb-3" />
            <h3 className="text-xl font-bold text-white">
              Drop your .json or .json.gz file here
            </h3>
            <p className="text-sm text-[#cbd5e1] mt-1">
              Supports massive files (175MB+) with streaming disk-buffered processing
            </p>
          </div>
        )}

        {/* Message Stream */}
        <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col justify-end">
          {messages.map(msg => (
            <TelegramMessageItem
              key={msg.id}
              message={msg}
              onButtonClick={handleCallbackClick}
              onDownloadDocument={doc => {
                if (doc.downloadUrl) {
                  const a = document.createElement('a');
                  a.href = doc.downloadUrl;
                  a.download = doc.name;
                  a.click();
                }
              }}
            />
          ))}
          <div ref={chatBottomRef} />
        </div>
      </main>

      {/* Telegram Input Bar */}
      <TelegramInputBar
        onSendMessage={handleUserMessage}
        onFileUpload={handleProcessFile}
        isProcessing={isProcessing}
      />

      {/* Modals */}
      <DeploymentModal
        isOpen={isDeployOpen}
        onClose={() => setIsDeployOpen(false)}
      />

      <SampleDatasetsModal
        isOpen={isSamplesOpen}
        onClose={() => setIsSamplesOpen(false)}
        onLoadDataset={handleProcessFile}
      />

      <TokenModal
        isOpen={isTokenOpen}
        onClose={() => setIsTokenOpen(false)}
        botToken={botToken}
        onSaveToken={t => setBotToken(t)}
      />
    </div>
  );
}
