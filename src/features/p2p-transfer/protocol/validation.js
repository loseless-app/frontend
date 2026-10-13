/**
 * P2P WebRTC Transfer Validation & Sanitization
 *
 * Validates protocol headers, metadata bounds, MIME types, and sanitizes filenames
 * against directory traversal, control character injection, and reserved names.
 */

import { DEFAULT_TRANSFER_LIMITS, DEFAULT_MIME_TYPE } from "./messages.js";

const DEFAULT_FALLBACK_FILENAME = "download.bin";

/**
 * Validates and sanitizes filenames against path traversal, control characters,
 * Windows reserved device names, and excessive lengths.
 */
export function validateAndSanitizeFilename(rawName) {
  if (typeof rawName !== "string" || !rawName.trim()) {
    return { isValid: false, sanitizedName: DEFAULT_FALLBACK_FILENAME, error: "Filename must be a non-empty string" };
  }

  // Reject explicit path traversal attempts and null bytes
  if (rawName.includes("\0") || /(^|[/\\])\.\.([/\\]|$)/.test(rawName)) {
    return { isValid: false, sanitizedName: DEFAULT_FALLBACK_FILENAME, error: "Filename contains path traversal sequence" };
  }

  // Strip path prefixes if supplied (e.g. /path/to/video.mp4 -> video.mp4)
  const segments = rawName.split(/[/\\]/).filter(Boolean);
  const base = segments.length > 0 ? segments[segments.length - 1] : "";

  // Strip control characters (0x00-0x1F, 0x7F)
  // eslint-disable-next-line no-control-regex
  let clean = base.replace(/[\x00-\x1f\x7f]/g, "").trim();

  // Strip leading/trailing dots and whitespace
  clean = clean.replace(/^\.+/, "").replace(/\.+$/, "").trim();

  if (!clean || clean === "." || clean === "..") {
    return { isValid: false, sanitizedName: DEFAULT_FALLBACK_FILENAME, error: "Filename cannot consist solely of dots or whitespace" };
  }

  // Check against Windows reserved device names: CON, PRN, AUX, NUL, COM1-9, LPT1-9
  const baseNameWithoutExt = clean.split(".")[0];
  const reservedRegex = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  if (reservedRegex.test(baseNameWithoutExt)) {
    clean = `file_${clean}`;
  }

  // Enforce max length of 255 characters (preserve extension if truncated)
  if (clean.length > 255) {
    const extIdx = clean.lastIndexOf(".");
    if (extIdx !== -1 && clean.length - extIdx < 20) {
      const ext = clean.substring(extIdx);
      clean = clean.substring(0, 255 - ext.length) + ext;
    } else {
      clean = clean.substring(0, 255);
    }
  }

  return { isValid: true, sanitizedName: clean };
}

/**
 * Validates MIME type syntax and falls back to safe generic binary stream
 * for dangerous active content or malformed types.
 *
 * NOTE: Filename and MIME type are untrusted metadata provided by the remote peer.
 * Syntactic checks and fallbacks ensure safe download behavior and prevent header
 * corruption, but do not serve as a malware detection or content-security boundary.
 * The receiver must treat downloaded payload bytes as untrusted data.
 */
export function validateMimeType(rawMime) {
  if (typeof rawMime !== "string" || !rawMime.trim()) {
    return { isValid: false, sanitizedType: DEFAULT_MIME_TYPE, error: "MIME type must be a non-empty string" };
  }

  const trimmed = rawMime.trim().toLowerCase();
  if (trimmed.length > 128) {
    return { isValid: false, sanitizedType: DEFAULT_MIME_TYPE, error: "MIME type exceeds maximum length of 128 characters" };
  }

  const mimeRegex = /^[a-z0-9!#$&^_.+-]{1,64}\/[a-z0-9!#$&^_.+-]{1,64}$/;
  if (!mimeRegex.test(trimmed)) {
    return { isValid: false, sanitizedType: DEFAULT_MIME_TYPE, error: "Malformed MIME type syntax" };
  }

  const forbiddenTypes = [
    "text/javascript",
    "application/javascript",
    "application/x-javascript",
    "text/html",
    "application/xhtml+xml",
  ];
  if (forbiddenTypes.includes(trimmed)) {
    return { isValid: false, sanitizedType: DEFAULT_MIME_TYPE, error: "Forbidden executable MIME type" };
  }

  return { isValid: true, sanitizedType: trimmed };
}

/**
 * Validates incoming HEADER metadata packet against protocol limits.
 */
export function validateFileHeader(header, limits = DEFAULT_TRANSFER_LIMITS) {
  if (!header || typeof header !== "object") {
    return { isValid: false, error: "Header must be a non-null object" };
  }

  if (header.type !== "HEADER") {
    return { isValid: false, error: `Invalid header packet type: expected 'HEADER', got '${header.type}'` };
  }

  // 1. Validate fileSize (supports 0-byte empty files)
  const { fileSize } = header;
  if (typeof fileSize !== "number" || !Number.isSafeInteger(fileSize) || fileSize < 0) {
    return { isValid: false, error: `Invalid fileSize: must be a non-negative integer, got ${fileSize}` };
  }
  if (fileSize > limits.maxFileSize) {
    return { isValid: false, error: `fileSize (${fileSize} bytes) exceeds maximum allowable limit (${limits.maxFileSize} bytes)` };
  }

  // 2. Validate chunkSize
  const { chunkSize } = header;
  const minChunk = (fileSize > 0 && fileSize < limits.minChunkSize && header.totalChunks === 1) ? fileSize : limits.minChunkSize;
  if (typeof chunkSize !== "number" || !Number.isSafeInteger(chunkSize) || chunkSize < minChunk || chunkSize > limits.maxChunkSize) {
    return { isValid: false, error: `Invalid chunkSize: must be between ${minChunk} and ${limits.maxChunkSize} bytes, got ${chunkSize}` };
  }

  // 3. Validate totalChunks (0 for empty files)
  const expectedTotalChunks = fileSize === 0 ? 0 : Math.ceil(fileSize / chunkSize);
  const { totalChunks } = header;
  if (typeof totalChunks !== "number" || !Number.isSafeInteger(totalChunks) || totalChunks < 0) {
    return { isValid: false, error: `Invalid totalChunks: must be a non-negative integer, got ${totalChunks}` };
  }
  if (totalChunks !== expectedTotalChunks) {
    return {
      isValid: false,
      error: `Inconsistent totalChunks: header announced ${totalChunks}, but fileSize ${fileSize} with chunkSize ${chunkSize} requires ${expectedTotalChunks}`,
    };
  }
  const maxChunkCount = limits.maxChunkCount || limits.maxTotalChunks;
  if (maxChunkCount && totalChunks > maxChunkCount) {
    return { isValid: false, error: `totalChunks (${totalChunks}) exceeds maximum allowable chunk limit (${maxChunkCount})` };
  }

  // 4. Validate and sanitize fileName
  const nameRes = validateAndSanitizeFilename(header.fileName);
  if (!nameRes.isValid && !nameRes.sanitizedName) {
    return { isValid: false, error: `Invalid fileName: ${nameRes.error}` };
  }

  // 5. Validate MIME type
  const mimeRes = validateMimeType(header.fileType || header.mimeType || DEFAULT_MIME_TYPE);

  return {
    isValid: true,
    error: null,
    sanitizedHeader: {
      type: "HEADER",
      fileName: nameRes.sanitizedName,
      fileSize,
      fileType: mimeRes.sanitizedType,
      totalChunks,
      chunkSize,
    },
  };
}
