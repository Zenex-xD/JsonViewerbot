/**
 * Core JSON Processing & Chunking Engine
 * Pure logic shared across simulator and test runner.
 */

export interface FileAnalysis {
  isValid: boolean;
  rootType: 'array' | 'object' | 'unknown';
  recordsPath: string;
  totalRecords: number;
  availableSections: string[];
  sampleSchema: Record<string, string>;
  errorMessage?: string;
}

export interface ChunkInfo {
  index: number;
  recordStart: number;
  recordEnd: number;
  recordCount: number;
  sizeBytes: number;
  sha256: string;
  records: any[];
}

export interface ChunkJobResult {
  jobId: string;
  fileId: string;
  recordsPerChunk: number;
  totalChunks: number;
  chunks: ChunkInfo[];
  reused: boolean;
}

/**
 * Computes SHA-256 of string or Uint8Array
 */
export async function computeSha256(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    const hashBuffer = await globalThis.crypto.subtle.digest(
      'SHA-256',
      bytes as unknown as BufferSource
    );
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Simple fallback hash for environments without Web Crypto
  let hash = 0;
  for (let i = 0; i < bytes.length; i++) {
    hash = (hash << 5) - hash + bytes[i];
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

/**
 * Analyzes JSON text or parsed tokens to detect structure and count records
 */
export function analyzeJsonContent(jsonText: string): FileAnalysis {
  const trimmed = jsonText.trim();
  if (!trimmed) {
    return {
      isValid: false,
      rootType: 'unknown',
      recordsPath: '',
      totalRecords: 0,
      availableSections: [],
      sampleSchema: {},
      errorMessage: 'Empty file provided.',
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err: any) {
    return {
      isValid: false,
      rootType: 'unknown',
      recordsPath: '',
      totalRecords: 0,
      availableSections: [],
      sampleSchema: {},
      errorMessage: `JSON syntax error: ${err.message}`,
    };
  }

  let records: any[] = [];
  let rootType: 'array' | 'object' = 'array';
  let recordsPath = 'item';
  let availableSections: string[] = [];

  if (Array.isArray(parsed)) {
    rootType = 'array';
    recordsPath = 'item';
    records = parsed;
  } else if (typeof parsed === 'object' && parsed !== null) {
    rootType = 'object';
    availableSections = Object.keys(parsed);
    // Find primary array property
    const arrayKeys = availableSections.filter(k => Array.isArray(parsed[k]));
    if (arrayKeys.length > 0) {
      // Prefer common collection names
      const preferred = arrayKeys.find(k =>
        /records|items|data|rows|results|users|list/i.test(k)
      ) || arrayKeys[0];
      recordsPath = `${preferred}.item`;
      records = parsed[preferred];
    } else {
      recordsPath = 'root_object';
      records = [parsed];
    }
  }

  const sampleSchema: Record<string, string> = {};
  for (let i = 0; i < Math.min(5, records.length); i++) {
    const rec = records[i];
    if (typeof rec === 'object' && rec !== null) {
      for (const [k, v] of Object.entries(rec)) {
        if (!sampleSchema[k]) {
          sampleSchema[k] = Array.isArray(v) ? 'array' : typeof v;
        }
      }
    }
  }

  return {
    isValid: true,
    rootType,
    recordsPath,
    totalRecords: records.length,
    availableSections,
    sampleSchema,
  };
}

/**
 * Splits records into clean JSON chunk arrays with remainder chunk handling
 */
export async function generateChunks(
  records: any[],
  recordsPerChunk: number,
  fileId: string
): Promise<ChunkJobResult> {
  if (recordsPerChunk <= 0) {
    throw new Error('Chunk size must be greater than zero.');
  }

  const totalRecords = records.length;
  const chunks: ChunkInfo[] = [];
  let chunkIndex = 1;
  let recordStart = 1;

  for (let i = 0; i < totalRecords; i += recordsPerChunk) {
    const slice = records.slice(i, i + recordsPerChunk);
    const chunkString = JSON.stringify(slice, null, 2);
    const sha = await computeSha256(chunkString);
    const sizeBytes = new TextEncoder().encode(chunkString).length;

    chunks.push({
      index: chunkIndex,
      recordStart: recordStart,
      recordEnd: i + slice.length,
      recordCount: slice.length,
      sizeBytes,
      sha256: sha,
      records: slice,
    });

    recordStart += slice.length;
    chunkIndex++;
  }

  return {
    jobId: `job_${Date.now()}`,
    fileId,
    recordsPerChunk,
    totalChunks: chunks.length,
    chunks,
    reused: false,
  };
}

/**
 * Formats record safely for Telegram chat blocks
 */
export function formatRecordForChat(
  recordNumber: number,
  totalRecords: number,
  fileName: string,
  record: any
): string {
  const jsonStr = JSON.stringify(record, null, 2);
  const truncated =
    jsonStr.length > 2500
      ? jsonStr.slice(0, 2400) + '\n  ... [truncated for chat view]'
      : jsonStr;

  return (
    `📄 *Record #${recordNumber.toLocaleString()}* of ${totalRecords.toLocaleString()}\n` +
    `📁 *File:* \`${fileName}\`\n\n` +
    `\`\`\`json\n${truncated}\n\`\`\``
  );
}
