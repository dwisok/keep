import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6">
      <div className="bubble-spinner" style={{ width: 64, height: 64 }} />
      <p className="osd text-sm text-dim">404 — no footage at this timecode.</p>
      <Link href="/" className="osd border border-hairline bg-panel px-3 py-2 text-xs tracking-widest text-dim hover:text-ink">
        ▸ REWIND TO START
      </Link>
    </div>
  );
}
