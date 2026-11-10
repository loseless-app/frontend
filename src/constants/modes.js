import { Globe, FileVideo, Radio, Sparkles } from "lucide-react";

/**
 * Supported watch modes in Vync
 */
export const MODES = Object.freeze({
  URL: "url",
  LOCAL_FILE: "file",
  STREAM: "stream",
  NATIVE: "native",
});

/**
 * Single source of truth configuration for all 4 watch modes.
 * Clean, human-friendly specifications without technical jargon.
 */
export const MODES_CONFIG = [
  {
    id: MODES.URL,
    title: "URL Mode",
    shortName: "URL",
    tagline: "Watch YouTube, Twitch, or web links together",
    quality: "Original Source Quality (Up to 4K)",
    qualityBadge: "Web Source",
    capacity: "Unlimited viewers",
    hostBandwidth: "None (Streamed directly from web)",
    storage: "No storage used",
    bestFor: "YouTube videos, Twitch streams, or direct public video links",
    limitations: "Does not support Netflix, Prime Video, or private files",
    icon: Globe,
    status: "active",
    statusBadge: "Active",
  },
  {
    id: MODES.LOCAL_FILE,
    title: "Local File Mode",
    shortName: "Local File",
    tagline: "Watch local video files in original master quality",
    quality: "Original Master Quality (4K HDR / Surround)",
    qualityBadge: "100% Original",
    capacity: "Unlimited viewers",
    hostBandwidth: "Shared directly between friends",
    storage: "Saved to friends' devices (instant if they already have it)",
    bestFor: "High-quality movie nights where you want zero quality loss",
    limitations: "Friends need to download the file if they don't already have it",
    icon: FileVideo,
    status: "active",
    statusBadge: "Active",
  },
  {
    id: MODES.STREAM,
    title: "Stream Local File",
    shortName: "Live Stream",
    tagline: "Stream your video file with zero download wait time",
    quality: "Good Quality (720p – 1080p)",
    qualityBadge: "Instant Play",
    capacity: "1 – 5+ viewers (depends on your upload speed)",
    hostBandwidth: "Streams directly from host computer",
    storage: "0 MB (nothing saved on friends' devices)",
    bestFor: "Casual movie nights or quick watching without waiting for downloads",
    limitations: "Requires good internet upload speed on the host device",
    icon: Radio,
    status: "active",
    statusBadge: "Instant",
    bandwidthTable: [
      {
        viewers: "1 – 2 users",
        upload: "5 – 10 Mbps",
        resolution: "1080p 60fps",
      },
      {
        viewers: "3 – 4 users",
        upload: "15 – 20 Mbps",
        resolution: "720p 60fps / 1080p 30fps",
      },
      {
        viewers: "5+ users",
        upload: "25+ Mbps",
        resolution: "720p 30fps",
      },
    ],
  },
  {
    id: MODES.NATIVE,
    title: "Stream in Original Quality",
    shortName: "Original Stream",
    tagline: "Watch in original master quality without saving files to disk",
    quality: "Original Master Quality (4K)",
    qualityBadge: "Full Quality",
    capacity: "Unlimited viewers",
    hostBandwidth: "Streams on-demand",
    storage: "0 MB (no permanent files saved)",
    bestFor: "High-quality viewing without download wait or using disk space",
    limitations: "Coming soon",
    icon: Sparkles,
    status: "upcoming",
    statusBadge: "Coming Soon",
  },
];

/**
 * Retrieve configuration for a specific mode with safe fallback to URL mode
 * @param {string} modeId
 * @returns {typeof MODES_CONFIG[number]}
 */
export function getModeConfig(modeId) {
  return (
    MODES_CONFIG.find((mode) => mode.id === modeId) || MODES_CONFIG[0]
  );
}
