// Upcoming economic-release calendar from FRED, filtered to market-moving
// releases. Feeds data/catalysts.json for the Geopolitics playbook so the
// run-time agent doesn't need WebSearch for scheduled catalysts.
import { z } from "zod";
import { FOMC_DECISION_DATES } from "./fomc";
import { proxyFetch } from "./proxy-fetch";

export type CatalystRelease = { date: string; name: string };
export type CatalystsResult = {
  status: "ok" | "skipped:no-key" | `error:${string}`;
  releases: CatalystRelease[];
};

// Exact FRED release names, verified against /fred/releases (2026-07-12).
// Exact match, not substring: substrings drag in state-level and research
// variants ("State Unemployment Insurance...", "Research Consumer Price Index").
export const MAJOR_RELEASES = new Set([
  "Consumer Price Index",
  "Producer Price Index",
  "Employment Situation",
  "Gross Domestic Product",
  "Personal Income and Outlays",
  // FOMC deliberately absent: FRED pads it with filler rows (see below); the
  // static schedule in fomc.ts owns FOMC decision dates instead.
  "Advance Monthly Sales for Retail and Food Services",
  "Surveys of Consumers",
  "H.4.1 Factors Affecting Reserve Balances",
  "Unemployment Insurance Weekly Claims Report",
]);

export const CATALYST_WINDOW_DAYS = 14;

// include_release_dates_with_no_data=true makes FRED emit a row for EVERY day
// of the window for irregular releases (observed live: "FOMC Press Release"
// on all 14 dates). Real schedules are sparse — monthly releases hit once,
// weekly ones (H.4.1, jobless claims) twice — so a release on more than 3
// distinct dates is filler carrying no signal, and the true date can't be
// recovered from it. Drop the whole release rather than report a fake daily
// catalyst.
const FILLER_MAX_DATES = 3;

const ReleaseDatesSchema = z.object({
  release_dates: z.array(z.object({ date: z.string(), release_name: z.string() })),
});

// FOMC decision dates come from the static schedule, not the FRED calendar —
// so they land in the output even when the FRED fetch is skipped or errors.
function fomcInWindow(startDay: string, endDay: string): CatalystRelease[] {
  return FOMC_DECISION_DATES.filter((d) => d >= startDay && d <= endDay).map((date) => ({
    date,
    name: "FOMC rate decision",
  }));
}

export async function fetchCatalysts(now: Date = new Date()): Promise<CatalystsResult> {
  const start = now;
  const end = new Date(start.getTime() + CATALYST_WINDOW_DAYS * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const fomc = fomcInWindow(day(start), day(end));

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    return { status: "skipped:no-key", releases: fomc };
  }
  try {
    const url =
      `https://api.stlouisfed.org/fred/releases/dates?api_key=${apiKey}&file_type=json` +
      `&include_release_dates_with_no_data=true&sort_order=asc` +
      `&realtime_start=${day(start)}&realtime_end=${day(end)}`;
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(`FRED releases/dates HTTP ${res.status}`);
    }
    const parsed = ReleaseDatesSchema.parse(await res.json());

    const seen = new Set<string>();
    const releases: CatalystRelease[] = [];
    for (const r of parsed.release_dates) {
      const key = `${r.date}|${r.release_name}`;
      if (!MAJOR_RELEASES.has(r.release_name) || seen.has(key)) continue;
      seen.add(key);
      releases.push({ date: r.date, name: r.release_name });
    }
    const datesPerName = new Map<string, number>();
    for (const r of releases) {
      datesPerName.set(r.name, (datesPerName.get(r.name) ?? 0) + 1);
    }
    const real = releases.filter((r) => (datesPerName.get(r.name) ?? 0) <= FILLER_MAX_DATES);
    real.push(...fomc);
    real.sort((a, b) => a.date.localeCompare(b.date));
    return { status: "ok", releases: real };
  } catch (err) {
    return {
      status: `error:${err instanceof Error ? err.message : String(err)}`,
      releases: fomc,
    };
  }
}
