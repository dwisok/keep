// Recap card — renders the window summary as a single shareable PNG
// (1200×675 logical, drawn at 2× for crispness). Used by the export modal.

import { COLORS } from "@/lib/engine/engine";
import type { Scenario } from "@/lib/engine/types";
import { buildSummary, type CardTone } from "@/lib/summary";
import { fmtPct, fmtPrice, fmtTimecode, fmtUsd, truncAddr, windowLabel } from "@/lib/format";

const W = 1200;
const H = 675;
const SCALE = 2;
const MARGIN = 48;
const MONO = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace";

const TONE: Record<CardTone, string> = {
  buy: COLORS.buy,
  sell: COLORS.sell,
  xfer: COLORS.xfer,
  pool: COLORS.pool,
  neutral: COLORS.ink,
};

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width <= maxW) cur = t;
    else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

export function renderRecapCard(sc: Scenario, windowKey: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.scale(SCALE, SCALE);

  // ---------------------------------------------------------------- base
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.75, H * 0.3, 0, W * 0.75, H * 0.3, W * 0.55);
  glow.addColorStop(0, "rgba(86,200,232,0.07)");
  glow.addColorStop(1, "rgba(86,200,232,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = COLORS.hairline;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  const events = sc.events;
  const priceEnd = events.length ? events[events.length - 1].priceAfter : sc.price0;
  const chg = sc.price0 > 0 ? (priceEnd / sc.price0 - 1) * 100 : 0;
  const chgColor = chg >= 0 ? COLORS.buy : COLORS.sell;
  const vol = events.reduce((a, e) => a + e.usd, 0);
  const buys = events.filter((e) => e.type === "buy").length;
  const sells = events.filter((e) => e.type === "sell").length;
  const xfers = events.length - buys - sells;

  // ---------------------------------------------------------------- header
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `11px ${MONO}`;
  ctx.fillText("● T A P E ▸", MARGIN, 56);
  ctx.fillStyle = COLORS.ink;
  ctx.font = `bold 36px ${MONO}`;
  ctx.fillText(`$${sc.symbol}`, MARGIN, 100);
  const symW = ctx.measureText(`$${sc.symbol}`).width;
  ctx.fillStyle = COLORS.dim;
  ctx.font = `13px ${MONO}`;
  ctx.fillText(sc.name, MARGIN + symW + 16, 100);

  ctx.textAlign = "right";
  const date = new Date(sc.windowStart * 1000).toISOString().slice(0, 10);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `11px ${MONO}`;
  ctx.fillText("WHAT HAPPENED", W - MARGIN, 56);
  ctx.fillStyle = COLORS.ink;
  ctx.font = `bold 15px ${MONO}`;
  ctx.fillText(`${windowKey.toUpperCase()} WINDOW · ${date}`, W - MARGIN, 78);

  // ---------------------------------------------------------------- hero: Δ + stats
  ctx.textAlign = "left";
  ctx.fillStyle = chgColor;
  ctx.font = `bold 54px ${MONO}`;
  ctx.fillText(fmtPct(chg), MARGIN, 172);
  ctx.fillStyle = COLORS.dim;
  ctx.font = `13px ${MONO}`;
  ctx.fillText(`${fmtPrice(sc.price0)} → ${fmtPrice(priceEnd)}`, MARGIN, 198);

  const stats: [string, string][] = [
    ["VOL", fmtUsd(vol)],
    ["BUYS", `${buys}▲`],
    ["SELLS", `${sells}▼`],
    ["TRANSFERS", String(xfers)],
  ];
  let sx = MARGIN;
  for (const [k, v] of stats) {
    ctx.fillStyle = COLORS.dim;
    ctx.font = `10px ${MONO}`;
    ctx.fillText(k, sx, 226);
    ctx.fillStyle = k === "BUYS" ? COLORS.buy : k === "SELLS" ? COLORS.sell : COLORS.ink;
    ctx.font = `bold 14px ${MONO}`;
    ctx.fillText(v, sx, 244);
    sx += Math.max(ctx.measureText(v).width, ctx.measureText(k).width) + 36;
  }

  // ---------------------------------------------------------------- price sparkline (right)
  const spX = 620;
  const spW = W - MARGIN - spX;
  const spY = 120;
  const spH = 100;
  if (events.length > 1) {
    let lo = sc.price0;
    let hi = sc.price0;
    for (const e of events) {
      if (e.priceAfter < lo) lo = e.priceAfter;
      if (e.priceAfter > hi) hi = e.priceAfter;
    }
    const range = hi - lo || 1;
    const px = (t: number) => spX + (t / sc.windowSeconds) * spW;
    const py = (p: number) => spY + spH - ((p - lo) / range) * spH;
    ctx.beginPath();
    ctx.moveTo(px(0), py(sc.price0));
    for (const e of events) ctx.lineTo(px(e.t), py(e.priceAfter));
    ctx.lineTo(px(sc.windowSeconds), py(priceEnd));
    ctx.strokeStyle = chgColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // soft fill under the line
    ctx.lineTo(px(sc.windowSeconds), spY + spH);
    ctx.lineTo(px(0), spY + spH);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, spY, 0, spY + spH);
    fill.addColorStop(0, chg >= 0 ? "rgba(76,224,126,0.18)" : "rgba(255,90,60,0.18)");
    fill.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // ---------------------------------------------------------------- event strip
  const stY = 252;
  ctx.strokeStyle = COLORS.hairline;
  ctx.beginPath();
  ctx.moveTo(spX, stY);
  ctx.lineTo(W - MARGIN, stY);
  ctx.stroke();
  for (const e of events) {
    ctx.strokeStyle = e.type === "buy" ? COLORS.buy : e.type === "sell" ? COLORS.sell : COLORS.xfer;
    ctx.globalAlpha = 0.8;
    const x = spX + (e.t / sc.windowSeconds) * spW;
    ctx.beginPath();
    ctx.moveTo(x, stY - 5);
    ctx.lineTo(x, stY + 5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLORS.dim;
  ctx.font = `9px ${MONO}`;
  ctx.textAlign = "left";
  ctx.fillText("T+00:00:00", spX, stY + 20);
  ctx.textAlign = "right";
  ctx.fillText(fmtTimecode(sc.windowSeconds), W - MARGIN, stY + 20);

  // ---------------------------------------------------------------- summary cards
  const cards = buildSummary(sc).filter((c) => c.key !== "price").slice(0, 6);
  const COLS = 3;
  const GAP = 16;
  const cw = (W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;
  const ch = 128;
  const gy = 300;
  cards.forEach((c, i) => {
    const x = MARGIN + (i % COLS) * (cw + GAP);
    const y = gy + Math.floor(i / COLS) * (ch + GAP);
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(x, y, cw, ch);
    ctx.strokeStyle = COLORS.hairline;
    ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);

    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.dim;
    ctx.font = `10px ${MONO}`;
    ctx.fillText(c.label, x + 16, y + 26);
    ctx.fillStyle = TONE[c.tone];
    ctx.font = `bold 20px ${MONO}`;
    ctx.fillText(c.headline, x + 16, y + 56);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `11px ${MONO}`;
    wrap(ctx, c.detail, cw - 32, 3).forEach((line, li) => {
      ctx.fillText(line, x + 16, y + 80 + li * 16);
    });
  });

  // ---------------------------------------------------------------- footer
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.dim;
  ctx.font = `10px ${MONO}`;
  ctx.fillText(`${truncAddr(sc.mint)} · ${windowLabel(sc.windowSeconds)} of on-chain history`, MARGIN, H - 28);
  ctx.textAlign = "right";
  ctx.fillText("TAPE — the tape never lies", W - MARGIN, H - 28);

  return canvas;
}

export function recapCardBlob(sc: Scenario, windowKey: string): Promise<Blob> {
  const canvas = renderRecapCard(sc, windowKey);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png encode failed"))), "image/png");
  });
}
