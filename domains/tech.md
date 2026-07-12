# Domain playbook — Tech / Mega-cap

Message 5 of 8. Header: `💻 <b>Tech / Mega-cap</b> — <b>{leadership intact|
rotating out|dispersed}{, qualifier}</b>`. Full layout/worked example:
DESIGN.md §2, Message 5. Ticker universe (SPEC.md): AAPL, MSFT, NVDA, GOOGL,
AMZN, META, plus SMH (semis).

## Tool sequence

1. `mcp__claude_ai_Alpha_Vantage_MCP_Server__REALTIME_BULK_QUOTES` (preferred,
   one call) or `mcp__claude_ai_Alpha_Vantage_MCP_Server__GLOBAL_QUOTE` per
   symbol — AAPL, MSFT, NVDA, GOOGL, AMZN, META, and SMH. Level + signed % each.
2. `mcp__claude_ai_Alpha_Vantage_MCP_Server__NEWS_SENTIMENT` — topic
   `technology`, for AI-cycle/product/regulatory narrative beats.
3. `mcp__claude_ai_Alpha_Vantage_MCP_Server__EARNINGS_CALENDAR` — filtered to
   these six names, next 2-4 weeks.
4. `WebSearch` — one to two queries filling gaps `NEWS_SENTIMENT` doesn't cover
   well, e.g. `"AI capex datacenter spending news this week"`,
   `"{ticker} antitrust regulatory news"` for whichever name has an active
   storyline.

## Extraction

- All six names individually, level + signed %, arrow — dispersion is the point
  (SPEC.md); never average them into one sector figure.
- SMH level + signed %, and a one-clause read on whether semis breadth is wide
  or concentrated in one name (commonly NVDA).
- Two to three AI-cycle/product/regulatory narrative beats from
  `NEWS_SENTIMENT` + WebSearch — compressed to one line each.
- Upcoming earnings among the six, with rough timing (`~2 weeks`, exact date if
  short-dated).

## Fallback if a tool fails or is missing

- `ToolSearch` first for any not-yet-loaded Alpha Vantage tool.
- Still failing after one retry: degrade to `WebSearch`
  (`"{ticker} stock price today"` per missing name, or `"mega-cap tech stocks
  today Nasdaq"` for a batch read) and mark `TOOL✗→WebSearch` in the footer.
- If a name is missing a quote entirely, state it inline (`META: n/a this run`)
  rather than silently dropping it from the dispersion list — all six must
  appear.

## Message content (mirror DESIGN.md §2 subsection order exactly)

1. `Mega-cap dispersion` — all six names, one line each (or tightly paired),
   level + arrow + signed %.
2. `Semis:` SMH level + signed %, breadth note.
3. `AI-cycle / news` — 2-3 bullets, narrative beats.
4. `Catalysts:` upcoming earnings among the six.
5. Sources footer.

Header tone tag is your read of the dispersion: tight clustering = "leadership
intact", broad red with one green name = "dispersed, {name}-led", broad
weakness = "rotating out".
