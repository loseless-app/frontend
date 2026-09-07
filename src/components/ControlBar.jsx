import React, { useState } from "react";
import { Link2, Play } from "lucide-react";

// Bottom URL Input Bar matching reference design layout
export function ControlBar({ onLinkSubmit, isHost }) {
  const [urlInput, setUrlInput] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    let trimmed = urlInput.trim();
    if (!trimmed) return;

    // Auto-prepend https:// if user pasted a link without protocol (e.g. youtu.be/...)
    if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith("blob:")) {
      trimmed = `https://${trimmed}`;
    }

    onLinkSubmit(trimmed);
    setUrlInput("");
  };

  return (
    <div className="w-full pt-1">
      <form
        onSubmit={handleSubmit}
        className="w-full bg-[#121218] border border-zinc-800/80 rounded-xl p-2 pl-4 flex items-center justify-between gap-3 shadow-lg"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Link2 className="w-4 h-4 text-zinc-500 shrink-0" />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Paste YouTube, Vimeo, Dailymotion, or MP4 link..."
            className="w-full bg-transparent border-none text-xs text-white placeholder-zinc-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          className="bg-[#22222C] hover:bg-[#2A2A36] active:scale-95 text-zinc-200 border border-zinc-700/60 text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
        >
          <Play className="w-3.5 h-3.5 fill-zinc-200" />
          <span>Load</span>
        </button>
      </form>
    </div>
  );
}
