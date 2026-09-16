import React, { useState } from "react";
import { Link2 } from "lucide-react";
import { YoutubeIcon } from "./YoutubeIcon.jsx";

// Input bar for pasting a media link + an optional trailing action (pick file).
// `currentUrl` seeds the input value on mount; React `key` remounts the
// component whenever the loaded source changes, giving a fresh state
// automatically — no sync effect needed.
export function LinkInput({ onSelect, currentUrl, action }) {
  const [link, setLink] = useState(currentUrl || "");

  const handleSubmit = (e) => {
    e.preventDefault();
    const url = (link || "").trim();
    if (!url) return;

    onSelect(url);
    // The component will remount (key change) once the new URL is reflected
    // in currentUrl, so there is no need to clear local state here.
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full bg-surface-raise shadow-lg p-1.5 flex items-center gap-2 border border-ink/10"
    >
      <Link2 className="w-4 h-4 text-ink-muted ml-3 shrink-0" />
      <input
        type="url"
        required
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder="Paste a YouTube link…"
        className="flex-1 min-w-0 bg-transparent py-2 text-sm text-ink placeholder-ink-muted focus:outline-none"
      />
      <button
        type="submit"
        className="bg-accent hover:bg-accent-deep text-on-accent text-sm font-bold px-5 py-2.5 flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
      >
        <YoutubeIcon className="w-3.5 h-3.5" />
        <span>Play</span>
      </button>
      {action}
    </form>
  );
}
