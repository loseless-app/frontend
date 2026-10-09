import React, { useRef, useEffect, useState } from "react";
import ReactPlayer from "react-player";
import { Play, TriangleAlert } from "lucide-react";
import { LocalFilePrompt } from "./LocalFilePrompt";

export function UnifiedPlayer({
  roomState,
  localBlobUrl,
  onSelectLocalFile,
  emitPlay,
  emitPause,
  emitSeek,
  emitBuffering,
  isDisplaced = false,
  p2pTransfer = null,
  activeUploads = {},
}) {
  const playerRef = useRef(null);
  const [isReady, setIsReady] = useState(false);

  const isFileMode = roomState?.mediaType === "file";
  const effectiveSrc = isFileMode ? localBlobUrl : roomState?.mediaUrl;
  const isAwaitingLocalFile = isFileMode && !localBlobUrl;

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
      if (typeof playerRef.current.seekTo === "function") {
        playerRef.current.seekTo(seconds, "seconds");
      } else if ("currentTime" in playerRef.current) {
        playerRef.current.currentTime = seconds;
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
      }, 500);
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
      playerRef.current.play().catch((err) => {
        console.warn("[Player] Video play failed:", err);
      });
    } else if (!shouldPlay && !playerRef.current.paused) {
      playerRef.current.pause();
    }
  }, [isFileMode, roomState?.isPlaying, isReady, isDisplaced]);

  return (
    <div className="relative w-full aspect-video bg-black overflow-hidden border border-white/10 shadow-2xl flex items-center justify-center">
      {isAwaitingLocalFile ? (
        <LocalFilePrompt
          mediaMetadata={roomState?.mediaMetadata}
          onSelectFile={onSelectLocalFile}
          downloadState={p2pTransfer?.downloadState}
          downloadProgress={p2pTransfer?.downloadProgress}
          downloadError={p2pTransfer?.downloadError}
          onDownloadFromHost={p2pTransfer?.onDownloadFromHost}
          onCancelDownload={p2pTransfer?.onCancelDownload}
          hostUsername={p2pTransfer?.hostUsername}
          canDownload={p2pTransfer?.canDownload}
        />
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
        </div>
      )}

      {/* Buffering Overlay - only for online streaming mode */}
      {!isFileMode && roomState?.isBuffering && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-30">
          <div className="w-10 h-10 border-2 border-white/30 border-t-white animate-spin"></div>
          <p className="mt-4 text-white/80 text-xs">Buffering…</p>
        </div>
      )}
    </div>
  );
}