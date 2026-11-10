import React from "react";
import { FileVideo, Download, X } from "lucide-react";
import { formatBytes } from "../utils/fileUtils.js";

/**
 * Clean embedded card displayed in the room sidebar when a peer shares a file.
 * Matches the native RoomInfoBox styling with high-contrast accent ring.
 */
export function FileOfferCard({ offer, onDownload, onKeepWatching }) {
  if (!offer) return null;

  const senderName = offer.senderUsername || "A peer";
  const fileName = offer.fileName || "Video file";
  const fileSize = formatBytes(offer.fileSize);

  return (
    <div className="relative p-3 rounded-xl bg-surface-raise border border-accent/40 shadow-sm space-y-2.5 select-none animate-in fade-in duration-150 ring-1 ring-accent/20">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
            <FileVideo className="w-3 h-3 text-blue-500" />
          </div>
          <span className="text-xs font-medium text-ink truncate">
            <strong className="font-bold">{senderName}</strong> shared a file
          </span>
        </div>
        <button
          type="button"
          onClick={onKeepWatching}
          className="p-0.5 rounded text-ink-muted hover:text-ink transition-colors cursor-pointer shrink-0"
          title="Dismiss offer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* File info pill */}
      <div className="text-[11px] font-mono flex items-center justify-between gap-2 bg-ink/5 px-2.5 py-1.5 rounded-lg border border-ink/5">
        <span className="truncate text-ink font-semibold" title={fileName}>
          {fileName}
        </span>
        <span className="text-ink-muted shrink-0 text-[10px] font-bold">{fileSize}</span>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={onKeepWatching}
          className="px-2.5 py-1 text-xs font-medium rounded-lg text-ink-muted hover:text-ink hover:bg-ink/10 transition-colors cursor-pointer"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg bg-accent hover:bg-accent-deep text-on-accent transition-colors cursor-pointer shadow-sm"
        >
          <Download className="w-3 h-3" />
          <span>Download</span>
        </button>
      </div>
    </div>
  );
}
