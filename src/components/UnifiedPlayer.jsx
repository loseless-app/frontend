import React, { useRef, useEffect, useState } from "react";
import ReactPlayer from "react-player";
import { Play, TriangleAlert, Loader2 } from "lucide-react";
import { LocalFilePrompt } from "./LocalFilePrompt";
import { FullscreenTransferOverlay } from "../features/p2p-transfer/components/index.js";

export function UnifiedPlayer({
  roomState,
  localBlobUrl,
  onSelectLocalFile,
  emitPlay,
  emitPause,
  emitSeek,
  emitBuffering,
  isDisplaced = false,
  isRestoringLocalFile = false,
  isResume = false,
  p2pTransfer = null,
  activeUploads = {},
  fullscreenTransfer = null,
}) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl && fsEl === playerRef.current && containerRef.current) {
        // Native video element went fullscreen: elevate to container so overlays render
        containerRef.current.requestFullscreen().catch(() => {});
        setIsFullscreen(true);
        return;
      }
      setIsFullscreen(
        Boolean(fsEl && (fsEl === containerRef.current || containerRef.current?.contains(fsEl)))
      );
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, []);

  const isFileMode = roomState?.mediaType === "file";
  const effectiveSrc = isFileMode ? localBlobUrl : roomState?.mediaUrl;
  const isAwaitingLocalFile = isFileMode && !localBlobUrl && !isRestoringLocalFile;

  // Reset isReady when the media source changes
  useEffect(() => {
    setIsReady(false);
  }, [effectiveSrc]);

  // Error tied to the media URL that failed, so it clears itself when the source changes
  const [loadError, setLoadError] = useState(null);
  const showLoadError = loadError !== null && loadError.url === effectiveSrc;

  // Flags to keep programmatic seeks and transient seek-pauses from echoing back to the server
  const isProgrammaticAction = useRef(false);
  const lastSyncedSrcRef = useRef(null);
  const isSeekingRef = useRef(false);
  const prevRoomStateRef = useRef(null);
  const pendingPauseTimeoutRef = useRef(null);

  // Cleanup any pending pause timer on unmount
  useEffect(() => {
    return () => {
      if (pendingPauseTimeoutRef.current) {
        clearTimeout(pendingPauseTimeoutRef.current);
      }
    };
  }, []);

  // Forcibly pause and mute the player immediately when this tab is displaced
  useEffect(() => {
    if (!isDisplaced) return;
    if (playerRef.current) {
      try {
        if (typeof playerRef.current.pause === "function") {
          playerRef.current.pause();
        }
        if ("muted" in playerRef.current) {
          playerRef.current.muted = true;
        }
        const internal = typeof playerRef.current.getInternalPlayer === "function"
          ? playerRef.current.getInternalPlayer()
          : null;
        if (internal) {
          if (typeof internal.pauseVideo === "function") internal.pauseVideo();
          if (typeof internal.pause === "function") internal.pause();
          if (typeof internal.mute === "function") internal.mute();
          if ("muted" in internal) internal.muted = true;
        }
      } catch (err) {
        console.warn("[Player] Error pausing displaced player:", err);
      }
    }
  }, [isDisplaced]);

  // Suppress transient iframe pause events triggered by arrow-key / j-l seeks
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "j" || e.key === "l") {
        isSeekingRef.current = true;
        setTimeout(() => {
          isSeekingRef.current = false;
        }, 800);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const seekToPosition = (seconds) => {
    if (!playerRef.current) return;
    try {
      const safeSeconds = Math.max(0, isNaN(seconds) ? 0 : seconds);
      if (typeof playerRef.current.seekTo === "function") {
        playerRef.current.seekTo(safeSeconds, "seconds");
      } else if ("currentTime" in playerRef.current) {
        playerRef.current.currentTime = safeSeconds;
      }
    } catch (e) {
      console.warn("Seek error:", e);
    }
  };

  const getCurrentTime = () => {
    if (!playerRef.current) return 0;
    try {
      if (typeof playerRef.current.getCurrentTime === "function") {
        return playerRef.current.getCurrentTime() || 0;
      }
      if ("currentTime" in playerRef.current) {
        return playerRef.current.currentTime || 0;
      }
    } catch (e) {
      console.warn("getCurrentTime error:", e);
    }
    return 0;
  };

  // Keep the local player in sync with the room state
  useEffect(() => {
    if (!roomState || !playerRef.current || !isReady || !effectiveSrc) return;

    const prev = prevRoomStateRef.current;
    const { isPlaying, anchorTime, lastStartedAt, mediaUrl } = roomState;
    prevRoomStateRef.current = roomState;

    const isInitialLoad = lastSyncedSrcRef.current !== effectiveSrc;

    let targetTime = anchorTime || 0;
    if (isPlaying && lastStartedAt > 0) {
      const elapsedSeconds = (Date.now() - lastStartedAt) / 1000;
      targetTime = Math.max(0, anchorTime + elapsedSeconds);
    }

    const currentLocalTime = getCurrentTime();
    const drift = Math.abs(currentLocalTime - targetTime);

    const isUrlChanged = prev?.mediaUrl !== mediaUrl;
    const isExplicitSeek = prev && Math.abs((prev.anchorTime || 0) - anchorTime) > 0.5;

    const shouldSeek =
      isInitialLoad || isUrlChanged || isExplicitSeek || drift > 2.0;

    if (shouldSeek) {
      isProgrammaticAction.current = true;
      seekToPosition(targetTime);

      setTimeout(() => {
        isProgrammaticAction.current = false;
        lastSyncedSrcRef.current = effectiveSrc;
      }, 800);
    }
  }, [roomState, isReady, effectiveSrc]);

  const handleReady = () => {
    setIsReady(true);
    setLoadError(null);
  };

  // Log any failure to load/play the media and surface it in the UI
  const handleError = (error, data) => {
    console.error("[Player] Failed to load media:", {
      url: effectiveSrc,
      error: error?.message || error,
      data,
    });
    setIsReady(false);
    setLoadError({ url: effectiveSrc });
  };

  const handlePlay = () => {
    if (isProgrammaticAction.current || isDisplaced) return;

    // Clear any pending pause timer immediately
    if (pendingPauseTimeoutRef.current) {
      clearTimeout(pendingPauseTimeoutRef.current);
      pendingPauseTimeoutRef.current = null;
    }

    emitPlay(getCurrentTime());
  };

  const handlePause = () => {
    if (isProgrammaticAction.current || isSeekingRef.current || isDisplaced) return;

    // If the video element itself reports that it is actively seeking, ignore pause
    if (playerRef.current && playerRef.current.seeking) {
      isSeekingRef.current = true;
      return;
    }

    // Clear any previous pending pause timer
    if (pendingPauseTimeoutRef.current) {
      clearTimeout(pendingPauseTimeoutRef.current);
    }

    // Delay emitting pause by 200ms. When scrubbing or clicking with the mouse cursor,
    // the browser fires a transient pause followed immediately by seeking/seeked.
    // The seeking/seeked handlers cancel this timer, preventing false pause broadcasts.
    pendingPauseTimeoutRef.current = setTimeout(() => {
      pendingPauseTimeoutRef.current = null;
      if (!isSeekingRef.current && (!playerRef.current || !playerRef.current.seeking)) {
        emitPause(getCurrentTime());
      }
    }, 200);
  };

  const handleSeeking = () => {
    if (isProgrammaticAction.current || isDisplaced) return;

    // Seeking started: cancel any pending pause immediately
    if (pendingPauseTimeoutRef.current) {
      clearTimeout(pendingPauseTimeoutRef.current);
      pendingPauseTimeoutRef.current = null;
    }

    isSeekingRef.current = true;
    emitSeek(getCurrentTime());

    setTimeout(() => {
      isSeekingRef.current = false;
    }, 800);
  };

  const handleWaiting = () => {
    if (isFileMode || isProgrammaticAction.current || isDisplaced) return;
    emitBuffering(true);
  };

  const handlePlaying = () => {
    if (isProgrammaticAction.current || isDisplaced) return;
    isSeekingRef.current = false;
    if (pendingPauseTimeoutRef.current) {
      clearTimeout(pendingPauseTimeoutRef.current);
      pendingPauseTimeoutRef.current = null;
    }
    if (!isFileMode) {
      emitBuffering(false);
    }
  };

  const handleSeeked = () => {
    if (isProgrammaticAction.current || isDisplaced) return;

    // Seek completed: cancel any pending pause immediately
    if (pendingPauseTimeoutRef.current) {
      clearTimeout(pendingPauseTimeoutRef.current);
      pendingPauseTimeoutRef.current = null;
    }

    emitSeek(getCurrentTime());
    setTimeout(() => {
      isSeekingRef.current = false;
    }, 400);
  };

  // Synchronize play/pause for native video element in file mode
  useEffect(() => {
    if (!isFileMode || !playerRef.current || !isReady) return;
    if (isDisplaced) {
      playerRef.current.pause();
      playerRef.current.muted = true;
      return;
    }
    const shouldPlay = roomState?.isPlaying;
    if (shouldPlay && playerRef.current.paused) {
      isProgrammaticAction.current = true;
      playerRef.current.play().catch((err) => {
        console.warn("[Player] Video play failed:", err);
      }).finally(() => {
        setTimeout(() => {
          isProgrammaticAction.current = false;
        }, 500);
      });
    } else if (!shouldPlay && !playerRef.current.paused) {
      isProgrammaticAction.current = true;
      playerRef.current.pause();
      setTimeout(() => {
        isProgrammaticAction.current = false;
      }, 500);
    }
  }, [isFileMode, roomState?.isPlaying, isReady, isDisplaced]);

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-video bg-black overflow-hidden border border-white/10 shadow-2xl flex items-center justify-center"
    >
      {isAwaitingLocalFile ? (
        <LocalFilePrompt
          mediaMetadata={roomState?.mediaMetadata}
          onSelectFile={onSelectLocalFile}
          downloadState={p2pTransfer?.downloadState}
          downloadProgress={p2pTransfer?.downloadProgress}
          downloadError={p2pTransfer?.downloadError}
          onDownloadFromHost={p2pTransfer?.onDownloadFromHost}
          onCancelDownload={p2pTransfer?.onCancelDownload}
          onPlayDownloadedFile={p2pTransfer?.onPlayDownloadedFile}
          onExportDownloadedFile={p2pTransfer?.onExportDownloadedFile}
          onRestoreCompletedDownload={p2pTransfer?.onRestoreCompletedDownload}
          hostUsername={p2pTransfer?.hostUsername}
          canDownload={p2pTransfer?.canDownload}
          isResume={isResume}
        />
      ) : isRestoringLocalFile ? (
        <div className="w-full h-full flex flex-col items-center justify-center text-white/70">
          <Loader2 className="w-8 h-8 animate-spin text-accent mb-3" />
          <p className="text-sm font-medium">Reloading video...</p>
        </div>
      ) : !effectiveSrc ? (
        <div className="w-full h-full flex flex-col items-center justify-center text-white/70">
          <div className="w-14 h-14 bg-white/10 border border-white/20 flex items-center justify-center mb-4">
            <Play className="w-6 h-6 fill-current ml-0.5" />
          </div>
          <p className="text-sm font-medium">Pick a video or paste a link above to start</p>
        </div>
      ) : isFileMode ? (
        <video
          key={effectiveSrc}
          ref={playerRef}
          src={effectiveSrc}
          controls
          playsInline
          className="w-full h-full object-contain"
          onLoadedMetadata={handleReady}
          onError={handleError}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeeking={handleSeeking}
          onSeeked={handleSeeked}
          onWaiting={handleWaiting}
          onPlaying={handlePlaying}
        />
      ) : (
        <ReactPlayer
          key={effectiveSrc}
          ref={playerRef}
          src={effectiveSrc}
          playing={!isDisplaced && !!roomState?.isPlaying && !roomState?.isBuffering}
          muted={isDisplaced ? true : undefined}
          controls={true}
          width="100%"
          height="100%"
          onReady={handleReady}
          onError={handleError}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeeking={handleSeeking}
          onWaiting={handleWaiting}
          onPlaying={handlePlaying}
        />
      )}

      {/* Load error overlay */}
      {showLoadError && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-30">
          <div className="w-12 h-12 bg-red-500/20 border border-red-500/40 flex items-center justify-center mb-4">
            <TriangleAlert className="w-6 h-6 text-red-400" />
          </div>
          <p className="text-white/90 text-sm font-medium">Couldn't load this media</p>
          <p className="mt-1 text-white/50 text-xs">
            {isFileMode ? "Check if your local video file is accessible." : "Check the link and try again."}
          </p>
          <p className="mt-3 text-white/30 text-[10px] break-all px-6 max-w-full truncate">
            {isFileMode ? roomState?.mediaMetadata?.fileName : roomState?.mediaUrl}
          </p>
          {isFileMode && onSelectLocalFile && (
            <div className="mt-3">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer border border-white/20">
                <span>Pick video file from device</span>
                <input
                  type="file"
                  accept="video/*,.mkv,.mp4,.webm,.avi,.mov,.m4v"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onSelectLocalFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {/* Buffering Overlay - only for online streaming mode */}
      {!isFileMode && roomState?.isBuffering && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-30">
          <div className="w-10 h-10 border-2 border-white/30 border-t-white animate-spin"></div>
          <p className="mt-4 text-white/80 text-xs">Buffering…</p>
        </div>
      )}

      {/* Fullscreen Transfer Overlay: ONLY rendered when in native Fullscreen mode */}
      {isFullscreen && isFileMode && fullscreenTransfer && (
        <FullscreenTransferOverlay
          incomingOffer={fullscreenTransfer.incomingOffer}
          onDownloadOffer={fullscreenTransfer.onDownloadOffer}
          onRejectOffer={fullscreenTransfer.onRejectOffer}
          isDownloading={fullscreenTransfer.isDownloading}
          downloadFileName={fullscreenTransfer.downloadFileName}
          downloadState={fullscreenTransfer.downloadState}
          downloadProgress={fullscreenTransfer.downloadProgress}
          onCancelDownload={fullscreenTransfer.onCancelDownload}
          showComplete={fullscreenTransfer.showComplete}
          savedToFilePicker={fullscreenTransfer.savedToFilePicker}
          onExportFile={fullscreenTransfer.onExportFile}
          onDismissComplete={fullscreenTransfer.onDismissComplete}
          uploadCompleteInfo={fullscreenTransfer.uploadCompleteInfo}
          onDismissUploadComplete={fullscreenTransfer.onDismissUploadComplete}
          rejectedOfferInfo={fullscreenTransfer.rejectedOfferInfo}
          onDismissRejectedOffer={fullscreenTransfer.onDismissRejectedOffer}
        />
      )}
    </div>
  );
}