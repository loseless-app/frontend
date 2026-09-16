import React, { useState } from "react";
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

export default function App() {
  const [roomIdInput, setRoomIdInput] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [joinedRoomId, setJoinedRoomId] = useState(null);
  const [joinedUsername, setJoinedUsername] = useState(null);
  const [isChatSidebar, setIsChatSidebar] = useState(true); // true: chat on the right, false: chat below

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

  // Effective chat layout: below the player when toggled OR on small windows,
  // where a right-hand sidebar doesn't fit regardless of the user's preference.
  const isDesktop = useMediaQuery("(min-width: 1024px)"); // matches Tailwind's `lg`
  const chatInSidebar = isChatSidebar && isDesktop;
  const chatWideBelow = !isChatSidebar && isDesktop; // manual "below" on a wide window → extra padding

  const toggleChatLayout = () => setIsChatSidebar((prev) => !prev);

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
                loseless
              </h1>
              <p className="text-ink-muted text-sm mt-2">
                Synchronized video watch party
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

  const watchingCount = roomState?.members?.length || 1;

  return (
    <>
      <ServerStatus serverDown={serverDown} />
      <main className="min-h-screen bg-surface text-ink flex flex-col font-sans">
        <div className={`flex-1 flex min-h-0 ${isChatSidebar ? "flex-col lg:flex-row lg:gap-4" : "flex-col"}`}>
          {/* Player column: expands + gains 4x side padding only when the chat is
              manually moved below on a wide screen; keeps normal padding on
              small windows where the chat is pushed below automatically */}
          <div
            className={`flex-[2] min-w-0 w-full py-4 space-y-6 flex flex-col ${
              chatWideBelow ? "px-32 max-w-none" : "px-8 max-w-6xl"
            }`}
          >
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

            <UnifiedPlayer
              roomState={roomState}
              emitPlay={emitPlay}
              emitPause={emitPause}
              emitSeek={emitSeek}
              emitBuffering={emitBuffering}
            />

            {/* Video title, just below the player */}
            {mediaTitle && (
              <p className="text-ink text-sm font-medium truncate" title={mediaTitle}>
                {mediaTitle}
              </p>
            )}

            {/* Room stats: viewer count and room id on the left */}
            <div className="flex items-center gap-2 text-sm select-none">
              <span className="text-ink font-semibold">
                {watchingCount} watching
              </span>
              <span className="text-ink/30">•</span>
              <span className="text-ink-muted">room {joinedRoomId}</span>
            </div>

            {/* Chat below the player (mobile fallback in sidebar mode, or explicit toggle) */}
            <div className={`${isChatSidebar ? "lg:hidden" : ""} h-96`}>
              <ChatPanel
                messages={messages}
                onSend={sendMessage}
                isSidebar={chatInSidebar}
                onToggleLayout={toggleChatLayout}
              />
            </div>
          </div>

          {/* Chat sidebar on desktop when in sidebar mode */}
          {isChatSidebar && (
            <aside className="hidden lg:flex flex-1 min-w-0 py-4 pr-8">
              <ChatPanel
                messages={messages}
                onSend={sendMessage}
                isSidebar={chatInSidebar}
                onToggleLayout={toggleChatLayout}
              />
            </aside>
          )}
        </div>
      </main>
    </>
  );
}