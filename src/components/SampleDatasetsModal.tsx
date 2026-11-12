import React, { useState } from 'react';
import { X, Sparkles, Database, FileArchive, AlertTriangle, Check, Loader2 } from 'lucide-react';
import {
  generateSyntheticDataset,
  createGzipDatasetBlob,
  createCorruptedJsonBlob,
} from '../utils/sampleDataGenerator';

interface SampleDatasetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadDataset: (file: File) => void;
}

export const SampleDatasetsModal: React.FC<SampleDatasetsModalProps> = ({
  isOpen,
  onClose,
  onLoadDataset,
}) => {
  const [loadingType, setLoadingType] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectSample = async (type: '50k' | '100k' | 'gzip' | 'corrupt') => {
    setLoadingType(type);
    try {
      if (type === '50k') {
        const records = generateSyntheticDataset(50000);
        const jsonStr = JSON.stringify(records, null, 2);
        const file = new File([jsonStr], 'ecommerce_50k_orders.json', {
          type: 'application/json',
        });
        onLoadDataset(file);
      } else if (type === '100k') {
        const records = generateSyntheticDataset(100000);
        const jsonStr = JSON.stringify(records);
        const file = new File([jsonStr], 'analytics_100k_events.json', {
          type: 'application/json',
        });
        onLoadDataset(file);
      } else if (type === 'gzip') {
        const records = generateSyntheticDataset(25000);
        const { blob, fileName } = createGzipDatasetBlob(records);
        const file = new File([blob], fileName, {
          type: 'application/gzip',
        });
        onLoadDataset(file);
      } else if (type === 'corrupt') {
        const { blob, fileName } = createCorruptedJsonBlob();
        const file = new File([blob], fileName, {
          type: 'application/json',
        });
        onLoadDataset(file);
      }
      onClose();
    } catch (err) {
      console.error('Failed to generate sample dataset', err);
    } finally {
      setLoadingType(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="bg-[#17212b] border border-[#242f3d] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#242f3d] flex items-center justify-between bg-[#0e1621]/60">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h2 className="text-sm font-semibold text-white">
              Instant Sample Test Datasets
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#708499] hover:text-white hover:bg-[#242f3d] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List of samples */}
        <div className="p-5 space-y-3">
          <p className="text-xs text-[#94a3b8] mb-2">
            Select a dataset to simulate an upload directly in the Telegram Bot:
          </p>

          {/* Sample 1: 50k Records */}
          <button
            onClick={() => handleSelectSample('50k')}
            disabled={!!loadingType}
            className="w-full text-left p-3.5 rounded-xl bg-[#0e1621] hover:bg-[#242f3d] border border-[#242f3d] flex items-center justify-between group transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#0284c7]/20 flex items-center justify-center text-[#38bdf8]">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold text-white text-xs">
                  E-Commerce Orders (50,000 Records)
                </div>
                <div className="text-[11px] text-[#708499]">
                  JSON Array • Nested customers, SKUs, transactions (~15 MB)
                </div>
              </div>
            </div>
            {loadingType === '50k' ? (
              <Loader2 className="w-4 h-4 text-[#38bdf8] animate-spin" />
            ) : (
              <span className="text-xs text-[#38bdf8] font-medium group-hover:translate-x-0.5 transition-transform">
                Load ➔
              </span>
            )}
          </button>

          {/* Sample 2: 100k Records */}
          <button
            onClick={() => handleSelectSample('100k')}
            disabled={!!loadingType}
            className="w-full text-left p-3.5 rounded-xl bg-[#0e1621] hover:bg-[#242f3d] border border-[#242f3d] flex items-center justify-between group transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold text-white text-xs">
                  High-Volume Analytics (100,000 Records)
                </div>
                <div className="text-[11px] text-[#708499]">
                  Splits into 2 chunks of 40k + 20k remainder (~30 MB)
                </div>
              </div>
            </div>
            {loadingType === '100k' ? (
              <Loader2 className="w-4 h-4 text-[#38bdf8] animate-spin" />
            ) : (
              <span className="text-xs text-emerald-400 font-medium group-hover:translate-x-0.5 transition-transform">
                Load ➔
              </span>
            )}
          </button>

          {/* Sample 3: Compressed GZIP */}
          <button
            onClick={() => handleSelectSample('gzip')}
            disabled={!!loadingType}
            className="w-full text-left p-3.5 rounded-xl bg-[#0e1621] hover:bg-[#242f3d] border border-[#242f3d] flex items-center justify-between group transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400">
                <FileArchive className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold text-white text-xs">
                  GZIP Compressed Dataset (.json.gz)
                </div>
                <div className="text-[11px] text-[#708499]">
                  25,000 records compressed • Tests automatic GZIP stream decompression
                </div>
              </div>
            </div>
            {loadingType === 'gzip' ? (
              <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
            ) : (
              <span className="text-xs text-purple-400 font-medium group-hover:translate-x-0.5 transition-transform">
                Load ➔
              </span>
            )}
          </button>

          {/* Sample 4: Corrupted JSON */}
          <button
            onClick={() => handleSelectSample('corrupt')}
            disabled={!!loadingType}
            className="w-full text-left p-3.5 rounded-xl bg-[#0e1621] hover:bg-[#242f3d] border border-[#242f3d] flex items-center justify-between group transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-rose-500/20 flex items-center justify-center text-rose-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold text-white text-xs">
                  Corrupted / Malformed JSON Test
                </div>
                <div className="text-[11px] text-[#708499]">
                  Truncated syntax • Tests error detection & integrity reporting
                </div>
              </div>
            </div>
            {loadingType === 'corrupt' ? (
              <Loader2 className="w-4 h-4 text-rose-400 animate-spin" />
            ) : (
              <span className="text-xs text-rose-400 font-medium group-hover:translate-x-0.5 transition-transform">
                Test ➔
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
