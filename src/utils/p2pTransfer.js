/**
 * P2P WebRTC File Transfer Engine with Backpressure Flow Control
 * 
 * Slices local files into 64KB ArrayBuffers, streams them over RTCDataChannel,
 * and reassembles them into a Blob on the receiver side.
 */

const CHUNK_SIZE = 64 * 1024; // 64KB chunks (safe SCTP maximum)
const BUFFER_HIGH_WATERMARK = 8 * 1024 * 1024; // 8MB: pause slicing
const BUFFER_LOW_WATERMARK = 2 * 1024 * 1024; // 2MB: resume slicing

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

/**
 * Creates and configures an RTCPeerConnection with ICE forwarding.
 */
function createPeerConnection(socket, targetSocketId, onIceCandidate) {
  const pc = new RTCPeerConnection(RTC_CONFIG);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("p2p:signal", {
        to: targetSocketId,
        signal: { candidate: event.candidate },
      });
    }
  };

  return pc;
}

/**
 * Host / Sender: Slices the local file and streams chunks over DataChannel
 */
export class P2PFileSender {
  constructor(socket, targetSocketId, file, { onProgress, onComplete, onError }) {
    this.socket = socket;
    this.targetSocketId = targetSocketId;
    this.file = file;
    this.onProgress = onProgress || (() => {});
    this.onComplete = onComplete || (() => {});
    this.onError = onError || (() => {});

    this.pc = null;
    this.dc = null;
    this.isCancelled = false;
    this.startTime = null;
  }

  async start() {
    try {
      this.pc = createPeerConnection(this.socket, this.targetSocketId);

      // Create reliable, ordered DataChannel for binary file transfer
      this.dc = this.pc.createDataChannel("file-transfer", {
        ordered: true,
      });
      this.dc.binaryType = "arraybuffer";

      this.dc.onopen = () => this._onChannelOpen();
      this.dc.onerror = (err) => this._handleError(err);
      this.dc.onclose = () => {
        if (!this.isCancelled) {
          console.log("[P2PFileSender] DataChannel closed");
        }
      };

      // Create and send SDP Offer to receiver
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      this.socket.emit("p2p:signal", {
        to: this.targetSocketId,
        signal: { sdp: offer },
      });
    } catch (err) {
      this._handleError(err);
    }
  }

  async handleSignal(signal) {
    if (!this.pc || this.isCancelled) return;

    try {
      if (signal.sdp) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      } else if (signal.candidate) {
        await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (err) {
      console.warn("[P2PFileSender] Error applying remote signal:", err);
    }
  }

  async _onChannelOpen() {
    this.startTime = Date.now();
    const totalChunks = Math.ceil(this.file.size / CHUNK_SIZE);

    try {
      // 1. Send metadata control packet
      this.dc.send(
        JSON.stringify({
          type: "HEADER",
          fileName: this.file.name,
          fileSize: this.file.size,
          fileType: this.file.type || "video/mp4",
          totalChunks,
          chunkSize: CHUNK_SIZE,
        })
      );

      // 2. Set flow control threshold
      this.dc.bufferedAmountLowThreshold = BUFFER_LOW_WATERMARK;

      let sentBytes = 0;
      let offset = 0;

      // 3. Stream file chunks with backpressure management
      while (offset < this.file.size && !this.isCancelled) {
        // Backpressure check: wait if buffer exceeds high-water mark
        if (this.dc.bufferedAmount > BUFFER_HIGH_WATERMARK) {
          await new Promise((resolve) => {
            const onLow = () => {
              this.dc.removeEventListener("bufferedamountlow", onLow);
              resolve();
            };
            this.dc.addEventListener("bufferedamountlow", onLow);
          });
        }

        if (this.isCancelled) break;

        const slice = this.file.slice(offset, offset + CHUNK_SIZE);
        const arrayBuffer = await slice.arrayBuffer();

        this.dc.send(arrayBuffer);

        offset += CHUNK_SIZE;
        sentBytes += arrayBuffer.byteLength;

        const elapsedSec = (Date.now() - this.startTime) / 1000;
        const speed = elapsedSec > 0 ? sentBytes / elapsedSec : 0;
        const percent = Math.min(100, Math.round((sentBytes / this.file.size) * 100));

        this.onProgress({
          sentBytes,
          totalBytes: this.file.size,
          percent,
          speed,
        });
      }

      if (!this.isCancelled) {
        // 4. Send completion control packet
        this.dc.send(JSON.stringify({ type: "COMPLETE" }));
        this.onComplete({
          fileName: this.file.name,
          fileSize: this.file.size,
        });
      }
    } catch (err) {
      this._handleError(err);
    }
  }

  cancel(reason = "Transfer cancelled by host") {
    this.isCancelled = true;
    if (this.socket && this.targetSocketId) {
      this.socket.emit("p2p:cancel", {
        to: this.targetSocketId,
        reason,
      });
    }
    this._cleanup();
  }

  _handleError(err) {
    if (this.isCancelled) return;
    console.error("[P2PFileSender] Transfer error:", err);
    this.onError(err);
    this._cleanup();
  }

  _cleanup() {
    if (this.dc) {
      try { this.dc.close(); } catch (e) {}
      this.dc = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch (e) {}
      this.pc = null;
    }
  }
}

/**
 * Peer / Receiver: Connects to host, receives binary chunks, and constructs a Blob
 */
export class P2PFileReceiver {
  constructor(socket, hostSocketId, { onProgress, onComplete, onError }) {
    this.socket = socket;
    this.hostSocketId = hostSocketId;
    this.onProgress = onProgress || (() => {});
    this.onComplete = onComplete || (() => {});
    this.onError = onError || (() => {});

    this.pc = null;
    this.dc = null;
    this.isCancelled = false;
    this.startTime = null;

    this.metadata = null;
    this.chunks = [];
    this.receivedBytes = 0;
    this.watchdogTimer = null;
  }

  start(fileMetadata) {
    this.startTime = Date.now();
    this._resetWatchdog();

    // Ask host to begin P2P transfer
    this.socket.emit("p2p:request", {
      to: this.hostSocketId,
      fileName: fileMetadata?.fileName,
      fileSize: fileMetadata?.fileSize,
    });
  }

  async handleSignal(signal) {
    if (this.isCancelled) return;

    try {
      if (signal.sdp) {
        // Host sent SDP Offer: initialize receiver connection
        this.pc = createPeerConnection(this.socket, this.hostSocketId);

        this.pc.ondatachannel = (event) => {
          this.dc = event.channel;
          this.dc.binaryType = "arraybuffer";
          this.dc.onmessage = (e) => this._onMessage(e);
          this.dc.onerror = (err) => this._handleError(err);
          this.dc.onclose = () => {
            if (!this.isCancelled && this.receivedBytes < (this.metadata?.fileSize || Infinity)) {
              this._handleError(new Error("P2P connection closed prematurely"));
            }
          };
        };

        await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);

        this.socket.emit("p2p:signal", {
          to: this.hostSocketId,
          signal: { sdp: answer },
        });
      } else if (signal.candidate && this.pc) {
        await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (err) {
      this._handleError(err);
    }
  }

  _onMessage(event) {
    this._resetWatchdog();

    if (typeof event.data === "string") {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "HEADER") {
          this.metadata = msg;
          this.chunks = [];
          this.receivedBytes = 0;
        } else if (msg.type === "COMPLETE") {
          this._finalizeFile();
        }
      } catch (err) {
        console.warn("[P2PFileReceiver] Malformed control packet:", err);
      }
      return;
    }

    // Binary payload: accumulate ArrayBuffer chunk
    const chunk = event.data;
    this.chunks.push(chunk);
    this.receivedBytes += chunk.byteLength;

    const totalBytes = this.metadata?.fileSize || 0;
    const elapsedSec = (Date.now() - this.startTime) / 1000;
    const speed = elapsedSec > 0 ? this.receivedBytes / elapsedSec : 0;
    const percent = totalBytes > 0 ? Math.min(100, Math.round((this.receivedBytes / totalBytes) * 100)) : 0;
    const remainingBytes = Math.max(0, totalBytes - this.receivedBytes);
    const eta = speed > 0 ? Math.round(remainingBytes / speed) : null;

    this.onProgress({
      receivedBytes: this.receivedBytes,
      totalBytes,
      percent,
      speed,
      eta,
    });
  }

  _finalizeFile() {
    this._clearWatchdog();

    try {
      const mimeType = this.metadata?.fileType || "video/mp4";
      const blob = new Blob(this.chunks, { type: mimeType });

      // Create synthetic File object compatible with local video player
      const file = new File([blob], this.metadata?.fileName || "video.mp4", {
        type: mimeType,
        lastModified: Date.now(),
      });

      this.onComplete(file, blob, this.metadata);
      this._cleanup();
    } catch (err) {
      this._handleError(err);
    }
  }

  _resetWatchdog() {
    this._clearWatchdog();
    // 15-second inactivity timeout
    this.watchdogTimer = setTimeout(() => {
      this._handleError(new Error("File transfer timed out: no response from host"));
    }, 15000);
  }

  _clearWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  cancel(reason = "Transfer cancelled by user") {
    this.isCancelled = true;
    this._clearWatchdog();
    if (this.socket && this.hostSocketId) {
      this.socket.emit("p2p:cancel", {
        to: this.hostSocketId,
        reason,
      });
    }
    this._cleanup();
  }

  _handleError(err) {
    if (this.isCancelled) return;
    this._clearWatchdog();
    console.error("[P2PFileReceiver] Transfer error:", err);
    this.onError(err);
    this._cleanup();
  }

  _cleanup() {
    this._clearWatchdog();
    if (this.dc) {
      try { this.dc.close(); } catch (e) {}
      this.dc = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch (e) {}
      this.pc = null;
    }
  }
}
