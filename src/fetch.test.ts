import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runFetch } from "./fetch";
import type { FredResult } from "./fred";
import type { HyperliquidResult } from "./hyperliquid";
import type { CryptoContextResult } from "./crypto-context";
import type { CatalystsResult } from "./catalysts";

// Never hits the network: both fetchers are injected fakes, and everything
// is written under a throwaway temp dir, never the real project data/.
function makeFred(value: number): () => Promise<FredResult> {
  return async () => ({ status: "ok", metrics: { WALCL: { value, date: "2024-01-01" } } });
}
function makeHl(oi: number): () => Promise<HyperliquidResult> {
  return async () => ({
    status: "ok",
    totalOiUsd: oi,
    fundingSkew: 0.0001,
    topAssets: [{ name: "BTC", oiUsd: oi }],
    assets: { BTC: oi },
  });
}
function makeCrypto(fng: number): () => Promise<CryptoContextResult> {
  return async () => ({ status: "ok", metrics: { fear_greed: fng } });
}
function makeCatalysts(): () => Promise<CatalystsResult> {
  return async () => ({
    status: "ok",
    releases: [{ date: "2026-07-14", name: "FOMC Press Release" }],
  });
}

// All four fetchers default to injected fakes; tests override per case.
function run(opts: NonNullable<Parameters<typeof runFetch>[0]> & { dataDir: string }) {
  return runFetch({ fetchCryptoFn: makeCrypto(26), fetchCatalystsFn: makeCatalysts(), ...opts });
}

describe("runFetch", () => {
  test("writes snapshots + summary, warming-up until n=5, then z-scores appear", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketstate-test-"));

    let summary: Awaited<ReturnType<typeof runFetch>> | undefined;
    for (let i = 1; i <= 5; i++) {
      summary = await run({
        dataDir,
        fetchFredFn: makeFred(100 + i * 10),
        fetchHlFn: makeHl(1000 + i * 100),
      });
    }
    if (!summary) throw new Error("no summary produced");

    // 5 snapshot files per source on disk.
    expect(fs.readdirSync(path.join(dataDir, "snapshots", "fred")).length).toBe(5);
    expect(fs.readdirSync(path.join(dataDir, "snapshots", "hyperliquid")).length).toBe(5);

    expect(summary.fred.snapshot_count).toBe(5);
    expect(summary.fred.warming_up).toBe(false);
    expect(summary.fred.metrics.WALCL?.value).toBe(150);
    expect(summary.fred.metrics.WALCL?.delta).toBe(10);
    expect(summary.fred.metrics.WALCL?.z_30).not.toBeNull();

    expect(summary.hyperliquid.warming_up).toBe(false);
    expect(summary.hyperliquid.total_oi_usd.value).toBe(1500);
    expect(summary.hyperliquid.assets.BTC?.z_30).not.toBeNull();

    // summary.json on disk matches the returned shape.
    const written = JSON.parse(fs.readFileSync(path.join(dataDir, "summary.json"), "utf-8"));
    expect(written.fred.snapshot_count).toBe(5);

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test("stays warming-up and z-score-free below n=5", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketstate-test-"));

    const summary = await run({ dataDir, fetchFredFn: makeFred(100), fetchHlFn: makeHl(1000) });

    expect(summary.fred.snapshot_count).toBe(1);
    expect(summary.fred.warming_up).toBe(true);
    expect(summary.fred.metrics.WALCL?.z_30).toBeNull();
    expect(summary.fred.metrics.WALCL?.delta).toBeNull();

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test("an unexpected throw from one fetcher does not crash the run", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketstate-test-"));

    const summary = await run({
      dataDir,
      fetchFredFn: async () => {
        throw new Error("boom");
      },
      fetchHlFn: makeHl(1000),
    });

    expect(summary.fred.status.startsWith("error:")).toBe(true);
    expect(summary.hyperliquid.status).toBe("ok");

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test("crypto_context metrics get baseline stats and catalysts.json is written", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketstate-test-"));

    let summary: Awaited<ReturnType<typeof runFetch>> | undefined;
    for (let i = 1; i <= 5; i++) {
      summary = await run({
        dataDir,
        fetchFredFn: makeFred(100),
        fetchHlFn: makeHl(1000),
        fetchCryptoFn: makeCrypto(20 + i),
      });
    }
    if (!summary) throw new Error("no summary produced");

    expect(fs.readdirSync(path.join(dataDir, "snapshots", "crypto-context")).length).toBe(5);
    expect(summary.crypto_context.status).toBe("ok");
    expect(summary.crypto_context.warming_up).toBe(false);
    expect(summary.crypto_context.metrics.fear_greed?.value).toBe(25);
    expect(summary.crypto_context.metrics.fear_greed?.delta).toBe(1);
    expect(summary.crypto_context.metrics.fear_greed?.z_30).not.toBeNull();

    expect(summary.catalysts).toEqual({ status: "ok", count: 1 });
    const catalysts = JSON.parse(fs.readFileSync(path.join(dataDir, "catalysts.json"), "utf-8"));
    expect(catalysts.window_days).toBe(14);
    expect(catalysts.releases).toEqual([{ date: "2026-07-14", name: "FOMC Press Release" }]);

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test("a JSON-valid but shape-invalid prior snapshot is skipped, not crashed on", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketstate-test-"));
    const fredDir = path.join(dataDir, "snapshots", "fred");
    fs.mkdirSync(fredDir, { recursive: true });
    // Missing `metrics` entirely — would crash `s.metrics[key]` if not validated.
    fs.writeFileSync(path.join(fredDir, "garbage.json"), JSON.stringify({ timestamp: "2024-01-01T00:00:00.000Z" }));

    const summary = await run({ dataDir, fetchFredFn: makeFred(100), fetchHlFn: makeHl(1000) });

    expect(summary.fred.status).toBe("ok");
    expect(summary.fred.snapshot_count).toBe(1); // garbage file ignored, only the new snapshot counts

    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
