import React from "react";
import { VyncLogo } from "../VyncLogo.jsx";
import { DynamicSourceBar } from "./DynamicSourceBar.jsx";
import { ModesPopover } from "./ModesPopover.jsx";
import { ShareFileButton } from "./ShareFileButton.jsx";

/**
 * Top bar header consolidating Logo, polymorphic DynamicSourceBar,
 * dedicated file-sharing trigger, and Modes popover.
 */
export function TopBar({
  activeMode = "url",
  onSelectMode,
  currentUrl,
  onSelectUrl,
  loadedFile,
  loadedMetadata,
  onFileSelected,
  onClearFile,
  onShareFile,
  activeUploadsCount = 0,
  hasActiveOffer = false,
  onStartStream,
  onOpenGuideModal,
}) {
  return (
    <header className="flex items-center gap-2 sm:gap-3 w-full shrink-0 select-none">
      {/* Brand Logo */}
      <div className="shrink-0">
        <VyncLogo />
      </div>

      {/* Polymorphic Dynamic Input Bar */}
      <div className="flex-1 min-w-0">
        <DynamicSourceBar
          activeMode={activeMode}
          currentUrl={currentUrl}
          onSelectUrl={onSelectUrl}
          loadedFile={loadedFile}
          loadedMetadata={loadedMetadata}
          onFileSelected={onFileSelected}
          onClearFile={onClearFile}
          onStartStream={onStartStream}
          onOpenGuideModal={onOpenGuideModal}
        />
      </div>

      {/* Dedicated File Share Button */}
      <ShareFileButton
        onFilePicked={onShareFile}
        activeUploadsCount={activeUploadsCount}
        hasActiveOffer={hasActiveOffer}
      />

      {/* Watch Modes Selector Popover */}
      <ModesPopover
        activeMode={activeMode}
        onSelectMode={onSelectMode}
        onOpenGuideModal={onOpenGuideModal}
      />
    </header>
  );
}
