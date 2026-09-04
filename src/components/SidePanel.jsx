import React, { useState, useEffect } from "react";
import { Copy, Check, Crown, Cpu } from "lucide-react";
import { socket } from "../services/socket.js";

// Sleek 3-Card Sidebar matching exact reference UI styling & light greyish card backgrounds
export function SidePanel({ roomId, roomState, clockSkew = 0, localVideoTime = 0 }) {
  const [copied, setCopied] = useState(false);

  // Static dummy placeholder chat messages matching reference design
  const DUMMY_MESSAGES = [
    { id: "1", username: "Maya", text: "Snacks are mandatory tonight.", time: "8:18 PM", avatarBg: "bg-emerald-500 text-black" },
    { id: "2", username: "Jules", text: "Already ahead of you. This bunny never gets old.", time: "8:19 PM", avatarBg: "bg-[#93C5FD] text-black" },
    { id: "3", username: "Rafi", text: "Wait until the slingshot. Still the best bit.", time: "8:20 PM", avatarBg: "bg-[#FDE68A] text-black" },
  ];

  /* ========================================================================== */
  /* 🧪 TEMPORARY DEBUG DIAGNOSTICS STATE (REMOVE IN PRODUCTION) */
  /* ========================================================================== */
  const [nowLocal, setNowLocal] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowLocal(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  /* ========================================================================== */
  /* 🧪 END TEMPORARY DEBUG DIAGNOSTICS STATE */
  /* ========================================================================== */

  const members = roomState?.members || [
    { socketId: "1", username: "Sam" },
    { socketId: "2", username: "Sam1" },
  ];

  const hostId = roomState?.hostId;
  const isPlaying = roomState?.isPlaying;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(`#${roomId || "NIGHT-482"}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /* ========================================================================== */
  /* 🧪 TEMPORARY DEBUG DIAGNOSTICS CALCULATIONS (REMOVE IN PRODUCTION) */
  /* ========================================================================== */
  let projectedHostTime = roomState?.anchorTime || 0;
  if (roomState?.isPlaying && roomState?.lastStartedAt > 0) {
    const serverNow = nowLocal + clockSkew;
    const elapsed = (serverNow - roomState.lastStartedAt) / 1000;
    projectedHostTime = Math.max(0, roomState.anchorTime + elapsed);
  }
  const videoTimeDiff = localVideoTime - projectedHostTime;
  const absTimeDiff = Math.abs(videoTimeDiff);
  /* ========================================================================== */

  const AVATAR_COLORS = [
    "bg-[#34D399] text-slate-950 font-extrabold",
    "bg-[#E2E8F0] text-slate-900 font-extrabold",
    "bg-[#93C5FD] text-slate-950 font-extrabold",
    "bg-[#FDE68A] text-slate-950 font-extrabold",
  ];

  return (
    <aside className="w-full lg:w-[360px] shrink-0 space-y-4 font-sans">
      {/* CARD 1: ROOM DETAILS - Light Greyish Card Tone */}
      <div className="bg-[#181822] border border-[#2B2C3D] rounded-[20px] p-4.5 space-y-3.5 shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-[#9EA0B5] uppercase tracking-wider">
            ROOM DETAILS
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-[#0B2E1E] border border-[#15803D]/60 text-[#22C55E] text-[10px] font-bold tracking-wider flex items-center gap-1.5 uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-pulse"></span>
            LIVE
          </span>
        </div>

        {/* Share Room Code Box - Same bg-[#07070A] Blackness as Screen */}
        <div className="bg-[#07070A] border border-[#1F2030] rounded-xl p-3.5 flex items-center justify-between shadow-inner">
          <div>
            <span className="text-[11px] text-[#9EA0B5] block font-medium">Share room code</span>
            <span className="text-base font-bold text-white font-serif italic tracking-wide">
              #{roomId ? roomId.toUpperCase() : "NIGHT-482"}
            </span>
          </div>
          <button
            onClick={handleCopyCode}
            className="bg-[#171724] hover:bg-[#222234] p-2.5 rounded-xl text-zinc-400 hover:text-white transition-all cursor-pointer border border-[#27273A]"
            title="Copy Code"
          >
            {copied ? <Check className="w-4 h-4 text-[#22C55E]" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        {/* Status & Playback 2-Column Grid - Same bg-[#07070A] Blackness as Screen */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="bg-[#07070A] border border-[#1F2030] rounded-xl p-3 shadow-inner">
            <span className="text-[11px] text-[#9EA0B5] block font-medium">Status</span>
            <span className="text-xs font-bold text-zinc-100 flex items-center gap-1.5 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              {isPlaying ? "Playing" : "Paused"}
            </span>
          </div>

          <div className="bg-[#07070A] border border-[#1F2030] rounded-xl p-3 shadow-inner">
            <span className="text-[11px] text-[#9EA0B5] block font-medium">Playback</span>
            <span className="text-xs font-bold text-zinc-100 flex items-center gap-1.5 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"></span>
              Synced
            </span>
          </div>
        </div>

        {/* ========================================================================== */}
        {/* 🧪 TEMPORARY DEBUG DIAGNOSTICS SECTION (REMOVE IN PRODUCTION) */}
        {/* ========================================================================== */}
        <div className="bg-[#07070A] border border-cyan-900/40 rounded-xl p-2.5 space-y-1 text-[11px] font-mono">
          <div className="flex items-center justify-between text-cyan-400 font-bold border-b border-cyan-950 pb-1 text-[10px]">
            <span className="flex items-center gap-1"><Cpu className="w-3 h-3" /> Sync Debugger</span>
            <span className="text-cyan-300">TESTING</span>
          </div>
          <div className="flex items-center justify-between text-zinc-400">
            <span>NTP Skew:</span>
            <span className="text-cyan-300">{clockSkew >= 0 ? "+" : ""}{Math.round(clockSkew)} ms</span>
          </div>
          <div className="flex items-center justify-between text-zinc-400">
            <span>Time Diff (Drift):</span>
            <span className={`font-bold ${absTimeDiff < 0.5 ? "text-emerald-400" : "text-amber-400"}`}>
              {videoTimeDiff >= 0 ? "+" : ""}{videoTimeDiff.toFixed(3)}s ({Math.round(videoTimeDiff * 1000)} ms)
            </span>
          </div>
        </div>
        {/* ========================================================================== */}
      </div>

      {/* CARD 2: CONNECTED WATCHERS - Light Greyish Card Tone */}
      <div className="bg-[#181822] border border-[#2B2C3D] rounded-[20px] p-4.5 space-y-3 shadow-2xl">
        <div className="flex items-center justify-between text-[11px] font-bold text-[#9EA0B5] uppercase tracking-wider">
          <span>CONNECTED WATCHERS</span>
          <span className="text-zinc-300 font-semibold">{members.length}</span>
        </div>

        <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
          {members.map((member, idx) => {
            const memberIsHost = (hostId && member.socketId === hostId) || member.isHost || idx === 0;

            // Highlight ONLY the single user viewing on this device
            const isMe = socket?.id
              ? member.socketId === socket.id
              : idx === 0;

            return (
              <div
                key={member.socketId || idx}
                className={`flex items-center justify-between py-2 px-2.5 rounded-xl transition-all ${
                  isMe ? "bg-[#282939]" : "hover:bg-[#212230]"
                }`}
              >
                <div className="flex items-center space-x-3">
                  {/* Avatar Circle with Online Green Indicator Badge */}
                  <div className="relative shrink-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs shadow-sm ${
                      AVATAR_COLORS[idx % AVATAR_COLORS.length]
                    }`}>
                      {member.username.charAt(0).toUpperCase()}
                    </div>
                    <span className="w-2.5 h-2.5 rounded-full bg-[#22C55E] absolute bottom-0 right-0 border-2 border-[#181822]" />
                  </div>
                  <span className="text-xs font-bold text-zinc-100">
                    {member.username}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {memberIsHost && (
                    <span className="text-[10px] bg-[#292A3A] border border-zinc-700/60 text-zinc-300 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                      <Crown className="w-3 h-3 text-amber-300" />
                      HOST
                    </span>
                  )}
                  {isMe && (
                    <span className="text-[10px] bg-[#3B3C52] text-zinc-100 px-2.5 py-0.5 rounded-full font-semibold">
                      YOU
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CARD 3: LIVE CHAT - Light Greyish Card Tone */}
      <div className="bg-[#181822] border border-[#2B2C3D] rounded-[20px] p-4.5 space-y-3 shadow-2xl flex flex-col h-60">
        <div className="flex items-center justify-between text-[11px] font-bold text-[#9EA0B5] uppercase tracking-wider">
          <span>LIVE CHAT</span>
          <span className="text-[#22C55E] text-[10px] font-bold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"></span>
            {members.length} online
          </span>
        </div>

        {/* System Event Banner */}
        <div className="text-[11px] text-[#9EA0B5] text-center font-medium italic">
          Maya started the room
        </div>

        {/* Message History List */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {DUMMY_MESSAGES.map((msg) => (
            <div key={msg.id} className="flex items-start space-x-2.5 text-xs">
              <div className="relative shrink-0 mt-0.5">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold ${msg.avatarBg}`}>
                  {msg.username.charAt(0).toUpperCase()}
                </div>
                <span className="w-2 h-2 rounded-full bg-[#22C55E] absolute bottom-0 right-0 border-2 border-[#181822]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-zinc-100">{msg.username}</span>
                  <span className="text-[10px] text-[#9EA0B5]">{msg.time}</span>
                </div>
                <p className="text-[#D8D9E8] text-xs mt-0.5 leading-relaxed break-words">{msg.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
