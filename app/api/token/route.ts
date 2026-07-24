import { NextRequest, NextResponse } from "next/server";
import { detectEvmChain, fetchTokenInfo, UpstreamError } from "@/lib/data/server";
import { addressMatchesChain, isChainId, isEvmAddress, type ChainId } from "@/lib/chains";
import { isValidAddress } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const mint = (req.nextUrl.searchParams.get("mint") ?? "").trim();
  const chainParam = req.nextUrl.searchParams.get("chain") ?? "auto";
  if (!isValidAddress(mint)) {
    return NextResponse.json({ error: "invalid token address", code: "bad_mint" }, { status: 400 });
  }
  try {
    let chain: ChainId;
    if (isChainId(chainParam) && addressMatchesChain(mint, chainParam)) {
      chain = chainParam;
    } else if (isEvmAddress(mint)) {
      chain = await detectEvmChain(mint); // 0x with no (or mismatched) chain — probe
    } else {
      chain = "solana";
    }
    const info = await fetchTokenInfo(mint, chain);
    return NextResponse.json(info);
  } catch (e) {
    if (e instanceof UpstreamError) {
      const status = e.code === "rate_limit" ? 429 : e.code === "not_found" ? 404 : 502;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    return NextResponse.json({ error: "unexpected error", code: "upstream" }, { status: 502 });
  }
}
