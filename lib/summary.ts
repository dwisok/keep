// Window recap — turns a scenario's event list into a handful of small
// "what happened" cards (price move, flow, whales, bundles, hot moment…).
// Pure data in, pure data out; rendering lives in components/RecapCards.tsx.

import type { ReplayEvent, Scenario, WalletMeta } from "@/lib/engine/types";
import { fmtPct, fmtPrice, fmtTimecode, fmtTokens, fmtUsd, windowLabel } from "@/lib/format";

export type CardTone = "buy" | "sell" | "xfer" | "pool" | "neutral";

export type CardAction = { kind: "jump"; t: number } | { kind: "isolate"; addr: string };

export type SummaryCard = {
  key: string;
  label: string; // small uppercase header, e.g. "PRICE"
  headline: string; // the big value, e.g. "+42.3%"
  detail: string; // one-line context
  tone: CardTone;
  action?: CardAction;
  actionLabel?: string; // e.g. "► jump" / "✂ isolate"
};

const walletOf = (sc: Scenario, addr: string): WalletMeta | undefined =>
  sc.wallets.find((w) => w.address === addr);
const labelOf = (sc: Scenario, addr: string): string => walletOf(sc, addr)?.label ?? addr;
const hasTag = (sc: Scenario, addr: string, tag: string): boolean =>
  walletOf(sc, addr)?.tags.includes(tag as WalletMeta["tags"][number]) ?? false;

function sumBy(events: ReplayEvent[], key: (e: ReplayEvent) => string) {
  const usd = new Map<string, number>();
  const count = new Map<string, number>();
  for (const e of events) {
    const k = key(e);
    usd.set(k, (usd.get(k) ?? 0) + e.usd);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  let top: string | null = null;
  for (const [k, v] of usd) if (top === null || v > (usd.get(top) ?? 0)) top = k;
  return { usd, count, top };
}

export function buildSummary(sc: Scenario): SummaryCard[] {
  const cards: SummaryCard[] = [];
  const events = sc.events;

  if (events.length === 0) {
    return [
      {
        key: "empty",
        label: "RECAP",
        headline: "nothing happened",
        detail: "no swaps or transfers in this window — try a wider one",
        tone: "neutral",
      },
    ];
  }

  const buys = events.filter((e) => e.type === "buy");
  const sells = events.filter((e) => e.type === "sell");
  const xfers = events.filter((e) => e.type === "xfer");
  const swaps = buys.length + sells.length;

  // ---------------------------------------------------------- price
  const priceEnd = events[events.length - 1].priceAfter;
  let hi = sc.price0;
  let lo = sc.price0;
  for (const e of events) {
    if (e.priceAfter > hi) hi = e.priceAfter;
    if (e.priceAfter < lo) lo = e.priceAfter;
  }
  const chg = sc.price0 > 0 ? (priceEnd / sc.price0 - 1) * 100 : 0;
  cards.push({
    key: "price",
    label: "PRICE",
    headline: fmtPct(chg),
    detail: `${fmtPrice(sc.price0)} → ${fmtPrice(priceEnd)} · high ${fmtPrice(hi)} · low ${fmtPrice(lo)}`,
    tone: chg >= 0 ? "buy" : "sell",
  });

  // ---------------------------------------------------------- flow
  const buyVol = buys.reduce((a, e) => a + e.usd, 0);
  const sellVol = sells.reduce((a, e) => a + e.usd, 0);
  const net = buyVol - sellVol;
  if (swaps > 0) {
    cards.push({
      key: "flow",
      label: "NET FLOW",
      headline: `${net >= 0 ? "+" : "−"}${fmtUsd(Math.abs(net))}`,
      detail: `${fmtUsd(buyVol)} bought ▲ (${buys.length}) · ${fmtUsd(sellVol)} sold ▼ (${sells.length})`,
      tone: net >= 0 ? "buy" : "sell",
    });
  }

  // ---------------------------------------------------------- bundle watch
  const seeds = xfers.filter(
    (e) => hasTag(sc, e.from, "deployer") || hasTag(sc, e.to, "fresh")
  );
  const freshDumps = sells.filter((e) => hasTag(sc, e.from, "fresh"));
  if (seeds.length > 0 || freshDumps.length > 0) {
    const seeded = new Set(seeds.map((e) => e.to)).size;
    const dumped = new Set(freshDumps.map((e) => e.from)).size;
    const dumpUsd = freshDumps.reduce((a, e) => a + e.usd, 0);
    const first = freshDumps[0] ?? seeds[0];
    cards.push({
      key: "bundle",
      label: "BUNDLE WATCH",
      headline:
        dumped > 0 ? `${fmtUsd(dumpUsd)} dumped` : `${seeded} wallet${seeded > 1 ? "s" : ""} seeded`,
      detail:
        dumped > 0
          ? `${seeded > 0 ? `deployer seeded ${seeded} · ` : ""}${dumped} fresh wallet${dumped > 1 ? "s" : ""} sold`
          : `deployer moved ${fmtTokens(seeds.reduce((a, e) => a + e.tokens, 0))} $${sc.symbol} to fresh wallets`,
      tone: "xfer",
      action: { kind: "jump", t: first.t },
      actionLabel: "► jump",
    });
  }

  // ---------------------------------------------------------- top buyer / seller
  const topBuy = sumBy(buys, (e) => e.to);
  if (topBuy.top) {
    const addr = topBuy.top;
    cards.push({
      key: "top-buyer",
      label: "TOP BUYER",
      headline: fmtUsd(topBuy.usd.get(addr) ?? 0),
      detail: `${labelOf(sc, addr)} · ${topBuy.count.get(addr)} buy${(topBuy.count.get(addr) ?? 0) > 1 ? "s" : ""}${
        hasTag(sc, addr, "whale") ? " · whale" : hasTag(sc, addr, "sniper") ? " · sniper" : ""
      }`,
      tone: "buy",
      action: { kind: "isolate", addr },
      actionLabel: "✂ isolate",
    });
  }
  const topSell = sumBy(sells, (e) => e.from);
  if (topSell.top) {
    const addr = topSell.top;
    cards.push({
      key: "top-seller",
      label: "TOP SELLER",
      headline: fmtUsd(topSell.usd.get(addr) ?? 0),
      detail: `${labelOf(sc, addr)} · ${topSell.count.get(addr)} sell${(topSell.count.get(addr) ?? 0) > 1 ? "s" : ""}${
        hasTag(sc, addr, "fresh") ? " · fresh wallet" : hasTag(sc, addr, "whale") ? " · whale" : ""
      }`,
      tone: "sell",
      action: { kind: "isolate", addr },
      actionLabel: "✂ isolate",
    });
  }

  // ---------------------------------------------------------- biggest single trade
  const biggest = [...buys, ...sells].sort((a, b) => b.usd - a.usd)[0];
  if (biggest) {
    cards.push({
      key: "biggest",
      label: "BIGGEST TRADE",
      headline: `${biggest.type === "buy" ? "▲" : "▼"} ${fmtUsd(biggest.usd)}`,
      detail: `${labelOf(sc, biggest.type === "buy" ? biggest.to : biggest.from)} at ${fmtTimecode(biggest.t)}`,
      tone: biggest.type === "buy" ? "buy" : "sell",
      action: { kind: "jump", t: biggest.t },
      actionLabel: "► jump",
    });
  }

  // ---------------------------------------------------------- hottest stretch
  if (swaps >= 8) {
    const BUCKETS = 24;
    const size = sc.windowSeconds / BUCKETS;
    const vol = new Array(BUCKETS).fill(0);
    const cnt = new Array(BUCKETS).fill(0);
    for (const e of events) {
      if (e.type === "xfer") continue;
      const b = Math.min(BUCKETS - 1, Math.floor(e.t / size));
      vol[b] += e.usd;
      cnt[b] += 1;
    }
    let hot = 0;
    for (let i = 1; i < BUCKETS; i++) if (vol[i] > vol[hot]) hot = i;
    if (cnt[hot] >= 2) {
      cards.push({
        key: "hot",
        label: "HOTTEST STRETCH",
        headline: fmtUsd(vol[hot]),
        detail: `${cnt[hot]} swaps in ${windowLabel(size)} around ${fmtTimecode(hot * size + size / 2)}`,
        tone: "pool",
        action: { kind: "jump", t: hot * size },
        actionLabel: "► jump",
      });
    }
  }

  // ---------------------------------------------------------- wallets in / out
  const initial = new Map<string, number>(Object.entries(sc.initialHoldings));
  const final = new Map<string, number>(initial);
  const peak = new Map<string, number>(initial);
  for (const e of events) {
    for (const [a, d] of [
      [e.from, -e.tokens],
      [e.to, e.tokens],
    ] as [string, number][]) {
      if (a === "pool") continue;
      const v = (final.get(a) ?? 0) + d;
      final.set(a, v);
      peak.set(a, Math.max(peak.get(a) ?? 0, v));
    }
  }
  let entered = 0;
  let emptied = 0;
  for (const [a, p] of peak) {
    if (p <= 0) continue;
    if ((initial.get(a) ?? 0) <= 0) entered++;
    if ((final.get(a) ?? 0) <= p * 0.02) emptied++;
  }
  if (entered > 0 || emptied > 0) {
    cards.push({
      key: "wallets",
      label: "WALLETS",
      headline: `+${entered} in`,
      detail: `${entered} wallet${entered !== 1 ? "s" : ""} entered · ${emptied} emptied the bag`,
      tone: "neutral",
    });
  }

  return cards;
}
