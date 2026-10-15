import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeSuggestedName,
  cleanupAllOPFSFiles,
  cleanupOPFSFile,
  findOPFSFile,
} from "../utils/opfsStorage.js";

test("sanitizeSuggestedName normalizes filenames safely", () => {
  assert.equal(sanitizeSuggestedName("movie.mp4"), "movie.mp4");
  assert.equal(sanitizeSuggestedName("series/season1\\ep1.mkv"), "ep1.mkv");
  assert.equal(sanitizeSuggestedName("forbidden:?%*|\"<>name.webm"), "forbidden________name.webm");
  assert.equal(sanitizeSuggestedName("noextension"), "noextension.mp4");
  assert.equal(sanitizeSuggestedName("trailingdots... "), "trailingdots.mp4");
  assert.equal(sanitizeSuggestedName(""), "video.mp4");
  assert.equal(sanitizeSuggestedName(null), "video.mp4");
});

test("cleanupOPFSFile and cleanupAllOPFSFiles with mock OPFS directory", async () => {
  const deletedEntries = [];
  const entriesMap = new Map([
    ["movie.mp4", { kind: "file", name: "movie.mp4" }],
    ["temp_123.bin", { kind: "file", name: "temp_123.bin" }],
    ["subfolder", { kind: "directory", name: "subfolder" }],
  ]);

  const mockRoot = {
    async removeEntry(name) {
      if (entriesMap.has(name)) {
        deletedEntries.push(name);
        entriesMap.delete(name);
      } else {
        throw new Error("NotFoundError");
      }
    },
    async *entries() {
      for (const [name, handle] of entriesMap.entries()) {
        yield [name, handle];
      }
    },
  };

  const originalStorage = Object.getOwnPropertyDescriptor(globalThis.navigator, "storage");

  Object.defineProperty(globalThis.navigator, "storage", {
    value: {
      getDirectory: async () => mockRoot,
    },
    configurable: true,
  });

  try {
    // Test cleaning up a single file
    await cleanupOPFSFile("movie.mp4");
    assert.ok(deletedEntries.includes("movie.mp4"));
    assert.equal(entriesMap.has("movie.mp4"), false);

    // Test cleaning up all remaining files
    await cleanupAllOPFSFiles();
    assert.ok(deletedEntries.includes("temp_123.bin"));
    assert.equal(entriesMap.has("temp_123.bin"), false);
    // Directories should not be removed
    assert.equal(entriesMap.has("subfolder"), true);
  } finally {
    if (originalStorage) {
      Object.defineProperty(globalThis.navigator, "storage", originalStorage);
    } else {
      delete globalThis.navigator.storage;
    }
  }
});

test("findOPFSFile correctly locates completed file matching name and size", async () => {
  const mockFile = { name: "video.mp4", size: 5000000 };
  const entriesMap = new Map([
    ["video.mp4", {
      kind: "file",
      name: "video.mp4",
      async getFile() { return mockFile; }
    }],
  ]);

  const mockRoot = {
    async getFileHandle(name) {
      if (entriesMap.has(name)) {
        return entriesMap.get(name);
      }
      throw new Error("NotFoundError");
    },
    async *entries() {
      for (const [name, handle] of entriesMap.entries()) {
        yield [name, handle];
      }
    },
  };

  const originalStorage = Object.getOwnPropertyDescriptor(globalThis.navigator, "storage");

  Object.defineProperty(globalThis.navigator, "storage", {
    value: {
      getDirectory: async () => mockRoot,
    },
    configurable: true,
  });

  try {
    // Exact match
    const found = await findOPFSFile("video.mp4", 5000000);
    assert.ok(found);
    assert.equal(found.name, "video.mp4");
    assert.equal(found.size, 5000000);

    // Size mismatch (e.g. incomplete partial download) should return null
    const incomplete = await findOPFSFile("video.mp4", 10000000);
    assert.equal(incomplete, null);

    // Non-existent file should return null
    const nonExistent = await findOPFSFile("other.mp4", 5000000);
    assert.equal(nonExistent, null);
  } finally {
    if (originalStorage) {
      Object.defineProperty(globalThis.navigator, "storage", originalStorage);
    } else {
      delete globalThis.navigator.storage;
    }
  }
});

test("findOPFSFile resolves matching file via values() iterator when getFileHandle throws", async () => {
  const mockFile = { name: "custom-video.mkv", size: 12345 };
  const mockRoot = {
    async getFileHandle() {
      throw new Error("NotFoundError");
    },
    async *values() {
      yield {
        kind: "file",
        name: "custom-video.mkv",
        async getFile() { return mockFile; },
      };
    },
  };

  const originalStorage = Object.getOwnPropertyDescriptor(globalThis.navigator, "storage");
  Object.defineProperty(globalThis.navigator, "storage", {
    value: { getDirectory: async () => mockRoot },
    configurable: true,
  });

  try {
    const found = await findOPFSFile("custom-video.mkv", 12345);
    assert.ok(found);
    assert.equal(found.name, "custom-video.mkv");
    assert.equal(found.size, 12345);
  } finally {
    if (originalStorage) {
      Object.defineProperty(globalThis.navigator, "storage", originalStorage);
    } else {
      delete globalThis.navigator.storage;
    }
  }
});

test("cleanup methods gracefully no-op when navigator.storage is undefined", async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis.navigator, "storage");
  Object.defineProperty(globalThis.navigator, "storage", {
    value: undefined,
    configurable: true,
  });

  try {
    await assert.doesNotReject(async () => {
      await cleanupAllOPFSFiles();
      await cleanupOPFSFile("any.mp4");
      const found = await findOPFSFile("any.mp4");
      assert.equal(found, null);
    });
  } finally {
    if (originalStorage) {
      Object.defineProperty(globalThis.navigator, "storage", originalStorage);
    } else {
      delete globalThis.navigator.storage;
    }
  }
});
