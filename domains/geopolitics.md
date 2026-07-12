# Domain playbook — Geopolitics & Catalysts

Message 6 of 8. Header: `🌍 <b>Geopolitics & Catalysts</b> — <b>risk:
{calm|elevated|acute}</b>`. Full layout/worked example: DESIGN.md §2, Message 6.

This domain is live web search/WebFetch plus `data/catalysts.json` for
scheduled US catalysts, plus any armed earnings/IPO-calendar capability for
corporate catalyst dates.

**Live web search is mandatory here, not a fallback** (CLAUDE.md Stage 3 hard
rule). The briefing serves a reader who is checked out from the news; the
`Active tensions` world-affairs sweep (steps 2-3) must run via live web search
(`WebSearch` or an armed Exa-style search tool) on every run — direct APIs and
cached files never replace it. `catalysts.json` only removes the need to
*search* for scheduled US catalysts.

## Capability sequence

1. **Read `data/catalysts.json`** — scheduled catalysts: authoritative for
   upcoming US economic-release dates (CPI, PPI, Employment Situation, GDP,
   PCE, retail sales, Michigan sentiment, weekly claims; 14-day window, sourced
   from the FRED release calendar in Stage 2) **and FOMC rate-decision dates**
   (merged from the repo-persisted Fed schedule, present even if the FRED
   fetch was skipped or errored). Footer-credit as `FRED(calendar)`. If its
   `status` isn't `ok`, degrade to a `WebSearch` for the release dates; the
   FOMC entries in the file remain valid. Supplement with one `WebSearch` for
   what it cannot carry — other central bank meetings (ECB, BoJ), elections,
   OPEC+ (e.g. `"ECB BoJ OPEC meeting schedule next 4 weeks"`).
2. `WebSearch` — active tensions: conflicts, sanctions, tariffs/trade actions
   currently moving markets (e.g. `"geopolitical risk markets this week
   conflict sanctions tariffs"`).
3. `WebSearch` — targeted follow-up on any specific tension surfaced above that
   needs a second query to pin down a date or a concrete market linkage (e.g.
   an OPEC+ decision date, a tariff deadline).
4. `WebFetch` — only if a WebSearch result points at a primary source worth
   pulling directly (e.g. a central bank statement page, an official calendar)
   for a precise date; skip if WebSearch already gave a firm date.
5. **Earnings/IPO calendar** (only if an armed tool carries it — skip
   otherwise, do not web-search for this) — any entries that function as
   market catalysts beyond what's covered in the Equities/Tech messages
   (e.g. sector-moving reports, notable IPOs).

Budget: typically 2-4 `WebSearch` calls (catalysts.json usually saves one) and
at most 1 `WebFetch` call — do not over-search this section; it is the most
fallback-prone-to-noise domain. The floor is never zero: the active-tensions
sweep always runs.

## Extraction

- Scheduled catalysts with concrete dates (or date ranges): central bank
  meetings, key data prints, elections, OPEC+ decisions.
- Active tensions currently priced into markets: conflicts, sanctions,
  tariffs/trade actions — 1-2 line description each.
- For each item above, one line of market linkage: what it concretely means for
  the tape (e.g. oil floor, inflation risk, sector exposure).

## Fallback if a tool fails or is missing

- If a web search returns nothing useful for a sub-query, try one rephrase; if
  still empty, state plainly in that subsection that no material catalyst/
  tension was identified this run rather than inventing content.
- The earnings/IPO calendar capability is optional: if no armed tool carries
  it, skip it silently — it is supplementary here, already covered in
  Equities/Tech.

## Message content (mirror DESIGN.md §2 subsection order exactly)

1. `Scheduled catalysts` — dated bullets (central bank meetings, data prints,
   elections, OPEC+).
2. `Active tensions` — conflicts, sanctions, tariffs/trade bullets.
3. `Market linkage` — one line per item connecting it to the tape.
4. Sources footer.

Header risk tag (`calm`/`elevated`/`acute`) is your synthesis of how many active
tensions are live and how directly they're pressuring markets right now — not a
separate call.
