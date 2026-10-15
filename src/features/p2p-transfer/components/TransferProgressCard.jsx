import React from "react";
import { Download, UploadCloud, X, Clock } from "lucide-react";
import { formatBytes, formatRemainingMinutes } from "../utils/fileUtils.js";

/**
 * Clean embedded transfer telemetry card matching RoomInfoBox theme.
 */
export function TransferProgressCard({
  isDownloading = false,
  downloadFileName = null,
  downloadState = "idle",
  downloadProgress = null,
  onCancelDownload = null,
  activeUploads = {},
  onCancelUpload = null,
  mediaMetadata = null,
  offeredFile = null,
  onCancelOffer = null,
}) {
  const isTransferring =
    isDownloading &&
    (downloadState === "transferring" || downloadState === "requesting");

  const uploadList = Object.entries(activeUploads);
  const hasUploads = uploadList.length > 0;
  const isOffering = Boolean(offeredFile) && !hasUploads;

  if (!isTransferring && !hasUploads && !isOffering) {
    return null;
  }

  const percent = downloadProgress?.percent || 0;
  const totalDownloadBytes = downloadProgress?.totalBytes || mediaMetadata?.fileSize || 0;
  const receivedBytes =
    downloadProgress?.receivedBytes != null && downloadProgress.receivedBytes > 0
      ? downloadProgress.receivedBytes
      : totalDownloadBytes > 0 && percent > 0
      ? Math.round((percent / 100) * totalDownloadBytes)
      : 0;

  const downloadSentStr = formatBytes(receivedBytes);
  const downloadTotalStr = formatBytes(totalDownloadBytes);
  const downloadSpeed = downloadProgress?.speed ? `${formatBytes(downloadProgress.speed)}/s` : null;

  const remainingDownloadBytes = Math.max(0, totalDownloadBytes - receivedBytes);
  const etaSeconds =
    downloadProgress?.eta != null
      ? downloadProgress.eta
      : downloadProgress?.speed > 0 && remainingDownloadBytes > 0
      ? Math.round(remainingDownloadBytes / downloadProgress.speed)
      : null;
  const remainingTime =
    formatRemainingMinutes(etaSeconds) || (downloadProgress?.speed > 0 ? "Estimating..." : null);

  return (
    <div className="w-full space-y-2 select-none animate-in fade-in duration-150">
      {/* 1. Guest Receiver Background Download Progress */}
      {isTransferring && (
        <div className="p-2.5 rounded-lg bg-ink/5 border border-ink/10 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-5 h-5 rounded-full bg-ink/10 flex items-center justify-center shrink-0">
                <Download className="w-3 h-3 text-ink animate-pulse" />
              </div>
              <span className="truncate text-ink font-medium">
                Downloading <strong className="font-bold">{downloadFileName || "video"}</strong>
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-mono font-bold text-ink">{percent}%</span>
              {onCancelDownload && (
                <button
                  type="button"
                  onClick={onCancelDownload}
                  title="Cancel Download"
                  className="p-0.5 rounded text-ink-muted hover:text-red-500 transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-ink/10 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-ink h-full rounded-full transition-all duration-200"
              style={{ width: `${Math.max(2, percent)}%` }}
            />
          </div>

          {/* Metrics */}
          <div className="flex items-center justify-between text-[10px] font-mono text-ink-muted">
            {totalDownloadBytes > 0 ? (
              <span title={`${downloadSentStr} of ${downloadTotalStr}`}>
                {downloadSentStr} <span className="opacity-60">/ {downloadTotalStr}</span>
              </span>
            ) : (
              <span>{downloadSpeed || (downloadState === "requesting" ? "Connecting..." : "Transferring...")}</span>
            )}
            <div className="flex items-center gap-2">
              {totalDownloadBytes > 0 && downloadSpeed && <span>{downloadSpeed}</span>}
              {remainingTime && (
                <span className="flex items-center gap-1 text-ink font-semibold">
                  <Clock className="w-2.5 h-2.5 text-ink-muted shrink-0" />
                  <span>{remainingTime}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Host Sender Active Outgoing Uploads to Peers */}
      {uploadList.map(([peerId, upload]) => {
        const totalBytes = upload.totalBytes || mediaMetadata?.fileSize || 0;
        const sentBytes =
          upload.sentBytes != null && upload.sentBytes > 0
            ? upload.sentBytes
            : totalBytes > 0 && upload.percent > 0
            ? Math.round((upload.percent / 100) * totalBytes)
            : 0;

        const sent = formatBytes(sentBytes);
        const total = formatBytes(totalBytes);
        const uploadSpeed = upload.speed ? `${formatBytes(upload.speed)}/s` : null;

        const remainingBytes = Math.max(0, totalBytes - sentBytes);
        const etaSeconds =
          upload.eta != null
            ? upload.eta
            : upload.speed > 0 && remainingBytes > 0
            ? Math.round(remainingBytes / upload.speed)
            : null;
        const remainingTime =
          formatRemainingMinutes(etaSeconds) || (upload.speed > 0 ? "Estimating..." : null);

        return (
          <div
            key={peerId}
            className="p-2.5 rounded-lg bg-ink/5 border border-ink/10 space-y-1.5 animate-in fade-in duration-150"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-5 h-5 rounded-full bg-ink/10 flex items-center justify-center shrink-0">
                  <UploadCloud className="w-3 h-3 text-ink animate-pulse" />
                </div>
                <span className="truncate text-ink font-medium">
                  Sending to <strong className="font-bold">{upload.username}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono font-bold text-ink">{upload.percent}%</span>
                {onCancelUpload && (
                  <button
                    type="button"
                    onClick={() => onCancelUpload(peerId)}
                    title="Cancel upload to this peer"
                    className="p-0.5 rounded text-ink-muted hover:text-red-500 transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-ink/10 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-ink h-full rounded-full transition-all duration-200"
                style={{ width: `${Math.max(2, upload.percent)}%` }}
              />
            </div>

            {/* Telemetry metrics */}
            <div className="flex items-center justify-between text-[10px] font-mono text-ink-muted">
              <span title={`${sent} of ${total}`}>
                {sent} <span className="opacity-60">/ {total}</span>
              </span>
              <div className="flex items-center gap-2">
                {uploadSpeed && <span>{uploadSpeed}</span>}
                {remainingTime && (
                  <span className="text-ink font-semibold flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5 text-ink-muted shrink-0" />
                    <span>{remainingTime}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* 3. Host Active File Offer status (waiting for peer download) */}
      {isOffering && (
        <div className="p-2 rounded-lg bg-ink/5 border border-ink/10 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <UploadCloud className="w-3.5 h-3.5 text-ink-muted shrink-0" />
            <span className="text-ink truncate text-[11px]">
              Offered <strong className="font-semibold">{offeredFile.name}</strong> to room
            </span>
          </div>
          {onCancelOffer && (
            <button
              type="button"
              onClick={onCancelOffer}
              className="text-[11px] font-semibold text-ink-muted hover:text-red-500 transition-colors cursor-pointer shrink-0"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
