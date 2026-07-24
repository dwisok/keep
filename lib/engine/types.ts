export type EventType = "buy" | "sell" | "xfer";

export type WalletTag =
  | "pool"
  | "dex"
  | "cex"
  | "wallet"
  | "fresh"
  | "whale"
  | "sniper"
  | "deployer"
  | "retail";

export type ReplayEvent = {
  t: number; // seconds from window start
  ts: number; // original unix timestamp
  type: EventType;
  from: string; // wallet address or 'pool'
  to: string; // wallet address or 'pool'
  tokens: number; // token amount (ui amount)
  usd: number; // usd value at time of event
  priceAfter: number; // token price after this event
  sig: string; // tx signature (for solscan links)
};

export type WalletMeta = {
  address: string;
  label: string; // 'Raydium', 'Binance', 'Ab3d…9xKq', …
  tags: WalletTag[];
};

export type Scenario = {
  mint: string;
  chain?: string; // ChainId — drives explorer links; absent/solana for legacy & mock
  symbol: string;
  name: string;
  supply: number;
  windowStart: number; // unix
  windowSeconds: number;
  wallets: WalletMeta[]; // discovered from events
  events: ReplayEvent[];
  initialHoldings: Record<string, number>; // holdings at windowStart
  price0: number;
  poolBaseline: number; // visual token baseline for the pool bubble
  capped?: number; // if set, events were capped to this count
  note?: string; // extra context for the stats strip (e.g. launch window clamped)
};

export type LiveStats = {
  time: number; // sim seconds from window start
  price: number;
  priceChangePct: number;
  mcap: number;
  volume: number;
  buys: number;
  sells: number;
  xfers: number;
  holders: number;
};

export type HolderInfo = {
  address: string;
  label: string;
  tags: WalletTag[];
  holdings: number; // tokens at current sim time
  pctSupply: number; // 0..100
  usd: number; // holdings at current price
  delta: number; // tokens net vs window start
};

export type NodeInfo = {
  id: string; // 'pool' | 'retail' | wallet address
  label: string;
  tags: WalletTag[];
  holdings: number;
  members?: string[]; // wallet addresses inside the retail group
};
