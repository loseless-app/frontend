/**
 * P2P WebRTC File Receiver (Peer)
 *
 * Coordinates WebRTC DataChannel reception, header validation, progressive
 * disk streaming via OPFS / File System Access API, serialized async message ordering,
 * streaming integrity verification, watchdog health monitoring, and receiver-side backpressure.
 */

import {
  DEFAULT_TRANSFER_LIMITS,
  DEFAULT_MIME_TYPE,
  RECEIVER_BUFFER_HIGH_WATERMARK,
  RECEIVER_BUFFER_LOW_WATERMARK,
  RECEIVER_STATE,
  createAckMessage,
  createNackMessage,
  createCancelMessage,
  createPauseMessage,
  createResumeMessage,
  createDrainMessage,
  createChunkAckMessage,
} from "../protocol/messages.js";
import { createPeerConnection, closePeerConnection } from "./PeerConnection.js";
import { validateFileHeader, validateTransferLimits } from "../protocol/validation.js";
import { StreamingSHA256 } from "../utils/fileUtils.js";

export class P2PFileReceiver {
  constructor(socket, hostSocketId, options = {}, fileHandle = null) {
    this.socket = socket;
    this.hostSocketId = hostSocketId;

    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
    this.onCancel = options.onCancel || (() => {});

    this.options = options;
    this.limits = this._validateLimits(options.limits || {});
    this.fileHandle = options.fileHandle || options.saveFileHandle || fileHandle || null;

    // State machine
    this.state = RECEIVER_STATE.IDLE;
    this.isCancelled = false;
    this.isTerminated = false;
    this._isCleanedUp = false;
    this._hasTerminalCallbackCalled = false;

    // WebRTC connection
    this.pc = null;
    this.dc = null;
    this.hasAnsweredOffer = false;
    this.pendingIceCandidates = [];

    // Transfer metrics & metadata
    this.metadata = null;
    this.receivedBytes = 0;
    this.receivedChunks = 0;
    this.lastAckedBytes = 0;
    this.startTime = null;
    this.lastProgressTime = 0;

    // Serialized async message queue
    this._messageQueue = Promise.resolve();

    // Disk stream & receiver backpressure
    this.writable = null;
    this.writeBuffer = [];
    this.writeBufferSize = 0;
    this.activeWriteBytes = 0;
    this.queuedBytes = 0;
    this.chunks = [];
    this.isSignaledPaused = false;

    // Cryptographic verification
    this.hasher = new StreamingSHA256();

    // Timeouts: separate connection establishment from transfer inactivity
    this._connectionTimer = null;
    this._inactivityTimer = null;
    this.watchdogTimer = null;
  }

  _validateLimits(limits) {
    return validateTransferLimits(limits);
  }

  get totalBufferedBytes() {
    return this.queuedBytes + this.writeBufferSize + this.activeWriteBytes;
  }

  _checkBackpressure() {
    if (this.isTerminated || !this.writable) return;

    const highWatermark = this.limits.receiverBufferHighWatermark || RECEIVER_BUFFER_HIGH_WATERMARK;
    const lowWatermark = this.limits.receiverBufferLowWatermark || RECEIVER_BUFFER_LOW_WATERMARK;

    if (this.totalBufferedBytes >= highWatermark && !this.isSignaledPaused) {
      this.isSignaledPaused = true;
      this._sendControl(createPauseMessage());
    } else if (this.isSignaledPaused && this.totalBufferedBytes <= lowWatermark) {
      this.isSignaledPaused = false;
      this._sendControl(createDrainMessage(this.receivedBytes, this.receivedChunks));
      this._sendControl(createResumeMessage());
    }
  }

  async start(fileMetadata = null) {
    if (this.state !== RECEIVER_STATE.IDLE) {
      console.warn(`[P2PFileReceiver] start() ignored: receiver is already in state '${this.state}'`);
      return;
    }

    this.state = RECEIVER_STATE.CONNECTING;
    this.startTime = Date.now();
    this._resetConnectionTimer();

    try {
      this._initPeerConnection();

      // Emit file download request to host
      if (this.socket?.connected && this.hostSocketId) {
        this.socket.emit("p2p:request", {
          to: this.hostSocketId,
          fileName: fileMetadata?.fileName,
          fileSize: fileMetadata?.fileSize,
        });
      }
    } catch (err) {
      this._handleError(err);
    }
  }

  _initPeerConnection() {
    if (this.pc) return;

    this.pc = createPeerConnection(this.socket, this.hostSocketId, {
      rtcConfig: this.options.rtcConfig,
      iceServers: this.options.iceServers,
    });

    this.pc.onconnectionstatechange = () => {
      const connState = this.pc?.connectionState;
      if (connState === "failed" || connState === "disconnected") {
        if (!this.isTerminated) {
          const msg = connState === "failed"
            ? "P2P connection failed. Direct peer-to-peer connection could not be established (NAT/firewall traversal failed; a TURN relay may be required)."
            : `P2P Connection ${connState}`;
          this._handleError(new Error(msg));
        }
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const iceState = this.pc?.iceConnectionState;
      if (iceState === "failed" && !this.isTerminated) {
        this._handleError(
          new Error("ICE connection failed: direct route could not be negotiated. Ensure network allows WebRTC or configure a TURN server.")
        );
      }
    };

    this.pc.ondatachannel = (event) => {
      this._attachDataChannel(event.channel);
    };
  }

  _attachDataChannel(dc) {
    this.dc = dc;
    this.dc.binaryType = "arraybuffer";

    this.dc.onopen = () => {
      this._clearConnectionTimer();
      this._resetInactivityTimer();
    };

    this.dc.onmessage = (e) => this._onMessage(e);
    this.dc.onerror = (err) => this._handleError(new Error(`DataChannel error: ${err?.message || "Unknown"}`));
    this.dc.onclose = () => {
      this._clearAllTimers();
      if (
        !this.isTerminated &&
        this.state !== RECEIVER_STATE.COMPLETED &&
        this.state !== RECEIVER_STATE.CANCELLED
      ) {
        this._handleError(new Error("DataChannel closed before file transfer completed"));
      }
    };
  }

  async handleSignal(signal) {
    if (this.isTerminated) return;

    try {
      if (signal.sdp) {
        if (signal.sdp.type === "offer") {
          // Guard against duplicate offers
          if (this.hasAnsweredOffer) {
            console.warn("[P2PFileReceiver] Ignoring duplicate SDP offer from host");
            return;
          }

          if (this.state !== RECEIVER_STATE.IDLE && this.state !== RECEIVER_STATE.CONNECTING) {
            console.warn(`[P2PFileReceiver] Ignoring SDP offer in state '${this.state}'`);
            return;
          }

          this._initPeerConnection();

          if (this.pc.signalingState !== "stable") {
            console.warn(`[P2PFileReceiver] Unexpected signalingState '${this.pc.signalingState}' on SDP offer`);
            return;
          }

          await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          this.hasAnsweredOffer = true;

          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);

          this.socket.emit("p2p:signal", {
            to: this.hostSocketId,
            signal: { sdp: this.pc.localDescription },
          });

          // Drain queued ICE candidates received prior to remote description
          while (this.pendingIceCandidates.length > 0) {
            const candidate = this.pendingIceCandidates.shift();
            try {
              await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (candErr) {
              console.warn("[P2PFileReceiver] Failed to apply queued ICE candidate:", candErr);
            }
          }
        }
      } else if (signal.candidate) {
        if (!this.pc || !this.pc.remoteDescription) {
          // Queue early ICE candidates until remote description is established
          this.pendingIceCandidates.push(signal.candidate);
        } else {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch (err) {
            console.warn("[P2PFileReceiver] Failed to add ICE candidate:", err);
          }
        }
      }
    } catch (err) {
      this._handleError(new Error(`Failed to handle signaling message: ${err.message}`));
    }
  }

  _clearConnectionTimer() {
    if (this._connectionTimer) {
      clearTimeout(this._connectionTimer);
      this._connectionTimer = null;
    }
  }

  _resetConnectionTimer() {
    this._clearConnectionTimer();
    if (this.isTerminated) return;
    const timeoutMs = this.limits.connectionTimeoutMs || 20000;
    this._connectionTimer = setTimeout(() => {
      if (this.state === RECEIVER_STATE.CONNECTING && !this.isTerminated) {
        this._handleError(
          new Error("P2P connection establishment timed out: host failed to connect. (A TURN relay may be required if peers are on restrictive NATs)")
        );
      }
    }, timeoutMs);
  }

  _clearInactivityTimer() {
    if (this._inactivityTimer) {
      clearTimeout(this._inactivityTimer);
      this._inactivityTimer = null;
    }
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  _resetInactivityTimer() {
    this._clearInactivityTimer();
    if (this.isTerminated) return;
    const timeoutMs = this.limits.inactivityTimeoutMs || this.limits.watchdogTimeoutMs || 20000;
    this._inactivityTimer = setTimeout(() => {
      this._handleError(new Error("File transfer timed out: no data received from host"));
    }, timeoutMs);
    this.watchdogTimer = this._inactivityTimer;
  }

  _resetWatchdog() {
    this._resetInactivityTimer();
  }

  _clearWatchdog() {
    this._clearInactivityTimer();
  }

  _clearAllTimers() {
    this._clearConnectionTimer();
    this._clearInactivityTimer();
  }

  _sendControl(payload) {
    if (this.isTerminated) return;
    if (this.dc && this.dc.readyState === "open") {
      try {
        const text = typeof payload === "string" ? payload : JSON.stringify(payload);
        this.dc.send(text);
      } catch (err) {
        console.warn("[P2PFileReceiver] Failed to send control packet:", err);
      }
    }
  }

  /**
   * Synchronous message entrypoint: Enqueues each event into a sequential promise chain
   * to strictly guarantee serialized processing and eliminate out-of-order writes.
   */
  _onMessage(event) {
    if (this.isTerminated) return Promise.resolve();

    const isChunk = event?.data instanceof ArrayBuffer;
    const byteLength = isChunk ? event.data.byteLength : 0;
    if (byteLength > 0) {
      this.queuedBytes += byteLength;
      this._checkBackpressure();
    }

    return (this._messageQueue = this._messageQueue
      .then(async () => {
        if (this.isTerminated) {
          if (byteLength > 0) {
            this.queuedBytes = Math.max(0, this.queuedBytes - byteLength);
          }
          return;
        }
        await this._processMessage(event, byteLength);
      })
      .catch((err) => {
        this._handleError(err);
      }));
  }

  async _processMessage(event, enqueuedByteLength = 0) {
    // 1. Text Control Messages (JSON)
    if (typeof event.data === "string") {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        this._handleError(new Error(`Failed to parse control packet: ${err.message}`));
        return;
      }

      if (msg.type === "HEADER") {
        if (this.metadata) {
          this._handleError(new Error("Protocol violation: duplicate HEADER message received"));
          return;
        }

        const validation = validateFileHeader(msg, this.limits);
        if (!validation.isValid) {
          const err = new Error(`Malformed file header: ${validation.error}`);
          this._sendControl(createNackMessage(validation.error));
          this._handleError(err);
          return;
        }

        this.metadata = validation.sanitizedHeader;
        this.state = RECEIVER_STATE.RECEIVING;
        this.startTime = Date.now();
        this.lastProgressTime = 0;
        this.lastAckedBytes = 0;
        this._clearConnectionTimer();
        this._resetInactivityTimer();

        if (this.fileHandle) {
          try {
            this.writable = await this.fileHandle.createWritable();
          } catch (err) {
            if (this.isTerminated || this.isCancelled) return;
            const diskErr = new Error(`Failed to initialize filesystem stream: ${err?.message || "Storage error"}`);
            this._sendControl(createNackMessage(diskErr.message));
            this._handleError(diskErr);
            return;
          }
          if (this.isTerminated || this.state !== RECEIVER_STATE.RECEIVING) {
            try { await this.writable?.abort(); } catch {}
            this.writable = null;
            return;
          }
        }
        return;
      }

      if (msg.type === "COMPLETE") {
        if (this.isTerminated || this.state !== RECEIVER_STATE.RECEIVING) {
          if (!this.isTerminated) {
            this._handleError(new Error("Premature COMPLETE message received: no file header was established"));
          }
          return;
        }

        if (
          msg.checksum &&
          msg.sha256Checksum &&
          msg.checksum.trim().toLowerCase() !== msg.sha256Checksum.trim().toLowerCase()
        ) {
          const err = new Error(
            "Protocol violation: conflicting checksum and sha256Checksum aliases in COMPLETE packet"
          );
          this._sendControl(createNackMessage(err.message));
          this._handleError(err);
          return;
        }

        if (this.receivedBytes < this.metadata.fileSize) {
          const err = new Error(
            `Transfer incomplete: received ${this.receivedBytes} of ${this.metadata.fileSize} bytes`
          );
          this._sendControl(createNackMessage(err.message));
          this._handleError(err);
          return;
        }
        if (this.receivedBytes > this.metadata.fileSize) {
          const err = new Error(
            `Transfer excessive: received ${this.receivedBytes} of ${this.metadata.fileSize} bytes`
          );
          this._sendControl(createNackMessage(err.message));
          this._handleError(err);
          return;
        }

        if (this.receivedChunks < this.metadata.totalChunks) {
          const err = new Error(
            `Transfer incomplete: received ${this.receivedChunks} of ${this.metadata.totalChunks} chunks`
          );
          this._sendControl(createNackMessage(err.message));
          this._handleError(err);
          return;
        }
        if (this.receivedChunks > this.metadata.totalChunks) {
          const err = new Error(
            `Transfer excessive: received ${this.receivedChunks} of ${this.metadata.totalChunks} chunks`
          );
          this._sendControl(createNackMessage(err.message));
          this._handleError(err);
          return;
        }

        const checksumCandidates = [
          ["checksum", msg.checksum],
          ["sha256Checksum", msg.sha256Checksum],
        ];

        let canonicalExpectedChecksum = null;
        for (const [key, val] of checksumCandidates) {
          if (val !== undefined) {
            if (typeof val !== "string" || !/^[a-f0-9]{64}$/i.test(val.trim())) {
              const err = new Error(`Protocol violation: COMPLETE ${key} must be a 64-character hex SHA-256 string`);
              this._sendControl(createNackMessage(err.message));
              this._handleError(err);
              return;
            }
            const cleanVal = val.trim().toLowerCase();
            if (canonicalExpectedChecksum === null) {
              canonicalExpectedChecksum = cleanVal;
            } else if (canonicalExpectedChecksum !== cleanVal) {
              const err = new Error(
                "Protocol violation: conflicting checksum and sha256Checksum aliases in COMPLETE packet"
              );
              this._sendControl(createNackMessage(err.message));
              this._handleError(err);
              return;
            }
          }
        }

        if (!canonicalExpectedChecksum) {
          const err = new Error("Protocol violation: COMPLETE packet missing required 64-character hex SHA-256 checksum");
          this._sendControl(createNackMessage(err.message));
          this._handleError(err);
          return;
        }

        this.state = RECEIVER_STATE.FINALIZING;
        await this._finalizeFile(canonicalExpectedChecksum);
        return;
      }

      if (msg.type === "CANCEL") {
        this.cancel(msg.reason || "Cancelled by sender", false);
        return;
      }

      return;
    }

    // 2. Binary Chunk Messages (ArrayBuffer)
    if (event.data instanceof ArrayBuffer) {
      if (this.state !== RECEIVER_STATE.RECEIVING || !this.metadata) {
        if (enqueuedByteLength > 0) {
          this.queuedBytes = Math.max(0, this.queuedBytes - enqueuedByteLength);
        }
        this._handleError(new Error("Protocol violation: binary chunk received before HEADER control packet"));
        return;
      }

      const chunk = event.data;

      if (chunk.byteLength > this.limits.maxChunkSize) {
        if (enqueuedByteLength > 0) {
          this.queuedBytes = Math.max(0, this.queuedBytes - enqueuedByteLength);
        }
        const err = new Error(
          `Chunk size (${chunk.byteLength} bytes) exceeds maximum allowable limit (${this.limits.maxChunkSize} bytes)`
        );
        this._sendControl(createNackMessage(err.message));
        this._handleError(err);
        return;
      }

      if (this.receivedBytes + chunk.byteLength > this.metadata.fileSize) {
        if (enqueuedByteLength > 0) {
          this.queuedBytes = Math.max(0, this.queuedBytes - enqueuedByteLength);
        }
        const err = new Error(
          `Oversized transfer: received ${this.receivedBytes + chunk.byteLength} bytes, exceeding announced size of ${this.metadata.fileSize} bytes`
        );
        this._sendControl(createNackMessage(err.message));
        this._handleError(err);
        return;
      }

      if (this.receivedChunks + 1 > this.metadata.totalChunks) {
        if (enqueuedByteLength > 0) {
          this.queuedBytes = Math.max(0, this.queuedBytes - enqueuedByteLength);
        }
        const err = new Error(
          `Excess chunks: received ${this.receivedChunks + 1} chunks, exceeding announced total of ${this.metadata.totalChunks}`
        );
        this._sendControl(createNackMessage(err.message));
        this._handleError(err);
        return;
      }

      this.receivedBytes += chunk.byteLength;
      this.receivedChunks += 1;

      // Meaningful transfer progress: reset inactivity timer
      this._resetInactivityTimer();

      this.hasher.update(new Uint8Array(chunk));

      if (this.writable) {
        if (enqueuedByteLength > 0) {
          this.queuedBytes = Math.max(0, this.queuedBytes - enqueuedByteLength);
        }
        this.writeBuffer.push(chunk);
        this.writeBufferSize += chunk.byteLength;

        // Check backpressure on buffer insertion
        this._checkBackpressure();

        const flushBatchSize = Math.min(
          1024 * 1024,
          this.limits.receiverBufferLowWatermark || RECEIVER_BUFFER_LOW_WATERMARK
        );

        // Flush in batches to minimize disk syscalls
        if (this.writeBufferSize >= flushBatchSize) {
          const batchSize = this.writeBufferSize;
          const batch = new Blob(this.writeBuffer);
          this.writeBuffer = [];
          this.writeBufferSize = 0;
          this.activeWriteBytes += batchSize;

          const lowWatermark = this.limits.receiverBufferLowWatermark || RECEIVER_BUFFER_LOW_WATERMARK;

          try {
            await this.writable.write(batch);

            if (this.isTerminated || this.state !== RECEIVER_STATE.RECEIVING) {
              return;
            }

            // Flow control notifications
            if (this.isSignaledPaused) {
              // If buffer drained to or below low watermark, unpause and notify sender
              if (this.totalBufferedBytes - batchSize <= lowWatermark) {
                this.isSignaledPaused = false;
                this._sendControl(createDrainMessage(this.receivedBytes, this.receivedChunks));
                this._sendControl(createResumeMessage());
              } else {
                // Still paused: send interim progress via CHUNK_ACK so sender knows
                // bytes were written without unpausing sender's pause lock
                this._sendControl(createChunkAckMessage(this.receivedBytes, this.receivedChunks));
              }
            } else {
              // Not paused: standard drain notification
              this._sendControl(createDrainMessage(this.receivedBytes, this.receivedChunks));
            }
          } catch (err) {
            if (this.isTerminated || this.isCancelled) {
              return;
            }
            console.error("[P2PFileReceiver] Disk write failed:", err);
            const isQuota = err?.name === "QuotaExceededError";
            const diskErr = new Error(
              isQuota
                ? "Disk quota exceeded: insufficient storage space on device"
                : `Disk write failed: ${err?.message || "I/O error"}`
            );
            this._sendControl(createNackMessage(diskErr.message));
            if (this.writable) {
              try { await this.writable.abort(); } catch {}
              this.writable = null;
            }
            this._handleError(diskErr);
            return;
          } finally {
            this.activeWriteBytes = Math.max(0, this.activeWriteBytes - batchSize);
            this._checkBackpressure();
          }
        }
      } else {
        if (enqueuedByteLength > 0) {
          this.queuedBytes = Math.max(0, this.queuedBytes - enqueuedByteLength);
        }
        this.chunks.push(chunk);
        // Interim flow-control notification for in-memory receivers (every 1 MB)
        if (this.receivedBytes - this.lastAckedBytes >= 1024 * 1024) {
          this.lastAckedBytes = this.receivedBytes;
          this._sendControl(createChunkAckMessage(this.receivedBytes, this.receivedChunks));
        }
      }

      if (this.isTerminated || this.state !== RECEIVER_STATE.RECEIVING) {
        return;
      }

      const totalBytes = this.metadata.fileSize;
      const now = Date.now();
      if (now - this.lastProgressTime >= 150 || (totalBytes > 0 && this.receivedBytes >= totalBytes)) {
        this.lastProgressTime = now;
        const elapsedSec = (now - this.startTime) / 1000;
        const speed = elapsedSec > 0 ? this.receivedBytes / elapsedSec : 0;
        const percent = totalBytes > 0
          ? (this.receivedBytes >= totalBytes ? 100 : Math.min(99, Math.floor((this.receivedBytes / totalBytes) * 100)))
          : 0;
        const remainingBytes = Math.max(0, totalBytes - this.receivedBytes);
        const eta = speed > 0 ? Math.round(remainingBytes / speed) : null;

        this.onProgress({
          receivedBytes: this.receivedBytes,
          totalBytes,
          percent,
          speed,
          eta,
          isFinalizing: false,
        });
      }
    }
  }

  async _finalizeFile(expectedChecksum) {
    this._clearAllTimers();
    if (this.isTerminated || this.state !== RECEIVER_STATE.FINALIZING) return;

    try {
      let file;
      let blob = null;

      if (this.writable) {
        if (this.writeBuffer.length > 0) {
          const batchSize = this.writeBufferSize;
          const batch = new Blob(this.writeBuffer);
          this.writeBuffer = [];
          this.writeBufferSize = 0;
          this.activeWriteBytes += batchSize;
          try {
            await this.writable.write(batch);
          } finally {
            this.activeWriteBytes = Math.max(0, this.activeWriteBytes - batchSize);
            this._checkBackpressure();
          }
        }
      }

      if (this.isTerminated || this.state !== RECEIVER_STATE.FINALIZING) return;

      const computedChecksum = this.hasher.digest();
      if (!expectedChecksum) {
        throw new Error("File integrity verification failed: missing expected checksum in COMPLETE packet");
      }
      if (computedChecksum.trim().toLowerCase() !== expectedChecksum.trim().toLowerCase()) {
        throw new Error(
          `File integrity verification failed: SHA-256 checksum mismatch (expected ${expectedChecksum}, computed ${computedChecksum})`
        );
      }

      if (this.writable) {
        await this.writable.close();
        this.writable = null;
        if (this.isTerminated || this.state !== RECEIVER_STATE.FINALIZING) return;

        if (this.fileHandle?.getFile) {
          file = await this.fileHandle.getFile();
        } else {
          const mimeType = this.metadata?.fileType || DEFAULT_MIME_TYPE;
          blob = new Blob(this.chunks, { type: mimeType });
          file = new File([blob], this.metadata?.fileName || "download.bin", {
            type: mimeType,
            lastModified: Date.now(),
          });
          this.chunks = [];
        }
      } else {
        const mimeType = this.metadata?.fileType || DEFAULT_MIME_TYPE;
        blob = new Blob(this.chunks, { type: mimeType });
        file = new File([blob], this.metadata?.fileName || "download.bin", {
          type: mimeType,
          lastModified: Date.now(),
        });
        this.chunks = [];
      }

      if (this.isTerminated || this.state !== RECEIVER_STATE.FINALIZING) return;

      this.state = RECEIVER_STATE.COMPLETED;

      this._sendControl(
        createAckMessage(computedChecksum, {
          verified: true,
          checksum: computedChecksum,
          verifiedChecksum: computedChecksum,
          sha256Checksum: computedChecksum,
          expectedChecksum: expectedChecksum,
          bytesReceived: this.receivedBytes,
          receivedBytes: this.receivedBytes,
          chunksReceived: this.receivedChunks,
          receivedChunks: this.receivedChunks,
        })
      );

      this.isTerminated = true;

      if (!this._hasTerminalCallbackCalled) {
        this._hasTerminalCallbackCalled = true;
        try {
          this.onComplete(file, blob, {
            ...this.metadata,
            checksum: computedChecksum,
          });
        } catch (cbErr) {
          console.warn("[P2PFileReceiver] onComplete callback error:", cbErr);
        }
      }

      this._cleanup();
    } catch (err) {
      if (this.isTerminated || this.isCancelled) {
        return;
      }
      this._sendControl(createNackMessage(err.message || "File finalization failed"));

      if (this.writable) {
        try {
          await this.writable.abort();
        } catch (abortErr) {
          console.warn("[P2PFileReceiver] Error aborting writable stream:", abortErr);
        }
        this.writable = null;
      }

      this.writeBuffer = [];
      this.writeBufferSize = 0;
      this.chunks = [];

      this._handleError(err);
    }
  }

  async cancel(reason = "Transfer cancelled by user", notifyRemote = true) {
    if (this.isTerminated) return;
    this.isCancelled = true;
    this.isTerminated = true;
    this.state = RECEIVER_STATE.CANCELLED;
    this._clearAllTimers();

    this.writeBuffer = [];
    this.writeBufferSize = 0;
    this.activeWriteBytes = 0;
    this.queuedBytes = 0;
    this.chunks = [];

    if (notifyRemote && this.dc && this.dc.readyState === "open") {
      try {
        this.dc.send(createCancelMessage(reason));
      } catch {}
    }

    if (notifyRemote && this.socket?.connected && this.hostSocketId) {
      this.socket.emit("p2p:cancel", {
        to: this.hostSocketId,
        reason,
      });
    }

    if (!this._hasTerminalCallbackCalled) {
      this._hasTerminalCallbackCalled = true;
      try {
        this.onCancel(reason);
      } catch (cbErr) {
        console.warn("[P2PFileReceiver] onCancel callback error:", cbErr);
      }
    }

    if (this.writable) {
      try {
        await this.writable.abort();
      } catch {}
      this.writable = null;
    }

    this._cleanup();
  }

  _handleError(err) {
    if (this.isTerminated) return;
    this.isTerminated = true;
    this.state = RECEIVER_STATE.FAILED;
    this._clearAllTimers();

    console.error("[P2PFileReceiver] Transfer error:", err);

    if (this.writable) {
      try {
        this.writable.abort().catch(() => {});
      } catch {}
      this.writable = null;
    }

    this.writeBuffer = [];
    this.writeBufferSize = 0;
    this.activeWriteBytes = 0;
    this.queuedBytes = 0;
    this.chunks = [];

    if (!this._hasTerminalCallbackCalled) {
      this._hasTerminalCallbackCalled = true;
      try {
        this.onError(err);
      } catch (cbErr) {
        console.warn("[P2PFileReceiver] onError callback error:", cbErr);
      }
    }
    this._cleanup();
  }

  _cleanup() {
    if (this._isCleanedUp) return;
    this._isCleanedUp = true;

    this._clearAllTimers();
    this.pendingIceCandidates = [];

    if (this.writable) {
      try {
        this.writable.abort().catch(() => {});
      } catch {}
      this.writable = null;
    }

    closePeerConnection(this.pc, this.dc);
    this.pc = null;
    this.dc = null;
    this.writeBuffer = [];
    this.writeBufferSize = 0;
    this.activeWriteBytes = 0;
    this.queuedBytes = 0;
    this.chunks = [];
  }
}
