import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Info, ArrowRight, Check } from "lucide-react";
import { MODES_CONFIG, getModeConfig } from "../../constants/modes.js";

/**
 * Dropdown popover for selecting watch modes.
 * Displays clean SVG icons, active badges, and direct triggers to the Modes Guide.
 */
export function ModesPopover({
  activeMode = "url",
  onSelectMode,
  onOpenGuideModal,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Close dropdown on click outside with capture-phase handling
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const currentMode = getModeConfig(activeMode);
  const CurrentIcon = currentMode.icon;

  const handleModePick = (modeId) => {
    if (modeId === activeMode) {
      setIsOpen(false);
      return;
    }
    if (typeof onSelectMode === "function") {
      onSelectMode(modeId);
    }
    setIsOpen(false);
  };

  const handleInfoClick = (e, modeId) => {
    e.stopPropagation();
    if (typeof onOpenGuideModal === "function") {
      onOpenGuideModal(modeId);
    }
    setIsOpen(false);
  };

  return (
    <>
      {/* Transparent backdrop overlay to reliably catch clicks over video player/canvas */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      <div ref={containerRef} className="relative inline-block text-left shrink-0 z-40">
        {/* Trigger Button: [ Modes ▾ ] */}
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={isOpen}
          aria-label="Select watch mode"
          onClick={() => setIsOpen((prev) => !prev)}
          className="bg-surface-raise hover:bg-surface border border-ink/15 text-ink text-xs sm:text-sm font-semibold px-2.5 sm:px-3 py-1.5 rounded-lg flex items-center gap-1.5 sm:gap-2 transition-colors cursor-pointer shadow-sm select-none"
        >
          <CurrentIcon className="w-3.5 h-3.5 text-ink-muted" />
          <span className="hidden sm:inline font-medium text-ink-muted">Mode:</span>
          <span className="font-semibold">{currentMode.shortName}</span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-ink-muted transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {/* Popover Dropdown Panel */}
        {isOpen && (
          <div
            role="menu"
            aria-orientation="vertical"
            className="absolute right-0 mt-2 w-72 sm:w-80 rounded-xl bg-surface-raise border border-ink/15 shadow-xl py-2 z-40 focus:outline-none animate-in fade-in zoom-in-95 duration-100"
          >
            {/* Header */}
            <div className="px-3.5 py-1.5 border-b border-ink/10 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                Choose Watch Mode
              </span>
            </div>

            {/* Mode Option Cards */}
            <div className="p-1.5 space-y-1">
              {MODES_CONFIG.map((mode) => {
                const Icon = mode.icon;
                const isSelected = mode.id === activeMode;
                const isUpcoming = mode.status === "upcoming";

                return (
                  <div
                    key={mode.id}
                    role="menuitem"
                    onClick={() => !isUpcoming && handleModePick(mode.id)}
                    className={`group relative p-2.5 rounded-lg border transition-all flex items-start gap-2.5 ${
                      isUpcoming
                        ? "opacity-60 cursor-not-allowed border-transparent bg-surface/30"
                        : isSelected
                        ? "bg-surface border-ink/20 cursor-default"
                        : "border-transparent hover:bg-surface/70 hover:border-ink/10 cursor-pointer"
                    }`}
                  >
                    <div
                      className={`p-1.5 rounded-md shrink-0 mt-0.5 ${
                        isSelected
                          ? "bg-ink/10 text-ink"
                          : "bg-ink/5 text-ink-muted group-hover:text-ink"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>

                    <div className="flex-1 min-w-0 pr-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-ink truncate">
                          {mode.title}
                        </span>
                        {isSelected ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 inline-flex items-center gap-1">
                            <Check className="w-2.5 h-2.5" />
                            Active
                          </span>
                        ) : isUpcoming ? (
                          <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-ink/10 text-ink-muted">
                            Coming Soon
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-ink-muted leading-tight mt-0.5 truncate">
                        {mode.tagline}
                      </p>
                    </div>

                    {/* Mode Info Button (i) */}
                    <button
                      type="button"
                      aria-label={`View details for ${mode.title}`}
                      title="View mode details & bandwidth"
                      onClick={(e) => handleInfoClick(e, mode.id)}
                      className="p-1 rounded-md text-ink-muted hover:text-ink hover:bg-ink/10 transition-colors cursor-pointer shrink-0 mt-0.5"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Footer compare guide link */}
            <div className="px-3 pt-2 pb-1 border-t border-ink/10 mt-1">
              <button
                type="button"
                onClick={(e) => handleInfoClick(e, activeMode)}
                className="w-full py-1.5 px-2 rounded-lg text-xs font-medium text-ink-muted hover:text-ink hover:bg-surface flex items-center justify-between transition-colors cursor-pointer"
              >
                <span>Compare modes</span>
                <ArrowRight className="w-3 h-3 text-ink-muted" />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
