import React, { useState } from "react";
import { useSyncPlayer } from "./hooks/useSyncPlayer.js";
import { RoomHeader } from "./components/RoomHeader.jsx";
import { UnifiedPlayer } from "./components/UnifiedPlayer.jsx";
import { ControlBar } from "./components/ControlBar.jsx";
import { SidePanel } from "./components/SidePanel.jsx";
import { socket } from "./services/socket.js";
import { Play, User, Hash } from "lucide-react";

export default function App() {
  const [roomIdInput, setRoomIdInput] = useState("12");
  const [usernameInput, setUsernameInput] = useState("Sam");
  const [joinedRoomId, setJoinedRoomId] = useState(null);
  const [joinedUsername, setJoinedUsername] = useState(null);
  const [hasJoined, setHasJoined] = useState(false);

  /* ========================================================================== */
  /* 🧪 TEMPORARY DEBUG DIAGNOSTICS STATE (REMOVE IN PRODUCTION) */
  /* ========================================================================== */
  const [localVideoTime, setLocalVideoTime] = useState(0);
  /* ========================================================================== */

  // Initialize Synchronizer Hook
  const {
    roomState,
    clockSkew,
    isConnected,
    error,
    joinRoom,
    emitPlay,
    emitPause,
    emitSeek,
    emitChangeSource,
    emitBuffering,
  } = useSyncPlayer(joinedRoomId, joinedUsername);

  // Handle Joining Room
  const handleJoin = (e) => {
    e.preventDefault();
    if (!roomIdInput.trim() || !usernameInput.trim()) return;

    const cleanRoomId = roomIdInput.trim().toLowerCase();
    const cleanUsername = usernameInput.trim();

    setJoinedRoomId(cleanRoomId);
    setJoinedUsername(cleanUsername);
    setHasJoined(true);
  };

  // Landing Page Join View
  if (!hasJoined) {
    return (
      <div className="min-h-screen bg-[#07070A] text-white flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
        {/* Ambient Glow */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-96 h-96 bg-zinc-800/15 rounded-full blur-3xl pointer-events-none"></div>

        <div className="max-w-md w-full bg-[#121218] border border-zinc-800 rounded-3xl p-8 shadow-2xl backdrop-blur-xl relative z-10 space-y-8">
          {/* Header Brand Badge */}
          <div className="text-center space-y-3">
            <span className="font-serif text-3xl font-bold tracking-tight text-white italic block">
              loseless
            </span>
            <p className="text-xs text-zinc-400">
              Synchronized real-time watch party for YouTube, Vimeo, HLS & MP4
            </p>
          </div>

          {/* Join Form */}
          <form onSubmit={handleJoin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
                Your Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sam"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  className="w-full bg-[#171720] border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
                Room Code / ID
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
                  <Hash className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  placeholder="e.g. 12"
                  value={roomIdInput}
                  onChange={(e) => setRoomIdInput(e.target.value)}
                  className="w-full bg-[#171720] border border-zinc-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3.5 px-4 bg-[#22222C] hover:bg-[#2A2A36] text-white font-semibold rounded-xl shadow-lg border border-zinc-700/60 transition-all flex items-center justify-center space-x-2 cursor-pointer active:scale-[0.99] mt-2"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Join Watch Party</span>
            </button>
          </form>

          {/* Quick Feature Summary */}
          <div className="pt-4 border-t border-zinc-800/80 flex items-center justify-around text-[11px] text-zinc-400">
            <span>⚡ NTP Clock Sync</span>
            <span>👑 Host Control</span>
            <span>🔒 Zero Delay</span>
          </div>
        </div>
      </div>
    );
  }

  // Active Watch Party Dashboard View
  return (
    <main className="min-h-screen bg-[#07070A] text-white relative flex flex-col font-sans">
      {/* Top Header Bar */}
      <RoomHeader
        roomId={joinedRoomId}
        roomState={roomState}
        isConnected={isConnected}
      />

      {/* Main Content Layout Container */}
      <div className="flex-1 max-w-[1680px] w-full mx-auto px-4 sm:px-6 py-4 flex flex-col lg:flex-row gap-6 items-start">
        {/* Left Column: Video Player + Dynamic Title & Source + Control Bar */}
        <div className="flex-1 w-full space-y-4 min-w-0">
          <UnifiedPlayer
            roomState={roomState}
            clockSkew={clockSkew}
            emitPlay={emitPlay}
            emitPause={emitPause}
            emitSeek={emitSeek}
            emitBuffering={emitBuffering}
            /* ========================================================================== */
            /* 🧪 TEMPORARY DEBUG DIAGNOSTICS PROP (REMOVE IN PRODUCTION) */
            /* ========================================================================== */
            onTimeUpdate={setLocalVideoTime}
            /* ========================================================================== */
          />

          <ControlBar
            onLinkSubmit={emitChangeSource}
            isHost={roomState?.hostId === socket?.id}
          />
        </div>

        {/* Right Column: 3-Card Sidebar */}
        <SidePanel
          roomId={joinedRoomId}
          roomState={roomState}
          /* ========================================================================== */
          /* 🧪 TEMPORARY DEBUG DIAGNOSTICS PROP (REMOVE IN PRODUCTION) */
          /* ========================================================================== */
          clockSkew={clockSkew}
          localVideoTime={localVideoTime}
          /* ========================================================================== */
        />
      </div>
    </main>
  );
}
