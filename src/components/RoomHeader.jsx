import React from "react";

// Sleek top header navigation bar matching the background tone
export function RoomHeader({ roomId, roomState, isConnected }) {
  const members = roomState?.members || [];
  const isPlaying = roomState?.isPlaying;

  // Background colors for user avatars
  const AVATAR_COLORS = [
    "bg-emerald-600 text-white border-emerald-500",
    "bg-slate-700 text-slate-100 border-slate-600",
    "bg-indigo-600 text-white border-indigo-500",
    "bg-amber-600 text-white border-amber-500",
    "bg-rose-600 text-white border-rose-500",
  ];

  return (
    <header className="w-full bg-[#07070A] border-b border-zinc-800/80 px-6 py-2.5 flex items-center justify-between sticky top-0 z-50 shrink-0">
      {/* Left: Brand Logo */}
      <div className="flex items-center space-x-3">
        <span className="font-serif text-[21px] font-bold tracking-tight text-white italic select-none">
          loseless
        </span>
      </div>

      {/* Center: Room Status */}
      <div className="flex items-center space-x-2 text-xs">
        <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800/60 text-emerald-400 font-semibold flex items-center gap-1 text-[11px]">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          LIVE
        </span>
        <span className="text-zinc-600">•</span>
        <span className="text-zinc-400 font-medium capitalize">
          {isPlaying ? "Playing" : "Paused"}
        </span>
      </div>

      {/* Right: Avatar Stack & Active Watcher Count */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center -space-x-2">
          {members.slice(0, 4).map((member, idx) => (
            <div
              key={member.socketId || idx}
              title={member.username}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 shadow-sm ${
                AVATAR_COLORS[idx % AVATAR_COLORS.length]
              }`}
            >
              {member.username ? member.username.charAt(0).toUpperCase() : "U"}
            </div>
          ))}
        </div>
        <span className="text-xs font-medium text-zinc-400">
          {members.length || 1} watching
        </span>
      </div>
    </header>
  );
}
