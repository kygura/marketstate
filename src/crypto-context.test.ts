import { describe, expect, test, afterEach } from "bun:test";
import { fetchCryptoContext } from "./crypto-context";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const RESPONSES: Record<string, unknown> = {
  "api.coingecko.com": {
    data: {
      total_market_cap: { usd: 2.28e12 },
      market_cap_percentage: { btc: 56.3 },
    },
  },
  "api.alternative.me": { data: [{ value: "26" }] },
  "stablecoins.llama.fi": {
    peggedAssets: [
      { pegType: "peggedUSD", circulating: { peggedUSD: 300e9 } },
      { pegType: "peggedUSD", circulating: { peggedUSD: 11e9 } },
      { pegType: "peggedEUR", circulating: {} },
    ],
  },
  "www.deribit.com": {
    result: { data: [[1720000000000, 35, 37, 34, 36.1]] },
  },
};

function mockFetch(failHosts: string[] = []) {
  globalThis.fetch = (async (url: string) => {
    const host = new URL(url).host;
    if (failHosts.includes(host)) return new Response("", { status: 500 });
    return Response.json(RESPONSES[host]);
  }) as unknown as typeof fetch;
}

describe("fetchCryptoContext", () => {
  test("aggregates all four sources into flat metrics", async () => {
    mockFetch();

    const result = await fetchCryptoContext();

    expect(result.status).toBe("ok");
    expect(result.metrics).toEqual({
      total_mcap_usd: 2.28e12,
      btc_dominance_pct: 56.3,
      fear_greed: 26,
      stablecoin_cap_usd: 311e9,
      btc_dvol: 36.1,
    });
  });

  test("one dead source does not discard the others", async () => {
    mockFetch(["api.coingecko.com"]);

    const result = await fetchCryptoContext();

    expect(result.status).toBe("ok");
    expect(result.metrics.total_mcap_usd).toBeUndefined();
    expect(result.metrics.fear_greed).toBe(26);
    expect(result.metrics.btc_dvol).toBe(36.1);
  });

  test("all sources failing yields error status, not ok with zero metrics", async () => {
    mockFetch(["api.coingecko.com", "api.alternative.me", "stablecoins.llama.fi", "www.deribit.com"]);

    const result = await fetchCryptoContext();

    expect(result.status.startsWith("error:")).toBe(true);
    expect(result.metrics).toEqual({});
  });
});
