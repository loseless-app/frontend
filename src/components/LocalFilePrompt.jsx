import React, { useRef, useState } from "react";
import { FileVideo, UploadCloud, AlertCircle } from "lucide-react";

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "Unknown size";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function LocalFilePrompt({ mediaMetadata, onSelectFile }) {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);

  const expectedName = mediaMetadata?.fileName || "Unknown video file";
  const expectedSize = formatBytes(mediaMetadata?.fileSize);

  const handleFile = (file) => {
    if (!file) return;

    // Check if filename or size differs from host's file
    const nameDiffers = mediaMetadata?.fileName && file.name !== mediaMetadata.fileName;
    const sizeDiffers = mediaMetadata?.fileSize && Math.abs(file.size - mediaMetadata.fileSize) > 1024 * 1024; // > 1MB diff

    if (nameDiffers || sizeDiffers) {
      // Prompt confirmation before mounting
      setPendingFile(file);
    } else {
      // Exact or matching file -> load directly
      onSelectFile(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  };

  const handleInputChange = (e) => {
    const file = e.target.files?.[0];
    handleFile(file);
    e.target.value = "";
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative w-full h-full min-h-[320px] bg-surface-raise/95 text-ink flex flex-col items-center justify-center p-6 border-2 border-dashed transition-all ${
        isDragging
          ? "border-accent bg-accent/10 scale-[0.99]"
          : "border-ink/20 hover:border-ink/40"
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleInputChange}
      />

      {pendingFile ? (
        // Confirmation dialog when selected file differs from room metadata
        <div className="max-w-md w-full bg-surface border border-ink/15 p-5 shadow-2xl space-y-4 text-center">
          <div className="w-10 h-10 mx-auto rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center">
            <AlertCircle className="w-5 h-5" />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-bold text-ink">File Details Differ</h3>
            <p className="text-xs text-ink-muted">
              Your selected file doesn't perfectly match the room video, but you can still synchronize if it is the same video.
            </p>
          </div>

          <div className="text-xs text-left bg-ink/5 p-3 rounded space-y-1 font-mono">
            <div>
              <span className="text-ink-muted">Room video: </span>
              <span className="text-ink font-semibold">{expectedName}</span> ({expectedSize})
            </div>
            <div>
              <span className="text-ink-muted">Your file: </span>
              <span className="text-ink font-semibold">{pendingFile.name}</span> ({formatBytes(pendingFile.size)})
            </div>
          </div>

          <div className="flex gap-2 justify-center pt-1">
            <button
              type="button"
              onClick={() => setPendingFile(null)}
              className="px-4 py-2 text-xs font-semibold text-ink-muted hover:text-ink border border-ink/20 hover:bg-ink/5 transition-colors cursor-pointer"
            >
              Choose different file
            </button>
            <button
              type="button"
              onClick={() => {
                onSelectFile(pendingFile);
                setPendingFile(null);
              }}
              className="px-4 py-2 text-xs font-bold bg-accent hover:bg-accent-deep text-on-accent transition-colors cursor-pointer"
            >
              Sync anyway
            </button>
          </div>
        </div>
      ) : (
        // Standard prompt asking user to select their local video file
        <div className="max-w-lg w-full flex flex-col items-center text-center space-y-4 px-4">
          <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shadow-sm">
            <FileVideo className="w-8 h-8" />
          </div>

          <div className="space-y-2.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/15 text-accent-deep border border-accent/25 text-xs font-bold uppercase tracking-wider">
              Lossless Local File Sync
            </div>

            <h3 className="text-lg sm:text-xl font-bold text-ink tracking-tight break-all">
              {expectedName}
            </h3>

            <p className="text-sm sm:text-base text-ink font-medium max-w-md mx-auto leading-relaxed">
              This room is playing this video. Select your local copy to watch in sync with your friends.
            </p>

            <div className="text-xs font-semibold text-ink-muted">
              Expected size: <span className="text-ink font-bold">{expectedSize}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-accent hover:bg-accent-deep text-on-accent text-sm sm:text-base font-bold shadow-md transition-all cursor-pointer hover:scale-105 active:scale-95"
          >
            <UploadCloud className="w-5 h-5" />
            <span>Select Local File</span>
          </button>

          <p className="text-xs text-ink-muted">
            or drag & drop your video file anywhere in this box
          </p>
        </div>
      )}
    </div>
  );
}
