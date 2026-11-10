import React, { useState, useRef } from "react";
import {
  Link2,
  Play,
  X,
  FileVideo,
  FolderOpen,
  Radio,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { MODES } from "../../constants/modes.js";
import { formatBytes } from "../../features/p2p-transfer/utils/fileUtils.js";

/**
 * Polymorphic media source input bar.
 * Clean, non-technical interface adapting to the active watch mode.
 */
export function DynamicSourceBar({
  activeMode = MODES.URL,
  currentUrl = "",
  onSelectUrl,
  loadedFile,
  loadedMetadata,
  onFileSelected,
  onClearFile,
  onStartStream,
  onOpenGuideModal,
}) {
  const [urlInput, setUrlInput] = useState(currentUrl || "");
  const fileInputRef = useRef(null);
  const streamFileInputRef = useRef(null);

  // Mode 1: URL Mode Submit
  const handleUrlSubmit = (e) => {
    e.preventDefault();
    const cleanUrl = (urlInput || "").trim();
    if (!cleanUrl) return;
    if (typeof onSelectUrl === "function") {
      onSelectUrl(cleanUrl);
    }
  };

  // Mode 2: Local File Pick
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (typeof onFileSelected === "function") {
      onFileSelected(file);
    }

    // Reset so re-selecting same file triggers change
    e.target.value = "";
  };

  // Mode 3: Stream File Pick
  const handleStreamFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (typeof onFileSelected === "function") {
      onFileSelected(file);
    }
    if (typeof onStartStream === "function") {
      onStartStream(file);
    }

    e.target.value = "";
  };

  const activeFileName = loadedFile?.name || loadedMetadata?.fileName;
  const activeFileSize = loadedFile?.size || loadedMetadata?.fileSize;

  // 1. URL Mode Bar
  if (activeMode === MODES.URL) {
    return (
      <form
        onSubmit={handleUrlSubmit}
        className="w-full bg-surface-raise border border-ink/15 shadow-sm rounded-lg py-1 px-1.5 flex items-center gap-1.5 sm:gap-2 transition-colors"
      >
        <Link2 className="w-3.5 h-3.5 text-ink-muted ml-2 shrink-0" />
        <input
          type="url"
          required
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Paste a YouTube, Vimeo, Twitch or any media link..."
          className="flex-1 min-w-0 bg-transparent py-1.5 text-xs sm:text-sm text-ink placeholder-ink-muted focus:outline-none"
        />
        {urlInput && (
          <button
            type="button"
            onClick={() => setUrlInput("")}
            aria-label="Clear link"
            title="Clear link"
            className="p-1 text-ink-muted hover:text-ink hover:bg-ink/10 rounded-full transition-colors cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="submit"
          className="bg-accent hover:bg-accent-deep text-on-accent text-xs sm:text-sm font-semibold px-3 sm:px-4 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-sm"
        >
          <Play className="w-3 h-3 fill-current ml-0.5" />
          <span>Play</span>
        </button>
      </form>
    );
  }

  // 2. Local File Mode Bar
  if (activeMode === MODES.LOCAL_FILE) {
    return (
      <div className="w-full bg-surface-raise border border-ink/15 shadow-sm rounded-lg py-1 px-1.5 flex items-center justify-between gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,.mkv,.mp4,.webm,.avi,.mov,.m4v"
          className="hidden"
          onChange={handleFileChange}
        />

        {activeFileName ? (
          // File Loaded State
          <div className="flex items-center gap-2 min-w-0 flex-1 pl-2">
            <FileVideo className="w-4 h-4 text-ink-muted shrink-0" />
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span
                className="text-xs sm:text-sm font-semibold text-ink truncate"
                title={activeFileName}
              >
                {activeFileName}
              </span>
              {activeFileSize && (
                <span className="text-[11px] text-ink-muted font-medium shrink-0">
                  ({formatBytes(activeFileSize)})
                </span>
              )}
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 shrink-0 hidden sm:inline-flex items-center gap-1">
                <CheckCircle2 className="w-2.5 h-2.5" />
                Original Quality
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="bg-surface hover:bg-ink/10 text-ink text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors cursor-pointer border border-ink/10"
              >
                Change
              </button>
              {typeof onClearFile === "function" && (
                <button
                  type="button"
                  title="Remove local file"
                  aria-label="Remove local file"
                  onClick={onClearFile}
                  className="p-1 text-ink-muted hover:text-ink hover:bg-ink/10 rounded-full transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ) : (
          // No File Loaded Yet State
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-between w-full cursor-pointer pl-2 pr-1"
          >
            <div className="flex items-center gap-2 min-w-0">
              <FileVideo className="w-4 h-4 text-ink-muted shrink-0" />
              <span className="text-xs sm:text-sm text-ink-muted truncate">
                Click or drag video file here (MKV, MP4, WebM)...
              </span>
            </div>

            <button
              type="button"
              className="bg-accent hover:bg-accent-deep text-on-accent text-xs sm:text-sm font-semibold px-3 sm:px-4 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-sm"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Select File</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // 3. Stream Local Video Mode Bar
  if (activeMode === MODES.STREAM) {
    return (
      <div className="w-full bg-surface-raise border border-ink/15 shadow-sm rounded-lg py-1 px-1.5 flex items-center justify-between gap-2">
        <input
          ref={streamFileInputRef}
          type="file"
          accept="video/*,.mkv,.mp4,.webm,.avi,.mov,.m4v"
          className="hidden"
          onChange={handleStreamFileChange}
        />

        <div
          onClick={() => streamFileInputRef.current?.click()}
          className="flex items-center justify-between w-full cursor-pointer pl-2 pr-1"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Radio className="w-4 h-4 text-ink-muted shrink-0" />
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs sm:text-sm font-semibold text-ink truncate">
                Stream Local Video
              </span>
              <span className="text-[10px] font-semibold text-ink-muted hidden sm:inline-block truncate">
                • Instant playback • Nothing saved to disk
              </span>
            </div>
          </div>

          <button
            type="button"
            className="bg-accent hover:bg-accent-deep text-on-accent text-xs sm:text-sm font-semibold px-3 sm:px-4 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-sm"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Select File</span>
          </button>
        </div>
      </div>
    );
  }

  // 4. Stream in Original Quality (Lossless Tunnel)
  return (
    <div className="w-full bg-surface-raise border border-ink/15 shadow-sm rounded-lg py-1 px-1.5 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0 pl-2">
        <Sparkles className="w-4 h-4 text-ink-muted shrink-0" />
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs sm:text-sm font-semibold text-ink truncate">
            Stream in Original Quality
          </span>
          <span className="text-[10px] font-semibold text-ink-muted hidden sm:inline-block truncate">
            • Watch in original quality without downloading
          </span>
        </div>
      </div>

      <span className="text-[11px] font-semibold text-ink-muted px-2.5 py-1 rounded bg-surface border border-ink/10 shrink-0">
        Coming Soon
      </span>
    </div>
  );
}
