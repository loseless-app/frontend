import React, { useState } from "react";
import { FileVideo, Download, Eye, X, Check, FolderDown, Clock, UserX } from "lucide-react";
import { formatBytes, formatRemainingMinutes } from "../utils/fileUtils.js";

/**
 * Dedicated overlay rendered exclusively when the video player is in native browser Fullscreen mode.
 * Features minimalist, non-intrusive floating dialogs and toasts for file offers, progress, and completions.
 */
export function FullscreenTransferOverlay({
  incomingOffer = null,
  onDownloadOffer = null,
  onRejectOffer = null,
  isDownloading = false,
  downloadFileName = null,
  downloadState = "idle",
  downloadProgress = null,
  onCancelDownload = null,
  showComplete = false,
  savedToFilePicker = false,
  onExportFile = null,
  onDismissComplete = null,
  uploadCompleteInfo = null,
  onDismissUploadComplete = null,
  rejectedOfferInfo = null,
  onDismissRejectedOffer = null,
}) {
  const [hasExported, setHasExported] = useState(false);

  const isTransferring =
    isDownloading &&
    (downloadState === "transferring" || downloadState === "requesting");

  const isSavedDirectly = savedToFilePicker || hasExported;

  const handleExportClick = () => {
    onExportFile?.();
    setHasExported(true);
  };

  const handleDismissComplete = () => {
    setHasExported(false);
    onDismissComplete?.();
  };

  return (
    <>
      {/* 1. Fullscreen Offer Pop-up Modal */}
      {incomingOffer && (
        <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="relative max-w-sm w-full bg-surface-raise border border-ink/20 p-5 shadow-2xl space-y-4 text-center rounded-2xl animate-in zoom-in-95 duration-150">
            <button
              type="button"
              onClick={() => onRejectOffer?.(incomingOffer)}
              className="absolute top-3.5 right-3.5 p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-10 h-10 mx-auto rounded-full bg-ink/10 flex items-center justify-center">
              <FileVideo className="w-5 h-5 text-ink" />
            </div>

            <div className="space-y-1">
              <h3 className="text-sm sm:text-base font-bold text-ink">
                <strong>{incomingOffer.senderUsername || "A room member"}</strong> offered a file
              </h3>
            </div>

            <div className="text-xs text-left bg-ink/5 p-2.5 rounded-lg space-y-1 font-mono border border-ink/10">
              <div className="truncate">
                <span className="text-ink-muted">File: </span>
                <span className="text-ink font-semibold" title={incomingOffer.fileName}>
                  {incomingOffer.fileName}
                </span>
              </div>
              <div>
                <span className="text-ink-muted">Size: </span>
                <span className="text-ink font-semibold">
                  {formatBytes(incomingOffer.fileSize)}
                </span>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => onRejectOffer?.(incomingOffer)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-ink-muted hover:text-ink border border-ink/20 hover:bg-ink/5 transition-all cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Keep watching</span>
              </button>
              <button
                type="button"
                onClick={() => onDownloadOffer?.(incomingOffer)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-ink text-surface hover:opacity-85 text-xs font-semibold shadow-md transition-opacity cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download file</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Fullscreen Floating Download Progress Toast (Top-Right) */}
      {isTransferring && !incomingOffer && !showComplete && (
        <div className="absolute top-4 right-4 z-40 max-w-xs w-full bg-surface-raise/95 backdrop-blur-md border border-ink/20 p-3 rounded-xl shadow-2xl space-y-2 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Download className="w-4 h-4 text-ink animate-pulse shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                  {downloadState === "requesting" ? "Connecting..." : "Downloading"}
                </p>
                <p className="text-xs font-semibold text-ink truncate" title={downloadFileName}>
                  {downloadFileName || "Video file"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs font-mono font-bold text-ink">
                {downloadProgress?.percent || 0}%
              </span>
              {onCancelDownload && (
                <button
                  type="button"
                  onClick={onCancelDownload}
                  className="p-1 rounded text-ink-muted hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                  title="Cancel Download"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          <div className="w-full bg-ink/10 h-1 rounded-full overflow-hidden">
            <div
              className="bg-ink h-full rounded-full transition-all duration-200"
              style={{ width: `${Math.max(2, downloadProgress?.percent || 0)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-ink-muted">
            <span>
              {downloadProgress?.speed
                ? `${formatBytes(downloadProgress.speed)}/s`
                : "Estimating..."}
            </span>
            {downloadProgress?.eta && (
              <span className="flex items-center gap-1 text-ink font-medium">
                <Clock className="w-2.5 h-2.5 text-ink-muted" />
                <span>{formatRemainingMinutes(downloadProgress.eta)}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* 3. Fullscreen Completion Modal & Storage Selector (Brave / OPFS) */}
      {showComplete && (
        <div className="absolute inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="relative max-w-sm w-full bg-surface-raise border border-ink/20 p-5 shadow-2xl space-y-4 text-center rounded-2xl animate-in zoom-in-95 duration-150">
            <button
              type="button"
              onClick={handleDismissComplete}
              className="absolute top-3.5 right-3.5 p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-10 h-10 mx-auto rounded-full bg-green-500/10 flex items-center justify-center">
              {isSavedDirectly ? (
                <Check className="w-5 h-5 text-green-500 stroke-[2.5]" />
              ) : (
                <FolderDown className="w-5 h-5 text-ink" />
              )}
            </div>

            <div className="space-y-1">
              <h3 className="text-sm sm:text-base font-bold text-ink">
                {isSavedDirectly ? "File downloaded" : "Save Downloaded File"}
              </h3>
              <p className="text-xs text-ink-muted leading-relaxed">
                {isSavedDirectly ? (
                  <span>You can choose this file from device and watch together</span>
                ) : (
                  <span>
                    Your video has finished downloading. Choose a storage path on your computer to save it.
                  </span>
                )}
              </p>
            </div>

            {downloadFileName && (
              <div className="text-xs font-mono font-semibold text-ink bg-ink/5 p-2 rounded-lg border border-ink/10 truncate">
                {downloadFileName}
              </div>
            )}

            <div className="pt-1">
              {isSavedDirectly ? (
                <button
                  type="button"
                  onClick={handleDismissComplete}
                  className="px-4 py-2 rounded-lg bg-ink text-surface hover:opacity-85 text-xs font-semibold shadow-md transition-opacity cursor-pointer"
                >
                  OK
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleExportClick}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ink text-surface hover:opacity-85 text-xs font-semibold shadow-md transition-opacity cursor-pointer"
                >
                  <FolderDown className="w-4 h-4" />
                  <span>Save File to Device</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4. Fullscreen Sender Upload Complete Toast (Top-Right) */}
      {uploadCompleteInfo && (
        <div className="absolute top-4 right-4 z-40 max-w-xs w-full bg-surface-raise/95 backdrop-blur-md border border-ink/20 p-3 rounded-xl shadow-2xl space-y-2 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Check className="w-4 h-4 text-green-500 stroke-[2.5] shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink">Transfer complete</p>
                <p className="text-[11px] text-ink-muted truncate">
                  Sent {uploadCompleteInfo.fileName} to {uploadCompleteInfo.username}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onDismissUploadComplete}
              className="px-2.5 py-1 text-xs font-semibold rounded bg-ink text-surface hover:opacity-85 transition-opacity cursor-pointer shrink-0"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* 5. Fullscreen Sender Rejection Toast (Top-Right) */}
      {rejectedOfferInfo && (
        <div className="absolute top-4 right-4 z-40 max-w-xs w-full bg-surface-raise/95 backdrop-blur-md border border-ink/20 p-3 rounded-xl shadow-2xl space-y-2 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <UserX className="w-4 h-4 text-ink-muted shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink">
                  {rejectedOfferInfo.receiverUsername} declined
                </p>
                {rejectedOfferInfo.fileName && (
                  <p className="text-[11px] font-mono text-ink-muted truncate">
                    {rejectedOfferInfo.fileName}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onDismissRejectedOffer}
              className="px-2.5 py-1 text-xs font-semibold rounded bg-ink text-surface hover:opacity-85 transition-opacity cursor-pointer shrink-0"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </>
  );
}
