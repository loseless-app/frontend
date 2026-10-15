/**
 * Shared WebRTC Foundation Service
 *
 * Provides reusable connection lifecycle management, ICE candidate queuing/deduplication,
 * STUN/TURN server configuration, and socket signaling helpers for WebRTC features
 * (P2P file transfer, WebRTC live video/audio streaming, and data channels).
 */

// Default public STUN servers for NAT traversal fallback
export const RTC_CONFIG = Object.freeze({
  iceServers: Object.freeze([
    Object.freeze({ urls: "stun:stun.l.google.com:19302" }),
    Object.freeze({ urls: "stun:stun1.l.google.com:19302" }),
  ]),
  iceCandidatePoolSize: 2,
});

/**
 * Creates an RTCPeerConnection configuration object.
 * Merges ephemeral STUN/TURN servers from backend with sensible defaults.
 *
 * @param {Array<object>} [customIceServers] - Custom or backend-provided ICE servers
 * @returns {RTCConfiguration}
 */
export function createRtcConfig(customIceServers = null) {
  if (Array.isArray(customIceServers) && customIceServers.length > 0) {
    return {
      iceServers: customIceServers.map((server) => ({ ...server })),
      iceCandidatePoolSize: 2,
    };
  }

  return {
    iceServers: RTC_CONFIG.iceServers.map((server) => ({ ...server })),
    iceCandidatePoolSize: 2,
  };
}

function getCandidateJson(candidate) {
  if (!candidate) return "{}";
  if (typeof candidate === "string") return JSON.stringify({ candidate });
  if (typeof candidate.toJSON === "function") {
    try {
      return JSON.stringify(candidate.toJSON());
    } catch {}
  }
  return JSON.stringify({
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment,
  });
}

/**
 * Creates an RTCPeerConnection and wires up ICE candidate signaling to the target peer.
 *
 * @param {object} socket - Socket.IO client instance
 * @param {string} targetSocketId - Socket ID of the remote peer
 * @param {Function|object} [optionsOrOnIceCandidate] - Optional hook for custom ICE candidate handling or RTC options
 * @returns {RTCPeerConnection}
 */
export function createPeerConnection(socket, targetSocketId, optionsOrOnIceCandidate = {}) {
  const isFunction = typeof optionsOrOnIceCandidate === "function";
  const options = isFunction ? {} : optionsOrOnIceCandidate || {};
  const onIceCandidate = isFunction ? optionsOrOnIceCandidate : options.onIceCandidate;

  const rtcConfig = options.rtcConfig || createRtcConfig(options.iceServers);
  const pc = new RTCPeerConnection(rtcConfig);

  const maxPendingIceCandidates =
    options.limits?.maxPendingIceCandidates ??
    options.maxPendingIceCandidates ??
    64;

  const pendingOutgoingCandidates = [];

  const flushPendingIceCandidates = () => {
    if (!socket?.connected) return;
    while (pendingOutgoingCandidates.length > 0) {
      const candidate = pendingOutgoingCandidates.shift();
      try {
        socket.emit("p2p:signal", {
          to: targetSocketId,
          signal: { candidate },
        });
      } catch (err) {
        console.warn("[createPeerConnection] Failed to send buffered ICE candidate:", err);
      }
    }
  };

  const onSocketConnect = () => {
    flushPendingIceCandidates();
  };

  if (socket && typeof socket.on === "function") {
    socket.on("connect", onSocketConnect);
  }

  pc._pendingIceCandidates = pendingOutgoingCandidates;
  pc.flushPendingIceCandidates = flushPendingIceCandidates;
  pc._cleanupSocket = () => {
    if (socket) {
      if (typeof socket.off === "function") {
        socket.off("connect", onSocketConnect);
      } else if (typeof socket.removeListener === "function") {
        socket.removeListener("connect", onSocketConnect);
      }
    }
    pendingOutgoingCandidates.length = 0;
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      if (typeof onIceCandidate === "function") {
        try {
          onIceCandidate(event.candidate);
        } catch (err) {
          console.warn("[createPeerConnection] onIceCandidate callback error:", err);
        }
      }
      if (socket?.connected) {
        socket.emit("p2p:signal", {
          to: targetSocketId,
          signal: { candidate: event.candidate },
        });
      } else {
        const cand = event.candidate;
        const candJson = getCandidateJson(cand);
        const isDuplicate = pendingOutgoingCandidates.some(
          (c) => getCandidateJson(c) === candJson
        );
        if (!isDuplicate) {
          if (pendingOutgoingCandidates.length < maxPendingIceCandidates) {
            pendingOutgoingCandidates.push(cand);
          } else {
            console.warn(
              `[createPeerConnection] Outgoing ICE candidate queue limit reached (${maxPendingIceCandidates})`
            );
          }
        }
      }
    }
  };

  return pc;
}

/**
 * Safely closes an RTCDataChannel and RTCPeerConnection, removing all event listeners.
 * Supports data channels, media tracks, and connection state observers.
 *
 * @param {RTCPeerConnection|null} pc
 * @param {RTCDataChannel|null} [dc]
 */
export function closePeerConnection(pc, dc = null) {
  if (dc) {
    dc.onmessage = null;
    dc.onerror = null;
    dc.onclose = null;
    dc.onopen = null;
    dc.onbufferedamountlow = null;
    try { dc.close(); } catch {}
  }

  if (pc) {
    if (typeof pc._cleanupSocket === "function") {
      try {
        pc._cleanupSocket();
      } catch {}
      pc._cleanupSocket = null;
    }
    pc.onicecandidate = null;
    pc.ondatachannel = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    try { pc.close(); } catch {}
  }
}
