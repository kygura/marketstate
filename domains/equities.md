# Domain playbook — Equities

Message 3 of 8. Header: `📈 <b>Equities</b> — <b>{risk-on|risk-off|mixed}{, tilt}</b>`,
plus `<i>(last close, {date})</i>` appended if markets are closed. Full
layout/worked example: DESIGN.md §2, Message 3. Ticker universe (SPEC.md): SPY,
QQQ, DIA, IWM + VIX.

## Tool sequence

1. `mcp__claude_ai_Alpha_Vantage_MCP_Server__MARKET_STATUS` — call **first**.
   Determines whether the rest of this section is real-time or last-close
   framing (per SPEC.md failure handling: market closed → last-close, explicitly
   labeled, never presented as real-time).
2. `mcp__claude_ai_Alpha_Vantage_MCP_Server__REALTIME_BULK_QUOTES` (preferred,
   one call for the whole basket) or, if unavailable,
   `mcp__claude_ai_Alpha_Vantage_MCP_Server__GLOBAL_QUOTE` per symbol — SPY, QQQ,
   DIA, IWM, and VIX. Levels + signed % change for each.
3. `mcp__claude_ai_Alpha_Vantage_MCP_Server__REALTIME_PUT_CALL_RATIO` — market-
   wide or SPY-proxy reading, feeds the regime line alongside VIX.
4. `mcp__claude_ai_Alpha_Vantage_MCP_Server__TOP_GAINERS_LOSERS` — extract the
   sector tilt (which sectors dominate gainers vs. losers), not the raw list.
5. `mcp__claude_ai_Alpha_Vantage_MCP_Server__NEWS_SENTIMENT` — general market /
   `financial_markets` topic, for the sentiment read.
6. `mcp__claude_ai_Alpha_Vantage_MCP_Server__EARNINGS_CALENDAR` — next 1-2 weeks,
   flag notable names on deck.
7. `mcp__claude_ai_Alpha_Vantage_MCP_Server__INDEX_DATA` /
   `mcp__claude_ai_Alpha_Vantage_MCP_Server__INDEX_CATALOG` — optional, only if
   a broader index cross-check adds signal beyond the four ETFs; skip if
   redundant (keep the message under budget).

## Extraction

- Market open/closed state (and last-close date if closed).
- SPY, QQQ, DIA, IWM: level + signed % change, arrow.
- VIX: level + signed change, arrow; note "ticking up/down" qualitatively.
- Put/call ratio if available; if not, VIX-only regime read (note this in
  Message 1's `Notes:` line per DESIGN.md's worked example).
- Sector tilt from gainers/losers (which sectors green vs. red — 2-3 words each).
- Sentiment tone (neutral/cautious/constructive) and any earnings on deck.

## Fallback if a tool fails or is missing

- `ToolSearch` first for any not-yet-loaded Alpha Vantage tool.
- Still failing after one retry: degrade to `WebSearch` (e.g.
  `"S&P 500 Nasdaq Dow Russell 2000 close today"`, `"VIX level today"`) and mark
  `TOOL✗→WebSearch` in the footer.
- `REALTIME_PUT_CALL_RATIO` unavailable is common (data licensing) — this is not
  an error to chase hard; drop to a VIX-only regime read and note the
  degradation, as shown in DESIGN.md's Message 1 worked example.

## Message content (mirror DESIGN.md §2 subsection order exactly)

1. `Indices` — SPY, QQQ, DIA, IWM, each with level, arrow, signed %.
2. `Volatility / regime` — VIX level + direction, put/call if available.
3. `Breadth & movers` — leadership description (narrow/broad), sector tilt.
4. `Sentiment & catalysts` — news sentiment read, earnings on deck.
5. Sources footer.

Header regime tag is derived from the combination of index direction, VIX
direction, and breadth — not a separate call.
