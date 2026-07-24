// Wire types shared between the API proxy routes (server) and fetchScenario (client).

import type { ChainId } from "@/lib/chains";

export type RawTrade = {
  ts: number; // unix seconds
  side: "buy" | "sell";
  owner: string;
  tokens: number; // ui amount of the tracked token
  usd: number;
  price: number; // token price at the tx
  sig: string;
};

export type RawTransfer = {
  ts: number;
  from: string;
  to: string;
  tokens: number;
  sig: string;
};

export type TokenInfo = {
  symbol: string;
  name: string;
  supply: number;
  price: number;
  liquidity: number; // usd
  createdAt: number | null; // unix seconds, null if unknown
  chain: ChainId; // resolved chain (auto-detected for 0x addresses)
};

export type TradesResponse = { trades: RawTrade[]; partial: boolean };
export type TransfersResponse = { transfers: RawTransfer[]; stubbed: boolean };

export type ApiError = { error: string; code: "bad_mint" | "rate_limit" | "upstream" | "not_found" };
