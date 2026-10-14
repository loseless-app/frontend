  /**
   * P2P WebRTC Transfer Protocol Message Types & Configuration
   *
   * Defines protocol control message types, chunk sizes, flow control watermarks,
   * resource limits, transfer states, standard WebRTC ICE configurations, and message factories.
   *
   * ============================================================================
   * INTEROPERABILITY & FLOW CONTROL CONTRACT:
   *
   * 1. WebRTC Network Buffer (SCTP Wire Backpressure):
   *    - BUFFER_HIGH_WATERMARK (8 MB): When dataChannel.bufferedAmount reaches this
   *      threshold, the sender halts file slicing and awaits buffer drain.
   *    - BUFFER_LOW_WATERMARK (2 MB): Configured via dataChannel.bufferedAmountLowThreshold.
   *      When bufferedAmount drains to this level, the sender resumes slicing.
   *
   * 2. Receiver Disk Queue Backpressure:
   *    - RECEIVER_BUFFER_HIGH_WATERMARK (4 MB): When unwritten chunks in receiver RAM
   *      reach this threshold, the receiver emits PAUSE to throttle the sender.
   *    - RECEIVER_BUFFER_LOW_WATERMARK (1 MB): When disk I/O flushes the queue below
   *      this threshold, the receiver emits RESUME and DRAIN to resume transmission.
   *
   * 3. Flow-Control Sliding Window:
   *    - maxInFlightBytes (4 MB): Matches RECEIVER_BUFFER_HIGH_WATERMARK. The sender
   *      tracks inFlight = offset - receiverAckedBytes. If inFlight > maxInFlightBytes,
   *      the sender yields until the receiver acknowledges chunk reception.
   *    - CHUNK_ACK: Interim notification sent periodically by receiver to advance
   *      sender's receiverAckedBytes without altering disk pause state.
   *    - DRAIN: Flow-control notification sent specifically when receiver disk queue
   *      drains below low watermark, clearing sender's isReceiverPaused state and
   *      updating receiverAckedBytes.
   *
   * 4. Transfer Completion & Acknowledgment:
   *    - COMPLETE: Sent by sender when all chunks (or 0 chunks for empty files) have
   *      been transmitted, containing canonical SHA-256 checksum.
   *    - ACK: Sent by receiver ONLY after disk writes are flushed, closed, and the
   *      computed hash is verified against expected checksum. Binds verified checksum.
   *    - NACK: Sent by receiver if header validation, quota, write, or hash verification fails.
   * ============================================================================
   */

  function deepFreeze(object) {
    if (object === null || (typeof object !== "object" && typeof object !== "function")) {
      return object;
    }
    const propNames = Reflect.ownKeys(object);
    for (const name of propNames) {
      const value = object[name];
      if ((typeof value === "object" || typeof value === "function") && value !== null && !Object.isFrozen(value)) {
        deepFreeze(value);
      }
    }
    return Object.freeze(object);
  }

  export const MESSAGE_TYPE = deepFreeze({
    HEADER: "HEADER",
    CHUNK: "CHUNK",
    COMPLETE: "COMPLETE",
    ACK: "ACK",
    NACK: "NACK",
    CANCEL: "CANCEL",
    PAUSE: "PAUSE",
    RESUME: "RESUME",
    DRAIN: "DRAIN",
    CHUNK_ACK: "CHUNK_ACK",
  });

  export const SENDER_STATE = deepFreeze({
    IDLE: "IDLE",
    CONNECTING: "CONNECTING",
    SENDING: "SENDING",
    AWAITING_ACK: "AWAITING_ACK",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
  });

  export const RECEIVER_STATE = deepFreeze({
    IDLE: "IDLE",
    CONNECTING: "CONNECTING",
    RECEIVING: "RECEIVING",
    FINALIZING: "FINALIZING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
  });

  /**
   * Recommended application-level chunk payload size (64 KB) for RTCDataChannel.
   * This represents the application data slice size sent per channel.send() call.
   * SCTP fragments this into smaller MTU-sized packets (~1200-1400 bytes) on the wire.
   * 64 KB is chosen for optimal throughput and cross-browser SCTP buffer compatibility.
   */
  export const CHUNK_SIZE = 64 * 1024;

  /**
   * Flow-control backpressure thresholds for RTCDataChannel.bufferedAmount.
   * High watermark: pause file slicing when outgoing network buffer reaches 8 MB.
   * Low watermark: resume file slicing when outgoing network buffer drains down to 2 MB.
   */
  export const BUFFER_HIGH_WATERMARK = 8 * 1024 * 1024;
  export const BUFFER_LOW_WATERMARK = 2 * 1024 * 1024;

  /**
   * Maximum unwritten memory buffer on receiver before signaling PAUSE to sender (4 MB).
   * Low watermark signals RESUME when disk writer flushes buffer down to 1 MB.
   */
  export const RECEIVER_BUFFER_HIGH_WATERMARK = 4 * 1024 * 1024;
  export const RECEIVER_BUFFER_LOW_WATERMARK = 1024 * 1024;

  /**
   * Canonical resource constraint ceilings.
   *
   * maxChunkCount is bounded to 200,000 chunks to protect memory and browser message-loop CPU.
   * A 10 GB file at standard 64 KB chunk size yields 160,000 chunks (safely within the 200k ceiling).
   * Smaller files can use smaller chunks (down to 1 KB) as long as totalChunks <= 200,000.
   */
  export const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB limit
  export const MIN_CHUNK_SIZE = 1024;                   // 1 KB minimum
  export const MAX_CHUNK_SIZE = 1024 * 1024;            // 1 MB maximum
  export const MAX_CHUNK_COUNT = 200000;                // 200,000 max chunks (bounded for CPU/memory safety)

  /**
   * Generic default MIME fallback for unspecified or binary files.
   * Untrusted advisory metadata provided by remote peer.
   */
  export const DEFAULT_MIME_TYPE = "application/octet-stream";

  /**
   * Default resource constraints to protect browser memory and disk.
   */
  export const DEFAULT_TRANSFER_LIMITS = deepFreeze({
    maxFileSize: MAX_FILE_SIZE,
    minChunkSize: MIN_CHUNK_SIZE,
    maxChunkSize: MAX_CHUNK_SIZE,
    defaultChunkSize: CHUNK_SIZE,
    maxChunkCount: MAX_CHUNK_COUNT,        // Canonical chunk count ceiling
    maxTotalChunks: MAX_CHUNK_COUNT,       // Backward-compatibility alias
    maxFilenameLength: 255,
    ackTimeoutMs: 30000,                  // 30s timeout for receiver to ACK completion
    watchdogTimeoutMs: 30000,             // 30s legacy fallback timeout
    connectionTimeoutMs: 20000,           // 20s timeout to establish WebRTC connection and DataChannel
    inactivityTimeoutMs: 20000,           // 20s timeout without receiving meaningful data chunks
    maxInFlightBytes: RECEIVER_BUFFER_HIGH_WATERMARK, // 4 MB flow-control sliding window matching receiver buffer
    receiverBufferHighWatermark: RECEIVER_BUFFER_HIGH_WATERMARK,
    receiverBufferLowWatermark: RECEIVER_BUFFER_LOW_WATERMARK,
    bufferHighWatermark: BUFFER_HIGH_WATERMARK,
    bufferLowWatermark: BUFFER_LOW_WATERMARK,
    pauseTimeoutMs: 15000,                // 15s timeout for receiver to resume when paused
    flowControlTimeoutMs: 15000,          // 15s timeout for receiver to acknowledge in-flight sliding window
    disconnectGraceTimeoutMs: 10000,       // 10s grace period before temporary connection drop is declared failed
    maxPendingIceCandidates: 64,          // Maximum early ICE candidates queued before remote description is set
  });

  /**
   * Public STUN servers for WebRTC ICE candidate negotiation.
   */
  export const RTC_CONFIG = deepFreeze({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  });

  /**
   * Reasonable configuration-size ceilings for RTCIceServer configs.
   */
  export const MAX_ICE_SERVERS = 16;
  export const MAX_ICE_URLS_PER_SERVER = 8;
  export const MAX_ICE_URL_LENGTH = 256;

  const ICE_URL_REGEX =
    /^(stun|stuns|turn|turns):([a-z0-9_.-]+|\[[a-f0-9:.]+\])(?::(\d{1,5}))?(?:\?transport=(udp|tcp))?$/i;

  const ALLOWED_ICE_SERVER_FIELDS = new Set(["urls", "username", "credential", "credentialType"]);

  /**
   * Builds and validates an RTC configuration object supporting optional TURN relays and custom ICE servers.
   * Always returns a fresh, deep-cloned configuration object instead of sharing nested arrays.
   *
   * NOTE: Syntactic validation alone does not guarantee a server is reachable, functional, or trustworthy.
   * Dynamic/ephemeral TURN credentials should be generated by an authenticated backend service.
   *
   * @param {Array<object>|null|undefined} [customIceServers] - Custom STUN/TURN servers
   * @returns {RTCConfiguration} Fresh RTCConfiguration object
   * @throws {TypeError|RangeError} If custom ICE configuration is malformed or exceeds bounds
   */
  export function createRtcConfig(customIceServers = null) {
    if (customIceServers === null || customIceServers === undefined) {
      return {
        iceServers: RTC_CONFIG.iceServers.map((server) => ({
          ...server,
          urls: Array.isArray(server.urls) ? [...server.urls] : server.urls,
        })),
      };
    }

    if (!Array.isArray(customIceServers)) {
      throw new TypeError("customIceServers must be an array of RTCIceServer objects");
    }

    if (customIceServers.length === 0) {
      return {
        iceServers: RTC_CONFIG.iceServers.map((server) => ({
          ...server,
          urls: Array.isArray(server.urls) ? [...server.urls] : server.urls,
        })),
      };
    }

    if (customIceServers.length > MAX_ICE_SERVERS) {
      throw new RangeError(
        `customIceServers exceeds maximum allowable limit of ${MAX_ICE_SERVERS} servers`
      );
    }

    const validatedServers = customIceServers.map((server, index) => {
      if (!server || typeof server !== "object" || Array.isArray(server)) {
        throw new TypeError(`ICE server at index ${index} must be a non-null object`);
      }

      for (const key of Object.keys(server)) {
        if (!ALLOWED_ICE_SERVER_FIELDS.has(key)) {
          throw new TypeError(`ICE server at index ${index} contains unsupported field '${key}'`);
        }
      }

      if (server.urls === undefined || server.urls === null) {
        throw new TypeError(`ICE server at index ${index} is missing required 'urls' property`);
      }

      if (!Array.isArray(server.urls) && typeof server.urls !== "string") {
        throw new TypeError(`ICE server at index ${index} 'urls' property must be a string or array of strings`);
      }

      const rawUrls = Array.isArray(server.urls) ? server.urls : [server.urls];
      if (rawUrls.length === 0) {
        throw new TypeError(`ICE server at index ${index} has empty 'urls' array`);
      }
      if (rawUrls.length > MAX_ICE_URLS_PER_SERVER) {
        throw new RangeError(
          `ICE server at index ${index} exceeds maximum allowable limit of ${MAX_ICE_URLS_PER_SERVER} URLs`
        );
      }

      const validatedUrls = rawUrls.map((url, urlIndex) => {
        if (typeof url !== "string" || !url.trim()) {
          throw new TypeError(`ICE server at index ${index}, url at index ${urlIndex} must be a non-empty string`);
        }
        const trimmed = url.trim();
        if (trimmed.length > MAX_ICE_URL_LENGTH) {
          throw new RangeError(
            `ICE server at index ${index}, url at index ${urlIndex} exceeds maximum length of ${MAX_ICE_URL_LENGTH} characters`
          );
        }
        const match = ICE_URL_REGEX.exec(trimmed);
        if (!match) {
          throw new TypeError(
            `ICE server at index ${index} has malformed URL or invalid URL scheme '${trimmed}'. Expected stun:, stuns:, turn:, or turns: URI.`
          );
        }
        const scheme = match[1].toLowerCase();
        const portStr = match[3];
        const transport = match[4];

        if ((scheme === "stun" || scheme === "stuns") && transport) {
          throw new TypeError(
            `ICE server at index ${index} has invalid STUN URL '${trimmed}': STUN URLs do not accept 'transport' query parameter`
          );
        }
        if (portStr) {
          const port = parseInt(portStr, 10);
          if (port < 1 || port > 65535) {
            throw new TypeError(
              `ICE server at index ${index} has invalid port '${portStr}' in URL '${trimmed}'. Must be between 1 and 65535.`
            );
          }
        }
        return trimmed;
      });

      const validated = {
        urls: Array.isArray(server.urls) ? [...validatedUrls] : validatedUrls[0],
      };

      if (server.username !== undefined) {
        if (typeof server.username !== "string" || !server.username.trim() || server.username.length > 256) {
          throw new TypeError(`ICE server at index ${index} 'username' must be a non-empty string (max 256 characters)`);
        }
        validated.username = server.username.trim();
      }

      if (server.credential !== undefined) {
        if (typeof server.credential !== "string" || !server.credential.trim() || server.credential.length > 256) {
          throw new TypeError(`ICE server at index ${index} 'credential' must be a non-empty string (max 256 characters)`);
        }
        validated.credential = server.credential.trim();
      }

      if (server.credentialType !== undefined) {
        if (server.credentialType !== "password" && server.credentialType !== "oauth") {
          throw new TypeError(
            `ICE server at index ${index} 'credentialType' must be 'password' or 'oauth', got '${server.credentialType}'`
          );
        }
        validated.credentialType = server.credentialType;
      }

      return validated;
    });

    return {
      iceServers: validatedServers,
    };
  }

  /**
   * Protocol message factory helpers
   */

  /**
   * Creates the metadata HEADER control packet sent before binary file streaming.
   * Validates file size (including 0-byte files), chunk size, total chunk count,
   * and their relationship against configurable limits before serialization.
   *
   * NOTE: Filename and MIME type are untrusted metadata provided by the remote peer.
   * The factory validates syntactic structure without acting as a content-security boundary.
   *
   * @param {object} params - File metadata header fields
   * @param {string} params.fileName - Name of the file
   * @param {number} params.fileSize - Size of file in bytes (>= 0)
   * @param {string} [params.fileType] - MIME type
   * @param {string} [params.mimeType] - MIME type alias
   * @param {number} params.chunkSize - Slice chunk size
   * @param {number} params.totalChunks - Total number of chunks (0 for empty files)
   * @param {object} [limits] - Configurable transfer limits (defaults to DEFAULT_TRANSFER_LIMITS)
   * @returns {string} JSON-serialized control message
   */
  export function createHeaderMessage(
    { fileName, fileSize, fileType, mimeType, chunkSize, totalChunks },
    limits = DEFAULT_TRANSFER_LIMITS
  ) {
    if (limits !== null && limits !== undefined && (typeof limits !== "object" || Array.isArray(limits))) {
      throw new TypeError("createHeaderMessage: limits must be an object");
    }
    const activeLimits = limits && typeof limits === "object" ? limits : DEFAULT_TRANSFER_LIMITS;
    if (activeLimits.maxFileSize !== undefined && (typeof activeLimits.maxFileSize !== "number" || !Number.isSafeInteger(activeLimits.maxFileSize) || activeLimits.maxFileSize <= 0)) {
      throw new TypeError("createHeaderMessage: limits.maxFileSize must be a positive integer");
    }
    if (activeLimits.minChunkSize !== undefined && (typeof activeLimits.minChunkSize !== "number" || !Number.isSafeInteger(activeLimits.minChunkSize) || activeLimits.minChunkSize <= 0)) {
      throw new TypeError("createHeaderMessage: limits.minChunkSize must be a positive integer");
    }
    if (activeLimits.maxChunkSize !== undefined && (typeof activeLimits.maxChunkSize !== "number" || !Number.isSafeInteger(activeLimits.maxChunkSize) || activeLimits.maxChunkSize <= 0)) {
      throw new TypeError("createHeaderMessage: limits.maxChunkSize must be a positive integer");
    }
    const maxFileSize = activeLimits.maxFileSize ?? MAX_FILE_SIZE;
    const minChunkLimit = activeLimits.minChunkSize ?? MIN_CHUNK_SIZE;
    const maxChunkSize = activeLimits.maxChunkSize ?? MAX_CHUNK_SIZE;
    if (minChunkLimit > maxChunkSize) {
      throw new RangeError("createHeaderMessage: minChunkSize cannot exceed maxChunkSize");
    }
    const maxChunkCount = activeLimits.maxChunkCount ?? activeLimits.maxTotalChunks ?? MAX_CHUNK_COUNT;
    const maxFilenameLength = activeLimits.maxFilenameLength ?? DEFAULT_TRANSFER_LIMITS.maxFilenameLength ?? 255;

    if (typeof fileName !== "string" || !fileName.trim()) {
      throw new TypeError("createHeaderMessage: fileName must be a non-empty string");
    }
    const trimmedName = fileName.trim();
    if (trimmedName.length > maxFilenameLength) {
      throw new RangeError(
        `createHeaderMessage: fileName exceeds maximum length of ${maxFilenameLength}`
      );
    }

    if (typeof fileSize !== "number" || !Number.isSafeInteger(fileSize) || fileSize < 0) {
      throw new TypeError("createHeaderMessage: fileSize must be a non-negative integer");
    }
    if (typeof chunkSize !== "number" || !Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
      throw new TypeError("createHeaderMessage: chunkSize must be a positive integer");
    }
    if (typeof totalChunks !== "number" || !Number.isSafeInteger(totalChunks) || totalChunks < 0) {
      throw new TypeError("createHeaderMessage: totalChunks must be a non-negative integer");
    }

    if (fileSize > maxFileSize) {
      throw new RangeError(
        `createHeaderMessage: fileSize (${fileSize} bytes) exceeds maximum allowable limit (${maxFileSize} bytes)`
      );
    }

    const minChunk = (fileSize > 0 && fileSize < minChunkLimit && totalChunks === 1) ? fileSize : minChunkLimit;
    if (chunkSize < minChunk || chunkSize > maxChunkSize) {
      throw new RangeError(
        `createHeaderMessage: chunkSize must be between ${minChunk} and ${maxChunkSize} bytes, got ${chunkSize}`
      );
    }

    const expectedTotalChunks = fileSize === 0 ? 0 : Math.ceil(fileSize / chunkSize);
    if (totalChunks !== expectedTotalChunks) {
      throw new RangeError(
        `createHeaderMessage: inconsistent totalChunks (${totalChunks}); fileSize ${fileSize} with chunkSize ${chunkSize} requires ${expectedTotalChunks}`
      );
    }
    if (totalChunks > maxChunkCount) {
      throw new RangeError(
        `createHeaderMessage: totalChunks (${totalChunks}) exceeds maximum allowable chunk limit (${maxChunkCount})`
      );
    }

    const rawType = fileType || mimeType || DEFAULT_MIME_TYPE;
    if (typeof rawType !== "string" || !rawType.trim()) {
      throw new TypeError("createHeaderMessage: fileType must be a non-empty string");
    }
    const cleanType = rawType.trim().toLowerCase();
    if (cleanType.length > 128) {
      throw new RangeError("createHeaderMessage: MIME type exceeds maximum length of 128 characters");
    }
    const mimeRegex = /^[a-z0-9!#$&^_.+-]{1,64}\/[a-z0-9!#$&^_.+-]{1,64}$/;
    if (!mimeRegex.test(cleanType)) {
      throw new TypeError(`createHeaderMessage: invalid MIME type syntax '${rawType}'`);
    }

    return JSON.stringify({
      type: MESSAGE_TYPE.HEADER,
      fileName: trimmedName,
      fileSize,
      fileType: cleanType,
      chunkSize,
      totalChunks,
    });
  }

  /**
   * Creates the COMPLETE protocol control packet with file SHA-256 integrity digest.
   * Establishes 'checksum' as canonical while retaining 'sha256Checksum' for backward compatibility.
   *
   * @param {string} checksum - Hex-encoded SHA-256 checksum of the complete file payload
   * @returns {string} JSON-serialized control message
   */
  export function createCompleteMessage(checksum) {
    if (typeof checksum !== "string" || !/^[a-f0-9]{64}$/i.test(checksum.trim())) {
      throw new TypeError("createCompleteMessage: checksum must be a 64-character hex SHA-256 string");
    }
    const canonicalChecksum = checksum.trim().toLowerCase();
    return JSON.stringify({
      type: MESSAGE_TYPE.COMPLETE,
      checksum: canonicalChecksum,         // Canonical SHA-256 checksum
      algorithm: "sha256",                 // Hash algorithm specification
      sha256Checksum: canonicalChecksum,   // Backward-compatibility alias
    });
  }

  /**
   * Creates the final transfer success ACK message sent by the receiver after
   * disk writes have completed and SHA-256 integrity verification has succeeded.
   *
   * NOTE: createAckMessage formats the protocol packet. Verification and write finalization
   * must be performed by the receiver before invoking this factory. The factory validates that
   * the acknowledged checksum agrees with the verified checksum identified in verificationResult.
   * The factory alone cannot establish that verification happened; the receiver must independently
   * verify hashes and finalize writes before constructing the ACK.
   *
   * @param {string} checksum - Verified SHA-256 checksum matching the completed file
   * @param {object} verificationResult - Explicit verification and finalization result
   * @param {boolean} verificationResult.verified - Must be explicitly true
   * @param {string} verificationResult.checksum - Required verified checksum matching the file payload
   * @param {string} [verificationResult.verifiedChecksum] - Alias for verified checksum
   * @param {string} [verificationResult.sha256Checksum] - Backward-compatibility alias for verified checksum
   * @param {string} [verificationResult.expectedChecksum] - Sender's expected checksum matching the file payload
   * @param {number} [verificationResult.bytesReceived] - Total bytes successfully written
   * @param {number} [verificationResult.receivedBytes] - Alias for bytesReceived
   * @param {number} [verificationResult.chunksReceived] - Total chunks successfully received
   * @param {number} [verificationResult.receivedChunks] - Alias for chunksReceived
   * @returns {string} JSON-serialized control message
   */
  export function createAckMessage(checksum, verificationResult) {
    if (
      !verificationResult ||
      typeof verificationResult !== "object" ||
      verificationResult.verified !== true
    ) {
      throw new TypeError(
        "createAckMessage requires an explicit successful verification result ({ verified: true }). For unverified or failed transfers, use createNackMessage."
      );
    }
    if (typeof checksum !== "string" || !/^[a-f0-9]{64}$/i.test(checksum.trim())) {
      throw new TypeError("createAckMessage: checksum must be a 64-character hex SHA-256 string");
    }
    const canonicalChecksum = checksum.trim().toLowerCase();

    // Require that the verification result explicitly identifies the verified checksum
    const checksumCandidates = {
      checksum: verificationResult.checksum,
      verifiedChecksum: verificationResult.verifiedChecksum,
      sha256Checksum: verificationResult.sha256Checksum,
    };

    let hasAnyVerifiedChecksum = false;
    for (const [key, val] of Object.entries(checksumCandidates)) {
      if (val !== undefined) {
        hasAnyVerifiedChecksum = true;
        if (typeof val !== "string" || !/^[a-f0-9]{64}$/i.test(val.trim())) {
          throw new TypeError(
            `createAckMessage: verificationResult.${key} must be a 64-character hex SHA-256 string`
          );
        }
        if (val.trim().toLowerCase() !== canonicalChecksum) {
          throw new Error(
            `createAckMessage: supplied checksum '${canonicalChecksum}' disagrees with verified checksum '${val.trim().toLowerCase()}' in verificationResult`
          );
        }
      }
    }

    if (!hasAnyVerifiedChecksum) {
      throw new TypeError(
        "createAckMessage: verificationResult must supply the verified 64-character hex SHA-256 checksum (via 'checksum' or 'verifiedChecksum')"
      );
    }

    // If the receiver also passed expectedChecksum, ensure it agrees with the acknowledged checksum
    if (verificationResult.expectedChecksum !== undefined) {
      if (
        typeof verificationResult.expectedChecksum !== "string" ||
        !/^[a-f0-9]{64}$/i.test(verificationResult.expectedChecksum.trim())
      ) {
        throw new TypeError(
          "createAckMessage: verificationResult.expectedChecksum must be a 64-character hex SHA-256 string"
        );
      }
      if (verificationResult.expectedChecksum.trim().toLowerCase() !== canonicalChecksum) {
        throw new Error(
          `createAckMessage: supplied checksum '${canonicalChecksum}' disagrees with expected checksum '${verificationResult.expectedChecksum.trim().toLowerCase()}'`
        );
      }
    }

    const hasBytesReceived = verificationResult.bytesReceived !== undefined;
    const hasReceivedBytes = verificationResult.receivedBytes !== undefined;

    if (hasBytesReceived && hasReceivedBytes && verificationResult.bytesReceived !== verificationResult.receivedBytes) {
      throw new Error(
        `createAckMessage: conflicting bytesReceived (${verificationResult.bytesReceived}) and receivedBytes (${verificationResult.receivedBytes}) in verificationResult`
      );
    }

    const resolvedBytesReceived = hasBytesReceived ? verificationResult.bytesReceived : verificationResult.receivedBytes;
    if (resolvedBytesReceived !== undefined) {
      if (
        typeof resolvedBytesReceived !== "number" ||
        !Number.isSafeInteger(resolvedBytesReceived) ||
        resolvedBytesReceived < 0
      ) {
        throw new TypeError("createAckMessage: bytesReceived must be a non-negative safe integer");
      }
    }

    const hasChunksReceived = verificationResult.chunksReceived !== undefined;
    const hasReceivedChunks = verificationResult.receivedChunks !== undefined;

    if (hasChunksReceived && hasReceivedChunks && verificationResult.chunksReceived !== verificationResult.receivedChunks) {
      throw new Error(
        `createAckMessage: conflicting chunksReceived (${verificationResult.chunksReceived}) and receivedChunks (${verificationResult.receivedChunks}) in verificationResult`
      );
    }

    const resolvedChunksReceived = hasChunksReceived ? verificationResult.chunksReceived : verificationResult.receivedChunks;
    if (resolvedChunksReceived !== undefined) {
      if (
        typeof resolvedChunksReceived !== "number" ||
        !Number.isSafeInteger(resolvedChunksReceived) ||
        resolvedChunksReceived < 0
      ) {
        throw new TypeError("createAckMessage: chunksReceived must be a non-negative safe integer");
      }
    }

    return JSON.stringify({
      type: MESSAGE_TYPE.ACK,
      ackType: "FINAL",
      status: "SUCCESS",
      verified: true,
      checksum: canonicalChecksum,
      algorithm: "sha256",
      sha256Checksum: canonicalChecksum,   // Backward-compatibility alias
      ...(resolvedBytesReceived !== undefined ? { bytesReceived: resolvedBytesReceived, receivedBytes: resolvedBytesReceived } : {}),
      ...(resolvedChunksReceived !== undefined ? { chunksReceived: resolvedChunksReceived, receivedChunks: resolvedChunksReceived } : {}),
    });
  }

  /**
   * Creates a NACK rejection message.
   */
  export function createNackMessage(reason) {
    const safeReason = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 255) : "Transfer rejected";
    return JSON.stringify({
      type: MESSAGE_TYPE.NACK,
      reason: safeReason,
    });
  }

  /**
   * Creates a CANCEL termination message.
   */
  export function createCancelMessage(reason) {
    const safeReason = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 255) : "Transfer cancelled";
    return JSON.stringify({
      type: MESSAGE_TYPE.CANCEL,
      reason: safeReason,
    });
  }

  /**
   * Creates a PAUSE flow-control signal.
   */
  export function createPauseMessage() {
    return JSON.stringify({ type: MESSAGE_TYPE.PAUSE });
  }

  /**
   * Creates a RESUME flow-control signal.
   */
  export function createResumeMessage() {
    return JSON.stringify({ type: MESSAGE_TYPE.RESUME });
  }

  /**
   * Creates a DRAIN flow-control notification sent when disk buffers have flushed.
   * Counters must be non-negative safe integers.
   */
  export function createDrainMessage(receivedBytes, receivedChunks) {
    if (typeof receivedBytes !== "number" || !Number.isSafeInteger(receivedBytes) || receivedBytes < 0) {
      throw new TypeError("createDrainMessage: receivedBytes must be a non-negative safe integer");
    }
    if (typeof receivedChunks !== "number" || !Number.isSafeInteger(receivedChunks) || receivedChunks < 0) {
      throw new TypeError("createDrainMessage: receivedChunks must be a non-negative safe integer");
    }
    return JSON.stringify({
      type: MESSAGE_TYPE.DRAIN,
      ackType: "CHUNK",
      receivedBytes,
      receivedChunks,
    });
  }

  /**
   * Creates an interim CHUNK_ACK notification.
   * Counters must be non-negative safe integers.
   */
  export function createChunkAckMessage(receivedBytes, receivedChunks) {
    if (typeof receivedBytes !== "number" || !Number.isSafeInteger(receivedBytes) || receivedBytes < 0) {
      throw new TypeError("createChunkAckMessage: receivedBytes must be a non-negative safe integer");
    }
    if (typeof receivedChunks !== "number" || !Number.isSafeInteger(receivedChunks) || receivedChunks < 0) {
      throw new TypeError("createChunkAckMessage: receivedChunks must be a non-negative safe integer");
    }
    return JSON.stringify({
      type: MESSAGE_TYPE.CHUNK_ACK,
      ackType: "CHUNK",
      receivedBytes,
      receivedChunks,
    });
  }
