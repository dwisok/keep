// Chain registry — client-safe (no keys). One entry per supported network.
// provider decides which server driver serves the data:
//   birdeye — Solana + the EVM chains Birdeye indexes (x-chain header)
//   gecko   — GeckoTerminal, for chains Birdeye doesn't cover (Robinhood Chain)

export type ChainId = "solana" | "base" | "robinhood" | "ethereum" | "arbitrum" | "bsc";

export type ChainDef = {
  id: ChainId;
  label: string;
  family: "svm" | "evm";
  provider: "birdeye" | "gecko";
  /** value of Birdeye's x-chain header (birdeye provider only) */
  birdeyeChain?: string;
  /** GeckoTerminal network id (gecko provider only) */
  geckoNetwork?: string;
  explorerTx: (sig: string) => string;
  explorerAccount: (addr: string) => string;
};

export const CHAINS: Record<ChainId, ChainDef> = {
  solana: {
    id: "solana",
    label: "Solana",
    family: "svm",
    provider: "birdeye",
    birdeyeChain: "solana",
    explorerTx: (sig) => `https://solscan.io/tx/${sig}`,
    explorerAccount: (addr) => `https://solscan.io/account/${addr}`,
  },
  base: {
    id: "base",
    label: "Base",
    family: "evm",
    provider: "birdeye",
    birdeyeChain: "base",
    explorerTx: (sig) => `https://basescan.org/tx/${sig}`,
    explorerAccount: (addr) => `https://basescan.org/address/${addr}`,
  },
  robinhood: {
    id: "robinhood",
    label: "Robinhood Chain",
    family: "evm",
    provider: "gecko",
    geckoNetwork: "robinhood",
    explorerTx: (sig) => `https://robinhoodchain.blockscout.com/tx/${sig}`,
    explorerAccount: (addr) => `https://robinhoodchain.blockscout.com/address/${addr}`,
  },
  ethereum: {
    id: "ethereum",
    label: "Ethereum",
    family: "evm",
    provider: "birdeye",
    birdeyeChain: "ethereum",
    explorerTx: (sig) => `https://etherscan.io/tx/${sig}`,
    explorerAccount: (addr) => `https://etherscan.io/address/${addr}`,
  },
  arbitrum: {
    id: "arbitrum",
    label: "Arbitrum",
    family: "evm",
    provider: "birdeye",
    birdeyeChain: "arbitrum",
    explorerTx: (sig) => `https://arbiscan.io/tx/${sig}`,
    explorerAccount: (addr) => `https://arbiscan.io/address/${addr}`,
  },
  bsc: {
    id: "bsc",
    label: "BNB Chain",
    family: "evm",
    provider: "birdeye",
    birdeyeChain: "bsc",
    explorerTx: (sig) => `https://bscscan.com/tx/${sig}`,
    explorerAccount: (addr) => `https://bscscan.com/address/${addr}`,
  },
};

/** Probe order when a 0x address arrives without an explicit chain. */
export const EVM_DETECT_ORDER: ChainId[] = ["base", "robinhood", "ethereum", "arbitrum", "bsc"];

export function isChainId(s: string): s is ChainId {
  return s in CHAINS;
}

export function isEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(s.trim());
}

/** Does this address fit the chain's address family? */
export function addressMatchesChain(addr: string, chain: ChainId): boolean {
  return CHAINS[chain].family === "evm"
    ? isEvmAddress(addr)
    : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr.trim());
}

// chain arrives as a plain string from Scenario — fall back to solana if unknown
export function explorerTx(chain: string | undefined, sig: string): string {
  return CHAINS[chain && isChainId(chain) ? chain : "solana"].explorerTx(sig);
}

export function explorerAccount(chain: string | undefined, addr: string): string {
  return CHAINS[chain && isChainId(chain) ? chain : "solana"].explorerAccount(addr);
}
