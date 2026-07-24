"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { isValidAddress, truncAddr } from "@/lib/format";

/* ============================================================
   TAPE landing — port of tape-landing.html
   Surveillance-tape DA: scanlines, glitch, burn-in timecode,
   rolling tape counter, evidence log. The footage behind the
   page is a self-contained seeded demo (reseeded by the pasted
   CA); a valid mint routes to the real replay at /t/[mint].
   ============================================================ */

const CSS = `
#tp {
  --black: #0B0D0B;      /* base charbon, sous-ton phosphore chaud */
  --console: #111511;    /* panneaux */
  --splice: #212821;     /* filets */
  --phos: #E8F0E4;       /* premier plan phosphore */
  --static: #6E7A6C;     /* secondaire */
  --buy: #4CE07E;
  --sell: #FF5A3C;
  --seed: #EFB13C;
  --pool: #56C8E8;
  --osd: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
  --disp: Haettenschweiler, "Arial Narrow", Impact, "Franklin Gothic Medium", sans-serif;
  background: var(--black);
  color: var(--phos);
  font-family: var(--osd);
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}
#tp, #tp * { margin: 0; padding: 0; box-sizing: border-box; }
#tp ::selection { background: var(--buy); color: var(--black); }
#tp a { color: inherit; text-decoration: none; }
#tp button, #tp input { font-family: var(--osd); }

#tp .osd { letter-spacing: 0.18em; text-shadow: 0 0 6px rgba(232,240,228,0.25); }

/* ================= tape strip (scroll) ================= */
#strip {
  position: fixed; top: 0; left: 0; right: 0;
  height: 20px;
  z-index: 50;
  background: var(--console);
  border-bottom: 1px solid var(--splice);
  pointer-events: none;
}
#strip .head { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--phos); box-shadow: 0 0 8px rgba(232,240,228,0.8); }
#strip .tick { position: absolute; top: 5px; width: 2px; height: 10px; }
#strip .tc { position: absolute; right: 10px; top: 4px; font-size: 9px; color: var(--static); letter-spacing: 0.2em; font-variant-numeric: tabular-nums; }
#strip .lbl { position: absolute; left: 10px; top: 4px; font-size: 9px; color: var(--static); letter-spacing: 0.28em; }

/* ================= nav ================= */
#tp nav {
  position: fixed; top: 20px; left: 0; right: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 26px;
  z-index: 40;
}
#tp .logo { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 700; letter-spacing: 0.4em; }
#tp .logo .rec { width: 8px; height: 8px; border-radius: 50%; background: var(--sell); box-shadow: 0 0 8px var(--sell); animation: tp-blink 1.4s steps(2, start) infinite; }
#tp .logo .pl { color: var(--buy); }
@keyframes tp-blink { to { visibility: hidden; } }
#tp nav .links { display: flex; gap: 24px; font-size: 10px; color: var(--static); letter-spacing: 0.2em; }
#tp nav .links a { transition: color 0.15s; }
#tp nav .links a:hover { color: var(--phos); }
#tp nav .links a:focus-visible { outline: 1px solid var(--buy); outline-offset: 4px; }

/* ================= hero ================= */
#hero {
  position: relative;
  height: 100svh;
  min-height: 620px;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
}
#footage { position: absolute; inset: 0; }
#hero-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }

/* tracking glitch */
@keyframes tp-track-jitter {
  0% { transform: translateX(0) skewX(0); }
  15% { transform: translateX(-7px) skewX(-1.2deg); }
  30% { transform: translateX(5px) skewX(0.8deg); }
  45% { transform: translateX(-3px) skewX(-0.4deg); }
  60% { transform: translateX(6px) skewX(0.6deg); }
  80% { transform: translateX(-2px) skewX(0); }
  100% { transform: translateX(0) skewX(0); }
}
@keyframes tp-track-band {
  0% { top: -12%; opacity: 0.9; }
  100% { top: 108%; opacity: 0.4; }
}
#footage.glitching #hero-canvas { animation: tp-track-jitter 0.32s steps(7) 1; }
#footage .band {
  position: absolute; left: 0; right: 0;
  height: 9%;
  background: linear-gradient(to bottom, transparent, rgba(232,240,228,0.16), rgba(232,240,228,0.05), transparent);
  display: none;
  z-index: 4;
  pointer-events: none;
}
#footage.glitching .band { display: block; animation: tp-track-band 0.32s linear 1; }

/* burn-in */
#tp .burn {
  position: absolute;
  z-index: 5;
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--phos);
  text-shadow: 0 0 7px rgba(232,240,228,0.5), 0 0 1px rgba(232,240,228,0.9);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
#burn-tl { top: 64px; left: 26px; }
#burn-tl .pl { color: var(--buy); text-shadow: 0 0 7px rgba(76,224,126,0.6); }
#burn-br { bottom: 24px; right: 26px; display: flex; gap: 4px; align-items: baseline; }

/* tape counter : chiffres roulants */
#tp .counter { display: inline-flex; }
#tp .counter .dig { display: inline-block; height: 1em; overflow: hidden; line-height: 1; }
#tp .counter .dig .col { display: block; transition: transform 0.16s cubic-bezier(0.3, 0, 0.2, 1); }
#tp .counter .dig .col span { display: block; height: 1em; }
#tp .counter .sep { opacity: 0.6; }

#hero-inner {
  position: relative;
  z-index: 10;
  width: 100%;
  padding: 0 26px 9vh;
  max-width: 1160px;
  margin: 0 auto;
}
#tp .eyebrow { font-size: 10px; color: var(--static); letter-spacing: 0.32em; margin-bottom: 20px; }
#tp .eyebrow b { color: var(--buy); font-weight: 400; }
#tp h1 {
  font-family: var(--disp);
  font-weight: 400;
  text-transform: uppercase;
  font-size: clamp(64px, 12.5vw, 168px);
  line-height: 0.88;
  letter-spacing: 0.01em;
  max-width: 9ch;
}
#tp h1 .never { color: var(--sell); }
#tp .sub {
  margin-top: 26px;
  font-size: clamp(12px, 1.35vw, 14px);
  color: var(--static);
  line-height: 1.8;
  max-width: 54ch;
  letter-spacing: 0.04em;
}
#tp .sub b { color: var(--phos); font-weight: 500; }

#ca-form { margin-top: 32px; display: flex; gap: 10px; max-width: 640px; }
#ca-form input {
  flex: 1;
  min-width: 0;
  background: rgba(17,21,17,0.82);
  border: 1px solid var(--splice);
  color: var(--phos);
  font-size: 13px;
  padding: 16px 16px;
  letter-spacing: 0.04em;
  backdrop-filter: blur(4px);
  transition: border-color 0.15s;
}
#ca-form input::placeholder { color: var(--static); }
#ca-form input:focus { outline: none; border-color: var(--buy); box-shadow: 0 0 0 1px var(--buy); }
#ca-form button {
  background: var(--buy);
  color: var(--black);
  border: 0;
  padding: 0 30px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.24em;
  cursor: pointer;
  transition: background 0.15s;
}
#ca-form button:hover { background: var(--phos); }
#ca-form button:focus-visible { outline: 2px solid var(--phos); outline-offset: 3px; }
#ca-hint { margin-top: 12px; font-size: 10px; color: var(--static); letter-spacing: 0.14em; min-height: 14px; }
#ca-hint em { font-style: normal; color: var(--buy); }
#ca-demo {
  display: inline-block;
  margin-top: 10px;
  font-size: 10px; color: var(--static);
  letter-spacing: 0.14em;
  text-decoration: underline;
  text-decoration-color: var(--splice);
  transition: color 0.15s;
}
#ca-demo:hover { color: var(--phos); }

/* ================= evidence log ================= */
#log {
  border-top: 1px solid var(--splice);
  border-bottom: 1px solid var(--splice);
  background: var(--console);
  overflow: hidden;
  padding: 12px 0;
  white-space: nowrap;
}
#log .lane { display: inline-block; animation: tp-scrollx 60s linear infinite; }
@keyframes tp-scrollx { to { transform: translateX(-50%); } }
#log span.ln { font-size: 10px; color: var(--static); letter-spacing: 0.1em; margin-right: 60px; font-variant-numeric: tabular-nums; }
#log .t { color: var(--static); opacity: 0.7; }
#log .b { color: var(--buy); }
#log .s { color: var(--sell); }
#log .x { color: var(--seed); }
#log .rec { color: var(--phos); opacity: 0.5; }

/* ================= sections ================= */
#tp section { padding: 130px 26px; max-width: 1160px; margin: 0 auto; }
#tp .kicker { font-size: 10px; color: var(--static); letter-spacing: 0.32em; margin-bottom: 18px; }
#tp .kicker b { color: var(--buy); font-weight: 400; margin-right: 10px; }
#tp h2 {
  font-family: var(--disp);
  font-weight: 400;
  text-transform: uppercase;
  font-size: clamp(40px, 6vw, 84px);
  line-height: 0.92;
  letter-spacing: 0.01em;
}
#tp .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.6s ease, transform 0.6s ease; }
#tp .reveal.in { opacity: 1; transform: none; }

/* --- exhibits --- */
#exhibits .grid { margin-top: 60px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
#tp .monitor { background: var(--console); border: 1px solid var(--splice); transition: border-color 0.2s; }
#tp .monitor:hover { border-color: var(--static); }
#tp .monitor .screen { position: relative; overflow: hidden; }
#tp .monitor canvas { display: block; width: 100%; height: 200px; }
#tp .monitor .plate { border-top: 1px solid var(--splice); padding: 16px 18px 20px; }
#tp .monitor .plate .id { font-size: 11px; letter-spacing: 0.26em; }
#tp .monitor .plate .id .a { color: var(--buy); }
#tp .monitor .plate .id .b { color: var(--sell); }
#tp .monitor .plate .id .c { color: var(--seed); }
#tp .monitor .plate p { margin-top: 8px; font-size: 11px; color: var(--static); line-height: 1.7; letter-spacing: 0.05em; }

/* --- packets --- */
#packets .wrap { margin-top: 60px; display: grid; grid-template-columns: 1fr auto; gap: 70px; align-items: center; }
#packets .copy p { margin-top: 22px; font-size: 12px; color: var(--static); line-height: 1.85; max-width: 46ch; letter-spacing: 0.05em; }
#packets .copy p b { color: var(--phos); font-weight: 500; }
#tp .still { margin-top: 34px; position: relative; border: 1px solid var(--splice); background: var(--console); max-width: 460px; overflow: hidden; }
#tp .still canvas { display: block; width: 100%; height: 250px; }
#tp .still .tag {
  position: absolute; top: 10px; left: 12px;
  font-size: 9px; letter-spacing: 0.26em; color: var(--phos);
  text-shadow: 0 0 6px rgba(232,240,228,0.5);
  z-index: 5;
}
#phone { width: 246px; height: 512px; border: 1px solid var(--splice); background: var(--console); padding: 9px; position: relative; }
#phone .screen { position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--black); }
#phone canvas { width: 100%; height: 100%; display: block; }
#phone .fmt { position: absolute; bottom: -26px; left: 0; right: 0; text-align: center; font-size: 9px; color: var(--static); letter-spacing: 0.26em; }

/* --- $TAPE ledger --- */
#token .ledger { margin-top: 60px; border: 1px solid var(--splice); background: var(--console); max-width: 720px; }
#token .row { display: grid; grid-template-columns: 140px 1fr; gap: 20px; padding: 26px 28px; align-items: baseline; }
#token .row + .row { border-top: 1px solid var(--splice); }
#token .row .k { font-size: 10px; letter-spacing: 0.3em; color: var(--buy); }
#token .row p { font-size: 13px; letter-spacing: 0.05em; line-height: 1.7; }
#token .row p span { color: var(--static); }
#token .note { margin-top: 18px; font-size: 10px; color: var(--static); letter-spacing: 0.14em; }
#token .note a { color: var(--phos); border-bottom: 1px solid var(--splice); }
#token .note a:hover { border-color: var(--phos); }

/* --- final --- */
#final { text-align: center; padding-bottom: 150px; }
#final h2 .pl { color: var(--buy); }
#final .go {
  display: inline-block;
  margin-top: 42px;
  background: var(--buy);
  color: var(--black);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.26em;
  padding: 18px 46px;
  transition: background 0.15s, transform 0.15s;
}
#final .go:hover { background: var(--phos); transform: translateY(-2px); }
#final .go:focus-visible { outline: 2px solid var(--phos); outline-offset: 3px; }

#tp footer {
  border-top: 1px solid var(--splice);
  padding: 24px 26px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 9px;
  color: var(--static);
  letter-spacing: 0.24em;
  flex-wrap: wrap;
  gap: 12px;
}
#tp footer .l a { margin-left: 24px; transition: color 0.15s; }
#tp footer .l a:hover { color: var(--phos); }

@media (max-width: 900px) {
  #exhibits .grid { grid-template-columns: 1fr; }
  #packets .wrap { grid-template-columns: 1fr; gap: 64px; }
  #phone { margin: 0 auto; }
  #token .row { grid-template-columns: 1fr; gap: 8px; }
}
@media (max-width: 600px) {
  #tp nav .links { gap: 14px; }
  #tp section { padding: 90px 20px; }
  #ca-form { flex-direction: column; }
  #ca-form button { padding: 16px; }
  #burn-tl { left: 20px; }
  #burn-br { right: 20px; }
}

@media (prefers-reduced-motion: reduce) {
  #tp .logo .rec { animation: none; }
  #log .lane { animation: none; }
  #tp .reveal { opacity: 1; transform: none; transition: none; }
  #footage.glitching #hero-canvas, #footage.glitching .band { animation: none; display: none; }
  #tp .counter .dig .col { transition: none; }
}
`;

/* ---------- demo scenario types (landing-only, seeded fiction) ---------- */
type DemoWallet = { id: string; label: string; type: string };
type DemoEvent = {
  t: number;
  type: "buy" | "sell" | "xfer";
  from: string;
  to: string;
  tokens: number;
  usd: number;
  priceAfter: number;
};
type DemoScenario = {
  sym: string;
  wallets: DemoWallet[];
  evs: DemoEvent[];
  init: Record<string, number>;
  appear: Record<string, number>;
  price0: number;
};
type Pt = { x: number; y: number; ph?: number };

const WINDOW = 7200;
const ANIM = 120;
const SUPPLY = 1000;

const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const fakeAddr = (rng: () => number) => {
  let a = "",
    z = "";
  for (let i = 0; i < 4; i++) {
    a += B58[(rng() * B58.length) | 0];
    z += B58[(rng() * B58.length) | 0];
  }
  return a + "…" + z;
};
const symbolFrom = (ca: string, rng: () => number) => {
  const L = (ca.replace(/[^A-Za-z]/g, "") || "TAPE").toUpperCase();
  let s = "";
  const n = 3 + ((rng() * 2) | 0);
  for (let i = 0; i < n; i++) s += L[(rng() * L.length) | 0];
  return s;
};

function generateScenario(ca: string): DemoScenario {
  const rng = mulberry32(hashStr(ca || "tape"));
  const sym = symbolFrom(ca || "tape", rng);
  const wallets: DemoWallet[] = [
    { id: "pool", label: "lp pool", type: "pool" },
    { id: "dep", label: "deployer", type: "dep" },
  ];
  const holdings: Record<string, number> = { pool: SUPPLY * 0.78, dep: SUPPLY * 0.22 };
  const fresh: string[] = [],
    buyers: string[] = [];
  const nF = 2 + ((rng() * 2) | 0),
    nB = 4 + ((rng() * 3) | 0);
  for (let i = 0; i < nF; i++) {
    const id = "f" + i;
    fresh.push(id);
    wallets.push({ id, label: fakeAddr(rng), type: "fresh" });
    holdings[id] = 0;
  }
  for (let i = 0; i < nB; i++) {
    const id = "w" + i;
    buyers.push(id);
    wallets.push({ id, label: fakeAddr(rng), type: "wallet" });
    holdings[id] = 0;
  }
  wallets.push({ id: "whale", label: fakeAddr(rng), type: "whale" });
  holdings.whale = 0;

  const liq = 15000 + rng() * 20000;
  let priceM = (liq / (SUPPLY * 0.78)) * (0.8 + rng() * 0.6);
  const price0 = priceM;
  const evs: DemoEvent[] = [];
  const impact = (usd: number, d: number) => {
    priceM *= Math.max(0.4, 1 + d * (usd / liq) * (0.35 + rng() * 0.3));
  };
  const buy = (t: number, who: string, usd: number) => {
    const tk = Math.min(usd / priceM, holdings.pool * 0.4);
    impact(usd, 1);
    holdings.pool -= tk;
    holdings[who] += tk;
    evs.push({ t, type: "buy", from: "pool", to: who, tokens: tk, usd, priceAfter: priceM });
  };
  const sell = (t: number, who: string, fr: number) => {
    const tk = holdings[who] * fr;
    if (tk <= 0.01) return;
    const usd = tk * priceM;
    impact(usd, -1);
    holdings[who] -= tk;
    holdings.pool += tk;
    evs.push({ t, type: "sell", from: who, to: "pool", tokens: tk, usd, priceAfter: priceM });
  };
  const xfer = (t: number, a: string, b: string, tk: number) => {
    tk = Math.min(tk, holdings[a]);
    holdings[a] -= tk;
    holdings[b] += tk;
    evs.push({ t, type: "xfer", from: a, to: b, tokens: tk, usd: tk * priceM, priceAfter: priceM });
  };

  let t = 90 + rng() * 120;
  for (const f of fresh) {
    xfer(Math.round(t), "dep", f, SUPPLY * (0.03 + rng() * 0.04));
    t += 60 + rng() * 120;
  }
  const bts: number[] = [];
  for (let i = 0; i < nB * 2; i++) bts.push(400 + rng() * 3800);
  bts.sort((a, b) => a - b).forEach((bt, i) => buy(Math.round(bt), buyers[i % nB], 150 + rng() * 2200));
  buy(Math.round(2200 + rng() * 1200), "whale", 4000 + rng() * 5000);
  sell(Math.round(3000 + rng() * 1200), buyers[0], 0.4 + rng() * 0.3);
  let dt = 5100 + rng() * 400;
  for (const f of fresh) {
    sell(Math.round(dt), f, 0.85 + rng() * 0.15);
    dt += 40 + rng() * 90;
  }
  sell(Math.round(dt + 200 + rng() * 300), buyers[2 % nB], 0.8);
  if (rng() > 0.3) sell(Math.round(dt + 500 + rng() * 400), "whale", 0.5 + rng() * 0.4);
  sell(Math.round(Math.min(dt + 800 + rng() * 500, WINDOW - 150)), buyers[3 % nB], 0.9);
  evs.sort((a, b) => a.t - b.t);

  const init: Record<string, number> = { pool: SUPPLY * 0.78, dep: SUPPLY * 0.22 };
  wallets.forEach((w) => {
    if (!(w.id in init)) init[w.id] = 0;
  });
  const appear: Record<string, number> = { pool: 0, dep: 0 };
  for (const e of evs) {
    if (!(e.from in appear)) appear[e.from] = e.t;
    if (!(e.to in appear)) appear[e.to] = e.t;
  }
  wallets.forEach((w) => {
    if (!(w.id in appear)) appear[w.id] = 0;
  });

  return { sym, wallets, evs, init, appear, price0 };
}

function stateAt(S: DemoScenario, T: number) {
  const b: Record<string, number> = Object.assign({}, S.init);
  let price = S.price0;
  for (const e of S.evs) {
    if (T <= e.t) continue;
    const k = ease(Math.min((T - e.t) / ANIM, 1));
    b[e.from] -= e.tokens * k;
    b[e.to] += e.tokens * k;
    price = price + (e.priceAfter - price) * k;
    if (k >= 1) price = e.priceAfter;
  }
  return { b, price };
}

const fmt = (t: number) => {
  const s = Math.floor(t);
  return (
    String((s / 3600) | 0).padStart(2, "0") +
    ":" +
    String(((s % 3600) / 60) | 0).padStart(2, "0") +
    ":" +
    String(s % 60).padStart(2, "0")
  );
};

export function Landing() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const reseedRef = useRef<(ca: string) => string>(() => "");
  const [value, setValue] = useState("");
  const [hint, setHint] = useState<ReactNode>(
    <>
      any address reseeds the footage behind this page. <em>demo reel</em>
    </>
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const m = value.trim();
    if (isValidAddress(m)) {
      setHint(
        <>
          pulling the tape for <em>{truncAddr(m)}</em> — rebuilding the footage…
        </>
      );
      router.push(`/t/${m}?w=1h`);
      return;
    }
    const sym = reseedRef.current(m || String(Math.random()));
    setHint(
      m ? (
        <>
          not a valid contract address — now playing <em>{"$" + sym}</em> instead. <em>demo reel</em>
        </>
      ) : (
        <>
          now playing <em>{"$" + sym}</em> · demo reel. the app plays real footage (solana · base · robinhood chain)
        </>
      )
    );
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let alive = true;
    let rafHero = 0;
    let rafMini = 0;
    const cleanups: (() => void)[] = [];
    const observers: IntersectionObserver[] = [];
    const on = <K extends keyof WindowEventMap>(
      ev: K,
      fn: (e: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions
    ) => {
      window.addEventListener(ev, fn, opts);
      cleanups.push(() => window.removeEventListener(ev, fn, opts));
    };

    const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!REDUCED) {
      document.documentElement.style.scrollBehavior = "smooth";
      cleanups.push(() => {
        document.documentElement.style.scrollBehavior = "";
      });
    }

    const css = (v: string) => getComputedStyle(root).getPropertyValue(v).trim();
    const COL = {
      buy: css("--buy"),
      sell: css("--sell"),
      seed: css("--seed"),
      pool: css("--pool"),
      phos: css("--phos"),
      static: css("--static"),
      splice: css("--splice"),
    };
    const OSD = css("--osd");

    const $ = (id: string) => root.querySelector<HTMLElement>("#" + id)!;

    function fitCanvas(cv: HTMLCanvasElement) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = cv.getBoundingClientRect();
      cv.width = r.width * dpr;
      cv.height = r.height * dpr;
      const c = cv.getContext("2d")!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { ctx: c, W: r.width, H: r.height };
    }

    function flow(
      ctx: CanvasRenderingContext2D,
      a: Pt,
      z: Pt,
      u: number,
      color: string,
      usd: number,
      dashed: boolean
    ) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash(dashed ? [2, 4] : [4, 6]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(z.x, z.y);
      ctx.stroke();
      ctx.restore();

      const n = Math.min(3 + Math.round((usd || 1000) / 800), 12);
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 9;
      ctx.fillStyle = color;
      for (let i = 0; i < n; i++) {
        let p = u - i * 0.05;
        if (p < 0 || p > 1) continue;
        p = ease(p);
        ctx.beginPath();
        ctx.arc(a.x + (z.x - a.x) * p, a.y + (z.y - a.y) * p, Math.max(3.1 - i * 0.2, 1.1), 0, Math.PI * 2);
        ctx.fill();
      }
      const hp = ease(clamp01(u));
      const hx = a.x + (z.x - a.x) * hp,
        hy = a.y + (z.y - a.y) * hp;
      const ang = Math.atan2(z.y - a.y, z.x - a.x);
      ctx.beginPath();
      ctx.moveTo(hx + Math.cos(ang) * 8, hy + Math.sin(ang) * 8);
      ctx.lineTo(hx + Math.cos(ang + 2.5) * 6, hy + Math.sin(ang + 2.5) * 6);
      ctx.lineTo(hx + Math.cos(ang - 2.5) * 6, hy + Math.sin(ang - 2.5) * 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function bubble(
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      r: number,
      color: string,
      label: string | null,
      pulse: number,
      alpha: number
    ) {
      ctx.save();
      ctx.globalAlpha = alpha ?? 1;
      if (pulse > 0) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 18 * pulse;
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(232,240,228,0.035)";
      ctx.fill();
      ctx.lineWidth = 1.3 + (pulse || 0);
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (label) {
        ctx.textAlign = "center";
        ctx.font = "600 9px " + OSD;
        ctx.fillStyle = COL.static;
        ctx.fillText(label, x, y - r - 7);
      }
      ctx.restore();
    }

    const typeColor = (t: string) =>
      t === "pool" ? COL.pool : t === "dep" || t === "fresh" ? COL.seed : t === "whale" ? COL.phos : COL.static;
    const flowColor = (e: DemoEvent) => (e.type === "buy" ? COL.buy : e.type === "sell" ? COL.sell : COL.seed);
    const radius = (tk: number) => Math.max(11, 9 + Math.sqrt(Math.max(tk, 0)) * 1.9);

    /* ================= tape counter (rolling digits) ================= */
    function makeCounter(el: HTMLElement, template: string) {
      const digs: HTMLElement[] = [];
      el.innerHTML = "";
      for (const ch of template) {
        if (ch >= "0" && ch <= "9") {
          const d = document.createElement("span");
          d.className = "dig";
          const col = document.createElement("span");
          col.className = "col";
          for (let i = 0; i <= 9; i++) {
            const s = document.createElement("span");
            s.textContent = String(i);
            col.appendChild(s);
          }
          d.appendChild(col);
          el.appendChild(d);
          digs.push(col);
        } else {
          const s = document.createElement("span");
          s.className = "sep";
          s.textContent = ch;
          el.appendChild(s);
        }
      }
      return (str: string) => {
        let j = 0;
        for (const ch of str) {
          if (ch >= "0" && ch <= "9") {
            digs[j].style.transform = "translateY(-" + ch + "em)";
            j++;
          }
        }
      };
    }
    const setHeroTc = makeCounter($("tc-counter"), "00:00:00");

    /* ================= HERO footage ================= */
    const heroCv = $("hero-canvas") as HTMLCanvasElement;
    const footageEl = $("footage");
    const hero: {
      S: DemoScenario | null;
      ctx: CanvasRenderingContext2D | null;
      W: number;
      H: number;
      pos: Record<string, Pt>;
      T: number;
      visible: boolean;
    } = { S: null, ctx: null, W: 0, H: 0, pos: {}, T: 0, visible: true };

    function heroLayout() {
      const f = fitCanvas(heroCv);
      hero.ctx = f.ctx;
      hero.W = f.W;
      hero.H = f.H;
      if (!hero.S) return;
      const cx = hero.W * (hero.W > 760 ? 0.66 : 0.5);
      const cy = hero.H * 0.4;
      hero.pos.pool = { x: cx, y: cy };
      const others = hero.S.wallets.filter((w) => w.id !== "pool");
      const R = Math.min(hero.W, hero.H) * 0.33;
      others.forEach((w, i) => {
        const a = (i / others.length) * Math.PI * 2 - Math.PI / 2;
        hero.pos[w.id] = { x: cx + Math.cos(a) * R * 1.18, y: cy + Math.sin(a) * R * 0.85, ph: i * 1.7 };
      });
    }

    function loadHero(ca: string, glitch: boolean) {
      hero.S = generateScenario(ca);
      hero.T = 0;
      ($("burn-sym") as HTMLElement).textContent = "$" + hero.S.sym;
      heroLayout();
      buildLog();
      buildStripTicks();
      if (glitch && !REDUCED) {
        footageEl.classList.remove("glitching");
        void footageEl.offsetWidth; // reflow pour relancer l'anim
        footageEl.classList.add("glitching");
        window.setTimeout(() => footageEl.classList.remove("glitching"), 360);
      }
    }

    const HERO_SPEED = 85;
    let heroLast = 0;
    function heroFrame(ts: number) {
      if (!alive) return;
      rafHero = requestAnimationFrame(heroFrame);
      if (!hero.visible || !hero.S) {
        heroLast = ts;
        return;
      }
      const dt = Math.min((ts - heroLast) / 1000, 0.1);
      heroLast = ts;
      hero.T += dt * HERO_SPEED;
      if (hero.T > WINDOW + 400) hero.T = 0;
      drawHero(hero.T, ts / 1000);
      setHeroTc(fmt(Math.min(hero.T, WINDOW)));
    }

    function drawHero(T: number, wall: number) {
      const { ctx, W, H, S, pos } = hero;
      if (!ctx || !S) return;
      ctx.clearRect(0, 0, W, H);

      const st8 = stateAt(S, T);
      const dp: Record<string, Pt> = {};
      for (const w of S.wallets) {
        const p = pos[w.id];
        dp[w.id] =
          w.id === "pool"
            ? { x: p.x, y: p.y }
            : { x: p.x + Math.sin(wall * 0.4 + (p.ph || 0)) * 7, y: p.y + Math.cos(wall * 0.32 + (p.ph || 0)) * 6 };
      }

      for (const e of S.evs) {
        const u = (T - e.t) / ANIM;
        if (u < 0 || u > 1) continue;
        flow(ctx, dp[e.from], dp[e.to], u, flowColor(e), e.usd, e.type === "xfer");
      }
      for (const w of S.wallets) {
        const born = S.appear[w.id];
        if (T < born) continue;
        const fade = Math.min((T - born) / 60, 1) * 0.9;
        let pulse = 0;
        for (const e of S.evs) {
          if (e.from !== w.id && e.to !== w.id) continue;
          const u = (T - e.t) / ANIM;
          if (u >= 0 && u <= 1) pulse = Math.max(pulse, Math.sin(u * Math.PI));
        }
        const p = dp[w.id];
        const r = radius(st8.b[w.id]);
        bubble(ctx, p.x, p.y, r, typeColor(w.type), w.id === "pool" ? w.label : r > 16 ? w.label : null, pulse, fade);
      }
    }

    const heroIO = new IntersectionObserver((es) => es.forEach((e) => (hero.visible = e.isIntersecting)), {
      threshold: 0.05,
    });
    heroIO.observe(heroCv);
    observers.push(heroIO);
    on("resize", heroLayout);

    /* ================= evidence log ================= */
    const fmtTk = (m: number) => (m >= 1 ? Math.round(m) + "M" : Math.round(m * 1000) + "k");
    function buildLog() {
      const S = hero.S!;
      const lane = $("log-lane");
      const parts: string[] = [];
      for (const e of S.evs) {
        const usd = "$" + Math.round(e.usd).toLocaleString("en-US");
        const who = S.wallets.find((w) => w.id === (e.type === "buy" ? e.to : e.from))!;
        const t = '<span class="t">[T+' + fmt(e.t) + "]</span> ";
        if (e.type === "buy")
          parts.push(
            '<span class="ln">' + t + '<span class="b">▲ BUY ' + usd + "</span> · " + who.label + " · " + fmtTk(e.tokens) + " $" + S.sym + ' <span class="rec">· ON RECORD</span></span>'
          );
        else if (e.type === "sell")
          parts.push(
            '<span class="ln">' +
              t +
              '<span class="s">▼ SELL ' +
              usd +
              "</span> · " +
              (who.type === "fresh" ? "fresh wallet " : who.type === "whale" ? "whale " : "") +
              who.label +
              ' <span class="rec">· ON RECORD</span></span>'
          );
        else
          parts.push(
            '<span class="ln">' + t + '<span class="x">⇄ TRANSFER</span> · deployer seeds ' + fmtTk(e.tokens) + " $" + S.sym + ' to a fresh wallet <span class="rec">· ON RECORD</span></span>'
          );
      }
      const half = parts.join("");
      lane.innerHTML = half + half;
    }

    /* ================= vignettes (exhibits) ================= */
    type Vig = { cv: HTMLCanvasElement; kind: string; ctx: CanvasRenderingContext2D | null; W: number; H: number; visible: boolean };
    const vigs: Vig[] = [];
    root.querySelectorAll<HTMLCanvasElement>("[data-vig]").forEach((cv) => {
      const v: Vig = { cv, kind: cv.dataset.vig!, ctx: null, W: 0, H: 0, visible: false };
      const fit = () => {
        const f = fitCanvas(cv);
        v.ctx = f.ctx;
        v.W = f.W;
        v.H = f.H;
      };
      fit();
      on("resize", fit);
      vigs.push(v);
      const io = new IntersectionObserver((es) => es.forEach((e) => (v.visible = e.isIntersecting)), { threshold: 0.1 });
      io.observe(cv);
      observers.push(io);
    });

    const LOOP = 4.6;
    function drawVig(v: Vig, tt: number) {
      const { ctx, W, H, kind } = v;
      if (!ctx) return;
      const u = (tt % LOOP) / LOOP;
      ctx.clearRect(0, 0, W, H);

      if (kind === "buy") {
        const pool = { x: W * 0.26, y: H * 0.5 },
          w = { x: W * 0.74, y: H * 0.5 };
        const g = ease(clamp01((u - 0.15) / 0.5));
        const fu = (u - 0.1) / 0.55;
        if (fu > 0 && fu < 1) flow(ctx, pool, w, fu, COL.buy, 1600, false);
        bubble(ctx, pool.x, pool.y, 34 - g * 6, COL.pool, "pool", fu > 0 && fu < 1 ? Math.sin(clamp01(fu) * Math.PI) * 0.6 : 0, 1);
        bubble(ctx, w.x, w.y, 13 + g * 13, COL.static, "Ab3d…9xKq", 0, 1);
      }
      if (kind === "sell") {
        const w = { x: W * 0.74, y: H * 0.5 },
          pool = { x: W * 0.26, y: H * 0.5 };
        const g = ease(clamp01((u - 0.15) / 0.5));
        const fu = (u - 0.1) / 0.55;
        if (fu > 0 && fu < 1) flow(ctx, w, pool, fu, COL.sell, 2400, false);
        bubble(ctx, w.x, w.y, 26 - g * 13, COL.static, "Fj2N…7cVe", 0, 1);
        bubble(ctx, pool.x, pool.y, 28 + g * 6, COL.pool, "pool", fu > 0 && fu < 1 ? Math.sin(clamp01(fu) * Math.PI) * 0.6 : 0, 1);
      }
      if (kind === "bundle") {
        const dep = { x: W * 0.2, y: H * 0.32 };
        const pool = { x: W * 0.28, y: H * 0.74 };
        const fr = [
          { x: W * 0.62, y: H * 0.2 },
          { x: W * 0.78, y: H * 0.44 },
          { x: W * 0.64, y: H * 0.7 },
        ];
        fr.forEach((f, i) => {
          const su = (u - 0.02 - i * 0.05) / 0.28;
          if (su > 0 && su < 1) flow(ctx, dep, f, su, COL.seed, 600, true);
          const du = (u - 0.55 - i * 0.03) / 0.3;
          if (du > 0 && du < 1) flow(ctx, f, pool, du, COL.sell, 1800, false);
          const grew = ease(clamp01((u - 0.1 - i * 0.05) / 0.25));
          const shrunk = ease(clamp01((u - 0.55 - i * 0.03) / 0.3));
          bubble(ctx, f.x, f.y, 10 + grew * 9 - shrunk * 9, COL.seed, i === 0 ? "fresh" : null, 0, 1);
        });
        bubble(ctx, dep.x, dep.y, 20, COL.seed, "deployer", 0, 1);
        const poolG = ease(clamp01((u - 0.6) / 0.3));
        bubble(ctx, pool.x, pool.y, 22 + poolG * 5, COL.pool, "pool", 0, 1);
      }
    }

    /* ================= still 16:9 (frozen frame) ================= */
    const stillCv = $("still-canvas") as HTMLCanvasElement;
    function drawStill() {
      const { ctx, W, H } = fitCanvas(stillCv);
      const S = generateScenario("still-frame");
      const T = WINDOW * 0.72; // le moment du dump
      const cx = W * 0.5,
        cy = H * 0.46;
      const pos: Record<string, Pt> = { pool: { x: cx, y: cy } };
      const others = S.wallets.filter((w) => w.id !== "pool");
      const R = Math.min(W, H) * 0.4;
      others.forEach((w, i) => {
        const a = (i / others.length) * Math.PI * 2 - Math.PI / 2;
        pos[w.id] = { x: cx + Math.cos(a) * R * 1.35, y: cy + Math.sin(a) * R * 0.8 };
      });
      const st8 = stateAt(S, T);
      ctx.clearRect(0, 0, W, H);
      for (const e of S.evs) {
        const u = (T - e.t) / ANIM;
        if (u < 0 || u > 1) continue;
        flow(ctx, pos[e.from], pos[e.to], u, flowColor(e), e.usd, e.type === "xfer");
      }
      for (const w of S.wallets) {
        if (T < S.appear[w.id]) continue;
        const p = pos[w.id];
        bubble(ctx, p.x, p.y, radius(st8.b[w.id]) * 0.8, typeColor(w.type), null, 0, 0.95);
      }
      // pied de données bakée
      ctx.save();
      ctx.strokeStyle = COL.splice;
      ctx.beginPath();
      ctx.moveTo(10, H - 24);
      ctx.lineTo(W - 10, H - 24);
      ctx.stroke();
      ctx.font = "600 8px " + OSD;
      ctx.fillStyle = COL.static;
      ctx.textAlign = "left";
      ctx.fillText("WINDOW 2H · NET −$8,140 · 14 EVENTS", 12, H - 10);
      ctx.textAlign = "right";
      ctx.fillStyle = COL.sell;
      ctx.fillText("▼ THE DUMP · CAUGHT", W - 12, H - 10);
      ctx.restore();
    }

    /* ================= phone 9:16 (full tape loop) ================= */
    const phoneCv = $("phone-canvas") as HTMLCanvasElement;
    const phone: {
      S: DemoScenario;
      ctx: CanvasRenderingContext2D | null;
      W: number;
      H: number;
      pos: Record<string, Pt>;
      visible: boolean;
    } = { S: generateScenario("evidence-916"), ctx: null, W: 0, H: 0, pos: {}, visible: false };
    function phoneLayout() {
      const f = fitCanvas(phoneCv);
      phone.ctx = f.ctx;
      phone.W = f.W;
      phone.H = f.H;
      const cx = phone.W / 2,
        cy = phone.H * 0.45;
      phone.pos.pool = { x: cx, y: cy };
      const others = phone.S.wallets.filter((w) => w.id !== "pool");
      const R = phone.W * 0.36;
      others.forEach((w, i) => {
        const a = (i / others.length) * Math.PI * 2 - Math.PI / 2;
        phone.pos[w.id] = { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R * 1.35 };
      });
    }
    phoneLayout();
    on("resize", phoneLayout);
    {
      const io = new IntersectionObserver((es) => es.forEach((e) => (phone.visible = e.isIntersecting)), { threshold: 0.1 });
      io.observe(phoneCv);
      observers.push(io);
    }

    const PHONE_LOOP = 26;
    function drawPhone(tt: number) {
      const T = ((tt % PHONE_LOOP) / PHONE_LOOP) * WINDOW;
      const { ctx, W, H, S, pos } = phone;
      if (!ctx) return;
      const st8 = stateAt(S, T);
      ctx.clearRect(0, 0, W, H);

      // burn-in haut
      ctx.save();
      ctx.font = "600 8px " + OSD;
      ctx.fillStyle = COL.phos;
      ctx.shadowColor = "rgba(232,240,228,0.5)";
      ctx.shadowBlur = 4;
      ctx.textAlign = "left";
      ctx.fillText("TAPE ▸ $" + S.sym + " · PLAY", 12, 22);
      ctx.textAlign = "right";
      ctx.fillText("T+" + fmt(T), W - 12, 22);
      ctx.restore();

      const chg = (st8.price / S.price0 - 1) * 100;
      ctx.save();
      ctx.font = "700 9px " + OSD;
      ctx.fillStyle = chg >= 0 ? COL.buy : COL.sell;
      ctx.textAlign = "right";
      ctx.fillText((chg >= 0 ? "+" : "") + chg.toFixed(0) + "%", W - 12, 38);
      ctx.restore();

      for (const e of S.evs) {
        const u = (T - e.t) / ANIM;
        if (u < 0 || u > 1) continue;
        flow(ctx, pos[e.from], pos[e.to], u, flowColor(e), e.usd, e.type === "xfer");
      }
      for (const w of S.wallets) {
        if (T < S.appear[w.id]) continue;
        let pulse = 0;
        for (const e of S.evs) {
          if (e.from !== w.id && e.to !== w.id) continue;
          const u = (T - e.t) / ANIM;
          if (u >= 0 && u <= 1) pulse = Math.max(pulse, Math.sin(u * Math.PI));
        }
        const p = pos[w.id];
        bubble(ctx, p.x, p.y, radius(st8.b[w.id]) * 0.72, typeColor(w.type), null, pulse, 0.95);
      }

      let cap: string | null = null,
        capCol = COL.static;
      for (const e of S.evs)
        if (T >= e.t && T <= e.t + 240) {
          cap = (e.type === "buy" ? "▲ BUY" : e.type === "sell" ? "▼ SELL" : "⇄ TRANSFER") + " $" + Math.round(e.usd).toLocaleString("en-US");
          capCol = flowColor(e);
        }
      ctx.save();
      if (cap) {
        ctx.font = "700 10px " + OSD;
        ctx.fillStyle = capCol;
        ctx.textAlign = "center";
        ctx.fillText(cap, W / 2, H - 40);
      }
      ctx.strokeStyle = COL.splice;
      ctx.beginPath();
      ctx.moveTo(12, H - 24);
      ctx.lineTo(W - 12, H - 24);
      ctx.stroke();
      ctx.strokeStyle = COL.buy;
      ctx.beginPath();
      ctx.moveTo(12, H - 24);
      ctx.lineTo(12 + (W - 24) * (T / WINDOW), H - 24);
      ctx.stroke();
      ctx.font = "600 7px " + OSD;
      ctx.fillStyle = COL.static;
      ctx.textAlign = "right";
      ctx.fillText("THE TAPE NEVER LIES", W - 12, H - 10);
      ctx.restore();
    }

    /* ================= boucle secondaire ================= */
    function miniFrame(ts: number) {
      if (!alive) return;
      rafMini = requestAnimationFrame(miniFrame);
      const tt = ts / 1000;
      for (const v of vigs) if (v.visible) drawVig(v, tt);
      if (phone.visible) drawPhone(tt);
    }

    /* ================= strip scroll + reveals ================= */
    const stripHead = $("strip-head");
    const stripTc = $("strip-tc");
    const stripEl = $("strip");

    function buildStripTicks() {
      stripEl.querySelectorAll(".tick").forEach((el) => el.remove());
      for (const e of hero.S!.evs) {
        const el = document.createElement("div");
        el.className = "tick";
        el.style.left = (e.t / WINDOW) * 100 + "%";
        el.style.background = flowColor(e);
        stripEl.appendChild(el);
      }
    }
    function onScroll() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
      stripHead.style.left = p * 100 + "%";
      stripTc.textContent = fmt(p * WINDOW);
    }
    on("scroll", onScroll, { passive: true });

    const revIO = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("in");
        }),
      { threshold: 0.12 }
    );
    root.querySelectorAll(".reveal").forEach((el) => revIO.observe(el));
    observers.push(revIO);

    /* ================= boot ================= */
    loadHero("tape-genesis", false);
    drawStill();
    on("resize", drawStill);
    onScroll();

    reseedRef.current = (ca: string) => {
      loadHero(ca, true);
      if (REDUCED) {
        hero.T = WINDOW * 0.55;
        drawHero(hero.T, 0);
        setHeroTc(fmt(hero.T));
      }
      return hero.S!.sym;
    };

    if (REDUCED) {
      hero.T = WINDOW * 0.55;
      drawHero(hero.T, 0);
      setHeroTc(fmt(hero.T));
      for (const v of vigs) {
        v.visible = false;
        drawVig(v, LOOP * 0.5);
      }
      drawPhone(PHONE_LOOP * 0.4);
    } else {
      rafHero = requestAnimationFrame((ts) => {
        heroLast = ts;
        heroFrame(ts);
      });
      rafMini = requestAnimationFrame(miniFrame);
    }

    return () => {
      alive = false;
      cancelAnimationFrame(rafHero);
      cancelAnimationFrame(rafMini);
      observers.forEach((o) => o.disconnect());
      cleanups.forEach((f) => f());
      reseedRef.current = () => "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div id="tp" ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div id="strip" aria-hidden="true">
        <span className="lbl">TAPE 001</span>
        <div className="head" id="strip-head" style={{ left: "0%" }} />
        <span className="tc" id="strip-tc">
          00:00:00
        </span>
      </div>

      <nav>
        <a className="logo" href="#hero">
          <span className="rec" aria-hidden="true" />
          TAPE<span className="pl">▸</span>
        </a>
        <div className="links osd">
          <a href="#exhibits">exhibits</a>
          <a href="#packets">packets</a>
          <a href="#token">$tape</a>
          <Link href="/app">app</Link>
          <a href="https://x.com" target="_blank" rel="noreferrer" aria-label="Twitter / X">
            x.com
          </a>
        </div>
      </nav>

      {/* ================= HERO ================= */}
      <header id="hero">
        <div id="footage" className="scan">
          <canvas id="hero-canvas" aria-hidden="true" />
          <div className="band" aria-hidden="true" />
          <div className="burn" id="burn-tl">
            TAPE ▸ <span className="pl" id="burn-sym">$—</span> · PLAY
          </div>
          <div className="burn" id="burn-br">
            T+<span className="counter" id="tc-counter" aria-hidden="true" />
          </div>
        </div>

        <div id="hero-inner">
          <p className="eyebrow osd">
            <b>● REC</b> EVIDENCE PLAYBACK · SOLANA · BASE · RH CHAIN
          </p>
          <h1>
            the tape <span className="never">never</span> lies.
          </h1>
          <p className="sub">
            paste a contract address. <b>tape</b> rebuilds the last hours of a token — every buy, sell and
            wallet-to-wallet transfer — and plays the footage back. scrub it. inspect any wallet. export the proof.
          </p>
          <form id="ca-form" autoComplete="off" onSubmit={onSubmit}>
            <input
              id="ca-input"
              spellCheck={false}
              placeholder="paste a contract address…"
              aria-label="Contract address"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <button type="submit">▸ PLAY</button>
          </form>
          <p id="ca-hint" className="osd">
            {hint}
          </p>
          <Link id="ca-demo" href="/t/mock?mock=1">
            no CA handy? roll the demo tape
          </Link>
        </div>
      </header>

      {/* ================= EVIDENCE LOG ================= */}
      <div id="log" aria-hidden="true">
        <div className="lane" id="log-lane" />
      </div>

      {/* ================= EXHIBITS ================= */}
      <section id="exhibits">
        <p className="kicker osd reveal">
          <b>■</b>CASE FILE
        </p>
        <h2 className="reveal">
          three exhibits.
          <br />
          the whole language.
        </h2>
        <div className="grid">
          <div className="monitor reveal">
            <div className="screen scan">
              <canvas data-vig="buy" height={200} />
            </div>
            <div className="plate">
              <p className="id osd">
                <span className="a">EXHIBIT A</span> · THE BUY
              </p>
              <p>tokens leave the pool, the wallet inflates. green means someone stepped in. it&apos;s on record.</p>
            </div>
          </div>
          <div className="monitor reveal">
            <div className="screen scan">
              <canvas data-vig="sell" height={200} />
            </div>
            <div className="plate">
              <p className="id osd">
                <span className="b">EXHIBIT B</span> · THE DUMP
              </p>
              <p>the flow reverses. the bag drains back into the pool and the bubble deflates on camera.</p>
            </div>
          </div>
          <div className="monitor reveal">
            <div className="screen scan">
              <canvas data-vig="bundle" height={200} />
            </div>
            <div className="plate">
              <p className="id osd">
                <span className="c">EXHIBIT C</span> · THE BUNDLE
              </p>
              <p>deployer seeds fresh wallets at minute one. hours later they dump in sync. caught on tape.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ================= PACKETS ================= */}
      <section id="packets">
        <div className="wrap">
          <div className="copy">
            <p className="kicker osd reveal">
              <b>■</b>EVIDENCE PACKETS
            </p>
            <h2 className="reveal">
              freeze the frame.
              <br />
              or export the footage.
            </h2>
            <p className="reveal">
              one click turns any replay into a packet: <b>png for the still</b>, frozen at the exact moment a wallet
              got caught, <b>webm for the full tape</b> with timestamp, stats and captions burned in. 16:9 and 9:16,
              ready to post. when someone asks for proof, send the film.
            </p>
            <div className="still reveal scan">
              <span className="tag">TAPE ▸ $DEMO · STILL · T+01:24:56</span>
              <canvas id="still-canvas" aria-hidden="true" />
            </div>
          </div>
          <div id="phone" className="reveal">
            <div className="screen scan">
              <canvas id="phone-canvas" aria-hidden="true" />
            </div>
            <span className="fmt osd">9:16 · WEBM · 60FPS</span>
          </div>
        </div>
      </section>

      {/* ================= $TAPE ================= */}
      <section id="token">
        <p className="kicker osd reveal">
          <b>■</b>$TAPE
        </p>
        <h2 className="reveal">
          use the tool.
          <br />
          feed the loop.
        </h2>
        <div className="ledger reveal">
          <div className="row">
            <span className="k osd">ACCESS</span>
            <p>
              replays cost <b>$TAPE</b>. <span>paste a CA, pay per request, review the footage.</span>
            </p>
          </div>
          <div className="row">
            <span className="k osd">LOOP</span>
            <p>
              every fee the app generates buys <b>$TAPE</b> back.{" "}
              <span>more replays, more buybacks. on-chain, verifiable.</span>
            </p>
          </div>
        </div>
        <p className="note osd reveal">
          buyback wallet on record: <a href="https://solscan.io" target="_blank" rel="noreferrer">solscan ↗</a>
        </p>
      </section>

      {/* ================= FINAL ================= */}
      <section id="final">
        <h2 className="reveal">
          press <span className="pl">▸ play</span>
          <br />
          on any token.
        </h2>
        <Link className="go reveal" href="/app">
          OPEN THE DECK
        </Link>
      </section>

      <footer className="osd">
        <span>TAPE © 2026 · ON RECORD · SOLANA · BASE · RH · EVM</span>
        <span className="l">
          <a href="https://x.com" target="_blank" rel="noreferrer" aria-label="Twitter / X">
            x.com
          </a>
          <a href="https://github.com" target="_blank" rel="noreferrer">
            docs
          </a>
          <Link href="/app">deck</Link>
        </span>
      </footer>
    </div>
  );
}
