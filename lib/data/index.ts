// Client entry point of the data layer:
//   fetchScenario(mint, windowSeconds) -> Scenario
// Talks only to our own /api proxy routes; keys never reach the browser.

import type { ReplayEvent, Scenario, WalletMeta, WalletTag } from "@/lib/engine/types";
import { LAUNCH_WINDOW, MAX_WINDOW_SECONDS, truncAddr, windowLabel } from "@/lib/format";
import { KNOWN_ADDRESSES } from "./labels";
import { generateMockScenario } from "./mock";
import type { ApiError, RawTrade, RawTransfer, TokenInfo, TradesResponse, TransfersResponse } from "./wire";

export { generateMockScenario };

const MAX_EVENTS = 400;

export class ScenarioError extends Error {
  constructor(
    message: string,
    readonly code: "bad_mint" | "no_activity" | "rate_limit" | "upstream"
  ) {
    super(message);
  }
}

export type Progress = (message: string) => void;

async function getApi<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let code: ApiError["code"] = "upstream";
    let error = `request failed (${res.status})`;
    try {
      const body = (await res.json()) as ApiError;
      code = body.code ?? code;
      error = body.error ?? error;
    } catch {
      /* non-json error body */
    }
    if (code === "bad_mint") throw new ScenarioError("that doesn't look like a token address", "bad_mint");
    if (code === "not_found") throw new ScenarioError("token not found — no pool, no trades, nothing", "bad_mint");
    if (code === "rate_limit") throw new ScenarioError("rate limited upstream — wait a beat and retry", "rate_limit");
    throw new ScenarioError(error, "upstream");
  }
  return res.json() as Promise<T>;
}

export async function fetchScenario(
  mint: string,
  windowSeconds: number,
  onProgress: Progress = () => {},
  chainHint = "auto"
): Promise<Scenario> {
  const now = Math.floor(Date.now() / 1000);

  onProgress("fetching token metadata…");
  // the token route resolves the chain (auto-detects 0x addresses); reuse it downstream
  const token = await getApi<TokenInfo>(`/api/token?mint=${mint}&chain=${chainHint}`);
  const chain = token.chain ?? "solana";

  // 'launch' window: start at the mint's creation time when known, otherwise scan the
  // full depth ceiling and snap the window start to the oldest trade we can reach.
  const launch = windowSeconds === LAUNCH_WINDOW;
  let note: string | undefined;
  if (launch) {
    const age = token.createdAt !== null ? Math.max(600, now - token.createdAt) : MAX_WINDOW_SECONDS;
    windowSeconds = Math.min(age, MAX_WINDOW_SECONDS);
  }
  let windowStart = now - windowSeconds;
  onProgress(`$${token.symbol} — fetching swaps… (deep scans on busy tokens can take a minute)`);

  const [tradesRes, transfersRes] = await Promise.all([
    getApi<TradesResponse>(`/api/trades?mint=${mint}&from=${windowStart}&to=${now}&chain=${chain}`),
    getApi<TransfersResponse>(`/api/transfers?mint=${mint}&from=${windowStart}&to=${now}&chain=${chain}`).catch(
      () => ({ transfers: [], stubbed: true }) as TransfersResponse
    ),
  ]);
  onProgress(
    `fetching swaps… ${tradesRes.trades.length} events` +
      (transfersRes.transfers.length ? ` · ${transfersRes.transfers.length} transfers` : "")
  );

  if (!tradesRes.trades.length && !transfersRes.transfers.length) {
    throw new ScenarioError(
      `$${token.symbol} shows no activity in the selected window — try a longer one`,
      "no_activity"
    );
  }

  // Snap the window to what the data actually covers — otherwise a very active token
  // (pagination truncated before reaching windowStart) leaves most of the timeline empty
  // with every tick crammed at the right edge.
  if (tradesRes.partial && tradesRes.trades.length) {
    const oldestTrade = Math.min(...tradesRes.trades.map((t) => t.ts));
    if (oldestTrade > windowStart) {
      windowStart = oldestTrade - 30;
      // transfers older than the swap history would land before t=0 — drop them
      transfersRes.transfers = transfersRes.transfers.filter((t) => t.ts >= windowStart);
      note = `token too active for the full scan — replaying the last ${windowLabel(now - windowStart)}`;
    }
  } else if (launch) {
    // no dead air before the first event: the story starts where the data starts
    const oldest = Math.min(
      ...tradesRes.trades.map((t) => t.ts),
      ...transfersRes.transfers.map((t) => t.ts)
    );
    windowStart = Math.max(windowStart, oldest - 60);
    if (now - (token.createdAt ?? now) > MAX_WINDOW_SECONDS)
      note = `launched >${windowLabel(MAX_WINDOW_SECONDS)} ago — replaying the reachable slice`;
  }
  windowSeconds = now - windowStart;

  onProgress("reconstructing the timeline…");
  const events = buildEvents(tradesRes.trades, transfersRes.transfers, windowStart, token);
  const capped = events.length > MAX_EVENTS ? capEvents(events) : events;

  onProgress("labeling wallets…");
  const { wallets, initialHoldings } = labelAndReconstruct(capped, token, windowStart, now);

  const price0 = capped.length ? firstPrice(capped, token) : token.price;
  const poolBaseline =
    token.price > 0 && token.liquidity > 0
      ? token.liquidity / 2 / token.price
      : Math.max(1, token.supply * 0.1);

  return {
    mint,
    chain,
    symbol: token.symbol,
    name: token.name,
    supply: token.supply || estimateSupply(capped),
    windowStart,
    windowSeconds,
    wallets,
    events: capped,
    initialHoldings,
    price0,
    poolBaseline,
    capped: events.length > MAX_EVENTS ? capped.length : undefined,
    note,
  };
}

/** Resolve a user-typed query (full address or unique prefix) to a wallet in the scenario. */
export function resolveWallet(
  sc: Scenario,
  query: string
): { addr: string } | { error: string } {
  const q = query.trim();
  if (q.length < 4) return { error: "type at least 4 characters of the address" };
  const exact = sc.wallets.find((w) => w.address === q);
  if (exact) return { addr: exact.address };
  const lq = q.toLowerCase();
  let matches = sc.wallets.filter((w) => w.address.toLowerCase().startsWith(lq));
  if (!matches.length) matches = sc.wallets.filter((w) => w.address.toLowerCase().includes(lq));
  if (matches.length === 1) return { addr: matches[0].address };
  if (matches.length > 1) return { error: `matches ${matches.length} wallets — type more of the address` };
  return { error: "no wallet matching that address in this window" };
}

/** Focus mode: keep only the target wallet's events, its counterparties, and nothing else. */
export function buildFocusScenario(sc: Scenario, addr: string): Scenario {
  const events = sc.events.filter((ev) => ev.from === addr || ev.to === addr);
  const involved = new Set<string>([addr]);
  for (const ev of events) {
    involved.add(ev.from);
    involved.add(ev.to);
  }
  // initial holdings re-derived from the filtered event set (same forward rule)
  const run = new Map<string, number>();
  const minRun = new Map<string, number>();
  for (const ev of events) {
    for (const [a, d] of [
      [ev.from, -ev.tokens],
      [ev.to, ev.tokens],
    ] as [string, number][]) {
      if (a === "pool") continue;
      const v = (run.get(a) ?? 0) + d;
      run.set(a, v);
      minRun.set(a, Math.min(minRun.get(a) ?? 0, v));
    }
  }
  const initialHoldings: Record<string, number> = {};
  for (const [a, m] of minRun) initialHoldings[a] = Math.max(0, -m);

  return {
    ...sc,
    events,
    wallets: sc.wallets.filter((w) => involved.has(w.address)),
    initialHoldings,
    capped: undefined,
    note: `focus ${truncAddr(addr)} — ${events.length} events`,
  };
}

function firstPrice(events: ReplayEvent[], token: TokenInfo): number {
  for (const ev of events) if (ev.priceAfter > 0) return ev.priceAfter;
  return token.price;
}

function estimateSupply(events: ReplayEvent[]): number {
  // last-resort fallback so mcap math never divides by zero
  return Math.max(1_000_000, ...events.map((e) => e.tokens * 100));
}

function buildEvents(
  trades: RawTrade[],
  transfers: RawTransfer[],
  windowStart: number,
  token: TokenInfo
): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  for (const tr of trades) {
    events.push({
      t: tr.ts - windowStart,
      ts: tr.ts,
      type: tr.side,
      from: tr.side === "buy" ? "pool" : tr.owner,
      to: tr.side === "buy" ? tr.owner : "pool",
      tokens: tr.tokens,
      usd: tr.usd,
      priceAfter: tr.price,
      sig: tr.sig,
    });
  }
  // transfers carry no price — value them at the nearest known price
  const sortedTrades = [...trades].sort((a, b) => a.ts - b.ts);
  for (const tf of transfers) {
    const price = priceAt(sortedTrades, tf.ts) ?? token.price;
    events.push({
      t: tf.ts - windowStart,
      ts: tf.ts,
      type: "xfer",
      from: tf.from,
      to: tf.to,
      tokens: tf.tokens,
      usd: tf.tokens * price,
      priceAfter: price,
      sig: tf.sig,
    });
  }
  events.sort((a, b) => a.t - b.t || (a.type === "xfer" ? -1 : 1));
  return events;
}

function priceAt(sortedTrades: RawTrade[], ts: number): number | null {
  let best: RawTrade | null = null;
  for (const tr of sortedTrades) {
    if (tr.ts > ts) break;
    best = tr;
  }
  return best?.price ?? sortedTrades[0]?.price ?? null;
}

/** Keep the largest swaps by USD; always keep every xfer — they carry the story. */
function capEvents(events: ReplayEvent[]): ReplayEvent[] {
  const xfers = events.filter((e) => e.type === "xfer");
  const swaps = events
    .filter((e) => e.type !== "xfer")
    .sort((a, b) => b.usd - a.usd)
    .slice(0, Math.max(0, MAX_EVENTS - xfers.length));
  return [...xfers, ...swaps].sort((a, b) => a.t - b.t);
}

function labelAndReconstruct(
  events: ReplayEvent[],
  token: TokenInfo,
  windowStart: number,
  now: number
): { wallets: WalletMeta[]; initialHoldings: Record<string, number> } {
  // forward reconstruction from zero; a seller starts with at least what it sold
  const running = new Map<string, number>();
  const minRun = new Map<string, number>();
  const firstEvent = new Map<string, ReplayEvent>();
  const buysUsd = new Map<string, number>();
  const outXfers = new Map<string, number>();
  const buyCount = new Map<string, number>();
  const sellCount = new Map<string, number>();
  let totalVolume = 0;
  const maxSingleBuy = new Map<string, number>();

  for (const ev of events) {
    totalVolume += ev.usd;
    for (const [addr, delta] of [
      [ev.from, -ev.tokens],
      [ev.to, ev.tokens],
    ] as [string, number][]) {
      if (addr === "pool") continue;
      const v = (running.get(addr) ?? 0) + delta;
      running.set(addr, v);
      minRun.set(addr, Math.min(minRun.get(addr) ?? 0, v));
      if (!firstEvent.has(addr)) firstEvent.set(addr, ev);
    }
    if (ev.type === "buy") {
      buysUsd.set(ev.to, (buysUsd.get(ev.to) ?? 0) + ev.usd);
      buyCount.set(ev.to, (buyCount.get(ev.to) ?? 0) + 1);
      maxSingleBuy.set(ev.to, Math.max(maxSingleBuy.get(ev.to) ?? 0, ev.usd));
    }
    if (ev.type === "sell") sellCount.set(ev.from, (sellCount.get(ev.from) ?? 0) + 1);
    if (ev.type === "xfer") outXfers.set(ev.from, (outXfers.get(ev.from) ?? 0) + 1);
  }

  const initialHoldings: Record<string, number> = {};
  for (const [addr, m] of minRun) initialHoldings[addr] = Math.max(0, -m);

  const tokenIsYoung = token.createdAt !== null && now - token.createdAt < 86_400;
  const wallets: WalletMeta[] = [];
  for (const addr of running.keys()) {
    const known = KNOWN_ADDRESSES[addr];
    if (known) {
      wallets.push({ address: addr, label: known.label, tags: [known.tag] });
      continue;
    }
    const tags: WalletTag[] = [];
    const first = firstEvent.get(addr);
    // fresh: enters the window by receiving a transfer, then only sells
    if (first?.type === "xfer" && first.to === addr && !buyCount.get(addr) && (sellCount.get(addr) ?? 0) > 0)
      tags.push("fresh");
    // whale: a single buy above 5% of window volume
    if ((maxSingleBuy.get(addr) ?? 0) > totalVolume * 0.05) tags.push("whale");
    // sniper: buys inside the first 2 minutes of the window on a <24h-old token
    if (tokenIsYoung && first?.type === "buy" && first.to === addr && first.ts - windowStart < 120)
      tags.push("sniper");
    // deployer heuristic: seeds several wallets, never buys
    if ((outXfers.get(addr) ?? 0) >= 2 && !buyCount.get(addr)) tags.push("deployer");
    if (!tags.length) tags.push("wallet");
    wallets.push({ address: addr, label: truncAddr(addr), tags });
  }

  return { wallets, initialHoldings };
}
