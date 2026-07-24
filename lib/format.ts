export function fmtUsd(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (a >= 10_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (a >= 1_000) return `$${(v / 1_000).toFixed(2)}K`;
  if (a >= 1) return `$${v.toFixed(0)}`;
  return `$${v.toFixed(2)}`;
}

export function fmtTokens(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(a >= 10 ? 0 : 2);
}

export function fmtPrice(p: number): string {
  if (p === 0) return "$0";
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.001) return `$${p.toFixed(4)}`;
  // subscript-zeros notation for micro-prices: $0.0₅123
  const zeros = Math.max(0, -Math.floor(Math.log10(p)) - 1);
  const digits = Math.round(p * Math.pow(10, zeros + 3));
  const sub = "₀₁₂₃₄₅₆₇₈₉";
  const subZeros = String(zeros)
    .split("")
    .map((c) => sub[Number(c)])
    .join("");
  return `$0.0${subZeros}${digits}`;
}

export function fmtPct(v: number): string {
  const s = v >= 0 ? "+" : "−";
  return `${s}${Math.abs(v).toFixed(1)}%`;
}

export function fmtTimecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  const d = Math.floor(s / 86400);
  return d > 0 ? `T+${d}d ${hh}:${mm}:${ss}` : `T+${hh}:${mm}:${ss}`;
}

export function fmtWallClock(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

export function truncAddr(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function windowLabel(seconds: number): string {
  if (seconds >= 172800) return `${Math.round(seconds / 86400)}d`;
  if (seconds >= 3600) {
    const h = seconds / 3600;
    return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
  }
  return `${Math.round(seconds / 60)}m`;
}

// seconds: -1 = since token launch (resolved from creation time at fetch)
export const WINDOWS: { label: string; seconds: number }[] = [
  { label: "30m", seconds: 1800 },
  { label: "1h", seconds: 3600 },
  { label: "2h", seconds: 7200 },
  { label: "6h", seconds: 21600 },
  { label: "24h", seconds: 86400 },
  { label: "launch", seconds: -1 },
];

export const LAUNCH_WINDOW = -1;
export const MAX_WINDOW_SECONDS = 30 * 86400; // replay depth ceiling, shared with the API routes

export const SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128]; // sim-time multipliers (1× = real time)

/** Smallest speed that plays the window in ≤ 2 minutes, capped at 128×. */
export function defaultSpeed(windowSeconds: number): number {
  return SPEEDS.find((s) => windowSeconds / s <= 120) ?? SPEEDS[SPEEDS.length - 1];
}

export function isValidMint(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}

/** Any address we can replay: a Solana mint or an EVM (0x…) token contract. */
export function isValidAddress(s: string): boolean {
  return isValidMint(s) || /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}
