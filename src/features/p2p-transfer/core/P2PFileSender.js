/**
 * P2P WebRTC File Sender (Host)
 *
 * Coordinates file slicing, zero-allocation streaming SHA-256 calculation,
 * socket backpressure regulation, receiver flow control, connection resilience,
 * and two-way verification handshakes.
 */

import {
  CHUNK_SIZE,
  BUFFER_HIGH_WATERMARK,
  BUFFER_LOW_WATERMARK,
  DEFAULT_TRANSFER_LIMITS,
  DEFAULT_MIME_TYPE,
  SENDER_STATE,
  createHeaderMessage,
  createCompleteMessage,
  createCancelMessage,
} from "../protocol/messages.js";
import { createPeerConnection, closePeerConnection } from "./PeerConnection.js";
import { waitForBufferDrain } from "../utils/backpressure.js";
import { StreamingSHA256 } from "../utils/fileUtils.js";
import { validateAndSanitizeFilename, validateMimeType } from "../protocol/validation.js";

export class P2PFileSender {
  constructor(socket, targetSocketId, file, options = {}, limits = {}) {
    if (!socket) {
      throw new TypeError("P2PFileSender: socket is required");
    }
    if (!targetSocketId || typeof targetSocketId !== "string") {
      throw new TypeError("P2PFileSender: targetSocketId must be a non-empty string");
    }

    this.socket = socket;
    this.targetSocketId = targetSocketId;
    this.file = file;

    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
    this.onCancel = options.onCancel || (() => {});

    this.options = options;

    const mergedLimits = {
      ...DEFAULT_TRANSFER_LIMITS,
      ...(options.limits || {}),
      ...(limits || {}),
    };
    this._validateLimits(mergedLimits);
    this.limits = mergedLimits;

    this.chunkSize = options.chunkSize || CHUNK_SIZE;
    if (
      typeof this.chunkSize !== "number" ||
      !Number.isSafeInteger(this.chunkSize) ||
      this.chunkSize <= 0
    ) {
      throw new TypeError("P2PFileSender: chunkSize must be a positive integer");
    }
    const minChunk =
      this.file?.size > 0 && this.file.size < this.limits.minChunkSize
        ? this.file.size
        : this.limits.minChunkSize;
    if (this.chunkSize < minChunk || this.chunkSize > this.limits.maxChunkSize) {
      throw new RangeError(
        `P2PFileSender: chunkSize must be between ${minChunk} and ${this.limits.maxChunkSize} bytes, got ${this.chunkSize}`
      );
    }
    if (
      this.file?.size > 0 &&
      this.chunkSize > this.limits.maxInFlightBytes
    ) {
      throw new RangeError(
        `P2PFileSender: chunkSize (${this.chunkSize}) exceeds maxInFlightBytes (${this.limits.maxInFlightBytes})`
      );
    }

    // State machine
    this.state = SENDER_STATE.IDLE;
    this.isCancelled = false;
    this.isTerminated = false;
    this._isCleanedUp = false;
    this._hasTerminalCallbackCalled = false;

    // WebRTC connection
    this.pc = null;
    this.dc = null;
    this.pendingIceCandidates = [];

    // Transfer metrics & hashing
    this.startTime = null;
    this.lastProgressTime = 0;
    this.hasher = null;
    this.sentBytes = 0;
    this.sentChunks = 0;
    this.totalChunks = 0;
    this._expectedChecksum = null;

    // Receiver-side backpressure & flow control
    this.isReceiverPaused = false;
    this._pauseWaiters = new Set();

    this.receiverAckedBytes = 0;
    this.receiverAckedChunks = 0;
    this.receiverSupportsFlowControl = true; // Implicitly enforced per protocol
    this._flowControlWaiters = new Set();
    this._drainWaiters = new Set();

    // Timers & completion deferreds
    this._connectionTimer = null;
    this._disconnectGraceTimer = null;
    this._ackResolver = null;
    this._ackRejecter = null;
    this._ackTimer = null;
  }

  _validateLimits(limits) {
    if (!limits || typeof limits !== "object") {
      throw new TypeError("P2PFileSender: limits must be an object");
    }
    const positiveIntFields = [
      "maxFileSize",
      "minChunkSize",
      "maxChunkSize",
      "maxInFlightBytes",
      "maxChunkCount",
      "ackTimeoutMs",
      "connectionTimeoutMs",
      "inactivityTimeoutMs",
      "pauseTimeoutMs",
      "flowControlTimeoutMs",
      "disconnectGraceTimeoutMs",
      "maxPendingIceCandidates",
      "drainTimeoutMs",
      "bufferDrainTimeoutMs",
    ];
    for (const field of positiveIntFields) {
      if (limits[field] !== undefined) {
        if (
          typeof limits[field] !== "number" ||
          !Number.isSafeInteger(limits[field]) ||
          limits[field] <= 0
        ) {
          throw new TypeError(`P2PFileSender: limits.${field} must be a positive integer`);
        }
      }
    }
    if (limits.minChunkSize && limits.maxChunkSize && limits.minChunkSize > limits.maxChunkSize) {
      throw new RangeError("P2PFileSender: minChunkSize cannot exceed maxChunkSize");
    }
    if (
      limits.minChunkSize !== undefined &&
      limits.maxInFlightBytes !== undefined &&
      limits.maxInFlightBytes < limits.minChunkSize
    ) {
      throw new RangeError("P2PFileSender: maxInFlightBytes cannot be less than minChunkSize");
    }
  }

  _emitProgress(data) {
    try {
      this.onProgress(data);
    } catch (err) {
      console.warn("[P2PFileSender] onProgress callback error:", err);
    }
  }

  _wakePauseWaiters() {
    for (const resolve of this._pauseWaiters) {
      resolve();
    }
    this._pauseWaiters.clear();
  }

  _wakeFlowControlWaiters() {
    for (const resolve of this._flowControlWaiters) {
      resolve();
    }
    this._flowControlWaiters.clear();
  }

  _wakeDrainWaiters() {
    for (const resolve of this._drainWaiters) {
      resolve();
    }
    this._drainWaiters.clear();
  }

  async start() {
    if (this.state !== SENDER_STATE.IDLE) {
      console.warn(`[P2PFileSender] start() ignored: sender is already in state '${this.state}'`);
      return;
    }

    this.state = SENDER_STATE.CONNECTING;

    // Start connection-establishment timer
    const connTimeoutMs = this.limits.connectionTimeoutMs || 20000;
    this._connectionTimer = setTimeout(() => {
      if (this.state === SENDER_STATE.CONNECTING && !this.isTerminated) {
        this._handleError(
          new Error(
            "P2P connection establishment timed out: peer failed to connect. (A TURN relay may be required if peers are on restrictive NATs)"
          )
        );
      }
    }, connTimeoutMs);

    try {
      this.pc = createPeerConnection(this.socket, this.targetSocketId, {
        rtcConfig: this.options.rtcConfig,
        iceServers: this.options.iceServers,
      });

      this.pc.onconnectionstatechange = () => {
        const connState = this.pc?.connectionState;
        if (connState === "connected") {
          // Cancel temporary disconnect grace timer if connection restored
          if (this._disconnectGraceTimer) {
            clearTimeout(this._disconnectGraceTimer);
            this._disconnectGraceTimer = null;
          }
        } else if (connState === "disconnected") {
          // Grace period for transient packet drops or ICE renegotiation
          if (!this._disconnectGraceTimer && !this.isTerminated) {
            const graceMs = this.limits.disconnectGraceTimeoutMs || 5000;
            this._disconnectGraceTimer = setTimeout(() => {
              this._disconnectGraceTimer = null;
              if (
                !this.isTerminated &&
                (this.pc?.connectionState === "disconnected" || this.pc?.connectionState === "failed")
              ) {
                this._handleError(
                  new Error("P2P connection disconnected: connection did not recover within grace period")
                );
              }
            }, graceMs);
          }
        } else if (connState === "failed") {
          if (this._disconnectGraceTimer) {
            clearTimeout(this._disconnectGraceTimer);
            this._disconnectGraceTimer = null;
          }
          if (!this.isTerminated) {
            this._handleError(
              new Error(
                "P2P connection failed. Direct peer-to-peer connection could not be established (NAT/firewall traversal failed; a TURN relay may be required)."
              )
            );
          }
        }
      };

      this.pc.oniceconnectionstatechange = () => {
        const iceState = this.pc?.iceConnectionState;
        if (iceState === "connected" || iceState === "completed") {
          if (this._disconnectGraceTimer) {
            clearTimeout(this._disconnectGraceTimer);
            this._disconnectGraceTimer = null;
          }
        } else if (iceState === "failed" && !this.isTerminated) {
          if (this._disconnectGraceTimer) {
            clearTimeout(this._disconnectGraceTimer);
            this._disconnectGraceTimer = null;
          }
          this._handleError(
            new Error(
              "ICE connection failed: direct route could not be negotiated. Ensure network allows WebRTC or configure a TURN server."
            )
          );
        }
      };

      this.dc = this.pc.createDataChannel("file-transfer", {
        ordered: true,
      });
      this.dc.binaryType = "arraybuffer";

      this.dc.onopen = () => {
        this._onChannelOpen().catch((err) => {
          this._handleError(err);
        });
      };
      this.dc.onmessage = (event) => this._onMessage(event);
      this.dc.onerror = (err) => this._handleError(new Error(`DataChannel error: ${err?.message || "Unknown"}`));
      this.dc.onclose = () => {
        this._wakePauseWaiters();
        this._wakeFlowControlWaiters();
        this._wakeDrainWaiters();
        if (!this.isTerminated && this.state !== SENDER_STATE.COMPLETED && this.state !== SENDER_STATE.CANCELLED) {
          this._handleError(new Error("DataChannel closed prematurely during transfer"));
        }
      };

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      this.socket.emit("p2p:signal", {
        to: this.targetSocketId,
        signal: { sdp: this.pc.localDescription },
      });
    } catch (err) {
      this._handleError(err);
    }
  }

  async handleSignal(signal) {
    if (this.isTerminated || !this.pc) return;

    if (!signal || typeof signal !== "object") {
      this._handleError(new Error("handleSignal: signal must be a non-null object"));
      return;
    }

    const maxCandidates = this.limits.maxPendingIceCandidates || 64;

    try {
      if (signal.sdp) {
        if (!signal.sdp || typeof signal.sdp !== "object" || typeof signal.sdp.type !== "string") {
          throw new TypeError("handleSignal: malformed SDP payload in signaling message");
        }

        if (signal.sdp.type === "answer") {
          if (this.pc.signalingState !== "have-local-offer") {
            console.warn(
              `[P2PFileSender] Ignoring unexpected SDP answer in signalingState '${this.pc.signalingState}'`
            );
            return;
          }
          await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

          // Drain queued ICE candidates received prior to remote description
          while (this.pendingIceCandidates.length > 0) {
            const candidate = this.pendingIceCandidates.shift();
            try {
              await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (candErr) {
              console.warn("[P2PFileSender] Failed to apply queued ICE candidate:", candErr);
            }
          }
        } else if (signal.sdp.type === "offer") {
          console.warn("[P2PFileSender] Host received unexpected SDP offer from peer");
        }
      } else if (signal.candidate) {
        if (typeof signal.candidate !== "object" && typeof signal.candidate !== "string") {
          throw new TypeError("handleSignal: malformed ICE candidate payload in signaling message");
        }

        const candidateInit =
          typeof signal.candidate === "string" ? { candidate: signal.candidate } : signal.candidate;

        if (!this.pc.remoteDescription) {
          // Deduplicate candidate in pending queue
          const isDuplicate = this.pendingIceCandidates.some(
            (c) => JSON.stringify(c) === JSON.stringify(candidateInit)
          );
          if (!isDuplicate) {
            if (this.pendingIceCandidates.length >= maxCandidates) {
              throw new RangeError(
                `handleSignal: ICE candidate queue exceeded maximum capacity of ${maxCandidates} candidates`
              );
            }
            this.pendingIceCandidates.push(candidateInit);
          }
        } else {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
          } catch (err) {
            console.warn("[P2PFileSender] Failed to add ICE candidate:", err);
          }
        }
      }
    } catch (err) {
      this._handleError(new Error(`Failed to handle signaling message: ${err.message}`));
    }
  }

  _onMessage(event) {
    if (this.isTerminated) return;

    if (typeof event.data === "string") {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        console.warn("[P2PFileSender] Malformed JSON control message from receiver:", err);
        return;
      }

      if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
        console.warn("[P2PFileSender] Invalid control message packet structure from receiver");
        return;
      }

      try {
        if (msg.type === "ACK") {
          if (this.state !== SENDER_STATE.AWAITING_ACK) {
            console.warn(`[P2PFileSender] Received ACK in unexpected state '${this.state}'`);
            return;
          }
          if (msg.ackType && msg.ackType !== "FINAL") {
            console.warn(`[P2PFileSender] Ignoring ACK packet with non-final ackType '${msg.ackType}'`);
            return;
          }

          // 1. Require explicit successful verification indicator
          if (msg.verified !== true || (msg.status && msg.status !== "SUCCESS")) {
            const err = new Error("Receiver failed file verification on completion");
            this._rejectAck(err);
            return;
          }

          // 2. Validate checksum alias consistency
          if (
            msg.checksum &&
            msg.sha256Checksum &&
            msg.checksum.trim().toLowerCase() !== msg.sha256Checksum.trim().toLowerCase()
          ) {
            const err = new Error(
              "Protocol violation: conflicting checksum and sha256Checksum aliases in ACK packet"
            );
            this._rejectAck(err);
            return;
          }

          // 3. Require valid 64-character SHA-256 checksum matching sender's computed digest
          const ackChecksum = (msg.checksum || msg.sha256Checksum || "").trim().toLowerCase();
          if (!/^[a-f0-9]{64}$/i.test(ackChecksum)) {
            const err = new Error("Protocol violation: ACK packet missing valid 64-character SHA-256 checksum");
            this._rejectAck(err);
            return;
          }

          if (this._expectedChecksum && ackChecksum !== this._expectedChecksum) {
            const err = new Error(
              `File integrity verification failed: ACK checksum (${ackChecksum}) disagrees with sender checksum (${this._expectedChecksum})`
            );
            this._rejectAck(err);
            return;
          }

          // 4. Validate acknowledged byte count if present
          if (msg.bytesReceived !== undefined) {
            if (
              typeof msg.bytesReceived !== "number" ||
              !Number.isSafeInteger(msg.bytesReceived) ||
              msg.bytesReceived !== this.file.size
            ) {
              const err = new Error(
                `Protocol violation: ACK bytesReceived (${msg.bytesReceived}) disagrees with file size (${this.file.size})`
              );
              this._rejectAck(err);
              return;
            }
          }

          // 5. Validate acknowledged chunk count if present
          if (msg.chunksReceived !== undefined) {
            if (
              typeof msg.chunksReceived !== "number" ||
              !Number.isSafeInteger(msg.chunksReceived) ||
              msg.chunksReceived !== this.totalChunks
            ) {
              const err = new Error(
                `Protocol violation: ACK chunksReceived (${msg.chunksReceived}) disagrees with totalChunks (${this.totalChunks})`
              );
              this._rejectAck(err);
              return;
            }
          }

          // Settle the ACK promise exactly once on success
          if (this._ackTimer) {
            clearTimeout(this._ackTimer);
            this._ackTimer = null;
          }
          if (this._ackResolver) {
            const resolve = this._ackResolver;
            this._ackResolver = null;
            this._ackRejecter = null;
            this.state = SENDER_STATE.COMPLETED;
            resolve(msg);
          }
          return;
        }

        if (msg.type === "NACK") {
          const err = new Error(`Receiver rejected transfer: ${msg.reason || "unknown reason"}`);
          this._rejectAck(err);
          return;
        }

        if (msg.type === "PAUSE") {
          this.isReceiverPaused = true;
          return;
        }

        if (msg.type === "RESUME") {
          this.isReceiverPaused = false;
          this._wakePauseWaiters();
          this._wakeFlowControlWaiters();
          return;
        }

        if (msg.type === "DRAIN" || msg.type === "CHUNK_ACK") {
          // 1. Validate receivedBytes
          if (
            typeof msg.receivedBytes !== "number" ||
            !Number.isSafeInteger(msg.receivedBytes) ||
            msg.receivedBytes < 0
          ) {
            const err = new Error(
              `Protocol violation: ${msg.type} packet contains invalid receivedBytes: ${msg.receivedBytes}`
            );
            this._handleError(err);
            return;
          }

          // 2. Reject receivedBytes greater than actually sent bytes
          if (msg.receivedBytes > this.sentBytes) {
            const err = new Error(
              `Protocol violation: ${msg.type} announced receivedBytes (${msg.receivedBytes}) exceeds bytes actually sent (${this.sentBytes})`
            );
            this._handleError(err);
            return;
          }

          // 3. Regressing receivedBytes: ignore safely as stale duplicate/out-of-order without regressing
          if (msg.receivedBytes < this.receiverAckedBytes) {
            console.warn(
              `[P2PFileSender] Ignoring regressing or out-of-order ${msg.type} receivedBytes (${msg.receivedBytes} < ${this.receiverAckedBytes})`
            );
            return;
          }

          // 4. Validate receivedChunks if present
          if (msg.receivedChunks !== undefined) {
            if (
              typeof msg.receivedChunks !== "number" ||
              !Number.isSafeInteger(msg.receivedChunks) ||
              msg.receivedChunks < 0
            ) {
              const err = new Error(
                `Protocol violation: ${msg.type} packet contains invalid receivedChunks: ${msg.receivedChunks}`
              );
              this._handleError(err);
              return;
            }
            if (msg.receivedChunks > this.sentChunks) {
              const err = new Error(
                `Protocol violation: ${msg.type} announced receivedChunks (${msg.receivedChunks}) exceeds chunks actually sent (${this.sentChunks})`
              );
              this._handleError(err);
              return;
            }
            if (msg.receivedChunks < this.receiverAckedChunks) {
              console.warn(
                `[P2PFileSender] Ignoring regressing ${msg.type} receivedChunks (${msg.receivedChunks} < ${this.receiverAckedChunks})`
              );
              return;
            }
            this.receiverAckedChunks = msg.receivedChunks;
          }

          this.receiverSupportsFlowControl = true;
          this.receiverAckedBytes = msg.receivedBytes;

          if (msg.type === "DRAIN") {
            this.isReceiverPaused = false;
            this._wakePauseWaiters();
          }

          this._wakeFlowControlWaiters();
          return;
        }

        if (msg.type === "CANCEL") {
          this.cancel(msg.reason || "Cancelled by peer", false);
          return;
        }
      } catch (err) {
        this._handleError(err);
      }
    }
  }

  _rejectAck(err) {
    if (this._ackTimer) {
      clearTimeout(this._ackTimer);
      this._ackTimer = null;
    }
    if (this._ackRejecter) {
      const reject = this._ackRejecter;
      this._ackResolver = null;
      this._ackRejecter = null;
      reject(err);
    } else {
      this._handleError(err);
    }
  }

  async _waitForReceiverResume() {
    if (!this.isReceiverPaused || this.isTerminated) return;

    const timeoutMs = this.limits.pauseTimeoutMs || 15000;

    await new Promise((resolve, reject) => {
      let timer = null;
      let settled = false;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        this._pauseWaiters.delete(waiter);
      };

      const waiter = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      this._pauseWaiters.add(waiter);

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        // Never resume transmission automatically on pause timeout!
        if (!this.isTerminated && this.isReceiverPaused) {
          const err = new Error(
            `Receiver pause timed out: receiver did not resume transmission within ${timeoutMs}ms`
          );
          this._handleError(err);
          reject(err);
        } else {
          resolve();
        }
      }, timeoutMs);
    });
  }

  async _waitForFlowControlWindow(chunkLength = 0) {
    if (this.isTerminated || this.state !== SENDER_STATE.SENDING) return;

    if (
      typeof chunkLength !== "number" ||
      !Number.isFinite(chunkLength) ||
      chunkLength < 0
    ) {
      const err = new TypeError(
        `P2PFileSender: chunkLength must be a non-negative number, got ${chunkLength}`
      );
      this._handleError(err);
      throw err;
    }

    const maxInFlight = this.limits.maxInFlightBytes;
    const timeoutMs = this.limits.flowControlTimeoutMs || 15000;

    if (chunkLength > maxInFlight) {
      const err = new RangeError(
        `Chunk length (${chunkLength} bytes) exceeds maximum allowable in-flight limit (${maxInFlight} bytes)`
      );
      this._handleError(err);
      throw err;
    }

    // Strict in-flight window check: recheck until capacity becomes available
    while (!this.isTerminated && this.state === SENDER_STATE.SENDING) {
      const inFlight = this.sentBytes - this.receiverAckedBytes;
      const isWindowFull =
        inFlight >= maxInFlight || inFlight + chunkLength > maxInFlight;

      if (!isWindowFull) {
        break;
      }

      await new Promise((resolve, reject) => {
        let timer = null;
        let settled = false;

        const cleanup = () => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          this._flowControlWaiters.delete(waiter);
        };

        const waiter = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        };

        this._flowControlWaiters.add(waiter);

        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          const currentInFlight = this.sentBytes - this.receiverAckedBytes;
          const stillFull =
            currentInFlight >= maxInFlight ||
            currentInFlight + chunkLength > maxInFlight;

          if (!this.isTerminated && this.state === SENDER_STATE.SENDING && stillFull) {
            const err = new Error(
              `Flow control timed out: receiver did not acknowledge in-flight data within ${timeoutMs}ms (in-flight: ${currentInFlight} bytes, limit: ${maxInFlight} bytes)`
            );
            this._handleError(err);
            reject(err);
          } else {
            resolve();
          }
        }, timeoutMs);
      });
    }
  }

  async _waitForBufferDrainBeforeCompletion() {
    if (this.isTerminated) {
      if (this.isCancelled) {
        throw new Error("Transfer cancelled");
      }
      throw new Error("Transfer terminated during buffer drain");
    }
    if (!this.dc || this.dc.readyState !== "open") {
      throw new Error("DataChannel is not open for buffer drain");
    }
    if (this.dc.bufferedAmount === 0) return;

    const timeoutMs = this.limits.drainTimeoutMs || this.limits.bufferDrainTimeoutMs || 15000;

    await new Promise((resolve, reject) => {
      let timer = null;
      let pollInterval = null;
      let settled = false;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        this._drainWaiters.delete(waiter);
        if (this.dc) {
          try {
            this.dc.removeEventListener?.("bufferedamountlow", onLow);
            this.dc.removeEventListener?.("close", onClose);
            this.dc.removeEventListener?.("error", onError);
          } catch {}
        }
      };

      const waiter = () => {
        if (settled) return;

        if (this.isTerminated) {
          settled = true;
          cleanup();
          if (this.isCancelled) {
            reject(new Error("Transfer cancelled"));
          } else {
            reject(new Error("Transfer terminated during buffer drain"));
          }
          return;
        }

        if (!this.dc || this.dc.readyState !== "open") {
          settled = true;
          cleanup();
          const err = new Error("DataChannel closed while waiting for buffer drain");
          this._handleError(err);
          reject(err);
          return;
        }

        if (this.dc.bufferedAmount === 0) {
          settled = true;
          cleanup();
          resolve();
          return;
        }

        // Buffer is still non-empty: do not resolve as successful;
        // keep waiting until the buffer drains, the channel closes, cancellation/termination occurs, or the timeout expires.
        if (!this._drainWaiters.has(waiter)) {
          this._drainWaiters.add(waiter);
        }
      };

      this._drainWaiters.add(waiter);

      const onLow = () => {
        if (settled) return;
        if (this.isTerminated) {
          waiter();
          return;
        }
        if (!this.dc || this.dc.readyState !== "open") {
          onClose();
          return;
        }
        if (this.dc.bufferedAmount === 0) {
          settled = true;
          cleanup();
          resolve();
        }
      };

      const onClose = () => {
        if (settled) return;
        settled = true;
        cleanup();
        const err = new Error("DataChannel closed while waiting for buffer drain");
        this._handleError(err);
        reject(err);
      };

      const onError = (e) => {
        if (settled) return;
        settled = true;
        cleanup();
        const err = new Error(
          `DataChannel error while waiting for buffer drain: ${e?.message || "Unknown error"}`
        );
        this._handleError(err);
        reject(err);
      };

      try {
        this.dc.bufferedAmountLowThreshold = 0;
        this.dc.addEventListener?.("bufferedamountlow", onLow);
        this.dc.addEventListener?.("close", onClose);
        this.dc.addEventListener?.("error", onError);
      } catch {}

      if (this.isTerminated) {
        waiter();
        return;
      }
      if (!this.dc || this.dc.readyState !== "open") {
        onClose();
        return;
      }
      if (this.dc.bufferedAmount === 0) {
        settled = true;
        cleanup();
        resolve();
        return;
      }

      pollInterval = setInterval(() => {
        if (settled) return;
        if (this.isTerminated) {
          waiter();
          return;
        }
        if (!this.dc || this.dc.readyState !== "open") {
          onClose();
          return;
        }
        if (this.dc.bufferedAmount === 0) {
          settled = true;
          cleanup();
          resolve();
        }
      }, 25);

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const unsent = this.dc?.bufferedAmount ?? 0;
        cleanup();
        if (this.isTerminated) {
          if (this.isCancelled) {
            reject(new Error("Transfer cancelled"));
          } else {
            reject(new Error("Transfer terminated during buffer drain"));
          }
          return;
        }
        const err = new Error(
          `DataChannel buffer drain timed out: ${unsent} bytes remained unsent after ${timeoutMs}ms`
        );
        this._handleError(err);
        reject(err);
      }, timeoutMs);
    });
  }

  async _onChannelOpen() {
    if (this.isTerminated) return;

    try {
      if (this._connectionTimer) {
        clearTimeout(this._connectionTimer);
        this._connectionTimer = null;
      }

      if (this.dc && !this.dc.onclose) {
        this.dc.onclose = () => {
          this._wakePauseWaiters();
          this._wakeFlowControlWaiters();
          this._wakeDrainWaiters();
          if (
            !this.isTerminated &&
            this.state !== SENDER_STATE.COMPLETED &&
            this.state !== SENDER_STATE.CANCELLED
          ) {
            this._handleError(new Error("DataChannel closed prematurely during transfer"));
          }
        };
      }

      this.startTime = Date.now();
      this.lastProgressTime = 0;

      // Validate local file parameters (supports 0-byte empty files)
      if (
        !this.file ||
        typeof this.file.size !== "number" ||
        this.file.size < 0 ||
        !Number.isSafeInteger(this.file.size)
      ) {
        throw new Error("Cannot send invalid file");
      }

      if (this.file.size > this.limits.maxFileSize) {
        throw new Error(
          `File size (${this.file.size} bytes) exceeds maximum allowable limit (${this.limits.maxFileSize} bytes)`
        );
      }

      const nameValidation = validateAndSanitizeFilename(this.file.name);
      if (!nameValidation.isValid) {
        throw new Error(`Invalid file name: ${nameValidation.error}`);
      }

      const mimeValidation = validateMimeType(this.file.type || DEFAULT_MIME_TYPE);
      if (!mimeValidation.isValid) {
        throw new Error(`Invalid MIME type: ${mimeValidation.error}`);
      }

      const totalChunks = this.file.size === 0 ? 0 : Math.ceil(this.file.size / this.chunkSize);
      this.totalChunks = totalChunks;
      const maxChunks = this.limits.maxChunkCount || this.limits.maxTotalChunks;
      if (maxChunks && totalChunks > maxChunks) {
        throw new Error(
          `Total chunks (${totalChunks}) exceeds maximum allowable limit (${maxChunks})`
        );
      }

      this.hasher = new StreamingSHA256();
      this.state = SENDER_STATE.SENDING;

      // Initial progress notification protected against UI exceptions
      this._emitProgress({
        sentBytes: 0,
        totalBytes: this.file.size,
        percent: this.file.size === 0 ? 100 : 0,
        speed: 0,
        eta: null,
      });

      // 1. Send metadata control packet with custom limits enforcement
      this.dc.send(
        createHeaderMessage(
          {
            fileName: nameValidation.sanitizedName,
            fileSize: this.file.size,
            fileType: mimeValidation.sanitizedType,
            totalChunks,
            chunkSize: this.chunkSize,
          },
          this.limits
        )
      );

      // 2. Set flow control low watermark threshold
      try {
        this.dc.bufferedAmountLowThreshold = BUFFER_LOW_WATERMARK;
      } catch {}

      let sentBytes = 0;
      let offset = 0;

      // 3. Stream file chunks with SCTP backpressure and receiver flow control
      while (offset < this.file.size && !this.isTerminated && this.state === SENDER_STATE.SENDING) {
        // Receiver-side backpressure: respect PAUSE signal
        if (this.isReceiverPaused) {
          await this._waitForReceiverResume();
        }

        if (this.isTerminated || !this.dc || this.dc.readyState !== "open") break;

        // Receiver-side sliding window: wait for in-flight capacity
        const nextChunkLength = Math.min(this.chunkSize, this.file.size - offset);
        await this._waitForFlowControlWindow(nextChunkLength);

        if (this.isTerminated || !this.dc || this.dc.readyState !== "open") break;

        // SCTP network backpressure: wait for socket buffer drain if queue reaches high watermark
        await waitForBufferDrain(this.dc, {
          highWatermark: BUFFER_HIGH_WATERMARK,
          lowWatermark: BUFFER_LOW_WATERMARK,
          checkCancelled: () => this.isTerminated,
        });

        if (this.isTerminated || !this.dc || this.dc.readyState !== "open") break;

        const slice = this.file.slice(offset, offset + this.chunkSize);
        const arrayBuffer = await slice.arrayBuffer();

        if (this.isTerminated || !this.dc || this.dc.readyState !== "open") break;

        this.hasher.update(new Uint8Array(arrayBuffer));
        this.dc.send(arrayBuffer);

        offset += arrayBuffer.byteLength;
        sentBytes += arrayBuffer.byteLength;
        this.sentBytes = sentBytes;
        this.sentChunks += 1;

        const now = Date.now();
        if (now - this.lastProgressTime >= 150 || sentBytes >= this.file.size) {
          this.lastProgressTime = now;
          const elapsedSec = (now - this.startTime) / 1000;
          const speed = elapsedSec > 0 ? sentBytes / elapsedSec : 0;
          const percent =
            sentBytes >= this.file.size
              ? 100
              : Math.min(99, Math.floor((sentBytes / this.file.size) * 100));
          const remainingBytes = Math.max(0, this.file.size - sentBytes);
          const eta = speed > 0 ? Math.round(remainingBytes / speed) : null;

          this._emitProgress({
            sentBytes,
            totalBytes: this.file.size,
            percent,
            speed,
            eta,
          });
        }
      }

      if (!this.isTerminated && this.state === SENDER_STATE.SENDING) {
        // Wait for WebRTC network buffer to fully drain before sending completion
        await this._waitForBufferDrainBeforeCompletion();

        if (this.isTerminated || !this.dc || this.dc.readyState !== "open") {
          return;
        }

        if (this.dc.bufferedAmount > 0) {
          throw new Error("Cannot send completion message: DataChannel buffer is not drained");
        }

        const checksum = this.hasher.digest();
        this._expectedChecksum = checksum.trim().toLowerCase();
        this.state = SENDER_STATE.AWAITING_ACK;

        // 4. Set up ACK resolver, rejecter, and timeout BEFORE sending COMPLETE control packet
        await new Promise((resolve, reject) => {
          this._ackResolver = resolve;
          this._ackRejecter = reject;
          this._ackTimer = setTimeout(() => {
            if (this._ackRejecter) {
              const rej = this._ackRejecter;
              this._ackResolver = null;
              this._ackRejecter = null;
              rej(
                new Error("Transfer completion timed out: receiver did not acknowledge finalization")
              );
            }
          }, this.limits.ackTimeoutMs);

          try {
            this.dc.send(createCompleteMessage(checksum));
          } catch (sendErr) {
            if (this._ackTimer) {
              clearTimeout(this._ackTimer);
              this._ackTimer = null;
            }
            this._ackResolver = null;
            this._ackRejecter = null;
            reject(new Error(`Failed to send COMPLETE control message: ${sendErr.message}`));
          }
        });

        if (!this.isTerminated) {
          this.state = SENDER_STATE.COMPLETED;
          this.isTerminated = true;
          if (!this._hasTerminalCallbackCalled) {
            this._hasTerminalCallbackCalled = true;
            try {
              this.onComplete({
                fileName: nameValidation.sanitizedName,
                fileSize: this.file.size,
                checksum,
              });
            } catch (cbErr) {
              console.warn("[P2PFileSender] onComplete callback error:", cbErr);
            }
          }
          this._cleanup();
        }
      }
    } catch (err) {
      this._handleError(err);
    }
  }

  cancel(reason = "Transfer cancelled by host", notifyRemote = true) {
    if (this.isTerminated) return;
    this.isCancelled = true;
    this.isTerminated = true;
    this.state = SENDER_STATE.CANCELLED;

    if (this._connectionTimer) {
      clearTimeout(this._connectionTimer);
      this._connectionTimer = null;
    }
    if (this._ackTimer) {
      clearTimeout(this._ackTimer);
      this._ackTimer = null;
    }
    if (this._disconnectGraceTimer) {
      clearTimeout(this._disconnectGraceTimer);
      this._disconnectGraceTimer = null;
    }
    if (this._ackRejecter) {
      const reject = this._ackRejecter;
      this._ackResolver = null;
      this._ackRejecter = null;
      reject(new Error("Transfer cancelled"));
    }

    this._wakePauseWaiters();
    this._wakeFlowControlWaiters();
    this._wakeDrainWaiters();

    if (notifyRemote && this.dc && this.dc.readyState === "open") {
      try {
        this.dc.send(createCancelMessage(reason));
      } catch {}
    }

    if (notifyRemote && this.socket?.connected && this.targetSocketId) {
      try {
        this.socket.emit("p2p:cancel", {
          to: this.targetSocketId,
          reason,
        });
      } catch {}
    }

    if (!this._hasTerminalCallbackCalled) {
      this._hasTerminalCallbackCalled = true;
      try {
        this.onCancel(reason);
      } catch (cbErr) {
        console.warn("[P2PFileSender] onCancel callback error:", cbErr);
      }
    }

    this._cleanup();
  }

  _handleError(err) {
    if (this.isTerminated) return;
    this.isTerminated = true;
    this.state = SENDER_STATE.FAILED;

    if (this._connectionTimer) {
      clearTimeout(this._connectionTimer);
      this._connectionTimer = null;
    }
    if (this._ackTimer) {
      clearTimeout(this._ackTimer);
      this._ackTimer = null;
    }
    if (this._disconnectGraceTimer) {
      clearTimeout(this._disconnectGraceTimer);
      this._disconnectGraceTimer = null;
    }
    if (this._ackRejecter) {
      const reject = this._ackRejecter;
      this._ackResolver = null;
      this._ackRejecter = null;
      reject(err);
    }

    this._wakePauseWaiters();
    this._wakeFlowControlWaiters();
    this._wakeDrainWaiters();

    console.error("[P2PFileSender] Transfer error:", err);
    if (!this._hasTerminalCallbackCalled) {
      this._hasTerminalCallbackCalled = true;
      try {
        this.onError(err);
      } catch (cbErr) {
        console.warn("[P2PFileSender] onError callback error:", cbErr);
      }
    }

    this._cleanup();
  }

  _cleanup() {
    if (this._isCleanedUp) return;
    this._isCleanedUp = true;

    if (this._connectionTimer) {
      clearTimeout(this._connectionTimer);
      this._connectionTimer = null;
    }
    if (this._ackTimer) {
      clearTimeout(this._ackTimer);
      this._ackTimer = null;
    }
    if (this._disconnectGraceTimer) {
      clearTimeout(this._disconnectGraceTimer);
      this._disconnectGraceTimer = null;
    }

    this._ackResolver = null;
    this._ackRejecter = null;

    this._wakePauseWaiters();
    this._wakeFlowControlWaiters();
    this._wakeDrainWaiters();

    this.pendingIceCandidates = [];

    closePeerConnection(this.pc, this.dc);
    this.pc = null;
    this.dc = null;
  }
}
