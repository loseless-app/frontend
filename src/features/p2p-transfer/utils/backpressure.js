/**
 * P2P WebRTC Backpressure Flow Controller
 *
 * Prevents memory exhaustion by regulating data channel transmission rate
 * according to the underlying SCTP buffer depth. Eliminates race conditions
 * where `bufferedamountlow` events can be missed.
 */

import { BUFFER_HIGH_WATERMARK, BUFFER_LOW_WATERMARK } from "../protocol/messages.js";

/**
 * Awaits data channel buffer drainage when `bufferedAmount` reaches or exceeds the high watermark.
 * Resumes once the buffer drops below the low watermark or rejects on channel closure / timeout.
 *
 * @param {RTCDataChannel} dataChannel
 * @param {object} [options]
 * @param {number} [options.highWatermark] - Threshold at which to pause transmission (default 8 MB)
 * @param {number} [options.lowWatermark] - Threshold at which to resume transmission (default 2 MB)
 * @param {number} [options.timeoutMs] - Maximum duration to wait before timing out (default 15s)
 * @param {Function} [options.checkCancelled] - Callback returning true if transfer was cancelled
 * @param {AbortSignal} [options.signal] - Optional abort signal to cancel waiting
 * @returns {Promise<void>}
 */
export function waitForBufferDrain(dataChannel, options = {}) {
  const {
    highWatermark = BUFFER_HIGH_WATERMARK,
    lowWatermark = BUFFER_LOW_WATERMARK,
    timeoutMs = 15000,
    checkCancelled = () => false,
    signal = null,
  } = options;

  // If channel is invalid or not open, return immediately
  if (!dataChannel || dataChannel.readyState !== "open") {
    if (dataChannel && dataChannel.readyState !== "open") {
      return Promise.reject(new Error("Data channel is not open for buffer drain"));
    }
    return Promise.resolve();
  }

  // Fast path: buffer is already within acceptable bounds
  if (dataChannel.bufferedAmount <= highWatermark) {
    return Promise.resolve();
  }

  // Set low watermark threshold on data channel if supported
  try {
    dataChannel.bufferedAmountLowThreshold = lowWatermark;
  } catch {}

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let pollInterval = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (dataChannel) {
        dataChannel.removeEventListener("bufferedamountlow", onLow);
        dataChannel.removeEventListener("close", onClose);
        dataChannel.removeEventListener("error", onError);
      }
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const onLow = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onClose = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Data channel closed while waiting for buffer drain"));
    };

    const onError = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Data channel error during buffer drain: ${err?.message || "Unknown error"}`));
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Buffer drain aborted"));
    };

    if (signal?.aborted) {
      settled = true;
      reject(new Error("Buffer drain aborted"));
      return;
    }

    if (signal) {
      signal.addEventListener("abort", onAbort);
    }

    // Attach event listeners BEFORE checking buffer state to prevent event loss
    dataChannel.addEventListener("bufferedamountlow", onLow);
    dataChannel.addEventListener("close", onClose);
    dataChannel.addEventListener("error", onError);

    // Recheck immediately after registering listeners to resolve any timing race
    if (dataChannel.readyState !== "open") {
      onClose();
      return;
    }
    if (dataChannel.bufferedAmount <= lowWatermark) {
      onLow();
      return;
    }
    if (checkCancelled()) {
      settled = true;
      cleanup();
      reject(new Error("Transfer cancelled"));
      return;
    }

    // Poll periodically (every 100ms) as a safety net in case browser misses the event
    pollInterval = setInterval(() => {
      if (settled) return;
      if (!dataChannel || dataChannel.readyState !== "open") {
        onClose();
        return;
      }
      if (checkCancelled()) {
        settled = true;
        cleanup();
        reject(new Error("Transfer cancelled"));
        return;
      }
      if (dataChannel.bufferedAmount <= lowWatermark) {
        onLow();
      }
    }, 100);

    // Timeout safety
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      if (checkCancelled()) {
        reject(new Error("Transfer cancelled"));
      } else if (dataChannel.bufferedAmount > highWatermark) {
        reject(new Error(`Backpressure buffer drain timed out after ${timeoutMs}ms (stuck at ${dataChannel.bufferedAmount} bytes)`));
      } else {
        resolve();
      }
    }, timeoutMs);
  });
}
