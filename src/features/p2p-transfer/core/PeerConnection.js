/**
 * WebRTC Peer Connection Lifecycle & Signaling Helper
 *
 * Provides factory initialization, ICE candidate forwarding via Socket.IO,
 * safe connection teardown, and onIceCandidate callback invocation.
 */

import { createRtcConfig } from "../protocol/messages.js";

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
      }
    }
  };

  return pc;
}

/**
 * Safely closes an RTCDataChannel and RTCPeerConnection, removing all event listeners.
 *
 * @param {RTCPeerConnection|null} pc
 * @param {RTCDataChannel|null} dc
 */
export function closePeerConnection(pc, dc) {
  if (dc) {
    dc.onmessage = null;
    dc.onerror = null;
    dc.onclose = null;
    dc.onopen = null;
    dc.onbufferedamountlow = null;
    try { dc.close(); } catch {}
  }

  if (pc) {
    pc.onicecandidate = null;
    pc.ondatachannel = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    try { pc.close(); } catch {}
  }
}
