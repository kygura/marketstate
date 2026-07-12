# Domain playbook — Crypto

Message 4 of 8. Header: `₿ <b>Crypto</b> — <b>{bid|heavy|chop}{, qualifier}</b>`.
Full layout/worked example: DESIGN.md §2, Message 4. Ticker universe (SPEC.md):
BTC, ETH, SOL.

## Snapshot data first (`data/summary.json`)

Two summary sections are **primary** for this domain — use them (with baseline
framing: delta, rolling means, z-score; respect `warming_up`) before any tool
call for the same data point:

- `hyperliquid` — total perp OI (USD), OI delta vs. baseline, OI-weighted
  funding skew, top assets by OI. Feeds `Derivatives / leverage`.
- `crypto_context` — total market cap (`total_mcap_usd`, CoinGecko), BTC
  dominance (`btc_dominance_pct`, CoinGecko), Fear & Greed (`fear_greed`,
  alternative.me, 0-100), stablecoin cap (`stablecoin_cap_usd`, DefiLlama),
  BTC implied vol (`btc_dvol`, Deribit). Feeds `Relative strength` (dominance)
  and `Risk-appetite read` (F&G, DVOL, stablecoin cap vs. baseline).

Footer-credit as script-sourced: `Hyperliquid(OI,funding)`,
`CoinGecko(mcap,dominance)`, `DefiLlama(stables)`, `Deribit(DVOL)`. The
capabilities below remain the source for spot prices, intraday moves, and news —
anything the summary doesn't carry. If a summary section shows `error:`, fall
back to the capability sequence/WebSearch for those data points.

## Capability sequence

Gather using whatever armed tool provides each capability (bound in Stage 1)
or `WebSearch` if none does:

1. **Spot levels** — BTC, ETH, SOL vs. USD: latest level, 24h change, and
   7d change (derive 7d from a daily series if not returned directly).
2. **Intraday read** — BTC (and ETH/SOL if budget allows) only if the daily
   read looks stale or the intraday move materially differs from it.
3. **Crypto news + sentiment** — for the flow/news subsection.

## Extraction

- BTC, ETH, SOL: level (`$` prefix, thousands separator ≥ 10,000), signed 24h %,
  signed 7d % where available.
- Relative strength: compute ETH/BTC directional read (ETH outperforming/
  underperforming BTC) and flag whichever of the three is the clear leader.
- Risk-appetite read: compare crypto's direction to the macro USD read from
  `domains/macro.md` (if already run) — is crypto moving with or independent of
  broad risk sentiment/dollar strength? Ground it in the `crypto_context`
  metrics: Fear & Greed level, BTC DVOL vs. baseline, stablecoin cap
  growing/shrinking (dry powder proxy). This is a judgment call informed by the
  snapshot, not an extra tool call.
- Sentiment tone from the news/sentiment read, plus any concrete catalyst
  mentioned (ETF flows, protocol news, regulatory headline).

## Fallback if a capability has no tool or a tool fails

- `ToolSearch` the live inventory first (deferred tools don't appear until
  requested).
- Still failing after one retry: degrade to `WebSearch`
  (`"Bitcoin Ethereum Solana price today"`, `"crypto market news today"`) and
  mark `TOOL✗→WebSearch` in the footer.
- If all three symbols fail, still send the message: state plainly that live
  levels are unavailable this run and give whatever WebSearch-sourced
  qualitative read is possible (or state none is available).

## Message content (mirror DESIGN.md §2 subsection order exactly)

1. `Majors` — BTC, ETH, SOL, each with level, arrow, signed 24h % (and 7d % if
   available).
2. `Derivatives / leverage` — Hyperliquid total OI + funding skew vs. baseline
   (from the snapshot; deltas only while warming up).
3. `Relative strength` — one line on ETH/BTC, one on which asset leads; BTC
   dominance (+ delta) from `crypto_context`.
4. `Risk-appetite read:` one line tying crypto's behavior back to the macro
   picture (independent flows vs. broad risk-on/off), grounded in F&G, DVOL,
   and stablecoin cap vs. baseline.
5. `Flow / news:` sentiment tone + notable catalyst.
6. Sources footer.

Header tone tag (`bid`/`heavy`/`chop`) is your read of the three majors' combined
direction — not a separate call.
