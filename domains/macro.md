# Domain playbook — Macro & Liquidity

Message 2 of 8. Header: `🏦 <b>Macro & Liquidity</b> — <b>bias: {hawkish|dovish|neutral}</b>`.
Full layout/worked example: DESIGN.md §2, Message 2. Sources per SPEC.md "Data
sources per domain".

## Tool sequence

Call in this order, recording each real call (tool + compacted args) for the
sources footer:

1. `mcp__claude_ai_Alpha_Vantage_MCP_Server__TREASURY_YIELD` — maturity `10year`,
   then again with `2year`. Compute 2s10s spread (10Y − 2Y) yourself; state
   inverted/normal and whether it's steepening or flattening vs. the prior read
   if available.
2. `mcp__claude_ai_Alpha_Vantage_MCP_Server__FEDERAL_FUNDS_RATE` — latest value,
   note unchanged/changed vs. prior meeting.
3. `mcp__claude_ai_Alpha_Vantage_MCP_Server__CPI` — latest YoY, compare to prior
   print (reaccelerating / cooling / steady).
4. `mcp__claude_ai_Alpha_Vantage_MCP_Server__INFLATION` — cross-check/supplement
   CPI if it carries a different cut (e.g. PCE-adjacent) worth a line.
5. `mcp__claude_ai_Alpha_Vantage_MCP_Server__UNEMPLOYMENT` — latest rate.
6. `mcp__claude_ai_Alpha_Vantage_MCP_Server__NONFARM_PAYROLL` — latest print vs.
   prior.
7. `mcp__claude_ai_Alpha_Vantage_MCP_Server__REAL_GDP` — latest annualized read.
8. `mcp__claude_ai_Alpha_Vantage_MCP_Server__RETAIL_SALES` — latest MoM.
9. `mcp__claude_ai_Alpha_Vantage_MCP_Server__DURABLES` — latest MoM, only include
   in the message if it adds a signal beyond retail sales (avoid padding).
10. `mcp__claude_ai_Alpha_Vantage_MCP_Server__CURRENCY_EXCHANGE_RATE` — USD vs.
    EUR and JPY as a DXY proxy (Alpha Vantage has no direct DXY index); state USD
    firm/soft qualitatively.
11. `mcp__claude_ai_Alpha_Vantage_MCP_Server__WTI` and
    `mcp__claude_ai_Alpha_Vantage_MCP_Server__BRENT` — latest level and change.
12. `mcp__claude_ai_Alpha_Vantage_MCP_Server__GOLD_SILVER_SPOT` — gold level and
    change; mention copper only if `COPPER` was also called and adds signal.
13. `WebSearch` — one query for recent Fed commentary / liquidity conditions
    (e.g. `"Fed speakers this week rate path commentary"`), to source the
    Liquidity read line's qualitative context.

## Extraction

- 10Y, 2Y yields + computed 2s10s spread, Fed funds rate.
- CPI YoY (+ prior), unemployment rate, NFP (+ prior), real GDP, retail sales
  MoM.
- USD direction (firm/soft) from the FX crosses, WTI/Brent level + %, gold level
  + %.
- One qualitative liquidity read: `easing` / `tightening` / `neutral`, grounded
  in the data above plus the WebSearch line.

## Fallback if a tool fails or is missing

- `ToolSearch` first for any Alpha Vantage tool not yet loaded.
- Still unavailable/errors twice (see CLAUDE.md rate-limit handling: retry once,
  then degrade): fall back to `WebSearch` for that specific data point
  (`"{indicator} latest reading"`, e.g. `"US CPI YoY latest print"`) and mark it
  in the footer as `TOOL✗→WebSearch`.
- If a whole subsection has nothing (all tools + fallback fail), state plainly
  in that subsection that the data is unavailable this run — do not omit the
  subsection silently.

## Message content (mirror DESIGN.md §2 subsection order exactly)

1. `Rates & curve` — 10Y, 2Y, 2s10s, Fed funds, each with arrow + signed delta.
2. `Inflation & growth` — CPI YoY (+ prior), unemployment, NFP (+ prior), real
   GDP, retail sales.
3. `Dollar & commodities` — USD direction, WTI, Brent, gold, copper (if called).
4. `Liquidity read:` one line, qualitative signal (`easing`/`tightening`/
   `neutral`) + a short clause tying it to the WebSearch-sourced Fed commentary.
5. Sources footer (blank line before it): tools actually called, compacted, with
   any fallback marked.

Header bias tag (`hawkish`/`dovish`/`neutral`) is your read of the rates +
inflation data taken together — not a separate tool call.
