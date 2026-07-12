# Domain playbook — Macro & Liquidity

Message 2 of 8. Header: `🏦 <b>Macro & Liquidity</b> — <b>bias: {hawkish|dovish|neutral}</b>`.
Full layout/worked example: DESIGN.md §2, Message 2. Sources per SPEC.md "Data
sources per domain".

## Snapshot data first (`data/summary.json`)

The Stage 2 fetch already carries these FRED metrics with baseline framing
(delta, rolling means, z-score — respect the `warming_up` flag): net liquidity,
2s10s (`spread_2s10s`), SOFR, HY OAS (`BAMLH0A0HYM2`), broad dollar index
(`DTWEXBGS`), 10Y breakeven (`T10YIE`), WTI (`DCOILWTICO`), 3M bill (`DGS3MO`),
and VIX prior close (`VIXCLS`). **These are primary** — use them (with their
deltas/z-scores) before any tool call for the same data point; armed tools/
web search are the fallback for them, not the source. Footer-credit them as
script-sourced, e.g. `FRED(net_liq,2s10s,dollar,wti)`. If FRED shows
`skipped:no-key` or `error:` in the summary, fall through to the capability
sequence below for the affected series.

## Capability sequence

Gather in this order, using whatever armed tool provides each capability
(bound in Stage 1 — an Exa-style search/research tool covers most of these)
or `WebSearch` if none does. Record each real call (tool + compacted args) for
the sources footer:

1. **Treasury yields** — 10Y and 2Y latest. Compute 2s10s spread (10Y − 2Y)
   yourself if the snapshot's `spread_2s10s` is unavailable; state
   inverted/normal and steepening/flattening vs. the prior read if available.
2. **Fed funds rate** — latest value, note unchanged/changed vs. prior meeting.
3. **CPI** — latest YoY, compare to prior print (reaccelerating / cooling /
   steady). A PCE-adjacent cut is worth a line if it comes back alongside.
4. **Unemployment rate** — latest.
5. **Nonfarm payrolls** — latest print vs. prior.
6. **Real GDP** — latest annualized read.
7. **Retail sales** — latest MoM.
8. **Dollar direction** — only if the summary's `DTWEXBGS` is missing/stale:
   USD vs. EUR and JPY as a DXY proxy; state USD firm/soft qualitatively.
   Otherwise the snapshot dollar index (with its delta/z) is the source.
9. **Brent** — latest level and change. WTI comes from the snapshot
   (`DCOILWTICO`, prior-day close); fetch WTI only as its fallback.
10. **Gold** — level and change; mention copper only if it came back too and
    adds signal.
11. **Fed commentary** — one live web search for recent Fed commentary /
    liquidity conditions (e.g. `"Fed speakers this week rate path commentary"`),
    to source the Liquidity read line's qualitative context.

## Extraction

- 10Y, 2Y yields + computed 2s10s spread, Fed funds rate.
- CPI YoY (+ prior), unemployment rate, NFP (+ prior), real GDP, retail sales
  MoM.
- USD direction (firm/soft) from the snapshot dollar index (delta/z) or, on
  fallback, the FX crosses; 10Y breakeven; WTI/Brent level + %, gold level + %.
- One qualitative liquidity read: `easing` / `tightening` / `neutral`, grounded
  in the data above plus the WebSearch line.

## Fallback if a capability has no tool or a tool fails

- `ToolSearch` the live inventory first (deferred tools don't appear until
  requested).
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
   `neutral`) + a short clause tying it to the web-search-sourced Fed commentary.
5. Sources footer (blank line before it): tools actually called, compacted, with
   any fallback marked.

Header bias tag (`hawkish`/`dovish`/`neutral`) is your read of the rates +
inflation data taken together — not a separate tool call.
