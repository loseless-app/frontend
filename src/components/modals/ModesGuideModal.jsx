import React, { useEffect } from "react";
import {
  X,
  Users,
  Wifi,
  HardDrive,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { MODES_CONFIG, getModeConfig } from "../../constants/modes.js";

/**
 * Modes Guide modal dialog explaining Vync watch modes,
 * quality differences, and recommended upload speeds in simple language.
 */
export function ModesGuideModal({
  isOpen,
  onClose,
  activeTab = "url",
  onSelectTab,
  currentAppMode,
  onApplyMode,
}) {
  // Handle ESC key to dismiss modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentConfig = getModeConfig(activeTab);
  const Icon = currentConfig.icon;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modes-guide-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-surface-raise border border-ink/15 shadow-2xl rounded-xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink/10 bg-surface/50">
          <div>
            <h2
              id="modes-guide-title"
              className="text-base sm:text-lg font-bold text-ink tracking-tight flex items-center gap-2"
            >
              <span>Vync Modes Guide</span>
              <span className="text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full bg-ink/10 text-ink-muted">
                Overview
              </span>
            </h2>
            <p className="text-xs text-ink-muted mt-0.5">
              Compare watch modes, video quality, and storage
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-ink-muted hover:text-ink hover:bg-ink/10 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation (Segmented Bar) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 p-2 gap-1.5 bg-surface border-b border-ink/10">
          {MODES_CONFIG.map((mode) => {
            const TabIcon = mode.icon;
            const isSelected = mode.id === activeTab;
            const isCurrentlyInUse = mode.id === currentAppMode;

            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => onSelectTab(mode.id)}
                className={`relative flex items-center justify-center sm:justify-start gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  isSelected
                    ? "bg-surface-raise text-ink shadow-sm border border-ink/15"
                    : "text-ink-muted hover:text-ink hover:bg-surface-raise/50"
                }`}
              >
                <TabIcon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{mode.shortName}</span>
                {isCurrentlyInUse && (
                  <span
                    title="Active in current session"
                    className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 ml-auto hidden sm:inline-block"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Modal Body / Tab Content */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Active Mode Banner */}
          <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-surface/70 border border-ink/10">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-surface-raise border border-ink/15 text-ink shrink-0">
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-ink">
                    {currentConfig.title}
                  </h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-ink/10 text-ink uppercase tracking-wider">
                    {currentConfig.qualityBadge}
                  </span>
                </div>
                <p className="text-xs text-ink-muted mt-1 leading-relaxed">
                  {currentConfig.tagline}
                </p>
              </div>
            </div>

            {currentConfig.id === currentAppMode && (
              <span className="shrink-0 text-[11px] font-semibold text-green-600 dark:text-green-400 bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Active
              </span>
            )}
          </div>

          {/* Quick Specifications Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="p-3 rounded-lg bg-surface/50 border border-ink/10 flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" />
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted block">
                  Video Quality
                </span>
                <span className="text-xs font-semibold text-ink">
                  {currentConfig.quality}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-surface/50 border border-ink/10 flex items-start gap-2.5">
              <Users className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" />
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted block">
                  Room Capacity
                </span>
                <span className="text-xs font-semibold text-ink">
                  {currentConfig.capacity}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-surface/50 border border-ink/10 flex items-start gap-2.5">
              <Wifi className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" />
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted block">
                  Internet Upload Used
                </span>
                <span className="text-xs font-semibold text-ink">
                  {currentConfig.hostBandwidth}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-surface/50 border border-ink/10 flex items-start gap-2.5">
              <HardDrive className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" />
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-ink-muted block">
                  Storage On Devices
                </span>
                <span className="text-xs font-semibold text-ink">
                  {currentConfig.storage}
                </span>
              </div>
            </div>
          </div>

          {/* Bandwidth & Viewer Limits Table (Rendered only for WebRTC stream mode) */}
          {currentConfig.bandwidthTable && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-1.5">
                  <Wifi className="w-3.5 h-3.5 text-ink-muted" />
                  Recommended Host Upload Speed
                </span>
              </div>
              <div className="border border-ink/10 rounded-lg overflow-hidden bg-surface/40">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-ink/10 bg-surface/80 text-ink-muted font-semibold text-[11px]">
                      <th className="py-2 px-3">Viewers</th>
                      <th className="py-2 px-3">Upload Speed</th>
                      <th className="py-2 px-3">Max Resolution</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/10">
                    {currentConfig.bandwidthTable.map((row, idx) => (
                      <tr key={idx} className="hover:bg-surface-raise/40">
                        <td className="py-2.5 px-3 font-semibold text-ink">
                          {row.viewers}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-ink">
                          {row.upload}
                        </td>
                        <td className="py-2.5 px-3 text-ink-muted">
                          {row.resolution}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Use Case & Limitations Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <div className="p-3.5 rounded-lg bg-surface/50 border border-ink/10 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                <span>Best For</span>
              </div>
              <p className="text-xs text-ink-muted leading-relaxed">
                {currentConfig.bestFor}
              </p>
            </div>

            <div className="p-3.5 rounded-lg bg-surface/50 border border-ink/10 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span>Limitation</span>
              </div>
              <p className="text-xs text-ink-muted leading-relaxed">
                {currentConfig.limitations}
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-ink/10 bg-surface/50">
          <span className="text-[11px] text-ink-muted">
            Press <kbd className="px-1.5 py-0.5 rounded bg-ink/10 text-ink font-mono text-[10px]">Esc</kbd> to close
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-ink hover:bg-ink/10 transition-colors cursor-pointer"
            >
              Close
            </button>

            {currentConfig.id !== currentAppMode &&
              currentConfig.status !== "upcoming" &&
              typeof onApplyMode === "function" && (
                <button
                  type="button"
                  onClick={() => {
                    onApplyMode(currentConfig.id);
                    onClose();
                  }}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-accent hover:bg-accent-deep text-on-accent flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                >
                  <span>Select {currentConfig.shortName}</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
