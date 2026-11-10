import React, { useRef } from "react";
import { UploadCloud } from "lucide-react";

/**
 * Top bar button dedicated to sharing files with room members via P2P.
 * Features clean SVG upload icon and explicit "Share File" label to
 * avoid confusion with room invite link sharing.
 */
export function ShareFileButton({
  onFilePicked,
  activeUploadsCount = 0,
  hasActiveOffer = false,
  title = "Share a local video file with room members",
}) {
  const fileInputRef = useRef(null);

  const handleInputChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (typeof onFilePicked === "function") {
      onFilePicked(file);
    }

    // Reset value so picking the same file again triggers change event
    e.target.value = "";
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mkv,.mp4,.webm,.avi,.mov,.m4v"
        className="hidden"
        onChange={handleInputChange}
      />
      <button
        type="button"
        title={title}
        aria-label="Share video file with friends"
        onClick={() => fileInputRef.current?.click()}
        className="relative bg-surface-raise hover:bg-surface border border-ink/15 text-ink text-xs sm:text-sm font-semibold px-2.5 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm select-none shrink-0"
      >
        <UploadCloud className="w-3.5 h-3.5 text-ink-muted shrink-0" />
        <span className="whitespace-nowrap">Share File</span>

        {/* Active Uploads Count Badge */}
        {activeUploadsCount > 0 && (
          <span
            title={`${activeUploadsCount} active file upload${
              activeUploadsCount > 1 ? "s" : ""
            }`}
            className="px-1.5 py-0.2 rounded-full bg-blue-500 text-white text-[10px] font-bold shrink-0 animate-pulse ml-0.5"
          >
            {activeUploadsCount}
          </span>
        )}

        {/* Pending Offer Indicator */}
        {hasActiveOffer && activeUploadsCount === 0 && (
          <span
            title="File offer active in room"
            className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 ml-0.5"
          />
        )}
      </button>
    </>
  );
}
