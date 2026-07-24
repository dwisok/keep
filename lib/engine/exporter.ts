// One-click video export: run an automated replay on an offscreen canvas,
// record it with MediaRecorder, hand back a webm blob.

import { ReplayEngine } from "./engine";
import type { Scenario } from "./types";

export type ExportFormat = "16:9" | "9:16";

export type ExportOptions = {
  format: ExportFormat;
  durationSeconds: 30 | 60 | 90; // real length of the output video
  onProgress?: (fraction: number) => void;
};

export function exportMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mime of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

export function exportReplay(scenario: Scenario, opts: ExportOptions): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const mime = exportMimeType();
    if (!mime) {
      reject(new Error("this browser can't record canvas video — try Chrome"));
      return;
    }

    const portrait = opts.format === "9:16";
    const w = portrait ? 720 : 1280;
    const h = portrait ? 1280 : 720;

    // must be in the DOM (hidden) so the canvas has a real layout size
    const holder = document.createElement("div");
    holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px;pointer-events:none;`;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:100%;height:100%;";
    holder.appendChild(canvas);
    document.body.appendChild(holder);

    const engine = new ReplayEngine(canvas, scenario, {
      hud: true,
      portrait,
      pixelRatio: 1, // record at exactly 1280×720 / 720×1280
      onEnd: () => finish(),
    });
    // the whole window compressed into the requested video length
    engine.setSpeed(scenario.windowSeconds / opts.durationSeconds);

    const stream = canvas.captureStream(60);
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onerror = () => fail(new Error("recording failed"));

    let raf = 0;
    let done = false;

    const cleanup = () => {
      cancelAnimationFrame(raf);
      engine.destroy();
      holder.remove();
    };
    const fail = (err: Error) => {
      if (done) return;
      done = true;
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
      cleanup();
      reject(err);
    };
    const finish = () => {
      if (done) return;
      done = true;
      // small tail so the last frame lands in the recording
      setTimeout(() => {
        recorder.onstop = () => {
          cleanup();
          resolve(new Blob(chunks, { type: "video/webm" }));
        };
        try {
          recorder.stop();
        } catch (e) {
          cleanup();
          reject(e instanceof Error ? e : new Error("recorder stop failed"));
        }
      }, 400);
    };

    const loop = (now: number) => {
      engine.frame(now);
      opts.onProgress?.(Math.min(1, engine.time / scenario.windowSeconds));
      if (!done) raf = requestAnimationFrame(loop);
    };

    recorder.start(250);
    engine.setTime(0);
    engine.play();
    raf = requestAnimationFrame(loop);
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
