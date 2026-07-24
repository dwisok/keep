# ⏪ rewind

Paste a token address — Solana, Base, Robinhood Chain or another EVM chain — and watch
everything that happened to it replay as an on-chain film: a live bubble map where buys, sells
and wallet-to-wallet transfers flow as animated particle streams between bubbles that grow and
shrink in real time.

## Setup

```bash
pnpm install
cp .env.example .env        # then paste your two keys
pnpm dev                    # http://localhost:3000
```

No database, no auth, no server state. The only server code is three stateless proxy routes
that keep the API keys out of the browser.

### Env vars

| var               | where to get it                                                        |
| ----------------- | ---------------------------------------------------------------------- |
| `BIRDEYE_API_KEY` | https://bds.birdeye.so → dashboard → API keys (Standard plan is fine)   |
| `HELIUS_API_KEY`  | https://dashboard.helius.dev → API keys (free tier works; transfers use the parsed-history endpoint) |

No keys yet? Everything runs on mock data at `/t/mock?mock=1` — same engine, seeded generator,
zero API calls. The landing hero runs on it too.

## Routes

- `/` — landing (the hero is a live ambient replay on mock data)
- `/app` — paste-a-CA screen with recent tokens (localStorage)
- `/t/{mint}?w=1h` — deep link straight into a replay (`w` ∈ 30m/1h/2h/6h/24h/launch, `&mock=1` for the demo)
- `&chain=base|robinhood|ethereum|arbitrum|bsc` pins the chain for a `0x…` address; omitted, the
  server probes the supported chains and resolves it automatically (Solana mints never need it)

### Chains & providers

| chain | swaps | wallet-to-wallet transfers |
| --- | --- | --- |
| Solana | Birdeye | Helius |
| Base / Ethereum / Arbitrum / BNB | Birdeye (`x-chain` header) | — (swaps only) |
| Robinhood Chain | GeckoTerminal (free, no key, ~last 24h / 300 trades per pool) | — (swaps only) |

`launch` replays from the token's creation (or the oldest reachable trade) up to now, capped at
30 days of depth. Playback speed is a true sim-time multiplier from 1× (real time) to 128×;
the default is auto-picked so the window plays in ≤ 2 minutes.

## Architecture

```
                       browser (all state lives here)
 ┌──────────────────────────────────────────────────────────────────┐
 │                                                                  │
 │   /            /app           /t/{mint}?w=1h                     │
 │  Landing      input +        ReplayApp ── ExportModal            │
 │  (hero =      recent CAs        │              │                 │
 │   mock        (localStorage)    │         MediaRecorder          │
 │   replay)                       ▼         (webm vp9/vp8)         │
 │      └────────────────► lib/engine/  ◄────────┘                  │
 │                         ReplayEngine — pure canvas, zero React   │
 │                         (layout · flows · bubbles · HUD)         │
 │                                 ▲                                │
 │                                 │ Scenario                       │
 │                         lib/data/index.ts                        │
 │                         fetchScenario(mint, window)              │
 │                         + generateMockScenario(seed)             │
 │                            │        │        │                   │
 └────────────────────────────┼────────┼────────┼───────────────────┘
                              ▼        ▼        ▼
                       /api/token  /api/trades  /api/transfers
                       (stateless proxies, keys from process.env)
                              │        │        │
                              ▼        ▼        ▼
                          Birdeye   Birdeye    Helius
                        (overview) (swap txs) (parsed transfers)
```

Everything converges into one normalized event format (`ReplayEvent`) — the engine never knows
where the data came from.

## How the replay is reconstructed

1. Fetch all swaps (Birdeye) and wallet-to-wallet transfers (Helius) inside the window,
   sort ascending, convert to `t = ts - windowStart`.
2. Initial holdings are computed forward from zero — a wallet that only sells starts with at
   least what it sold (`max(0, -min running balance)`).
3. Events are capped at ~400 per replay: largest by USD win, all transfers always survive
   (they carry the story). The UI shows a "showing top N events" note.
4. Wallets get labels (static map of DEX programs + CEX hot wallets) and behavioral tags
   derived from the window: `fresh`, `whale`, `sniper`, `deployer`.
5. Wallet count > 24 → the long tail is grouped into a single "retail" ring bubble,
   individually expandable in its popover.

If the Helius plan can't serve parsed transfer history, `/api/transfers` degrades to an
empty list (`stubbed: true`) and the replay ships buys/sells only.

## Files

```
lib/engine/     the replay engine — pure canvas + a state object, zero React
lib/data/       fetchScenario / mock generator / labels / server-side normalizers
app/api/        the three proxy routes
components/     ReplayApp, WalletPopover, ExportModal, Landing
```

## Export

`canvas.captureStream(60)` + `MediaRecorder`, recorded while an automated replay runs from
t=0. Two formats: 16:9 (1280×720) and 9:16 (720×1280 — stats and captions baked into the
canvas). Watermarked, downloads as `rewind-{symbol}-{window}.webm`. MP4 is out of scope.
