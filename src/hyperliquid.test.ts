import { describe, expect, test, afterEach } from "bun:test";
import fixture from "./fixtures/hyperliquid.json";
import { fetchHyperliquid } from "./hyperliquid";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchHyperliquid", () => {
  test("aggregates live assets, excludes delisted and zero-OI", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify(fixture), { status: 200 })) as unknown as typeof fetch;

    const result = await fetchHyperliquid();

    expect(result.status).toBe("ok");
    // MATIC is delisted (and zero-OI) in the fixture — must not appear anywhere.
    expect(result.assets.MATIC).toBeUndefined();
    expect(result.assets).toHaveProperty("BTC");
    expect(result.assets).toHaveProperty("ETH");
    expect(result.assets).toHaveProperty("ATOM");
    expect(result.assets).toHaveProperty("DYDX");

    // Recompute expected notional OI/funding skew directly from the fixture
    // to check the aggregation math independently of the implementation.
    const btcOi = 37299.6947999999 * 63846.0;
    const ethOi = 802595.3684000007 * 1800.4;
    const atomOi = 1264700.28 * 1.5593;
    const dydxOi = 27362480.1999999955 * 0.13198;
    const totalOi = btcOi + ethOi + atomOi + dydxOi;
    const weightedFunding =
      (0.0000125 * btcOi + 0.0000125 * ethOi + -0.0000110133 * atomOi + 0.0000125 * dydxOi) / totalOi;

    expect(result.totalOiUsd).toBeCloseTo(totalOi, 2);
    expect(result.fundingSkew).toBeCloseTo(weightedFunding, 10);

    // BTC and ETH dwarf ATOM/DYDX in notional OI in this fixture.
    expect(result.topAssets[0]?.name).toBe("BTC");
    expect(result.topAssets[1]?.name).toBe("ETH");
    expect(result.topAssets.length).toBe(4);
  });

  test("returns error status without throwing on network failure", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const result = await fetchHyperliquid();

    expect(result.status.startsWith("error:")).toBe(true);
    expect(result.totalOiUsd).toBe(0);
    expect(result.topAssets).toEqual([]);
  });

  test("returns error status on non-ok HTTP response", async () => {
    globalThis.fetch = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;

    const result = await fetchHyperliquid();

    expect(result.status.startsWith("error:")).toBe(true);
  });

  test("excludes a delisted asset with nonzero OI and a live asset with zero OI independently", async () => {
    // MATIC in the base fixture is both delisted AND zero-OI, so it can't
    // tell us which guard is doing the excluding. Add one asset for each
    // condition alone.
    const modified = JSON.parse(JSON.stringify(fixture));
    modified[0].universe.push(
      { szDecimals: 2, name: "DELISTED_NONZERO", maxLeverage: 10, marginTableId: 99, isDelisted: true },
      { szDecimals: 2, name: "ZERO_LIVE", maxLeverage: 10, marginTableId: 100 },
    );
    modified[1].push(
      {
        funding: "0.0000125",
        openInterest: "500.0",
        prevDayPx: "10.0",
        dayNtlVlm: "1000",
        premium: "0.0",
        oraclePx: "10.0",
        markPx: "10.0",
        midPx: "10.0",
        impactPxs: ["10.0", "10.0"],
        dayBaseVlm: "100",
      },
      {
        funding: "0.0",
        openInterest: "0.0",
        prevDayPx: "1.0",
        dayNtlVlm: "0",
        premium: null,
        oraclePx: "1.0",
        markPx: "1.0",
        midPx: null,
        impactPxs: null,
        dayBaseVlm: "0",
      },
    );
    globalThis.fetch = (async () => new Response(JSON.stringify(modified), { status: 200 })) as unknown as typeof fetch;

    const result = await fetchHyperliquid();

    expect(result.assets.DELISTED_NONZERO).toBeUndefined();
    expect(result.assets.ZERO_LIVE).toBeUndefined();
    expect(result.assets).toHaveProperty("BTC");
  });

  test("drops an asset with a malformed numeric field instead of poisoning aggregates with NaN", async () => {
    const modified = JSON.parse(JSON.stringify(fixture));
    modified[0].universe.push({ szDecimals: 2, name: "BAD_NUMERIC", maxLeverage: 10, marginTableId: 101 });
    modified[1].push({
      funding: "0.0000125",
      openInterest: "500.0",
      prevDayPx: "10.0",
      dayNtlVlm: "1000",
      premium: "0.0",
      oraclePx: "10.0",
      markPx: "not-a-number", // schema-valid string, non-numeric
      midPx: "10.0",
      impactPxs: ["10.0", "10.0"],
      dayBaseVlm: "100",
    });
    globalThis.fetch = (async () => new Response(JSON.stringify(modified), { status: 200 })) as unknown as typeof fetch;

    const result = await fetchHyperliquid();

    expect(result.assets.BAD_NUMERIC).toBeUndefined();
    expect(Number.isFinite(result.totalOiUsd)).toBe(true);
    expect(Number.isFinite(result.fundingSkew)).toBe(true);
    // Unaffected by the bad asset — same totals as the clean-fixture test.
    const btcOi = 37299.6947999999 * 63846.0;
    const ethOi = 802595.3684000007 * 1800.4;
    const atomOi = 1264700.28 * 1.5593;
    const dydxOi = 27362480.1999999955 * 0.13198;
    expect(result.totalOiUsd).toBeCloseTo(btcOi + ethOi + atomOi + dydxOi, 2);
  });
});
