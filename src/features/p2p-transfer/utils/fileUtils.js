/**
 * P2P WebRTC File & Cryptographic Utilities
 *
 * Implements pure-JS streaming SHA-256 (FIPS 180-4) with pre-allocated scratch
 * buffers to eliminate garbage-collection pauses on multi-gigabyte transfers,
 * and standard file formatting utilities.
 */

export class StreamingSHA256 {
  constructor() {
    this.block = new Uint8Array(64);
    this.w = new Int32Array(64);
    this.reset();
  }

  /**
   * Resets the internal hasher state to initial values, allowing reuse
   * of pre-allocated scratch buffers.
   *
   * @returns {StreamingSHA256} this instance
   */
  reset() {
    this.h0 = 0x6a09e667;
    this.h1 = 0xbb67ae85;
    this.h2 = 0x3c6ef372;
    this.h3 = 0xa54ff53a;
    this.h4 = 0x510e527f;
    this.h5 = 0x9b05688c;
    this.h6 = 0x1f83d9ab;
    this.h7 = 0x5be0cd19;

    this.block.fill(0);
    this.blockLen = 0;
    this.totalBytes = 0;
    this.w.fill(0);
    this._finalized = false;
    this._digest = null;
    return this;
  }

  /**
   * Indicates whether digest() has been called and the hash is finalized.
   *
   * @returns {boolean}
   */
  get isFinalized() {
    return this._finalized;
  }

  /**
   * Updates the hash stream with additional data chunks.
   * Accepts Uint8Array, Buffer, ArrayBuffer, TypedArrays / DataView, or string.
   *
   * @param {Uint8Array|Buffer|ArrayBuffer|ArrayBufferView|string} data - Input payload
   * @returns {StreamingSHA256} this instance for chaining
   * @throws {Error} If called after digest() has finalized the state
   * @throws {TypeError} If data is not a recognized typed array, buffer, or string
   */
  update(data) {
    if (this._finalized) {
      throw new Error("StreamingSHA256 already finalized: cannot update after digest()");
    }

    let bytes;
    if (data instanceof Uint8Array) {
      bytes = data;
    } else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (typeof data === "string") {
      bytes = new TextEncoder().encode(data);
    } else {
      throw new TypeError(
        "StreamingSHA256.update: data must be a Uint8Array, Buffer, ArrayBuffer, ArrayBufferView, or string"
      );
    }

    let offset = 0;
    const len = bytes.length;
    this.totalBytes += len;

    while (offset < len) {
      const toCopy = Math.min(len - offset, 64 - this.blockLen);
      this.block.set(bytes.subarray(offset, offset + toCopy), this.blockLen);
      this.blockLen += toCopy;
      offset += toCopy;

      if (this.blockLen === 64) {
        this._processBlock(this.block, 0);
        this.blockLen = 0;
      }
    }

    return this;
  }

  _processBlock(b, pos) {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const idx = pos + (i << 2);
      w[i] = (b[idx] << 24) | (b[idx + 1] << 16) | (b[idx + 2] << 8) | b[idx + 3];
    }
    for (let i = 16; i < 64; i++) {
      const v0 = w[i - 15];
      const s0 = ((v0 >>> 7) | (v0 << 25)) ^ ((v0 >>> 18) | (v0 << 14)) ^ (v0 >>> 3);
      const v1 = w[i - 2];
      const s1 = ((v1 >>> 17) | (v1 << 15)) ^ ((v1 >>> 19) | (v1 << 13)) ^ (v1 >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = this.h0, b0 = this.h1, c = this.h2, d = this.h3;
    let e = this.h4, f = this.h5, g = this.h6, h = this.h7;

    const K = StreamingSHA256.K;
    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[i] + w[i]) | 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b0) ^ (a & c) ^ (b0 & c);
      const temp2 = (s0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b0;
      b0 = a;
      a = (temp1 + temp2) | 0;
    }

    this.h0 = (this.h0 + a) | 0;
    this.h1 = (this.h1 + b0) | 0;
    this.h2 = (this.h2 + c) | 0;
    this.h3 = (this.h3 + d) | 0;
    this.h4 = (this.h4 + e) | 0;
    this.h5 = (this.h5 + f) | 0;
    this.h6 = (this.h6 + g) | 0;
    this.h7 = (this.h7 + h) | 0;
  }

  /**
   * Finalizes the SHA-256 computation and returns the hex-encoded digest string.
   * Repeated calls return the identical cached digest.
   *
   * @returns {string} 64-character lowercase hexadecimal SHA-256 digest
   */
  digest() {
    if (this._digest !== null) {
      return this._digest;
    }

    const totalBits = BigInt(this.totalBytes) * 8n;
    this.block[this.blockLen++] = 0x80;

    if (this.blockLen > 56) {
      this.block.fill(0, this.blockLen, 64);
      this._processBlock(this.block, 0);
      this.blockLen = 0;
    }

    this.block.fill(0, this.blockLen, 56);
    const view = new DataView(this.block.buffer, this.block.byteOffset, 64);
    view.setBigUint64(56, totalBits, false);
    this._processBlock(this.block, 0);

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    outView.setInt32(0, this.h0, false);
    outView.setInt32(4, this.h1, false);
    outView.setInt32(8, this.h2, false);
    outView.setInt32(12, this.h3, false);
    outView.setInt32(16, this.h4, false);
    outView.setInt32(20, this.h5, false);
    outView.setInt32(24, this.h6, false);
    outView.setInt32(28, this.h7, false);

    this._digest = Array.from(out).map((b) => b.toString(16).padStart(2, "0")).join("");
    this._finalized = true;
    return this._digest;
  }
}

StreamingSHA256.K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * Formats bytes to human-readable string.
 */
export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
