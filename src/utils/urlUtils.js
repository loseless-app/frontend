/**
 * Utility functions for URL parsing, deep-linking, address bar sync,
 * and resilient clipboard operations.
 */

/**
 * Extracts and sanitizes the room ID from the current URL query parameters (?room=...).
 * Handles both formatted (WHKZ-4829) and unformatted (whkz4829) strings.
 * Returns null if no room parameter is present or if it contains fewer than 4 characters.
 */
export function getRoomIdFromUrl() {
  if (typeof window === "undefined") return null;

  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("room");
    if (!raw) return null;

    const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length < 4) return null;

    // Canonical format: 4 letters - 4 numbers (or partial if fewer than 8 characters)
    return clean.length >= 8
      ? `${clean.slice(0, 4)}-${clean.slice(4, 8)}`
      : clean;
  } catch (err) {
    console.warn("[urlUtils] Failed to parse room from URL:", err);
    return null;
  }
}

/**
 * Constructs an absolute shareable URL for inviting others to a room.
 * e.g. "http://localhost:5175/?room=WHKZ-4829"
 */
export function buildShareUrl(roomId) {
  if (typeof window === "undefined" || !roomId) return "";

  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set("room", roomId.trim().toUpperCase());
  return url.toString();
}

/**
 * Synchronizes the browser address bar query parameter (?room=...) with the active room state
 * using window.history.replaceState to avoid dirtying the browser's navigation history.
 */
export function syncUrlWithRoom(roomId) {
  if (typeof window === "undefined" || !window.history?.replaceState) return;

  try {
    const url = new URL(window.location.href);
    if (roomId) {
      url.searchParams.set("room", roomId.trim().toUpperCase());
    } else {
      url.searchParams.delete("room");
    }
    window.history.replaceState({}, "", url.toString());
  } catch (err) {
    console.warn("[urlUtils] Failed to sync address bar URL:", err);
  }
}

/**
 * Copies text to the user's clipboard using the modern Clipboard API
 * with an automatic fallback to document.execCommand('copy') for non-secure
 * contexts or restricted iframe environments.
 */
export async function copyToClipboard(text) {
  if (!text) return false;

  // 1. Try modern navigator.clipboard API
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn("[urlUtils] navigator.clipboard failed, attempting fallback:", err);
    }
  }

  // 2. Fallback: temporary off-screen textarea
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    textarea.setAttribute("readonly", "");
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const successful = document.execCommand("copy");
    document.body.removeChild(textarea);
    return successful;
  } catch (err) {
    console.error("[urlUtils] Fallback copy failed:", err);
    return false;
  }
}
