import React, { useState } from "react";
import { Link2, Play, X } from "lucide-react";

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

  const handleClear = () => {
    setLink("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full bg-surface-raise shadow-md py-1 px-1.5 flex items-center gap-1.5 sm:gap-2 border border-ink/10"
    >
      <Link2 className="w-3.5 h-3.5 text-ink-muted ml-2 shrink-0" />
      <input
        type="url"
        required
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder="Paste a YouTube, Vimeo, Twitch or any media link..."
        className="flex-1 min-w-0 bg-transparent py-1.5 text-xs sm:text-sm text-ink placeholder-ink-muted focus:outline-none"
      />
      {link && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear link"
          title="Clear link"
          className="p-1 text-ink-muted hover:text-ink hover:bg-ink/10 rounded-full transition-colors cursor-pointer shrink-0"
        >
          <X className="w-3 h-3" />
        </button>
      )}
      <button
        type="submit"
        className="bg-accent hover:bg-accent-deep text-on-accent text-xs sm:text-sm font-semibold px-3.5 sm:px-4 py-1.5 flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
      >
        <Play className="w-3 h-3 fill-current ml-0.5" />
        <span>Play</span>
      </button>
      {action}
    </form>
  );
}
