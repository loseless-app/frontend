import React, { useState } from "react";
import { Check, FolderDown, UserX, ChevronDown, ChevronUp } from "lucide-react";

/**
 * Compact status notice card displayed below the username box for:
 * 1. Receiver download completion (Chrome direct & Brave OPFS export flow)
 * 2. Sender transfer completion ("Transfer complete" + OK button, with dropdown for multi-transfer)
 * 3. Sender offer rejection notification ("[User] declined" + OK button)
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
  uploadCompleteList = [],
  onDismissUploadComplete = null,

  // Sender offer rejected props
  rejectedOfferInfo = null,
  rejectedPeers = [],
  onDismissRejectedOffer = null,
}) {
  const [hasExported, setHasExported] = useState(false);
  const [isCompleteDropdownOpen, setIsCompleteDropdownOpen] = useState(false);

  // Normalize completed uploads list
  const completedList =
    Array.isArray(uploadCompleteList) && uploadCompleteList.length > 0
      ? uploadCompleteList
      : uploadCompleteInfo
      ? [uploadCompleteInfo]
      : [];

  const handleDismissAllSenderNotices = () => {
    onDismissUploadComplete?.();
    onDismissRejectedOffer?.();
  };

  // 1. Sender: Outgoing upload to peer completed
  if (completedList.length > 0) {
    const isMultiComplete = completedList.length > 1 || (rejectedPeers && rejectedPeers.length > 0);

    if (isMultiComplete) {
      const totalSummaryCount = completedList.length + (rejectedPeers?.length || 0);

      return (
        <div className="p-2.5 rounded-lg bg-ink/5 border border-ink/10 space-y-2 select-none animate-in fade-in duration-150">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-5 h-5 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                <Check className="w-3.5 h-3.5 text-green-500 stroke-[2.5]" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-semibold text-ink leading-tight block">
                  Transfers complete ({completedList.length})
                </span>
                <p className="text-[10px] text-ink-muted leading-tight truncate">
                  Sent to {completedList.map((c) => c.username).join(", ")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsCompleteDropdownOpen((prev) => !prev)}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-mono font-semibold rounded bg-ink/10 hover:bg-ink/15 text-ink transition-colors cursor-pointer select-none"
                title={isCompleteDropdownOpen ? "Hide transfer details" : `View transfer details (${totalSummaryCount})`}
              >
                <span>{totalSummaryCount}</span>
                {isCompleteDropdownOpen ? (
                  <ChevronUp className="w-3.5 h-3.5 text-ink-muted" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-ink-muted" />
                )}
              </button>

              <button
                type="button"
                onClick={handleDismissAllSenderNotices}
                className="px-2.5 py-1 text-xs font-semibold rounded bg-ink text-surface hover:opacity-85 transition-opacity cursor-pointer shadow-xs"
              >
                OK
              </button>
            </div>
          </div>

          {/* Collapsible Dropdown: list of completed transfers & rejections */}
          {isCompleteDropdownOpen && (
            <div className="pt-2 border-t border-ink/10 space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
              {completedList.map((item, index) => (
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
      );
    }

    // Single completed upload: compact single row
    const single = completedList[0];
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
              Sent <span className="font-mono text-ink font-medium">{single.fileName}</span> to{" "}
              <strong className="text-ink font-semibold">{single.username}</strong>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDismissAllSenderNotices}
          className="px-2.5 py-1 text-xs font-semibold rounded bg-ink text-surface hover:opacity-85 transition-opacity cursor-pointer shadow-xs shrink-0"
        >
          OK
        </button>
      </div>
    );
  }

  // 2. Sender: Peer declined the video offer
  if (rejectedOfferInfo) {
    return (
      <div className="p-2 rounded-lg bg-ink/5 border border-ink/10 flex items-center justify-between gap-2.5 select-none animate-in fade-in duration-150">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-full bg-ink/10 flex items-center justify-center shrink-0">
            <UserX className="w-3.5 h-3.5 text-ink-muted" />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-semibold text-ink leading-tight truncate block">
              {rejectedOfferInfo.receiverUsername}{" "}
              {rejectedOfferInfo.isCancelled ? "cancelled the transfer" : "declined"}
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
          onClick={handleDismissAllSenderNotices}
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
