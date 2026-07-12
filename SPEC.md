# SPEC — marketstate

## What this is

A Claude Code routine (driven by a `CLAUDE.md` runbook in this directory) that, on each run, scans the current state of markets and liquidity — equities, macro/liquidity, crypto, and tech — plus upcoming events/catalysts and geopolitical pressures, produces a reasoned thesis on how markets are pricing those factors, and a probabilistic forecast of near-term developments. It delivers the result as a sequence of Telegram messages (one per topic/domain, plus a final TLDR) via the Composio MCP Telegram connector.

The run is grounded in a local fetch step: a bun + TypeScript fetcher pulls data from direct API endpoints (FRED for macro/liquidity series, Hyperliquid for perp open interest and aggregated funding), persists timestamped JSON snapshots under `data/`, and maintains a rolling baseline so every report can say "current vs. baseline" (deltas, simple z-scores) instead of raw numbers only. Whatever data tools the session is armed with (session-varying — typically Exa search/research and Composio actions) plus live web search then enrich the picture at run time (equities quotes, news, calendars, geopolitics). The runbook never assumes a specific data connector exists; it binds capabilities to the live tool inventory at Stage 1.

This is not a trading system and issues no trade recommendations. It is a market-intelligence briefing.

## Non-goals

- No backtesting, no portfolio management, no order execution.
- No backend service, database, or scheduler daemon. The run is a local fetch script plus the CLAUDE.md instructions executed by a Claude Code agent; scheduling is external (cron / `claude -p` / the `schedule` skill), documented in README.md, not built here.
- Minimal dependencies: bun + TypeScript with zod for API response validation, nothing else. Persistence is plain JSON files (user convention: JSON first, no DB).

## Run pipeline (stages, in order)

1. **Connector inventory.** List available MCP tools/connectors at the start of the run (explicit user requirement). Bind the domain playbooks' data capabilities to whatever tools are armed this session (deferred tools must be surfaced via `ToolSearch`; a capability with no matching tool falls back to web search) and check whether Composio Telegram send tools are present. If Telegram tools are absent, run the Composio authenticate flow, surface the auth link to the user, and **stop the run** — do not proceed to data gathering. A run that cannot deliver produces stale analysis by the time auth completes; simplest correct behavior is to gate the whole run on delivery capability, then rerun once connected.
2. **Local fetch.** Run the single fetch entrypoint (`bun run fetch`). It hits all direct API sources (FRED, Hyperliquid, crypto context, FRED release calendar), validates responses with zod, appends a timestamped snapshot per source under `data/snapshots/`, writes `data/catalysts.json`, and rewrites `data/summary.json` — latest values, baseline stats (rolling means, deltas, z-scores over prior snapshots), and per-source degradation flags. A missing `FRED_API_KEY` degrades gracefully (FRED skipped, flagged in summary and in the debug message) and never crashes the run. The agent then reads `data/summary.json` — one file — as the quantitative ground truth for the rest of the run.
3. **Data gathering per domain (MCP/WebSearch enrichment)**, in this order: Macro & Liquidity → Equities → Crypto → Tech → Geopolitics & Catalysts. Each domain step is a self-contained playbook: which tools to call, in what sequence, with what fallback (WebSearch/WebFetch) if a tool errors, is missing, or returns empty (e.g. market closed). Macro and Crypto lean on the fetched snapshots first (FRED series, Hyperliquid OI/funding) and use MCP tools to fill what the fetcher doesn't cover. Every domain step records which tools/sources it actually used (for the debug trace).
4. **Synthesis.** Cross-domain reasoning pass: how the pieces connect (e.g. rates + net liquidity shaping equity multiples, crypto OI/funding as a leverage/risk-appetite proxy, dollar strength vs. commodities), current-vs-baseline framing wherever the fetcher provides it, a reading of how markets are currently pricing the known catalysts, and a forecast of likely near-term developments with explicit confidence language (never certainty).
5. **Telegram delivery.** Send the message sequence defined in DESIGN.md, in order, each within the 4096-char Telegram limit, using the connector discovered in stage 1.
6. **TLDR.** Final message: compressed cross-domain summary of the whole run.

## Message sequence (exact — see DESIGN.md for layout/formatting detail)

1. Debug/connector-inventory message (tools discovered, Telegram connector status)
2. Macro & Liquidity message
3. Equities message
4. Crypto message
5. Tech message
6. Geopolitics & Catalysts message
7. Thesis & Forecast message (how markets are pricing it + predictive read, confidence-framed)
8. TLDR message (final, compressed cross-domain summary)

Each domain message (2-6) ends with a compact "sources" debug footer listing the tools/searches actually used for that section — this satisfies the "tool calls as debug messages" requirement without a wall of raw tool-call JSON.

## Direct fetch sources (the `src/` fetcher)

- **FRED** (`https://api.stlouisfed.org/fred/series/observations`, requires `FRED_API_KEY` env var — free key, never hardcoded, loaded from `.env` which is gitignored): `WALCL` (Fed balance sheet), `RRPONTSYD` (reverse repo), `WTREGEN` (Treasury General Account) — combined into a **net-liquidity** figure (WALCL − RRP − TGA, unit-normalized to billions); `DGS2`, `DGS10` (yields, 2s10s spread); `SOFR`; `BAMLH0A0HYM2` (HY OAS, credit-stress read); `VIXCLS` (VIX prior close); `DTWEXBGS` (broad dollar index); `T10YIE` (10Y breakeven inflation); `DCOILWTICO` (WTI); `DGS3MO` (3M bill). Missing key → FRED section skipped and flagged, run continues.
- **Hyperliquid** (`POST https://api.hyperliquid.xyz/info`, keyless, body `{"type":"metaAndAssetCtxs"}`): per-asset perp funding, open interest, 24h volume, mark price. Aggregated to market-level signals: total OI in USD (Σ openInterest × markPx), OI delta vs. previous snapshot and vs. baseline, OI-weighted average funding (funding skew), top assets by OI.
- **Crypto context** (all keyless): CoinGecko `/global` (total market cap, BTC dominance), alternative.me `/fng` (Fear & Greed index, 0-100), DefiLlama `/stablecoins` (USD stablecoin cap — crypto-native liquidity proxy), Deribit `get_volatility_index_data` (BTC DVOL, implied-vol index). Persisted as the `crypto_context` section of `data/summary.json`, baseline-tracked like every other metric.
- **FRED release calendar** (`/fred/releases/dates`, same key): upcoming major US economic releases (CPI, PPI, Employment Situation, GDP, PCE, retail sales, Michigan sentiment, weekly claims) over a 14-day window, plus FOMC rate-decision dates merged from the repo-persisted Fed schedule (`src/fomc.ts` — FRED pads FOMC with filler rows, so the static schedule owns those dates; refresh it yearly from the Fed calendar), written to `data/catalysts.json` for the Geopolitics playbook — replaces WebSearch for *scheduled US catalysts only*; the live world-affairs WebSearch sweep remains mandatory (see Data sources per domain).
- No other fetchers unless one materially improves the pipeline (ponytail: each fetcher justifies its existence). Equities quotes/news/calendars come from whatever tools the session is armed with at run time, with web search as the universal fallback.

## Persistence & baseline (`data/`)

- `data/snapshots/<source>/<UTC ISO timestamp>.json` — append-only raw-ish snapshot per source per run (validated, normalized values, not raw API bodies).
- `data/summary.json` — rewritten on every fetch; the ONE quantitative ground-truth file the executing agent reads. Contains per metric: latest value, timestamp, delta vs. previous snapshot, baseline stats over the prior snapshots (rolling mean over up to the last 30 and 90 snapshots, simple z-score of the latest value vs. the 30-window), and per-source status (`ok` / `skipped:no-key` / `error:<reason>`) — sections `fred`, `hyperliquid`, `crypto_context`, plus a `catalysts: {status, count}` field.
- `data/catalysts.json` — rewritten on every fetch; upcoming major US economic releases plus FOMC rate-decision dates merged from the repo-persisted Fed schedule (`src/fomc.ts`) (`{generated_at, status, window_days, releases: [{date, name}]}`), read only by the Geopolitics playbook.
- Baseline math is deliberately simple: means, deltas, z-scores. No decay weighting, no seasonality. With few snapshots the summary says so (`baseline: warming up, n=3`) rather than emitting misleading z-scores (minimum n=5 before z-scores are reported).
- `.env` is gitignored (secrets never committed). `data/` is **committed to the repo** — the routine runs daily and each run's snapshots, summary, and catalysts are persisted as history (see CLAUDE.md Stage 2's commit step).

## Data sources per domain

Each domain gathers *capabilities*, in priority order: (a) script-sourced snapshot data (`data/summary.json`, `data/catalysts.json`) where it exists, (b) any armed tool providing the capability (bound at Stage 1 — Exa-style search/research tools are the expected general-purpose fill), (c) live web search as the universal fallback.

- **Macro & Liquidity**: fetched FRED snapshot first (net liquidity, 2s10s, SOFR, HY OAS, broad dollar index, 10Y breakeven, WTI, 3M bill — with baseline deltas/z-scores); armed tools/web search for the rest: Fed funds rate, CPI (+ prior), unemployment, NFP, real GDP, retail sales, Brent/gold, and Fed commentary/liquidity conditions.
- **Equities**: market open/closed status first; index quotes (SPY, QQQ, DIA, IWM) and live VIX (regime read); breadth/top movers and sector tilt; market news + sentiment; earnings calendar; put/call ratio if any armed tool carries it (commonly absent — degrade to a VIX-only regime read).
- **Crypto**: fetched Hyperliquid + crypto-context snapshots first (total OI, OI deltas vs. baseline, funding skew, top assets; total mcap, BTC dominance, Fear & Greed, stablecoin cap, BTC DVOL — all baseline-tracked); armed tools/web search for BTC, ETH, SOL spot levels (24h/7d) and crypto news + sentiment.
- **Tech**: per-name quotes on AAPL, MSFT, NVDA, GOOGL, AMZN, META (mega-cap dispersion matters more than a single sector average) plus SMH for semis; tech news + sentiment; earnings calendar; web search for product/regulatory/AI-cycle news.
- **Geopolitics & Catalysts**: `data/catalysts.json` first for scheduled US catalysts (economic-release dates from the FRED release calendar, FOMC decision dates from the repo-persisted schedule); live web search/WebFetch for everything else — non-US central bank meetings, elections, conflicts, sanctions, OPEC decisions, tariffs/trade, plus any armed earnings/IPO-calendar capability for corporate catalysts. **The active-tensions web-search sweep is mandatory on every run** — the briefing serves a reader checked out from the news, and direct APIs never replace the live world-affairs scan.
- **Commodities/FX** (folded into Macro or Equities context as relevant): WTI comes from the FRED snapshot; Brent, natural gas, copper, gold/silver, and FX crosses from armed tools/web search as needed.

## Telegram formatting

Parse mode is **HTML**, mandated for all messages. Rationale: MarkdownV2 requires escaping a large character set (`_ * [ ] ( ) ~ \` &gt; # + - = | { } . !`) that collides with nearly every character in financial text — one missed escape throws a 400 and kills the send. HTML's escape set is only `& < >`, none of which appear in numbers. Telegram HTML supports a tag whitelist only: `<b> <i> <u> <s> <code> <pre> <a>` — no `<br>`, no `<h1>`, no `<ul>/<li>`. Use real newlines for line breaks and `•` for bullets. Escape `&`, `<`, `>` in dynamic values (tickers, headlines) only, never in the tags themselves.

## Repository layout

- `CLAUDE.md` — lean orchestrator: pipeline stages, connector-inventory step, fetch step, HTML formatting rules, debug convention, message-skeleton inline reference, error handling, links out to `domains/*.md`.
- `domains/` — one file per domain playbook (`macro.md`, `equities.md`, `crypto.md`, `tech.md`, `geopolitics.md`): exact tool sequence, fallback behavior, and what to extract, loaded on demand so CLAUDE.md doesn't bloat.
- `src/` — the bun + TypeScript fetcher: one module per source (`fred.ts`, `hyperliquid.ts`), zod schemas next to their fetchers, persistence/baseline logic, and a single entrypoint wired to `bun run fetch`. Each non-trivial module carries one runnable self-check against a recorded fixture (no live API calls in checks).
- `data/` — snapshots, `summary.json`, `catalysts.json` (committed to the repo, see Persistence & baseline).
- `package.json`, `tsconfig.json`, `.env.example` (documents `FRED_API_KEY`, no real values), `.gitignore`.
- No `templates/` directory — message skeletons are short and inlined directly in CLAUDE.md/DESIGN.md so the agent isn't chasing files for boilerplate.

## Debug-message convention

- Message 1 of every run is a debug message: full connector/tool inventory (what's available this run), Telegram delivery status, and the fetch result (per-source status from `data/summary.json`, e.g. `Fetch: FRED ✅ · Hyperliquid ✅` or `FRED skipped (no key)`).
- Every domain message (2-6) ends with a one-line, italic (`<i>...</i>`) sources footer, separated from the analysis by a blank line, naming the tools/searches actually used for that section — compact, not raw JSON. Format shape: `🔧 QUOTES(SPY,QQQ) · NEWS(technology) · WebSearch×2` — using whatever names the run's armed tools really have.
- No raw tool-call payloads are ever sent to Telegram. Debug means "which tools ran," not "what they returned."

## Failure handling

- **Fetch script fails entirely** (network down, bun missing): the run continues on MCP/WebSearch data alone; the debug message flags `Fetch: FAILED (<reason>)` and domain messages drop their baseline framing rather than inventing one.
- **`FRED_API_KEY` missing**: fetcher skips FRED, writes `skipped:no-key` status into `data/summary.json`, run continues; debug message and macro sources footer flag it.
- **Market closed**: determine market open/closed first (armed market-status capability, else web search); if closed, equities section reports last close explicitly labeled as such, does not claim real-time.
- **Capability with no armed tool**: `ToolSearch` the live inventory first (deferred tools don't appear until requested); if nothing matches, fall back to WebSearch and say so in the sources footer — this is the expected path, not an error.
- **Rate limit / API error**: retry once, then degrade to WebSearch for that data point and note the degradation in the sources footer; never fail the whole run over one tool.
- **Telegram/Composio unavailable**: run the Composio authenticate action (found in the live inventory — exact name varies), surface the auth link as plain text to the user (not to Telegram, since Telegram isn't connected yet), and stop the entire run before data gathering begins (see stage 1). Do not loop retrying the complete-authentication action — it needs a user-supplied code/redirect, so one attempt then stop-and-report is correct.
- **Any domain fails entirely**: still send its message, explicitly stating what's missing, rather than skipping the message (keeps the fixed message sequence predictable).

## Guardrails on predictions

The Thesis & Forecast message must frame every forward-looking statement with explicit confidence language (e.g. "likely," "low-confidence," "consensus expects... vs. our read...") and must never state a future market outcome as fact. This is a hard requirement, verified in the review gate.

## "Done" definition for this build

- Files present: `CLAUDE.md`, `SPEC.md` (this file), `DESIGN.md`, `README.md`, `domains/*.md`, the `src/` fetcher with `package.json`/`tsconfig.json`/`.env.example`/`.gitignore`.
- `CLAUDE.md` is internally consistent: every stage in the pipeline above is covered (including the fetch step and reading `data/summary.json`), it references data *capabilities* bound at run time rather than hardcoded tool names (no invented tools, no assumed connectors), and the message sequence matches DESIGN.md exactly.
- Message templates match DESIGN.md's specified layout, parse mode, and length budgets.
- `bun run fetch` executes cleanly in this environment: Hyperliquid path fetches live (keyless), FRED path exercises its graceful-degradation branch when no key is present, snapshots and `data/summary.json` are written and well-formed.
- TypeScript typechecks (`bunx tsc --noEmit` or equivalent) and the module self-checks pass without hitting live APIs.
- A dry-run walkthrough (a reviewer reading CLAUDE.md top to bottom and simulating being the executing agent) completes with no ambiguous, impossible, or order-broken step.
- No credentials or secrets appear anywhere in the repo; `.env` is gitignored (`data/` is committed but contains only public market data).
