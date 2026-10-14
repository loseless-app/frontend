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
export function validateAndSanitizeFilename(rawName, maxFilenameLength = 255) {
  if (typeof rawName !== "string" || !rawName.trim()) {
    return { isValid: false, sanitizedName: null, error: "Filename must be a non-empty string" };
  }

  // Reject explicit path traversal attempts and null bytes
  if (rawName.includes("\0") || /(^|[/\\])\.\.([/\\]|$)/.test(rawName)) {
    return { isValid: false, sanitizedName: null, error: "Filename contains path traversal sequence" };
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
    return { isValid: false, sanitizedName: null, error: "Filename cannot consist solely of dots or whitespace" };
  }

  // Check against Windows reserved device names: CON, PRN, AUX, NUL, COM1-9, LPT1-9
  const baseNameWithoutExt = clean.split(".")[0];
  const reservedRegex = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  if (reservedRegex.test(baseNameWithoutExt)) {
    clean = `file_${clean}`;
  }

  // Enforce max length (preserve extension if truncated)
  const maxLength =
    typeof maxFilenameLength === "number" && Number.isSafeInteger(maxFilenameLength) && maxFilenameLength > 0
      ? maxFilenameLength
      : 255;
  if (clean.length > maxLength) {
    const extIdx = clean.lastIndexOf(".");
    if (extIdx !== -1 && clean.length - extIdx < 20 && maxLength > (clean.length - extIdx)) {
      const ext = clean.substring(extIdx);
      clean = clean.substring(0, maxLength - ext.length) + ext;
    } else {
      clean = clean.substring(0, maxLength);
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
 * Validates, normalizes, and seals transfer limits.
 * Merges custom limits with DEFAULT_TRANSFER_LIMITS, validates positive integer constraints,
 * checks relational bounds (min <= max, low watermark < high watermark), and resolves aliases.
 *
 * @param {object|null|undefined} customLimits - Optional custom transfer limits
 * @returns {Readonly<object>} Normalized, validated, and frozen transfer limits
 * @throws {TypeError|RangeError} If limits structure, types, or relational constraints are violated
 */
export function validateTransferLimits(customLimits = null) {
  if (customLimits === null || customLimits === undefined) {
    return DEFAULT_TRANSFER_LIMITS;
  }

  if (typeof customLimits !== "object" || Array.isArray(customLimits)) {
    throw new TypeError("limits must be a non-null object");
  }

  const positiveIntFields = [
    "maxFileSize",
    "maxMemoryFileSize",
    "minChunkSize",
    "maxChunkSize",
    "defaultChunkSize",
    "maxChunkCount",
    "maxTotalChunks",
    "maxFilenameLength",
    "ackTimeoutMs",
    "watchdogTimeoutMs",
    "connectionTimeoutMs",
    "inactivityTimeoutMs",
    "maxInFlightBytes",
    "receiverBufferHighWatermark",
    "receiverBufferLowWatermark",
    "bufferHighWatermark",
    "bufferLowWatermark",
    "pauseTimeoutMs",
    "flowControlTimeoutMs",
    "disconnectGraceTimeoutMs",
    "maxPendingIceCandidates",
    "drainTimeoutMs",
    "bufferDrainTimeoutMs",
  ];

  for (const field of positiveIntFields) {
    if (customLimits[field] !== undefined) {
      const val = customLimits[field];
      if (typeof val !== "number" || !Number.isSafeInteger(val) || val <= 0) {
        throw new TypeError(`limits.${field} must be a positive integer, got ${val}`);
      }
    }
  }

  // Validate chunk count aliases consistency if both are present
  if (
    customLimits.maxChunkCount !== undefined &&
    customLimits.maxTotalChunks !== undefined &&
    customLimits.maxChunkCount !== customLimits.maxTotalChunks
  ) {
    throw new RangeError(
      `Conflicting limits: maxChunkCount (${customLimits.maxChunkCount}) and maxTotalChunks (${customLimits.maxTotalChunks}) must agree`
    );
  }

  const merged = {
    ...DEFAULT_TRANSFER_LIMITS,
    ...customLimits,
  };

  if (customLimits.maxChunkCount !== undefined) {
    merged.maxTotalChunks = customLimits.maxChunkCount;
  } else if (customLimits.maxTotalChunks !== undefined) {
    merged.maxChunkCount = customLimits.maxTotalChunks;
  }

  if (merged.minChunkSize > merged.maxChunkSize) {
    throw new RangeError("minChunkSize cannot exceed maxChunkSize");
  }

  if (merged.maxInFlightBytes < merged.minChunkSize) {
    throw new RangeError("maxInFlightBytes cannot be less than minChunkSize");
  }

  if (merged.receiverBufferLowWatermark >= merged.receiverBufferHighWatermark) {
    throw new RangeError("receiverBufferLowWatermark must be strictly less than receiverBufferHighWatermark");
  }

  if (merged.bufferLowWatermark >= merged.bufferHighWatermark) {
    throw new RangeError("bufferLowWatermark must be strictly less than bufferHighWatermark");
  }

  return Object.freeze(merged);
}

/**
 * Validates incoming HEADER metadata packet against protocol limits.
 */
export function validateFileHeader(header, limits = DEFAULT_TRANSFER_LIMITS) {
  let activeLimits;
  try {
    activeLimits = validateTransferLimits(limits);
  } catch (err) {
    return { isValid: false, error: `Invalid transfer limits: ${err.message}` };
  }

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
  if (fileSize > activeLimits.maxFileSize) {
    return { isValid: false, error: `fileSize (${fileSize} bytes) exceeds maximum allowable limit (${activeLimits.maxFileSize} bytes)` };
  }

  // 2. Validate chunkSize
  const { chunkSize } = header;
  const minChunk = (fileSize > 0 && fileSize < activeLimits.minChunkSize && header.totalChunks === 1) ? fileSize : activeLimits.minChunkSize;
  if (typeof chunkSize !== "number" || !Number.isSafeInteger(chunkSize) || chunkSize < minChunk || chunkSize > activeLimits.maxChunkSize) {
    return { isValid: false, error: `Invalid chunkSize: must be between ${minChunk} and ${activeLimits.maxChunkSize} bytes, got ${chunkSize}` };
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
  const maxChunkCount = activeLimits.maxChunkCount || activeLimits.maxTotalChunks;
  if (maxChunkCount && totalChunks > maxChunkCount) {
    return { isValid: false, error: `totalChunks (${totalChunks}) exceeds maximum allowable chunk limit (${maxChunkCount})` };
  }

  // 4. Validate and sanitize fileName
  const maxFilenameLength = activeLimits.maxFilenameLength || DEFAULT_TRANSFER_LIMITS.maxFilenameLength || 255;
  const nameRes = validateAndSanitizeFilename(header.fileName, maxFilenameLength);
  if (!nameRes.isValid) {
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
