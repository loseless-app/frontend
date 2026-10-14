import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  DEFAULT_TRANSFER_LIMITS,
  StreamingSHA256,
  validateAndSanitizeFilename,
  validateMimeType,
  validateFileHeader,
  validateTransferLimits,
  waitForBufferDrain,
  createPeerConnection,
  P2PFileSender,
  P2PFileReceiver,
  SENDER_STATE,
  RECEIVER_STATE,
  RTC_CONFIG,
  createRtcConfig,
  MESSAGE_TYPE,
  createHeaderMessage,
  createCompleteMessage,
  createAckMessage,
  createNackMessage,
  createCancelMessage,
  createPauseMessage,
  createResumeMessage,
  createDrainMessage,
  createChunkAckMessage,
  MAX_FILE_SIZE,
  MIN_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  MAX_CHUNK_COUNT,
  DEFAULT_MIME_TYPE,
  CHUNK_SIZE,
  RECEIVER_BUFFER_HIGH_WATERMARK,
  RECEIVER_BUFFER_LOW_WATERMARK,
} from "../index.js";

// Global mock classes for WebRTC in Node.js test environment
class MockRTCPeerConnection {
  constructor(config) {
    this.config = config;
    this.signalingState = "stable";
    this.connectionState = "new";
    this.remoteDescription = null;
    this.localDescription = null;
    this.addedCandidates = [];
    this.onicecandidate = null;
    this.ondatachannel = null;
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0 mock offer" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "v=0 mock answer" };
  }
  async setLocalDescription(desc) {
    this.localDescription = desc;
    this.signalingState = desc.type === "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
    this.signalingState = desc.type === "offer" ? "have-remote-offer" : "stable";
  }
  async addIceCandidate(candidate) {
    if (!this.remoteDescription) {
      throw new Error("InvalidStateError: Remote description not set");
    }
    this.addedCandidates.push(candidate);
  }
  createDataChannel(_label, _options) {
    return createMockDataChannel();
  }
  close() {
    this.connectionState = "closed";
  }
}

globalThis.RTCPeerConnection = MockRTCPeerConnection;
globalThis.RTCSessionDescription = class RTCSessionDescription {
  constructor(init) { Object.assign(this, init); }
};
globalThis.RTCIceCandidate = class RTCIceCandidate {
  constructor(init) { Object.assign(this, init); }
};

// Helper to create mock DataChannel
function createMockDataChannel() {
  const dc = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    binaryType: "arraybuffer",
    sentMessages: [],
    listeners: new Map(),

    send(data) {
      if (this.readyState !== "open") {
        throw new Error("InvalidStateError: DataChannel is not open");
      }
      this.sentMessages.push(data);
    },
    addEventListener(event, handler) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, new Set());
      }
      this.listeners.get(event).add(handler);
    },
    removeEventListener(event, handler) {
      if (this.listeners.has(event)) {
        this.listeners.get(event).delete(handler);
      }
    },
    dispatchEvent(event, data) {
      const handlers = this.listeners.get(event);
      if (handlers) {
        for (const handler of handlers) {
          handler(data);
        }
      }
    },
    close() {
      this.readyState = "closed";
      if (this.onclose) this.onclose();
    },
  };
  return dc;
}

// Helper to create mock Socket
function createMockSocket() {
  return {
    connected: true,
    emitted: [],
    emit(event, data) {
      this.emitted.push({ event, data });
    },
  };
}

// Helper to create mock FileSystemWritableFileStream
function createMockWritableStream({ failOnWrite = false, isQuotaError = false } = {}) {
  return {
    writes: [],
    closed: false,
    aborted: false,

    async write(chunk) {
      if (failOnWrite) {
        if (isQuotaError) {
          const err = new Error("The quota has been exceeded");
          err.name = "QuotaExceededError";
          throw err;
        }
        throw new Error("Disk I/O error during write");
      }
      this.writes.push(chunk);
    },
    async close() {
      this.closed = true;
    },
    async abort() {
      this.aborted = true;
    },
  };
}

// Helper to create mock FileHandle
function createMockFileHandle(writable) {
  return {
    async createWritable() {
      return writable;
    },
    async getFile() {
      return new File([new Uint8Array([1, 2, 3])], "test.mp4", { type: "video/mp4" });
    },
  };
}

// ==========================================
// 1. Filename Validation & Sanitization Tests
// ==========================================
test("validateAndSanitizeFilename: sanitizes clean and dangerous filenames", () => {
  // Normal valid filename
  const normal = validateAndSanitizeFilename("my_video.mp4");
  assert.strictEqual(normal.isValid, true);
  assert.strictEqual(normal.sanitizedName, "my_video.mp4");

  // Path traversal sequences
  const traversal1 = validateAndSanitizeFilename("../../etc/passwd");
  assert.strictEqual(traversal1.isValid, false);
  assert.match(traversal1.error, /path traversal/i);

  const traversal2 = validateAndSanitizeFilename("..\\..\\Windows\\System32\\cmd.exe");
  assert.strictEqual(traversal2.isValid, false);
  assert.match(traversal2.error, /path traversal/i);

  // Null bytes
  const nullByte = validateAndSanitizeFilename("video\0.exe");
  assert.strictEqual(nullByte.isValid, false);

  // Strips leading path segments safely
  const pathSegment = validateAndSanitizeFilename("/var/media/sample.mkv");
  assert.strictEqual(pathSegment.isValid, true);
  assert.strictEqual(pathSegment.sanitizedName, "sample.mkv");

  // Windows reserved device names
  const con = validateAndSanitizeFilename("CON.mp4");
  assert.strictEqual(con.isValid, true);
  assert.strictEqual(con.sanitizedName, "file_CON.mp4");

  const aux = validateAndSanitizeFilename("aux.mkv");
  assert.strictEqual(aux.isValid, true);
  assert.strictEqual(aux.sanitizedName, "file_aux.mkv");

  const nul = validateAndSanitizeFilename("nul");
  assert.strictEqual(nul.isValid, true);
  assert.strictEqual(nul.sanitizedName, "file_nul");

  // Control characters stripped
  const ctrl = validateAndSanitizeFilename("clip\x1b\x07.mp4");
  assert.strictEqual(ctrl.isValid, true);
  assert.strictEqual(ctrl.sanitizedName, "clip.mp4");

  // Rejects empty / whitespace / dots only
  assert.strictEqual(validateAndSanitizeFilename("").isValid, false);
  assert.strictEqual(validateAndSanitizeFilename("   ").isValid, false);
  assert.strictEqual(validateAndSanitizeFilename("...").isValid, false);

  // Length clamping to <= 255 chars
  const longName = "a".repeat(300) + ".mp4";
  const clamped = validateAndSanitizeFilename(longName);
  assert.strictEqual(clamped.isValid, true);
  assert.ok(clamped.sanitizedName.length <= 255);
  assert.ok(clamped.sanitizedName.endsWith(".mp4"));
});

// ==========================================
// 2. MIME Type Validation Tests
// ==========================================
test("validateMimeType: allows safe media MIME types and rejects dangerous ones", () => {
  // Valid types
  assert.strictEqual(validateMimeType("video/mp4").isValid, true);
  assert.strictEqual(validateMimeType("video/x-matroska").isValid, true);
  assert.strictEqual(validateMimeType("video/webm").isValid, true);
  assert.strictEqual(validateMimeType("application/octet-stream").isValid, true);

  // Syntax errors
  assert.strictEqual(validateMimeType("not-a-mime").isValid, false);
  assert.strictEqual(validateMimeType("video/").isValid, false);
  assert.strictEqual(validateMimeType("").isValid, false);

  // Forbidden executable / script types
  assert.strictEqual(validateMimeType("text/javascript").isValid, false);
  assert.strictEqual(validateMimeType("application/javascript").isValid, false);
  assert.strictEqual(validateMimeType("text/html").isValid, false);

  // Length overflow (> 128 chars)
  const longMime = "video/" + "a".repeat(150);
  assert.strictEqual(validateMimeType(longMime).isValid, false);
});

// ==========================================
// 3. Header Metadata Validation Tests
// ==========================================
test("validateFileHeader: validates header limits and detects inconsistencies", () => {
  const valid = {
    type: "HEADER",
    fileName: "video.mp4",
    fileSize: 131072, // 128 KB
    fileType: "video/mp4",
    chunkSize: 65536, // 64 KB
    totalChunks: 2,
  };

  const res = validateFileHeader(valid);
  assert.strictEqual(res.isValid, true);
  assert.strictEqual(res.sanitizedHeader.fileSize, 131072);
  assert.strictEqual(res.sanitizedHeader.totalChunks, 2);

  // Malformed header
  assert.strictEqual(validateFileHeader(null).isValid, false);
  assert.strictEqual(validateFileHeader({ type: "UNKNOWN" }).isValid, false);

  // Negative or float fileSize
  assert.strictEqual(validateFileHeader({ ...valid, fileSize: -50 }).isValid, false);
  assert.strictEqual(validateFileHeader({ ...valid, fileSize: 100.5 }).isValid, false);
  assert.strictEqual(validateFileHeader({ ...valid, fileSize: 0 }).isValid, false);

  // Inconsistent totalChunks (Math.ceil(131072 / 65536) = 2, but announced 3)
  const inconsistent = validateFileHeader({ ...valid, totalChunks: 3 });
  assert.strictEqual(inconsistent.isValid, false);
  assert.match(inconsistent.error, /inconsistent totalchunks/i);

  // Oversized fileSize beyond limit
  const oversizedFile = validateFileHeader({ ...valid, fileSize: 1000 }, { ...DEFAULT_TRANSFER_LIMITS, maxFileSize: 500 });
  assert.strictEqual(oversizedFile.isValid, false);
  assert.match(oversizedFile.error, /exceeds maximum allowable limit/i);

  // Invalid chunkSize
  const smallChunk = validateFileHeader({ ...valid, chunkSize: 100 });
  assert.strictEqual(smallChunk.isValid, false);

  // Oversized totalChunks limit
  const tooManyChunks = validateFileHeader({ ...valid, totalChunks: 2 }, { ...DEFAULT_TRANSFER_LIMITS, maxChunkCount: 1 });
  assert.strictEqual(tooManyChunks.isValid, false);
});

// ==========================================
// 4. Streaming SHA-256 Checksum Tests
// ==========================================
test("StreamingSHA256: byte-for-byte match with crypto.createHash across random chunk sizes", () => {
  // Empty data
  const hEmpty = new StreamingSHA256();
  assert.strictEqual(hEmpty.digest(), crypto.createHash("sha256").digest("hex"));

  // Fixed known text
  const hText = new StreamingSHA256();
  hText.update(Buffer.from("The quick brown fox jumps over the lazy dog"));
  assert.strictEqual(
    hText.digest(),
    crypto.createHash("sha256").update("The quick brown fox jumps over the lazy dog").digest("hex")
  );

  // 1MB random data in varied chunk sizes crossing 64-byte block boundaries
  const randData = crypto.randomBytes(1024 * 1024);
  const hRand = new StreamingSHA256();
  let offset = 0;
  while (offset < randData.length) {
    const sz = Math.min(randData.length - offset, Math.floor(Math.random() * 70000) + 1);
    hRand.update(randData.subarray(offset, offset + sz));
    offset += sz;
  }
  const computedHash = hRand.digest();
  const expectedHash = crypto.createHash("sha256").update(randData).digest("hex");
  assert.strictEqual(computedHash, expectedHash);
});

// ==========================================
// 5. P2PFileReceiver Validation & Integrity Tests
// ==========================================
test("P2PFileReceiver: rejects malformed metadata header with NACK", async () => {
  const socket = createMockSocket();
  let errorReceived = null;

  const receiver = new P2PFileReceiver(socket, "host-1", {
    onError: (err) => { errorReceived = err; },
  });
  const mockDc = createMockDataChannel();
  receiver.dc = mockDc;

  // Send malformed header with negative file size
  await receiver._onMessage({
    data: JSON.stringify({
      type: "HEADER",
      fileName: "test.mp4",
      fileSize: -100,
      fileType: "video/mp4",
      chunkSize: 65536,
      totalChunks: 1,
    }),
  });

  assert.ok(errorReceived);
  assert.match(errorReceived.message, /malformed file header/i);

  // Verify NACK was sent over DataChannel
  const sent = mockDc.sentMessages.map((m) => JSON.parse(m));
  const nack = sent.find((m) => m.type === "NACK");
  assert.ok(nack);
  assert.match(nack.reason, /invalid filesize/i);
});

test("P2PFileReceiver: rejects duplicate HEADER messages", async () => {
  const socket = createMockSocket();
  let errorReceived = null;

  const receiver = new P2PFileReceiver(socket, "host-1", {
    onError: (err) => { errorReceived = err; },
  });
  const mockDc = createMockDataChannel();
  receiver.dc = mockDc;

  const validHeader = JSON.stringify({
    type: "HEADER",
    fileName: "test.mp4",
    fileSize: 65536,
    fileType: "video/mp4",
    chunkSize: 65536,
    totalChunks: 1,
  });

  await receiver._onMessage({ data: validHeader });
  assert.strictEqual(errorReceived, null);

  // Send duplicate header
  await receiver._onMessage({ data: validHeader });
  assert.ok(errorReceived);
  assert.match(errorReceived.message, /duplicate header/i);
});

test("P2PFileReceiver: rejects binary chunks received before HEADER", async () => {
  const socket = createMockSocket();
  let errorReceived = null;

  const receiver = new P2PFileReceiver(socket, "host-1", {
    onError: (err) => { errorReceived = err; },
  });
  const mockDc = createMockDataChannel();
  receiver.dc = mockDc;

  // Send binary chunk before any HEADER
  const chunk = new Uint8Array(100).buffer;
  await receiver._onMessage({ data: chunk });

  assert.ok(errorReceived);
  assert.match(errorReceived.message, /binary chunk received before header/i);
});

test("P2PFileReceiver: rejects premature COMPLETE message before HEADER", async () => {
  const socket = createMockSocket();
  let errorReceived = null;

  const receiver = new P2PFileReceiver(socket, "host-1", {
    onError: (err) => { errorReceived = err; },
  });
  const mockDc = createMockDataChannel();
  receiver.dc = mockDc;

  // Send COMPLETE before HEADER
  await receiver._onMessage({ data: JSON.stringify({ type: "COMPLETE", checksum: "abc" }) });

  assert.ok(errorReceived);
  assert.match(errorReceived.message, /premature complete/i);
});

test("P2PFileReceiver: detects incomplete transfer (missing bytes/chunks) on COMPLETE", async () => {
  const socket = createMockSocket();
  let errorReceived = null;

  const receiver = new P2PFileReceiver(socket, "host-1", {
    onError: (err) => { errorReceived = err; },
  });
  const mockDc = createMockDataChannel();
  receiver.dc = mockDc;

  // Header announces 2 chunks of 64KB (128KB total)
  await receiver._onMessage({
    data: JSON.stringify({
      type: "HEADER",
      fileName: "test.mp4",
      fileSize: 131072,
      fileType: "video/mp4",
      chunkSize: 65536,
      totalChunks: 2,
    }),
  });

  // Only send 1 chunk (64KB)
  await receiver._onMessage({ data: new Uint8Array(65536).buffer });

  // Send COMPLETE prematurely
  await receiver._onMessage({ data: JSON.stringify({ type: "COMPLETE", checksum: "abc" }) });

  assert.ok(errorReceived);
  assert.match(errorReceived.message, /transfer incomplete/i);

  const nack = mockDc.sentMessages.map((m) => JSON.parse(m)).find((m) => m.type === "NACK");
  assert.ok(nack);
  assert.match(nack.reason, /received 65536 of 131072 bytes/i);
});

test("P2PFileReceiver: rejects extra chunks beyond announced totalChunks", async () => {
  const socket = createMockSocket();
  let errorReceived = null;

  const receiver = new P2PFileReceiver(socket, "host-1", {
    onError: (err) => { errorReceived = err; },
  });
  const mockDc = createMockDataChannel();
  receiver.dc = mockDc;

  // Header announces 1 chunk of 100 bytes
  await receiver._onMessage({
    data: JSON.stringify({
      type: "HEADER",
      fileName: "test.mp4",
      fileSize: 100,
      fileType: "video/mp4",
      chunkSize: 1024,
      totalChunks: 1,
    }),
  });

  // Send 1st chunk (50 bytes)
  await receiver._onMessage({ data: new Uint8Array(50).buffer });

  // Send 2nd chunk (50 bytes)
  await receiver._onMessage({ data: new Uint8Array(50).buffer });

  // Send 3rd chunk - exceeds totalChunks (1)
  await receiver._onMessage({ data: new Uint8Array(10).buffer });

  assert.ok(errorReceived);
  assert.match(errorReceived.message, /excess chunks|oversized/i);
});

test("P2PFileReceiver: detects data corruption and SHA-256 checksum mismatch", async () => {
  const socket = createMockSocket();
  let errorReceived = null;
  let completeCalled = false;

  const mockWritable = createMockWritableStream();
  const mockHandle = createMockFileHandle(mockWritable);

  const receiver = new P2PFileReceiver(
    socket,
    "host-1",
    {
      onComplete: () => { completeCalled = true; },
      onError: (err) => { errorReceived = err; },
    },
    mockHandle
  );
  receiver.writable = mockWritable;
  const mockDc = createMockDataChannel();
  receiver.dc = mockDc;

  const data = new Uint8Array([1, 2, 3, 4, 5]);

  await receiver._onMessage({
    data: JSON.stringify({
      type: "HEADER",
      fileName: "test.mp4",
      fileSize: 5,
      fileType: "video/mp4",
      chunkSize: 1024,
      totalChunks: 1,
    }),
  });

  // Send chunk
  await receiver._onMessage({ data: data.buffer });

  // Send COMPLETE with intentional WRONG checksum
  const wrongChecksum = "0000000000000000000000000000000000000000000000000000000000000000";
  await receiver._onMessage({
    data: JSON.stringify({ type: "COMPLETE", checksum: wrongChecksum }),
  });

  assert.strictEqual(completeCalled, false);
  assert.ok(errorReceived);
  assert.match(errorReceived.message, /integrity verification failed.*checksum mismatch/i);

  // Verify stream was aborted and NACK was sent
  assert.strictEqual(mockWritable.aborted, true);
  const nack = mockDc.sentMessages.map((m) => JSON.parse(m)).find((m) => m.type === "NACK");
  assert.ok(nack);
  assert.match(nack.reason, /checksum mismatch/i);
});

test("P2PFileReceiver: safely handles disk write failure and QuotaExceededError", async () => {
  const socket = createMockSocket();
  let errorReceived = null;

  const mockWritable = createMockWritableStream({ failOnWrite: true, isQuotaError: true });
  const mockHandle = createMockFileHandle(mockWritable);

  const receiver = new P2PFileReceiver(
    socket,
    "host-1",
    { onError: (err) => { errorReceived = err; } },
    mockHandle,
    { maxChunkSize: 1024 * 1024 }
  );
  receiver.writable = mockWritable;
  const mockDc = createMockDataChannel();
  receiver.dc = mockDc;

  const payload = new Uint8Array(1024 * 1024); // 1MB chunk triggers batch write

  await receiver._onMessage({
    data: JSON.stringify({
      type: "HEADER",
      fileName: "large.mp4",
      fileSize: 1024 * 1024,
      fileType: "video/mp4",
      chunkSize: 1024 * 1024,
      totalChunks: 1,
    }),
  });

  await receiver._onMessage({ data: payload.buffer });

  assert.ok(errorReceived);
  assert.match(errorReceived.message, /quota/i);
  assert.strictEqual(mockWritable.aborted, true);

  const nack = mockDc.sentMessages.map((m) => JSON.parse(m)).find((m) => m.type === "NACK");
  assert.ok(nack);
  assert.match(nack.reason, /quota/i);
});

test("P2PFileReceiver: completes transfer, sends ACK, and notifies onComplete upon successful verification", async () => {
  const socket = createMockSocket();
  let errorReceived = null;
  let completedFileResult = null;

  const mockWritable = createMockWritableStream();
  const mockHandle = createMockFileHandle(mockWritable);

  const receiver = new P2PFileReceiver(
    socket,
    "host-1",
    {
      onComplete: (file, blob, meta) => { completedFileResult = { file, meta }; },
      onError: (err) => { errorReceived = err; },
    },
    mockHandle
  );
  receiver.writable = mockWritable;
  const mockDc = createMockDataChannel();
  receiver.dc = mockDc;

  const content = Buffer.from("test video payload for integrity check");
  const arrayBuffer = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
  const expectedHash = crypto.createHash("sha256").update(content).digest("hex");

  await receiver._onMessage({
    data: JSON.stringify({
      type: "HEADER",
      fileName: "clean.mp4",
      fileSize: content.length,
      fileType: "video/mp4",
      chunkSize: 1024,
      totalChunks: 1,
    }),
  });

  await receiver._onMessage({ data: arrayBuffer });

  await receiver._onMessage({
    data: JSON.stringify({ type: "COMPLETE", checksum: expectedHash }),
  });

  assert.strictEqual(errorReceived, null);
  assert.ok(completedFileResult);
  assert.strictEqual(completedFileResult.meta.fileName, "clean.mp4");
  assert.strictEqual(completedFileResult.meta.checksum, expectedHash);
  assert.strictEqual(mockWritable.closed, true);

  // Verify ACK was sent to sender
  const ack = mockDc.sentMessages.map((m) => JSON.parse(m)).find((m) => m.type === "ACK");
  assert.ok(ack);
  assert.strictEqual(ack.verified, true);
  assert.strictEqual(ack.checksum, expectedHash);
});

// ==========================================
// 6. P2PFileSender Tests
// ==========================================
test("P2PFileSender: rejects invalid or oversized files", async () => {
  const socket = createMockSocket();
  let errorReceived = null;

  // Invalid file (size < 0 or invalid)
  const invalidFile = { size: -1, name: "invalid.mp4", type: "video/mp4" };
  const senderInvalid = new P2PFileSender(socket, "peer-1", invalidFile, {
    onError: (err) => { errorReceived = err; },
  });
  senderInvalid.dc = createMockDataChannel();
  await senderInvalid._onChannelOpen();

  assert.ok(errorReceived);
  assert.match(errorReceived.message, /invalid file/i);

  // Oversized file
  errorReceived = null;
  const largeFile = { size: 1000, name: "large.mp4", type: "video/mp4" };
  const senderLarge = new P2PFileSender(
    socket,
    "peer-1",
    largeFile,
    { onError: (err) => { errorReceived = err; } },
    { maxFileSize: 500 }
  );
  senderLarge.dc = createMockDataChannel();
  await senderLarge._onChannelOpen();

  assert.ok(errorReceived);
  assert.match(errorReceived.message, /exceeds maximum allowable limit/i);
});

test("P2PFileSender: awaits receiver ACK before reporting completion, and handles NACK", async () => {
  const socket = createMockSocket();
  let errorReceived = null;
  let completeCalled = false;

  const content = Buffer.from("sample bytes");
  const file = new File([content], "sample.mp4", { type: "video/mp4" });

  const sender = new P2PFileSender(socket, "peer-1", file, {
    onComplete: () => { completeCalled = true; },
    onError: (err) => { errorReceived = err; },
  });
  sender.dc = createMockDataChannel();

  // Run channel open in background promise
  const sendPromise = sender._onChannelOpen();

  // Wait a tick for messages to be sent
  await new Promise((r) => setTimeout(r, 50));

  const messages = sender.dc.sentMessages.map((m) => (typeof m === "string" ? JSON.parse(m) : m));
  const completeMsg = messages.find((m) => m?.type === "COMPLETE");
  assert.ok(completeMsg);
  assert.ok(completeMsg.checksum);

  // Before ACK, onComplete must NOT have been called
  assert.strictEqual(completeCalled, false);

  // Receiver replies with NACK
  sender._onMessage({ data: JSON.stringify({ type: "NACK", reason: "Disk full" }) });

  await sendPromise;

  assert.strictEqual(completeCalled, false);
  assert.ok(errorReceived);
  assert.match(errorReceived.message, /receiver rejected transfer.*disk full/i);
});

// ==========================================
// 6b. P2PFileSender Hardening & Flow Control Tests
// ==========================================

test("P2PFileSender: cannot exceed the in-flight window while waiting for acknowledgements", async () => {
  const socket = createMockSocket();
  const fileBytes = Buffer.alloc(300, "a");
  const file = new File([fileBytes], "sliding.bin", { type: "application/octet-stream" });

  let completed = false;
  const sender = new P2PFileSender(
    socket,
    "peer-1",
    file,
    {
      chunkSize: 100,
      onComplete: () => { completed = true; },
    },
    {
      maxInFlightBytes: 100,
      minChunkSize: 100,
      flowControlTimeoutMs: 2000,
    }
  );
  const dc = createMockDataChannel();
  sender.dc = dc;

  const sendPromise = sender._onChannelOpen();
  await new Promise((r) => setTimeout(r, 40));

  // Initially: 1 header packet + 1 chunk (100 bytes) sent.
  // In-flight is now 100 bytes >= maxInFlightBytes (100). Sender must NOT have sent chunk 2 yet!
  let binaryChunks = sender.dc.sentMessages.filter((m) => m instanceof ArrayBuffer);
  assert.strictEqual(binaryChunks.length, 1);
  assert.strictEqual(sender.sentBytes, 100);

  // Receiver sends CHUNK_ACK for 100 bytes
  sender._onMessage({
    data: JSON.stringify({ type: "CHUNK_ACK", receivedBytes: 100 }),
  });
  await new Promise((r) => setTimeout(r, 40));

  // Now Chunk 2 (100 bytes) is sent, window fills again
  binaryChunks = sender.dc.sentMessages.filter((m) => m instanceof ArrayBuffer);
  assert.strictEqual(binaryChunks.length, 2);
  assert.strictEqual(sender.sentBytes, 200);

  // Receiver sends DRAIN for 200 bytes
  sender._onMessage({
    data: JSON.stringify({ type: "DRAIN", receivedBytes: 200 }),
  });
  await new Promise((r) => setTimeout(r, 40));

  // Chunk 3 (100 bytes) sent, all 300 bytes dispatched
  binaryChunks = sender.dc.sentMessages.filter((m) => m instanceof ArrayBuffer);
  assert.strictEqual(binaryChunks.length, 3);
  assert.strictEqual(sender.sentBytes, 300);

  // Wait for sender to finish dispatching chunks and send COMPLETE
  await new Promise((r) => setTimeout(r, 60));
  const completeMsg = dc.sentMessages.find((m) => typeof m === "string" && m.includes('"type":"COMPLETE"'));
  assert.ok(completeMsg);
  const parsedComplete = JSON.parse(completeMsg);

  // Receiver sends ACK for completion
  sender._onMessage({
    data: JSON.stringify({
      type: "ACK",
      ackType: "FINAL",
      status: "SUCCESS",
      verified: true,
      checksum: parsedComplete.checksum,
      bytesReceived: 300,
      chunksReceived: 3,
    }),
  });

  await sendPromise;
  assert.strictEqual(completed, true);
  assert.strictEqual(sender.state, SENDER_STATE.COMPLETED);
});

test("P2PFileSender: rejects acknowledgements greater than bytes actually sent", async () => {
  const socket = createMockSocket();
  const file = new File([Buffer.alloc(200, "b")], "data.bin", { type: "application/octet-stream" });

  let errorReceived = null;
  const sender = new P2PFileSender(
    socket,
    "peer-1",
    file,
    {
      chunkSize: 100,
      onError: (err) => { errorReceived = err; },
    },
    { maxInFlightBytes: 100, minChunkSize: 100 }
  );
  sender.dc = createMockDataChannel();

  const sendPromise = sender._onChannelOpen();
  await new Promise((r) => setTimeout(r, 40));

  // Sender has sent 100 bytes. Receiver claims it received 500 bytes.
  sender._onMessage({
    data: JSON.stringify({ type: "DRAIN", receivedBytes: 500 }),
  });

  await sendPromise;
  assert.ok(errorReceived);
  assert.match(errorReceived.message, /exceeds bytes actually sent/i);
  assert.strictEqual(sender.state, SENDER_STATE.FAILED);
});

test("P2PFileSender: rejects final ACK with missing, invalid, or incorrect checksum", async () => {
  const socket = createMockSocket();
  const file = new File([Buffer.alloc(50, "c")], "short.bin", { type: "application/octet-stream" });

  // 1. Missing checksum
  let error1 = null;
  const sender1 = new P2PFileSender(socket, "peer-1", file, {
    onError: (err) => { error1 = err; },
  });
  sender1.dc = createMockDataChannel();
  const sendPromise1 = sender1._onChannelOpen();
  await new Promise((r) => setTimeout(r, 40));

  sender1._onMessage({
    data: JSON.stringify({
      type: "ACK",
      ackType: "FINAL",
      status: "SUCCESS",
      verified: true,
    }),
  });
  await sendPromise1;
  assert.ok(error1);
  assert.match(error1.message, /missing valid 64-character SHA-256 checksum/i);

  // 2. Incorrect checksum mismatch
  let error2 = null;
  const sender2 = new P2PFileSender(socket, "peer-1", file, {
    onError: (err) => { error2 = err; },
  });
  sender2.dc = createMockDataChannel();
  const sendPromise2 = sender2._onChannelOpen();
  await new Promise((r) => setTimeout(r, 40));

  const wrongHash = "0000000000000000000000000000000000000000000000000000000000000000";
  sender2._onMessage({
    data: JSON.stringify({
      type: "ACK",
      ackType: "FINAL",
      status: "SUCCESS",
      verified: true,
      checksum: wrongHash,
    }),
  });
  await sendPromise2;
  assert.ok(error2);
  assert.match(error2.message, /disagrees with sender checksum/i);
});

test("P2PFileSender: rejects final ACK without explicit verification", async () => {
  const socket = createMockSocket();
  const file = new File([Buffer.alloc(50, "d")], "file.bin", { type: "application/octet-stream" });

  let error = null;
  const sender = new P2PFileSender(socket, "peer-1", file, {
    onError: (err) => { error = err; },
  });
  sender.dc = createMockDataChannel();
  const sendPromise = sender._onChannelOpen();
  await new Promise((r) => setTimeout(r, 40));

  const checksum = sender.hasher.digest();
  // ACK with verified === false or status === "FAILED"
  sender._onMessage({
    data: JSON.stringify({
      type: "ACK",
      ackType: "FINAL",
      status: "FAILED",
      verified: false,
      checksum,
    }),
  });
  await sendPromise;
  assert.ok(error);
  assert.match(error.message, /Receiver failed file verification on completion/i);
});

test("P2PFileSender: PAUSE timeout never resumes transmission automatically and fails cleanly", async () => {
  const socket = createMockSocket();
  const file = new File([Buffer.alloc(200, "e")], "pause.bin", { type: "application/octet-stream" });

  let errorReceived = null;
  const sender = new P2PFileSender(
    socket,
    "peer-1",
    file,
    {
      chunkSize: 100,
      onError: (err) => { errorReceived = err; },
    },
    {
      minChunkSize: 100,
      pauseTimeoutMs: 60, // Short timeout for test
    }
  );
  const dc = createMockDataChannel();
  sender.dc = dc;

  // Receiver pauses before chunks begin
  sender.isReceiverPaused = true;

  const sendPromise = sender._onChannelOpen();
  await sendPromise;

  assert.ok(errorReceived);
  assert.match(errorReceived.message, /Receiver pause timed out/i);
  assert.strictEqual(sender.state, SENDER_STATE.FAILED);

  // Verify sender did NOT send any file data chunks
  const binaryChunks = dc.sentMessages.filter((m) => m instanceof ArrayBuffer);
  assert.strictEqual(binaryChunks.length, 0);
});

test("P2PFileSender: cancellation wakes a sender blocked on flow control", async () => {
  const socket = createMockSocket();
  const file = new File([Buffer.alloc(200, "f")], "cancel.bin", { type: "application/octet-stream" });

  let cancelReason = null;
  const sender = new P2PFileSender(
    socket,
    "peer-1",
    file,
    {
      chunkSize: 100,
      onCancel: (reason) => { cancelReason = reason; },
    },
    {
      maxInFlightBytes: 100,
      minChunkSize: 100,
      flowControlTimeoutMs: 5000,
    }
  );
  sender.dc = createMockDataChannel();

  const sendPromise = sender._onChannelOpen();
  await new Promise((r) => setTimeout(r, 40));

  // Sender sent 1 chunk (100 bytes) and is blocked on maxInFlightBytes (100)
  assert.strictEqual(sender.sentBytes, 100);

  // Cancel while blocked
  sender.cancel("User pressed cancel");

  await sendPromise;
  assert.strictEqual(cancelReason, "User pressed cancel");
  assert.strictEqual(sender.state, SENDER_STATE.CANCELLED);
  assert.strictEqual(sender.pc, null);
  assert.strictEqual(sender.dc, null);
});

test("P2PFileSender: connection closure wakes pending waits and cleans up resources", async () => {
  const socket = createMockSocket();
  const file = new File([Buffer.alloc(200, "g")], "close.bin", { type: "application/octet-stream" });

  let errorReceived = null;
  const sender = new P2PFileSender(
    socket,
    "peer-1",
    file,
    {
      chunkSize: 100,
      onError: (err) => { errorReceived = err; },
    },
    {
      maxInFlightBytes: 100,
      minChunkSize: 100,
      flowControlTimeoutMs: 5000,
    }
  );
  const dc = createMockDataChannel();
  sender.dc = dc;

  const sendPromise = sender._onChannelOpen();
  await new Promise((r) => setTimeout(r, 40));

  // Trigger premature DataChannel closure while blocked
  if (dc.onclose) {
    dc.onclose();
  } else {
    sender._handleError(new Error("DataChannel closed prematurely during transfer"));
  }

  await sendPromise;
  assert.ok(errorReceived);
  assert.match(errorReceived.message, /DataChannel closed prematurely/i);
  assert.strictEqual(sender.state, SENDER_STATE.FAILED);
  assert.strictEqual(sender.pc, null);
  assert.strictEqual(sender.dc, null);
});

test("P2PFileSender: UI callbacks throwing exceptions do not leak peer connection or DataChannel", async () => {
  const socket = createMockSocket();
  const file = new File([Buffer.alloc(50, "h")], "leak.bin", { type: "application/octet-stream" });

  const sender = new P2PFileSender(socket, "peer-1", file, {
    onProgress: () => {
      throw new Error("UI onProgress boom");
    },
    onComplete: () => {
      throw new Error("UI onComplete boom");
    },
  });
  sender.dc = createMockDataChannel();

  const sendPromise = sender._onChannelOpen();
  await new Promise((r) => setTimeout(r, 40));

  const checksum = sender.hasher.digest();
  sender._onMessage({
    data: JSON.stringify({
      type: "ACK",
      ackType: "FINAL",
      status: "SUCCESS",
      verified: true,
      checksum,
    }),
  });

  await sendPromise;
  assert.strictEqual(sender._isCleanedUp, true);
  assert.strictEqual(sender.pc, null);
  assert.strictEqual(sender.dc, null);
});

test("P2PFileSender: ACK arriving immediately after COMPLETE is handled correctly", async () => {
  const socket = createMockSocket();
  const file = new File([Buffer.alloc(50, "i")], "instant.bin", { type: "application/octet-stream" });

  let completed = false;
  const sender = new P2PFileSender(socket, "peer-1", file, {
    onComplete: () => { completed = true; },
  });

  const dc = createMockDataChannel();
  // Simulate receiver intercepting COMPLETE message synchronously and returning ACK
  const originalSend = dc.send.bind(dc);
  dc.send = function (data) {
    originalSend(data);
    if (typeof data === "string" && data.includes('"type":"COMPLETE"')) {
      const parsed = JSON.parse(data);
      // Synchronous immediate response
      sender._onMessage({
        data: JSON.stringify({
          type: "ACK",
          ackType: "FINAL",
          status: "SUCCESS",
          verified: true,
          checksum: parsed.checksum,
          bytesReceived: 50,
          chunksReceived: 1,
        }),
      });
    }
  };
  sender.dc = dc;

  await sender._onChannelOpen();
  assert.strictEqual(completed, true);
  assert.strictEqual(sender.state, SENDER_STATE.COMPLETED);
});

test("P2PFileSender: ICE candidate queue limits are enforced and duplicates ignored", async () => {
  const socket = createMockSocket();
  const file = new File([Buffer.alloc(10, "j")], "ice.bin", { type: "application/octet-stream" });

  let errorReceived = null;
  const sender = new P2PFileSender(
    socket,
    "peer-1",
    file,
    { onError: (err) => { errorReceived = err; } },
    { maxPendingIceCandidates: 3 }
  );
  sender.pc = new MockRTCPeerConnection({});

  // 1. Add valid candidates up to limit
  await sender.handleSignal({ candidate: { candidate: "cand-1" } });
  await sender.handleSignal({ candidate: { candidate: "cand-2" } });
  // Duplicate cand-2 should be ignored without incrementing queue
  await sender.handleSignal({ candidate: { candidate: "cand-2" } });
  assert.strictEqual(sender.pendingIceCandidates.length, 2);

  await sender.handleSignal({ candidate: { candidate: "cand-3" } });
  assert.strictEqual(sender.pendingIceCandidates.length, 3);

  // 4th candidate exceeds maxPendingIceCandidates (3) -> error
  await sender.handleSignal({ candidate: { candidate: "cand-4" } });
  assert.ok(errorReceived);
  assert.match(errorReceived.message, /exceeded maximum capacity of 3 candidates/i);
});

test("P2PFileSender: duplicate and out-of-order flow-control messages cannot bypass limits", async () => {
  const socket = createMockSocket();
  const file = new File([Buffer.alloc(300, "k")], "dup.bin", { type: "application/octet-stream" });

  const sender = new P2PFileSender(
    socket,
    "peer-1",
    file,
    { chunkSize: 100 },
    { maxInFlightBytes: 100, minChunkSize: 100 }
  );
  sender.sentBytes = 200;
  sender.sentChunks = 2;

  // 1. Valid advance to 100
  sender._onMessage({ data: JSON.stringify({ type: "CHUNK_ACK", receivedBytes: 100, receivedChunks: 1 }) });
  assert.strictEqual(sender.receiverAckedBytes, 100);

  // 2. Duplicate ACK for 100: handled idempotently without error
  sender._onMessage({ data: JSON.stringify({ type: "CHUNK_ACK", receivedBytes: 100, receivedChunks: 1 }) });
  assert.strictEqual(sender.receiverAckedBytes, 100);

  // 3. Regressing ACK for 50: safely ignored without regressing counter
  sender._onMessage({ data: JSON.stringify({ type: "CHUNK_ACK", receivedBytes: 50, receivedChunks: 0 }) });
  assert.strictEqual(sender.receiverAckedBytes, 100);

  // 4. Negative ACK: rejected with protocol violation error
  let errorReceived = null;
  sender.onError = (err) => { errorReceived = err; };
  sender._onMessage({ data: JSON.stringify({ type: "CHUNK_ACK", receivedBytes: -1 }) });
  assert.ok(errorReceived);
  assert.match(errorReceived.message, /invalid receivedBytes/i);
});

test("P2PFileSender: constructor validates limits and options strictly", () => {
  const socket = createMockSocket();
  const file = new File([], "file.bin");

  // Invalid socket
  assert.throws(() => new P2PFileSender(null, "peer-1", file), /socket is required/);

  // Invalid targetSocketId
  assert.throws(() => new P2PFileSender(socket, "", file), /targetSocketId must be a non-empty string/);

  // Invalid chunkSize
  assert.throws(() => new P2PFileSender(socket, "p1", file, { chunkSize: -10 }), /chunkSize must be a positive integer/);
  assert.throws(() => new P2PFileSender(socket, "p1", file, { chunkSize: 500 }), /chunkSize must be between/);

  // Invalid limits
  assert.throws(() => new P2PFileSender(socket, "p1", file, {}, { maxFileSize: -10 }), /limits.maxFileSize must be a positive integer/);
  assert.throws(() => new P2PFileSender(socket, "p1", file, {}, { minChunkSize: 2000, maxChunkSize: 1000 }), /minChunkSize cannot exceed maxChunkSize/);
});

test("waitForBufferDrain: regulates flow and resumes on bufferedamountlow", async () => {
  const dc = createMockDataChannel();
  dc.bufferedAmount = 10 * 1024 * 1024; // Exceeds 8 MB high watermark

  let drainResolved = false;
  const drainPromise = waitForBufferDrain(dc, {
    highWatermark: 8 * 1024 * 1024,
    lowWatermark: 2 * 1024 * 1024,
    timeoutMs: 1000,
  }).then(() => {
    drainResolved = true;
  });

  assert.strictEqual(drainResolved, false);

  // Simulate buffer drain below 2 MB
  dc.bufferedAmount = 1 * 1024 * 1024;
  const lowListeners = dc.listeners.get("bufferedamountlow") || [];
  for (const listener of lowListeners) listener();

  await drainPromise;
  assert.strictEqual(drainResolved, true);
});

test("createPeerConnection: invokes onIceCandidate callback for function and object arguments", () => {
  const socket = createMockSocket();
  let candidateReceivedFn = null;
  let candidateReceivedObj = null;

  // 1. Function argument
  const pc1 = createPeerConnection(socket, "peer-1", (cand) => {
    candidateReceivedFn = cand;
  });
  pc1.onicecandidate({ candidate: { candidate: "candidate:1" } });
  assert.deepEqual(candidateReceivedFn, { candidate: "candidate:1" });
  assert.strictEqual(socket.emitted[0].event, "p2p:signal");

  // 2. Object argument
  const pc2 = createPeerConnection(socket, "peer-2", {
    onIceCandidate: (cand) => {
      candidateReceivedObj = cand;
    },
  });
  pc2.onicecandidate({ candidate: { candidate: "candidate:2" } });
  assert.deepEqual(candidateReceivedObj, { candidate: "candidate:2" });
});

test("waitForBufferDrain: rejects immediately on data channel closure while waiting", async () => {
  const dc = createMockDataChannel();
  dc.bufferedAmount = 10 * 1024 * 1024;

  const drainPromise = waitForBufferDrain(dc, { timeoutMs: 5000 });

  // Simulate channel closing while waiting for buffer drain
  dc.readyState = "closed";
  const closeListeners = dc.listeners.get("close") || [];
  for (const listener of closeListeners) listener();

  await assert.rejects(drainPromise, /closed/i);
});

test("P2PFileReceiver: queues early ICE candidates and applies them in order after remote description", async () => {
  const socket = createMockSocket();
  const receiver = new P2PFileReceiver(socket, "host-1");
  receiver._initPeerConnection();

  // Send early candidate before SDP offer
  await receiver.handleSignal({ candidate: { candidate: "cand-early-1" } });
  await receiver.handleSignal({ candidate: { candidate: "cand-early-2" } });

  assert.strictEqual(receiver.pendingIceCandidates.length, 2);
  assert.strictEqual(receiver.pc.addedCandidates.length, 0);

  // Send SDP offer
  await receiver.handleSignal({
    sdp: { type: "offer", sdp: "v=0 offer" },
  });

  // Candidates should now be drained and applied in order
  assert.strictEqual(receiver.pendingIceCandidates.length, 0);
  assert.strictEqual(receiver.pc.addedCandidates.length, 2);
  assert.strictEqual(receiver.pc.addedCandidates[0].candidate, "cand-early-1");
  assert.strictEqual(receiver.pc.addedCandidates[1].candidate, "cand-early-2");
});

test("P2PFileReceiver: ignores duplicate SDP offers gracefully", async () => {
  const socket = createMockSocket();
  const receiver = new P2PFileReceiver(socket, "host-1");
  receiver._initPeerConnection();

  // First offer
  await receiver.handleSignal({ sdp: { type: "offer", sdp: "v=0 offer 1" } });
  assert.strictEqual(receiver.hasAnsweredOffer, true);
  assert.strictEqual(socket.emitted.length, 1);

  // Second offer should be ignored
  await receiver.handleSignal({ sdp: { type: "offer", sdp: "v=0 offer 2" } });
  assert.strictEqual(socket.emitted.length, 1);
});

test("P2PFileReceiver: serializes concurrent chunk messages and async disk writes in correct order", async () => {
  const socket = createMockSocket();
  let errorReceived = null;
  let completeResult = null;

  const mockWritable = createMockWritableStream();
  const fileHandle = createMockFileHandle(mockWritable);

  const receiver = new P2PFileReceiver(
    socket,
    "host-1",
    {
      onComplete: (file, blob, meta) => {
        completeResult = { file, meta };
      },
      onError: (err) => {
        errorReceived = err;
      },
    },
    fileHandle
  );

  receiver.dc = createMockDataChannel();

  const chunkSize = 2048;
  const totalChunks = 3;
  const fileSize = 6144;

  // 1. Establish header
  await receiver._onMessage({
    data: JSON.stringify({
      type: "HEADER",
      fileName: "ordered.mp4",
      fileSize,
      fileType: "video/mp4",
      chunkSize,
      totalChunks,
    }),
  });

  // Chunks filled with distinct byte values [0, 0...], [1, 1...], [2, 2...]
  const chunk0 = new Uint8Array(chunkSize).fill(0).buffer;
  const chunk1 = new Uint8Array(chunkSize).fill(1).buffer;
  const chunk2 = new Uint8Array(chunkSize).fill(2).buffer;

  // Calculate expected SHA-256 for all 6144 bytes in order
  const combinedAll = new Uint8Array(fileSize);
  combinedAll.set(new Uint8Array(chunk0), 0);
  combinedAll.set(new Uint8Array(chunk1), 2048);
  combinedAll.set(new Uint8Array(chunk2), 4096);
  const expectedChecksum = crypto.createHash("sha256").update(combinedAll).digest("hex");

  // Send chunks concurrently (calling _onMessage in parallel)
  const p0 = receiver._onMessage({ data: chunk0 });
  const p1 = receiver._onMessage({ data: chunk1 });
  const p2 = receiver._onMessage({ data: chunk2 });
  const pComplete = receiver._onMessage({
    data: JSON.stringify({ type: "COMPLETE", checksum: expectedChecksum }),
  });

  await Promise.all([p0, p1, p2, pComplete]);

  assert.strictEqual(errorReceived, null);
  assert.ok(completeResult);
  assert.strictEqual(completeResult.meta.checksum, expectedChecksum);
  assert.strictEqual(mockWritable.closed, true);
});

test("P2PFileReceiver: handles malformed JSON and unknown message types gracefully", async () => {
  const socket = createMockSocket();
  let errorReceived = null;

  const receiver = new P2PFileReceiver(socket, "host-1", {
    onError: (err) => { errorReceived = err; },
  });
  receiver.dc = createMockDataChannel();

  // Invalid JSON
  await receiver._onMessage({ data: "{ invalid json " });
  assert.ok(errorReceived);
  assert.match(errorReceived.message, /failed to parse control packet/i);

  // Unknown message type before header (ignored gracefully or handled)
  errorReceived = null;
  await receiver._onMessage({ data: JSON.stringify({ type: "UNKNOWN_TEST_TYPE" }) });
  assert.strictEqual(errorReceived, null);
});

test("P2PFileReceiver: cancellation during writes aborts stream and never calls onComplete", async () => {
  const socket = createMockSocket();
  let cancelledReason = null;
  let completeCalled = false;
  let errorCalled = false;

  const mockWritable = {
    writtenChunks: [],
    aborted: false,
    closed: false,
    async write(chunk) {
      this.writtenChunks.push(chunk);
    },
    async abort() {
      this.aborted = true;
    },
    async close() {
      this.closed = true;
    },
  };

  const receiver = new P2PFileReceiver(
    socket,
    "host-1",
    {
      onCancel: (reason) => { cancelledReason = reason; },
      onComplete: () => { completeCalled = true; },
      onError: () => { errorCalled = true; },
    },
    { createWritable: async () => mockWritable }
  );

  receiver.dc = createMockDataChannel();
  await receiver._onMessage({
    data: JSON.stringify({
      type: "HEADER",
      fileName: "test.mp4",
      fileSize: 4096,
      fileType: "video/mp4",
      totalChunks: 2,
      chunkSize: 2048,
    }),
  });

  const chunk = new Uint8Array(2048).buffer;
  await receiver._onMessage({ data: chunk });

  // Cancel transfer mid-way
  await receiver.cancel("User cancelled download", false);

  assert.strictEqual(cancelledReason, "User cancelled download");
  assert.strictEqual(receiver.isCancelled, true);
  assert.strictEqual(receiver.isTerminated, true);
  assert.strictEqual(receiver.state, RECEIVER_STATE.CANCELLED);
  assert.strictEqual(mockWritable.aborted, true);
  assert.strictEqual(mockWritable.closed, false);
  assert.strictEqual(completeCalled, false);
  assert.strictEqual(errorCalled, false);

  // Subsequent messages should be completely ignored
  await receiver._onMessage({
    data: JSON.stringify({ type: "COMPLETE", checksum: "dummy" }),
  });
  assert.strictEqual(completeCalled, false);
});

test("P2PFileReceiver & P2PFileSender: repeated cleanup is idempotent and prevents duplicate callbacks", async () => {
  const socket = createMockSocket();
  let senderCancelCount = 0;
  let receiverCancelCount = 0;

  const sender = new P2PFileSender(
    socket,
    "peer-1",
    { name: "test.mp4", size: 1000 },
    { onCancel: () => { senderCancelCount++; } }
  );
  sender.pc = new MockRTCPeerConnection();
  sender.dc = createMockDataChannel();

  sender.cancel("First cancel");
  sender.cancel("Second cancel");
  sender._cleanup();
  sender._cleanup();

  assert.strictEqual(senderCancelCount, 1);
  assert.strictEqual(sender.state, SENDER_STATE.CANCELLED);
  assert.strictEqual(sender.isTerminated, true);

  const receiver = new P2PFileReceiver(
    socket,
    "host-1",
    { onCancel: () => { receiverCancelCount++; } }
  );
  receiver.pc = new MockRTCPeerConnection();
  receiver.dc = createMockDataChannel();

  await receiver.cancel("First cancel");
  await receiver.cancel("Second cancel");
  receiver._cleanup();
  receiver._cleanup();

  assert.strictEqual(receiverCancelCount, 1);
  assert.strictEqual(receiver.state, RECEIVER_STATE.CANCELLED);
  assert.strictEqual(receiver.isTerminated, true);
});

test("P2PFileReceiver: triggers inactivity timeout when no data chunks arrive", async () => {
  const socket = createMockSocket();
  let errorReceived = null;

  const receiver = new P2PFileReceiver(socket, "host-1", {
    limits: { inactivityTimeoutMs: 40 },
    onError: (err) => { errorReceived = err; },
  });

  receiver.dc = createMockDataChannel();
  await receiver._onMessage({
    data: JSON.stringify({
      type: "HEADER",
      fileName: "test.mp4",
      fileSize: 4096,
      fileType: "video/mp4",
      totalChunks: 2,
      chunkSize: 2048,
    }),
  });

  // Wait 60ms for inactivity timer to fire
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.ok(errorReceived);
  assert.match(errorReceived.message, /inactivity|timed out/i);
  assert.strictEqual(receiver.state, RECEIVER_STATE.FAILED);
  assert.strictEqual(receiver.isTerminated, true);
});

test("P2PFileSender: triggers connection timeout when DataChannel fails to open", async () => {
  const socket = createMockSocket();
  let errorReceived = null;

  const sender = new P2PFileSender(
    socket,
    "peer-1",
    { name: "test.mp4", size: 1000 },
    {
      limits: { connectionTimeoutMs: 40 },
      onError: (err) => { errorReceived = err; },
    }
  );

  await sender.start();
  assert.strictEqual(sender.state, SENDER_STATE.CONNECTING);

  // Wait 60ms for connection timeout
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.ok(errorReceived);
  assert.match(errorReceived.message, /connection establishment timed out/i);
  assert.strictEqual(sender.state, SENDER_STATE.FAILED);
  assert.strictEqual(sender.isTerminated, true);
});

test("P2PFileSender & P2PFileReceiver: report clear error when connection state fails", async () => {
  const socket = createMockSocket();
  let senderError = null;
  let receiverError = null;

  const sender = new P2PFileSender(
    socket,
    "peer-1",
    { name: "test.mp4", size: 1000 },
    { onError: (err) => { senderError = err; } }
  );
  await sender.start();

  sender.pc.connectionState = "failed";
  sender.pc.onconnectionstatechange();

  assert.ok(senderError);
  assert.match(senderError.message, /P2P connection failed.*TURN relay/i);
  assert.strictEqual(sender.state, SENDER_STATE.FAILED);

  const receiver = new P2PFileReceiver(
    socket,
    "host-1",
    { onError: (err) => { receiverError = err; } }
  );
  await receiver.start({ fileName: "test.mp4", fileSize: 1000 });

  receiver.pc.iceConnectionState = "failed";
  receiver.pc.oniceconnectionstatechange();

  assert.ok(receiverError);
  assert.match(receiverError.message, /ICE connection failed.*TURN server/i);
  assert.strictEqual(receiver.state, RECEIVER_STATE.FAILED);
});

// ==========================================
// 8. Protocol Configuration & Factory Tests
// ==========================================

test("createRtcConfig: returns fresh deep copy of default STUN servers without sharing references", () => {
  const config1 = createRtcConfig();
  const config2 = createRtcConfig(null);
  const config3 = createRtcConfig([]);

  assert.notStrictEqual(config1, RTC_CONFIG);
  assert.notStrictEqual(config1.iceServers, RTC_CONFIG.iceServers);
  assert.notStrictEqual(config1.iceServers, config2.iceServers);

  assert.deepStrictEqual(config1.iceServers, RTC_CONFIG.iceServers);
  assert.deepStrictEqual(config2.iceServers, RTC_CONFIG.iceServers);
  assert.deepStrictEqual(config3.iceServers, RTC_CONFIG.iceServers);

  // Modifying returned array does not affect RTC_CONFIG
  config1.iceServers.push({ urls: "stun:attacker.example.com" });
  assert.strictEqual(RTC_CONFIG.iceServers.length, 2);
  assert.strictEqual(config2.iceServers.length, 2);

  // RTC_CONFIG is deeply frozen
  assert.strictEqual(Object.isFrozen(RTC_CONFIG), true);
  assert.strictEqual(Object.isFrozen(RTC_CONFIG.iceServers), true);
  assert.strictEqual(Object.isFrozen(RTC_CONFIG.iceServers[0]), true);
});

test("createRtcConfig: validates and clones valid custom STUN/TURN configurations", () => {
  const custom = [
    { urls: "stun:stun.example.com:3478" },
    {
      urls: ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349?transport=tcp"],
      username: "user123",
      credential: "secretpassword",
    },
  ];

  const config = createRtcConfig(custom);
  assert.strictEqual(config.iceServers.length, 2);
  assert.strictEqual(config.iceServers[0].urls, "stun:stun.example.com:3478");
  assert.deepStrictEqual(config.iceServers[1].urls, [
    "turn:turn.example.com:3478?transport=udp",
    "turns:turn.example.com:5349?transport=tcp",
  ]);
  assert.strictEqual(config.iceServers[1].username, "user123");
  assert.strictEqual(config.iceServers[1].credential, "secretpassword");

  // Returned arrays are fresh copies
  assert.notStrictEqual(config.iceServers, custom);
  assert.notStrictEqual(config.iceServers[1].urls, custom[1].urls);
});

test("createRtcConfig: throws TypeError on malformed ICE configurations", () => {
  // Non-array
  assert.throws(() => createRtcConfig("stun:stun.example.com"), /array of RTCIceServer/);
  assert.throws(() => createRtcConfig({ urls: "stun:stun.example.com" }), /array of RTCIceServer/);

  // Non-object entries
  assert.throws(() => createRtcConfig([null]), /non-null object/);
  assert.throws(() => createRtcConfig(["stun:stun.example.com"]), /non-null object/);
  assert.throws(() => createRtcConfig([["nested"]]), /non-null object/);

  // Missing or empty urls
  assert.throws(() => createRtcConfig([{ username: "user" }]), /missing required 'urls'/);
  assert.throws(() => createRtcConfig([{ urls: [] }]), /empty 'urls' array/);
  assert.throws(() => createRtcConfig([{ urls: "" }]), /non-empty string/);
  assert.throws(() => createRtcConfig([{ urls: ["   "] }]), /non-empty string/);

  // Invalid scheme
  assert.throws(() => createRtcConfig([{ urls: "http://example.com" }]), /invalid URL scheme/i);
  assert.throws(() => createRtcConfig([{ urls: "ftp://example.com" }]), /invalid URL scheme/i);
  assert.throws(() => createRtcConfig([{ urls: "ws://example.com" }]), /invalid URL scheme/i);

  // Invalid username or credential types
  assert.throws(() => createRtcConfig([{ urls: "turn:turn.example.com", username: 123 }]), /'username' must be a non-empty string/);
  assert.throws(() => createRtcConfig([{ urls: "turn:turn.example.com", credential: {} }]), /'credential' must be a non-empty string/);

  // Invalid credentialType
  assert.throws(
    () => createRtcConfig([{ urls: "turn:turn.example.com", credentialType: "token" }]),
    /'credentialType' must be 'password' or 'oauth'/
  );

  // Valid credentialTypes accepted
  assert.doesNotThrow(() => createRtcConfig([{ urls: "turn:turn.example.com", credentialType: "password" }]));
  assert.doesNotThrow(() => createRtcConfig([{ urls: "turn:turn.example.com", credentialType: "oauth" }]));

  // Unsupported fields rejected
  assert.throws(
    () => createRtcConfig([{ urls: "turn:turn.example.com", unsupportedField: true }]),
    /unsupported field 'unsupportedField'/
  );

  // STUN URLs reject transport query parameter
  assert.throws(
    () => createRtcConfig([{ urls: "stun:stun.example.com?transport=udp" }]),
    /STUN URLs do not accept 'transport' query parameter/
  );

  // Invalid port rejected
  assert.throws(
    () => createRtcConfig([{ urls: "turn:turn.example.com:70000" }]),
    /invalid port '70000'/
  );

  // Server count limits enforced
  const tooManyServers = Array.from({ length: 17 }, (_, i) => ({ urls: `stun:stun${i}.example.com` }));
  assert.throws(() => createRtcConfig(tooManyServers), /exceeds maximum allowable limit of 16 servers/);

  // URLs per server count limits enforced
  const tooManyUrls = Array.from({ length: 9 }, (_, i) => `stun:stun${i}.example.com`);
  assert.throws(() => createRtcConfig([{ urls: tooManyUrls }]), /exceeds maximum allowable limit of 8 URLs/);
});

test("DEFAULT_TRANSFER_LIMITS: verifies internal limit consistency, aliases, and deep freezing", () => {
  assert.strictEqual(DEFAULT_TRANSFER_LIMITS.maxFileSize, MAX_FILE_SIZE);
  assert.strictEqual(DEFAULT_TRANSFER_LIMITS.minChunkSize, MIN_CHUNK_SIZE);
  assert.strictEqual(DEFAULT_TRANSFER_LIMITS.maxChunkSize, MAX_CHUNK_SIZE);
  assert.strictEqual(DEFAULT_TRANSFER_LIMITS.defaultChunkSize, CHUNK_SIZE);
  assert.strictEqual(DEFAULT_TRANSFER_LIMITS.maxChunkCount, MAX_CHUNK_COUNT);
  assert.strictEqual(DEFAULT_TRANSFER_LIMITS.maxTotalChunks, MAX_CHUNK_COUNT);

  // High watermark consistency with maxInFlightBytes
  assert.strictEqual(DEFAULT_TRANSFER_LIMITS.maxInFlightBytes, RECEIVER_BUFFER_HIGH_WATERMARK);
  assert.strictEqual(DEFAULT_TRANSFER_LIMITS.receiverBufferHighWatermark, RECEIVER_BUFFER_HIGH_WATERMARK);
  assert.strictEqual(DEFAULT_TRANSFER_LIMITS.receiverBufferLowWatermark, RECEIVER_BUFFER_LOW_WATERMARK);

  // Verify internal chunk count calculation: 10GB file at 64KB chunk size yields 160,000 chunks <= 200,000 ceiling
  const chunksForMaxFile = Math.ceil(MAX_FILE_SIZE / CHUNK_SIZE);
  assert.ok(chunksForMaxFile <= MAX_CHUNK_COUNT);

  // Deep freeze check
  assert.strictEqual(Object.isFrozen(DEFAULT_TRANSFER_LIMITS), true);
  assert.strictEqual(Object.isFrozen(MESSAGE_TYPE), true);
  assert.strictEqual(Object.isFrozen(SENDER_STATE), true);
  assert.strictEqual(Object.isFrozen(RECEIVER_STATE), true);
});

test("createHeaderMessage: validates required arguments, canonical limits, MIME types, and serializes correctly", () => {
  const headerJson = createHeaderMessage({
    fileName: "movie.mp4",
    fileSize: 1024000,
    fileType: "video/mp4",
    chunkSize: 65536,
    totalChunks: 16,
  });

  const parsed = JSON.parse(headerJson);
  assert.strictEqual(parsed.type, "HEADER");
  assert.strictEqual(parsed.fileName, "movie.mp4");
  assert.strictEqual(parsed.fileSize, 1024000);
  assert.strictEqual(parsed.fileType, "video/mp4");
  assert.strictEqual(parsed.chunkSize, 65536);
  assert.strictEqual(parsed.totalChunks, 16);

  // Generic MIME fallback when omitted
  const fallbackJson = createHeaderMessage({
    fileName: "data.bin",
    fileSize: 65536,
    chunkSize: 65536,
    totalChunks: 1,
  });
  const fallbackParsed = JSON.parse(fallbackJson);
  assert.strictEqual(fallbackParsed.fileType, DEFAULT_MIME_TYPE);

  // Rejects invalid arguments
  assert.throws(() => createHeaderMessage({ fileName: "", fileSize: 100, chunkSize: 50, totalChunks: 2 }), /fileName/);
  assert.throws(() => createHeaderMessage({ fileName: "a.mp4", fileSize: -5, chunkSize: 50, totalChunks: 2 }), /fileSize/);
  assert.throws(() => createHeaderMessage({ fileName: "a.mp4", fileSize: 100, chunkSize: 0, totalChunks: 2 }), /chunkSize/);
  assert.throws(() => createHeaderMessage({ fileName: "a.mp4", fileSize: 100, chunkSize: 50, totalChunks: "bad" }), /totalChunks/);

  // Rejects inconsistent totalChunks
  assert.throws(
    () => createHeaderMessage({ fileName: "a.mp4", fileSize: 100000, chunkSize: 65536, totalChunks: 5 }),
    /inconsistent totalChunks/
  );

  // Rejects oversized file
  assert.throws(
    () => createHeaderMessage({ fileName: "a.mp4", fileSize: MAX_FILE_SIZE + 100, chunkSize: 65536, totalChunks: 1 }),
    /exceeds maximum allowable limit/
  );

  // Supports empty 0-byte file with totalChunks === 0
  const emptyJson = createHeaderMessage({
    fileName: "empty.txt",
    fileSize: 0,
    fileType: "text/plain",
    chunkSize: 65536,
    totalChunks: 0,
  });
  const emptyParsed = JSON.parse(emptyJson);
  assert.strictEqual(emptyParsed.fileSize, 0);
  assert.strictEqual(emptyParsed.totalChunks, 0);

  // Rejects inconsistent totalChunks for 0-byte file
  assert.throws(
    () => createHeaderMessage({ fileName: "empty.txt", fileSize: 0, chunkSize: 65536, totalChunks: 1 }),
    /inconsistent totalChunks/
  );

  // Enforces custom limits argument
  assert.throws(
    () =>
      createHeaderMessage(
        {
          fileName: "custom.mp4",
          fileSize: 50 * 1024 * 1024,
          chunkSize: 65536,
          totalChunks: 800,
        },
        { maxFileSize: 10 * 1024 * 1024 }
      ),
    /exceeds maximum allowable limit/
  );

  // Accepts syntactically valid MIME types without relying on blocklist as security boundary
  const jsHeaderJson = createHeaderMessage({
    fileName: "script.js",
    fileSize: 65536,
    chunkSize: 65536,
    totalChunks: 1,
    fileType: "application/javascript",
  });
  assert.strictEqual(JSON.parse(jsHeaderJson).fileType, "application/javascript");

  // Rejects malformed MIME syntax
  assert.throws(
    () =>
      createHeaderMessage({
        fileName: "data.bin",
        fileSize: 65536,
        chunkSize: 65536,
        totalChunks: 1,
        fileType: "invalid-mime",
      }),
    /invalid MIME type syntax/
  );
});

test("createCompleteMessage: formats canonical checksum and backward-compatible sha256Checksum", () => {
  const validHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const json = createCompleteMessage(validHash);
  const parsed = JSON.parse(json);

  assert.strictEqual(parsed.type, "COMPLETE");
  assert.strictEqual(parsed.checksum, validHash);
  assert.strictEqual(parsed.algorithm, "sha256");
  assert.strictEqual(parsed.sha256Checksum, validHash);

  // Rejects invalid checksum format
  assert.throws(() => createCompleteMessage("short-hash"), /64-character hex SHA-256 string/);
  assert.throws(() => createCompleteMessage(12345), /64-character hex SHA-256 string/);
  assert.throws(() => createCompleteMessage("z".repeat(64)), /64-character hex SHA-256 string/);
});

test("createAckMessage: requires explicit verification result, non-negative counters, and validates checksum", () => {
  const validHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const json = createAckMessage(validHash, {
    verified: true,
    checksum: validHash,
    bytesReceived: 1024,
    chunksReceived: 16,
  });
  const parsed = JSON.parse(json);

  assert.strictEqual(parsed.type, "ACK");
  assert.strictEqual(parsed.ackType, "FINAL");
  assert.strictEqual(parsed.status, "SUCCESS");
  assert.strictEqual(parsed.verified, true);
  assert.strictEqual(parsed.checksum, validHash);
  assert.strictEqual(parsed.algorithm, "sha256");
  assert.strictEqual(parsed.sha256Checksum, validHash);
  assert.strictEqual(parsed.bytesReceived, 1024);
  assert.strictEqual(parsed.chunksReceived, 16);

  // Throws if verification result is missing or unverified
  assert.throws(() => createAckMessage(validHash), /requires an explicit successful verification result/);
  assert.throws(() => createAckMessage(validHash, {}), /requires an explicit successful verification result/);
  assert.throws(() => createAckMessage(validHash, { verified: false }), /requires an explicit successful verification result/);

  // Throws if verification result lacks verified checksum
  assert.throws(
    () => createAckMessage(validHash, { verified: true }),
    /verificationResult must supply the verified 64-character hex SHA-256 checksum/
  );
  assert.throws(
    () => createAckMessage(validHash, { verified: true, bytesReceived: 1024 }),
    /verificationResult must supply the verified 64-character hex SHA-256 checksum/
  );

  // Throws on invalid checksum
  assert.throws(() => createAckMessage("invalid", { verified: true, checksum: validHash }), /64-character hex SHA-256 string/);

  // Throws on invalid counter values
  assert.throws(() => createAckMessage(validHash, { verified: true, checksum: validHash, bytesReceived: -1 }), /bytesReceived must be a non-negative safe integer/);
  assert.throws(() => createAckMessage(validHash, { verified: true, checksum: validHash, chunksReceived: "bad" }), /chunksReceived must be a non-negative safe integer/);

  // Rejects when supplied checksum disagrees with verified checksum in verificationResult
  const otherHash = "1111111111111111111111111111111111111111111111111111111111111111";
  assert.throws(
    () => createAckMessage(validHash, { verified: true, checksum: otherHash }),
    /disagrees with verified checksum/
  );
  assert.throws(
    () => createAckMessage(validHash, { verified: true, verifiedChecksum: otherHash }),
    /disagrees with verified checksum/
  );
  assert.throws(
    () => createAckMessage(validHash, { verified: true, checksum: validHash, expectedChecksum: otherHash }),
    /disagrees with expected checksum/
  );

  // Accepts matching verified checksum in verificationResult
  const matchingJson = createAckMessage(validHash, {
    verified: true,
    checksum: validHash,
    expectedChecksum: validHash,
    bytesReceived: 1024,
    chunksReceived: 16,
  });
  assert.strictEqual(JSON.parse(matchingJson).checksum, validHash);
});

test("createChunkAckMessage and createDrainMessage: format flow control notifications and reject invalid counters", () => {
  const drain = JSON.parse(createDrainMessage(1048576, 16));
  assert.strictEqual(drain.type, "DRAIN");
  assert.strictEqual(drain.ackType, "CHUNK");
  assert.strictEqual(drain.receivedBytes, 1048576);
  assert.strictEqual(drain.receivedChunks, 16);

  const chunkAck = JSON.parse(createChunkAckMessage(2097152, 32));
  assert.strictEqual(chunkAck.type, "CHUNK_ACK");
  assert.strictEqual(chunkAck.ackType, "CHUNK");
  assert.strictEqual(chunkAck.receivedBytes, 2097152);
  assert.strictEqual(chunkAck.receivedChunks, 32);

  // Rejects invalid counters
  assert.throws(() => createDrainMessage(-1, 0), /receivedBytes must be a non-negative safe integer/);
  assert.throws(() => createDrainMessage(100, -5), /receivedChunks must be a non-negative safe integer/);
  assert.throws(() => createDrainMessage("100", 5), /receivedBytes must be a non-negative safe integer/);
  assert.throws(() => createChunkAckMessage(-1, 0), /receivedBytes must be a non-negative safe integer/);
  assert.throws(() => createChunkAckMessage(0, -1), /receivedChunks must be a non-negative safe integer/);
});

test("P2PFileSender & P2PFileReceiver: reject conflicting checksum aliases in ACK and COMPLETE messages", async () => {
  const hash1 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const hash2 = "1111111111111111111111111111111111111111111111111111111111111111";

  // 1. Receiver rejects COMPLETE packet with conflicting checksums
  let receiverError = null;
  const receiver = new P2PFileReceiver(createMockSocket(), "host1", {
    onError: (err) => {
      receiverError = err;
    },
  });
  receiver.metadata = { fileName: "test.mp4", fileSize: 3, totalChunks: 1, chunkSize: 65536 };
  receiver.state = RECEIVER_STATE.RECEIVING;
  receiver.receivedBytes = 3;
  receiver.receivedChunks = 1;

  await receiver._processMessage({
    data: JSON.stringify({
      type: "COMPLETE",
      checksum: hash1,
      sha256Checksum: hash2,
    }),
  });
  assert.ok(receiverError);
  assert.match(receiverError.message, /conflicting checksum and sha256Checksum aliases/);

  // 2. Sender rejects ACK packet with conflicting checksums
  const sender = new P2PFileSender(createMockSocket(), "peer1", { size: 100, name: "file.bin" });
  sender.state = SENDER_STATE.AWAITING_ACK;
  let ackPromiseRejected = false;
  sender._ackRejecter = () => {
    ackPromiseRejected = true;
  };

  sender._onMessage({
    data: JSON.stringify({
      type: "ACK",
      ackType: "FINAL",
      status: "SUCCESS",
      verified: true,
      checksum: hash1,
      sha256Checksum: hash2,
    }),
  });
  assert.strictEqual(ackPromiseRejected, true);
});

test("createNackMessage, createCancelMessage, createPauseMessage, createResumeMessage: serializations", () => {
  const nack = JSON.parse(createNackMessage("Checksum mismatch"));
  assert.strictEqual(nack.type, "NACK");
  assert.strictEqual(nack.reason, "Checksum mismatch");

  const cancel = JSON.parse(createCancelMessage("User pressed cancel"));
  assert.strictEqual(cancel.type, "CANCEL");
  assert.strictEqual(cancel.reason, "User pressed cancel");

  const pause = JSON.parse(createPauseMessage());
  assert.strictEqual(pause.type, "PAUSE");

  const resume = JSON.parse(createResumeMessage());
  assert.strictEqual(resume.type, "RESUME");
});

test("P2PFileSender & P2PFileReceiver: transfers empty 0-byte file successfully", async () => {
  const socketSender = createMockSocket();
  const socketReceiver = createMockSocket();

  const emptyFile = {
    name: "empty.txt",
    size: 0,
    type: "text/plain",
    slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
  };

  let receiverCompletedFile = null;
  const receiver = new P2PFileReceiver(socketReceiver, "sender1", {
    onComplete: (file) => {
      receiverCompletedFile = file;
    },
  });
  const receiverDc = createMockDataChannel();
  receiver.dc = receiverDc;

  let senderCompleted = false;
  const sender = new P2PFileSender(socketSender, "receiver1", emptyFile, {
    onComplete: () => {
      senderCompleted = true;
    },
  });
  const senderDc = createMockDataChannel();
  sender.dc = senderDc;

  // 1. Sender opens channel and sends HEADER (totalChunks: 0) and COMPLETE (empty digest)
  const sendPromise = sender._onChannelOpen();

  await new Promise((r) => setTimeout(r, 20));

  // Forward HEADER from sender to receiver
  const headerMsg = senderDc.sentMessages.find((m) => typeof m === "string" && m.includes('"type":"HEADER"'));
  assert.ok(headerMsg);
  await receiver._processMessage({ data: headerMsg });
  assert.strictEqual(receiver.metadata.fileSize, 0);
  assert.strictEqual(receiver.metadata.totalChunks, 0);

  // Forward COMPLETE from sender to receiver
  const completeMsg = senderDc.sentMessages.find((m) => typeof m === "string" && m.includes('"type":"COMPLETE"'));
  assert.ok(completeMsg);
  await receiver._processMessage({ data: completeMsg });

  assert.ok(receiverCompletedFile);
  assert.strictEqual(receiverCompletedFile.size, 0);
  assert.strictEqual(receiver.state, RECEIVER_STATE.COMPLETED);

  // Forward ACK from receiver to sender
  const ackMsg = receiverDc.sentMessages.find((m) => typeof m === "string" && m.includes('"type":"ACK"'));
  assert.ok(ackMsg);
  sender._onMessage({ data: ackMsg });

  await sendPromise;
  assert.strictEqual(senderCompleted, true);
  assert.strictEqual(sender.state, SENDER_STATE.COMPLETED);
});

test("P2PFileSender: chunk larger than maxInFlightBytes is rejected without bypassing limit", async () => {
  const socket = createMockSocket();
  const file = new File([Buffer.alloc(200, "a")], "sample.bin", { type: "application/octet-stream" });

  // 1. Constructor rejects incompatible configuration when chunkSize > maxInFlightBytes
  assert.throws(
    () => new P2PFileSender(socket, "peer-1", file, { chunkSize: 2048 }, { maxInFlightBytes: 1024 }),
    /exceeds maxInFlightBytes/i
  );

  // 2. _waitForFlowControlWindow rejects any chunk exceeding maxInFlightBytes even when inFlight === 0
  let errorReceived = null;
  const sender = new P2PFileSender(socket, "peer-1", file, {
    chunkSize: 1024,
    onError: (err) => { errorReceived = err; },
  }, { maxInFlightBytes: 1024 });

  sender.state = SENDER_STATE.SENDING;
  sender.sentBytes = 0;
  sender.receiverAckedBytes = 0; // inFlight is 0

  await assert.rejects(
    async () => {
      await sender._waitForFlowControlWindow(2000); // 2000 > 1024
    },
    /exceeds maximum allowable in-flight limit/i
  );

  assert.ok(errorReceived);
  assert.strictEqual(sender.state, SENDER_STATE.FAILED);
  assert.strictEqual(sender.isTerminated, true);
});

test("P2PFileSender: validation error during _onChannelOpen() triggers proper cleanup without unhandled rejection", async () => {
  const socket = createMockSocket();
  let errorReceived = null;

  // File with invalid path-traversal filename
  const fileWithTraversal = { size: 100, name: "../../bad_file.bin", type: "application/octet-stream" };
  const sender = new P2PFileSender(socket, "peer-1", fileWithTraversal, {
    onError: (err) => { errorReceived = err; },
  });
  const dc = createMockDataChannel();
  sender.dc = dc;

  // Simulate DataChannel open event
  await sender._onChannelOpen();

  assert.ok(errorReceived);
  assert.match(errorReceived.message, /invalid file name/i);
  assert.strictEqual(sender.state, SENDER_STATE.FAILED);
  assert.strictEqual(sender.isTerminated, true);
  assert.strictEqual(sender.dc, null); // Resources cleaned up
  assert.strictEqual(sender.pc, null);

  // Forbidden executable MIME type triggers clean failure
  errorReceived = null;
  const fileWithJs = { size: 100, name: "script.js", type: "application/javascript" };
  const senderJs = new P2PFileSender(socket, "peer-1", fileWithJs, {
    onError: (err) => { errorReceived = err; },
  });
  senderJs.dc = createMockDataChannel();
  await senderJs._onChannelOpen();

  assert.ok(errorReceived);
  assert.match(errorReceived.message, /invalid mime type/i);
  assert.strictEqual(senderJs.state, SENDER_STATE.FAILED);
  assert.strictEqual(senderJs.dc, null);
});

test("P2PFileSender: DataChannel buffer that never drains causes a timeout and transfer failure", async () => {
  const socket = createMockSocket();
  let errorReceived = null;
  const file = new File([Buffer.alloc(100, "b")], "drain_test.bin", { type: "application/octet-stream" });

  const sender = new P2PFileSender(
    socket,
    "peer-1",
    file,
    {
      chunkSize: 1024,
      onError: (err) => { errorReceived = err; },
    },
    { drainTimeoutMs: 60 }
  );

  const dc = createMockDataChannel();
  dc.bufferedAmount = 5000; // Buffer never drains
  sender.dc = dc;

  // Run channel open which streams chunks then hits _waitForBufferDrainBeforeCompletion()
  const sendPromise = sender._onChannelOpen();

  await sendPromise;

  assert.ok(errorReceived);
  assert.match(errorReceived.message, /buffer drain timed out/i);
  assert.strictEqual(sender.state, SENDER_STATE.FAILED);
  assert.strictEqual(sender.isTerminated, true);

  // Verification that COMPLETE packet was NEVER sent
  const completeMsg = dc.sentMessages.find((m) => typeof m === "string" && m.includes('"type":"COMPLETE"'));
  assert.strictEqual(completeMsg, undefined);
  assert.strictEqual(sender.dc, null); // Cleaned up
});

test("P2PFileSender: cancellation or channel closure interrupts drain wait promptly", async () => {
  const socket = createMockSocket();

  // Case 1: Cancellation interrupts buffer drain wait promptly
  let cancelReason = null;
  const file1 = new File([Buffer.alloc(100, "c")], "cancel_drain.bin", { type: "application/octet-stream" });
  const sender1 = new P2PFileSender(
    socket,
    "peer-1",
    file1,
    {
      chunkSize: 1024,
      onCancel: (reason) => { cancelReason = reason; },
    },
    { drainTimeoutMs: 10000 } // Long timeout to verify prompt cancellation
  );
  const dc1 = createMockDataChannel();
  dc1.bufferedAmount = 5000;
  sender1.dc = dc1;

  const sendPromise1 = sender1._onChannelOpen();
  await new Promise((r) => setTimeout(r, 20));

  // Cancel while waiting for buffer drain
  sender1.cancel("User cancelled during drain");
  await sendPromise1;

  assert.strictEqual(cancelReason, "User cancelled during drain");
  assert.strictEqual(sender1.state, SENDER_STATE.CANCELLED);
  assert.strictEqual(sender1.isTerminated, true);

  // Case 2: DataChannel closure interrupts buffer drain wait promptly
  let error2 = null;
  const file2 = new File([Buffer.alloc(100, "d")], "close_drain.bin", { type: "application/octet-stream" });
  const sender2 = new P2PFileSender(
    socket,
    "peer-1",
    file2,
    {
      chunkSize: 1024,
      onError: (err) => { error2 = err; },
    },
    { drainTimeoutMs: 10000 }
  );
  const dc2 = createMockDataChannel();
  dc2.bufferedAmount = 5000;
  sender2.dc = dc2;

  const sendPromise2 = sender2._onChannelOpen();
  await new Promise((r) => setTimeout(r, 20));

  // Close DataChannel while waiting for buffer drain
  dc2.close();
  await sendPromise2;

  assert.ok(error2);
  assert.match(error2.message, /DataChannel closed/i);
  assert.strictEqual(sender2.state, SENDER_STATE.FAILED);
  assert.strictEqual(sender2.isTerminated, true);
});

test("P2PFileSender: non-empty buffer keeps drain promise waiting and resolves only upon actual drain", async () => {
  const socket = createMockSocket();
  const file = new File([Buffer.alloc(100, "e")], "drain_non_empty.bin", { type: "application/octet-stream" });

  const sender = new P2PFileSender(
    socket,
    "peer-1",
    file,
    {},
    { drainTimeoutMs: 2000 }
  );

  const dc = createMockDataChannel();
  dc.bufferedAmount = 4096;
  sender.dc = dc;

  let isResolved = false;
  const drainPromise = sender._waitForBufferDrainBeforeCompletion().then(() => {
    isResolved = true;
  });

  // 1. Spurious wake when buffer is non-empty must NOT resolve the drain promise
  sender._wakeDrainWaiters();
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(isResolved, false, "Drain promise must not resolve while bufferedAmount > 0");

  // 2. Buffer actually drains to 0: waiter resolves successfully
  dc.bufferedAmount = 0;
  sender._wakeDrainWaiters();
  await drainPromise;
  assert.strictEqual(isResolved, true, "Drain promise must resolve once bufferedAmount reaches 0");

  // 3. Calling while cancelled or terminated must reject immediately
  sender.isCancelled = true;
  sender.isTerminated = true;
  await assert.rejects(
    async () => {
      await sender._waitForBufferDrainBeforeCompletion();
    },
    /Transfer cancelled/i
  );
});

test("P2PFileReceiver: bounds buffering, sends PAUSE during slow writes, resumes on drain, and writes chunks in order", async () => {
  const socket = createMockSocket();
  let completeResult = null;
  let errorReceived = null;

  const writes = [];
  let isDelayed = true;
  let delayedWriteResolve = null;

  const mockWritable = {
    closed: false,
    aborted: false,
    async write(batch) {
      if (isDelayed) {
        // Hold the write until explicitly released
        await new Promise((resolve) => {
          delayedWriteResolve = resolve;
        });
      }
      writes.push(batch);
    },
    async close() {
      this.closed = true;
    },
    async abort() {
      this.aborted = true;
    },
  };

  const fileHandle = createMockFileHandle(mockWritable);

  // Set small thresholds for testing: high watermark = 4096 (4 KB), low watermark = 1024 (1 KB)
  const limits = {
    ...DEFAULT_TRANSFER_LIMITS,
    receiverBufferHighWatermark: 4096,
    receiverBufferLowWatermark: 1024,
  };

  const receiver = new P2PFileReceiver(
    socket,
    "host-1",
    {
      limits,
      onComplete: (file, blob, meta) => {
        completeResult = { file, meta };
      },
      onError: (err) => {
        errorReceived = err;
      },
    },
    fileHandle
  );

  const dc = createMockDataChannel();
  receiver.dc = dc;

  const chunkSize = 1024; // 1 KB chunks
  const totalChunks = 8;  // 8 KB total file
  const fileSize = 8192;

  // 1. Send HEADER
  await receiver._onMessage({
    data: JSON.stringify({
      type: "HEADER",
      fileName: "backpressure-test.bin",
      fileSize,
      fileType: "application/octet-stream",
      chunkSize,
      totalChunks,
    }),
  });

  // Prepare 8 ordered distinct chunks
  const chunks = [];
  const fullPayload = new Uint8Array(fileSize);
  for (let i = 0; i < totalChunks; i++) {
    const chunk = new Uint8Array(chunkSize).fill(i + 1);
    chunks.push(chunk.buffer);
    fullPayload.set(chunk, i * chunkSize);
  }
  const expectedChecksum = crypto.createHash("sha256").update(fullPayload).digest("hex");

  // 2. Send first 2 chunks (2 KB) -> below 4 KB high watermark
  const p0 = receiver._onMessage({ data: chunks[0] });
  const p1 = receiver._onMessage({ data: chunks[1] });

  // Yield to allow Chunk 0 to flush to mockWritable.write(), where it gets held by delayedWriteResolve
  await new Promise((r) => setTimeout(r, 10));

  assert.strictEqual(receiver.isSignaledPaused, false, "Receiver must not be paused below high watermark");

  // 3. Burst next 3 chunks (chunks 2, 3, 4) while write is stalled
  const p2 = receiver._onMessage({ data: chunks[2] });
  const p3 = receiver._onMessage({ data: chunks[3] });
  const p4 = receiver._onMessage({ data: chunks[4] });

  // Total buffered bytes is now >= 4096 bytes (high watermark)
  assert.strictEqual(receiver.isSignaledPaused, true, "Receiver must signal PAUSE when buffer reaches high watermark");
  const pauseMsg = dc.sentMessages.find((m) => {
    try { return JSON.parse(m).type === "PAUSE"; } catch { return false; }
  });
  assert.ok(pauseMsg, "Receiver must emit PAUSE control packet to sender");

  // Assert exact accounting without double-counting
  assert.ok(receiver.totalBufferedBytes >= 4096, "totalBufferedBytes must reflect queued, active, and buffer bytes");
  assert.strictEqual(
    receiver.totalBufferedBytes,
    receiver.queuedBytes + receiver.writeBufferSize + receiver.activeWriteBytes
  );

  // 4. Release the delayed write and allow writes to proceed smoothly
  isDelayed = false;
  if (delayedWriteResolve) {
    delayedWriteResolve();
  }

  // Send remaining chunks 5, 6, 7 and COMPLETE
  const p5 = receiver._onMessage({ data: chunks[5] });
  const p6 = receiver._onMessage({ data: chunks[6] });
  const p7 = receiver._onMessage({ data: chunks[7] });
  const pComplete = receiver._onMessage({
    data: JSON.stringify({ type: "COMPLETE", checksum: expectedChecksum }),
  });

  await Promise.all([p0, p1, p2, p3, p4, p5, p6, p7, pComplete]);

  // Assert receiver unpaused and sent DRAIN / RESUME
  assert.strictEqual(receiver.isSignaledPaused, false, "Receiver must unpause after buffer drains below low watermark");
  const resumeMsg = dc.sentMessages.find((m) => {
    try {
      const p = JSON.parse(m);
      return p.type === "RESUME" || p.type === "DRAIN";
    } catch { return false; }
  });
  assert.ok(resumeMsg, "Receiver must emit DRAIN or RESUME control packet once drained");

  // Assert successful completion and verification
  assert.strictEqual(errorReceived, null);
  assert.ok(completeResult, "Transfer must complete successfully");
  assert.strictEqual(completeResult.meta.checksum, expectedChecksum);

  // Assert ordered writes to disk: recombining all written Blob batches matches fullPayload exactly
  const writtenBuffers = [];
  for (const batch of writes) {
    const ab = await batch.arrayBuffer();
    writtenBuffers.push(new Uint8Array(ab));
  }
  const totalWrittenBytes = writtenBuffers.reduce((sum, b) => sum + b.byteLength, 0);
  assert.strictEqual(totalWrittenBytes, fileSize, "All bytes must be written to disk");

  const reassembled = new Uint8Array(fileSize);
  let writeOffset = 0;
  for (const buf of writtenBuffers) {
    reassembled.set(buf, writeOffset);
    writeOffset += buf.byteLength;
  }
  assert.deepStrictEqual(reassembled, fullPayload, "Disk writes must preserve exact chunk ordering");

  // Assert all buffers drained to 0
  assert.strictEqual(receiver.totalBufferedBytes, 0);
  assert.strictEqual(receiver.queuedBytes, 0);
  assert.strictEqual(receiver.writeBufferSize, 0);
  assert.strictEqual(receiver.activeWriteBytes, 0);
});

test("P2PFileSender: cancellation during blocked wait terminates transfer promptly without error", async () => {
  const socket = createMockSocket();
  const file = new File([Buffer.alloc(4096, "a")], "paused_sender.bin", { type: "application/octet-stream" });
  let cancelledReason = null;
  let errorReceived = null;
  let completeReceived = null;

  const sender = new P2PFileSender(
    socket,
    "peer-1",
    file,
    {
      chunkSize: 1024,
      onCancel: (reason) => { cancelledReason = reason; },
      onError: (err) => { errorReceived = err; },
      onComplete: (res) => { completeReceived = res; },
    },
    { pauseTimeoutMs: 10000 }
  );

  const dc = createMockDataChannel();
  sender.dc = dc;

  // Simulate receiver sending PAUSE before chunks are sent
  sender.isReceiverPaused = true;

  // Start sending
  const sendPromise = sender._onChannelOpen();

  // Wait briefly so sender enters _waitForReceiverResume()
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(sender.state, SENDER_STATE.SENDING);
  assert.strictEqual(sender._pauseWaiters.size, 1, "Sender must have an active pause waiter");

  // Cancel while blocked in _waitForReceiverResume()
  sender.cancel("User cancelled transfer during receiver pause", false);

  await sendPromise;

  assert.strictEqual(sender.state, SENDER_STATE.CANCELLED);
  assert.strictEqual(sender.isCancelled, true);
  assert.strictEqual(sender.isTerminated, true);
  assert.strictEqual(cancelledReason, "User cancelled transfer during receiver pause");
  assert.strictEqual(errorReceived, null, "onError must NOT be called on cancellation");
  assert.strictEqual(completeReceived, null, "onComplete must NOT be called on cancellation");
  assert.strictEqual(sender._pauseWaiters.size, 0, "Pause waiters must be cleaned up");
});

test("P2PFileReceiver: cancellation during pending disk write cleanly halts and suppresses control messages", async () => {
  const socket = createMockSocket();
  let cancelledReason = null;
  let errorReceived = null;
  let completeReceived = null;
  let delayedWriteResolve = null;

  const mockWritable = {
    writes: [],
    closed: false,
    aborted: false,
    write(batch) {
      return new Promise((resolve) => {
        delayedWriteResolve = () => {
          this.writes.push(batch);
          resolve();
        };
      });
    },
    async close() { this.closed = true; },
    async abort() { this.aborted = true; },
  };

  const fileHandle = createMockFileHandle(mockWritable);
  const limits = {
    ...DEFAULT_TRANSFER_LIMITS,
    receiverBufferHighWatermark: 2048,
    receiverBufferLowWatermark: 1024,
  };

  const receiver = new P2PFileReceiver(
    socket,
    "host-1",
    {
      limits,
      onCancel: (reason) => { cancelledReason = reason; },
      onError: (err) => { errorReceived = err; },
      onComplete: () => { completeReceived = true; },
    },
    fileHandle
  );

  const dc = createMockDataChannel();
  receiver._attachDataChannel(dc);

  // 1. Establish header with valid chunkSize (1024)
  await receiver._onMessage({
    data: JSON.stringify({
      type: "HEADER",
      fileName: "cancel-pending-write.bin",
      fileSize: 4096,
      fileType: "application/octet-stream",
      chunkSize: 1024,
      totalChunks: 4,
    }),
  });

  // 2. Send 1024-byte chunk to trigger flush to disk
  const chunkData = new Uint8Array(1024).fill(1).buffer;
  const chunkMsgPromise = receiver._onMessage({ data: chunkData });

  // Wait a microtask so chunk enters writable.write()
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(receiver.activeWriteBytes > 0, "activeWriteBytes must be tracked during disk write");

  // 3. Cancel while write is still pending
  receiver.cancel("Cancellation while writing to disk", true);

  assert.strictEqual(receiver.state, RECEIVER_STATE.CANCELLED);
  assert.strictEqual(receiver.isCancelled, true);
  assert.strictEqual(receiver.isTerminated, true);
  assert.strictEqual(cancelledReason, "Cancellation while writing to disk");
  assert.strictEqual(errorReceived, null);
  assert.strictEqual(completeReceived, null);
  assert.strictEqual(receiver.totalBufferedBytes, 0, "Buffers must be cleared immediately upon cancellation");

  // 4. Now resolve the disk write
  if (delayedWriteResolve) {
    delayedWriteResolve();
  }
  await chunkMsgPromise;

  // Assert no stray control packets (DRAIN, RESUME, NACK) were sent after cancellation
  const strayMessages = dc.sentMessages.filter((m) => {
    try {
      const parsed = JSON.parse(m);
      return ["DRAIN", "RESUME", "CHUNK_ACK", "NACK", "ACK"].includes(parsed.type);
    } catch {
      return false;
    }
  });
  assert.deepStrictEqual(strayMessages, [], "No flow control or NACK messages should be sent after cancellation");
  assert.strictEqual(errorReceived, null, "onError must not be called after cancellation even when disk resolves");
});

test("P2PFileSender and P2PFileReceiver: connection closure fails in-flight transfers and notifies onError", async () => {
  const socket = createMockSocket();

  // 1. Receiver connection closure test
  let receiverError = null;
  let receiverCancelled = null;
  let receiverComplete = null;
  const receiver = new P2PFileReceiver(socket, "host-1", {
    onError: (err) => { receiverError = err; },
    onCancel: (reason) => { receiverCancelled = reason; },
    onComplete: () => { receiverComplete = true; },
  });

  const receiverDc = createMockDataChannel();
  receiver._attachDataChannel(receiverDc);
  receiver.state = RECEIVER_STATE.RECEIVING;
  receiver.metadata = { fileName: "close_test.bin", fileSize: 5000, totalChunks: 5 };

  // Trigger unexpected close
  receiverDc.close();

  assert.strictEqual(receiver.state, RECEIVER_STATE.FAILED);
  assert.strictEqual(receiver.isTerminated, true);
  assert.ok(receiverError);
  assert.match(receiverError.message, /DataChannel closed before file transfer completed/i);
  assert.strictEqual(receiverCancelled, null);
  assert.strictEqual(receiverComplete, null);

  // 2. Sender connection closure test
  let senderError = null;
  let senderCancelled = null;
  let senderComplete = null;
  const file = new File([Buffer.alloc(4096, "b")], "close_sender.bin", { type: "application/octet-stream" });
  const sender = new P2PFileSender(socket, "peer-1", file, {
    chunkSize: 1024,
    onError: (err) => { senderError = err; },
    onCancel: (reason) => { senderCancelled = reason; },
    onComplete: () => { senderComplete = true; },
  }, { pauseTimeoutMs: 10000 });

  const senderDc = createMockDataChannel();
  sender.dc = senderDc;

  // Pause sender to keep transfer in-flight, then open channel
  sender.isReceiverPaused = true;
  const sendPromise = sender._onChannelOpen();
  await new Promise((r) => setTimeout(r, 20));

  // Trigger unexpected close while in-flight
  senderDc.close();
  await sendPromise;

  assert.strictEqual(sender.state, SENDER_STATE.FAILED);
  assert.strictEqual(sender.isTerminated, true);
  assert.ok(senderError);
  assert.match(senderError.message, /DataChannel closed prematurely/i);
  assert.strictEqual(senderCancelled, null);
  assert.strictEqual(senderComplete, null);
});

test("P2PFileSender and P2PFileReceiver: repeated cleanup and cancel calls are idempotent", async () => {
  const socket = createMockSocket();

  // Test Receiver idempotence
  let receiverCancelCount = 0;
  let receiverErrorCount = 0;
  const receiver = new P2PFileReceiver(socket, "host-1", {
    onCancel: () => { receiverCancelCount++; },
    onError: () => { receiverErrorCount++; },
  });
  receiver.dc = createMockDataChannel();

  receiver.cancel("First cancel", false);
  receiver.cancel("Second cancel", false);
  receiver.cancel("Third cancel", false);
  receiver._cleanup();
  receiver._cleanup();

  assert.strictEqual(receiverCancelCount, 1, "Receiver onCancel must fire exactly once");
  assert.strictEqual(receiverErrorCount, 0, "Receiver onError must not fire on cancel");
  assert.strictEqual(receiver.state, RECEIVER_STATE.CANCELLED);
  assert.strictEqual(receiver.isTerminated, true);

  // Test Sender idempotence
  let senderCancelCount = 0;
  let senderErrorCount = 0;
  const file = new File([Buffer.alloc(100, "z")], "idempotent.bin", { type: "application/octet-stream" });
  const sender = new P2PFileSender(socket, "peer-1", file, {
    onCancel: () => { senderCancelCount++; },
    onError: () => { senderErrorCount++; },
  });
  sender.dc = createMockDataChannel();

  sender.cancel("First cancel", false);
  sender.cancel("Second cancel", false);
  sender.cancel("Third cancel", false);
  sender._cleanup();
  sender._cleanup();

  assert.strictEqual(senderCancelCount, 1, "Sender onCancel must fire exactly once");
  assert.strictEqual(senderErrorCount, 0, "Sender onError must not fire on cancel");
  assert.strictEqual(sender.state, SENDER_STATE.CANCELLED);
  assert.strictEqual(sender.isTerminated, true);

  // Test cross-terminal callback idempotence: cancel() after _handleError()
  let errorCount = 0;
  let cancelCount = 0;
  const receiver2 = new P2PFileReceiver(socket, "host-1", {
    onError: () => { errorCount++; },
    onCancel: () => { cancelCount++; },
  });
  receiver2._handleError(new Error("Initial failure"));
  receiver2.cancel("Late cancel", false);

  assert.strictEqual(errorCount, 1, "Initial error callback must fire");
  assert.strictEqual(cancelCount, 0, "Cancel callback must NOT fire after error");
  assert.strictEqual(receiver2.state, RECEIVER_STATE.FAILED);
});

test("validateTransferLimits: validates and normalizes limits strictly", () => {
  // Returns defaults when null/undefined
  const defaults = validateTransferLimits();
  assert.strictEqual(defaults.maxFileSize, DEFAULT_TRANSFER_LIMITS.maxFileSize);
  assert.strictEqual(defaults.minChunkSize, DEFAULT_TRANSFER_LIMITS.minChunkSize);
  assert.strictEqual(Object.isFrozen(defaults), true);

  // Rejects non-objects and arrays
  assert.throws(() => validateTransferLimits("bad"), /limits must be a non-null object/);
  assert.throws(() => validateTransferLimits([]), /limits must be a non-null object/);

  // Rejects non-positive or non-integer fields
  assert.throws(() => validateTransferLimits({ maxFileSize: -1 }), /limits.maxFileSize must be a positive integer/);
  assert.throws(() => validateTransferLimits({ minChunkSize: 0 }), /limits.minChunkSize must be a positive integer/);
  assert.throws(() => validateTransferLimits({ maxChunkSize: 1024.5 }), /limits.maxChunkSize must be a positive integer/);
  assert.throws(() => validateTransferLimits({ receiverBufferHighWatermark: "bad" }), /limits.receiverBufferHighWatermark must be a positive integer/);

  // Rejects conflicting chunk count aliases
  assert.throws(
    () => validateTransferLimits({ maxChunkCount: 100, maxTotalChunks: 200 }),
    /Conflicting limits: maxChunkCount/
  );

  // Rejects minChunkSize > maxChunkSize
  assert.throws(
    () => validateTransferLimits({ minChunkSize: 10000, maxChunkSize: 5000 }),
    /minChunkSize cannot exceed maxChunkSize/
  );

  // Rejects maxInFlightBytes < minChunkSize
  assert.throws(
    () => validateTransferLimits({ minChunkSize: 5000, maxInFlightBytes: 1000 }),
    /maxInFlightBytes cannot be less than minChunkSize/
  );

  // Rejects receiverBufferLowWatermark >= receiverBufferHighWatermark
  assert.throws(
    () => validateTransferLimits({ receiverBufferLowWatermark: 5000, receiverBufferHighWatermark: 4000 }),
    /receiverBufferLowWatermark must be strictly less than receiverBufferHighWatermark/
  );
  assert.throws(
    () => validateTransferLimits({ receiverBufferLowWatermark: 5000, receiverBufferHighWatermark: 5000 }),
    /receiverBufferLowWatermark must be strictly less than receiverBufferHighWatermark/
  );

  // Rejects bufferLowWatermark >= bufferHighWatermark
  assert.throws(
    () => validateTransferLimits({ bufferLowWatermark: 5000, bufferHighWatermark: 4000 }),
    /bufferLowWatermark must be strictly less than bufferHighWatermark/
  );

  // Normalizes partial custom limits with defaults
  const normalized = validateTransferLimits({ maxFileSize: 50000 });
  assert.strictEqual(normalized.maxFileSize, 50000);
  assert.strictEqual(normalized.minChunkSize, DEFAULT_TRANSFER_LIMITS.minChunkSize);
  assert.strictEqual(normalized.maxChunkSize, DEFAULT_TRANSFER_LIMITS.maxChunkSize);
});

test("validateFileHeader: normalizes partial limits and rejects invalid limits", () => {
  const validHeader = {
    type: "HEADER",
    fileName: "file.bin",
    fileSize: 1000,
    fileType: "application/octet-stream",
    chunkSize: 1000,
    totalChunks: 1,
  };

  // Passing partial limits merges with defaults and enforces bounds
  const res1 = validateFileHeader(validHeader, { maxFileSize: 2000 });
  assert.strictEqual(res1.isValid, true);
  assert.strictEqual(res1.sanitizedHeader.fileSize, 1000);

  // Passing invalid limits returns isValid: false with error
  const res2 = validateFileHeader(validHeader, { maxFileSize: -100 });
  assert.strictEqual(res2.isValid, false);
  assert.match(res2.error, /Invalid transfer limits/);

  // Relational limits violation in header validator
  const res3 = validateFileHeader(validHeader, { minChunkSize: 10000, maxChunkSize: 5000 });
  assert.strictEqual(res3.isValid, false);
  assert.match(res3.error, /minChunkSize cannot exceed maxChunkSize/);
});

test("createAckMessage: validates checksum aliases and counter consistency strictly", () => {
  const validHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const diffHash = "1111111111111111111111111111111111111111111111111111111111111111";

  // Rejects conflicting checksum aliases in verificationResult
  assert.throws(
    () => createAckMessage(validHash, { verified: true, checksum: validHash, verifiedChecksum: diffHash }),
    /disagrees with verified checksum/
  );
  assert.throws(
    () => createAckMessage(validHash, { verified: true, checksum: validHash, sha256Checksum: diffHash }),
    /disagrees with verified checksum/
  );

  // Rejects conflicting counter aliases
  assert.throws(
    () => createAckMessage(validHash, { verified: true, checksum: validHash, bytesReceived: 100, receivedBytes: 200 }),
    /conflicting bytesReceived .* and receivedBytes/
  );
  assert.throws(
    () => createAckMessage(validHash, { verified: true, checksum: validHash, chunksReceived: 2, receivedChunks: 4 }),
    /conflicting chunksReceived .* and receivedChunks/
  );

  // Supports fallback counter aliases and emits both
  const ackJson = createAckMessage(validHash, {
    verified: true,
    checksum: validHash,
    receivedBytes: 1024,
    receivedChunks: 16,
  });
  const parsed = JSON.parse(ackJson);
  assert.strictEqual(parsed.bytesReceived, 1024);
  assert.strictEqual(parsed.receivedBytes, 1024);
  assert.strictEqual(parsed.chunksReceived, 16);
  assert.strictEqual(parsed.receivedChunks, 16);
  assert.strictEqual(parsed.checksum, validHash);
  assert.strictEqual(parsed.sha256Checksum, validHash);
});

test("P2PFileReceiver: validates limits in constructor, rejects malformed COMPLETE, and rejects excessive bytes/chunks", async () => {
  const socket = createMockSocket();

  // Rejects invalid custom limits in receiver constructor
  assert.throws(
    () => new P2PFileReceiver(socket, "host1", { limits: { receiverBufferLowWatermark: 5000, receiverBufferHighWatermark: 2000 } }),
    /receiverBufferLowWatermark must be strictly less than receiverBufferHighWatermark/
  );

  // 1. Rejects COMPLETE with missing or malformed checksum before finalizing
  let error1 = null;
  const receiver1 = new P2PFileReceiver(socket, "host1", {
    onError: (err) => { error1 = err; },
  });
  receiver1.metadata = { fileName: "test.bin", fileSize: 100, totalChunks: 1, chunkSize: 100 };
  receiver1.state = RECEIVER_STATE.RECEIVING;
  receiver1.receivedBytes = 100;
  receiver1.receivedChunks = 1;

  // Non-hex checksum
  await receiver1._processMessage({ data: JSON.stringify({ type: "COMPLETE", checksum: "invalid-hex" }) });
  assert.ok(error1);
  assert.match(error1.message, /must be a 64-character hex SHA-256 string/);
  assert.strictEqual(receiver1.state, RECEIVER_STATE.FAILED);

  // Missing checksum
  let errorMissing = null;
  const receiverMissing = new P2PFileReceiver(socket, "host1", {
    onError: (err) => { errorMissing = err; },
  });
  receiverMissing.metadata = { fileName: "test.bin", fileSize: 100, totalChunks: 1, chunkSize: 100 };
  receiverMissing.state = RECEIVER_STATE.RECEIVING;
  receiverMissing.receivedBytes = 100;
  receiverMissing.receivedChunks = 1;
  await receiverMissing._processMessage({ data: JSON.stringify({ type: "COMPLETE" }) });
  assert.ok(errorMissing);
  assert.match(errorMissing.message, /missing required 64-character hex SHA-256 checksum/);
  assert.strictEqual(receiverMissing.state, RECEIVER_STATE.FAILED);

  // 2. Rejects COMPLETE with excessive bytes
  let error2 = null;
  const receiver2 = new P2PFileReceiver(socket, "host1", {
    onError: (err) => { error2 = err; },
  });
  receiver2.metadata = { fileName: "test.bin", fileSize: 100, totalChunks: 1, chunkSize: 100 };
  receiver2.state = RECEIVER_STATE.RECEIVING;
  receiver2.receivedBytes = 150; // Excessive
  receiver2.receivedChunks = 1;
  const validHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  await receiver2._processMessage({ data: JSON.stringify({ type: "COMPLETE", checksum: validHash }) });
  assert.ok(error2);
  assert.match(error2.message, /Transfer excessive: received 150 of 100 bytes/);

  // 3. Rejects COMPLETE with excessive chunks
  let error3 = null;
  const receiver3 = new P2PFileReceiver(socket, "host1", {
    onError: (err) => { error3 = err; },
  });
  receiver3.metadata = { fileName: "test.bin", fileSize: 100, totalChunks: 1, chunkSize: 100 };
  receiver3.state = RECEIVER_STATE.RECEIVING;
  receiver3.receivedBytes = 100;
  receiver3.receivedChunks = 2; // Excessive (expected 1)

  await receiver3._processMessage({ data: JSON.stringify({ type: "COMPLETE", checksum: validHash }) });
  assert.ok(error3);
  assert.match(error3.message, /Transfer excessive: received 2 of 1 chunks/);
});

test("P2PFileSender: validates ACK counters, checksum aliases, and enforces consistency with actual sent data", () => {
  const socket = createMockSocket();
  const file = { size: 100, name: "file.bin" };
  const validHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const otherHash = "1111111111111111111111111111111111111111111111111111111111111111";

  // Rejects invalid limits in sender constructor
  assert.throws(
    () => new P2PFileSender(socket, "p1", file, { limits: { bufferLowWatermark: 5000, bufferHighWatermark: 2000 } }),
    /bufferLowWatermark must be strictly less than bufferHighWatermark/
  );

  const sender = new P2PFileSender(socket, "p1", file);
  sender.state = SENDER_STATE.AWAITING_ACK;
  sender._expectedChecksum = validHash;
  sender.sentBytes = 100;
  sender.sentChunks = 2;
  sender.totalChunks = 2;

  let rejectedErr = null;
  function testAckRejection(payload, regex) {
    rejectedErr = null;
    sender.state = SENDER_STATE.AWAITING_ACK;
    sender._ackRejecter = (err) => { rejectedErr = err; };
    sender._onMessage({ data: JSON.stringify(payload) });
    assert.ok(rejectedErr, `Expected rejection for: ${JSON.stringify(payload)}`);
    assert.match(rejectedErr.message, regex);
  }

  // 1. Rejects ACK with non-string checksum (e.g. number) without throwing unhandled TypeError
  testAckRejection(
    { type: "ACK", verified: true, checksum: 12345 },
    /must be a 64-character hex SHA-256 string/
  );

  // 2. Rejects ACK with conflicting checksum aliases across checksum and verifiedChecksum
  testAckRejection(
    { type: "ACK", verified: true, checksum: validHash, verifiedChecksum: otherHash },
    /conflicting checksum/
  );

  // 3. Rejects ACK with conflicting counter aliases (bytesReceived vs receivedBytes)
  testAckRejection(
    { type: "ACK", verified: true, checksum: validHash, bytesReceived: 100, receivedBytes: 50 },
    /conflicting bytesReceived/
  );

  // 4. Rejects ACK with inconsistent bytes (e.g. less than sentBytes / file.size)
  testAckRejection(
    { type: "ACK", verified: true, checksum: validHash, bytesReceived: 50 },
    /ACK bytesReceived \(50\) is invalid or disagrees with transmitted bytes/
  );

  // 5. Rejects ACK with invalid/negative byte count
  testAckRejection(
    { type: "ACK", verified: true, checksum: validHash, bytesReceived: -1 },
    /ACK bytesReceived \(-1\) is invalid/
  );

  // 6. Rejects ACK with inconsistent chunk count
  testAckRejection(
    { type: "ACK", verified: true, checksum: validHash, bytesReceived: 100, chunksReceived: 1 },
    /ACK chunksReceived \(1\) is invalid or disagrees with transmitted chunks/
  );

  // 7. Accepts valid ACK with matching counters and checksum
  let resolvedMsg = null;
  sender.state = SENDER_STATE.AWAITING_ACK;
  sender._ackResolver = (msg) => { resolvedMsg = msg; };
  sender._onMessage({
    data: JSON.stringify({
      type: "ACK",
      ackType: "FINAL",
      status: "SUCCESS",
      verified: true,
      checksum: validHash,
      bytesReceived: 100,
      chunksReceived: 2,
    }),
  });
  assert.ok(resolvedMsg);
  assert.strictEqual(sender.state, SENDER_STATE.COMPLETED);
});

test("StreamingSHA256: verifies lifecycle, input types, repeated digest caching, and update-after-finalize error", () => {
  // 1. Empty input variants match trusted crypto SHA-256
  const emptyExpected = crypto.createHash("sha256").digest("hex");
  assert.strictEqual(new StreamingSHA256().digest(), emptyExpected);
  assert.strictEqual(new StreamingSHA256().update("").digest(), emptyExpected);
  assert.strictEqual(new StreamingSHA256().update(new Uint8Array(0)).digest(), emptyExpected);
  assert.strictEqual(new StreamingSHA256().update(new ArrayBuffer(0)).digest(), emptyExpected);

  // 2. Input types support: string, Uint8Array, Buffer, ArrayBuffer, and TypedArray/DataView views
  const rawString = "Loseless P2P Fast Transfer Verification Payload";
  const expectedTextHash = crypto.createHash("sha256").update(rawString).digest("hex");

  // String input
  const hString = new StreamingSHA256();
  hString.update(rawString);
  assert.strictEqual(hString.digest(), expectedTextHash);

  // Uint8Array input
  const hUint8 = new StreamingSHA256();
  hUint8.update(new TextEncoder().encode(rawString));
  assert.strictEqual(hUint8.digest(), expectedTextHash);

  // Buffer input
  const hBuf = new StreamingSHA256();
  hBuf.update(Buffer.from(rawString));
  assert.strictEqual(hBuf.digest(), expectedTextHash);

  // ArrayBuffer input
  const hArrayBuf = new StreamingSHA256();
  const rawBuf = Buffer.from(rawString);
  const ab = rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength);
  hArrayBuf.update(ab);
  assert.strictEqual(hArrayBuf.digest(), expectedTextHash);

  // Int8Array view input with offset
  const hView = new StreamingSHA256();
  const paddedBuffer = new ArrayBuffer(rawBuf.length + 8);
  const int8View = new Int8Array(paddedBuffer, 4, rawBuf.length);
  int8View.set(new Int8Array(ab));
  hView.update(int8View);
  assert.strictEqual(hView.digest(), expectedTextHash);

  // DataView input
  const hDataView = new StreamingSHA256();
  const dv = new DataView(paddedBuffer, 4, rawBuf.length);
  hDataView.update(dv);
  assert.strictEqual(hDataView.digest(), expectedTextHash);

  // Method chaining
  const hChain = new StreamingSHA256();
  const chainResult = hChain.update("part1").update("part2").digest();
  assert.strictEqual(chainResult, crypto.createHash("sha256").update("part1part2").digest("hex"));

  // 3. Repeated digest calls return the identical cached digest
  const hRepeat = new StreamingSHA256();
  hRepeat.update("idempotency check");
  const d1 = hRepeat.digest();
  assert.strictEqual(hRepeat.isFinalized, true);
  const d2 = hRepeat.digest();
  const d3 = hRepeat.digest();
  assert.strictEqual(d1, d2);
  assert.strictEqual(d2, d3);
  assert.strictEqual(d1, crypto.createHash("sha256").update("idempotency check").digest("hex"));

  // 4. Update after finalization throws an Error
  assert.throws(
    () => hRepeat.update("more data"),
    /StreamingSHA256 already finalized: cannot update after digest\(\)/
  );

  // 5. Invalid input types throw TypeError without corrupting or allocating
  const hTypes = new StreamingSHA256();
  assert.throws(() => hTypes.update(null), /data must be a Uint8Array, Buffer, ArrayBuffer, ArrayBufferView, or string/);
  assert.throws(() => hTypes.update(undefined), /data must be a Uint8Array, Buffer, ArrayBuffer, ArrayBufferView, or string/);
  assert.throws(() => hTypes.update(12345), /data must be a Uint8Array, Buffer, ArrayBuffer, ArrayBufferView, or string/);
  assert.throws(() => hTypes.update(true), /data must be a Uint8Array, Buffer, ArrayBuffer, ArrayBufferView, or string/);
  assert.throws(() => hTypes.update({}), /data must be a Uint8Array, Buffer, ArrayBuffer, ArrayBufferView, or string/);
  assert.throws(() => hTypes.update([1, 2, 3]), /data must be a Uint8Array, Buffer, ArrayBuffer, ArrayBufferView, or string/);

  // 6. reset() clears finalization and allows clean reuse of scratch buffers
  hRepeat.reset();
  assert.strictEqual(hRepeat.isFinalized, false);
  hRepeat.update("reused instance");
  assert.strictEqual(hRepeat.digest(), crypto.createHash("sha256").update("reused instance").digest("hex"));
});



