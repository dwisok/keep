"use client";

// Horizontal strip of "what happened" cards under the stats strip.
// Cards with an action jump the playhead or isolate a wallet.

import type { CardTone, SummaryCard } from "@/lib/summary";

const TONE_TEXT: Record<CardTone, string> = {
  buy: "text-buy",
  sell: "text-sell",
  xfer: "text-xfer",
  pool: "text-pool",
  neutral: "text-ink",
};

export function RecapCards({
  cards,
  windowKey,
  onJump,
  onIsolate,
  onClose,
}: {
  cards: SummaryCard[];
  windowKey: string;
  onJump: (t: number) => void;
  onIsolate: (addr: string) => void;
  onClose: () => void;
}) {
  const act = (card: SummaryCard) => {
    if (!card.action) return;
    if (card.action.kind === "jump") onJump(card.action.t);
    else onIsolate(card.action.addr);
  };

  return (
    <div className="shrink-0 border-b border-hairline bg-bg">
      <div className="flex items-center justify-between px-3 pt-1.5 text-[10px] tracking-widest text-dim">
        <span>
          WHAT HAPPENED · <span className="text-ink">{windowKey}</span> WINDOW
        </span>
        <button onClick={onClose} className="px-1 hover:text-ink" aria-label="hide recap">
          hide ✕
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto px-3 pb-2 pt-1.5">
        {cards.map((c) => {
          const clickable = Boolean(c.action);
          const Tag = clickable ? "button" : "div";
          return (
            <Tag
              key={c.key}
              onClick={clickable ? () => act(c) : undefined}
              className={`w-44 shrink-0 border border-hairline bg-panel px-2.5 py-2 text-left ${
                clickable ? "cursor-pointer transition-colors hover:border-dim" : ""
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[9px] tracking-[0.18em] text-dim">{c.label}</span>
                {c.actionLabel && <span className="text-[9px] text-dim">{c.actionLabel}</span>}
              </div>
              <div className={`mt-0.5 truncate text-sm font-bold ${TONE_TEXT[c.tone]}`}>{c.headline}</div>
              <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-dim">{c.detail}</p>
            </Tag>
          );
        })}
      </div>
    </div>
  );
}
