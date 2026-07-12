import { describe, expect, test, afterEach } from "bun:test";
import { fetchCatalysts } from "./catalysts";

const originalFetch = globalThis.fetch;
const originalKey = process.env.FRED_API_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.FRED_API_KEY;
  else process.env.FRED_API_KEY = originalKey;
});

// Deterministic anchor dates: FAR_FROM_FOMC's 14-day window contains no FOMC
// decision date; NEAR_FOMC's window contains exactly 2026-07-29.
const FAR_FROM_FOMC = new Date("2026-02-10T12:00:00Z");
const NEAR_FOMC = new Date("2026-07-20T12:00:00Z");

describe("fetchCatalysts", () => {
  test("missing key degrades to skipped:no-key without a network call", async () => {
    delete process.env.FRED_API_KEY;
    globalThis.fetch = (async () => {
      throw new Error("network must not be hit");
    }) as unknown as typeof fetch;

    const result = await fetchCatalysts(FAR_FROM_FOMC);

    expect(result).toEqual({ status: "skipped:no-key", releases: [] });
  });

  test("FOMC decision dates come from the static schedule even with no key", async () => {
    delete process.env.FRED_API_KEY;
    globalThis.fetch = (async () => {
      throw new Error("network must not be hit");
    }) as unknown as typeof fetch;

    const result = await fetchCatalysts(NEAR_FOMC);

    expect(result).toEqual({
      status: "skipped:no-key",
      releases: [{ date: "2026-07-29", name: "FOMC rate decision" }],
    });
  });

  test("filters to major releases, dedupes, and sorts by date", async () => {
    process.env.FRED_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      Response.json({
        release_dates: [
          { release_id: 10, date: "2026-07-20", release_name: "Consumer Price Index" },
          // duplicate (date, name) pair — must collapse to one
          { release_id: 10, date: "2026-07-20", release_name: "Consumer Price Index" },
          // exact-match guard: state-level variant must NOT pass the filter
          { release_id: 180, date: "2026-07-16", release_name: "State Unemployment Insurance Weekly Claims Report" },
          { release_id: 179, date: "2026-07-16", release_name: "Unemployment Insurance Weekly Claims Report" },
          { release_id: 441, date: "2026-07-13", release_name: "Coinbase Cryptocurrencies" },
          // no longer allowlisted — fomc.ts owns FOMC dates
          { release_id: 101, date: "2026-07-14", release_name: "FOMC Press Release" },
        ],
      })) as unknown as typeof fetch;

    const result = await fetchCatalysts(FAR_FROM_FOMC);

    expect(result.status).toBe("ok");
    expect(result.releases).toEqual([
      { date: "2026-07-16", name: "Unemployment Insurance Weekly Claims Report" },
      { date: "2026-07-20", name: "Consumer Price Index" },
    ]);
  });

  test("static FOMC date merges into fetched releases, sorted by date", async () => {
    process.env.FRED_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      Response.json({
        release_dates: [{ date: "2026-07-28", release_name: "Consumer Price Index" }],
      })) as unknown as typeof fetch;

    const result = await fetchCatalysts(NEAR_FOMC);

    expect(result.releases).toEqual([
      { date: "2026-07-28", name: "Consumer Price Index" },
      { date: "2026-07-29", name: "FOMC rate decision" },
    ]);
  });

  test("a release listed on more than 3 dates is FRED calendar filler and is dropped", async () => {
    process.env.FRED_API_KEY = "test-key";
    const filler = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-07-${String(12 + i).padStart(2, "0")}`,
      release_name: "H.4.1 Factors Affecting Reserve Balances",
    }));
    globalThis.fetch = (async () =>
      Response.json({
        release_dates: [...filler, { date: "2026-07-14", release_name: "Consumer Price Index" }],
      })) as unknown as typeof fetch;

    const result = await fetchCatalysts(FAR_FROM_FOMC);

    expect(result.status).toBe("ok");
    expect(result.releases).toEqual([{ date: "2026-07-14", name: "Consumer Price Index" }]);
  });

  test("HTTP failure yields error status, not a throw", async () => {
    process.env.FRED_API_KEY = "test-key";
    globalThis.fetch = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;

    const result = await fetchCatalysts(NEAR_FOMC);

    expect(result.status.startsWith("error:")).toBe(true);
    // static FOMC dates survive a dead FRED calendar
    expect(result.releases).toEqual([{ date: "2026-07-29", name: "FOMC rate decision" }]);
  });
});
