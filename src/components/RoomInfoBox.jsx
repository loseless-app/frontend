import React, { useState, useRef, useEffect } from "react";
import { User, Users, ChevronDown, Copy, Check, Share2 } from "lucide-react";

export function RoomInfoBox({ username, roomId, members = [] }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };

    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dropdownOpen]);

  // Ensure self is in the members list if not already populated
  const memberList =
    members && members.length > 0
      ? members
      : username
      ? [{ socketId: "self", username }]
      : [];

  const membersCount = memberList.length;

  const handleCopyRoomCode = async () => {
    if (!roomId) return;
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(false);
    }
  };

  const handleShareLink = async () => {
    try {
      const shareUrl = window.location.href;
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
      }
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      setShareCopied(false);
    }
  };

  return (
    <div className="w-full bg-surface-raise border border-ink/10 shadow-lg p-2.5 sm:p-3 shrink-0 select-none">
      {/* Top row: username (left) & user count with dropdown (right) */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-full bg-ink/10 flex items-center justify-center shrink-0">
            <User className="w-3 h-3 text-ink" />
          </div>
          <span
            className="text-xs font-bold text-ink truncate max-w-[120px] sm:max-w-[150px]"
            title={username}
          >
            {username}
          </span>
        </div>

        {/* Member count + dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen((prev) => !prev)}
            aria-expanded={dropdownOpen}
            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-ink/5 hover:bg-ink/10 border border-ink/10 text-ink transition-colors cursor-pointer"
            title="View users in room"
          >
            <Users className="w-3.5 h-3.5 text-ink-muted" />
            <span className="font-semibold text-ink">{membersCount}</span>
            <ChevronDown
              className={`w-3 h-3 text-ink-muted transition-transform duration-150 ${
                dropdownOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {/* Users in room dropdown */}
          {dropdownOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] w-48 bg-surface-raise border border-ink/15 shadow-2xl rounded-lg py-1.5 z-50 text-ink animate-in fade-in duration-150">
              <div className="px-3 py-1 border-b border-ink/5 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                  Users in room
                </span>
                <span className="text-[10px] font-bold text-brand bg-brand/10 px-1.5 py-0.5 rounded-full">
                  {membersCount} online
                </span>
              </div>
              <div className="max-h-40 overflow-y-auto py-1 divide-y divide-ink/5">
                {memberList.map((m, idx) => {
                  const isSelf = m.username === username;
                  return (
                    <div
                      key={m.socketId || idx}
                      className="px-3 py-1.5 flex items-center justify-between gap-2 text-xs hover:bg-ink/5"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                        <span className="truncate text-ink font-medium" title={m.username}>
                          {m.username}
                        </span>
                      </div>
                      {isSelf && (
                        <span className="text-[9px] text-ink-muted bg-ink/10 px-1 py-0.5 rounded font-mono shrink-0">
                          you
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: room code (left) & share link button (right) */}
      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-ink/10">
        <button
          type="button"
          onClick={handleCopyRoomCode}
          className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors cursor-pointer group"
          title="Click to copy room code"
        >
          <span className="text-[11px] font-medium text-ink-muted">Room:</span>
          <span className="font-mono font-bold text-ink px-1.5 py-0.5 bg-ink/5 border border-ink/10 rounded tracking-wide">
            {roomId}
          </span>
          {copied ? (
            <span className="flex items-center gap-1 text-[11px] text-green-500 font-semibold">
              <Check className="w-3 h-3" />
              <span>Copied</span>
            </span>
          ) : (
            <Copy className="w-3 h-3 text-ink-muted group-hover:text-ink transition-colors" />
          )}
        </button>

        <button
          type="button"
          onClick={handleShareLink}
          className="flex items-center gap-1 text-xs font-semibold px-2 py-1 bg-ink/5 hover:bg-ink/10 border border-ink/10 text-ink transition-colors cursor-pointer rounded"
          title="Share room link"
        >
          {shareCopied ? (
            <>
              <Check className="w-3 h-3 text-green-500" />
              <span className="text-green-500 text-[11px]">Copied</span>
            </>
          ) : (
            <>
              <Share2 className="w-3 h-3 text-ink-muted" />
              <span>Share</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
