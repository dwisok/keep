// Server-only helpers for the API proxy routes. Never import from client code.

import { CHAINS, EVM_DETECT_ORDER, type ChainId } from "@/lib/chains";
import type { RawTrade, RawTransfer, TokenInfo } from "./wire";

const BIRDEYE_BASE = "https://public-api.birdeye.so";
const HELIUS_BASE = "https://mainnet.helius-rpc.com";
const GECKO_BASE = "https://api.geckoterminal.com/api/v2";

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly code: "rate_limit" | "upstream" | "not_found"
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with retry + exponential backoff on 429/5xx. */
async function getJson(url: string, headers: Record<string, string>, tries = 4): Promise<unknown> {
  let lastStatus = 0;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers, cache: "no-store" });
    if (res.ok) return res.json();
    lastStatus = res.status;
    if (res.status === 404) throw new UpstreamError("not found", "not_found");
    if (res.status === 429 || res.status >= 500) {
      // rate limits are usually per-second windows — back off hard enough to clear one
      await sleep((res.status === 429 ? 1200 : 600) * Math.pow(2, i));
      continue;
    }
    throw new UpstreamError(`upstream ${res.status}`, "upstream");
  }
  throw new UpstreamError(
    lastStatus === 429 ? "rate limited" : `upstream ${lastStatus}`,
    lastStatus === 429 ? "rate_limit" : "upstream"
  );
}

function birdeyeHeaders(chain: ChainId): Record<string, string> {
  const key = process.env.BIRDEYE_API_KEY;
  if (!key) throw new UpstreamError("BIRDEYE_API_KEY is not set", "upstream");
  const xChain = CHAINS[chain].birdeyeChain;
  if (!xChain) throw new UpstreamError(`birdeye does not index ${chain}`, "upstream");
  return { "X-API-KEY": key, "x-chain": xChain, accept: "application/json" };
}

// ---- upstream pacing + cache ------------------------------------------------
// Both providers rate-limit hard (Birdeye standard ≈ 1 req/s, GeckoTerminal free
// = 30 req/min), so each gets one gate with a minimum spacing, and responses are
// cached briefly (page URLs carry no timestamps, so reloads hit the cache).
const BIRDEYE_MIN_INTERVAL = Number(process.env.BIRDEYE_MIN_INTERVAL_MS ?? 550);
const GECKO_MIN_INTERVAL = Number(process.env.GECKO_MIN_INTERVAL_MS ?? 2100);
// must comfortably outlive a full deep scan (~60s), or reloads re-pay every page
const CACHE_TTL = 120_000;

function makeGate(minInterval: number) {
  const cache = new Map<string, { at: number; data: unknown }>();
  let gate: Promise<void> = Promise.resolve();
  return async function gatedJson(key: string, fetcher: () => Promise<unknown>): Promise<unknown> {
    const fresh = (h: { at: number; data: unknown } | undefined) =>
      h && Date.now() - h.at < CACHE_TTL ? h.data : undefined;
    const cached = fresh(cache.get(key));
    if (cached !== undefined) return cached;

    const prev = gate;
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    await prev;
    const started = Date.now();
    try {
      // another queued caller may have fetched the same URL while we waited
      const again = fresh(cache.get(key));
      if (again !== undefined) return again;
      const data = await fetcher();
      cache.set(key, { at: Date.now(), data });
      if (cache.size > 600) {
        const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 200);
        for (const [k] of oldest) cache.delete(k);
      }
      return data;
    } finally {
      // interval counts from request start, so upstream latency eats into the wait
      setTimeout(release, Math.max(0, minInterval - (Date.now() - started)));
    }
  };
}

const birdeyeGate = makeGate(BIRDEYE_MIN_INTERVAL);
const geckoGate = makeGate(GECKO_MIN_INTERVAL);

async function birdeyeJson(url: string, chain: ChainId): Promise<unknown> {
  // chain rides in a header, not the URL — key the cache on both
  return birdeyeGate(`${chain}|${url}`, () => getJson(url, birdeyeHeaders(chain)));
}

async function geckoJson(url: string): Promise<unknown> {
  return geckoGate(url, () => getJson(url, { accept: "application/json" }));
}

// -------------------------------------------------------------- chain detection

// resolved chains are remembered per address — probing costs gated upstream calls
const detectedChains = new Map<string, ChainId>();

/** Which chain hosts this 0x token? Probes candidates in a fixed order. */
export async function detectEvmChain(address: string): Promise<ChainId> {
  const hit = detectedChains.get(address.toLowerCase());
  if (hit) return hit;
  for (const chain of EVM_DETECT_ORDER) {
    try {
      await fetchTokenInfo(address, chain);
      detectedChains.set(address.toLowerCase(), chain);
      return chain;
    } catch (e) {
      if (e instanceof UpstreamError && e.code === "rate_limit") throw e;
      /* not on this chain — try the next */
    }
  }
  throw new UpstreamError("token not found on any supported chain", "not_found");
}

// -------------------------------------------------------------- token meta

type BirdeyeOverview = {
  data?: {
    symbol?: string;
    name?: string;
    supply?: number;
    circulatingSupply?: number;
    totalSupply?: number;
    price?: number;
    liquidity?: number;
    createdAt?: number;
    creationTime?: number;
  };
  success?: boolean;
};

type BirdeyeCreationInfo = {
  success?: boolean;
  data?: { blockUnixTime?: number; blockHumanTime?: string } | null;
};

// some plans don't include token_creation_info — remember and stop burning quota on it
let creationInfoUnavailable = false;

export async function fetchTokenInfo(mint: string, chain: ChainId): Promise<TokenInfo> {
  if (CHAINS[chain].provider === "gecko") return fetchTokenInfoGecko(mint, chain);

  const json = (await birdeyeJson(
    `${BIRDEYE_BASE}/defi/token_overview?address=${mint}`,
    chain
  )) as BirdeyeOverview;
  const d = json.data;
  // birdeye can answer success:true with a hollow object for unindexed tokens —
  // treat "no symbol, no name, no price" as not found so chain detection moves on
  if (!json.success || !d || (!d.symbol && !d.name && !((d.price ?? 0) > 0)))
    throw new UpstreamError("token not found", "not_found");

  let createdAt = d.createdAt ?? d.creationTime ?? null;
  if (createdAt === null && chain === "solana" && !creationInfoUnavailable) {
    // the overview often omits it — the dedicated endpoint knows the mint tx
    try {
      const ci = (await birdeyeJson(
        `${BIRDEYE_BASE}/defi/token_creation_info?address=${mint}`,
        chain
      )) as BirdeyeCreationInfo;
      createdAt = ci.data?.blockUnixTime ?? null;
    } catch (e) {
      if (e instanceof UpstreamError && /40[13]/.test(e.message)) creationInfoUnavailable = true;
      /* creation info is best-effort; 'launch' snaps to the oldest trade instead */
    }
  }

  return {
    symbol: d.symbol ?? "???",
    name: d.name ?? "Unknown token",
    supply: d.circulatingSupply ?? d.supply ?? d.totalSupply ?? 0,
    price: d.price ?? 0,
    liquidity: d.liquidity ?? 0,
    createdAt,
    chain,
  };
}

// -------------------------------------------------------------- swaps (Birdeye)

type BirdeyeTxLeg = {
  address?: string;
  uiAmount?: number;
  price?: number | null;
  nearestPrice?: number | null;
};

type BirdeyeTxItem = {
  txHash?: string;
  blockUnixTime?: number;
  owner?: string;
  side?: string;
  volumeUSD?: number;
  from?: BirdeyeTxLeg;
  to?: BirdeyeTxLeg;
};

type BirdeyeTxsResponse = {
  success?: boolean;
  data?: { items?: BirdeyeTxItem[]; hasNext?: boolean };
};

const PAGE = 50;
const MAX_PAGES = 40; // hard bound: 2000 swaps scanned per request

export async function fetchTrades(
  mint: string,
  fromTs: number,
  toTs: number,
  chain: ChainId
): Promise<{ trades: RawTrade[]; partial: boolean }> {
  if (CHAINS[chain].provider === "gecko") return fetchTradesGecko(mint, fromTs, toTs, chain);

  const trades: RawTrade[] = [];
  let partial = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    // pacing + short-TTL caching happen inside birdeyeJson (page URLs carry no timestamps)
    const url = `${BIRDEYE_BASE}/defi/txs/token?address=${mint}&tx_type=swap&sort_type=desc&offset=${page * PAGE}&limit=${PAGE}`;
    const json = (await birdeyeJson(url, chain)) as BirdeyeTxsResponse;
    const items = json.data?.items ?? [];
    if (!items.length) break;

    let reachedStart = false;
    for (const it of items) {
      const ts = it.blockUnixTime ?? 0;
      if (ts > toTs) continue;
      if (ts < fromTs) {
        reachedStart = true;
        break;
      }
      const t = normalizeTrade(it, mint);
      if (t) trades.push(t);
    }
    if (reachedStart) break;
    if (!json.data?.hasNext && items.length < PAGE) break;
    if (page === MAX_PAGES - 1) partial = true;
  }
  return { trades, partial };
}

function normalizeTrade(it: BirdeyeTxItem, mint: string): RawTrade | null {
  const fromLeg = it.from;
  const toLeg = it.to;
  // which leg is the tracked token? (EVM addresses arrive in mixed case)
  const eq = (a?: string) => a?.toLowerCase() === mint.toLowerCase();
  const tokenLeg = eq(toLeg?.address) ? toLeg : eq(fromLeg?.address) ? fromLeg : null;
  if (!tokenLeg || !it.owner || !it.txHash || !it.blockUnixTime) return null;
  const side: "buy" | "sell" =
    it.side === "buy" || it.side === "sell"
      ? it.side
      : eq(toLeg?.address)
        ? "buy" // token flowed to the owner
        : "sell";
  const tokens = Math.abs(tokenLeg.uiAmount ?? 0);
  if (tokens <= 0) return null;
  const price = tokenLeg.price ?? tokenLeg.nearestPrice ?? 0;
  const usd = it.volumeUSD && it.volumeUSD > 0 ? it.volumeUSD : tokens * price;
  if (usd <= 0) return null;
  return { ts: it.blockUnixTime, side, owner: it.owner, tokens, usd, price: price || usd / tokens, sig: it.txHash };
}

// -------------------------------------------------------- gecko (Robinhood Chain)

type GeckoTokenResponse = {
  data?: {
    attributes?: {
      name?: string;
      symbol?: string;
      price_usd?: string | null;
      normalized_total_supply?: string | null;
      total_reserve_in_usd?: string | null;
    };
    relationships?: { top_pools?: { data?: { id?: string }[] } };
  };
};

type GeckoTrade = {
  attributes?: {
    tx_hash?: string;
    tx_from_address?: string;
    block_timestamp?: string;
    kind?: string;
    volume_in_usd?: string;
    from_token_amount?: string;
    to_token_amount?: string;
    from_token_address?: string;
    to_token_address?: string;
    price_from_in_usd?: string | null;
    price_to_in_usd?: string | null;
  };
};

type GeckoTradesResponse = { data?: GeckoTrade[] };

const num = (s: string | null | undefined) => {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
};

async function fetchTokenInfoGecko(mint: string, chain: ChainId): Promise<TokenInfo> {
  const network = CHAINS[chain].geckoNetwork!;
  const json = (await geckoJson(
    `${GECKO_BASE}/networks/${network}/tokens/${mint.toLowerCase()}`
  )) as GeckoTokenResponse;
  const a = json.data?.attributes;
  if (!a) throw new UpstreamError("token not found", "not_found");
  return {
    symbol: a.symbol ?? "???",
    name: a.name ?? "Unknown token",
    supply: num(a.normalized_total_supply),
    price: num(a.price_usd),
    liquidity: num(a.total_reserve_in_usd),
    createdAt: null, // gecko doesn't expose creation time — 'launch' snaps to the oldest trade
    chain,
  };
}

// GeckoTerminal serves at most ~300 recent trades per pool (past 24h) — a replay
// on this provider is inherently a "recent slice"; the window snaps like any
// pagination-truncated scan.
const GECKO_POOLS = 3;

async function fetchTradesGecko(
  mint: string,
  fromTs: number,
  toTs: number,
  chain: ChainId
): Promise<{ trades: RawTrade[]; partial: boolean }> {
  const network = CHAINS[chain].geckoNetwork!;
  const addr = mint.toLowerCase();
  const token = (await geckoJson(
    `${GECKO_BASE}/networks/${network}/tokens/${addr}`
  )) as GeckoTokenResponse;
  const poolIds = (token.data?.relationships?.top_pools?.data ?? [])
    .map((p) => p.id?.replace(`${network}_`, ""))
    .filter((p): p is string => !!p)
    .slice(0, GECKO_POOLS);
  if (!poolIds.length) throw new UpstreamError("no pools for this token", "not_found");

  const trades: RawTrade[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const pool of poolIds) {
    const json = (await geckoJson(
      `${GECKO_BASE}/networks/${network}/pools/${pool}/trades`
    )) as GeckoTradesResponse;
    const items = json.data ?? [];
    if (items.length >= 290) truncated = true; // near the per-pool cap — history goes deeper
    for (const it of items) {
      const t = normalizeGeckoTrade(it, addr);
      if (!t || t.ts < fromTs || t.ts > toTs) continue;
      if (seen.has(t.sig)) continue; // multi-hop swaps can appear in several pools
      seen.add(t.sig);
      trades.push(t);
    }
  }
  trades.sort((a, b) => b.ts - a.ts);
  // partial when the 24h/300-trade ceiling clipped the requested window
  const oldest = trades.length ? trades[trades.length - 1].ts : fromTs;
  const partial = truncated && oldest > fromTs;
  return { trades, partial };
}

function normalizeGeckoTrade(it: GeckoTrade, mint: string): RawTrade | null {
  const a = it.attributes;
  if (!a?.tx_hash || !a.tx_from_address || !a.block_timestamp) return null;
  const ts = Math.floor(Date.parse(a.block_timestamp) / 1000);
  if (!Number.isFinite(ts)) return null;
  // which side of the swap is the tracked token?
  const fromIsToken = a.from_token_address?.toLowerCase() === mint;
  const toIsToken = a.to_token_address?.toLowerCase() === mint;
  if (!fromIsToken && !toIsToken) return null;
  const tokens = Math.abs(num(fromIsToken ? a.from_token_amount : a.to_token_amount));
  const price = num(fromIsToken ? a.price_from_in_usd : a.price_to_in_usd);
  if (tokens <= 0) return null;
  const usd = num(a.volume_in_usd) || tokens * price;
  if (usd <= 0) return null;
  // gecko's kind is relative to the pool's base token — derive from the token flow instead
  const side: "buy" | "sell" = toIsToken ? "buy" : "sell";
  return { ts, side, owner: a.tx_from_address, tokens, usd, price: price || usd / tokens, sig: a.tx_hash };
}

// -------------------------------------------------------------- transfers (Helius)

type HeliusTokenTransfer = {
  fromUserAccount?: string;
  toUserAccount?: string;
  mint?: string;
  tokenAmount?: number;
};

type HeliusTx = {
  signature?: string;
  timestamp?: number;
  transactionError?: unknown;
  tokenTransfers?: HeliusTokenTransfer[];
};

const HELIUS_MAX_PAGES = 10;

export async function fetchTransfers(
  mint: string,
  fromTs: number,
  toTs: number,
  exclude: Set<string>,
  chain: ChainId
): Promise<{ transfers: RawTransfer[]; stubbed: boolean }> {
  // wallet-to-wallet history comes from Helius, which is Solana-only —
  // EVM replays run on swaps alone (the app already handles stubbed transfers)
  if (chain !== "solana") return { transfers: [], stubbed: true };

  const key = process.env.HELIUS_API_KEY;
  if (!key) return { transfers: [], stubbed: true };

  const transfers: RawTransfer[] = [];
  let before = "";
  try {
    for (let page = 0; page < HELIUS_MAX_PAGES; page++) {
      const url =
        `${HELIUS_BASE}/v0/addresses/${mint}/transactions?api-key=${key}&type=TRANSFER&limit=100` +
        (before ? `&before=${before}` : "");
      const txs = (await getJson(url, {})) as HeliusTx[];
      if (!Array.isArray(txs) || !txs.length) break;

      let reachedStart = false;
      for (const tx of txs) {
        const ts = tx.timestamp ?? 0;
        if (ts < fromTs) {
          reachedStart = true;
          break;
        }
        if (ts > toTs || tx.transactionError) continue;
        for (const tt of tx.tokenTransfers ?? []) {
          if (tt.mint !== mint) continue;
          const from = tt.fromUserAccount ?? "";
          const to = tt.toUserAccount ?? "";
          const tokens = tt.tokenAmount ?? 0;
          // wallet-to-wallet only: both sides real wallets, neither an AMM/pool account
          if (!from || !to || from === to || tokens <= 0) continue;
          if (exclude.has(from) || exclude.has(to)) continue;
          transfers.push({ ts, from, to, tokens, sig: tx.signature ?? "" });
        }
      }
      if (reachedStart || txs.length < 100) break;
      before = txs[txs.length - 1].signature ?? "";
      if (!before) break;
    }
  } catch (e) {
    // Helius parsed history can be plan-gated; the replay must still work with swaps only.
    if (e instanceof UpstreamError && e.code === "rate_limit") throw e;
    return { transfers: [], stubbed: true };
  }
  return { transfers, stubbed: false };
}
