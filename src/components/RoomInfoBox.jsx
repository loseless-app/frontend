import React, { useState, useRef, useEffect } from "react";
import { User, Users, ChevronDown, Copy, Check, Share2, LogOut, UploadCloud } from "lucide-react";
import { buildShareUrl, copyToClipboard } from "../utils/urlUtils.js";

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function RoomInfoBox({ username, roomId, members = [], onLeave, activeUploads = {} }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [sharePopoverOpen, setSharePopoverOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const dropdownRef = useRef(null);
  const shareRef = useRef(null);

  // Close dropdown or popover on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
      if (shareRef.current && !shareRef.current.contains(e.target)) {
        setSharePopoverOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setDropdownOpen(false);
        setSharePopoverOpen(false);
        setShowLeaveConfirm(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

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
    const success = await copyToClipboard(roomId);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareUrl = roomId ? buildShareUrl(roomId) : "";

  const handleCopyShareUrl = async () => {
    if (!shareUrl) return;
    const success = await copyToClipboard(shareUrl);
    if (success) {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
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

        <div className="flex items-center gap-1.5">
          <div className="relative" ref={shareRef}>
            <button
              type="button"
              onClick={() => setSharePopoverOpen((prev) => !prev)}
              aria-expanded={sharePopoverOpen}
              className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 border text-ink transition-colors cursor-pointer rounded ${
                sharePopoverOpen
                  ? "bg-ink/15 border-ink/20"
                  : "bg-ink/5 hover:bg-ink/10 border-ink/10"
              }`}
              title="Share room link"
            >
              <Share2 className="w-3 h-3 text-ink-muted" />
              <span>Share</span>
            </button>

            {/* Share Popover right below button */}
            {sharePopoverOpen && (
              <div className="absolute right-0 top-[calc(100%+6px)] w-72 sm:w-80 bg-surface-raise border border-ink/15 shadow-2xl rounded-lg p-3 z-50 text-ink animate-in fade-in duration-150 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                    Invite Link
                  </span>
                  <span className="text-[10px] text-ink-muted">Anyone with link can join</span>
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    onFocus={(e) => e.target.select()}
                    className="flex-1 min-w-0 bg-ink/5 border border-ink/10 px-2 py-1.5 text-xs font-mono text-ink rounded focus:outline-none focus:ring-1 focus:ring-accent select-all truncate"
                  />
                  <button
                    type="button"
                    onClick={handleCopyShareUrl}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-accent hover:bg-accent-deep text-on-accent text-xs font-bold rounded transition-colors cursor-pointer"
                  >
                    {shareCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {onLeave && (
            <button
              type="button"
              onClick={() => setShowLeaveConfirm(true)}
              className="flex items-center gap-1 text-xs font-semibold px-2 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500 hover:text-red-600 transition-colors cursor-pointer rounded"
              title="Leave room"
            >
              <LogOut className="w-3 h-3" />
              <span>Leave</span>
            </button>
          )}
        </div>
      </div>

      {/* Active P2P Outgoing Uploads indicator for host */}
      {Object.keys(activeUploads).length > 0 && (
        <div className="mt-2 pt-2 border-t border-ink/10 space-y-2">
          {Object.entries(activeUploads).map(([peerId, upload]) => (
            <div
              key={peerId}
              className="p-2.5 rounded-xl bg-accent/10 border border-accent/20 space-y-1.5 animate-in fade-in duration-150"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <UploadCloud className="w-3.5 h-3.5 text-accent animate-pulse shrink-0" />
                  <span className="truncate text-ink">
                    Sending to <strong className="font-bold">{upload.username}</strong>
                  </span>
                </div>
                <span className="font-mono font-bold text-ink shrink-0">{upload.percent}%</span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-ink/10 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-accent h-full rounded-full transition-all duration-200"
                  style={{ width: `${Math.max(2, upload.percent)}%` }}
                />
              </div>

              {upload.speed ? (
                <div className="text-[10px] text-ink-muted text-right font-mono">
                  {formatBytes(upload.speed)}/s
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Simple Leave Confirmation Modal (No description) */}
      {showLeaveConfirm && (
        <div
          onClick={() => setShowLeaveConfirm(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface-raise border border-ink/15 p-5 shadow-2xl max-w-xs w-full text-center space-y-4 rounded-xl"
          >
            <div className="w-10 h-10 mx-auto rounded-full bg-red-500/10 text-red-500 flex items-center justify-center">
              <LogOut className="w-5 h-5" />
            </div>

            <h3 className="text-base font-bold text-ink">Leave room?</h3>

            <div className="flex gap-2 justify-center pt-1">
              <button
                type="button"
                onClick={() => setShowLeaveConfirm(false)}
                className="px-4 py-2 text-xs font-semibold text-ink-muted hover:text-ink border border-ink/20 hover:bg-ink/5 rounded transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLeaveConfirm(false);
                  onLeave();
                }}
                className="px-4 py-2 text-xs font-bold bg-red-500 hover:bg-red-600 text-white rounded shadow transition-colors cursor-pointer"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
