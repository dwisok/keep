import { fmtTokens, fmtUsd } from "@/lib/format";
import type { ReplayEvent, WalletMeta } from "./types";

// deterministic pick so replays & exports always read the same
function pick<T>(arr: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

export function buildCaption(
  ev: ReplayEvent,
  meta: (addr: string) => WalletMeta | undefined,
  symbol: string
): string {
  const amt = `${fmtTokens(ev.tokens)} $${symbol}`;
  const usd = fmtUsd(ev.usd);

  if (ev.type === "buy") {
    const w = meta(ev.to);
    const who = w?.label ?? ev.to;
    const tags = w?.tags ?? [];
    if (tags.includes("sniper")) return `▲ BUY ${usd} · sniper ${who} is in early`;
    if (tags.includes("whale")) return `▲ BUY ${usd} · whale ${who} loads up ${amt}`;
    const verb = pick(["grabs", "apes into", "scoops"], ev.sig);
    return `▲ BUY ${usd} · ${who} ${verb} ${amt}`;
  }

  if (ev.type === "sell") {
    const w = meta(ev.from);
    const who = w?.label ?? ev.from;
    const tags = w?.tags ?? [];
    if (tags.includes("fresh")) return `▼ SELL ${usd} · fresh wallet dumps the bag`;
    if (tags.includes("whale")) return `▼ SELL ${usd} · whale ${who} hits the exit`;
    const verb = pick(["dumps", "unloads", "jeets"], ev.sig);
    return `▼ SELL ${usd} · ${who} ${verb} ${amt}`;
  }

  // xfer
  const from = meta(ev.from);
  const to = meta(ev.to);
  const fromWho = from?.label ?? ev.from;
  const toWho = to?.label ?? ev.to;
  if (from?.tags.includes("deployer") && to?.tags.includes("fresh"))
    return `⇄ TRANSFER · deployer seeds ${amt} to a fresh wallet`;
  if (from?.tags.includes("deployer")) return `⇄ TRANSFER · deployer moves ${amt} to ${toWho}`;
  if (to?.tags.includes("cex")) return `⇄ TRANSFER · ${fromWho} sends ${amt} to ${toWho} — exit incoming?`;
  if (to?.tags.includes("fresh")) return `⇄ TRANSFER · ${fromWho} seeds ${amt} to a fresh wallet`;
  return `⇄ TRANSFER · ${fromWho} moves ${amt} to ${toWho}`;
}
