# DESIGN — marketstate Telegram message suite

This is the design brief for the user-facing product: the sequence of Telegram
messages marketstate sends on each run. The implementer (a Sonnet worker writing
`CLAUDE.md` and the `domains/*.md` playbooks) must match the layouts, conventions,
and worked examples here exactly.

Parse mode is **HTML** (locked in SPEC.md, not up for debate). The only allowed
tags are `<b> <i> <u> <s> <code> <pre> <a>`. There is no `<br>`, no headings, no
`<ul>/<li>`. Line breaks are real newlines. Bullets are the `•` character. Only
`&`, `<`, `>` inside dynamic values (tickers, headlines, URLs) get escaped —
never the tags.

---

## 1. Message sequence

The 8-message sequence from SPEC.md **stands as-is**. In order:

1. Debug / connector inventory
2. Macro & Liquidity
3. Equities
4. Crypto
5. Tech
6. Geopolitics & Catalysts
7. Thesis & Forecast
8. TLDR

Why 8, and why no merges or splits:

- **One message per domain is the whole point.** The user's hard requirement is
  multiple messages, one per topic, plus a final TLDR. Merging domains (e.g.
  crypto into equities) violates that and hurts scannability on a phone.
- **Debug stays separate, first.** It is the connector-inventory requirement and
  it must land before analysis so the reader knows what data backed the run. It
  is also the most compressible message, so isolating it means length pressure
  never touches the analysis.
- **Thesis & Forecast stays separate from TLDR.** They do different jobs. Thesis
  is the reasoned, confidence-framed argument. TLDR is a glanceable regime read.
  Collapsing them would either bloat the TLDR or bury the thesis.
- **No domain should split into two messages.** If a domain's analysis cannot fit
  in one message under budget, that is a signal to trim prose, not to add a
  message. The fixed count of 8 is a feature: the reader learns the rhythm.

The sequence is fixed even on partial failure. If a domain's data gathering fails
entirely, its message is still sent, stating plainly what is missing (see §6 of
SPEC.md failure handling). Never skip a message — that breaks the predictable
rhythm the reader relies on.

---

## 2. Per-message layout

General rules that apply to every message:

- **First line is a bold header** with a single leading emoji marker for instant
  visual domain identification while scrolling. The emoji is the domain's fixed
  identity — keep it stable across runs.
- **Header carries a one-glance signal** where meaningful: the domain's regime or
  bias tag right in the header line (e.g. risk-off, hawkish), so a reader who only
  sees the header already knows the takeaway.
- **Subsections are bold mini-labels** on their own line (there are no real
  headings in Telegram HTML), followed by bulleted or short-line content.
- **Blank line before the sources footer**, which is the last thing in every
  domain message (messages 2-6). Debug (1), Thesis (7), and TLDR (8) have no
  sources footer — Debug *is* the inventory, and 7/8 are synthesis of already-cited
  data.
- **Timestamp** the run once, in the Debug message header, in UTC. Domain messages
  do not each repeat a timestamp; they inherit the run's. Exception: the Equities
  message states whether the quote is live or last-close (market-status dependent).

### Emoji domain markers (fixed)

| Message | Emoji | Header text |
|---|---|---|
| Debug | 🛠️ | marketstate run |
| Macro & Liquidity | 🏦 | Macro & Liquidity |
| Equities | 📈 | Equities |
| Crypto | ₿ | Crypto |
| Tech | 💻 | Tech / Mega-cap |
| Geopolitics | 🌍 | Geopolitics & Catalysts |
| Thesis & Forecast | 🧭 | Thesis & Forecast |
| TLDR | 📊 | TLDR |

---

### Message 1 — Debug / connector inventory

**Purpose:** satisfy the "list available connectors at start of run" and "send
tool calls as debug" requirements. Terse. Informs, does not pollute.

**Layout:**
- Header: `🛠️ <b>marketstate run</b> — {UTC timestamp}`
- Line: Telegram delivery status (this message arriving is itself proof; state the
  connector/tool used).
- Line: local fetch status — per-source result from `data/summary.json`
  (FRED, Hyperliquid, crypto context, catalysts), including skipped/failed
  states.
- Line: data connectors detected, grouped and counted, not enumerated one-per-line.
- Line: market status (open/closed) so the reader frames everything that follows.
- Optional line: any degradation flagged up front (e.g. a connector missing, will
  fall back to WebSearch).

**Worked example:**

```
🛠️ <b>marketstate run</b> — 2026-07-12 13:40 UTC

<b>Delivery:</b> Telegram via Composio ✅
<b>Fetch:</b> FRED ✅ · Hyperliquid ✅ · CryptoCtx ✅ · Catalysts ✅ (baseline n=32)
<b>Data tools:</b> Exa (6 tools) ✅ · Composio (Telegram) ✅ · WebSearch ✅ · WebFetch ✅
<b>Market status:</b> US equities CLOSED (weekend) — equities section uses last close
<b>Notes:</b> no put/call feed armed this run → VIX-only regime read

<i>Domains to follow: Macro • Equities • Crypto • Tech • Geopolitics • Thesis • TLDR</i>
```

Degraded fetch examples for the Fetch line: `FRED skipped (no key) · Hyperliquid ✅ · CryptoCtx ✅ · Catalysts skipped (no key)`
or `Fetch: FAILED (network) — MCP/WebSearch only, no baseline framing this run`.

If Telegram is NOT connected, this message is never sent — the run stops at stage 1
and the auth link is surfaced to the user as plain text in the session (per SPEC.md).

---

### Message 2 — Macro & Liquidity

**Layout (subsections in order):**
1. **Rates & curve** — 10Y, 2Y, 2s10s spread, Fed funds, SOFR. Primary source is the
   fetched FRED snapshot in `data/summary.json` (with baseline deltas/z-scores when
   available); armed data tools / web search cross-check and fill.
2. **Liquidity & credit** — net liquidity (WALCL − RRP − TGA, from FRED snapshot)
   with its trend vs. baseline, HY OAS as the credit-stress read.
3. **Inflation & growth** — latest CPI, unemployment, NFP, GDP/retail as available.
4. **Dollar & commodities** — DXY proxy, WTI/Brent, gold, copper (folded here).
5. **Liquidity read** — one-line qualitative signal (easing / tightening / neutral)
   plus any Fed commentary from WebSearch.

Header carries the macro bias tag (e.g. hawkish / dovish / neutral). If the FRED
fetch was skipped (no key) or failed, subsections 1-2 fall back to armed-tool /
web-search values, say so in the sources footer, and drop baseline framing.

**Worked example:**

```
🏦 <b>Macro & Liquidity</b> — <b>bias: mildly hawkish</b>

<b>Rates &amp; curve</b>
• 10Y 4.38% ▲ +6bp w/w
• 2Y 4.61% ▲ +3bp w/w
• 2s10s −23bp (inverted, steepening)
• Fed funds 4.50% · SOFR 4.46%

<b>Liquidity &amp; credit</b>
• Net liquidity $5.91T ▼ −0.4% vs 30-run mean (z −0.8) — draining
• HY OAS 318bp ▲ +9bp w/w — credit calm but widening at the edge

<b>Inflation &amp; growth</b>
• CPI 3.1% YoY (prev 3.0%) — reaccelerating
• Unemployment 4.1% · NFP +180k (prev +206k)
• Real GDP 2.4% annualized · Retail sales +0.4% MoM

<b>Dollar &amp; commodities</b>
• DXY proxy ▲ (USD firm vs EUR, JPY)
• WTI $71.20 ▼ −1.8% · Brent $75.90 ▼
• Gold $2,410 ▲ +0.6% · Copper flat

<b>Liquidity read:</b> tightening at the margin — sticky CPI print pushes back
rate-cut timing; dollar strength a headwind for risk.

<i>🔧 FRED(net_liq,2s10s,SOFR,HY_OAS,dollar,wti) · SEARCH(CPI,NFP,GDP) · SEARCH(brent,gold) · WebSearch×1</i>
```

---

### Message 3 — Equities

**Layout (subsections in order):**
1. **Indices** — SPY, QQQ, DIA, IWM with level and % change.
2. **Volatility / regime** — VIX level and direction; put/call if available.
3. **Breadth & movers** — top gainers/losers flavor, sector tilt.
4. **Sentiment & catalysts** — news/sentiment read, notable earnings on deck.

Header carries the equity regime tag (risk-on / risk-off / mixed). If market is
closed, header or first line says `(last close, {date})`.

**Worked example:**

```
📈 <b>Equities</b> — <b>mixed, defensive tilt</b> <i>(last close, Fri 07-11)</i>

<b>Indices</b>
• SPY 559.30 ▼ −0.4%
• QQQ 493.10 ▼ −0.7%
• DIA 401.80 ▲ +0.1%
• IWM 214.50 ▼ −1.1% (small caps lagging)

<b>Volatility / regime</b>
• VIX 14.8 ▲ +0.9 — low but ticking up
• Put/call 0.94 (neutral-to-cautious)

<b>Breadth &amp; movers</b>
• Leadership narrow: mega-cap held, small/mid soft
• Energy and staples green; semis and discretionary red

<b>Sentiment &amp; catalysts</b>
• News sentiment: neutral, tilting cautious on rate path
• On deck: NFLX, JPM earnings next week

<i>🔧 FRED(vix_close) · QUOTES(SPY,QQQ,DIA,IWM) · SEARCH(market status,breadth) · SEARCH(earnings calendar) · WebSearch×1</i>
```

---

### Message 4 — Crypto

**Layout (subsections in order):**
1. **Majors** — BTC, ETH, SOL with level and % change (24h and 7d if available).
2. **Derivatives / leverage** — from the Hyperliquid snapshot in `data/summary.json`:
   total perp OI (with delta vs. baseline when available), OI-weighted funding skew,
   notable per-asset funding extremes. This is the leverage/positioning read.
3. **Relative strength** — ETH/BTC, SOL flavor; who's leading.
4. **Risk-appetite read** — crypto as a liquidity/risk proxy, tied back to macro.
   Ground it in the `crypto_context` section of `data/summary.json` (Fear & Greed,
   BTC DVOL, stablecoin cap, BTC dominance) with baseline framing when available.
5. **Flow / news** — crypto news/sentiment read, notable catalysts.

Header carries the crypto tone (bid / heavy / chop). If the Hyperliquid fetch
failed, the Derivatives subsection states that plainly and the baseline framing is
dropped, not invented.

**Worked example:**

```
₿ <b>Crypto</b> — <b>bid, but macro-sensitive</b>

<b>Majors</b>
• BTC $68,400 ▲ +2.1% 24h · +4.8% 7d
• ETH $3,560 ▲ +1.4% · +3.1% 7d
• SOL $158 ▲ +3.9% · +9.2% 7d (outperforming)

<b>Derivatives / leverage</b>
• Perp OI $9.4B ▲ +6% vs 30-run mean (z +1.2) — leverage building
• Funding skew +0.011%/8h (longs paying) — crowded but not extreme
• SOL funding hottest of the majors

<b>Relative strength</b>
• ETH/BTC soft — BTC still the anchor
• SOL leading the high-beta bid

<b>Risk-appetite read:</b> Fear & Greed 26 (Fear) vs 30-run mean 31; DVOL 36 ▬
flat; stablecoin cap $311B ▲ +0.4% w/w — cautious positioning, dry powder
building. Crypto firm despite a firmer dollar — reads as independent risk
appetite / crypto-specific flows, not broad risk-on.

<b>Flow / news:</b> sentiment positive; ETF inflows cited as support.

<i>🔧 Hyperliquid(OI,funding) · CoinGecko(mcap,dominance) · FearGreed · DefiLlama(stables) · Deribit(DVOL) · SEARCH(BTC,ETH,SOL) · WebSearch×1</i>
```

---

### Message 5 — Tech / Mega-cap

**Layout (subsections in order):**
1. **Mega-cap dispersion** — AAPL, MSFT, NVDA, GOOGL, AMZN, META, each with %
   change on one line each or paired. Dispersion is the point (SPEC.md), so show
   each name, do not average them away.
2. **Semis** — SMH level/direction.
3. **AI-cycle / product / regulatory** — web-search-driven narrative beats.
4. **Catalysts** — upcoming tech earnings.

Header carries the tech tone (leadership intact / rotating out / dispersed).

**Worked example:**

```
💻 <b>Tech / Mega-cap</b> — <b>dispersed, NVDA-led</b>

<b>Mega-cap dispersion</b>
• NVDA 128.40 ▲ +2.3%
• MSFT 461.20 ▲ +0.4%
• AAPL 226.10 ▼ −0.6%
• GOOGL 185.30 ▼ −0.9%
• AMZN 200.80 ▲ +0.2%
• META 512.60 ▼ −1.2%

<b>Semis:</b> SMH ▲ +1.1% — NVDA carrying, breadth thin

<b>AI-cycle / news</b>
• Datacenter capex commentary still constructive
• One antitrust headline on GOOGL weighing on sentiment

<b>Catalysts:</b> MSFT, GOOGL earnings in ~2 weeks

<i>🔧 QUOTES(AAPL,MSFT,NVDA,GOOGL,AMZN,META,SMH) · SEARCH(tech news,earnings) · WebSearch×2</i>
```

---

### Message 6 — Geopolitics & Catalysts

**Layout (subsections in order):**
1. **Scheduled catalysts** — central bank meetings, key data prints, elections,
   OPEC, with dates.
2. **Active tensions** — conflicts, sanctions, tariffs/trade.
3. **Market linkage** — one line per item on what it means for the tape.

Live web search/WebFetch driven, plus `data/catalysts.json` for scheduled US
catalysts — the world-affairs sweep always runs live (CLAUDE.md Stage 3 hard
rule). Header carries the risk temperature (calm / elevated / acute).

**Worked example:**

```
🌍 <b>Geopolitics &amp; Catalysts</b> — <b>risk: elevated</b>

<b>Scheduled catalysts</b>
• FOMC Jul 29-30 — market prices no change, watching guidance
• US CPI print Jul 15
• OPEC+ technical meeting early Aug

<b>Active tensions</b>
• Middle East supply-risk premium keeping a floor under oil
• US-China tariff headlines rotating back into focus

<b>Market linkage</b>
• Oil premium = mild inflation/energy-equity tailwind, growth headwind
• Tariff noise = periodic risk-off spikes, semis most exposed

<i>🔧 FRED(calendar) · WebSearch×3 · WebFetch×1</i>
```

---

### Message 7 — Thesis & Forecast

**The most important message. See §6 below for the full structure and mandated
confidence framing.** Worked example is given there.

---

### Message 8 — TLDR

**See §7 below for structure and worked example.**

---

## 3. Numbers, deltas, signals — one convention for all messages

This must be identical everywhere so the reader learns it once.

**Price levels:** plain number, no currency symbol for index/stock points
(`SPY 559.30`), `$` prefix for crypto and commodities (`BTC $68,400`, `WTI $71.20`).
Thousands separators for values ≥ 10,000.

**Percent / basis-point changes:** always signed. Percent for equities/crypto
(`+2.1%`), basis points for rates (`+6bp`). State the window when not obvious
(`w/w`, `24h`, `7d`, `MoM`, `YoY`).

**Direction arrows** (the at-a-glance layer):
- `▲` up
- `▼` down
- `▬` or `flat` for unchanged

The arrow goes **after the value it describes**, before or with the delta:
`10Y 4.38% ▲ +6bp`. Never rely on color (Telegram has none) — the arrow plus the
signed number carries direction.

**Qualitative signals** — a fixed vocabulary, always **bold** when used as a tag:
- Regime: `risk-on` / `risk-off` / `mixed`
- Macro/Fed: `hawkish` / `dovish` / `neutral`
- Liquidity: `easing` / `tightening` / `neutral`
- Tone (domain-level): `bid` / `heavy` / `chop`, `calm` / `elevated` / `acute`

Do not invent new signal words per run. Pick from this set so the header tags are
comparable across runs.

**No raw tables.** Telegram HTML has no table support and monospace wrapping on
phones is ugly. Use bulleted short lines. `<code>` only for a single inline value
you want to stand out, not for layout.

---

## 4. Debug / tool-trace formatting (final)

Two surfaces, both terse.

**A. Upfront inventory (Message 1).** Grouped and counted, never one-line-per-tool.
A connector can expose dozens of actions; listing them all would be noise. Format:
`<b>Data tools:</b> {connector} ({n} tools) ✅ · WebSearch ✅ · WebFetch ✅`,
naming whatever connectors are actually armed this session (e.g. Exa, Composio).
Add a `<b>Notes:</b>` line only when something is degraded or missing.

**B. Per-domain sources footer (Messages 2-6).** One italic line, preceded by a
blank line, last thing in the message. Wrench prefix, tools separated by ` · `,
arguments in parentheses compacted:

```
<i>🔧 QUOTES(SPY,QQQ) · SEARCH(tech news) · WebSearch×2</i>
```

Rules for the footer:
- Footers record the names the run's tools *actually* have — `QUOTES(...)` /
  `SEARCH(...)` above are illustrative shapes, not fixed identifiers.
- Script-fetched sources appear first, named by source not by tool:
  `FRED(net_liq,2s10s)`, `Hyperliquid(OI,funding)`, `CoinGecko(mcap,dominance)`,
  `DefiLlama(stables)`, `Deribit(DVOL)`, `FRED(calendar)`.
- Collapse repeated calls: `WebSearch×2`, not two entries.
- Compact multi-symbol calls: `QUOTES(SPY,QQQ,DIA,IWM)`, one entry.
- If a tool was tried and fell back, mark it: `TOOL✗→WebSearch` (real tool name).
- Never include payloads or return values. Debug means *which tools ran*, not what
  they returned.

Messages 1, 7, 8 have no footer.

---

## 5. Length budgets (Telegram hard limit 4096 chars)

Target well under the limit so a long headline never trips a 400. Per message:

| Message | Target | Hard ceiling |
|---|---|---|
| 1 Debug | ≤ 600 | 900 |
| 2 Macro | ≤ 1,400 | 2,000 |
| 3 Equities | ≤ 1,400 | 2,000 |
| 4 Crypto | ≤ 1,100 | 1,800 |
| 5 Tech | ≤ 1,400 | 2,000 |
| 6 Geopolitics | ≤ 1,300 | 2,000 |
| 7 Thesis & Forecast | ≤ 2,400 | 3,200 |
| 8 TLDR | ≤ 1,000 | 1,500 |

**Value ranking when trimming (highest value first, trim from the bottom):**
1. Thesis & Forecast (7) — the reasoning is the product.
2. TLDR (8) — the glance-value summary.
3. The domain analyses (2-6).
4. Debug (1) — most compressible; collapse Notes, drop the domains-to-follow line.

**What to trim first inside a message that runs long:**
- Drop the least-load-bearing bullet in a subsection before cutting a subsection.
- In domain messages, the "news/flow" subsection is the first to compress; hard
  numbers (levels, deltas) are last to go.
- Never trim the confidence-framing language or the disclaimer out of Message 7 to
  save space — trim supporting detail instead.

If a message still exceeds the hard ceiling after trimming, split is a last resort
and only for a domain message, keeping the emoji header and adding ` (2/2)`. Prefer
trimming. Debug, Thesis, and TLDR must never split.

---

## 6. Thesis & Forecast message (structure + mandated framing)

This message is the reason the product exists, and it is where the prediction
guardrails (SPEC.md §Guardrails) are enforced. It must read as probabilistic
reasoning, never as oracle certainty.

**Mandatory structure, in this order:**

1. **Header** — `🧭 <b>Thesis & Forecast</b>` with the overall regime tag.
2. **What we observe** — a short, bolded-label block of *facts only*, drawn from
   the domain data already sent. No interpretation here. This is the evidence base.
3. **What we infer** — the thesis. How markets are currently pricing the known
   catalysts, and where the agent's read diverges from consensus. This is clearly
   separated from the observation block by its own bold label, so the reader always
   knows which sentences are fact and which are inference.
4. **Forecast** — near-term probabilistic scenarios. Mandated framing:
   - A **base case** and at least one **low-confidence tail case**, each labeled.
   - Consensus-vs-our-read phrasing where they differ:
     `consensus is pricing X; we read the risk as Y`.
   - Every forward statement hedged: `likely`, `we lean`, `low-confidence`,
     `risk skews`. Never a bare future-tense assertion of a market outcome.
5. **Disclaimer** — a fixed, non-negotiable final line (see below).

**Mandated confidence vocabulary** (use these, do not soften into false precision):
`base case`, `tail case`, `low-confidence`, `we lean`, `risk skews`,
`consensus is pricing … / we read …`. Attach a rough probability band only as a
qualitative hedge (`we'd put the base case a bit above even odds`), never a false-
precision point estimate like "73% chance."

**Fixed disclaimer line (verbatim, always last):**

```
<i>Not financial advice. Market intelligence only — a reasoned read of public data, not a recommendation to buy or sell anything.</i>
```

**Worked example:**

```
🧭 <b>Thesis &amp; Forecast</b> — <b>regime: mixed, defensive tilt</b>

<b>What we observe</b>
• Sticky CPI (3.1% YoY) pushing back rate-cut timing; 2s10s still inverted
• Equities soft with narrow leadership; VIX low but ticking up
• Crypto firm despite a firmer dollar
• Oil carrying a geopolitical risk premium; FOMC Jul 29-30 ahead

<b>What we infer</b>
Markets are pricing a "higher-for-longer but no new hikes" path, leaning on
mega-cap earnings to carry index levels while breadth quietly narrows. The firm
dollar and reaccelerating CPI sit awkwardly against that — the equity tape looks
priced for a soft-landing continuation that the macro data is no longer clearly
confirming.

<b>Forecast</b>
• <b>Base case</b> (we lean here, a bit above even odds): range-bound chop into
  FOMC. Consensus is pricing a dovish hold; we read the risk as a more neutral
  hold that disappoints rate-cut hopes and keeps pressure on small caps and
  long-duration tech.
• <b>Tail case</b> (low-confidence): a hot CPI print on Jul 15 or a hawkish FOMC
  guidance shift triggers a fast VIX repricing and a risk-off leg. Low-confidence
  but the setup (low vol + narrow breadth) is fragile.
• Crypto: risk skews to it trading on its own flows near-term rather than tracking
  equities, given the dollar-divergence we're seeing.

<i>Not financial advice. Market intelligence only — a reasoned read of public data, not a recommendation to buy or sell anything.</i>
```

The review gate must verify: (a) observe and infer are visibly separated, (b) every
forecast bullet is hedged, (c) the disclaimer line is present and last.

---

## 7. TLDR message

**Purpose:** the glanceable close. A reader who opens only this message should get
the whole state of markets in a few seconds.

**Structure decision — regime read goes at the TOP.** Justification: the TLDR is
the message people scroll to first or read in a notification preview. The single
most valuable token is the overall regime, so it leads. The per-domain one-liners
below it are the supporting detail, and a closing "watch" line points forward.

**Layout:**
1. **Header + overall regime** — `📊 <b>TLDR</b> — <b>{regime}</b>` on the top line.
2. **One line per domain**, each with its emoji marker and a compressed takeaway
   (no full numbers — just the direction and the signal). The emoji keeps it
   visually tied to the fuller message above.
3. **One "watch" line** — the single most important near-term catalyst.

Keep it to one line per domain. This is a summary, not a recap; resist re-listing
levels.

**Worked example:**

```
📊 <b>TLDR</b> — <b>regime: mixed, defensive tilt</b>

🏦 Macro: sticky CPI, firm dollar → <b>tightening</b> at the margin
📈 Equities: soft, narrow leadership, VIX low but rising → <b>cautious</b>
₿ Crypto: firm on its own flows despite strong USD → <b>bid</b>
💻 Tech: dispersed, NVDA-led, thin breadth → <b>fragile leadership</b>
🌍 Geopolitics: oil risk premium + tariff noise → <b>elevated</b>

<b>Watch:</b> CPI print Jul 15, then FOMC Jul 29-30 — both can break the range.

<i>Not financial advice.</i>
```

The disclaimer appears in short form here too, since the TLDR may be read in
isolation.

---

## 8. Composio Telegram delivery mechanics

Composio's MCP tool names for Telegram are **not known ahead of time** and may vary
between sessions/connector versions. The runbook must never hardcode a specific tool
name. Instead:

- In the **connector inventory step (stage 1)**, discover the Telegram send tool by
  searching the live tool inventory for a Composio action whose name indicates
  sending a Telegram message (look for names containing both a Telegram marker and a
  send/message marker, e.g. something like `*TELEGRAM*SEND*MESSAGE*`). Bind that
  discovered name to a local reference the rest of the run uses.
- Refer to it in the runbook generically as **"the Telegram send-message tool
  exposed by Composio, discovered via the connector inventory step"** — not as a
  fixed identifier.
- The send call needs, at minimum: the **chat/target id** (from the connected
  account/config, not hardcoded in the repo — no secrets in the repo per SPEC.md),
  the **text**, and **`parse_mode = "HTML"`**. The implementer confirms the exact
  parameter names from the discovered tool's schema at run time, since Composio
  action schemas vary.
- If no matching send tool is found in the inventory, treat it as "Telegram
  unavailable": run the Composio authenticate action (discovered in the live
  inventory — its exact name varies), surface the auth link to the user
  as plain text in the session, and **stop the run** before data gathering (SPEC.md
  stage 1 and failure handling). Do not loop on the complete-authentication
  action — it needs a user-supplied code; one attempt, then stop and report.
- Send the 8 messages **in order, sequentially**, each as its own send call. If one
  send fails, retry that message once, then continue with the rest rather than
  aborting — a missing middle message is better than a truncated run, and the
  sequence numbering/emoji headers make a gap self-evident.
