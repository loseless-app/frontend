import React, { useState } from "react";
import { Download, UploadCloud, X, Clock, ChevronDown, ChevronUp, Check, UserX } from "lucide-react";
import { formatBytes, formatRemainingMinutes } from "../utils/fileUtils.js";

/**
 * Clean embedded transfer telemetry card matching RoomInfoBox theme.
 * Displays the individual progress bar of the first downloading user,
 * with a clean dropdown button showing the transfer count to reveal
 * other active transfers, completions, and rejections.
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
  completedUploads = [],
  rejectedPeers = [],
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isTransferring =
    isDownloading &&
    (downloadState === "transferring" || downloadState === "requesting");

  // Stable sort by startedAt (fallback to insertion order) so first downloading user is always index 0
  const uploadList = Object.entries(activeUploads || {}).sort(
    ([, a], [, b]) => (a.startedAt || 0) - (b.startedAt || 0)
  );
  const hasUploads = uploadList.length > 0;
  const isOffering = Boolean(offeredFile) && !hasUploads;

  const firstUploadEntry = uploadList[0];
  const firstPeerId = firstUploadEntry ? firstUploadEntry[0] : null;
  const firstUpload = firstUploadEntry ? firstUploadEntry[1] : null;
  const otherUploads = uploadList.slice(1);

  // Total transfer count across active downloads, completions, and rejections
  const totalTransfersCount =
    uploadList.length +
    (Array.isArray(completedUploads) ? completedUploads.length : 0) +
    (Array.isArray(rejectedPeers) ? rejectedPeers.length : 0);
  const hasOtherTransfers = totalTransfersCount > 1;

  if (!isTransferring && !hasUploads && !isOffering) {
    return null;
  }

  // Receiver metrics
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

  // First sender upload metrics
  const firstTotalBytes = firstUpload?.totalBytes || mediaMetadata?.fileSize || 0;
  const firstSentBytes =
    firstUpload?.sentBytes != null && firstUpload.sentBytes > 0
      ? firstUpload.sentBytes
      : firstTotalBytes > 0 && firstUpload?.percent > 0
      ? Math.round((firstUpload.percent / 100) * firstTotalBytes)
      : 0;

  const firstSentStr = formatBytes(firstSentBytes);
  const firstTotalStr = formatBytes(firstTotalBytes);
  const firstSpeed = firstUpload?.speed ? `${formatBytes(firstUpload.speed)}/s` : null;

  const firstRemainingBytes = Math.max(0, firstTotalBytes - firstSentBytes);
  const firstEtaSeconds =
    firstUpload?.eta != null
      ? firstUpload.eta
      : firstUpload?.speed > 0 && firstRemainingBytes > 0
      ? Math.round(firstRemainingBytes / firstUpload.speed)
      : null;
  const firstRemainingTime =
    formatRemainingMinutes(firstEtaSeconds) || (firstUpload?.speed > 0 ? "Estimating..." : null);

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
      {hasUploads && firstUpload && (
        <div className="p-2.5 rounded-lg bg-ink/5 border border-ink/10 space-y-2 animate-in fade-in duration-150">
          {/* Header showing first downloading user */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-5 h-5 rounded-full bg-ink/10 flex items-center justify-center shrink-0">
                <UploadCloud className="w-3 h-3 text-ink animate-pulse" />
              </div>
              <span className="truncate text-ink font-medium">
                Sending to <strong className="font-bold">{firstUpload.username}</strong>
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="font-mono font-bold text-ink">{firstUpload.percent}%</span>

              {/* Clean dropdown button showing total transfers count */}
              {hasOtherTransfers && (
                <button
                  type="button"
                  onClick={() => setIsExpanded((prev) => !prev)}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-mono font-semibold rounded bg-ink/10 hover:bg-ink/15 text-ink transition-colors cursor-pointer select-none"
                  title={isExpanded ? "Collapse transfer details" : `View transfer details (${totalTransfersCount})`}
                >
                  <span>{totalTransfersCount}</span>
                  {isExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5 text-ink-muted" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5 text-ink-muted" />
                  )}
                </button>
              )}

              {onCancelUpload && (
                <button
                  type="button"
                  onClick={() => onCancelUpload(firstPeerId)}
                  title={`Cancel upload to ${firstUpload.username}`}
                  className="p-0.5 rounded text-ink-muted hover:text-red-500 transition-colors cursor-pointer ml-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Individual progress bar of first downloader */}
          <div className="w-full bg-ink/10 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-ink h-full rounded-full transition-all duration-200"
              style={{ width: `${Math.max(2, firstUpload.percent)}%` }}
            />
          </div>

          {/* Telemetry metrics of first downloader */}
          <div className="flex items-center justify-between text-[10px] font-mono text-ink-muted">
            {firstTotalBytes > 0 ? (
              <span title={`${firstSentStr} of ${firstTotalStr}`}>
                {firstSentStr} <span className="opacity-60">/ {firstTotalStr}</span>
              </span>
            ) : (
              <span>Transferring...</span>
            )}
            <div className="flex items-center gap-2">
              {firstSpeed && <span>{firstSpeed}</span>}
              {firstRemainingTime && (
                <span className="text-ink font-semibold flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5 text-ink-muted shrink-0" />
                  <span>{firstRemainingTime}</span>
                </span>
              )}
            </div>
          </div>

          {/* Expanded dropdown: all other active transfers, completed downloads, and rejections */}
          {isExpanded && hasOtherTransfers && (
            <div className="pt-2 border-t border-ink/10 space-y-2 max-h-52 overflow-y-auto pr-0.5">
              {/* Other active transfers */}
              {otherUploads.map(([peerId, upload]) => {
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
                    className="p-2 rounded bg-ink/5 border border-ink/10 space-y-1 text-xs animate-in fade-in duration-150"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="truncate text-ink font-medium text-[11px]">
                        Sending to <strong className="font-semibold">{upload.username}</strong>
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="font-mono text-[11px] font-bold text-ink">
                          {upload.percent}%
                        </span>
                        {onCancelUpload && (
                          <button
                            type="button"
                            onClick={() => onCancelUpload(peerId)}
                            title={`Cancel upload to ${upload.username}`}
                            className="p-0.5 rounded text-ink-muted hover:text-red-500 transition-colors cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="w-full bg-ink/10 h-1 rounded-full overflow-hidden">
                      <div
                        className="bg-ink h-full rounded-full transition-all duration-200"
                        style={{ width: `${Math.max(2, upload.percent)}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[9px] font-mono text-ink-muted">
                      <span>
                        {sent} <span className="opacity-60">/ {total}</span>
                      </span>
                      <div className="flex items-center gap-1.5">
                        {uploadSpeed && <span>{uploadSpeed}</span>}
                        {remainingTime && <span>{remainingTime}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Completed downloads */}
              {Array.isArray(completedUploads) &&
                completedUploads.map((item, index) => (
                  <div
                    key={item.id || `${item.username}-${index}`}
                    className="flex items-center justify-between gap-2 p-1.5 rounded bg-ink/5 border border-ink/10 text-xs animate-in fade-in duration-150"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Check className="w-3.5 h-3.5 text-green-500 shrink-0 stroke-[2.5]" />
                      <span className="text-ink font-semibold truncate text-[11px]">
                        {item.username}
                      </span>
                      {item.fileName && (
                        <span className="text-ink-muted text-[10px] font-mono truncate">
                          ({item.fileName})
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-green-500 font-medium shrink-0">Downloaded</span>
                  </div>
                ))}

              {/* Rejected peers */}
              {Array.isArray(rejectedPeers) &&
                rejectedPeers.map((item, index) => (
                  <div
                    key={item.socketId || `${item.username}-${index}`}
                    className="flex items-center justify-between gap-2 p-1.5 rounded bg-ink/5 border border-ink/10 text-xs animate-in fade-in duration-150"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <UserX className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                      <span className="text-ink font-semibold truncate text-[11px]">
                        {item.username}
                      </span>
                      {item.fileName && (
                        <span className="text-ink-muted text-[10px] font-mono truncate">
                          ({item.fileName})
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-ink-muted font-medium shrink-0">
                      {item.isCancelled ? "Cancelled" : "Declined"}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

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
