import type { WalletTag } from "@/lib/engine/types";

// Known program / pool / exchange addresses. Public, widely-cited lists.
// tag drives bubble color + caption tone; label is what renders under the bubble.
export const KNOWN_ADDRESSES: Record<string, { label: string; tag: WalletTag }> = {
  // AMM / DEX programs & authorities
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": { label: "Raydium v4", tag: "dex" },
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1": { label: "Raydium", tag: "dex" },
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: { label: "Raydium CPMM", tag: "dex" },
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: { label: "Raydium CLMM", tag: "dex" },
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: { label: "Orca", tag: "dex" },
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: { label: "Meteora DLMM", tag: "dex" },
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB: { label: "Meteora", tag: "dex" },
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": { label: "Pump.fun", tag: "dex" },
  CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM: { label: "Pump.fun fee", tag: "dex" },
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: { label: "PumpSwap", tag: "dex" },
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: { label: "Jupiter", tag: "dex" },

  // CEX hot wallets
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": { label: "Binance", tag: "cex" },
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": { label: "Binance", tag: "cex" },
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": { label: "Binance", tag: "cex" },
  H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS: { label: "Coinbase", tag: "cex" },
  GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE: { label: "Coinbase", tag: "cex" },
  "5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD": { label: "OKX", tag: "cex" },
  AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2: { label: "Bybit", tag: "cex" },
  FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5: { label: "Kraken", tag: "cex" },
};

/** Addresses whose transfers are AMM plumbing, not wallet-to-wallet stories. */
export const AMM_ADDRESSES: Set<string> = new Set(
  Object.entries(KNOWN_ADDRESSES)
    .filter(([, v]) => v.tag === "dex")
    .map(([k]) => k)
);
