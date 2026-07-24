"use client";

// Mini price chart overlaid top-right of the canvas: the window's price line
// reveals itself in sync with the replay. X spans the chosen window; Y is fixed
// to the full window's range so the line never rescales mid-playback.

import { useEffect, useRef } from "react";
import type { ReplayEngine } from "@/lib/engine/engine";
import type { Scenario } from "@/lib/engine/types";
import { fmtPrice, windowLabel } from "@/lib/format";

const UP = "#4CE07E";
const DOWN = "#FF5A3C";

export function PriceChart({ engine, scenario }: { engine: ReplayEngine; scenario: Scenario }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const priceRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // price is stepwise: it holds after each event until the next one
    const pts: { t: number; p: number }[] = [{ t: 0, p: scenario.price0 }];
    for (const ev of scenario.events) if (ev.priceAfter > 0) pts.push({ t: ev.t, p: ev.priceAfter });
    let lo = Infinity;
    let hi = -Infinity;
    for (const pt of pts) {
      lo = Math.min(lo, pt.p);
      hi = Math.max(hi, pt.p);
    }
    const pad = Math.max((hi - lo) * 0.12, hi * 0.002, 1e-12);
    lo -= pad;
    hi += pad;

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const time = Math.max(0, Math.min(engine.time, scenario.windowSeconds));
      const X = (t: number) => (t / scenario.windowSeconds) * w;
      const Y = (p: number) => h - 3 - ((p - lo) / (hi - lo)) * (h - 6);

      // only the revealed slice — the film hasn't shown the future yet
      let price = pts[0].p;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(price));
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].t > time) break;
        ctx.lineTo(X(pts[i].t), Y(price)); // hold …
        price = pts[i].p;
        ctx.lineTo(X(pts[i].t), Y(price)); // … then step
      }
      const hx = X(time);
      const hy = Y(price);
      ctx.lineTo(hx, hy);

      const color = price >= pts[0].p ? UP : DOWN;

      // soft fill under the line, then the line itself
      ctx.save();
      ctx.lineTo(hx, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, color + "33");
      grad.addColorStop(1, color + "00");
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(X(0), Y(pts[0].p));
      let p2 = pts[0].p;
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].t > time) break;
        ctx.lineTo(X(pts[i].t), Y(p2));
        p2 = pts[i].p;
        ctx.lineTo(X(pts[i].t), Y(p2));
      }
      ctx.lineTo(hx, hy);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // playhead dot
      ctx.beginPath();
      ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      const el = priceRef.current;
      if (el) {
        const txt = fmtPrice(price);
        if (el.textContent !== txt) el.textContent = txt;
        el.style.color = color;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine, scenario]);

  return (
    <div className="pointer-events-none absolute right-3 top-3 hidden w-64 border border-hairline bg-panel/80 backdrop-blur-sm sm:block">
      <div className="flex items-baseline justify-between px-2 pt-1.5 text-[10px]">
        <span className="uppercase tracking-wider text-dim">
          price · {windowLabel(scenario.windowSeconds)}
        </span>
        <span ref={priceRef} className="text-ink" />
      </div>
      <canvas ref={canvasRef} className="block h-16 w-full" />
    </div>
  );
}
