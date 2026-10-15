import React from "react";
import { FileOfferCard } from "./FileOfferCard.jsx";
import { TransferProgressCard } from "./TransferProgressCard.jsx";
import { TransferCompleteCard } from "./TransferCompleteCard.jsx";

/**
 * Unified sidebar panel for P2P file offers, live transfer progress, and completion states.
 * Embedded inside RoomInfoBox in normal mode and directly above ChatPanel in theater mode.
 */
export function SidebarTransferPanel({
  incomingOffer = null,
  onDownloadOffer = null,
  onRejectOffer = null,
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
  showComplete = false,
  savedToFilePicker = false,
  onExportFile = null,
  onDismissComplete = null,
  uploadCompleteInfo = null,
  onDismissUploadComplete = null,
  rejectedOfferInfo = null,
  onDismissRejectedOffer = null,
  standalone = false,
}) {
  const isTransferring =
    isDownloading &&
    (downloadState === "transferring" || downloadState === "requesting");
  const hasUploads = Object.keys(activeUploads || {}).length > 0;
  const isOffering = Boolean(offeredFile) && !hasUploads;

  const hasStatusNotice =
    (showComplete && !isTransferring) || Boolean(uploadCompleteInfo) || Boolean(rejectedOfferInfo);

  const hasContent =
    Boolean(incomingOffer) ||
    isTransferring ||
    hasUploads ||
    isOffering ||
    hasStatusNotice;

  if (!hasContent) {
    return null;
  }

  const containerClass = standalone
    ? "w-full bg-surface-raise border border-ink/10 shadow-md p-2.5 rounded-lg shrink-0 space-y-2 select-none"
    : "w-full space-y-2 pt-2 border-t border-ink/10 select-none";

  return (
    <div className={containerClass}>
      {/* 1. Incoming file offer from peer */}
      {incomingOffer && (
        <FileOfferCard
          offer={incomingOffer}
          onDownload={() => onDownloadOffer?.(incomingOffer)}
          onKeepWatching={() => onRejectOffer?.(incomingOffer)}
        />
      )}

      {/* 2. Active transfer telemetry (download, upload, offer) */}
      {(isTransferring || hasUploads || isOffering) && !hasStatusNotice && (
        <TransferProgressCard
          isDownloading={isDownloading}
          downloadFileName={downloadFileName}
          downloadState={downloadState}
          downloadProgress={downloadProgress}
          onCancelDownload={onCancelDownload}
          activeUploads={activeUploads}
          onCancelUpload={onCancelUpload}
          mediaMetadata={mediaMetadata}
          offeredFile={offeredFile}
          onCancelOffer={onCancelOffer}
        />
      )}

      {/* 3. Completed download / upload alert / rejection notice with OK button */}
      {hasStatusNotice && (
        <TransferCompleteCard
          isReceiverComplete={showComplete}
          fileName={downloadFileName}
          savedToFilePicker={savedToFilePicker}
          onExportFile={onExportFile}
          onDismiss={onDismissComplete}
          uploadCompleteInfo={uploadCompleteInfo}
          onDismissUploadComplete={onDismissUploadComplete}
          rejectedOfferInfo={rejectedOfferInfo}
          onDismissRejectedOffer={onDismissRejectedOffer}
        />
      )}
    </div>
  );
}
