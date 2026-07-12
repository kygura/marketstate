// FRED (Federal Reserve Economic Data) fetcher.
// Docs: https://fred.stlouisfed.org/docs/api/fred/series_observations.html
import { z } from "zod";

export const FRED_SERIES = [
  "WALCL",
  "RRPONTSYD",
  "WTREGEN",
  "DGS2",
  "DGS10",
  "SOFR",
  "BAMLH0A0HYM2",
] as const;

export type FredSeriesId = (typeof FRED_SERIES)[number];

export type MetricValue = { value: number; date: string };
export type FredResult = {
  status: "ok" | "skipped:no-key" | `error:${string}`;
  metrics: Record<string, MetricValue>;
};

// FRED marks a missing observation with the literal string "." — everything
// else is a numeric string.
const ObservationSchema = z.object({
  date: z.string(),
  value: z.string(),
});

const FredResponseSchema = z.object({
  observations: z.array(ObservationSchema),
});

// limit=5: sort_order=desc gives newest first; a small window absorbs "."
// (missing/not-yet-published) observations without an extra request.
const OBS_LIMIT = 5;

async function fetchSeries(seriesId: FredSeriesId, apiKey: string): Promise<MetricValue | null> {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${OBS_LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FRED ${seriesId} HTTP ${res.status}`);
  }
  const json = await res.json();
  const parsed = FredResponseSchema.parse(json);
  const latestValid = parsed.observations.find((o) => o.value !== ".");
  if (!latestValid) return null;
  return { value: Number(latestValid.value), date: latestValid.date };
}

export async function fetchFred(): Promise<FredResult> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    return { status: "skipped:no-key", metrics: {} };
  }

  const entries = await Promise.all(
    FRED_SERIES.map(async (id) => [id, await fetchSeries(id, apiKey)] as const),
  );

  const metrics: Record<string, MetricValue> = {};
  for (const [id, value] of entries) {
    if (value) metrics[id] = value;
  }

  addDerivedMetrics(metrics);
  return { status: "ok", metrics };
}

// Derived metrics. Unit normalization (verified against FRED series metadata):
//   WALCL      — units: Millions of Dollars
//   RRPONTSYD  — units: Billions of Dollars
//   WTREGEN    — units: Billions of Dollars
// Normalize everything to billions before combining.
//   net_liquidity (billions) = WALCL/1000 - RRPONTSYD - WTREGEN
// spread_2s10s is DGS10 - DGS2, both already in percentage points — no
// normalization needed.
function addDerivedMetrics(metrics: Record<string, MetricValue>): void {
  const walcl = metrics.WALCL;
  const rrp = metrics.RRPONTSYD;
  const tga = metrics.WTREGEN;
  if (walcl && rrp && tga) {
    metrics.net_liquidity = {
      value: walcl.value / 1000 - rrp.value - tga.value,
      date: walcl.date,
    };
  }

  const dgs2 = metrics.DGS2;
  const dgs10 = metrics.DGS10;
  if (dgs2 && dgs10) {
    metrics.spread_2s10s = {
      value: dgs10.value - dgs2.value,
      date: dgs10.date,
    };
  }
}
