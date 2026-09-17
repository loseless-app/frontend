import React, { useState, useEffect } from "react";
import { Minimize2 } from "lucide-react";
import { useSyncPlayer } from "./hooks/useSyncPlayer.js";
import { useChat } from "./hooks/useChat.js";
import { useServerStatus } from "./hooks/useServerStatus.js";
import { useMediaTitle } from "./hooks/useMediaTitle.js";
import { useMediaQuery } from "./hooks/useMediaQuery.js";
import { UnifiedPlayer } from "./components/UnifiedPlayer.jsx";
import { LinkInput } from "./components/LinkInput.jsx";
import { ChatPanel } from "./components/ChatPanel.jsx";
import { ServerStatus } from "./components/ServerStatus.jsx";
import { PickFileButton } from "./components/PickFileButton.jsx";
import { RoomInfoBox } from "./components/RoomInfoBox.jsx";
import { VyncLogo } from "./components/VyncLogo.jsx";

export default function App() {
  const [roomIdInput, setRoomIdInput] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [joinedRoomId, setJoinedRoomId] = useState(null);
  const [joinedUsername, setJoinedUsername] = useState(null);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);

  const serverDown = useServerStatus();

  const {
    roomState,
    emitPlay,
    emitPause,
    emitSeek,
    emitChangeSource,
    emitBuffering,
  } = useSyncPlayer(joinedRoomId, joinedUsername);

  const { messages, sendMessage } = useChat(joinedRoomId);

  const mediaTitle = useMediaTitle(roomState?.mediaUrl);

  // Exit theater mode on Escape key press
  useEffect(() => {
    if (!isTheaterMode) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsTheaterMode(false);
        setIsChatCollapsed(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isTheaterMode]);

  const isDesktop = useMediaQuery("(min-width: 1024px)"); // matches Tailwind's `lg`
  const chatInSidebar = !isTheaterMode && isDesktop;

  const toggleTheaterMode = () => {
    setIsTheaterMode((prev) => {
      if (prev) {
        setIsChatCollapsed(false);
      }
      return !prev;
    });
  };

  // The current media URL shown back in the input bar when it's a YouTube link
  const currentYoutubeUrl = /youtube\.com|youtu\.be/.test(roomState?.mediaUrl || "")
    ? roomState.mediaUrl
    : null;

  const handleJoin = (e) => {
    e.preventDefault();
    if (!roomIdInput.trim() || !usernameInput.trim()) return;

    setJoinedRoomId(roomIdInput.trim().toLowerCase());
    setJoinedUsername(usernameInput.trim());
  };

  const handleSelectVideo = (mediaUrl) => emitChangeSource(mediaUrl);

  if (!joinedRoomId) {
    return (
      <>
        <ServerStatus serverDown={serverDown} />
        <div className="min-h-screen bg-surface text-ink flex flex-col items-center justify-center p-4 font-sans">
          <div className="w-full max-w-sm">
            <div className="text-center mb-8">
              <h1 className="text-4xl font-bold tracking-tight text-brand">
                Vync
              </h1>
              <p className="text-ink-muted text-sm mt-2">
                Watch anything together, from links to files
              </p>
            </div>

            <form onSubmit={handleJoin} className="bg-surface-raise p-6 shadow-2xl space-y-4">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">
                  Username
                </label>
                <input
                  type="text"
                  required
                  placeholder="Sam"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  className="w-full bg-ink/5 border border-ink/10 px-4 py-3 text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-accent transition-shadow"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-ink-muted uppercase tracking-wider block">
                  Room code
                </label>
                <input
                  type="text"
                  required
                  placeholder="12"
                  value={roomIdInput}
                  onChange={(e) => setRoomIdInput(e.target.value)}
                  className="w-full bg-ink/5 border border-ink/10 px-4 py-3 text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-accent transition-shadow"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-accent hover:bg-accent-deep text-on-accent font-bold py-3 transition-colors cursor-pointer"
              >
                Join
              </button>
            </form>
          </div>
        </div>
      </>
    );
  }


  return (
    <>
      <ServerStatus serverDown={serverDown} />
      <main
        className={
          isTheaterMode
            ? "relative h-screen max-h-screen w-screen overflow-hidden bg-black text-ink flex flex-col font-sans p-2 sm:p-3"
            : `min-h-screen bg-surface text-ink flex flex-col font-sans ${
                chatInSidebar ? "lg:h-screen lg:max-h-screen lg:overflow-hidden" : ""
              }`
        }
      >
        {/* Top-left subtle Vync branding in theater mode */}
        {isTheaterMode && (
          <div className="absolute top-4 left-5 sm:left-6 z-30 flex items-center select-none pointer-events-none">
            <span className="text-xl font-bold tracking-tight text-white select-none">
              Vync
            </span>
          </div>
        )}

        {/* Top-right controls when chat is collapsed in theater mode */}
        {isTheaterMode && isChatCollapsed && (
          <div className="absolute top-4 right-4 sm:right-6 z-30 flex flex-col items-end gap-2.5">
            <button
              type="button"
              onClick={toggleTheaterMode}
              aria-label="Exit theater mode"
              title="Exit theater mode (Esc)"
              className="w-8 h-8 rounded-md bg-surface-raise/90 hover:bg-surface-raise border border-ink/15 text-white flex items-center justify-center shadow-lg backdrop-blur-sm transition-all cursor-pointer hover:border-ink/30 hover:scale-105 active:scale-95"
            >
              <Minimize2 className="w-4 h-4 text-white" />
            </button>
            <button
              type="button"
              onClick={() => setIsChatCollapsed(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-raise/90 hover:bg-surface-raise border border-ink/15 text-xs font-semibold text-white shadow-lg backdrop-blur-sm transition-all cursor-pointer hover:border-ink/30 hover:scale-105 active:scale-95 whitespace-nowrap"
              title="Return to original theater mode with chat"
            >
              <span className="w-1 h-1 rounded-2px bg-green-500 animate-pulse shrink-0" />
              <span>Live Chat</span>
            </button>
          </div>
        )}

        <div
          className={
            isTheaterMode
              ? "flex-1 flex min-h-0 flex-row gap-2 sm:gap-3 w-full h-full items-center"
              : "flex-1 flex min-h-0 flex-col lg:flex-row lg:gap-4 xl:gap-6"
          }
        >
          {/* Player column: sized to fit perfectly within the viewport height without scrolling */}
          <div
            style={
              isTheaterMode
                ? undefined
                : chatInSidebar
                ? { maxWidth: "calc((100dvh - 9rem) * 16 / 9)" }
                : undefined
            }
            className={
              isTheaterMode
                ? "flex-1 min-w-0 h-full flex items-center justify-center bg-black overflow-hidden"
                : "flex-1 min-w-0 w-full py-3 lg:py-4 space-y-3 flex flex-col pl-4 sm:pl-6 lg:pl-8 pr-4 sm:pr-6 lg:pr-0"
            }
          >
            {/* Top Bar: Vync Logo (top left) + Shrunk LinkInput (hidden in theater mode) */}
            {!isTheaterMode && (
              <div className="flex items-center gap-3 w-full">
                <VyncLogo />
                <div className="flex-1 min-w-0">
                  <LinkInput
                    key={currentYoutubeUrl || ""}
                    onSelect={handleSelectVideo}
                    currentUrl={currentYoutubeUrl}
                    action={
                      <PickFileButton
                        emitChangeSource={emitChangeSource}
                        hasLoadedFile={roomState?.mediaUrl?.startsWith("blob:")}
                      />
                    }
                  />
                </div>
              </div>
            )}

            {/* Video player wrapper: expands to maximum possible 16:9 bounds without covering buttons */}
            <div
              className={isTheaterMode ? "w-full flex items-center justify-center" : "w-full"}
              style={
                isTheaterMode
                  ? isChatCollapsed
                    ? {
                        maxWidth:
                          "min(max(280px, calc(100% - 14rem)), calc((100dvh - 2rem) * 16 / 9), calc((100vh - 2rem) * 16 / 9))",
                      }
                    : {
                        maxWidth:
                          "min(100%, calc((100dvh - 1.5rem) * 16 / 9), calc((100vh - 1.5rem) * 16 / 9))",
                      }
                  : undefined
              }
            >
              <UnifiedPlayer
                roomState={roomState}
                emitPlay={emitPlay}
                emitPause={emitPause}
                emitSeek={emitSeek}
                emitBuffering={emitBuffering}
              />
            </div>

            {/* Video title, just below the player (hidden in theater mode) */}
            {!isTheaterMode && mediaTitle && (
              <h2
                className="text-ink text-base sm:text-lg lg:text-xl font-bold tracking-tight truncate select-none leading-snug"
                title={mediaTitle}
              >
                {mediaTitle}
              </h2>
            )}

            {/* Chat below the player (mobile fallback, hidden in theater mode or on desktop) */}
            {!isTheaterMode && (
              <div className="lg:hidden space-y-2.5">
                <RoomInfoBox
                  username={joinedUsername}
                  roomId={joinedRoomId}
                  members={roomState?.members}
                />
                <div className="h-96">
                  <ChatPanel
                    messages={messages}
                    onSend={sendMessage}
                    isTheaterMode={isTheaterMode}
                    onToggleTheater={toggleTheaterMode}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Chat sidebar on right side: visible in theater mode or on desktop */}
          <aside
            className={
              isTheaterMode
                ? `${
                    isChatCollapsed
                      ? "hidden"
                      : "flex flex-col w-[40%] sm:w-[320px] md:w-[340px] lg:w-[360px] xl:w-[380px] max-w-[45vw] shrink-0 h-full min-h-0"
                  }`
                : "hidden lg:flex flex-col gap-2.5 flex-1 min-w-[280px] max-w-[420px] 2xl:max-w-[460px] py-3 lg:py-4 pr-4 sm:pr-6 lg:pr-8 min-h-0 h-full"
            }
          >
            {!isTheaterMode && (
              <RoomInfoBox
                username={joinedUsername}
                roomId={joinedRoomId}
                members={roomState?.members}
              />
            )}
            <div className="flex-1 min-h-0 w-full">
              <ChatPanel
                messages={messages}
                onSend={sendMessage}
                isTheaterMode={isTheaterMode}
                onToggleTheater={toggleTheaterMode}
                onCollapseChat={() => setIsChatCollapsed(true)}
              />
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}