// Seeded mock scenario — the same generator drives dev mode (?mock=1),
// the landing hero, and the vignettes. Zero API cost, always alive.

import type { ReplayEvent, Scenario, WalletMeta, WalletTag } from "@/lib/engine/types";
import { truncAddr } from "@/lib/format";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function fakeAddr(rnd: () => number): string {
  let s = "";
  for (let i = 0; i < 44; i++) s += BASE58[Math.floor(rnd() * BASE58.length)];
  return s;
}

function fakeSig(rnd: () => number): string {
  let s = "";
  for (let i = 0; i < 88; i++) s += BASE58[Math.floor(rnd() * BASE58.length)];
  return s;
}

const SYMBOLS = ["NOVA", "GHOST", "WAGMI", "PSY", "DRIFT"];

export function generateMockScenario(seed = 1337, windowSeconds = 3600): Scenario {
  const rnd = mulberry32(seed);
  const symbol = SYMBOLS[seed % SYMBOLS.length];
  const supply = 1_000_000_000;
  let price = 0.00042 * (0.5 + rnd());
  const price0 = price;
  const windowStart = Math.floor(Date.now() / 1000) - windowSeconds;

  type W = { addr: string; tags: WalletTag[] };
  const mkW = (tags: WalletTag[]): W => ({ addr: fakeAddr(rnd), tags });

  const deployer = mkW(["deployer"]);
  const fresh = [mkW(["fresh"]), mkW(["fresh"]), mkW(["fresh"])];
  const snipers = [mkW(["sniper"]), mkW(["sniper"])];
  const whale = mkW(["whale"]);
  const cex = mkW(["cex"]);
  const retail: W[] = Array.from({ length: 20 }, () => mkW(["wallet"]));
  const wallets = [deployer, ...fresh, ...snipers, whale, cex, ...retail];

  const events: ReplayEvent[] = [];
  const impact = (usd: number, dir: 1 | -1) => {
    // toy constant-product impact: bigger trades move price more
    price = Math.max(price * 0.5, price * (1 + dir * (usd / (price * supply)) * 2.2));
  };
  const push = (t: number, type: ReplayEvent["type"], from: string, to: string, tokens: number) => {
    const usd = tokens * price;
    if (type === "buy") impact(usd, 1);
    if (type === "sell") impact(usd, -1);
    events.push({
      t: Math.floor(t),
      ts: windowStart + Math.floor(t),
      type, from, to, tokens,
      usd: Math.round(tokens * price),
      priceAfter: price,
      sig: fakeSig(rnd),
    });
  };

  const W = windowSeconds;
  // act 1 — snipers in the first two minutes
  for (const s of snipers) {
    push(rnd() * 100, "buy", "pool", s.addr, supply * (0.004 + rnd() * 0.008));
  }
  // deployer seeds fresh wallets early
  fresh.forEach((f, i) => {
    push(120 + i * 45 + rnd() * 40, "xfer", deployer.addr, f.addr, supply * (0.01 + rnd() * 0.01));
  });
  // act 2 — retail ramps in, a whale steps up
  for (let i = 0; i < 60; i++) {
    const t = W * 0.08 + rnd() * W * 0.5;
    const w = retail[Math.floor(rnd() * retail.length)];
    if (rnd() < 0.78) push(t, "buy", "pool", w.addr, supply * (0.0003 + rnd() * 0.002));
    else push(t, "sell", w.addr, "pool", supply * (0.0002 + rnd() * 0.001));
  }
  push(W * (0.35 + rnd() * 0.1), "buy", "pool", whale.addr, supply * 0.03);
  // a sniper takes profit, one retail sends to cex
  push(W * 0.5, "sell", snipers[0].addr, "pool", supply * 0.006);
  push(W * 0.55, "xfer", retail[0].addr, cex.addr, supply * 0.001);
  // act 3 — the fresh wallets dump, cascade follows
  fresh.forEach((f, i) => {
    push(W * (0.66 + i * 0.04) + rnd() * 60, "sell", f.addr, "pool", supply * (0.009 + rnd() * 0.009));
  });
  for (let i = 0; i < 34; i++) {
    const t = W * 0.7 + rnd() * W * 0.28;
    const w = retail[Math.floor(rnd() * retail.length)];
    if (rnd() < 0.62) push(t, "sell", w.addr, "pool", supply * (0.0003 + rnd() * 0.0015));
    else push(t, "buy", "pool", w.addr, supply * (0.0002 + rnd() * 0.001));
  }
  // whale trims, someone knife-catches
  push(W * 0.9, "sell", whale.addr, "pool", supply * 0.012);
  push(W * 0.95, "buy", "pool", retail[3].addr, supply * 0.004);

  events.sort((a, b) => a.t - b.t);

  // initial holdings so nobody sells what they never had
  const running = new Map<string, number>();
  const minRun = new Map<string, number>();
  for (const ev of events) {
    for (const [a, d] of [[ev.from, -ev.tokens], [ev.to, ev.tokens]] as [string, number][]) {
      if (a === "pool") continue;
      const v = (running.get(a) ?? 0) + d;
      running.set(a, v);
      minRun.set(a, Math.min(minRun.get(a) ?? 0, v));
    }
  }
  const initialHoldings: Record<string, number> = {};
  for (const [a, m] of minRun) initialHoldings[a] = Math.max(0, -m);
  initialHoldings[deployer.addr] = Math.max(initialHoldings[deployer.addr] ?? 0, supply * 0.05);

  const walletMetas: WalletMeta[] = wallets.map((w) => ({
    address: w.addr,
    label: w.tags.includes("cex") ? "Binance" : truncAddr(w.addr),
    tags: w.tags,
  }));

  return {
    mint: "MOCKmintDoNotSend1111111111111111111111111",
    symbol,
    name: `${symbol[0]}${symbol.slice(1).toLowerCase()} Protocol`,
    supply,
    windowStart,
    windowSeconds,
    wallets: walletMetas,
    events,
    initialHoldings,
    price0,
    poolBaseline: supply * 0.25,
  };
}

/** Tiny single-pattern scenarios for the landing vignettes. */
export function generateVignette(kind: "buys" | "sells" | "bundle", seed = 7): Scenario {
  const rnd = mulberry32(seed + kind.length);
  const supply = 1_000_000_000;
  let price = 0.0004;
  const windowSeconds = 60;
  const windowStart = Math.floor(Date.now() / 1000) - windowSeconds;
  const addrs = Array.from({ length: 5 }, () => fakeAddr(rnd));
  const deployer = fakeAddr(rnd);
  const events: ReplayEvent[] = [];
  const push = (t: number, type: ReplayEvent["type"], from: string, to: string, tokens: number) => {
    if (type === "buy") price *= 1.03;
    if (type === "sell") price *= 0.96;
    events.push({
      t, ts: windowStart + t, type, from, to, tokens,
      usd: Math.round(tokens * price), priceAfter: price, sig: fakeSig(rnd),
    });
  };
  if (kind === "buys") {
    addrs.forEach((a, i) => push(4 + i * 10, "buy", "pool", a, supply * (0.002 + rnd() * 0.004)));
  } else if (kind === "sells") {
    addrs.forEach((a, i) => push(4 + i * 8, "sell", a, "pool", supply * (0.002 + rnd() * 0.005)));
  } else {
    addrs.slice(0, 3).forEach((a, i) => push(4 + i * 9, "xfer", deployer, a, supply * 0.008));
    addrs.slice(0, 3).forEach((a, i) => push(34 + i * 7, "sell", a, "pool", supply * 0.008));
  }
  const initialHoldings: Record<string, number> = { [deployer]: supply * 0.05 };
  if (kind === "sells") for (const a of addrs) initialHoldings[a] = supply * 0.008;
  const wallets: WalletMeta[] = [
    { address: deployer, label: "deployer", tags: ["deployer"] },
    ...addrs.map((a) => ({
      address: a,
      label: truncAddr(a),
      tags: (kind === "bundle" ? ["fresh"] : ["wallet"]) as WalletMeta["tags"],
    })),
  ];
  return {
    mint: "MOCK", symbol: "SYM", name: "Vignette", supply,
    windowStart, windowSeconds, wallets, events,
    initialHoldings, price0: 0.0004, poolBaseline: supply * 0.25,
  };
}
