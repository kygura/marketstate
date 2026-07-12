# CLAUDE.md — marketstate orchestrator runbook

This file is the executable routine. It tells a Claude Code agent how to run one
complete marketstate cycle: run the local fetcher, gather market state across five
domains, synthesize a thesis, and deliver an 8-message Telegram briefing. Full
contract: `SPEC.md`
(pipeline, failure handling) and `DESIGN.md` (message layouts, worked examples,
formatting rules). This file does not restate everything in those two — where it
summarizes, it points at the exact section to read before acting.

## Purpose

marketstate produces a market-intelligence briefing: current state of macro
liquidity, equities, crypto, tech, and geopolitics, plus a cross-domain thesis and
a probabilistic near-term forecast, delivered as a sequence of Telegram messages.

**Hard rule:** this is market intelligence, not financial advice. No trade
recommendations, no order execution, no portfolio guidance. Every forward-looking
statement must be framed with explicit confidence language (`likely`, `we lean`,
`low-confidence`, `risk skews`) — never state a future market outcome as fact. This
is enforced concretely in Stage 4 and Message 7 (see DESIGN.md §6).

---

## Stage 1 — Connector inventory (every run, no exceptions)

This is a hard user requirement: list available MCP tools/connectors at the start
of **every** run, before any data gathering.

1. **Enumerate what's already loaded** in this session (any `mcp__*` tools visible
   without a ToolSearch call, plus built-in `WebSearch`/`WebFetch`).
2. **Load the Alpha Vantage MCP tools.** They are deferred in the runtime session —
   they will not appear until requested. Call `ToolSearch` for them, e.g.:
   - `ToolSearch(query: "select:mcp__claude_ai_Alpha_Vantage_MCP_Server__GLOBAL_QUOTE,mcp__claude_ai_Alpha_Vantage_MCP_Server__TREASURY_YIELD,...")`
     naming the specific tools this run's domains will need, or a keyword search
     (`"Alpha Vantage"`) if unsure which names apply. Load once, up front, not
     mid-domain — a mid-domain miss should still fall back per the failure table
     below rather than trigger a second inventory pass.
   - Domain playbooks in `domains/*.md` each name the exact tools they call; load
     the union of those before Stage 3 starts.
3. **Discover the Telegram send tool.** Composio's tool name for "send a Telegram
   message" is not fixed and must never be hardcoded (DESIGN.md §8). Search the
   live tool inventory (ToolSearch, keyword or listing) for a Composio action whose
   name contains both a Telegram marker and a send/message marker (e.g. something
   shaped like `*TELEGRAM*SEND*MESSAGE*`). Bind whatever name is found to a local
   reference — call it "the Telegram send tool" for the rest of the run — and read
   its schema to learn the exact parameter names (chat/target id, text, parse mode)
   at call time, since Composio schemas vary between sessions.
4. **Gate on delivery capability.** If no matching Telegram send tool is found:
   - Run `mcp__composio__authenticate` **once**.
   - Surface the returned auth link as **plain text to the user in this session**
     (not to Telegram — it isn't connected yet).
   - **Stop the run.** Do not proceed to Stage 2. Do not loop on
     `mcp__composio__complete_authentication` — it needs a user-supplied code, so
     one attempt then stop-and-report is correct. Rerun the whole routine once the
     user confirms the connection.
5. If the Telegram tool **is** found, continue. Message 1 (Debug) is composed
   after Stage 2 — it combines what was discovered here with the fetch status from
   `data/summary.json` (see the skeleton below) — but is not sent until Stage 5
   reaches it in sequence.

Never hardcode credentials, chat/target ids, or tool names in this repo. The chat
id comes from the connected account/config at run time.

---

## Stage 2 — Local fetch

Run the fetcher once, from the project root, before any MCP data gathering:

```
bun run fetch
```

(via Bash, working directory `/home/athan/projects/marketstate` or wherever this
repo lives). It pulls the direct API sources — FRED (net liquidity = WALCL − RRP −
TGA, 2s10s, SOFR, HY OAS) and Hyperliquid (perp total OI, OI deltas, funding
skew) — validates responses, appends timestamped snapshots under `data/snapshots/`,
and rewrites `data/summary.json`.

Then **Read `data/summary.json`**. It is the ONE quantitative ground-truth file
for the run: per metric it carries the latest value, delta vs. previous snapshot,
baseline stats (rolling means, z-score vs. the 30-window), and per-source status
(`ok` / `skipped:no-key` / `error:<reason>`). Read it before any MCP calls; the
Macro and Crypto playbooks treat it as their primary source.

Failure handling (SPEC.md):

- **Fetch fails entirely** (network down, bun missing, script error): continue the
  run on MCP/WebSearch data alone. Flag `Fetch: FAILED (<reason>)` in the debug
  message, and drop all baseline framing from every message — never invent a
  baseline the fetcher didn't provide.
- **`FRED_API_KEY` missing**: the fetcher degrades gracefully — `data/summary.json`
  shows FRED as `skipped:no-key`, Hyperliquid data is still valid. Flag it in the
  debug message (`FRED skipped (no key)`) and in the Macro sources footer; Macro
  falls back to Alpha Vantage/WebSearch for the affected series.
- Respect the summary's warming-up flag: if it reports `baseline: warming up`
  (fewer than 5 snapshots), use deltas only — no z-score language.

Do not create or modify anything under `src/` — the fetcher is owned by its own
build; this runbook only executes it and reads its output.

---

## Stage 3 — Data gathering (fixed order)

Order: **Macro & Liquidity → Equities → Crypto → Tech → Geopolitics & Catalysts.**
This order is fixed — it matches the message sequence in SPEC.md and DESIGN.md.
Macro and Crypto lean on the Stage 2 snapshot data first (FRED series, Hyperliquid
OI/funding) and use MCP tools to fill what the fetcher doesn't cover.

For each domain, open its playbook and follow it exactly:

| Domain | Playbook |
|---|---|
| Macro & Liquidity | `domains/macro.md` |
| Equities | `domains/equities.md` |
| Crypto | `domains/crypto.md` |
| Tech / Mega-cap | `domains/tech.md` |
| Geopolitics & Catalysts | `domains/geopolitics.md` |

Each playbook gives: the exact tool-call sequence, what to extract from each
response, the fallback if a tool is missing/errors/empty, and the exact content
the domain's Telegram message must contain.

**While executing each playbook, record which tools and sources were actually
used** (real calls, not just attempted) — this feeds directly into that domain's
sources footer in Stage 5. Track: tool name, the compacted argument list (e.g.
symbols called with), any script-sourced data (`FRED(net_liq,2s10s)`,
`Hyperliquid(OI,funding)`), and any fallback that fired (`TOOL✗→WebSearch`). Do
this bookkeeping as you go; reconstructing it after the fact from memory is
error-prone.

If a domain fails entirely (every tool in its playbook errors and its WebSearch
fallback turns up nothing usable), do not skip it — proceed to Stage 5 and send
that domain's message stating plainly what's missing. The fixed 8-message
sequence never shrinks (SPEC.md, DESIGN.md §1).

---

## Stage 4 — Synthesis

Once all five domain playbooks have run, produce two synthesis artifacts: the
Thesis & Forecast content (Message 7) and the TLDR content (Message 8). Full
mandated structure: **DESIGN.md §6 (Thesis & Forecast) and §7 (TLDR)** — read
both before drafting. Summary of the contract:

- **Cross-domain reasoning.** Connect the domains explicitly: rates and net
  liquidity shaping equity multiples, crypto OI/funding as a leverage/risk-appetite
  proxy, dollar strength vs. commodities, geopolitical premia feeding into
  energy/equity reads. Do not treat domains as five independent silos.
- **Current-vs-baseline framing** wherever `data/summary.json` provides baseline
  stats: state moves as deltas and z-scores against the rolling baseline (`net
  liquidity −$85B vs. 30-snapshot mean, z −1.4`) rather than raw numbers only.
  Respect the summary's warming-up flag — with fewer than 5 snapshots, deltas
  only, no z-score language. If the fetch failed this run, drop baseline framing
  entirely; never invent one.
- **Observe vs. infer, visibly separated.** "What we observe" is facts only, drawn
  from data already sent in Messages 2-6 — no interpretation. "What we infer" is
  the thesis: how markets are pricing the known catalysts, and where the read
  diverges from consensus. Use its own bold label so a reader always knows which
  sentences are fact and which are interpretation.
- **Consensus vs. our read**, phrased explicitly where they differ: `consensus is
  pricing X; we read the risk as Y`.
- **Base case + at least one low-confidence tail case**, each labeled `Base case`
  / `Tail case`.
- **Mandated confidence vocabulary** (use verbatim, do not invent substitutes):
  `base case`, `tail case`, `low-confidence`, `we lean`, `risk skews`, `consensus
  is pricing … / we read …`. A probability may be hedged qualitatively (`a bit
  above even odds`) but never given as a false-precision point estimate ("73%").
- **Fixed disclaimer line, verbatim, always last** in Message 7:
  `<i>Not financial advice. Market intelligence only — a reasoned read of public data, not a recommendation to buy or sell anything.</i>`
  TLDR (Message 8) carries the short form: `<i>Not financial advice.</i>`.

---

## Stage 5 — Telegram delivery

Send the 8 messages **in order, sequentially, each as its own send call**, using
the Telegram send tool discovered in Stage 1. `parse_mode` (or the discovered
tool's equivalent parameter) is always `"HTML"`.

### HTML rules (mandatory, SPEC.md, DESIGN.md preamble)

- Allowed tags only: `<b> <i> <u> <s> <code> <pre> <a>`. No `<br>`, no headings, no
  `<ul>/<li>`.
- Real newlines for line breaks. `•` for bullets. No tables — bulleted short
  lines instead; `<code>` only for a single standout inline value, never layout.
- Escape `&`, `<`, `>` **only inside dynamic values** (tickers, headlines, URLs) —
  never inside the tags themselves.

### Message sequence, length budgets, and skeletons

Send in this exact order. Full layouts, subsection order, and worked examples for
every message are in **DESIGN.md §2 (messages 1-6), §6 (message 7), §7 (message
8)** — read the relevant section before composing each message. Do not improvise
layout; match it exactly.

| # | Message | Emoji · header text | Target / hard ceiling (chars) |
|---|---|---|---|
| 1 | Debug / connector inventory | 🛠️ marketstate run | ≤600 / 900 |
| 2 | Macro & Liquidity | 🏦 Macro & Liquidity | ≤1,400 / 2,000 |
| 3 | Equities | 📈 Equities | ≤1,400 / 2,000 |
| 4 | Crypto | ₿ Crypto | ≤1,100 / 1,800 |
| 5 | Tech / Mega-cap | 💻 Tech / Mega-cap | ≤1,400 / 2,000 |
| 6 | Geopolitics & Catalysts | 🌍 Geopolitics & Catalysts | ≤1,300 / 2,000 |
| 7 | Thesis & Forecast | 🧭 Thesis & Forecast | ≤2,400 / 3,200 |
| 8 | TLDR | 📊 TLDR | ≤1,000 / 1,500 |

Compact skeleton per message (see the cited DESIGN.md section for the full worked
example and exact subsection wording):

1. **Debug** — `🛠️ <b>marketstate run</b> — {UTC timestamp}` then bold-labeled
   lines: `Delivery:`, `Fetch:` (per-source status from `data/summary.json`, e.g.
   `<b>Fetch:</b> FRED ✅ · Hyperliquid ✅`, or `FRED skipped (no key)`, or
   `FAILED (<reason>)`), `Data tools:` (grouped/counted, never per-tool), `Market
   status:`, optional `Notes:` for degradations, italic domains-to-follow line.
2. **Macro** — header with hawkish/dovish/neutral bias tag, then `Rates & curve`,
   `Inflation & growth`, `Dollar & commodities`, `Liquidity read` subsections.
3. **Equities** — header with risk-on/risk-off/mixed tag (+ last-close note if
   closed), then `Indices`, `Volatility / regime`, `Breadth & movers`, `Sentiment
   & catalysts`.
4. **Crypto** — header with bid/heavy/chop tone, then `Majors`, `Derivatives /
   leverage` (Hyperliquid OI/funding vs. baseline), `Relative strength`,
   `Risk-appetite read`, `Flow / news`.
5. **Tech** — header with leadership tone, then `Mega-cap dispersion` (all six
   names, never averaged), `Semis`, `AI-cycle / news`, `Catalysts`.
6. **Geopolitics** — header with calm/elevated/acute risk tag, then `Scheduled
   catalysts`, `Active tensions`, `Market linkage`.
7. **Thesis & Forecast** — header with regime tag, then `What we observe`, `What
   we infer`, `Forecast` (base case + tail case + consensus-vs-our-read), fixed
   disclaimer line last. See Stage 4 above and DESIGN.md §6.
8. **TLDR** — header + overall regime on top line, one line per domain (emoji +
   compressed takeaway, no full numbers), one `Watch:` line, short disclaimer.
   See DESIGN.md §7.

### Trimming, when a message runs long

Priority order if trimming is needed (highest value first — trim from the
bottom, and trim lower-priority messages before touching higher ones):
1. Thesis & Forecast (7) — never trim the confidence-framing or the disclaimer.
2. TLDR (8).
3. Domain analyses (2-6) — drop the least-load-bearing bullet in a subsection
   before cutting a whole subsection; the news/flow subsection compresses first,
   hard numbers (levels, deltas) go last.
4. Debug (1) — most compressible: collapse `Notes:`, drop the domains-to-follow
   line.

If a message still exceeds its hard ceiling after trimming, splitting is a last
resort and only for a domain message (2-6): keep the emoji header, add ` (2/2)`.
Debug, Thesis, and TLDR must never split.

### Send failures

If a send call fails, retry that message once, then continue with the remaining
messages rather than aborting the run. A missing message is better than a
truncated run — the fixed numbering and emoji headers make the gap self-evident
to the reader.

---

## Debug / sources-footer convention

- **Message 1** is the *grouped* connector inventory — counts and categories
  (`Alpha Vantage MCP ({n} actions) ✅ · WebSearch ✅ · WebFetch ✅`), never a
  per-tool enumeration.
- **Messages 2-6** each end with exactly one italic sources-footer line,
  separated from the analysis by a blank line, last thing in the message:
  `<i>🔧 TOOL(args) · TOOL×n</i>`
  - Collapse repeated calls (`WebSearch×2`), compact multi-symbol calls into one
    entry (`GLOBAL_QUOTE(SPY,QQQ,DIA,IWM)`).
  - Script-sourced data from Stage 2 appears alongside MCP tools, compacted the
    same way: `FRED(net_liq,2s10s)`, `Hyperliquid(OI,funding)`.
  - Mark a fallback explicitly: `REALTIME_PUT_CALL_RATIO✗→WebSearch`.
  - Never include payloads or return values — debug means *which tools ran*, not
    what they returned.
- **Messages 1, 7, 8 have no sources footer.** Debug *is* the inventory; 7 and 8
  synthesize data already cited in 2-6.

---

## Failure handling

| Situation | Handling |
|---|---|
| Fetch script fails entirely | Continue on MCP/WebSearch data alone. Flag `Fetch: FAILED (<reason>)` in the debug message. Drop baseline framing from every message — never invent baselines. |
| `FRED_API_KEY` missing | Fetcher writes `skipped:no-key` into `data/summary.json` and continues (Hyperliquid still valid). Flag in the debug message and the Macro sources footer; Macro fills the gap via Alpha Vantage/WebSearch. |
| Market closed | Call `MARKET_STATUS` first (Equities playbook). If closed, the Equities message states last close explicitly, labeled as such — never presented as real-time. |
| Missing/deferred tool | `ToolSearch` for it first (any `mcp__claude_ai_Alpha_Vantage_MCP_Server__*` name not yet visible). If still unavailable, fall back to `WebSearch` for that data point and note it in the sources footer (`TOOL✗→WebSearch`). |
| Rate limit / API error | Retry the call once, then degrade to `WebSearch` for that data point and note the degradation in the sources footer. Never fail the whole run over one tool. |
| Domain fails entirely | Still send that domain's message, stating plainly what's missing — never skip a message in the fixed sequence. |
| Telegram/Composio unavailable | Run `mcp__composio__authenticate` once, surface the auth link as plain text to the user in-session, **stop the run before data gathering** (Stage 1). Do not loop `complete_authentication`. |

---

## Number, delta, and signal conventions (DESIGN.md §3 — identical everywhere)

- **Price levels:** plain number for index/stock points (`SPY 559.30`); `$` prefix
  for crypto and commodities (`BTC $68,400`, `WTI $71.20`); thousands separators
  at ≥ 10,000.
- **Changes:** always signed. `%` for equities/crypto (`+2.1%`), `bp` for rates
  (`+6bp`). State the window when not obvious (`w/w`, `24h`, `7d`, `MoM`, `YoY`).
- **Direction arrows**, placed after the value, before/with the delta:
  `▲` up, `▼` down, `▬` (or `flat`) unchanged. Example: `10Y 4.38% ▲ +6bp`. Never
  rely on color — Telegram has none.
- **Qualitative signal vocabulary is fixed — do not invent new signal words:**
  - Regime: `risk-on` / `risk-off` / `mixed`
  - Macro/Fed: `hawkish` / `dovish` / `neutral`
  - Liquidity: `easing` / `tightening` / `neutral`
  - Tone: `bid` / `heavy` / `chop`, `calm` / `elevated` / `acute`
  Always bold when used as a header tag.

---

## Repository map

- `CLAUDE.md` — this file.
- `SPEC.md` — pipeline contract, failure handling, guardrails.
- `DESIGN.md` — message layouts, worked examples, formatting rules (the authority
  for exact wording/structure — this file only summarizes and points at it).
- `domains/*.md` — one playbook per domain: tool sequence, extraction, fallback,
  message content.
- `src/` — the bun + TypeScript fetcher behind `bun run fetch` (owned by its own
  build; this runbook never modifies it).
- `data/` — snapshots and `data/summary.json`, written by the fetcher, read in
  Stage 2 (gitignored, machine-local).
