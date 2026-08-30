"use client";

import { Activity, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { OmlxResidentAgent } from "@/lib/omlx/activity";

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const remainingSeconds = safeSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
};

const formatNumber = (value: number, maximumFractionDigits = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);

const phaseLabels = {
  waiting: "Waiting",
  prefilling: "Prefill",
  generating: "Generating",
  active: "Active",
} as const;

export function OmlxActivityPanel({
  resident,
  onClose,
}: {
  resident: OmlxResidentAgent;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timerId);
  }, []);

  const statusLabel = resident.active
    ? phaseLabels[resident.phase]
    : "30 min resident";
  const residenceRemaining = Math.max(0, (resident.residentUntil - now) / 1_000);
  const concurrentRequests = resident.activeRequests + resident.waitingRequests;

  return (
    <div
      className="absolute inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      role="presentation"
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${resident.name} oMLX activity`}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-cyan-400/25 bg-[#071018]/98 shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-cyan-400/10 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 rounded-lg border border-cyan-400/20 bg-cyan-400/10 p-2 text-cyan-200">
              <Activity size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">{resident.name}</div>
              <div className="mt-1 break-all font-mono text-[10px] text-cyan-100/60">
                {resident.modelId}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-white/60 transition-colors hover:border-cyan-300/30 hover:text-white"
            aria-label="Close oMLX activity"
          >
            <X size={14} />
          </button>
        </header>

        <div className="grid grid-cols-2 gap-3 p-5">
          <Metric label="Status" value={statusLabel} />
          <Metric label="Elapsed" value={formatDuration(resident.elapsedSeconds)} />
          <Metric label="Input tokens" value={formatNumber(resident.promptTokens)} />
          <Metric label="Output tokens" value={formatNumber(resident.generatedTokens)} />
          <Metric
            label="TPS"
            value={formatNumber(resident.tokensPerSecond, 1)}
          />
          <Metric label="Concurrent requests" value={String(concurrentRequests)} />
        </div>

        {!resident.active ? (
          <div className="mx-5 mb-5 rounded-lg border border-amber-400/15 bg-amber-400/8 px-3 py-2 text-[11px] text-amber-100/80">
            Model activity has stopped. This avatar remains for at least 30 minutes.
            {residenceRemaining > 0
              ? ` Minimum stay remaining: ${formatDuration(residenceRemaining)}.`
              : " It will leave after the next successful activity check."}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-cyan-400/10 bg-black/20 px-3 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-cyan-200/50">
        {label}
      </div>
      <div className="mt-1.5 text-sm font-medium text-white/90">{value}</div>
    </div>
  );
}
