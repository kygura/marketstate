import { describe, expect, test, afterEach } from "bun:test";
import { fetchFred } from "./fred";

const originalFetch = globalThis.fetch;
const originalKey = process.env.FRED_API_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.FRED_API_KEY;
  else process.env.FRED_API_KEY = originalKey;
});

describe("fetchFred", () => {
  test("net_liquidity normalizes units: WALCL and WTREGEN are millions, RRPONTSYD is billions", async () => {
    process.env.FRED_API_KEY = "test-key";
    // Realistic magnitudes: WALCL $6.7T (millions), RRP $0.55B (billions),
    // TGA $774B (millions).
    const valueBySeries: Record<string, string> = {
      WALCL: "6735609",
      RRPONTSYD: "0.55",
      WTREGEN: "774062",
    };
    globalThis.fetch = (async (url: string) => {
      const seriesId = new URL(url).searchParams.get("series_id") ?? "";
      const value = valueBySeries[seriesId];
      const observations = value ? [{ date: "2026-07-08", value }] : [];
      return Response.json({ observations });
    }) as unknown as typeof fetch;

    const result = await fetchFred();

    expect(result.status).toBe("ok");
    expect(result.metrics.net_liquidity?.value).toBeCloseTo(6735.609 - 0.55 - 774.062, 3);
  });

  test("all series failing with a key present yields error status, not ok with zero metrics", async () => {
    process.env.FRED_API_KEY = "test-key";
    globalThis.fetch = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;

    const result = await fetchFred();

    expect(result.status.startsWith("error:")).toBe(true);
    expect(result.metrics).toEqual({});
  });
});
