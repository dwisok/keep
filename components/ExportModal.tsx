"use client";

import { useState } from "react";
import type { Scenario } from "@/lib/engine/types";
import { downloadBlob, exportMimeType, exportReplay, type ExportFormat } from "@/lib/engine/exporter";
import { recapCardBlob } from "@/lib/recapCard";

type ExportKind = "film" | "card";

export function ExportModal({
  scenario,
  windowKey,
  onClose,
}: {
  scenario: Scenario;
  windowKey: string;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<ExportKind>("film");
  const [format, setFormat] = useState<ExportFormat>("16:9");
  const [duration, setDuration] = useState<30 | 60 | 90>(30);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = exportMimeType() !== null;

  const start = async () => {
    setError(null);
    setProgress(0);
    try {
      const blob = await exportReplay(scenario, {
        format,
        durationSeconds: duration,
        onProgress: setProgress,
      });
      downloadBlob(blob, `tape-${scenario.symbol.toLowerCase()}-${windowKey}.webm`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "export failed");
      setProgress(null);
    }
  };

  const downloadCard = async () => {
    setError(null);
    try {
      const blob = await recapCardBlob(scenario, windowKey);
      downloadBlob(blob, `tape-${scenario.symbol.toLowerCase()}-${windowKey}-recap.png`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "export failed");
    }
  };

  const busy = progress !== null;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-bg/80 p-4 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <div className="w-96 max-w-full border border-hairline bg-panel p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between text-sm">
          <span className="text-ink">export</span>
          {!busy && (
            <button onClick={onClose} className="text-dim hover:text-ink">
              ✕
            </button>
          )}
        </div>

        <div className="mb-3 text-xs">
          <div className="mb-1.5 text-dim">TYPE</div>
          <div className="flex gap-2">
            {(
              [
                ["film", "film · webm"],
                ["card", "recap card · png"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                disabled={busy}
                onClick={() => setKind(k)}
                className={`flex-1 border px-3 py-2 ${
                  kind === k ? "border-pool/60 bg-pool/10 text-ink" : "border-hairline text-dim hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {kind === "film" ? (
          <>
            {!supported && (
              <p className="mb-3 text-xs text-sell">this browser can&apos;t record canvas video — try Chrome.</p>
            )}

            <div className="mb-3 text-xs">
              <div className="mb-1.5 text-dim">FORMAT</div>
              <div className="flex gap-2">
                {(["16:9", "9:16"] as const).map((f) => (
                  <button
                    key={f}
                    disabled={busy}
                    onClick={() => setFormat(f)}
                    className={`flex-1 border px-3 py-2 ${
                      format === f ? "border-pool/60 bg-pool/10 text-ink" : "border-hairline text-dim hover:text-ink"
                    }`}
                  >
                    {f} {f === "16:9" ? "· 1280×720" : "· 720×1280"}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4 text-xs">
              <div className="mb-1.5 text-dim">VIDEO LENGTH</div>
              <div className="flex gap-2">
                {([30, 60, 90] as const).map((d) => (
                  <button
                    key={d}
                    disabled={busy}
                    onClick={() => setDuration(d)}
                    className={`flex-1 border px-3 py-2 ${
                      duration === d ? "border-pool/60 bg-pool/10 text-ink" : "border-hairline text-dim hover:text-ink"
                    }`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>

            {busy ? (
              <div>
                <div className="mb-1.5 flex justify-between text-[11px] text-dim">
                  <span>recording the replay…</span>
                  <span>{Math.round((progress ?? 0) * 100)}%</span>
                </div>
                <div className="h-1.5 bg-hairline">
                  <div className="h-full bg-pool transition-[width]" style={{ width: `${(progress ?? 0) * 100}%` }} />
                </div>
                <p className="mt-2 text-[10px] text-dim">runs in real time — the {duration}s cut takes {duration}s to record.</p>
              </div>
            ) : (
              <button
                onClick={start}
                disabled={!supported}
                className="w-full border border-pool/60 bg-pool/10 px-3 py-2 text-xs text-ink hover:bg-pool/20 disabled:opacity-40"
              >
                record & download .webm
              </button>
            )}

            {error && <p className="mt-2 text-xs text-sell">{error}</p>}
            <p className="mt-3 text-[10px] text-dim">webm only for now — mp4 conversion is out of scope for the mvp.</p>
          </>
        ) : (
          <>
            <p className="mb-4 text-[11px] leading-relaxed text-dim">
              one 1200×675 image, the whole <span className="text-ink">{windowKey}</span> window — price move,
              net flow, bundles, top wallets, hottest stretch. instant, ready for the timeline.
            </p>
            <button
              onClick={downloadCard}
              className="w-full border border-pool/60 bg-pool/10 px-3 py-2 text-xs text-ink hover:bg-pool/20"
            >
              download .png
            </button>
            {error && <p className="mt-2 text-xs text-sell">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
