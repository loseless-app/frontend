import React, { useRef, useState } from "react";
import { FileVideo, UploadCloud, AlertCircle } from "lucide-react";

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "Unknown size";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function LocalFilePrompt({ mediaMetadata, onSelectFile }) {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);

  const expectedName = mediaMetadata?.fileName || "Unknown video file";
  const expectedSize = formatBytes(mediaMetadata?.fileSize);

  const handleFile = (file) => {
    if (!file) return;

    // Check if filename or size differs from host's file
    const nameDiffers = mediaMetadata?.fileName && file.name !== mediaMetadata.fileName;
    const sizeDiffers = mediaMetadata?.fileSize && Math.abs(file.size - mediaMetadata.fileSize) > 1024 * 1024; // > 1MB diff

    if (nameDiffers || sizeDiffers) {
      // Prompt confirmation before mounting
      setPendingFile(file);
    } else {
      // Exact or matching file -> load directly
      onSelectFile(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  };

  const handleInputChange = (e) => {
    const file = e.target.files?.[0];
    handleFile(file);
    e.target.value = "";
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative w-full h-full min-h-[320px] bg-surface-raise/95 text-ink flex flex-col items-center justify-center p-6 border-2 border-dashed transition-all ${
        isDragging
          ? "border-accent bg-accent/10 scale-[0.99]"
          : "border-ink/20 hover:border-ink/40"
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleInputChange}
      />

      {pendingFile ? (
        // Confirmation dialog when selected file differs from host's metadata
        <div className="max-w-md w-full bg-surface border border-ink/15 p-5 shadow-2xl space-y-4 text-center">
          <div className="w-10 h-10 mx-auto rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center">
            <AlertCircle className="w-5 h-5" />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-bold text-ink">File Details Differ</h3>
            <p className="text-xs text-ink-muted">
              Your selected file doesn't perfectly match the host's file, but you can still synchronize if it is the same video.
            </p>
          </div>

          <div className="text-xs text-left bg-ink/5 p-3 rounded space-y-1 font-mono">
            <div>
              <span className="text-ink-muted">Host: </span>
              <span className="text-ink font-semibold">{expectedName}</span> ({expectedSize})
            </div>
            <div>
              <span className="text-ink-muted">Yours: </span>
              <span className="text-ink font-semibold">{pendingFile.name}</span> ({formatBytes(pendingFile.size)})
            </div>
          </div>

          <div className="flex gap-2 justify-center pt-1">
            <button
              type="button"
              onClick={() => setPendingFile(null)}
              className="px-4 py-2 text-xs font-semibold text-ink-muted hover:text-ink border border-ink/20 hover:bg-ink/5 transition-colors cursor-pointer"
            >
              Choose different file
            </button>
            <button
              type="button"
              onClick={() => {
                onSelectFile(pendingFile);
                setPendingFile(null);
              }}
              className="px-4 py-2 text-xs font-bold bg-accent hover:bg-accent-deep text-on-accent transition-colors cursor-pointer"
            >
              Sync anyway
            </button>
          </div>
        </div>
      ) : (
        // Standard prompt asking guest to select their local copy
        <div className="max-w-md w-full flex flex-col items-center text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-ink/5 border border-ink/10 flex items-center justify-center text-ink/80 shadow-sm">
            <FileVideo className="w-8 h-8 text-accent" />
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-accent/15 text-accent-deep border border-accent/25 text-[11px] font-bold uppercase tracking-wider">
              Lossless Local File Sync
            </div>

            <h3 className="text-lg font-bold text-ink tracking-tight break-all">
              {expectedName}
            </h3>

            <p className="text-xs text-ink-muted max-w-sm mx-auto leading-relaxed">
              The host loaded this file locally. To watch together in 100% bit-for-bit lossless quality, select your local copy.
            </p>

            <div className="text-xs font-medium text-ink/60">
              Expected size: <span className="text-ink font-bold">{expectedSize}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded bg-accent hover:bg-accent-deep text-on-accent text-sm font-bold shadow transition-all cursor-pointer hover:scale-105 active:scale-95"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Select Local Copy</span>
          </button>

          <p className="text-[11px] text-ink-muted/70">
            or drag & drop your video file anywhere in this box
          </p>
        </div>
      )}
    </div>
  );
}
