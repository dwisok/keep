"use client";

// Live top-holders dashboard — right sidebar on /t/[mint].
// Re-ranks as the film plays: rank, share of supply, net change over the window.

import type { HolderInfo, WalletTag } from "@/lib/engine/types";
import { fmtTokens, fmtUsd } from "@/lib/format";

const TAG_ORDER: [WalletTag, string, string][] = [
  ["deployer", "text-xfer", "dep"],
  ["whale", "text-pool", "whale"],
  ["sniper", "text-sell", "sniper"],
  ["fresh", "text-xfer", "fresh"],
  ["cex", "text-dim", "cex"],
];

function tagChip(tags: WalletTag[]) {
  for (const [tag, cls, label] of TAG_ORDER) {
    if (tags.includes(tag)) return <span className={`shrink-0 text-[9px] ${cls}`}>{label}</span>;
  }
  return null;
}

const fmtShare = (p: number) => (p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toFixed(2)) + "%";

export function HoldersPanel({
  holders,
  symbol,
  focusAddr,
  onIsolate,
  onClose,
}: {
  holders: HolderInfo[];
  symbol: string;
  focusAddr: string | null;
  onIsolate: (addr: string) => void;
  onClose: () => void;
}) {
  const topPct = holders.reduce((a, h) => a + h.pctSupply, 0);
  const maxHold = holders[0]?.holdings ?? 1;

  return (
    <aside className="hidden w-64 shrink-0 flex-col overflow-hidden border-l border-hairline bg-panel sm:flex">
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <div>
          <div className="text-[10px] tracking-widest text-dim">
            TOP {holders.length || 10} HOLDERS <span className="text-buy">· live</span>
          </div>
          <div className="mt-0.5 text-[10px] text-dim">
            hold <span className="text-ink">{fmtShare(topPct)}</span> of supply right now
          </div>
        </div>
        <button onClick={onClose} className="px-1 text-[10px] text-dim hover:text-ink" aria-label="hide holders">
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {holders.length === 0 && (
          <p className="px-3 py-4 text-[11px] text-dim">nobody holds anything yet — press play</p>
        )}
        {holders.map((h, i) => {
          const focused = h.address === focusAddr;
          const gained = h.delta > 0;
          const moved = Math.abs(h.delta) >= 1;
          return (
            <button
              key={h.address}
              onClick={() => onIsolate(h.address)}
              title="isolate this wallet"
              className={`block w-full border-b border-hairline px-3 py-2 text-left transition-colors hover:bg-bg ${
                focused ? "bg-pool/10" : ""
              }`}
            >
              <div className="flex items-baseline gap-1.5 text-[11px]">
                <span className="shrink-0 text-dim">{String(i + 1).padStart(2, "0")}</span>
                <span className={`truncate ${focused ? "text-pool" : "text-ink"}`}>{h.label}</span>
                {tagChip(h.tags)}
                <span className="ml-auto shrink-0 text-ink">{fmtShare(h.pctSupply)}</span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden bg-bg">
                <div
                  className="h-full bg-pool/50 transition-[width] duration-500"
                  style={{ width: `${Math.max(2, (h.holdings / maxHold) * 100)}%` }}
                />
              </div>
              <div className="mt-1 flex items-baseline justify-between text-[10px]">
                <span className="text-dim">
                  {fmtTokens(h.holdings)} ${symbol} · {fmtUsd(h.usd)}
                </span>
                <span className={moved ? (gained ? "text-buy" : "text-sell") : "text-dim"}>
                  {moved ? `${gained ? "+" : "−"}${fmtTokens(Math.abs(h.delta))} ${gained ? "▲" : "▼"}` : "="}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="border-t border-hairline px-3 py-1.5 text-[9px] leading-relaxed text-dim">
        Δ = net change since window start · click a wallet to isolate it
      </div>
    </aside>
  );
}
