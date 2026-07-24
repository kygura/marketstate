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

**Hard rule:** Every forward-looking statement must be framed with explicit confidence
language (`likely`, `we lean`, `low-confidence`, `risk skews`) — never state a future
market outcome as fact. This is enforced concretely in Stage 4 and Message 7 (see
DESIGN.md §6).

---

## Stage 1 — Connector inventory (every run, no exceptions)

This is a hard user requirement: list available MCP tools/connectors at the start
of **every** run, before any data gathering.

1. **Enumerate what's already loaded** in this session (any `mcp__*` tools visible
   without a ToolSearch call, plus built-in `WebSearch`/`WebFetch`).
2. **Composio, when used, is the fallback bridge for Telegram delivery only**
   (see step 4 below — it is not the primary delivery path anymore). It is
   never a data source and never appears in a domain sources footer.
3. **Determine the Telegram delivery mechanism — direct Bot API is primary,
   Composio is the fallback.**
   - Check the environment for `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
     (loaded from `.env`, gitignored — never committed, never hardcoded into
     a tracked repo file). **If both are set, this is the run's delivery
     path**: each message is sent as its own HTTPS POST to
     `https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage` with JSON
     body `{"chat_id": TELEGRAM_CHAT_ID, "text": "...", "parse_mode":
     "HTML"}`. This is preferred over Composio — one direct call per message
     instead of Composio's multi-step tool-search/execute overhead.
   - **If the env vars are missing, or a direct send call errors**: fall back
     to Composio for that call (and the rest of the run, unless direct
     recovers). Composio's tool name for "send a Telegram message" is not
     fixed and must never be hardcoded (DESIGN.md §8) — search the live tool
     inventory (ToolSearch, keyword or listing) for a Composio action whose
     name contains both a Telegram marker and a send/message marker (e.g.
     something shaped like `*TELEGRAM*SEND*MESSAGE*`). Bind whatever name is
     found to a local reference — call it "the Telegram send tool" — and read
     its schema for the exact parameter names at call time, since Composio
     schemas vary between sessions.
   - **Gate the run only if both are unavailable**: no `TELEGRAM_BOT_TOKEN`/
     `TELEGRAM_CHAT_ID` in the environment AND no matching Composio Telegram
     tool found. In that case:
     - Run the Composio **authenticate** action (find it in the live inventory —
       its exact name varies) **once**.
     - Surface the returned auth link as **plain text to the user in this session**
       (not to Telegram — it isn't connected yet).
     - **Stop the run.** Do not proceed to Stage 2. Do not loop on the matching
       complete-authentication action — it needs a user-supplied code, so
       one attempt then stop-and-report is correct. Rerun the whole routine once the
       user confirms a delivery path is available.
4. If a delivery mechanism **is** confirmed (direct or Composio), continue.
   Message 1 (Debug) is composed after Stage 2 — it combines what was
   discovered here with the fetch status from `data/summary.json` (see the
   skeleton below) — but is not sent until Stage 5 reaches it in sequence.

Never hardcode credentials, chat/target ids, or tool names directly in tracked
repo files. `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` live in `.env`
(gitignored) and are read from the environment at run time; if falling back to
Composio, the chat id comes from that connected account/config instead.

---

## Stage 2 — Local fetch

Run the fetcher once, from the project root, before any MCP data gathering:

```
bun run fetch
```

(via Bash, working directory `/home/athan/projects/marketstate` or wherever this
repo lives). It pulls the direct API sources — FRED (net liquidity = WALCL − RRP −
TGA, 2s10s, SOFR, HY OAS, plus VIX prior close, broad dollar index, 10Y breakeven,
WTI, 3M bill), Hyperliquid (perp total OI, OI deltas, funding skew), and the
crypto-context set (CoinGecko total mcap + BTC dominance, alternative.me Fear &
Greed, DefiLlama stablecoin cap, Deribit BTC DVOL) — validates responses, appends
timestamped snapshots under `data/snapshots/`, and rewrites `data/summary.json`.
It also pulls the FRED release calendar and writes `data/catalysts.json` (upcoming
major US economic releases, plus FOMC rate-decision dates merged from the
repo-persisted Fed schedule in `src/fomc.ts`), read by the Geopolitics playbook in
Stage 3.

**Persist the snapshot data.** `data/` is committed to the repo — after the fetch
succeeds, commit the new snapshot files and rewritten summary/catalysts in one
conventional commit (e.g. `chore(data): snapshot 2026-07-12`) before moving on,
then `git push` so the history reaches the remote (`origin`). If the fetch failed
entirely there is nothing new to commit — skip this step. If the push fails
(offline, auth), note it and continue the run — delivery matters more.

Then **Read `data/summary.json`**. It is the ONE quantitative ground-truth file
for the run: per metric it carries the latest value, delta vs. previous snapshot,
baseline stats (rolling means, z-score vs. the 30-window), and per-source status
(`ok` / `skipped:no-key` / `error:<reason>`) — sections `fred`, `hyperliquid`,
`crypto_context`, plus a small `catalysts` status field. Read it before any MCP
calls; the Macro and Crypto playbooks treat it as their primary source.

Failure handling (SPEC.md):

- **Fetch fails entirely** (network down, bun missing, script error): continue the
  run on MCP/WebSearch data alone. Flag `Fetch: FAILED (<reason>)` in the debug
  message, and drop all baseline framing from every message — never invent a
  baseline the fetcher didn't provide.
- **`FRED_API_KEY` missing**: the fetcher degrades gracefully — `data/summary.json`
  shows FRED as `skipped:no-key`, Hyperliquid data is still valid. Flag it in the
  debug message (`FRED skipped (no key)`) and in the Macro sources footer; Macro
  falls back to armed data tools/WebSearch for the affected series.
- Respect the summary's warming-up flag: if it reports `baseline: warming up`
  (fewer than 5 snapshots), use deltas only — no z-score language.

Do not create or modify anything under `src/` — the fetcher is owned by its own
build; this runbook only executes it and reads its output.

---

## Stage 3 — Data gathering (fixed order)

Order: **Macro & Liquidity → Equities → Crypto → Tech → Geopolitics & Catalysts.**
This order is fixed — it matches the message sequence in SPEC.md and DESIGN.md.
Macro and Crypto lean on the Stage 2 snapshot data first (FRED series, Hyperliquid
OI/funding, crypto context); for what that doesn't cover, use `WebSearch`.
Equities and Tech likewise use `WebSearch` for the quote-type data points not
covered by Stage 2.

**Hard rule — live web search for world affairs.** The Geopolitics domain's
`Active tensions` world-affairs sweep MUST run via live web search (`WebSearch`)
on **every** run. The briefing serves a reader who is checked out from the news;
script-sourced data and cached files never replace that sweep.
`data/catalysts.json` covers scheduled US catalysts only.

For each domain, open its playbook and follow it exactly:

| Domain | Playbook |
|---|---|
| Macro & Liquidity | `domains/macro.md` |
| Equities | `domains/equities.md` |
| Crypto | `domains/crypto.md` |
| Tech / Mega-cap | `domains/tech.md` |
| Geopolitics & Catalysts | `domains/geopolitics.md` |

Each playbook gives: the data capabilities to gather (in priority order:
script-sourced snapshot data, then `WebSearch`), what to extract from each,
the fallback if `WebSearch` returns nothing usable, and the exact content the
domain's Telegram message must contain.

**While executing each playbook, record which sources were actually used**
(real calls, not just attempted) — this feeds directly into that domain's
sources footer in Stage 5. Track: script-sourced data (`FRED(net_liq,2s10s)`,
`Hyperliquid(OI,funding)`), `WebSearch` calls made (compacted, e.g.
symbols searched), and any point where a primary source was unavailable and
the next one down substituted (`FRED✗→WebSearch`). Do this bookkeeping as you
go; reconstructing it after the fact from memory is error-prone.

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

---

## Stage 5 — Telegram delivery

Send the 8 messages **in order, sequentially, each as its own send call**, using
the delivery mechanism confirmed in Stage 1 — direct Bot API POST if
`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are set, else the Composio Telegram
send tool. `parse_mode` (or the discovered tool's equivalent parameter) is
always `"HTML"`. If a direct send call errors mid-run, fall back to Composio
for the remaining messages rather than aborting.

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
   lines: `Delivery:` (`Telegram via direct Bot API ✅` or, on fallback,
   `Telegram via Composio ✅`), `Fetch:` (per-source status from `data/summary.json`, e.g.
   `<b>Fetch:</b> FRED ✅ · Hyperliquid ✅`, or `FRED skipped (no key)`, or
   `FAILED (<reason>)`), `Data tools:` (`WebSearch` call count + script
   sources used, grouped/counted, never per-call detail), `Market status:`,
   optional `Notes:` for degradations, italic domains-to-follow line.
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
   we infer`, `Forecast` (base case + tail case + consensus-vs-our-read).
   See Stage 4 above and DESIGN.md §6.
8. **TLDR** — header + overall regime on top line, one line per domain (emoji +
   compressed takeaway, no full numbers), one `Watch:` line. See DESIGN.md §7.

### Trimming, when a message runs long

Priority order if trimming is needed (highest value first — trim from the
bottom, and trim lower-priority messages before touching higher ones):
1. Thesis & Forecast (7) — never trim the confidence-framing.
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
  of what's actually used this run (e.g. `Composio (Telegram) ✅ · WebSearch
  ({n} calls) ✅ · WebFetch ✅`), never a per-call enumeration. Composio's only
  role in this pipeline is the Telegram bridge — it is not a data source.
- **Messages 2-6** each end with exactly one italic sources-footer line,
  separated from the analysis by a blank line, last thing in the message.
  **All source references MUST be embedded links (using HTML `<a>` tags):**
  `<i>🔧 <a href="...">SOURCE</a>(args) · <a href="...">SOURCE</a>×n</i>`
  - Sources are script-sourced data and `WebSearch` — never Composio; it
    never appears in a domain footer.
  - Every source name must be wrapped in an `<a href="...">` tag pointing to
    the official source URL:
    - `FRED` → `https://fred.stlouisfed.org/`
    - `Hyperliquid` → `https://www.hyperliquid.com/`
    - `CoinGecko` → `https://www.coingecko.com/`
    - `DefiLlama` → `https://defillama.com/`
    - `Deribit` → `https://www.deribit.com/`
    - `WebSearch` → `https://www.google.com/search?q=...` (with relevant query)
    - For news/research URLs found during WebSearch, link directly to the article/report
  - Collapse repeated calls (`WebSearch×2`), compact multi-symbol lookups into
    one entry (`WebSearch(SPY,QQQ,DIA,IWM quotes)`).
  - Script-sourced data from Stage 2 is compacted the same way:
    `FRED(net_liq,2s10s)`, `Hyperliquid(OI,funding)`,
    `CoinGecko(mcap,dominance)`, `DefiLlama(stables)`, `Deribit(DVOL)`,
    `FRED(calendar)`.
  - Mark it when a primary source was unavailable and the next one down
    substituted: `FRED✗→WebSearch`.
  - Never include payloads or return values — sources means *which data repositories
    were queried and linked*, not what they returned.
- **Messages 1, 7, 8 have no sources footer.** Debug *is* the inventory; 7 and 8
  synthesize data already cited in 2-6.

---

## Failure handling

| Situation | Handling |
|---|---|
| Fetch script fails entirely | Continue on MCP/WebSearch data alone. Flag `Fetch: FAILED (<reason>)` in the debug message. Drop baseline framing from every message — never invent baselines. |
| `FRED_API_KEY` missing | Fetcher writes `skipped:no-key` into `data/summary.json` and continues (Hyperliquid still valid). Flag in the debug message and the Macro sources footer; Macro fills the gap via armed tools/WebSearch. |
| Market closed | Determine market open/closed first (Equities playbook — an armed market-status capability, else WebSearch). If closed, the Equities message states last close explicitly, labeled as such — never presented as real-time. |
| Capability not covered by scripts | Fall back to `WebSearch` for that data point and note it in the sources footer (`FRED✗→WebSearch`-style). Scripts + `WebSearch` are the data sources — this is the normal path, not an error. |
| Rate limit / API error (any tool) | Retry the call once, then degrade to `WebSearch` for that data point and note the degradation in the sources footer. Never fail the whole run over one tool. |
| Domain fails entirely | Still send that domain's message, stating plainly what's missing — never skip a message in the fixed sequence. |
| World-affairs sweep | Never skipped, never served from cache — live web search on every run (see Stage 3 hard rule). |
| Direct Bot API send fails | Fall back to Composio for that message (and the rest of the run, unless direct recovers) rather than aborting. |
| Telegram unavailable (no `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` AND no Composio Telegram tool) | Run the Composio authenticate action (from the live inventory) once, surface the auth link as plain text to the user in-session, **stop the run before data gathering** (Stage 1). Do not loop the complete-authentication action. |

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
- `domains/*.md` — one playbook per domain: capability sequence, extraction,
  fallback, message content.
- `src/` — the bun + TypeScript fetcher behind `bun run fetch` (owned by its own
  build; this runbook never modifies it).
- `data/` — snapshots and `data/summary.json`, written by the fetcher, read in
  Stage 2 (committed to the repo — the routine runs daily and each run's
  snapshot is persisted; see Stage 2's commit step).
