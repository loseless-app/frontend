import React, { useRef, useEffect, useState } from "react";
import ReactPlayer from "react-player";

// Universal Video Player Component supporting YouTube, Twitch, Vimeo, SoundCloud, & MP4 files
export function UnifiedPlayer({
  roomState,
  clockSkew = 0,
  emitPlay,
  emitPause,
  emitSeek,
  emitBuffering,
  /* ========================================================================== */
  /* 🧪 TEMPORARY DEBUG DIAGNOSTICS PROP (REMOVE IN PRODUCTION) */
  /* ========================================================================== */
  onTimeUpdate,
  /* ========================================================================== */
}) {
  const playerRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [videoTitle, setVideoTitle] = useState("Big Buck Bunny");

  // Lock flags to prevent programmatic seeks and transient seek-pauses from emitting socket pause events
  const isProgrammaticAction = useRef(false);
  const hasInitializedSyncRef = useRef(false);
  const isSeekingRef = useRef(false);
  const prevRoomStateRef = useRef(null);

  // Keyboard shortcut listener to detect Arrow Left / Right key seeks
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "j" ||
        e.key === "l"
      ) {
        // Flag that a key seek is active to suppress transient iframe pause events
        isSeekingRef.current = true;
        setTimeout(() => {
          isSeekingRef.current = false;
        }, 800);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Fetch real video title via oEmbed when mediaUrl updates
  useEffect(() => {
    const mediaUrl = roomState?.mediaUrl;
    if (!mediaUrl) {
      setVideoTitle("No Video Selected");
      return;
    }

    const fallbackTitle = mediaUrl.split("/").pop()?.split("?")[0] || "Video Stream";

    const fetchTitle = async () => {
      try {
        const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(mediaUrl)}`);
        const data = await res.json();
        if (data && data.title) {
          setVideoTitle(data.title);
          return;
        }
      } catch (e) {
        console.warn("oEmbed title fetch fallback:", e);
      }
      setVideoTitle(fallbackTitle);
    };

    fetchTitle();
  }, [roomState?.mediaUrl]);

  // Helper method to safely seek player timestamp
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

  // Helper method to safely read current player timestamp
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

  /* ========================================================================== */
  /* 🧪 TEMPORARY DEBUG DIAGNOSTICS TIMER (REMOVE IN PRODUCTION) */
  /* ========================================================================== */
  useEffect(() => {
    if (!onTimeUpdate) return;
    const interval = setInterval(() => {
      if (playerRef.current) {
        onTimeUpdate(getCurrentTime());
      }
    }, 200);
    return () => clearInterval(interval);
  }, [onTimeUpdate]);
  /* ========================================================================== */

  // Synchronize player position whenever roomState updates
  useEffect(() => {
    if (!roomState || !playerRef.current || !isReady) return;

    const prev = prevRoomStateRef.current;
    const { isPlaying, anchorTime, lastStartedAt, mediaUrl } = roomState;
    prevRoomStateRef.current = roomState;

    const isInitialLoad = !hasInitializedSyncRef.current;

    // Calculate projected server timestamp
    let targetTime = anchorTime || 0;
    if (isPlaying && lastStartedAt > 0) {
      const nowServer = Date.now() + clockSkew;
      const elapsedSeconds = (nowServer - lastStartedAt) / 1000;
      targetTime = Math.max(0, anchorTime + elapsedSeconds);
    }

    const currentLocalTime = getCurrentTime();
    const drift = Math.abs(currentLocalTime - targetTime);

    const isUrlChanged = prev?.mediaUrl !== mediaUrl;
    const isExplicitSeek = prev && Math.abs((prev.anchorTime || 0) - anchorTime) > 0.5;

    let shouldSeek = false;

    if (isInitialLoad || isUrlChanged || isExplicitSeek) {
      shouldSeek = true;
    } else if (drift > 2.0) {
      shouldSeek = true;
    }

    if (shouldSeek) {
      isProgrammaticAction.current = true;
      seekToPosition(targetTime);

      setTimeout(() => {
        isProgrammaticAction.current = false;
        hasInitializedSyncRef.current = true;
      }, 500);
    }
  }, [roomState?.isPlaying, roomState?.anchorTime, roomState?.lastStartedAt, roomState?.mediaUrl, isReady]);

  const handleReady = () => setIsReady(true);

  const handlePlay = () => {
    if (isProgrammaticAction.current) return;
    emitPlay(getCurrentTime());
  };

  const handlePause = () => {
    // Ignore pause events triggered by programmatic seeks or user arrow-key seeking
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

  const provider = roomState?.mediaProvider || "youtube";

  const getCleanProviderLabel = () => {
    if (provider === "youtube") return "YouTube";
    if (provider === "twitch") return "Twitch";
    if (provider === "vimeo") return "Vimeo";
    if (provider === "dailymotion") return "DailyMotion";
    if (provider === "hls") return "HLS Stream";
    if (provider === "direct") return "Direct MP4";
    return "URL Stream";
  };

  return (
    <div className="w-full space-y-3 font-sans">
      {/* Video Frame Box */}
      <div className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden border border-zinc-800/80 shadow-2xl group flex items-center justify-center">
        {!roomState || !roomState.mediaUrl ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-[#0D0D12] text-zinc-400 p-6">
            <div className="w-14 h-14 rounded-full bg-zinc-800/80 flex items-center justify-center mb-3 border border-zinc-700">
              <svg className="w-7 h-7 text-zinc-300 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <p className="text-lg font-bold text-white tracking-wide font-serif italic">No Video Selected</p>
            <p className="text-xs text-zinc-400 mt-1 text-center max-w-xs">
              Paste a YouTube, Vimeo, DailyMotion, or MP4 link below to start playing
            </p>
          </div>
        ) : (
          <ReactPlayer
            ref={playerRef}
            src={roomState.mediaUrl}
            url={roomState.mediaUrl}
            playing={roomState.isPlaying && !roomState.isBuffering}
            controls={true}
            width="100%"
            height="100%"
            onReady={handleReady}
            onPlay={handlePlay}
            onPause={handlePause}
            onSeeking={handleSeeking}
            onWaiting={handleWaiting}
            onPlaying={handlePlaying}
          />
        )}

        {/* Buffering Lock Overlay */}
        {roomState?.isBuffering && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center z-30 transition-all duration-300">
            <div className="w-12 h-12 border-3 border-zinc-400 border-t-transparent rounded-full animate-spin"></div>
            <p className="mt-3 text-white font-medium text-xs tracking-wide">
              Waiting for <span className="text-zinc-200 font-bold">{roomState.bufferingUser || "peer"}</span> to buffer...
            </p>
          </div>
        )}
      </div>

      {/* Under-Video Row: Title & Source (Left) | Reaction Emojis (Right) */}
      <div className="flex items-center justify-between gap-4 pt-1">
        {/* Left Side: Dynamic Video Title & Source Tag */}
        <div className="flex items-center space-x-3 min-w-0">
          <h1 className="font-serif text-xl font-semibold tracking-tight text-white italic truncate max-w-lg" title={videoTitle}>
            {videoTitle}
          </h1>
          <span className="shrink-0 px-2.5 py-0.5 bg-[#171720] border border-zinc-800 text-zinc-400 rounded-md text-[11px] font-medium">
            {getCleanProviderLabel()}
          </span>
        </div>

        {/* Right Side: Emoji Reactions Placeholders */}
        <div className="flex items-center space-x-1.5 select-none shrink-0">
          <button className="px-2.5 py-1 bg-[#14141B] hover:bg-[#1C1C26] border border-zinc-800/80 rounded-full text-xs text-zinc-300 font-medium transition-all cursor-pointer" title="Haha">
            😂
          </button>
          <button className="px-2.5 py-1 bg-[#14141B] hover:bg-[#1C1C26] border border-zinc-800/80 rounded-full text-xs text-zinc-300 font-medium transition-all cursor-pointer" title="Crying">
            😭
          </button>
          <button className="px-2.5 py-1 bg-[#14141B] hover:bg-[#1C1C26] border border-zinc-800/80 rounded-full text-xs text-zinc-300 font-medium transition-all cursor-pointer" title="Love">
            ❤️
          </button>
          <button className="px-2.5 py-1 bg-[#14141B] hover:bg-[#1C1C26] border border-zinc-800/80 rounded-full text-xs text-zinc-300 font-medium transition-all cursor-pointer" title="Wow">
            😮
          </button>
          <button className="px-2.5 py-1 bg-[#14141B] hover:bg-[#1C1C26] border border-zinc-800/80 rounded-full text-xs text-zinc-300 font-medium transition-all cursor-pointer" title="Fire">
            🔥
          </button>
          <button className="px-2.5 py-1 bg-[#14141B] hover:bg-[#1C1C26] border border-zinc-800/80 rounded-full text-xs text-zinc-300 font-medium transition-all cursor-pointer" title="Clap">
            👏
          </button>
        </div>
      </div>
    </div>
  );
}
