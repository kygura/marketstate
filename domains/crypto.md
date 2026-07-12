# Domain playbook — Crypto

Message 4 of 8. Header: `₿ <b>Crypto</b> — <b>{bid|heavy|chop}{, qualifier}</b>`.
Full layout/worked example: DESIGN.md §2, Message 4. Ticker universe (SPEC.md):
BTC, ETH, SOL.

## Tool sequence

1. `mcp__claude_ai_Alpha_Vantage_MCP_Server__DIGITAL_CURRENCY_DAILY` — call once
   per symbol (BTC, ETH, SOL) against USD. Extract latest close, 24h change, and
   7d change (derive 7d from the daily series if not returned directly).
2. `mcp__claude_ai_Alpha_Vantage_MCP_Server__CRYPTO_INTRADAY` — BTC (and ETH/SOL
   if budget allows) for a finer same-day read if the daily series looks stale
   or if intraday move materially differs from the daily change.
3. `mcp__claude_ai_Alpha_Vantage_MCP_Server__NEWS_SENTIMENT` — topic
   `blockchain`, for the flow/news subsection.

## Extraction

- BTC, ETH, SOL: level (`$` prefix, thousands separator ≥ 10,000), signed 24h %,
  signed 7d % where available.
- Relative strength: compute ETH/BTC directional read (ETH outperforming/
  underperforming BTC) and flag whichever of the three is the clear leader.
- Risk-appetite read: compare crypto's direction to the macro USD read from
  `domains/macro.md` (if already run) — is crypto moving with or independent of
  broad risk sentiment/dollar strength? This is a cross-domain judgment call, not
  a tool call.
- Sentiment tone from `NEWS_SENTIMENT`, plus any concrete catalyst mentioned
  (ETF flows, protocol news, regulatory headline).

## Fallback if a tool fails or is missing

- `ToolSearch` first for any not-yet-loaded Alpha Vantage tool.
- Still failing after one retry: degrade to `WebSearch`
  (`"Bitcoin Ethereum Solana price today"`, `"crypto market news today"`) and
  mark `TOOL✗→WebSearch` in the footer.
- If all three symbols fail, still send the message: state plainly that live
  levels are unavailable this run and give whatever WebSearch-sourced
  qualitative read is possible (or state none is available).

## Message content (mirror DESIGN.md §2 subsection order exactly)

1. `Majors` — BTC, ETH, SOL, each with level, arrow, signed 24h % (and 7d % if
   available).
2. `Relative strength` — one line on ETH/BTC, one on which asset leads.
3. `Risk-appetite read:` one line tying crypto's behavior back to the macro
   picture (independent flows vs. broad risk-on/off).
4. `Flow / news:` sentiment tone + notable catalyst.
5. Sources footer.

Header tone tag (`bid`/`heavy`/`chop`) is your read of the three majors' combined
direction — not a separate call.
