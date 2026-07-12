# marketstate

A Claude Code routine that scans markets (equities, macro, crypto, tech) and geopolitics, analyzes current pricing and catalysts, and delivers an 8-message Telegram briefing. Each run is grounded by a local bun + TypeScript fetcher hitting direct APIs (FRED for macro/liquidity, Hyperliquid for perp open interest and funding, plus keyless crypto-context sources), persisting JSON snapshots under `data/` and building a rolling baseline — so every report frames current values against baseline, not raw numbers alone. Whatever data tools the session is armed with (typically Exa search/research) plus live web search enrich the picture at run time; Composio delivers to Telegram.

**Not financial advice.** This is market intelligence only — a reasoned read of public data, not a recommendation to buy or sell anything.

## Repository layout

- `CLAUDE.md` — runbook (pipeline stages, connector inventory, fetch step, error handling, message templates)
- `SPEC.md` — contract (data sources, tool sequences, failure modes, delivery)
- `DESIGN.md` — Telegram message design (layout, formatting, per-message examples, length budgets)
- `domains/*.md` — per-domain data playbooks (macro, equities, crypto, tech, geopolitics)
- `src/` — the fetcher (FRED, Hyperliquid modules, persistence/baseline logic)
- `data/` — timestamped snapshots + `summary.json` + `catalysts.json` (committed — the daily routine persists each run's snapshot to the repo)
- `package.json`, `.env.example` — fetcher dependencies and env template

## Prerequisites

- [bun](https://bun.sh) installed; run `bun install` once in this directory.
- Claude Code session open in this directory, with:
  - **Composio MCP** with Telegram connection (first run will surface auth link if not connected)
  - **WebSearch** enabled
  - Optionally, any data connectors (e.g. **Exa**) — the runbook discovers and binds whatever is armed at run time; anything missing degrades to web search
- No credentials stored in this repo — connector auth lives in the connectors, the FRED key in `.env` (gitignored).

## Setup

1. Get a free FRED API key: https://fred.stlouisfed.org/docs/api/api_key.html
2. `cp .env.example .env` and paste the key as `FRED_API_KEY`.

`.env` is gitignored and never committed. Without the key the run still works — FRED data is skipped and flagged; Hyperliquid needs no key.

## Launch

**Interactive (Claude Code UI):**
```
Run the marketstate briefing
```

**One-shot (CLI):**
```bash
cd /home/athan/projects/marketstate
claude -p "Run the marketstate briefing per CLAUDE.md"
```

The runbook executes `bun run fetch` first (writes snapshots and `data/summary.json`), then does MCP/WebSearch enrichment and Telegram delivery. To test the fetcher alone: `bun run fetch`.

## Scheduling

Use cron or Claude Code's `/schedule` skill to invoke the one-shot command at regular intervals (e.g., daily market open):
```bash
0 9 * * 1-5 cd /home/athan/projects/marketstate && claude -p "Run the marketstate briefing per CLAUDE.md"
```

## Output

Each run delivers 8 Telegram messages in sequence:

1. Debug / connector inventory + fetch status
2. Macro & Liquidity (net liquidity, rates, inflation, dollar, commodities)
3. Equities (indices, VIX, breadth, sentiment, earnings)
4. Crypto (BTC, ETH, SOL, perp OI/funding, risk read)
5. Tech / Mega-cap (AAPL, MSFT, NVDA, GOOGL, AMZN, META, semis, AI narrative)
6. Geopolitics & Catalysts (Fed meetings, elections, tariffs, supply shocks, market linkage)
7. Thesis & Forecast (how markets are pricing it, base and tail cases, confidence-framed)
8. TLDR (one-line per domain + watch list)

Each domain message includes a compact sources footer listing the tools/searches used.
