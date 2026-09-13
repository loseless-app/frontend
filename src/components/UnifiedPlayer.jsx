import React, { useRef, useEffect, useState } from "react";
import ReactPlayer from "react-player";
import { Play, TriangleAlert } from "lucide-react";

export function UnifiedPlayer({ roomState, emitPlay, emitPause, emitSeek, emitBuffering }) {
  const playerRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  // Error tied to the media URL that failed, so it clears itself when the source changes
  const [loadError, setLoadError] = useState(null);
  const showLoadError = loadError !== null && loadError.url === roomState?.mediaUrl;

  // Flags to keep programmatic seeks and transient seek-pauses from echoing back to the server
  const isProgrammaticAction = useRef(false);
  const hasInitializedSyncRef = useRef(false);
  const isSeekingRef = useRef(false);
  const prevRoomStateRef = useRef(null);

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
    if (!roomState || !playerRef.current || !isReady) return;

    const prev = prevRoomStateRef.current;
    const { isPlaying, anchorTime, lastStartedAt, mediaUrl } = roomState;
    prevRoomStateRef.current = roomState;

    const isInitialLoad = !hasInitializedSyncRef.current;

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
        hasInitializedSyncRef.current = true;
      }, 500);
    }
  }, [roomState, isReady]);

  const handleReady = () => {
    setIsReady(true);
    setLoadError(null);
  };

  // Log any failure to load/play the media and surface it in the UI
  const handleError = (error, data) => {
    console.error("[Player] Failed to load media:", {
      url: roomState?.mediaUrl,
      error: error?.message || error,
      data,
    });
    setIsReady(false);
    setLoadError({ url: roomState?.mediaUrl });
  };

  const handlePlay = () => {
    if (isProgrammaticAction.current) return;
    emitPlay(getCurrentTime());
  };

  const handlePause = () => {
    if (isProgrammaticAction.current || isSeekingRef.current) return;
    emitPause(getCurrentTime());
  };

  const handleSeeking = () => {
    if (isProgrammaticAction.current) return;
    isSeekingRef.current = true;
    emitSeek(getCurrentTime());

    setTimeout(() => {
      isSeekingRef.current = false;
    }, 800);
  };

  const handleWaiting = () => {
    if (isProgrammaticAction.current) return;
    emitBuffering(true);
  };

  const handlePlaying = () => {
    if (isProgrammaticAction.current) return;
    isSeekingRef.current = false;
    emitBuffering(false);
  };

  return (
    <div className="relative w-full aspect-video bg-black overflow-hidden border border-white/10 shadow-2xl flex items-center justify-center">
      {!roomState?.mediaUrl ? (
        <div className="w-full h-full flex flex-col items-center justify-center text-white/70">
          <div className="w-14 h-14 bg-white/10 border border-white/20 flex items-center justify-center mb-4">
            <Play className="w-6 h-6 fill-current ml-0.5" />
          </div>
          <p className="text-sm font-medium">Pick a video or paste a link above to start</p>
        </div>
      ) : (
        <ReactPlayer
          ref={playerRef}
          src={roomState.mediaUrl}
          playing={roomState.isPlaying && !roomState.isBuffering}
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
          <p className="mt-1 text-white/50 text-xs">Check the link and try again.</p>
          <p className="mt-3 text-white/30 text-[10px] break-all px-6 max-w-full truncate">
            {roomState?.mediaUrl}
          </p>
        </div>
      )}

      {/* Buffering Overlay */}
      {roomState?.isBuffering && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center z-30">
          <div className="w-10 h-10 border-2 border-white/30 border-t-white animate-spin"></div>
          <p className="mt-4 text-white/80 text-xs">Buffering…</p>
        </div>
      )}
    </div>
  );
}