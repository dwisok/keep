"use client";

import { useMemo, useState } from "react";
import { CHAINS, explorerAccount, explorerTx, isChainId } from "@/lib/chains";
import type { ReplayEngine } from "@/lib/engine/engine";
import type { ReplayEvent, Scenario, WalletTag } from "@/lib/engine/types";
import { fmtTimecode, fmtTokens, fmtUsd, truncAddr } from "@/lib/format";

const TAG_COLORS: Record<string, string> = {
  pool: "text-pool border-pool/50",
  dex: "text-dim border-hairline",
  cex: "text-dim border-hairline",
  fresh: "text-xfer border-xfer/50",
  whale: "text-buy border-buy/50",
  sniper: "text-buy border-buy/50",
  deployer: "text-xfer border-xfer/50",
  retail: "text-dim border-hairline",
  wallet: "text-dim border-hairline",
};

function walletPnl(scenario: Scenario, addr: string, priceNow: number) {
  let buys = 0,
    sells = 0,
    hold = scenario.initialHoldings[addr] ?? 0;
  const initial = hold;
  for (const ev of scenario.events) {
    if (ev.type === "buy" && ev.to === addr) {
      buys += ev.usd;
      hold += ev.tokens;
    } else if (ev.type === "sell" && ev.from === addr) {
      sells += ev.usd;
      hold -= ev.tokens;
    } else if (ev.type === "xfer") {
      if (ev.to === addr) hold += ev.tokens;
      if (ev.from === addr) hold -= ev.tokens;
    }
  }
  return { net: sells - buys + (hold - initial) * priceNow, hold: Math.max(0, hold) };
}

function EventRow({
  ev,
  self,
  chain,
  onJump,
}: {
  ev: ReplayEvent;
  self: string;
  chain?: string;
  onJump: (ev: ReplayEvent) => void;
}) {
  const color = ev.type === "buy" ? "text-buy" : ev.type === "sell" ? "text-sell" : "text-xfer";
  const arrow = ev.type === "buy" ? "▲" : ev.type === "sell" ? "▼" : ev.to === self ? "⇄ in" : "⇄ out";
  return (
    <div className="flex items-center gap-2 border-b border-hairline/50 py-1.5 text-[11px] last:border-0">
      <button onClick={() => onJump(ev)} className={`${color} shrink-0 hover:underline`}>
        {fmtTimecode(ev.t)}
      </button>
      <span className={color}>{arrow}</span>
      <span className="text-ink">{fmtUsd(ev.usd)}</span>
      <span className="text-dim">{fmtTokens(ev.tokens)}</span>
      {ev.sig && !ev.sig.startsWith("MOCK") && ev.sig.length > 60 && (
        <a
          href={explorerTx(chain, ev.sig)}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-dim hover:text-ink"
        >
          tx ↗
        </a>
      )}
    </div>
  );
}

export function WalletPopover({
  engine,
  scenario,
  nodeId,
  onClose,
  onJump,
  onIsolate,
}: {
  engine: ReplayEngine;
  scenario: Scenario;
  nodeId: string;
  onClose: () => void;
  onJump: (ev: ReplayEvent) => void;
  onIsolate?: (addr: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const info = engine.getNodeInfo(nodeId);
  const priceNow = engine.getStats().price;

  const events = useMemo(
    () =>
      scenario.events
        .filter((ev) =>
          info?.members
            ? info.members.includes(ev.from) || info.members.includes(ev.to)
            : ev.from === nodeId || ev.to === nodeId
        )
        .slice(-40),
    [scenario, nodeId, info?.members]
  );

  if (!info) return null;
  const isReal = nodeId !== "pool" && nodeId !== "retail" && !scenario.mint.startsWith("MOCK");
  const pnl =
    nodeId === "pool"
      ? null
      : info.members
        ? info.members.reduce(
            (acc, m) => {
              const p = walletPnl(scenario, m, priceNow);
              return { net: acc.net + p.net, hold: acc.hold + p.hold };
            },
            { net: 0, hold: 0 }
          )
        : walletPnl(scenario, nodeId, priceNow);

  return (
    <aside className="absolute right-3 top-3 bottom-3 z-10 flex w-80 max-w-[88vw] flex-col border border-hairline bg-panel/95 backdrop-blur-sm">
      <div className="flex items-start justify-between border-b border-hairline p-3">
        <div className="min-w-0">
          <div className="truncate text-sm text-ink">{info.label}</div>
          {nodeId !== "pool" && nodeId !== "retail" && (
            <button
              onClick={() => navigator.clipboard?.writeText(nodeId).catch(() => {})}
              className="mt-0.5 max-w-full truncate text-[10px] text-dim hover:text-ink"
              title="copy address"
            >
              {nodeId} ⧉
            </button>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {info.tags.map((t: WalletTag) => (
              <span key={t} className={`border px-1.5 py-0.5 text-[9px] uppercase ${TAG_COLORS[t] ?? TAG_COLORS.wallet}`}>
                {t}
              </span>
            ))}
            {onIsolate && nodeId !== "pool" && nodeId !== "retail" && (
              <button
                onClick={() => onIsolate(nodeId)}
                className="border border-pool/50 px-1.5 py-0.5 text-[9px] uppercase text-pool hover:bg-pool/10"
                title="show only this wallet and its counterparties"
              >
                ✂ isolate
              </button>
            )}
          </div>
        </div>
        <button onClick={onClose} className="px-1 text-dim hover:text-ink">
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-hairline p-3 text-[11px]">
        <div>
          <div className="text-dim">CURRENT BAG</div>
          <div className="text-ink">
            {fmtTokens(info.holdings)} ${scenario.symbol}
          </div>
        </div>
        {pnl && (
          <div>
            <div className="text-dim">NET PNL (WINDOW)</div>
            <div className={pnl.net >= 0 ? "text-buy" : "text-sell"}>
              {pnl.net >= 0 ? "+" : "−"}
              {fmtUsd(Math.abs(pnl.net))}
            </div>
          </div>
        )}
      </div>

      {info.members && (
        <div className="max-h-40 overflow-y-auto border-b border-hairline p-3 text-[11px]">
          <div className="mb-1 text-dim">GROUPED WALLETS ({info.members.length})</div>
          {info.members.map((m) => {
            const p = walletPnl(scenario, m, priceNow);
            return (
              <div key={m}>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setExpanded(expanded === m ? null : m)}
                    className="flex flex-1 items-center justify-between py-1 text-left text-dim hover:text-ink"
                  >
                    <span>{truncAddr(m)}</span>
                    <span className={p.net >= 0 ? "text-buy" : "text-sell"}>
                      {p.net >= 0 ? "+" : "−"}
                      {fmtUsd(Math.abs(p.net))}
                    </span>
                  </button>
                  {onIsolate && (
                    <button
                      onClick={() => onIsolate(m)}
                      className="text-pool hover:bg-pool/10"
                      title="isolate this wallet"
                    >
                      ✂
                    </button>
                  )}
                </div>
                {expanded === m && (
                  <div className="mb-1 border-l border-hairline pl-2">
                    {scenario.events
                      .filter((ev) => ev.from === m || ev.to === m)
                      .slice(-10)
                      .map((ev, i) => (
                        <EventRow key={i} ev={ev} self={m} chain={scenario.chain} onJump={onJump} />
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-1 text-[11px] text-dim">EVENTS IN WINDOW ({events.length})</div>
        {events.map((ev, i) => (
          <EventRow key={i} ev={ev} self={nodeId} chain={scenario.chain} onJump={onJump} />
        ))}
      </div>

      {isReal && (
        <a
          href={explorerAccount(scenario.chain, nodeId)}
          target="_blank"
          rel="noreferrer"
          className="border-t border-hairline p-3 text-center text-[11px] text-dim hover:text-ink"
        >
          view on{" "}
          {scenario.chain && isChainId(scenario.chain) && scenario.chain !== "solana"
            ? new URL(CHAINS[scenario.chain].explorerAccount("")).hostname.replace(/^www\./, "")
            : "solscan"}{" "}
          ↗
        </a>
      )}
    </aside>
  );
}
