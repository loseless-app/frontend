import React from "react";
import { MonitorPlay, LogOut, Play } from "lucide-react";

// Modal displayed when this tab is displaced by another tab opening the same room session
export function DisplacedSessionModal({ onUseHere, onLeave }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="displaced-modal-title"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
    >
      <div className="bg-surface-raise border border-ink/15 p-8 shadow-2xl max-w-sm w-full text-center space-y-5">
        <div className="w-12 h-12 mx-auto bg-ink/5 border border-ink/10 text-ink flex items-center justify-center">
          <MonitorPlay className="w-6 h-6" />
        </div>

        <div className="space-y-1.5">
          <h2 id="displaced-modal-title" className="text-lg font-bold text-ink tracking-tight">
            Playing in another tab
          </h2>
          <p className="text-xs text-ink-muted leading-relaxed px-1">
            Playback is active in another tab or window. To take control and watch here instead, click below.
          </p>
        </div>

        <div className="flex gap-3 justify-center pt-2">
          <button
            type="button"
            onClick={onLeave}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-ink-muted hover:text-ink border border-ink/20 hover:bg-ink/5 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Leave</span>
          </button>
          <button
            type="button"
            onClick={onUseHere}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold bg-accent hover:bg-accent-deep text-on-accent transition-colors cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Play Here</span>
          </button>
        </div>
      </div>
    </div>
  );
}
