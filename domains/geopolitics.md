# Domain playbook — Geopolitics & Catalysts

Message 6 of 8. Header: `🌍 <b>Geopolitics & Catalysts</b> — <b>risk:
{calm|elevated|acute}</b>`. Full layout/worked example: DESIGN.md §2, Message 6.

Alpha Vantage has no geopolitical data (SPEC.md). This domain is WebSearch/
WebFetch only, plus the two Alpha Vantage calendar tools for catalyst dates.

## Tool sequence

1. `WebSearch` — scheduled catalysts: query for upcoming central bank meetings
   (FOMC, ECB, BoJ), major data prints, elections, and OPEC+ meetings in the
   near-term window (e.g. `"FOMC ECB OPEC meeting schedule next 4 weeks"`).
2. `WebSearch` — active tensions: conflicts, sanctions, tariffs/trade actions
   currently moving markets (e.g. `"geopolitical risk markets this week
   conflict sanctions tariffs"`).
3. `WebSearch` — targeted follow-up on any specific tension surfaced above that
   needs a second query to pin down a date or a concrete market linkage (e.g.
   an OPEC+ decision date, a tariff deadline).
4. `WebFetch` — only if a WebSearch result points at a primary source worth
   pulling directly (e.g. a central bank statement page, an official calendar)
   for a precise date; skip if WebSearch already gave a firm date.
5. `mcp__claude_ai_Alpha_Vantage_MCP_Server__EARNINGS_CALENDAR` — any entries
   from this that function as market catalysts beyond what's covered in the
   Equities/Tech messages (e.g. sector-moving reports), if not already fully
   covered there.
6. `mcp__claude_ai_Alpha_Vantage_MCP_Server__IPO_CALENDAR` — any notable
   upcoming IPOs as catalysts.

Budget: typically 3-4 `WebSearch` calls and at most 1 `WebFetch` call — do not
over-search this section; it is the most fallback-prone-to-noise domain.

## Extraction

- Scheduled catalysts with concrete dates (or date ranges): central bank
  meetings, key data prints, elections, OPEC+ decisions.
- Active tensions currently priced into markets: conflicts, sanctions,
  tariffs/trade actions — 1-2 line description each.
- For each item above, one line of market linkage: what it concretely means for
  the tape (e.g. oil floor, inflation risk, sector exposure).

## Fallback if a tool fails or is missing

- If `WebSearch` returns nothing useful for a sub-query, try one rephrase; if
  still empty, state plainly in that subsection that no material catalyst/
  tension was identified this run rather than inventing content.
- The two Alpha Vantage calendar tools follow the standard fallback: `ToolSearch`
  first if not loaded, then `WebSearch` (`"upcoming IPOs this month"`,
  `"corporate earnings calendar next two weeks"`) if still unavailable, marked
  `TOOL✗→WebSearch` in the footer.

## Message content (mirror DESIGN.md §2 subsection order exactly)

1. `Scheduled catalysts` — dated bullets (central bank meetings, data prints,
   elections, OPEC+).
2. `Active tensions` — conflicts, sanctions, tariffs/trade bullets.
3. `Market linkage` — one line per item connecting it to the tape.
4. Sources footer.

Header risk tag (`calm`/`elevated`/`acute`) is your synthesis of how many active
tensions are live and how directly they're pressuring markets right now — not a
separate call.
