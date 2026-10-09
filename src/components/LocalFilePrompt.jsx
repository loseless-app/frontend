import React, { useRef, useState } from "react";
import { FileVideo, UploadCloud, AlertCircle, Download, Loader2, X, RefreshCw } from "lucide-react";

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function LocalFilePrompt({
  mediaMetadata,
  onSelectFile,
  downloadState = "idle", // 'idle' | 'requesting' | 'transferring' | 'completed' | 'error'
  downloadProgress = null,
  downloadError = null,
  onDownloadFromHost = null,
  onCancelDownload = null,
  hostUsername = "Host",
  canDownload = true,
}) {
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
      setPendingFile(file);
    } else {
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

  const isTransferring = downloadState === "requesting" || downloadState === "transferring";
  const percent = downloadProgress?.percent || 0;
  const speed = downloadProgress?.speed ? `${formatBytes(downloadProgress.speed)}/s` : "Calculating...";
  const eta = downloadProgress?.eta != null ? `${downloadProgress.eta}s remaining` : "";
  const received = formatBytes(downloadProgress?.receivedBytes || 0);
  const total = formatBytes(downloadProgress?.totalBytes || mediaMetadata?.fileSize || 0);

  return (
    <div
      onDragOver={isTransferring ? undefined : handleDragOver}
      onDragLeave={isTransferring ? undefined : handleDragLeave}
      onDrop={isTransferring ? undefined : handleDrop}
      className={`relative w-full h-full min-h-[340px] bg-surface-raise/95 text-ink flex flex-col items-center justify-center p-6 border-2 border-dashed transition-all ${
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

      {/* 1. Difference confirmation dialog */}
      {pendingFile ? (
        <div className="max-w-md w-full bg-surface border border-ink/15 p-5 shadow-2xl space-y-4 text-center rounded-xl animate-in fade-in duration-150">
          <div className="w-10 h-10 mx-auto rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center">
            <AlertCircle className="w-5 h-5" />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-bold text-ink">File Details Differ</h3>
            <p className="text-xs text-ink-muted">
              Your selected file doesn't perfectly match the room video, but you can still synchronize if it is the same video.
            </p>
          </div>

          <div className="text-xs text-left bg-ink/5 p-3 rounded-lg space-y-1 font-mono border border-ink/5">
            <div>
              <span className="text-ink-muted">Room video: </span>
              <span className="text-ink font-semibold">{expectedName}</span> ({expectedSize})
            </div>
            <div>
              <span className="text-ink-muted">Your file: </span>
              <span className="text-ink font-semibold">{pendingFile.name}</span> ({formatBytes(pendingFile.size)})
            </div>
          </div>

          <div className="flex gap-2 justify-center pt-1">
            <button
              type="button"
              onClick={() => setPendingFile(null)}
              className="px-4 py-2 text-xs font-semibold text-ink-muted hover:text-ink border border-ink/20 hover:bg-ink/5 rounded-lg transition-colors cursor-pointer"
            >
              Choose different file
            </button>
            <button
              type="button"
              onClick={() => {
                onSelectFile(pendingFile);
                setPendingFile(null);
              }}
              className="px-4 py-2 text-xs font-bold bg-accent hover:bg-accent-deep text-on-accent rounded-lg transition-colors cursor-pointer"
            >
              Sync anyway
            </button>
          </div>
        </div>
      ) : isTransferring ? (
        /* 2. Active P2P Transfer Progress Card */
        <div className="max-w-md w-full bg-surface border border-ink/15 p-6 shadow-2xl space-y-5 text-center rounded-2xl animate-in fade-in duration-150">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-accent/15 border border-accent/25 text-accent flex items-center justify-center animate-pulse">
            <Download className="w-6 h-6" />
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-accent bg-accent/10 px-2.5 py-0.5 rounded-full">
              P2P Direct File Transfer
            </span>
            <h3 className="text-base font-bold text-ink truncate max-w-sm mx-auto" title={expectedName}>
              {expectedName}
            </h3>
            <p className="text-xs text-ink-muted">
              {downloadState === "requesting" ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                  <span>Connecting to {hostUsername}...</span>
                </span>
              ) : (
                <span>Receiving from <strong className="text-ink">{hostUsername}</strong></span>
              )}
            </p>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="w-full bg-ink/10 h-2.5 rounded-full overflow-hidden p-0.5 border border-ink/5">
              <div
                className="bg-accent h-full rounded-full transition-all duration-200"
                style={{ width: `${percent}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs font-mono text-ink-muted">
              <span>{percent}% ({received} / {total})</span>
              <span>{speed}</span>
            </div>

            {eta && (
              <div className="text-[11px] text-ink-muted font-medium text-right">
                ETA: {eta}
              </div>
            )}
          </div>

          {/* Cancel button */}
          <div className="pt-1">
            <button
              type="button"
              onClick={onCancelDownload}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-red-500 hover:text-red-600 hover:bg-red-500/10 border border-red-500/20 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancel Download</span>
            </button>
          </div>
        </div>
      ) : downloadState === "error" ? (
        /* 3. Error state with retry */
        <div className="max-w-md w-full bg-surface border border-red-500/30 p-6 shadow-2xl space-y-4 text-center rounded-2xl animate-in fade-in duration-150">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>

          <div className="space-y-1">
            <h3 className="text-base font-bold text-ink">Transfer Failed</h3>
            <p className="text-xs text-red-400 font-medium max-w-xs mx-auto">
              {downloadError || "Could not complete direct file transfer."}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
            {onDownloadFromHost && (
              <button
                type="button"
                onClick={onDownloadFromHost}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-bold bg-accent hover:bg-accent-deep text-on-accent transition-colors cursor-pointer shadow-sm"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Download</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold text-ink border border-ink/20 hover:bg-ink/5 transition-colors cursor-pointer"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>Pick File Manually</span>
            </button>
          </div>
        </div>
      ) : (
        /* 4. Default State: Primary Download button + Secondary Manual Pick */
        <div className="max-w-lg w-full flex flex-col items-center text-center space-y-4 px-4">
          <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shadow-sm">
            <FileVideo className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/15 text-accent-deep border border-accent/25 text-xs font-bold uppercase tracking-wider">
              Lossless Local File Sync
            </div>

            <h3 className="text-lg sm:text-xl font-bold text-ink tracking-tight break-all">
              {expectedName}
            </h3>

            <p className="text-sm text-ink-muted font-medium max-w-md mx-auto leading-relaxed">
              This room is playing this video. You can download it directly from <strong className="text-ink">{hostUsername}</strong> via peer-to-peer or choose your local copy.
            </p>

            <div className="text-xs font-semibold text-ink-muted">
              Size: <span className="text-ink font-bold">{expectedSize}</span>
            </div>
          </div>

          <div className="w-full max-w-xs space-y-2.5 pt-2">
            {/* Primary Action: P2P Download from Host */}
            {canDownload && onDownloadFromHost && (
              <button
                type="button"
                onClick={onDownloadFromHost}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-accent hover:bg-accent-deep text-on-accent text-sm font-bold shadow-md transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              >
                <Download className="w-4 h-4" />
                <span>Download from {hostUsername}</span>
              </button>
            )}

            {/* Secondary Action: Select Local File */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                canDownload && onDownloadFromHost
                  ? "border-ink/20 text-ink-muted hover:text-ink hover:bg-ink/5"
                  : "bg-accent hover:bg-accent-deep text-on-accent text-sm font-bold shadow-md"
              }`}
            >
              <UploadCloud className="w-4 h-4" />
              <span>Choose from your device</span>
            </button>
          </div>

          <p className="text-[11px] text-ink-muted">
            or drag & drop your video file anywhere in this box
          </p>
        </div>
      )}
    </div>
  );
}
