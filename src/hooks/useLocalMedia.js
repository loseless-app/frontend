import { useState, useRef, useEffect, useCallback } from "react";

// Hook to manage local video file selection, object URL creation,
// and automatic cleanup of in-memory blob URLs.
export function useLocalMedia() {
  const [localFile, setLocalFile] = useState(null);
  const [localBlobUrl, setLocalBlobUrl] = useState(null);
  const [fileMetadata, setFileMetadata] = useState(null);
  const currentBlobUrlRef = useRef(null);

  // Clean up any active blob URL on unmount to prevent browser RAM leaks
  useEffect(() => {
    return () => {
      if (currentBlobUrlRef.current) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
        currentBlobUrlRef.current = null;
      }
    };
  }, []);

  // Mounts a local File object, creating a new blob URL and releasing the previous one
  const loadLocalFile = useCallback((file) => {
    if (!file) return null;

    // Release previously allocated blob URL from memory
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }

    const blobUrl = URL.createObjectURL(file);
    currentBlobUrlRef.current = blobUrl;

    const metadata = {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || "video/mp4",
      lastModified: file.lastModified,
    };

    setLocalFile(file);
    setLocalBlobUrl(blobUrl);
    setFileMetadata(metadata);

    return { blobUrl, metadata };
  }, []);

  // Clears the current local file and frees allocated RAM
  const clearLocalFile = useCallback(() => {
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }
    setLocalFile(null);
    setLocalBlobUrl(null);
    setFileMetadata(null);
  }, []);

  return {
    localFile,
    localBlobUrl,
    fileMetadata,
    selectFile: loadLocalFile,
    loadLocalFile,
    clearLocalFile,
  };
}
