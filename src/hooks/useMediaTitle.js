import { useState, useEffect, useMemo } from "react";

// Module-level cache so repeat visits don't re-fetch the same title
const titleCache = new Map();

// blob: URLs don't carry the original file name, so map them back to the
// real name when a local file is picked
const blobTitles = new Map();

// Called by the file-picker with the original file name for the object URL it created
export function registerBlobTitle(blobUrl, fileName) {
  if (blobUrl && fileName) blobTitles.set(blobUrl, fileName);
}

function getOembedUrl(mediaUrl) {
  if (/youtube\.com|youtu\.be/.test(mediaUrl)) {
    return `https://www.youtube.com/oembed?url=${encodeURIComponent(mediaUrl)}&format=json`;
  }
  if (/vimeo\.com/.test(mediaUrl)) {
    return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(mediaUrl)}`;
  }
  return null;
}

// Fallback title from the file name in the URL (blob URLs have no name)
function deriveTitle(mediaUrl) {
  if (mediaUrl.startsWith("blob:")) return blobTitles.get(mediaUrl) || "Local file";
  try {
    const url = new URL(mediaUrl);
    const lastSegment = url.pathname.split("/").filter(Boolean).pop();
    if (lastSegment) return decodeURIComponent(lastSegment).replace(/[._-]+/g, " ").trim();
  } catch {
    // invalid/opaque URL — no title available
  }
  return null;
}

// Resolves the title of the currently playing media via oEmbed where possible
export function useMediaTitle(mediaUrl) {
  // Titles that resolve without a network round-trip (cache hit, or no oEmbed provider)
  const syncTitle = useMemo(() => {
    if (!mediaUrl) return null;
    const cached = titleCache.get(mediaUrl);
    if (cached) return cached.title;
    if (!getOembedUrl(mediaUrl)) return deriveTitle(mediaUrl);
    return null;
  }, [mediaUrl]);

  // Fetched titles, keyed by URL so stale responses can never surface
  const [fetched, setFetched] = useState({ url: null, title: null });

  useEffect(() => {
    if (!mediaUrl || !getOembedUrl(mediaUrl)) return;
    if (titleCache.has(mediaUrl)) return; // covered by syncTitle

    let cancelled = false;

    fetch(getOembedUrl(mediaUrl))
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        const title = data?.title || deriveTitle(mediaUrl) || null;
        titleCache.set(mediaUrl, { title });
        setFetched({ url: mediaUrl, title });
      })
      .catch(() => {
        if (cancelled) return;
        const title = deriveTitle(mediaUrl) || null;
        titleCache.set(mediaUrl, { title });
        setFetched({ url: mediaUrl, title });
      });

    return () => {
      cancelled = true;
    };
  }, [mediaUrl]);

  const liveTitle = fetched.url === mediaUrl ? fetched.title : null;
  return syncTitle ?? liveTitle;
}