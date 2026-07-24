import { NextRequest, NextResponse } from "next/server";
import { fetchTransfers, UpstreamError } from "@/lib/data/server";
import { AMM_ADDRESSES } from "@/lib/data/labels";
import { addressMatchesChain, isChainId } from "@/lib/chains";
import { MAX_WINDOW_SECONDS } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const mint = (p.get("mint") ?? "").trim();
  const from = Number(p.get("from"));
  const to = Number(p.get("to"));
  const chain = p.get("chain") ?? "solana";
  if (!isChainId(chain) || !addressMatchesChain(mint, chain)) {
    return NextResponse.json({ error: "invalid token address", code: "bad_mint" }, { status: 400 });
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > MAX_WINDOW_SECONDS) {
    return NextResponse.json({ error: "invalid time window", code: "bad_mint" }, { status: 400 });
  }
  try {
    const result = await fetchTransfers(mint, from, to, AMM_ADDRESSES, chain);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof UpstreamError) {
      const status = e.code === "rate_limit" ? 429 : 502;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    return NextResponse.json({ error: "unexpected error", code: "upstream" }, { status: 502 });
  }
}
