import React, { useState } from "react";
import { Check, FolderDown, UserX } from "lucide-react";

/**
 * Compact status notice card displayed below the username box for:
 * 1. Receiver download completion (Chrome direct & Brave OPFS export flow)
 * 2. Sender transfer completion ("Transfer complete" + OK button)
 * 3. Sender offer rejection notification ("[User] declined the video" + OK button)
 */
export function TransferCompleteCard({
  // Receiver props
  isReceiverComplete = false,
  fileName = null,
  savedToFilePicker = false,
  onExportFile = null,
  onDismiss = null,

  // Sender upload complete props
  uploadCompleteInfo = null,
  onDismissUploadComplete = null,

  // Sender offer rejected props
  rejectedOfferInfo = null,
  onDismissRejectedOffer = null,
}) {
  const [hasExported, setHasExported] = useState(false);

  // 1. Sender: Peer declined the video offer
  if (rejectedOfferInfo) {
    return (
      <div className="p-2 rounded-lg bg-ink/5 border border-ink/10 flex items-center justify-between gap-2.5 select-none animate-in fade-in duration-150">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-full bg-ink/10 flex items-center justify-center shrink-0">
            <UserX className="w-3 h-3 text-ink-muted" />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-semibold text-ink leading-tight truncate block">
              {rejectedOfferInfo.receiverUsername} declined
            </span>
            {rejectedOfferInfo.fileName && (
              <p className="text-[10px] font-mono text-ink-muted leading-tight truncate opacity-80">
                {rejectedOfferInfo.fileName}
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onDismissRejectedOffer}
          className="px-2.5 py-1 text-xs font-semibold rounded bg-ink text-surface hover:opacity-85 transition-opacity cursor-pointer shadow-xs shrink-0"
        >
          OK
        </button>
      </div>
    );
  }

  // 2. Sender: Outgoing upload to peer completed
  if (uploadCompleteInfo) {
    return (
      <div className="p-2 rounded-lg bg-ink/5 border border-ink/10 flex items-center justify-between gap-2.5 select-none animate-in fade-in duration-150">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
            <Check className="w-3.5 h-3.5 text-green-500 stroke-[2.5]" />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-semibold text-ink leading-tight block">
              Transfer complete
            </span>
            <p className="text-[10px] text-ink-muted leading-tight truncate">
              Sent <span className="font-mono text-ink font-medium">{uploadCompleteInfo.fileName}</span> to{" "}
              <strong className="text-ink font-semibold">{uploadCompleteInfo.username}</strong>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onDismissUploadComplete}
          className="px-2.5 py-1 text-xs font-semibold rounded bg-ink text-surface hover:opacity-85 transition-opacity cursor-pointer shadow-xs shrink-0"
        >
          OK
        </button>
      </div>
    );
  }

  // 3. Receiver: Incoming download completed
  if (isReceiverComplete) {
    const isSavedDirectly = savedToFilePicker || hasExported;

    const handleExportClick = () => {
      onExportFile?.();
      setHasExported(true);
    };

    const handleOkClick = () => {
      setHasExported(false);
      onDismiss?.();
    };

    return (
      <div className="p-2 rounded-lg bg-ink/5 border border-ink/10 flex items-center justify-between gap-2.5 select-none animate-in fade-in duration-150">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
            {isSavedDirectly ? (
              <Check className="w-3.5 h-3.5 text-green-500 stroke-[2.5]" />
            ) : (
              <FolderDown className="w-3.5 h-3.5 text-ink" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-semibold text-ink leading-tight whitespace-nowrap">
                {isSavedDirectly ? "File downloaded" : "Save file"}
              </span>
              {fileName && (
                <span className="text-[10px] font-mono text-ink-muted truncate opacity-75" title={fileName}>
                  • {fileName}
                </span>
              )}
            </div>
            <p className="text-[10px] text-ink-muted leading-tight truncate">
              {isSavedDirectly
                ? "Choose file from device to watch together."
                : "Choose storage path to save it."}
            </p>
          </div>
        </div>

        <div className="shrink-0 flex items-center">
          {isSavedDirectly ? (
            <button
              type="button"
              onClick={handleOkClick}
              className="px-2.5 py-1 text-xs font-semibold rounded bg-ink text-surface hover:opacity-85 transition-opacity cursor-pointer shadow-xs"
            >
              OK
            </button>
          ) : (
            <button
              type="button"
              onClick={handleExportClick}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-ink text-surface hover:opacity-85 transition-opacity cursor-pointer shadow-xs whitespace-nowrap"
            >
              <FolderDown className="w-3 h-3" />
              <span>Save to Device</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
