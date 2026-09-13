import React, { useRef, useEffect } from "react";
import { FileVideo, FileVideo2 } from "lucide-react";
import { registerBlobTitle } from "../hooks/useMediaTitle.js";

// Button to pick a local video file. A blob URL is created locally and broadcast
// as a source change. The icon flips to a "video loaded" variant while a local
// file is the active source.
export function PickFileButton({ emitChangeSource, hasLoadedFile }) {
  const fileInputRef = useRef(null);
  const objectUrlRef = useRef(null);

  // Release any object URL created from a locally picked file on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  const handleFilePicked = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // A blob URL lives until the page closes; revoke the previous one to avoid leaks
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    registerBlobTitle(objectUrl, file.name);
    emitChangeSource(objectUrl);

    // Reset the input so picking the same file again still fires change events
    e.target.value = "";
  };

  const Icon = hasLoadedFile ? FileVideo2 : FileVideo;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFilePicked}
      />
      <button
        type="button"
        aria-label="Pick file"
        onClick={() => fileInputRef.current?.click()}
        className="bg-accent hover:bg-accent-deep text-on-accent text-sm font-bold px-5 py-2.5 flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
      >
        <Icon className="w-3.5 h-3.5" />
        <span>Pick file</span>
      </button>
    </>
  );
}