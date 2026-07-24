"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isValidAddress, truncAddr } from "@/lib/format";

type Recent = { mint: string; symbol: string };

export default function AppPage() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [recent, setRecent] = useState<Recent[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("rewind.recent");
      if (raw) setRecent(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const go = (mint: string) => {
    const m = mint.trim();
    if (!isValidAddress(m)) {
      setInvalid(true);
      return;
    }
    router.push(`/t/${m}?w=1h`);
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center border-b border-hairline px-4 py-2.5 text-xs">
        <Link href="/" className="osd flex items-center gap-1.5 font-bold tracking-[0.3em] text-ink hover:text-buy">
          <span className="rec-dot" aria-hidden="true" />
          TAPE<span className="text-buy">▸</span>
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <p className="osd text-sm text-dim">paste a contract address. play the footage back.</p>
        <form
          className="flex w-full max-w-xl gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go(value);
          }}
        >
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setInvalid(false);
            }}
            placeholder="token contract address (solana · base · robinhood chain · evm)"
            spellCheck={false}
            autoFocus
            className={`h-11 flex-1 border bg-panel px-3 text-sm text-ink outline-none placeholder:text-dim ${
              invalid ? "border-sell" : "border-hairline focus:border-pool/60"
            }`}
          />
          <button type="submit" className="osd h-11 border-0 bg-buy px-5 text-sm font-bold tracking-widest text-bg hover:bg-ink">
            ▸ PLAY
          </button>
        </form>
        {invalid && <p className="text-xs text-sell">that doesn&apos;t look like a token address (solana mint or 0x…)</p>}

        {recent.length > 0 && (
          <div className="flex max-w-xl flex-wrap justify-center gap-2">
            {recent.map((r) => (
              <Link
                key={r.mint}
                href={`/t/${r.mint}?w=1h`}
                className="border border-hairline bg-panel px-2.5 py-1 text-[11px] text-dim hover:border-dim hover:text-ink"
              >
                ${r.symbol} · {truncAddr(r.mint)}
              </Link>
            ))}
          </div>
        )}

        <Link href="/t/mock?mock=1" className="text-[11px] text-dim underline decoration-hairline hover:text-ink">
          no CA handy? watch the demo replay
        </Link>
      </main>
    </div>
  );
}
