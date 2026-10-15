import React from "react";
import { FileVideo, Download, Eye, X } from "lucide-react";
import { formatBytes } from "../utils/fileUtils.js";

/**
 * Clean embedded card displayed in the room sidebar when a peer offers a different file during playback.
 * Matches the native RoomInfoBox styling perfectly.
 */
export function FileOfferCard({ offer, onDownload, onKeepWatching }) {
  if (!offer) return null;

  const senderName = offer.senderUsername || "A room member";
  const fileName = offer.fileName || "video.mp4";
  const fileSize = formatBytes(offer.fileSize);

  return (
    <div className="relative p-2.5 rounded-lg bg-ink/5 border border-ink/10 space-y-2 select-none animate-in fade-in duration-150">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-full bg-ink/10 flex items-center justify-center shrink-0">
            <FileVideo className="w-3 h-3 text-ink" />
          </div>
          <span className="text-xs font-medium text-ink truncate">
            <strong className="font-bold">{senderName}</strong> offered a file
          </span>
        </div>
        <button
          type="button"
          onClick={onKeepWatching}
          className="p-0.5 rounded text-ink-muted hover:text-ink transition-colors cursor-pointer shrink-0"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* File info pill */}
      <div className="text-[11px] font-mono flex items-center justify-between gap-2 bg-ink/5 px-2 py-1 rounded border border-ink/5">
        <span className="truncate text-ink font-semibold" title={fileName}>
          {fileName}
        </span>
        <span className="text-ink-muted shrink-0 text-[10px]">{fileSize}</span>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={onKeepWatching}
          className="px-2.5 py-1 text-xs font-medium rounded text-ink-muted hover:text-ink hover:bg-ink/10 transition-colors cursor-pointer"
        >
          Keep watching
        </button>
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-ink text-surface hover:opacity-85 transition-opacity cursor-pointer shadow-xs"
        >
          <Download className="w-3 h-3" />
          <span>Download</span>
        </button>
      </div>
    </div>
  );
}
