// TAPE replay engine — pure canvas, zero React.
// One instance per canvas. Drive it with frame(now) from any rAF loop
// (the app hook, the exporter, or the landing hero all reuse this).

import { buildCaption } from "./captions";
import { fmtTimecode, fmtUsd, fmtPct, fmtPrice, fmtTokens, fmtWallClock } from "@/lib/format";
import type { HolderInfo, LiveStats, NodeInfo, ReplayEvent, Scenario, WalletMeta, WalletTag } from "./types";

export const COLORS = {
  // TAPE — surveillance-tape DA
  bg: "#0B0D0B",
  panel: "#111511",
  hairline: "#212821",
  ink: "#E8F0E4",
  dim: "#6E7A6C",
  buy: "#4CE07E",
  sell: "#FF5A3C",
  pool: "#56C8E8",
  xfer: "#EFB13C",
} as const;

const ANIM = 1.1; // seconds (real time) a balance change takes to settle
const FLOW_MIN = 1.1;
const FLOW_MAX = 1.9;
const MAX_RING = 24; // wallets on the ellipse before long-tail grouping

type Node = {
  id: string; // 'pool' | 'retail' | wallet address
  label: string;
  tags: WalletTag[];
  members?: string[];
  angle: number; // position on the ellipse (pool ignores this)
  x: number;
  y: number;
  r: number;
  firstT: number; // sim time of first involvement (fade-in)
  appearReal: number; // real clock when fade-in started (-1 = not yet)
  alpha: number;
  hold: number; // displayed holdings (tweened)
  holdFrom: number;
  holdTo: number;
  tweenStart: number; // real seconds
  flash: number; // 0..1 border flash on activity
  flashColor: string;
};

type Flow = {
  ev: ReplayEvent;
  from: Node;
  to: Node;
  start: number; // real seconds
  dur: number;
  particles: number;
  color: string;
  dashed: boolean;
};

type Float = { x: number; y: number; text: string; color: string; start: number };
type Pulse = { node: Node; start: number; color: string };

export type EngineOptions = {
  hud?: boolean; // bake stats + captions + watermark into the canvas (export / hero)
  watermark?: string;
  loop?: boolean;
  ambient?: boolean; // landing hero: softer alpha, no interaction affordances
  reducedMotion?: boolean;
  portrait?: boolean; // 9:16 export re-layout
  pixelRatio?: number; // force a ratio (exports want exactly 1)
  onEvent?: (ev: ReplayEvent, caption: string) => void;
  onEnd?: () => void;
};

export class ReplayEngine {
  readonly scenario: Scenario;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private opts: EngineOptions;

  private w = 0;
  private h = 0;
  private dpr = 1;

  time = 0; // sim seconds from window start
  playing = false;
  speedMult = 1; // sim-time multiplier: 1 = real time, up to 128 (exports go higher)

  private nodes = new Map<string, Node>();
  private ringOrder: Node[] = [];
  private renderId = new Map<string, string>(); // wallet address -> node id
  private walletHold = new Map<string, number>(); // exact per-wallet holdings at `time`
  private metaByAddr = new Map<string, WalletMeta>();

  private eventIndex = 0;
  private flows: Flow[] = [];
  private floats: Float[] = [];
  private pulses: Pulse[] = [];
  private captionsRecent: string[] = [];

  private real = 0; // accumulated real seconds (monotonic)
  private lastNow = -1;

  private maxHold = 1; // max holdings any ring node ever reaches (radius scale)
  private statsShown: LiveStats;
  hoveredId: string | null = null;

  constructor(canvas: HTMLCanvasElement, scenario: Scenario, opts: EngineOptions = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
    this.scenario = scenario;
    this.opts = opts;
    for (const w of scenario.wallets) this.metaByAddr.set(w.address, w);
    this.buildNodes();
    this.statsShown = this.exactStats(0);
    this.resize();
    this.setTime(0);
    if (opts.reducedMotion) {
      this.setTime(scenario.windowSeconds * 0.4);
      this.render();
    }
  }

  // ---------------------------------------------------------------- setup

  private buildNodes() {
    const sc = this.scenario;

    // rank wallets by total USD involvement to decide who gets a ring slot
    const usdByWallet = new Map<string, number>();
    const firstT = new Map<string, number>();
    for (const ev of sc.events) {
      for (const a of [ev.from, ev.to]) {
        if (a === "pool") continue;
        usdByWallet.set(a, (usdByWallet.get(a) ?? 0) + ev.usd);
        if (!firstT.has(a)) firstT.set(a, ev.t);
      }
    }

    // wallets holding at window start are part of the cast from frame one
    const eps = sc.supply * 1e-9;
    const initTokens = (a: string) => sc.initialHoldings[a] ?? 0;
    const cast = new Set(usdByWallet.keys());
    for (const a of Object.keys(sc.initialHoldings)) {
      if (a !== "pool" && initTokens(a) > eps) cast.add(a);
    }
    // rank by event USD + starting position so the big holders keep ring slots
    const score = (a: string) => (usdByWallet.get(a) ?? 0) + initTokens(a) * sc.price0;
    const all = [...cast];
    let ringAddrs = all;
    let tail: string[] = [];
    if (all.length > MAX_RING) {
      const sorted = [...all].sort((a, b) => score(b) - score(a));
      ringAddrs = sorted.slice(0, MAX_RING - 1);
      tail = sorted.slice(MAX_RING - 1);
    }

    const mk = (id: string, label: string, tags: WalletTag[], t: number, members?: string[]): Node => ({
      id, label, tags, members,
      angle: 0, x: 0, y: 0, r: 0,
      firstT: t, appearReal: -1, alpha: 0,
      hold: 0, holdFrom: 0, holdTo: 0, tweenStart: -1,
      flash: 0, flashColor: COLORS.buy,
    });

    const pool = mk("pool", "POOL", ["pool"], 0);
    pool.alpha = 1;
    this.nodes.set("pool", pool);
    this.renderId.set("pool", "pool");

    for (const a of ringAddrs) {
      const meta = this.metaByAddr.get(a);
      // holders at window start are on screen before their first TX
      const born = initTokens(a) > eps ? 0 : firstT.get(a) ?? 0;
      const n = mk(a, meta?.label ?? a, meta?.tags ?? ["wallet"], born);
      this.nodes.set(a, n);
      this.renderId.set(a, a);
    }

    if (tail.length) {
      const t0 = tail.some((a) => initTokens(a) > eps)
        ? 0
        : Math.min(...tail.map((a) => firstT.get(a) ?? 0));
      const retail = mk("retail", `retail ×${tail.length}`, ["retail"], t0, tail);
      this.nodes.set("retail", retail);
      for (const a of tail) this.renderId.set(a, "retail");
    }

    // ellipse order = first appearance
    this.ringOrder = [...this.nodes.values()]
      .filter((n) => n.id !== "pool")
      .sort((a, b) => a.firstT - b.firstT);
    const N = Math.max(1, this.ringOrder.length);
    this.ringOrder.forEach((n, i) => (n.angle = -Math.PI / 2 + (i / N) * Math.PI * 2));

    // radius scale: simulate the whole window once, track the max any node holds
    const hold = new Map<string, number>();
    const nodeInit = (id: string) => {
      const n = this.nodes.get(id);
      if (!n) return 0;
      if (n.members) return n.members.reduce((s, a) => s + (this.scenario.initialHoldings[a] ?? 0), 0);
      return this.scenario.initialHoldings[id] ?? 0;
    };
    for (const id of this.nodes.keys()) {
      if (id === "pool") continue;
      hold.set(id, nodeInit(id));
    }
    let mx = Math.max(1, ...hold.values());
    for (const ev of sc.events) {
      const fromId = this.renderId.get(ev.from);
      const toId = this.renderId.get(ev.to);
      if (fromId && fromId !== "pool") hold.set(fromId, (hold.get(fromId) ?? 0) - ev.tokens);
      if (toId && toId !== "pool") {
        const v = (hold.get(toId) ?? 0) + ev.tokens;
        hold.set(toId, v);
        if (v > mx) mx = v;
      }
    }
    this.maxHold = mx;
  }

  resize() {
    const cw = this.canvas.clientWidth || this.canvas.width;
    const ch = this.canvas.clientHeight || this.canvas.height;
    this.dpr =
      this.opts.pixelRatio ??
      Math.min(2.5, (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1);
    this.canvas.width = Math.round(cw * this.dpr);
    this.canvas.height = Math.round(ch * this.dpr);
    this.w = cw;
    this.h = ch;
    this.layout();
    this.render();
  }

  private layout() {
    const hudTop = this.opts.hud ? (this.opts.portrait ? 96 : 64) : 0;
    const hudBottom = this.opts.hud ? (this.opts.portrait ? 132 : 84) : 0;
    const cy = hudTop + (this.h - hudTop - hudBottom) / 2;
    const cx = this.w / 2;
    const rx = (this.w / 2) * (this.opts.portrait ? 0.78 : 0.72);
    const ry = (this.h - hudTop - hudBottom) / 2 * (this.opts.portrait ? 0.8 : 0.72);
    const pool = this.nodes.get("pool");
    if (pool) { pool.x = cx; pool.y = cy; }
    for (const n of this.ringOrder) {
      n.x = cx + Math.cos(n.angle) * rx;
      n.y = cy + Math.sin(n.angle) * ry;
    }
  }

  // ---------------------------------------------------------------- clock

  setSpeed(mult: number) { this.speedMult = mult; }
  play() { this.playing = true; this.lastNow = -1; if (this.time >= this.scenario.windowSeconds) this.setTime(0); }
  pause() { this.playing = false; }
  restart() { this.setTime(0); this.play(); }

  /** Advance with a real-time clock (ms, e.g. performance.now()). Call every rAF. */
  frame(nowMs: number) {
    const now = nowMs / 1000;
    const dt = this.lastNow < 0 ? 0 : Math.min(0.1, now - this.lastNow);
    this.lastNow = now;
    this.real += dt;

    if (this.playing && dt > 0) {
      const target = this.time + dt * this.speedMult;
      this.advance(target);
      if (this.time >= this.scenario.windowSeconds) {
        if (this.opts.loop) {
          this.setTime(0);
        } else {
          this.playing = false;
          this.opts.onEnd?.();
        }
      }
    }
    this.tickVisuals();
    this.render();
  }

  /** Fire everything between current time and target, in order. */
  private advance(target: number) {
    const sc = this.scenario;
    const end = Math.min(target, sc.windowSeconds);
    while (this.eventIndex < sc.events.length && sc.events[this.eventIndex].t <= end) {
      this.fire(sc.events[this.eventIndex]);
      this.eventIndex++;
    }
    this.time = end;
    this.easeStatsToward(this.exactStats(this.time));
  }

  /** Hard jump (scrub / tick click). Deterministic: recompute state, drop animations. */
  setTime(t: number) {
    const sc = this.scenario;
    this.time = Math.max(0, Math.min(sc.windowSeconds, t));
    this.flows = [];
    this.floats = [];
    this.pulses = [];

    // exact per-wallet holdings
    this.walletHold.clear();
    for (const [addr, v] of Object.entries(sc.initialHoldings)) this.walletHold.set(addr, v);
    this.eventIndex = 0;
    while (this.eventIndex < sc.events.length && sc.events[this.eventIndex].t <= this.time) {
      const ev = sc.events[this.eventIndex];
      if (ev.from !== "pool") this.walletHold.set(ev.from, (this.walletHold.get(ev.from) ?? 0) - ev.tokens);
      if (ev.to !== "pool") this.walletHold.set(ev.to, (this.walletHold.get(ev.to) ?? 0) + ev.tokens);
      this.eventIndex++;
    }

    // snap node display state
    for (const n of this.nodes.values()) {
      const v = this.nodeExactHold(n);
      n.hold = v; n.holdFrom = v; n.holdTo = v; n.tweenStart = -1;
      n.alpha = n.id === "pool" || n.firstT <= this.time ? 1 : 0;
      n.appearReal = n.alpha > 0 ? 0 : -1;
      n.flash = 0;
    }

    this.captionsRecent = sc.events
      .slice(Math.max(0, this.eventIndex - 3), this.eventIndex)
      .map((ev) => buildCaption(ev, (a) => this.metaByAddr.get(a), sc.symbol));

    this.statsShown = this.exactStats(this.time);
    this.render();
  }

  private nodeExactHold(n: Node): number {
    if (n.id === "pool") {
      // pool baseline drifts with net token flow (sells add, buys remove)
      let net = 0;
      for (let i = 0; i < this.eventIndex; i++) {
        const ev = this.scenario.events[i];
        if (ev.to === "pool") net += ev.tokens;
        if (ev.from === "pool") net -= ev.tokens;
      }
      return Math.max(this.scenario.poolBaseline * 0.3, this.scenario.poolBaseline + net);
    }
    if (n.members) return n.members.reduce((s, a) => s + Math.max(0, this.walletHold.get(a) ?? 0), 0);
    return Math.max(0, this.walletHold.get(n.id) ?? 0);
  }

  private fire(ev: ReplayEvent) {
    // exact ledger
    if (ev.from !== "pool") this.walletHold.set(ev.from, (this.walletHold.get(ev.from) ?? 0) - ev.tokens);
    if (ev.to !== "pool") this.walletHold.set(ev.to, (this.walletHold.get(ev.to) ?? 0) + ev.tokens);

    const fromId = this.renderId.get(ev.from);
    const toId = this.renderId.get(ev.to);
    const from = fromId ? this.nodes.get(fromId) : undefined;
    const to = toId ? this.nodes.get(toId) : undefined;
    const color = ev.type === "buy" ? COLORS.buy : ev.type === "sell" ? COLORS.sell : COLORS.xfer;

    for (const n of [from, to]) {
      if (!n) continue;
      if (n.appearReal < 0) { n.appearReal = this.real; }
      // retween holdings from current display value
      const v = this.nodeExactHold(n);
      n.holdFrom = n.hold;
      n.holdTo = v;
      n.tweenStart = this.real;
      n.flash = 1;
      n.flashColor = color;
    }

    if (from && to && from !== to) {
      const dur = FLOW_MIN + Math.min(1, Math.log10(1 + ev.usd) / 6) * (FLOW_MAX - FLOW_MIN);
      this.flows.push({
        ev, from, to,
        start: this.real,
        // shrink with speed so flows don't lag the clock, but never below legibility
        dur: Math.max(0.35, dur / Math.sqrt(this.speedMult)),
        particles: 3 + Math.min(11, Math.floor(Math.log10(1 + ev.usd) * 2.2)),
        color,
        dashed: ev.type === "xfer",
      });
      const sign = ev.type === "sell" ? "−" : "+";
      this.floats.push({
        x: to.x + (from.x - to.x) * 0.25,
        y: to.y + (from.y - to.y) * 0.25 - 14,
        text: `${sign}${fmtUsd(ev.usd)}`,
        color,
        start: this.real,
      });
      this.pulses.push({ node: to, start: this.real, color });
    }

    const caption = buildCaption(ev, (a) => this.metaByAddr.get(a), this.scenario.symbol);
    this.captionsRecent.push(caption);
    if (this.captionsRecent.length > 3) this.captionsRecent.shift();
    this.opts.onEvent?.(ev, caption);
  }

  private tickVisuals() {
    for (const n of this.nodes.values()) {
      // balance tween, ease-in-out — bubbles breathe
      if (n.tweenStart >= 0) {
        const p = Math.min(1, (this.real - n.tweenStart) / ANIM);
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        n.hold = n.holdFrom + (n.holdTo - n.holdFrom) * e;
        if (p >= 1) n.tweenStart = -1;
      }
      // fade in at first event
      if (n.alpha < 1 && n.appearReal >= 0) {
        n.alpha = Math.min(1, (this.real - n.appearReal) / 0.8);
      }
      n.flash = Math.max(0, n.flash - 0.02);
    }
    this.flows = this.flows.filter((f) => this.real - f.start < f.dur + 0.4);
    this.floats = this.floats.filter((f) => this.real - f.start < 2.2);
    this.pulses = this.pulses.filter((p) => this.real - p.start < 0.9);
  }

  private easeStatsToward(target: LiveStats) {
    const k = 0.18;
    const s = this.statsShown;
    s.time = target.time;
    s.price += (target.price - s.price) * k;
    s.priceChangePct += (target.priceChangePct - s.priceChangePct) * k;
    s.mcap += (target.mcap - s.mcap) * k;
    s.volume += (target.volume - s.volume) * k;
    s.buys = target.buys;
    s.sells = target.sells;
    s.xfers = target.xfers;
    s.holders = target.holders;
  }

  private exactStats(t: number): LiveStats {
    const sc = this.scenario;
    let volume = 0, buys = 0, sells = 0, xfers = 0;
    let price = sc.price0;
    for (const ev of sc.events) {
      if (ev.t > t) break;
      volume += ev.usd;
      if (ev.type === "buy") buys++;
      else if (ev.type === "sell") sells++;
      else xfers++;
      price = ev.priceAfter;
    }
    // holders: exact wallet ledger at scrub time; during play walletHold is already current
    let holders = 0;
    const eps = sc.supply * 1e-9;
    for (const v of this.walletHold.values()) if (v > eps) holders++;
    return {
      time: t,
      price,
      priceChangePct: sc.price0 > 0 ? ((price - sc.price0) / sc.price0) * 100 : 0,
      mcap: price * sc.supply,
      volume, buys, sells, xfers, holders,
    };
  }

  getStats(): LiveStats { return { ...this.statsShown }; }
  getCaptions(): string[] { return [...this.captionsRecent]; }

  /** Live top holders at the current sim time (exact ledger, pool excluded). */
  getTopHolders(count = 10): HolderInfo[] {
    const sc = this.scenario;
    const eps = sc.supply * 1e-9;
    const price = this.eventIndex > 0 ? sc.events[this.eventIndex - 1].priceAfter : sc.price0;
    const rows: HolderInfo[] = [];
    for (const [addr, v] of this.walletHold) {
      if (addr === "pool" || v <= eps) continue;
      const meta = this.metaByAddr.get(addr);
      rows.push({
        address: addr,
        label: meta?.label ?? addr,
        tags: meta?.tags ?? ["wallet"],
        holdings: v,
        pctSupply: sc.supply > 0 ? (v / sc.supply) * 100 : 0,
        usd: v * price,
        delta: v - (sc.initialHoldings[addr] ?? 0),
      });
    }
    rows.sort((a, b) => b.holdings - a.holdings);
    return rows.slice(0, count);
  }

  // ---------------------------------------------------------------- interaction

  setHover(x: number | null, y?: number) {
    this.hoveredId = x === null || y === undefined ? null : this.hitTest(x, y);
  }

  hitTest(x: number, y: number): string | null {
    let best: Node | null = null;
    for (const n of this.nodes.values()) {
      if (n.alpha <= 0) continue;
      const d = Math.hypot(x - n.x, y - n.y);
      if (d <= Math.max(14, n.r + 6) && (!best || n.r < best.r)) best = n;
    }
    return best ? best.id : null;
  }

  getNodeInfo(id: string): NodeInfo | null {
    const n = this.nodes.get(id);
    if (!n) return null;
    return { id: n.id, label: n.label, tags: n.tags, holdings: this.nodeExactHold(n), members: n.members };
  }

  // ---------------------------------------------------------------- render

  private radius(n: Node): number {
    const s = Math.min(this.w, this.h);
    if (n.id === "pool") {
      const base = Math.max(30, Math.min(60, s * 0.085));
      const ratio = this.scenario.poolBaseline > 0 ? n.hold / this.scenario.poolBaseline : 1;
      return base * Math.max(0.85, Math.min(1.18, 0.6 + 0.4 * Math.sqrt(Math.max(0.1, ratio))));
    }
    const minR = 6;
    const maxR = Math.max(16, Math.min(34, s * 0.05));
    return minR + (maxR - minR) * Math.sqrt(Math.max(0, n.hold) / this.maxHold);
  }

  render() {
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    // soft radial vignette behind the pool
    const pool = this.nodes.get("pool");
    if (pool) {
      const g = ctx.createRadialGradient(pool.x, pool.y, 0, pool.x, pool.y, Math.min(w, h) * 0.65);
      g.addColorStop(0, "rgba(86,200,232,0.05)");
      g.addColorStop(1, "rgba(86,200,232,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // update radii
    for (const n of this.nodes.values()) n.r = this.radius(n);

    for (const f of this.flows) this.drawFlowLine(f);
    for (const p of this.pulses) this.drawPulse(p);
    for (const n of this.ringOrder) this.drawNode(n);
    if (pool) this.drawNode(pool);
    for (const f of this.flows) this.drawFlowParticles(f);
    for (const f of this.floats) this.drawFloat(f);

    if (this.opts.hud) this.drawHud();
  }

  private flowPath(f: Flow): { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number } {
    const a = f.from, b = f.to;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const x0 = a.x + ux * (a.r + 4), y0 = a.y + uy * (a.r + 4);
    const x1 = b.x - ux * (b.r + 8), y1 = b.y - uy * (b.r + 8);
    // slight perpendicular bow so overlapping flows stay legible
    const bow = Math.min(40, d * 0.12);
    const cx = (x0 + x1) / 2 - uy * bow;
    const cy = (y0 + y1) / 2 + ux * bow;
    return { x0, y0, x1, y1, cx, cy };
  }

  private qpoint(p: ReturnType<ReplayEngine["flowPath"]>, t: number): { x: number; y: number } {
    const mt = 1 - t;
    return {
      x: mt * mt * p.x0 + 2 * mt * t * p.cx + t * t * p.x1,
      y: mt * mt * p.y0 + 2 * mt * t * p.cy + t * t * p.y1,
    };
  }

  private drawFlowLine(f: Flow) {
    const { ctx } = this;
    const life = (this.real - f.start) / f.dur;
    if (life > 1.2) return;
    const alpha = life < 0.15 ? life / 0.15 : life > 0.85 ? Math.max(0, (1.2 - life) / 0.35) : 1;
    const p = this.flowPath(f);
    ctx.save();
    ctx.globalAlpha = alpha * (this.opts.ambient ? 0.35 : 0.45);
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 1;
    ctx.setLineDash(f.dashed ? [5, 5] : [2, 6]);
    ctx.lineDashOffset = -this.real * 40;
    ctx.beginPath();
    ctx.moveTo(p.x0, p.y0);
    ctx.quadraticCurveTo(p.cx, p.cy, p.x1, p.y1);
    ctx.stroke();

    // arrowhead at the target while the flow lives
    if (life <= 1) {
      const tip = this.qpoint(p, 1);
      const back = this.qpoint(p, 0.94);
      const ang = Math.atan2(tip.y - back.y, tip.x - back.x);
      ctx.setLineDash([]);
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - Math.cos(ang - 0.4) * 7, tip.y - Math.sin(ang - 0.4) * 7);
      ctx.lineTo(tip.x - Math.cos(ang + 0.4) * 7, tip.y - Math.sin(ang + 0.4) * 7);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFlowParticles(f: Flow) {
    const { ctx } = this;
    const life = (this.real - f.start) / f.dur;
    if (life > 1) return;
    const p = this.flowPath(f);
    ctx.save();
    for (let i = 0; i < f.particles; i++) {
      const off = i / f.particles * 0.35;
      const t = life * 1.35 - off;
      if (t < 0 || t > 1) continue;
      const pt = this.qpoint(p, t);
      const head = i === 0;
      ctx.globalAlpha = 0.35 + 0.65 * (1 - i / f.particles);
      ctx.shadowColor = f.color;
      ctx.shadowBlur = head ? 10 : 5;
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, head ? 2.6 : 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPulse(p: Pulse) {
    const { ctx } = this;
    const life = (this.real - p.start) / 0.9;
    if (life > 1) return;
    ctx.save();
    ctx.globalAlpha = (1 - life) * 0.5;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(p.node.x, p.node.y, p.node.r + 4 + life * 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private nodeColor(n: Node): string {
    if (n.tags.includes("pool")) return COLORS.pool;
    if (n.tags.includes("deployer")) return COLORS.xfer;
    if (n.tags.includes("cex") || n.tags.includes("dex")) return COLORS.dim;
    return "#3C4A3E"; // neutral wallet slate — green-charcoal, between hairline and dim
  }

  private drawNode(n: Node) {
    if (n.alpha <= 0) return;
    const { ctx } = this;
    const hovered = this.hoveredId === n.id;
    const dimmed = this.hoveredId !== null && !hovered;
    const color = this.nodeColor(n);

    ctx.save();
    ctx.globalAlpha = n.alpha * (dimmed ? 0.35 : 1) * (this.opts.ambient ? 0.9 : 1);

    const g = ctx.createRadialGradient(n.x - n.r * 0.3, n.y - n.r * 0.3, 0, n.x, n.y, n.r);
    g.addColorStop(0, this.tint(color, 0.32));
    g.addColorStop(1, this.tint(color, 0.1));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = hovered ? 1.5 : 1;
    if (n.flash > 0) {
      ctx.strokeStyle = n.flashColor;
      ctx.globalAlpha *= 1;
      ctx.shadowColor = n.flashColor;
      ctx.shadowBlur = 10 * n.flash;
    } else {
      ctx.strokeStyle = this.tint(color, hovered ? 0.9 : 0.55);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // label under the bubble
    if (n.r >= 9 || hovered || n.id === "pool" || n.id === "retail") {
      ctx.font = "10px ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = hovered ? COLORS.ink : COLORS.dim;
      ctx.fillText(n.label, n.x, n.y + n.r + 13);
      if (hovered && n.id !== "pool") {
        ctx.fillStyle = COLORS.dim;
        ctx.fillText(`${fmtTokens(n.hold)} $${this.scenario.symbol}`, n.x, n.y + n.r + 25);
      }
    }
    ctx.restore();
  }

  private drawFloat(f: Float) {
    const { ctx } = this;
    const life = (this.real - f.start) / 2.2;
    if (life > 1) return;
    ctx.save();
    ctx.globalAlpha = life < 0.1 ? life / 0.1 : 1 - Math.max(0, (life - 0.5) / 0.5);
    ctx.font = "11px ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y - life * 26);
    ctx.restore();
  }

  // hex color + alpha
  private tint(hex: string, a: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // -------- baked HUD for export / hero: stats top, captions bottom, watermark
  private drawHud() {
    const { ctx, w, h } = this;
    const s = this.statsShown;
    const sc = this.scenario;
    const mono = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace";

    ctx.save();
    // top strip
    const topH = this.opts.portrait ? 88 : 56;
    ctx.fillStyle = "rgba(17,21,17,0.88)";
    ctx.fillRect(0, 0, w, topH);
    ctx.strokeStyle = COLORS.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, topH + 0.5); ctx.lineTo(w, topH + 0.5); ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.ink;
    ctx.font = `bold 14px ${mono}`;
    ctx.fillText(`$${sc.symbol}`, 16, 24);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `10px ${mono}`;
    ctx.fillText("TAPE ▸", 16, 38);

    const chg = s.priceChangePct;
    const items: [string, string, string][] = [
      ["PRICE", fmtPrice(s.price), chg >= 0 ? COLORS.buy : COLORS.sell],
      ["Δ", fmtPct(chg), chg >= 0 ? COLORS.buy : COLORS.sell],
      ["MCAP", fmtUsd(s.mcap), COLORS.ink],
      ["VOL", fmtUsd(s.volume), COLORS.ink],
      ["B/S", `${s.buys}▲ ${s.sells}▼`, COLORS.ink],
      ["HOLDERS", String(s.holders), COLORS.ink],
    ];
    if (this.opts.portrait) {
      items.forEach(([k, v, c], i) => {
        const x = 16 + (i % 3) * ((w - 32) / 3);
        const y = i < 3 ? 58 : 80;
        ctx.font = `9px ${mono}`; ctx.fillStyle = COLORS.dim; ctx.fillText(k, x, y - 11);
        ctx.font = `12px ${mono}`; ctx.fillStyle = c; ctx.fillText(v, x, y);
      });
    } else {
      let x = 110;
      items.forEach(([k, v, c]) => {
        ctx.font = `9px ${mono}`; ctx.fillStyle = COLORS.dim; ctx.fillText(k, x, 20);
        ctx.font = `13px ${mono}`; ctx.fillStyle = c; ctx.fillText(v, x, 37);
        x += ctx.measureText(v).width + 34;
      });
    }
    // timecode top-right
    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.ink;
    ctx.font = `12px ${mono}`;
    ctx.fillText(fmtTimecode(s.time), w - 16, 22);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `10px ${mono}`;
    ctx.fillText(fmtWallClock(sc.windowStart + s.time), w - 16, 36);

    // bottom captions
    const capH = this.opts.portrait ? 116 : 72;
    ctx.fillStyle = "rgba(17,21,17,0.88)";
    ctx.fillRect(0, h - capH, w, capH);
    ctx.strokeStyle = COLORS.hairline;
    ctx.beginPath(); ctx.moveTo(0, h - capH + 0.5); ctx.lineTo(w, h - capH + 0.5); ctx.stroke();
    ctx.textAlign = "left";
    const caps = this.captionsRecent.slice(-(this.opts.portrait ? 3 : 2));
    caps.forEach((c, i) => {
      const last = i === caps.length - 1;
      ctx.font = `${last ? 12 : 11}px ${mono}`;
      ctx.fillStyle = last ? COLORS.ink : COLORS.dim;
      const y = h - capH + 24 + i * 20;
      ctx.fillText(this.ellipsize(c, w - 32, ctx), 16, y);
    });

    // watermark bottom-right
    ctx.textAlign = "right";
    ctx.font = `10px ${mono}`;
    ctx.fillStyle = COLORS.dim;
    const date = new Date(sc.windowStart * 1000).toISOString().slice(0, 10);
    ctx.fillText(`TAPE ▸ $${sc.symbol} · ${date}`, w - 12, h - 10);
    ctx.restore();
  }

  private ellipsize(s: string, maxW: number, ctx: CanvasRenderingContext2D): string {
    if (ctx.measureText(s).width <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(s.slice(0, mid) + "…").width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return s.slice(0, lo) + "…";
  }

  destroy() {
    this.flows = [];
    this.floats = [];
    this.pulses = [];
  }
}
