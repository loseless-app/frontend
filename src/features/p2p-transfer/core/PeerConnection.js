/**
 * WebRTC Peer Connection Lifecycle & Signaling Helper
 *
 * Re-exports shared connection primitives from the global WebRTC service,
 * keeping the P2P transfer module backwards-compatible and reusable for future
 * WebRTC streaming capabilities without duplication.
 */

export {
  createPeerConnection,
  closePeerConnection,
  createRtcConfig,
  RTC_CONFIG,
} from "../../../services/webrtc.js";
