"use client";

// The replay app: data loading, engine lifecycle, controls, timeline,
// captions, stats — everything on /t/[mint].

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReplayEngine } from "@/lib/engine/engine";
import type { HolderInfo, ReplayEvent, Scenario } from "@/lib/engine/types";
import {
  buildFocusScenario,
  fetchScenario,
  generateMockScenario,
  resolveWallet,
  ScenarioError,
} from "@/lib/data";
import {
  defaultSpeed,
  fmtPct,
  fmtPrice,
  fmtTimecode,
  fmtUsd,
  fmtWallClock,
  SPEEDS,
  truncAddr,
  windowLabel,
  WINDOWS,
} from "@/lib/format";
import { buildSummary } from "@/lib/summary";
import { ExportModal } from "./ExportModal";
import { HoldersPanel } from "./HoldersPanel";
import { PriceChart } from "./PriceChart";
import { RecapCards } from "./RecapCards";
import { WalletPopover } from "./WalletPopover";

type Caption = { ev: ReplayEvent; text: string; key: number };

function saveRecent(mint: string, symbol: string) {
  try {
    const raw = localStorage.getItem("rewind.recent");
    const list: { mint: string; symbol: string }[] = raw ? JSON.parse(raw) : [];
    const next = [{ mint, symbol }, ...list.filter((r) => r.mint !== mint)].slice(0, 8);
    localStorage.setItem("rewind.recent", JSON.stringify(next));
  } catch {
    /* private mode etc. */
  }
}

export function ReplayApp({
  mint,
  windowKey,
  mock,
  initialFocus,
  chain,
}: {
  mint: string;
  windowKey: string;
  mock: boolean;
  initialFocus?: string;
  chain?: string; // explicit chain from the URL; otherwise auto-detected server-side
}) {
  const router = useRouter();
  const windowDef = WINDOWS.find((w) => w.label === windowKey) ?? WINDOWS[1];

  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [progress, setProgress] = useState("connecting…");
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(SPEEDS[0]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [focusAddr, setFocusAddr] = useState<string | null>(null);
  const [focusQuery, setFocusQuery] = useState("");
  const [focusError, setFocusError] = useState<string | null>(null);
  const [recapOpen, setRecapOpen] = useState(true);
  const [holdersOpen, setHoldersOpen] = useState(true);
  const [holders, setHolders] = useState<HolderInfo[]>([]);
  // engine mirrored into state so overlays (mini price chart) can mount on it
  const [engineObj, setEngineObj] = useState<ReplayEngine | null>(null);
  // timeline zoom: null = full window, else visible [start, end] in sim seconds
  const [view, setView] = useState<{ start: number; end: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  // focus mode: replay only the searched wallet's events + its counterparties
  const active = useMemo(
    () => (scenario && focusAddr ? buildFocusScenario(scenario, focusAddr) : scenario),
    [scenario, focusAddr]
  );

  // window recap cards ("what happened") — recomputed when the window or focus changes
  const summary = useMemo(() => (active ? buildSummary(active) : []), [active]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ReplayEngine | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const timecodeRef = useRef<HTMLSpanElement>(null);
  const wallclockRef = useRef<HTMLSpanElement>(null);
  const statRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const captionKey = useRef(0);
  const scrubbing = useRef(false);
  const wasPlaying = useRef(false);

  // ---------------------------------------------------------- data
  useEffect(() => {
    let cancelled = false;
    setScenario(null);
    setError(null);
    setCaptions([]);
    setFocusAddr(null);
    setFocusQuery("");
    setFocusError(null);
    (async () => {
      try {
        const sc = mock
          ? generateMockScenario(1337, windowDef.seconds > 0 ? windowDef.seconds : 21600)
          : await fetchScenario(mint, windowDef.seconds, (m) => !cancelled && setProgress(m), chain ?? "auto");
        if (cancelled) return;
        if (!mock) saveRecent(mint, sc.symbol);
        setScenario(sc);
        if (initialFocus) {
          const res = resolveWallet(sc, initialFocus);
          if (!("error" in res)) setFocusAddr(res.addr);
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ScenarioError) setError({ message: e.message, code: e.code });
        else setError({ message: e instanceof Error ? e.message : "something broke", code: "upstream" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mint, windowDef.seconds, mock, initialFocus, chain]);

  // ---------------------------------------------------------- engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;
    const scenario = active;
    setCaptions([]);
    setSelectedNode(null);
    setView(null);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const engine = new ReplayEngine(canvas, scenario, {
      onEvent: (ev, text) => {
        captionKey.current++;
        const key = captionKey.current;
        setCaptions((prev) => [...prev.slice(-5), { ev, text, key }]);
      },
      onEnd: () => setPlaying(false),
    });
    engineRef.current = engine;
    setEngineObj(engine);
    const spd = defaultSpeed(scenario.windowSeconds);
    engine.setSpeed(spd);
    setSpeed(spd);
    if (!reduced) {
      engine.play();
      setPlaying(true);
    } else {
      setPlaying(false);
    }

    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);

    setHolders(engine.getTopHolders(10));

    let raf = 0;
    let lastHolders = 0;
    const loop = (now: number) => {
      engine.frame(now);
      syncDom(engine, scenario);
      if (now - lastHolders > 500) {
        lastHolders = now;
        setHolders(engine.getTopHolders(10));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      engine.destroy();
      engineRef.current = null;
      setEngineObj(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const syncDom = (engine: ReplayEngine, sc: Scenario) => {
    // keep the playhead inside a zoomed view while playing
    const v = viewRef.current;
    if (v && engine.playing) {
      const span = v.end - v.start;
      if (engine.time > v.end || engine.time < v.start) {
        const ns = Math.max(0, Math.min(sc.windowSeconds - span, engine.time - span * 0.25));
        setView({ start: ns, end: ns + span });
      }
    }
    const s = engine.getStats();
    const set = (k: string, v: string) => {
      const el = statRefs.current[k];
      if (el && el.textContent !== v) el.textContent = v;
    };
    set("mcap", fmtUsd(s.mcap));
    set("price", fmtPrice(s.price));
    set("chg", fmtPct(s.priceChangePct));
    set("vol", fmtUsd(s.volume));
    set("buys", `${s.buys}▲`);
    set("sells", `${s.sells}▼`);
    set("holders", String(s.holders));
    const chgEl = statRefs.current["chg"];
    if (chgEl) chgEl.style.color = s.priceChangePct >= 0 ? "#4CE07E" : "#FF5A3C";
    if (timecodeRef.current) timecodeRef.current.textContent = fmtTimecode(engine.time);
    if (wallclockRef.current)
      wallclockRef.current.textContent = fmtWallClock(sc.windowStart + engine.time);
    const vs = viewRef.current?.start ?? 0;
    const ve = viewRef.current?.end ?? sc.windowSeconds;
    const frac = Math.max(0, Math.min(1, (engine.time - vs) / (ve - vs)));
    if (playheadRef.current) playheadRef.current.style.left = `${frac * 100}%`;
    if (fillRef.current) fillRef.current.style.width = `${frac * 100}%`;
  };

  // ---------------------------------------------------------- controls
  const togglePlay = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    if (e.playing) {
      e.pause();
      setPlaying(false);
    } else {
      e.play();
      setPlaying(true);
    }
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code === "Space" && !(ev.target instanceof HTMLInputElement)) {
        ev.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  const restart = () => {
    engineRef.current?.restart();
    setCaptions([]);
    setPlaying(true);
  };

  const changeSpeed = (s: number) => {
    setSpeed(s);
    engineRef.current?.setSpeed(s);
  };

  const jumpTo = (ev: ReplayEvent) => {
    const e = engineRef.current;
    if (!e) return;
    e.setTime(Math.max(0, ev.t - 1));
    setCaptions([]);
    e.play();
    setPlaying(true);
  };

  const jumpToTime = (t: number) => {
    const e = engineRef.current;
    if (!e) return;
    e.setTime(Math.max(0, t - 1));
    setCaptions([]);
    e.play();
    setPlaying(true);
  };

  // ---------------------------------------------------------- timeline scrub
  const timelineT = (clientX: number): number => {
    const el = timelineRef.current;
    if (!el || !active) return 0;
    const r = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const vs = view?.start ?? 0;
    const ve = view?.end ?? active.windowSeconds;
    return vs + f * (ve - vs);
  };

  // wheel over the timeline zooms around the cursor (native listener: React's is passive)
  useEffect(() => {
    const el = timelineRef.current;
    if (!el || !active) return;
    const W = active.windowSeconds;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const v = viewRef.current;
      const vs = v?.start ?? 0;
      const ve = v?.end ?? W;
      const span = ve - vs;
      const cursorT = vs + f * span;
      const minSpan = Math.max(10, W / 256);
      const span2 = Math.max(minSpan, Math.min(W, span * (e.deltaY > 0 ? 1.3 : 1 / 1.3)));
      if (span2 >= W) {
        setView(null);
        return;
      }
      const ns = Math.max(0, Math.min(W - span2, cursorT - f * span2));
      setView({ start: ns, end: ns + span2 });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ---------------------------------------------------------- focus mode
  const applyFocus = (query: string) => {
    if (!scenario) return;
    const res = resolveWallet(scenario, query);
    if ("error" in res) {
      setFocusError(res.error);
      return;
    }
    setFocusError(null);
    setFocusQuery("");
    setFocusAddr(res.addr);
  };
  const clearFocus = () => {
    setFocusAddr(null);
    setFocusError(null);
    setFocusQuery("");
  };

  const onTimelineDown = (e: React.PointerEvent) => {
    const eng = engineRef.current;
    if (!eng) return;
    scrubbing.current = true;
    wasPlaying.current = eng.playing;
    eng.pause();
    setPlaying(false);
    eng.setTime(timelineT(e.clientX));
    setCaptions([]);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onTimelineMove = (e: React.PointerEvent) => {
    setHoverT(timelineT(e.clientX));
    if (scrubbing.current) engineRef.current?.setTime(timelineT(e.clientX));
  };
  const onTimelineUp = () => {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    if (wasPlaying.current) {
      engineRef.current?.play();
      setPlaying(true);
    }
  };

  // ---------------------------------------------------------- canvas pointer
  const canvasPos = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const onCanvasMove = (e: React.MouseEvent) => {
    const eng = engineRef.current;
    if (!eng) return;
    const [x, y] = canvasPos(e);
    eng.setHover(x, y);
    if (canvasRef.current) canvasRef.current.style.cursor = eng.hoveredId ? "pointer" : "default";
  };
  const onCanvasClick = (e: React.MouseEvent) => {
    const eng = engineRef.current;
    if (!eng) return;
    const [x, y] = canvasPos(e);
    setSelectedNode(eng.hitTest(x, y));
  };

  // ---------------------------------------------------------- render
  if (error) {
    return (
      <Shell mint={mint} windowKey={windowDef.label} mock={mock} symbol={null} onWindow={(w) => router.push(urlFor(mint, w, mock, chain))}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="h-10 w-10 rounded-full border border-sell/60 bg-sell/10" />
          <p className="max-w-md text-sm text-ink">{error.message}</p>
          <div className="flex gap-3 text-xs">
            <button
              onClick={() => router.refresh()}
              className="border border-hairline bg-panel px-3 py-2 text-dim hover:text-ink"
            >
              retry
            </button>
            <Link href="/app" className="border border-hairline bg-panel px-3 py-2 text-dim hover:text-ink">
              try another token
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (!scenario || !active) {
    return (
      <Shell mint={mint} windowKey={windowDef.label} mock={mock} symbol={null} onWindow={(w) => router.push(urlFor(mint, w, mock, chain))}>
        <div className="flex flex-1 flex-col items-center justify-center gap-5">
          <div className="bubble-spinner" />
          <p className="text-xs text-dim">{progress}</p>
          <div className="flex w-64 flex-col gap-2">
            {[0.9, 0.7, 0.5].map((o, i) => (
              <div key={i} className="h-2 animate-pulse bg-panel" style={{ opacity: o }} />
            ))}
          </div>
        </div>
      </Shell>
    );
  }

  const lastCaptions = captions.slice(-4);

  return (
    <Shell
      mint={mint}
      windowKey={windowDef.label}
      mock={mock}
      symbol={active.symbol}
      onWindow={(w) => router.push(urlFor(mint, w, mock, scenario.chain ?? chain))}
      onExport={() => setExportOpen(true)}
    >
      {/* stats strip */}
      <div className="flex shrink-0 items-center gap-6 overflow-x-auto border-b border-hairline bg-panel px-4 py-2 text-xs whitespace-nowrap">
        <Stat label="MCAP" k="mcap" refs={statRefs} />
        <div className="flex items-baseline gap-2">
          <Stat label="PRICE" k="price" refs={statRefs} />
          <span ref={(el) => void (statRefs.current["chg"] = el)} className="text-buy" />
        </div>
        <Stat label="VOL" k="vol" refs={statRefs} />
        <div className="flex items-baseline gap-1.5">
          <span className="text-dim">SWAPS</span>
          <span ref={(el) => void (statRefs.current["buys"] = el)} className="text-buy" />
          <span ref={(el) => void (statRefs.current["sells"] = el)} className="text-sell" />
        </div>
        <Stat label="HOLDERS" k="holders" refs={statRefs} />
        {active.capped && (
          <span className="text-dim">showing top {active.capped} events by size</span>
        )}
        {active.note && <span className="text-xfer">{active.note}</span>}

        {/* focus search */}
        <div className="ml-auto flex items-center gap-2">
          {!recapOpen && (
            <button
              onClick={() => setRecapOpen(true)}
              className="border border-hairline bg-bg px-2 py-1 text-dim hover:text-ink"
              title="show the window recap"
            >
              recap ▾
            </button>
          )}
          {!holdersOpen && (
            <button
              onClick={() => setHoldersOpen(true)}
              className="hidden border border-hairline bg-bg px-2 py-1 text-dim hover:text-ink sm:block"
              title="show the top holders dashboard"
            >
              top 10 ◂
            </button>
          )}
          {focusError && <span className="text-sell">{focusError}</span>}
          {focusAddr ? (
            <button
              onClick={clearFocus}
              className="border border-xfer/50 bg-xfer/10 px-2 py-1 text-xfer hover:bg-xfer/20"
              title="clear focus — show every wallet again"
            >
              ✂ {truncAddr(focusAddr)} ✕
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                applyFocus(focusQuery);
              }}
            >
              <input
                value={focusQuery}
                onChange={(e) => {
                  setFocusQuery(e.target.value);
                  setFocusError(null);
                }}
                placeholder="⌕ isolate wallet…"
                spellCheck={false}
                className="h-7 w-44 border border-hairline bg-bg px-2 text-[11px] text-ink outline-none placeholder:text-dim focus:border-pool/60"
              />
            </form>
          )}
        </div>
      </div>

      {/* window recap */}
      {recapOpen && (
        <RecapCards
          cards={summary}
          windowKey={
            focusAddr ? `${truncAddr(focusAddr)} · ${windowDef.label}` : windowDef.label
          }
          onJump={jumpToTime}
          onIsolate={(addr) => applyFocus(addr)}
          onClose={() => setRecapOpen(false)}
        />
      )}

      {/* canvas + holders dashboard */}
      <div className="flex min-h-0 flex-1">
      <div className="scan relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          onMouseMove={onCanvasMove}
          onMouseLeave={() => engineRef.current?.setHover(null)}
          onClick={onCanvasClick}
        />

        {/* captions overlay */}
        <div className="pointer-events-auto absolute bottom-3 left-3 flex max-w-[85%] flex-col gap-1 sm:max-w-md">
          {lastCaptions.map((c, i) => (
            <button
              key={c.key}
              onClick={() => jumpTo(c.ev)}
              className="caption-enter w-fit border border-hairline bg-panel/80 px-2 py-1 text-left text-[11px] backdrop-blur-sm hover:border-dim"
              style={{ opacity: 0.45 + 0.55 * ((i + 1) / lastCaptions.length) }}
            >
              <span
                className={
                  c.ev.type === "buy" ? "text-buy" : c.ev.type === "sell" ? "text-sell" : "text-xfer"
                }
              >
                {c.text}
              </span>
            </button>
          ))}
        </div>

        {/* mini price chart — reveals in sync with the replay over the chosen window */}
        {engineObj && <PriceChart engine={engineObj} scenario={active} />}

        {selectedNode && engineRef.current && (
          <WalletPopover
            engine={engineRef.current}
            scenario={active}
            nodeId={selectedNode}
            onClose={() => setSelectedNode(null)}
            onJump={jumpTo}
            onIsolate={
              focusAddr
                ? undefined
                : (addr) => {
                    setSelectedNode(null);
                    applyFocus(addr);
                  }
            }
          />
        )}
      </div>

      {holdersOpen && (
        <HoldersPanel
          holders={holders}
          symbol={active.symbol}
          focusAddr={focusAddr}
          onIsolate={(addr) => applyFocus(addr)}
          onClose={() => setHoldersOpen(false)}
        />
      )}
      </div>

      {/* controls + timeline */}
      <div className="shrink-0 border-t border-hairline bg-panel px-3 py-2">
        <div
          ref={timelineRef}
          className="group relative h-11 cursor-ew-resize touch-none select-none"
          onPointerDown={onTimelineDown}
          onPointerMove={onTimelineMove}
          onPointerUp={onTimelineUp}
          onDoubleClick={() => setView(null)}
          onPointerLeave={() => {
            setHoverT(null);
            onTimelineUp();
          }}
        >
          {/* track */}
          <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 bg-hairline" />
          <div
            ref={fillRef}
            className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 bg-pool/60"
            style={{ width: "0%" }}
          />
          {/* event ticks (only those inside the zoomed view) */}
          {(() => {
            const vs = view?.start ?? 0;
            const ve = view?.end ?? active.windowSeconds;
            const span = ve - vs;
            return active.events.map((ev, i) =>
              ev.t < vs || ev.t > ve ? null : (
                <div
                  key={i}
                  className="absolute top-1/2 h-2.5 w-px -translate-y-1/2"
                  style={{
                    left: `${((ev.t - vs) / span) * 100}%`,
                    background:
                      ev.type === "buy" ? "#4CE07E" : ev.type === "sell" ? "#FF5A3C" : "#EFB13C",
                    opacity: 0.7,
                  }}
                />
              )
            );
          })()}
          {/* playhead */}
          <div
            ref={playheadRef}
            className="absolute top-1/2 h-5 w-[2px] -translate-x-1/2 -translate-y-1/2 bg-ink"
            style={{ left: "0%" }}
          />
          {/* ghost timecode */}
          {hoverT !== null && !scrubbing.current && (
            <div
              className="pointer-events-none absolute -top-1 -translate-x-1/2 border border-hairline bg-bg px-1.5 py-0.5 text-[10px] text-dim"
              style={{
                left: `${(((hoverT - (view?.start ?? 0)) /
                  ((view?.end ?? active.windowSeconds) - (view?.start ?? 0))) *
                  100)}%`,
              }}
            >
              {fmtTimecode(hoverT)}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-1 text-xs">
          <button
            onClick={togglePlay}
            className="flex h-8 w-8 items-center justify-center border border-hairline bg-bg text-ink hover:border-dim"
            aria-label={playing ? "pause" : "play"}
          >
            {playing ? "❚❚" : "►"}
          </button>
          <button
            onClick={restart}
            className="flex h-8 w-8 items-center justify-center border border-hairline bg-bg text-dim hover:text-ink"
            aria-label="restart"
          >
            ⟲
          </button>
          <select
            value={speed}
            onChange={(e) => changeSpeed(Number(e.target.value))}
            className="h-8 cursor-pointer appearance-none border border-hairline bg-bg px-2.5 text-dim outline-none hover:text-ink focus:border-pool/60"
            aria-label="playback speed"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
          <span ref={timecodeRef} className="text-ink">
            T+00:00:00
          </span>
          <span ref={wallclockRef} className="hidden text-dim sm:inline" />
          {view && (
            <button
              onClick={() => setView(null)}
              className="border border-pool/50 bg-pool/10 px-2 py-1 text-[10px] text-ink hover:bg-pool/20"
              title="reset timeline zoom (or double-click the timeline)"
            >
              ⌕ {fmtTimecode(view.start)} – {fmtTimecode(view.end)} · ×
              {(active.windowSeconds / (view.end - view.start)).toFixed(1)} ✕
            </button>
          )}
          <span className="ml-auto hidden text-dim sm:inline">
            {active.events.length} events ·{" "}
            {windowDef.seconds > 0
              ? windowLabel(active.windowSeconds)
              : `launch (${windowLabel(active.windowSeconds)})`}{" "}
            window · scroll timeline to zoom
          </span>
        </div>
      </div>

      {exportOpen && <ExportModal scenario={active} windowKey={windowDef.label} onClose={() => setExportOpen(false)} />}
    </Shell>
  );
}

function urlFor(mint: string, w: string, mock: boolean, chain?: string) {
  // pin the resolved chain so window switches skip re-detection
  return `/t/${mint}?w=${w}${mock ? "&mock=1" : ""}${chain && chain !== "solana" ? `&chain=${chain}` : ""}`;
}

function Stat({
  label,
  k,
  refs,
}: {
  label: string;
  k: string;
  refs: React.MutableRefObject<Record<string, HTMLSpanElement | null>>;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-dim">{label}</span>
      <span ref={(el) => void (refs.current[k] = el)} className="text-ink" />
    </div>
  );
}

function Shell({
  mint,
  windowKey,
  mock,
  symbol,
  children,
  onWindow,
  onExport,
}: {
  mint: string;
  windowKey: string;
  mock: boolean;
  symbol: string | null;
  children: React.ReactNode;
  onWindow: (w: string) => void;
  onExport?: () => void;
}) {
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-2.5 text-xs">
        <Link href="/" className="osd flex items-center gap-1.5 font-bold tracking-[0.3em] text-ink hover:text-buy">
          <span className="rec-dot" aria-hidden="true" />
          TAPE<span className="text-buy">▸</span>
        </Link>
        <span className="text-hairline">/</span>
        <span className="text-dim">
          {symbol ? `$${symbol}` : truncAddr(mint)}
          {mock && <span className="ml-2 text-xfer">mock</span>}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.label}
              onClick={() => onWindow(w.label)}
              className={`px-2 py-1 ${
                w.label === windowKey
                  ? "border border-pool/60 bg-pool/10 text-ink"
                  : "border border-transparent text-dim hover:text-ink"
              }`}
            >
              {w.label}
            </button>
          ))}
          {onExport && (
            <button
              onClick={onExport}
              className="ml-2 border border-hairline bg-panel px-3 py-1 text-ink hover:border-dim"
            >
              export ↓
            </button>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}
