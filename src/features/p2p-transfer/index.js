/**
 * P2P WebRTC File Transfer Feature Module
 *
 * Public entrypoint for the P2P transfer feature. Exposes high-level transfer
 * coordinators (P2PFileSender, P2PFileReceiver), React hooks (useP2PTransfer),
 * UI components (SidebarTransferPanel, etc.), connection utilities, and data validation helpers.
 */

// Core Transfer Engines & Connection Management
export { P2PFileSender } from "./core/P2PFileSender.js";
export { P2PFileReceiver } from "./core/P2PFileReceiver.js";
export { createPeerConnection, closePeerConnection } from "./core/PeerConnection.js";


// Protocol Messages, States, Constants & Limits
export {
  MESSAGE_TYPE,
  SENDER_STATE,
  RECEIVER_STATE,
  CHUNK_SIZE,
  BUFFER_HIGH_WATERMARK,
  BUFFER_LOW_WATERMARK,
  RECEIVER_BUFFER_HIGH_WATERMARK,
  RECEIVER_BUFFER_LOW_WATERMARK,
  MAX_FILE_SIZE,
  MAX_MEMORY_FILE_SIZE,
  MIN_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  MAX_CHUNK_COUNT,
  DEFAULT_MIME_TYPE,
  DEFAULT_TRANSFER_LIMITS,
  RTC_CONFIG,
  createRtcConfig,
  createHeaderMessage,
  createCompleteMessage,
  createAckMessage,
  createNackMessage,
  createCancelMessage,
  createPauseMessage,
  createResumeMessage,
  createDrainMessage,
  createChunkAckMessage,
} from "./protocol/messages.js";

// Input & Metadata Validation
export {
  validateAndSanitizeFilename,
  validateMimeType,
  validateFileHeader,
  validateTransferLimits,
} from "./protocol/validation.js";

// Performance Flow Control, Storage & Cryptography
export { waitForBufferDrain } from "./utils/backpressure.js";
export { StreamingSHA256, formatBytes, formatRemainingMinutes } from "./utils/fileUtils.js";
export {
  getOPFSFileHandle,
  findOPFSFile,
  cleanupOPFSFile,
  cleanupAllOPFSFiles,
  listOPFSFiles,
  sanitizeSuggestedName,
} from "./utils/opfsStorage.js";
