import React, { useRef, useState, useEffect } from "react";
import { FileVideo, UploadCloud, AlertCircle, Download, Loader2, X, RefreshCw, Clock, FolderDown, Check, Play } from "lucide-react";
import { cleanupOPFSFile, cleanupAllOPFSFiles, sanitizeSuggestedName, findOPFSFile, getOPFSFileHandle } from "../features/p2p-transfer/index.js";

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatRemainingMinutes(seconds) {
  if (seconds == null || isNaN(seconds) || seconds <= 0) return null;
  if (seconds < 60) return "< 1 min";
  const mins = Math.ceil(seconds / 60);
  return `~${mins} min${mins === 1 ? "" : "s"}`;
}

function getFriendlyErrorMessage(err) {
  if (!err) return "Unable to download file. Please try again.";
  const msg = typeof err === "string" ? err : err?.message || "";

  // 1. Connection dropped and grace period expired
  if (/connection did not recover|disconnected|network/i.test(msg)) {
    return "Connection lost. The network was interrupted, please try again.";
  }

  // 2. Network timeouts (inactivity vs connection establishment)
  if (/no data|inactivity/i.test(msg)) {
    return "Transfer timed out due to network inactivity. Please try again.";
  }
  if (/timed out|timeout/i.test(msg)) {
    return "Connection timed out. The file sender took too long to respond, please try again.";
  }

  // 3. NAT / Firewall / WebRTC route negotiation
  if (/NAT\/firewall|TURN|direct route|P2P connection failed|ICE connection failed|direct.*connection/i.test(msg)) {
    return "Could not connect to peer. Network or firewall restrictions may be blocking direct sharing.";
  }

  // 4. Data channel prematurely closed
  if (/DataChannel closed|channel closed/i.test(msg)) {
    return "Transfer was interrupted before completion. Please try again.";
  }

  // 5. Memory-mode limit on large files (e.g. without disk handle)
  if (/memory-mode limit|destination file on disk is required/i.test(msg)) {
    return "This file is too large for in-memory download. A browser with disk storage support is required.";
  }

  // 6. Storage / disk quota
  if (/quota|storage|disk.*full/i.test(msg)) {
    return "Not enough storage space on your device to save this file.";
  }

  // 7. Integrity / hash verification failure
  if (/checksum|hash|integrity|verification/i.test(msg)) {
    return "File verification failed. Please try downloading again.";
  }

  // 8. Host or peer left
  if (/host left|sender left/i.test(msg)) {
    return "The file sender left the room. Transfer stopped.";
  }
  if (/peer left/i.test(msg)) {
    return "The recipient left the room. Transfer stopped.";
  }

  // 9. Cancellation
  if (/cancel/i.test(msg)) {
    return "Transfer was cancelled.";
  }

  // 10. Oversized file
  if (/exceed.*limit|oversized|too large/i.test(msg)) {
    return "This file exceeds the maximum allowed transfer size.";
  }

  // 11. Peer has no local file or is unavailable
  if (/no local file|not available|unavailable/i.test(msg)) {
    return "The file sender does not have the file loaded. Please ask them to re-select the video.";
  }

  return "Unable to download file. Please check your connection and try again.";
}




export function LocalFilePrompt({
  mediaMetadata,
  onSelectFile,
  downloadState = "idle", // 'idle' | 'requesting' | 'transferring' | 'completed' | 'error'
  downloadProgress = null,
  downloadError = null,
  onDownloadFromHost = null,
  onCancelDownload = null,
  onPlayDownloadedFile = null,
  onExportDownloadedFile = null,
  onRestoreCompletedDownload = null,
  hostUsername = "Host",
  canDownload = true,
  isResume = false,
}) {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [savedToFilePicker, setSavedToFilePicker] = useState(false);
  const [hasSavedToComputer, setHasSavedToComputer] = useState(() => {
    try {
      return Boolean(
        mediaMetadata?.fileName &&
        sessionStorage.getItem("lossless_opfs_saved_" + mediaMetadata.fileName)
      );
    } catch {
      return false;
    }
  });
  const [showOPFSNoticeModal, setShowOPFSNoticeModal] = useState(false);

  const supportsSavePicker = typeof window !== "undefined" && "showSaveFilePicker" in window;

  useEffect(() => {
    if (downloadState !== "transferring" && downloadState !== "requesting") {
      setShowCancelConfirm(false);
    }
    if (downloadState !== "idle") {
      setShowOPFSNoticeModal(false);
    }
  }, [downloadState]);

  // When idle: check if this file was already completely downloaded into OPFS (e.g. user refreshed the page while on Save File to Device prompt)
  useEffect(() => {
    if (downloadState !== "idle" || !mediaMetadata?.fileName) return;

    let isSubscribed = true;
    (async () => {
      const existingFile = await findOPFSFile(mediaMetadata.fileName, mediaMetadata.fileSize);
      if (existingFile && isSubscribed) {
        onRestoreCompletedDownload?.(existingFile);
      }
    })();

    return () => {
      isSubscribed = false;
    };
  }, [downloadState, mediaMetadata?.fileName, mediaMetadata?.fileSize, onRestoreCompletedDownload]);

  const expectedName = mediaMetadata?.fileName || "Unknown video file";
  const expectedSize = formatBytes(mediaMetadata?.fileSize);

  const handleConfirmOPFSDownload = async () => {
    setShowOPFSNoticeModal(false);
    setSavedToFilePicker(false);
    setHasSavedToComputer(false);

    // Clean up any old attempt before starting a fresh OPFS download
    cleanupOPFSFile(mediaMetadata?.fileName);

    // High-capacity on-disk fallback: OPFS (Origin Private File System)
    // Works out-of-the-box in Brave, Firefox, Safari, and Chrome without RAM limits!
    const opfsHandle = await getOPFSFileHandle(mediaMetadata?.fileName);
    if (opfsHandle) {
      onDownloadFromHost(opfsHandle);
      return;
    }

    // Browser fallback for small files (RAM mode, <500MB)
    onDownloadFromHost(null);
  };

  const handleDownloadClick = async () => {
    if (!onDownloadFromHost) return;

    if (supportsSavePicker) {
      const cleanName = sanitizeSuggestedName(mediaMetadata?.fileName);
      const ext = cleanName.includes(".") ? cleanName.split(".").pop().toLowerCase() : "mp4";
      const mimeType = mediaMetadata?.fileType || (ext === "mkv" ? "video/x-matroska" : `video/${ext}`);

      try {
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: cleanName,
          types: [
            {
              description: "Video File",
              accept: {
                [mimeType]: [`.${ext}`],
              },
            },
          ],
        });
        setSavedToFilePicker(true);
        onDownloadFromHost(fileHandle);
        return;
      } catch (err) {
        if (err.name === "AbortError") {
          // User cancelled the save dialog
          return;
        }
        console.warn("[LocalFilePrompt] showSaveFilePicker with types failed, retrying plain dialog:", err);
        try {
          const fileHandle = await window.showSaveFilePicker({ suggestedName: cleanName });
          setSavedToFilePicker(true);
          onDownloadFromHost(fileHandle);
          return;
        } catch (retryErr) {
          if (retryErr.name === "AbortError") return;
          console.warn("[LocalFilePrompt] Plain showSaveFilePicker failed, trying OPFS disk stream:", retryErr);
        }
      }
    }

    // For Brave, Firefox, and Safari (browsers using OPFS):
    // Show the confirmation popup with the notice first!
    setShowOPFSNoticeModal(true);
  };

  const handleFile = (file) => {
    if (!file) return;

    // Check if filename or size differs from host's file
    const nameDiffers = mediaMetadata?.fileName && file.name !== mediaMetadata.fileName;
    const sizeDiffers = mediaMetadata?.fileSize && Math.abs(file.size - mediaMetadata.fileSize) > 1024 * 1024; // > 1MB diff

    if (nameDiffers || sizeDiffers) {
      setPendingFile(file);
    } else {
      // Confirmed selection of local file: purge temporary OPFS files and reset download state
      cleanupAllOPFSFiles();
      onCancelDownload?.();
      onSelectFile(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  };

  const handleInputChange = (e) => {
    const file = e.target.files?.[0];
    handleFile(file);
    e.target.value = "";
  };

  const isTransferring = downloadState === "requesting" || downloadState === "transferring";
  const percent = downloadProgress?.percent || 0;
  const speed = downloadProgress?.speed ? `${formatBytes(downloadProgress.speed)}/s` : "Calculating...";
  const remainingTime = formatRemainingMinutes(downloadProgress?.eta);
  const received = formatBytes(downloadProgress?.receivedBytes || 0);
  const total = formatBytes(downloadProgress?.totalBytes || mediaMetadata?.fileSize || 0);

  return (
    <div
      onDragOver={isTransferring ? undefined : handleDragOver}
      onDragLeave={isTransferring ? undefined : handleDragLeave}
      onDrop={isTransferring ? undefined : handleDrop}
      className={`relative w-full h-full min-h-[340px] bg-surface-raise/95 text-ink flex flex-col items-center justify-center p-6 border-2 border-dashed transition-all ${isDragging
        ? "border-accent bg-accent/10 scale-[0.99]"
        : "border-ink/20 hover:border-ink/40"
        }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mkv,.mp4,.webm,.avi,.mov,.m4v"
        className="hidden"
        onChange={handleInputChange}
      />

      {/* OPFS Temporary Storage Notice Modal (Brave / OPFS browsers) */}
      {showOPFSNoticeModal && (
        <div className="absolute inset-0 z-30 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="max-w-md w-full bg-surface border border-ink/15 p-6 shadow-2xl space-y-4 text-center rounded-2xl animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-accent/10 border border-accent/20 text-accent flex items-center justify-center shadow-sm">
              <Download className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-base font-bold text-ink">Download Video</h3>
              <p className="text-xs text-ink-muted leading-relaxed">
                Your browser will download the video into temporary storage first. Once finished, you'll be prompted to save it to your computer.
              </p>
            </div>

            <div className="flex gap-2.5 justify-center pt-2">
              <button
                type="button"
                onClick={() => setShowOPFSNoticeModal(false)}
                className="px-4 py-2 text-xs font-semibold text-ink-muted hover:text-ink border border-ink/20 hover:bg-ink/5 rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmOPFSDownload}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold bg-accent hover:bg-accent-deep text-on-accent rounded-xl shadow-md transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1. Difference confirmation dialog */}
      {pendingFile ? (
        <div className="max-w-md w-full bg-surface border border-ink/15 p-5 shadow-2xl space-y-4 text-center rounded-xl animate-in fade-in duration-150">
          <div className="w-10 h-10 mx-auto rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center">
            <AlertCircle className="w-5 h-5" />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-bold text-ink">File Details Differ</h3>
            <p className="text-xs text-ink-muted">
              Your selected file doesn't perfectly match the room video, but you can still synchronize if it is the same video.
            </p>
          </div>

          <div className="text-xs text-left bg-ink/5 p-3 rounded-lg space-y-1 font-mono border border-ink/5">
            <div>
              <span className="text-ink-muted">Room video: </span>
              <span className="text-ink font-semibold">{expectedName}</span> ({expectedSize})
            </div>
            <div>
              <span className="text-ink-muted">Your file: </span>
              <span className="text-ink font-semibold">{pendingFile.name}</span> ({formatBytes(pendingFile.size)})
            </div>
          </div>

          <div className="flex gap-2 justify-center pt-1">
            <button
              type="button"
              onClick={() => setPendingFile(null)}
              className="px-4 py-2 text-xs font-semibold text-ink-muted hover:text-ink border border-ink/20 hover:bg-ink/5 rounded-lg transition-colors cursor-pointer"
            >
              Choose different file
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  if (mediaMetadata?.fileName) {
                    sessionStorage.removeItem("lossless_opfs_saved_" + mediaMetadata.fileName);
                  }
                } catch { }
                cleanupAllOPFSFiles();
                onCancelDownload?.();
                onSelectFile(pendingFile);
                setPendingFile(null);
              }}
              className="px-4 py-2 text-xs font-bold bg-accent hover:bg-accent-deep text-on-accent rounded-lg transition-colors cursor-pointer"
            >
              Sync anyway
            </button>
          </div>
        </div>
      ) : isTransferring ? (
        /* 2. Active Download Progress Card */
        <div className="max-w-lg w-full bg-surface border border-ink/15 p-6 sm:p-7 shadow-2xl space-y-6 text-center rounded-2xl animate-in fade-in duration-150 backdrop-blur-xs">
          {/* Top Status & Percentage Header */}
          <div className="flex items-center justify-between gap-4 border-b border-ink/10 pb-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/25 text-accent flex items-center justify-center shrink-0">
                <Download className="w-5 h-5 animate-pulse" />
              </div>
              <div className="text-left min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                    {downloadState === "requesting"
                      ? "Preparing Download"
                      : downloadProgress?.isFinalizing
                        ? "Finalizing Video"
                        : "Downloading Video"}
                  </span>
                </div>
                <p className="text-xs text-ink font-semibold truncate max-w-[200px] sm:max-w-[260px]" title={expectedName}>
                  {expectedName}
                </p>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span className="text-2xl sm:text-3xl font-mono font-black text-ink tracking-tight">
                {percent}%
              </span>
            </div>
          </div>

          {/* Download subtext */}
          <p className="text-xs text-ink-muted -mt-2">
            {downloadState === "requesting" ? (
              <span className="inline-flex items-center gap-1.5 text-accent font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Connecting to {hostUsername}...</span>
              </span>
            ) : downloadProgress?.isFinalizing ? (
              <span className="inline-flex items-center gap-1.5 text-accent font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving to disk, almost ready...</span>
              </span>
            ) : (
              <span>Downloading from <strong className="text-ink">{hostUsername}</strong> to your computer</span>
            )}
          </p>

          {/* Enhanced Progress Bar */}
          <div className="space-y-3">
            <div className="w-full bg-ink/10 h-3 rounded-full overflow-hidden p-0.5 border border-ink/10 shadow-inner">
              <div
                className="bg-accent h-full rounded-full transition-all duration-300 ease-out relative overflow-hidden"
                style={{ width: `${Math.max(2, percent)}%` }}
              >
                <div className="absolute inset-0 bg-white/20 animate-pulse" />
              </div>
            </div>

            {/* 3-Column Stats Dashboard */}
            <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-ink/[0.04] border border-ink/10 text-left">
              {/* Downloaded */}
              <div className="space-y-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted block truncate">
                  Downloaded
                </span>
                <div className="text-xs font-mono font-bold text-ink truncate" title={`${received} of ${total}`}>
                  {received} <span className="text-ink-muted font-normal text-[10px]">/ {total}</span>
                </div>
              </div>

              {/* Speed */}
              <div className="space-y-0.5 border-x border-ink/10 px-2 sm:px-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted block truncate">
                  Speed
                </span>
                <div className="text-xs font-mono font-bold text-ink truncate">
                  {speed}
                </div>
              </div>

              {/* Remaining Time */}
              <div className="space-y-0.5 pl-1 sm:pl-2">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-ink-muted shrink-0" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted block truncate">
                    Remaining Time
                  </span>
                </div>
                <div className="text-xs font-mono font-bold text-ink truncate">
                  {remainingTime || (downloadState === "requesting" ? "Connecting..." : "Estimating...")}
                </div>
              </div>
            </div>
          </div>

          {/* Cancel button with Are You Sure confirmation */}
          <div className="pt-1 flex items-center justify-center">
            {showCancelConfirm ? (
              <div className="flex flex-col sm:flex-row items-center gap-2.5 p-2 rounded-xl bg-red-500/10 border border-red-500/20 animate-in fade-in zoom-in-95 duration-150">
                <span className="text-xs font-semibold text-red-500 px-1">
                  Are you sure you want to cancel?
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCancelConfirm(false);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-ink-muted hover:text-ink hover:bg-ink/10 border border-ink/15 transition-all cursor-pointer"
                  >
                    Keep Downloading
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCancelConfirm(false);
                      cleanupOPFSFile(mediaMetadata?.fileName);
                      onCancelDownload?.();
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500 hover:bg-red-600 text-white shadow-sm transition-all cursor-pointer active:scale-95"
                  >
                    Yes, Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCancelConfirm(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-red-500 hover:text-red-600 hover:bg-red-500/10 border border-red-500/20 transition-all cursor-pointer hover:scale-105 active:scale-95"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancel Download</span>
              </button>
            )}
          </div>
        </div>
      ) : downloadState === "completed" ? (
        /* 3. Download Complete State: Big "Play" Button Styled in App Theme */
        <div className="max-w-md w-full bg-surface border border-ink/15 p-6 sm:p-7 shadow-2xl space-y-5 text-center rounded-2xl animate-in fade-in zoom-in-95 duration-200">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-accent/10 border border-accent/20 text-ink flex items-center justify-center shadow-sm">
            {savedToFilePicker || hasSavedToComputer ? (
              <Check className="w-7 h-7 stroke-[2.5]" />
            ) : (
              <FolderDown className="w-7 h-7 text-accent" />
            )}
          </div>

          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/15 text-ink border border-accent/25 text-xs font-bold uppercase tracking-wider">
              {savedToFilePicker || hasSavedToComputer ? "Download Complete" : "Save to Your Device"}
            </div>
            <h3 className="text-base sm:text-lg font-bold text-ink tracking-tight truncate max-w-xs mx-auto" title={expectedName}>
              {expectedName}
            </h3>
            <p className="text-xs text-ink-muted font-medium">
              {savedToFilePicker ? (
                `${expectedSize} • Saved to your selected folder`
              ) : hasSavedToComputer ? (
                `${expectedSize} • Saved to your computer`
              ) : (
                "Save this video to your computer to move it out of temporary browser storage."
              )}
            </p>
          </div>

          <div className="space-y-2 pt-1">
            {savedToFilePicker || hasSavedToComputer ? (
              <button
                type="button"
                onClick={onPlayDownloadedFile}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-accent hover:bg-accent-deep text-on-accent text-sm sm:text-base font-bold shadow-md transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              >
                <Play className="w-5 h-5 fill-current ml-0.5" />
                <span>Play</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onExportDownloadedFile?.();
                  setHasSavedToComputer(true);
                  try {
                    if (mediaMetadata?.fileName) {
                      sessionStorage.setItem("lossless_opfs_saved_" + mediaMetadata.fileName, "true");
                    }
                  } catch { }
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-accent hover:bg-accent-deep text-on-accent text-sm sm:text-base font-bold shadow-md transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              >
                <FolderDown className="w-5 h-5" />
                <span>Save File to Device</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-ink-muted hover:text-ink transition-colors cursor-pointer py-1"
            >
              Choose different file
            </button>
          </div>
        </div>
      ) : downloadState === "error" ? (
        /* 3. Error state with retry */
        <div className="max-w-md w-full bg-surface border border-red-500/30 p-6 shadow-2xl space-y-4 text-center rounded-2xl animate-in fade-in duration-150">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>

          <div className="space-y-1">
            <h3 className="text-base font-bold text-ink">Download Failed</h3>
            <p className="text-xs text-red-400 font-medium max-w-xs mx-auto">
              {getFriendlyErrorMessage(downloadError)}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
            {onDownloadFromHost && (
              <button
                type="button"
                onClick={handleDownloadClick}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-bold bg-accent hover:bg-accent-deep text-on-accent transition-colors cursor-pointer shadow-sm"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Download</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold text-ink border border-ink/20 hover:bg-ink/5 transition-colors cursor-pointer"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>Pick File from Device</span>
            </button>
          </div>
        </div>
      ) : (
        /* 4. Default State: Primary Download button with Folder selection + Secondary Manual Pick */
        <div className="max-w-lg w-full flex flex-col items-center text-center space-y-4 px-4">
          <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shadow-sm">
            <FileVideo className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/15 text-accent-deep border border-accent/25 text-xs font-bold uppercase tracking-wider">
              {isResume ? "Resume Playback" : "Local Video Sync"}
            </div>

            <h3 className="text-lg sm:text-xl font-bold text-ink tracking-tight break-all">
              {expectedName}
            </h3>

            <p className="text-sm text-ink-muted font-medium max-w-md mx-auto leading-relaxed">
              {isResume ? (
                <span>
                  You were playing this video. Select this file again to resume.
                </span>
              ) : canDownload ? (
                <span>
                  <strong className="text-ink">{hostUsername}</strong> has selected this file. You can download and watch directly, or choose the same file from your computer.
                </span>
              ) : (
                <span>
                  <strong className="text-ink">{hostUsername}</strong> has selected this file. The file sender is currently offline or unavailable. If you already have this video on your computer, choose it below.
                </span>
              )}
            </p>

            <div className="text-xs font-semibold text-ink-muted">
              Size: <span className="text-ink font-bold">{expectedSize}</span>
            </div>
          </div>

          <div className="w-full max-w-xs space-y-2.5 pt-2">
            {isResume ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-accent hover:bg-accent-deep text-on-accent text-sm font-bold shadow-md transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              >
                <UploadCloud className="w-4 h-4" />
                <span>Select file to resume</span>
              </button>
            ) : (
              <>
                {/* Primary Action: Choose Save Location & Download from Peer */}
                {canDownload && onDownloadFromHost && (
                  <button
                    type="button"
                    onClick={handleDownloadClick}
                    className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-accent hover:bg-accent-deep text-on-accent text-sm font-bold shadow-md transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                  >
                    {supportsSavePicker ? (
                      <>
                        <FolderDown className="w-4 h-4" />
                        <span>Choose Folder & Download</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>Download Video</span>
                      </>
                    )}
                  </button>
                )}

                {/* Secondary Action: Select Local File */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${canDownload && onDownloadFromHost
                    ? "border-ink/20 text-ink-muted hover:text-ink hover:bg-ink/5"
                    : "bg-accent hover:bg-accent-deep text-on-accent text-sm font-bold shadow-md"
                    }`}
                >
                  <UploadCloud className="w-4 h-4" />
                  <span>Choose the same file</span>
                </button>
              </>
            )}
          </div>

          <p className="text-[11px] text-ink-muted">
            or drag & drop your video file anywhere in this box
          </p>
        </div>
      )}
    </div>
  );
}
