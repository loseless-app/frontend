import React, { useRef } from "react";
import { FileVideo, FileVideo2 } from "lucide-react";

// Button to pick a local video file.
// When a file is chosen, onFileSelected is invoked to mount the file locally
// and broadcast its metadata to the room.
export function PickFileButton({ onFileSelected, emitChangeSource, hasLoadedFile }) {
  const fileInputRef = useRef(null);

  const handleFilePicked = (e) => {
    e.stopPropagation();
    const file = e.target.files?.[0];
    if (!file) return;

    if (typeof onFileSelected === "function") {
      onFileSelected(file);
    } else if (emitChangeSource) {
      // Direct fallback if onFileSelected is not provided
      emitChangeSource({
        mediaType: "file",
        mediaMetadata: {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || "video/mp4",
        },
      });
    }

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
        onClick={(e) => {
          e.stopPropagation();
          fileInputRef.current?.click();
        }}
        className="bg-accent hover:bg-accent-deep text-on-accent text-xs sm:text-sm font-semibold px-3.5 sm:px-4 py-1.5 flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
      >
        <Icon className="w-3.5 h-3.5" />
        <span>Pick file</span>
      </button>
    </>
  );
}