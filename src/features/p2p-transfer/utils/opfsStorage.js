/**
 * Utilities for Origin Private File System (OPFS) sandboxed disk management.
 */

/**
 * Standardize suggested file names to avoid invalid OS characters and ensure proper extensions.
 */
export function sanitizeSuggestedName(fileName) {
  if (!fileName || typeof fileName !== "string") return "video.mp4";
  let baseName = fileName.replace(/^.*[\\/]/, "");
  // Remove characters forbidden in native file dialogs: / \ ? % * : | " < >
  baseName = baseName.replace(/[/\\?%*:|"<>]/g, "_").trim();
  // Remove trailing dots or spaces which trigger OS save errors
  baseName = baseName.replace(/[. ]+$/, "");
  if (!baseName) return "video.mp4";
  if (!baseName.includes(".")) baseName += ".mp4";
  return baseName;
}

/**
 * Sweep and delete all temporary files stored in OPFS to prevent residual disk consumption.
 */
export async function cleanupAllOPFSFiles() {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== "function"
  ) {
    return;
  }

  try {
    const root = await navigator.storage.getDirectory();
    if (!root) return;

    // Support modern FileSystemDirectoryHandle iteration modes across Chromium, Firefox, and Safari
    if (typeof root.entries === "function") {
      for await (const [name, handle] of root.entries()) {
        if (handle && handle.kind === "file") {
          try {
            await root.removeEntry(name);
            console.log("[OPFS] Deleted temporary storage file:", name);
          } catch (removeErr) {
            console.warn("[OPFS] Could not remove entry:", name, removeErr);
          }
        }
      }
    } else if (typeof root[Symbol.asyncIterator] === "function") {
      for await (const [name, handle] of root) {
        if (handle && handle.kind === "file") {
          try {
            await root.removeEntry(name);
            console.log("[OPFS] Deleted temporary storage file:", name);
          } catch (removeErr) {
            console.warn("[OPFS] Could not remove entry:", name, removeErr);
          }
        }
      }
    } else if (typeof root.values === "function") {
      for await (const handle of root.values()) {
        if (handle && handle.kind === "file" && handle.name) {
          try {
            await root.removeEntry(handle.name);
            console.log("[OPFS] Deleted temporary storage file:", handle.name);
          } catch (removeErr) {
            console.warn("[OPFS] Could not remove entry:", handle.name, removeErr);
          }
        }
      }
    }
  } catch (err) {
    console.warn("[OPFS] Storage cleanup warning:", err);
  }
}

/**
 * Clean up a specific file by name from OPFS storage.
 */
export async function cleanupOPFSFile(fileName) {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return;
  if (!fileName) {
    return cleanupAllOPFSFiles();
  }

  try {
    const root = await navigator.storage.getDirectory();
    if (!root) return;

    const cleanName = sanitizeSuggestedName(fileName);

    // 1. Attempt exact removal of raw and sanitized filenames
    try {
      await root.removeEntry(fileName);
      console.log("[OPFS] Removed temporary file:", fileName);
      return;
    } catch {}

    if (cleanName && cleanName !== fileName) {
      try {
        await root.removeEntry(cleanName);
        console.log("[OPFS] Removed temporary file:", cleanName);
        return;
      } catch {}
    }

    // 2. Iterate directory to delete matching entry if raw or sanitized direct lookup missed
    const baseWithoutExt = cleanName.replace(/\.[^/.]+$/, "").toLowerCase();
    const cleanLower = cleanName.toLowerCase();
    const rawLower = String(fileName).toLowerCase();

    if (typeof root.entries === "function") {
      for await (const [name, handle] of root.entries()) {
        if (handle && handle.kind === "file") {
          const entryLower = name.toLowerCase();
          if (
            entryLower === cleanLower ||
            entryLower === rawLower ||
            entryLower.startsWith(baseWithoutExt)
          ) {
            try {
              await root.removeEntry(name);
              console.log("[OPFS] Removed matching temporary file:", name);
            } catch {}
          }
        }
      }
    }
  } catch (err) {
    // If file is already gone, ignore
  }
}

/**
 * Find an existing completed video file in OPFS by name and optional size check.
 */
export async function findOPFSFile(fileName, expectedSize = null) {
  if (
    !fileName ||
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== "function"
  ) {
    return null;
  }

  try {
    const root = await navigator.storage.getDirectory();
    if (!root) return null;

    const cleanName = sanitizeSuggestedName(fileName);
    const candidateNames = [cleanName, fileName];

    // 1. Try direct getFileHandle with candidate names
    for (const name of candidateNames) {
      try {
        const handle = await root.getFileHandle(name);
        if (handle) {
          const file = await handle.getFile();
          if (file) {
            if (
              !expectedSize ||
              Math.abs(file.size - expectedSize) <= 1024 ||
              file.size === expectedSize
            ) {
              return file;
            }
          }
        }
      } catch {}
    }

    // 2. Iterate directory to locate matching entry if exact name lookup differed
    const cleanLower = cleanName.toLowerCase();
    const rawLower = String(fileName).toLowerCase();
    const baseWithoutExt = cleanName.replace(/\.[^/.]+$/, "").toLowerCase();

    const checkHandle = async (handle, name) => {
      if (handle && handle.kind === "file") {
        const entryLower = (name || handle.name || "").toLowerCase();
        if (
          entryLower === cleanLower ||
          entryLower === rawLower ||
          entryLower.startsWith(baseWithoutExt)
        ) {
          try {
            const file = await handle.getFile();
            if (
              file &&
              (!expectedSize ||
                Math.abs(file.size - expectedSize) <= 1024 ||
                file.size === expectedSize)
            ) {
              return file;
            }
          } catch {}
        }
      }
      return null;
    };

    if (typeof root.entries === "function") {
      for await (const [name, handle] of root.entries()) {
        const found = await checkHandle(handle, name);
        if (found) return found;
      }
    } else if (typeof root[Symbol.asyncIterator] === "function") {
      for await (const [name, handle] of root) {
        const found = await checkHandle(handle, name);
        if (found) return found;
      }
    } else if (typeof root.values === "function") {
      for await (const handle of root.values()) {
        const found = await checkHandle(handle, handle?.name);
        if (found) return found;
      }
    }
  } catch (err) {
    console.warn("[OPFS] findOPFSFile error:", err);
  }

  return null;
}

/**
 * Inspect all files currently in OPFS (useful for debugging and testing).
 */
export async function listOPFSFiles() {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== "function"
  ) {
    return [];
  }
  try {
    const root = await navigator.storage.getDirectory();
    const files = [];
    if (typeof root.entries === "function") {
      for await (const [name, handle] of root.entries()) {
        if (handle && handle.kind === "file") {
          try {
            const f = await handle.getFile();
            files.push({ name, sizeBytes: f.size, size: `${(f.size / (1024 * 1024)).toFixed(2)} MB` });
          } catch {
            files.push({ name, sizeBytes: null, size: "unknown" });
          }
        }
      }
    }
    return files;
  } catch {
    return [];
  }
}

// Expose helper on window for easy developer verification in browser DevTools console
if (typeof window !== "undefined") {
  window.checkOPFS = async () => {
    const files = await listOPFSFiles();
    console.log(`[OPFS Check] Files in temporary storage: ${files.length}`);
    if (files.length > 0) {
      console.table(files);
    } else {
      console.log("%c✅ OPFS is completely clean (0 files).", "color: #10b981; font-weight: bold;");
    }
    return files;
  };
}
