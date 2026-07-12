# Domain playbook — Equities

Message 3 of 8. Header: `📈 <b>Equities</b> — <b>{risk-on|risk-off|mixed}{, tilt}</b>`,
plus `<i>(last close, {date})</i>` appended if markets are closed. Full
layout/worked example: DESIGN.md §2, Message 3. Ticker universe (SPEC.md): SPY,
QQQ, DIA, IWM + VIX.

## Capability sequence

Gather in this order, using whatever armed tool provides each capability
(bound in Stage 1) or `WebSearch` if none does:

1. **Market status** — open/closed, gather **first**. Determines whether the
   rest of this section is real-time or last-close framing (per SPEC.md failure
   handling: market closed → last-close, explicitly labeled, never presented as
   real-time).
2. **Index quotes** — SPY, QQQ, DIA, IWM, and VIX. Levels + signed % change for
   each; one batched call/search if the tool supports it.
3. **Put/call ratio** — market-wide or SPY-proxy reading, feeds the regime line
   alongside VIX. Commonly no armed tool carries this — see fallback below.
4. **Breadth / top movers** — extract the sector tilt (which sectors dominate
   gainers vs. losers), not a raw list.
5. **Market news + sentiment** — general market topic, for the sentiment read.
6. **Earnings calendar** — next 1-2 weeks, flag notable names on deck.

## Extraction

- Market open/closed state (and last-close date if closed).
- SPY, QQQ, DIA, IWM: level + signed % change, arrow.
- VIX: level + signed change, arrow; note "ticking up/down" qualitatively.
  `data/summary.json` carries `VIXCLS` (FRED, **prior close** — never present it
  as real-time) with delta/z vs. baseline: use it as the vol anchor for regime
  framing ("VIX vs. its 30-snapshot mean"), while the live level still comes
  from the quote tools above. Footer-credit as `FRED(vix_close)` when used.
- Put/call ratio if available; if not, VIX-only regime read (note this in
  Message 1's `Notes:` line per DESIGN.md's worked example).
- Sector tilt from gainers/losers (which sectors green vs. red — 2-3 words each).
- Sentiment tone (neutral/cautious/constructive) and any earnings on deck.

## Fallback if a capability has no tool or a tool fails

- `ToolSearch` the live inventory first (deferred tools don't appear until
  requested).
- Still failing after one retry: degrade to `WebSearch` (e.g.
  `"S&P 500 Nasdaq Dow Russell 2000 close today"`, `"VIX level today"`) and mark
  `TOOL✗→WebSearch` in the footer.
- No put/call source is common (data licensing) — this is not
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
