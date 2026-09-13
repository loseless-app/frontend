import React, { useRef, useState, useEffect } from "react";
import { Send, Equal, Columns2 } from "lucide-react";

function formatTime(message) {
  if (message.time) return message.time;
  if (message.createdAt)
    return new Date(message.createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  return "";
}

export function ChatPanel({ messages, onSend, isSidebar, onToggleLayout }) {
  const listRef = useRef(null);
  const [input, setInput] = useState("");
  const [atBottom, setAtBottom] = useState(true);

  // Auto-scroll when new messages arrive (only if user is already at bottom)
  useEffect(() => {
    if (atBottom && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, atBottom]);

  // Reset atBottom flag on scroll
  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distance < 40);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput("");
  };

  return (
    <div className="flex flex-col h-full w-full bg-surface-raise border border-ink/10 overflow-hidden shadow-xl">
      {/* Header */}
      <div className="px-4 py-3 border-b border-ink/10 flex items-center justify-between shrink-0 bg-surface-raise">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500" />
          <span className="text-xs font-bold text-ink uppercase tracking-wider">
            Live Chat
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleLayout}
          aria-label={isSidebar ? "Move chat below the player" : "Move chat to the right of the player"}
          title={isSidebar ? "Move chat below the player" : "Move chat to the right of the player"}
          className="w-7 h-7 text-ink-muted hover:text-ink flex items-center justify-center transition-colors cursor-pointer shrink-0"
        >
          {isSidebar ? (
            <Equal className="w-3.5 h-3.5" />
          ) : (
            <Columns2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Messages list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0 bg-surface-raise"
      >
        {messages.length === 0 && (
          <p className="text-ink-muted text-xs text-center pt-8 select-none">
            No messages yet — say hi!
          </p>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className="group">
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className="text-xs font-bold text-brand truncate max-w-[120px]">
                {msg.username}
              </span>
              <span className="text-[10px] text-ink-muted shrink-0">
                {formatTime(msg)}
              </span>
            </div>
            <p className="text-sm text-ink break-words leading-relaxed">
              {msg.text}
            </p>
          </div>
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="p-3 border-t border-ink/10 flex items-center gap-2 shrink-0 bg-surface-raise"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 min-w-0 bg-ink/5 border border-ink/10 px-4 py-2 text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-accent/60"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="w-9 h-9 bg-accent hover:bg-accent-deep disabled:bg-ink/10 disabled:text-ink-muted text-on-accent flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:cursor-default"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}