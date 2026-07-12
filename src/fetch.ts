// Fetch entrypoint (`bun run fetch`): pulls FRED + Hyperliquid, persists a
// timestamped snapshot per source, and rewrites data/summary.json with
// rolling-baseline stats. See SPEC.md "Persistence & baseline".
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { fetchFred, type FredResult, type MetricValue } from "./fred";
import { fetchHyperliquid, type HyperliquidResult } from "./hyperliquid";
import { fetchCryptoContext, type CryptoContextResult } from "./crypto-context";
import { fetchCatalysts, CATALYST_WINDOW_DAYS, type CatalystsResult } from "./catalysts";
import { computeBaseline, Z_MIN_N } from "./baseline";

// Shape-validated at read time: a JSON-valid but shape-invalid snapshot
// (hand-edited, half-written, from an older schema) must not crash this and
// every future run — skip it exactly like a JSON-parse failure.
const MetricValueSchema = z.object({ value: z.number(), date: z.string() });
const FredSnapshotSchema = z.object({
  timestamp: z.string(),
  status: z.string(),
  metrics: z.record(z.string(), MetricValueSchema),
});
const HlSnapshotSchema = z.object({
  timestamp: z.string(),
  status: z.string(),
  totalOiUsd: z.number(),
  fundingSkew: z.number(),
  assets: z.record(z.string(), z.number()),
});
const CryptoCtxSnapshotSchema = z.object({
  timestamp: z.string(),
  status: z.string(),
  metrics: z.record(z.string(), z.number()),
});
type FredSnapshot = z.infer<typeof FredSnapshotSchema>;
type HlSnapshot = z.infer<typeof HlSnapshotSchema>;
type CryptoCtxSnapshot = z.infer<typeof CryptoCtxSnapshotSchema>;

function readSnapshots<T extends { timestamp: string }>(dir: string, schema: z.ZodType<T>): T[] {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const out: T[] = [];
  for (const f of files) {
    try {
      out.push(schema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"))));
    } catch {
      // corrupt, partial, or shape-invalid snapshot file — skip it rather than crash the run
    }
  }
  // Filenames are already sorted above, but same-millisecond writes carry a
  // random suffix that can put them in the wrong order. Re-sort by the
  // embedded timestamp; Array#sort is stable, so ties keep filename order.
  return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function reasonMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

type MetricSummary = {
  value: number;
  date?: string;
  delta: number | null;
  mean_30: number | null;
  mean_90: number | null;
  z_30: number | null;
};

function summarizeMetric(history: number[], value: number, date: string | undefined, warmingUp: boolean): MetricSummary {
  const baseline = computeBaseline([...history, value]);
  return {
    value,
    date,
    delta: baseline.delta,
    mean_30: baseline.mean30,
    mean_90: baseline.mean90,
    z_30: warmingUp ? null : baseline.z30,
  };
}

export async function runFetch(opts?: {
  dataDir?: string;
  fetchFredFn?: () => Promise<FredResult>;
  fetchHlFn?: () => Promise<HyperliquidResult>;
  fetchCryptoFn?: () => Promise<CryptoContextResult>;
  fetchCatalystsFn?: () => Promise<CatalystsResult>;
}) {
  const dataDir = opts?.dataDir ?? path.join(import.meta.dir, "..", "data");
  const fredDir = path.join(dataDir, "snapshots", "fred");
  const hlDir = path.join(dataDir, "snapshots", "hyperliquid");
  const cryptoDir = path.join(dataDir, "snapshots", "crypto-context");
  fs.mkdirSync(fredDir, { recursive: true });
  fs.mkdirSync(hlDir, { recursive: true });
  fs.mkdirSync(cryptoDir, { recursive: true });

  const priorFred = readSnapshots(fredDir, FredSnapshotSchema);
  const priorHl = readSnapshots(hlDir, HlSnapshotSchema);
  const priorCrypto = readSnapshots(cryptoDir, CryptoCtxSnapshotSchema);

  // Defensive: each fetcher already catches its own errors and returns an
  // `error:<reason>` status internally. allSettled is a second layer of
  // protection so an unexpected throw (a bug, not a handled failure mode)
  // still can't take down the whole entrypoint.
  const [fredSettled, hlSettled, cryptoSettled, catalystsSettled] = await Promise.allSettled([
    (opts?.fetchFredFn ?? fetchFred)(),
    (opts?.fetchHlFn ?? fetchHyperliquid)(),
    (opts?.fetchCryptoFn ?? fetchCryptoContext)(),
    (opts?.fetchCatalystsFn ?? fetchCatalysts)(),
  ]);
  const fredResult: FredResult =
    fredSettled.status === "fulfilled"
      ? fredSettled.value
      : { status: `error:${reasonMessage(fredSettled.reason)}`, metrics: {} };
  const hlResult: HyperliquidResult =
    hlSettled.status === "fulfilled"
      ? hlSettled.value
      : { status: `error:${reasonMessage(hlSettled.reason)}`, totalOiUsd: 0, fundingSkew: 0, topAssets: [], assets: {} };
  const cryptoResult: CryptoContextResult =
    cryptoSettled.status === "fulfilled"
      ? cryptoSettled.value
      : { status: `error:${reasonMessage(cryptoSettled.reason)}`, metrics: {} };
  const catalystsResult: CatalystsResult =
    catalystsSettled.status === "fulfilled"
      ? catalystsSettled.value
      : { status: `error:${reasonMessage(catalystsSettled.reason)}`, releases: [] };

  const nowIso = new Date().toISOString();
  // Random suffix guards against same-millisecond collisions (back-to-back
  // runs in tests, or a very fast machine) overwriting a snapshot file.
  const fileTimestamp = `${nowIso.replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;

  const fredSnapshot: FredSnapshot = { timestamp: nowIso, status: fredResult.status, metrics: fredResult.metrics };
  const hlSnapshot: HlSnapshot = {
    timestamp: nowIso,
    status: hlResult.status,
    totalOiUsd: hlResult.totalOiUsd,
    fundingSkew: hlResult.fundingSkew,
    assets: hlResult.assets,
  };
  const cryptoSnapshot: CryptoCtxSnapshot = { timestamp: nowIso, status: cryptoResult.status, metrics: cryptoResult.metrics };
  fs.writeFileSync(path.join(fredDir, `${fileTimestamp}.json`), JSON.stringify(fredSnapshot, null, 2));
  fs.writeFileSync(path.join(hlDir, `${fileTimestamp}.json`), JSON.stringify(hlSnapshot, null, 2));
  fs.writeFileSync(path.join(cryptoDir, `${fileTimestamp}.json`), JSON.stringify(cryptoSnapshot, null, 2));

  const fredSnapshotCount = priorFred.length + 1;
  const fredWarmingUp = fredSnapshotCount < Z_MIN_N;
  const fredMetrics: Record<string, MetricSummary> = {};
  for (const [key, metric] of Object.entries(fredResult.metrics)) {
    const history = priorFred.map((s) => s.metrics[key]?.value).filter((v): v is number => v !== undefined);
    fredMetrics[key] = summarizeMetric(history, metric.value, metric.date, fredWarmingUp);
  }

  const hlSnapshotCount = priorHl.length + 1;
  const hlWarmingUp = hlSnapshotCount < Z_MIN_N;
  const totalOiHistory = priorHl.map((s) => s.totalOiUsd);
  const fundingSkewHistory = priorHl.map((s) => s.fundingSkew);
  const assetSummaries: Record<string, MetricSummary> = {};
  for (const { name, oiUsd } of hlResult.topAssets) {
    const history = priorHl.map((s) => s.assets[name]).filter((v): v is number => v !== undefined);
    assetSummaries[name] = summarizeMetric(history, oiUsd, undefined, hlWarmingUp);
  }

  const cryptoSnapshotCount = priorCrypto.length + 1;
  const cryptoWarmingUp = cryptoSnapshotCount < Z_MIN_N;
  const cryptoMetrics: Record<string, MetricSummary> = {};
  for (const [key, value] of Object.entries(cryptoResult.metrics)) {
    const history = priorCrypto.map((s) => s.metrics[key]).filter((v): v is number => v !== undefined);
    cryptoMetrics[key] = summarizeMetric(history, value, undefined, cryptoWarmingUp);
  }

  const summary = {
    generated_at: nowIso,
    fred: {
      status: fredResult.status,
      snapshot_count: fredSnapshotCount,
      warming_up: fredWarmingUp,
      metrics: fredMetrics,
    },
    hyperliquid: {
      status: hlResult.status,
      snapshot_count: hlSnapshotCount,
      warming_up: hlWarmingUp,
      total_oi_usd: summarizeMetric(totalOiHistory, hlResult.totalOiUsd, undefined, hlWarmingUp),
      funding_skew: summarizeMetric(fundingSkewHistory, hlResult.fundingSkew, undefined, hlWarmingUp),
      assets: assetSummaries,
    },
    crypto_context: {
      status: cryptoResult.status,
      snapshot_count: cryptoSnapshotCount,
      warming_up: cryptoWarmingUp,
      metrics: cryptoMetrics,
    },
    catalysts: {
      status: catalystsResult.status,
      count: catalystsResult.releases.length,
    },
  };

  // catalysts.json is a plain forward calendar — no baseline, no snapshots;
  // each run fully replaces it (atomically, like summary.json).
  const catalysts = {
    generated_at: nowIso,
    status: catalystsResult.status,
    window_days: CATALYST_WINDOW_DAYS,
    releases: catalystsResult.releases,
  };
  const catalystsPath = path.join(dataDir, "catalysts.json");
  const catalystsTmpPath = `${catalystsPath}.tmp`;
  fs.writeFileSync(catalystsTmpPath, JSON.stringify(catalysts, null, 2));
  fs.renameSync(catalystsTmpPath, catalystsPath);

  const summaryPath = path.join(dataDir, "summary.json");
  const summaryTmpPath = `${summaryPath}.tmp`;
  fs.writeFileSync(summaryTmpPath, JSON.stringify(summary, null, 2));
  fs.renameSync(summaryTmpPath, summaryPath);

  console.log(
    `fetch: FRED=${fredResult.status} Hyperliquid=${hlResult.status} CryptoCtx=${cryptoResult.status} Catalysts=${catalystsResult.status}`,
  );
  return summary;
}

if (import.meta.main) {
  runFetch().catch((err) => {
    console.error("fetch failed:", err);
    process.exitCode = 1;
  });
}
