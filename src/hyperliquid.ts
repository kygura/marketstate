// Hyperliquid perp market fetcher (keyless).
// Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
import { z } from "zod";
import { proxyFetch } from "./proxy-fetch";

const UniverseAssetSchema = z.object({
  szDecimals: z.number(),
  name: z.string(),
  maxLeverage: z.number(),
  marginTableId: z.number(),
  isDelisted: z.boolean().optional(),
});

const MetaSchema = z.object({
  universe: z.array(UniverseAssetSchema),
});

// All numeric fields come back as strings; some are nullable (delisted/thin
// assets, e.g. no live quote to derive premium/midPx/impactPxs from).
const AssetCtxSchema = z.object({
  funding: z.string(),
  openInterest: z.string(),
  prevDayPx: z.string(),
  dayNtlVlm: z.string(),
  premium: z.string().nullable(),
  oraclePx: z.string(),
  markPx: z.string(),
  midPx: z.string().nullable(),
  impactPxs: z.array(z.string()).nullable(),
  dayBaseVlm: z.string(),
});

// metaAndAssetCtxs response is a 2-tuple: [{universe}, assetCtx[]], assetCtx
// aligned to universe by array index (not by name).
const ResponseSchema = z.tuple([MetaSchema, z.array(AssetCtxSchema)]);

export type AssetOi = { name: string; oiUsd: number };
export type HyperliquidResult = {
  status: "ok" | `error:${string}`;
  totalOiUsd: number;
  fundingSkew: number;
  topAssets: AssetOi[];
  assets: Record<string, number>;
};

const TOP_N = 5;

export async function fetchHyperliquid(): Promise<HyperliquidResult> {
  try {
    const res = await proxyFetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`Hyperliquid HTTP ${res.status}`);
    }
    const json = await res.json();
    const [meta, assetCtxs] = ResponseSchema.parse(json);

    // Aggregate to market-level signals: total notional OI, and an
    // OI-weighted average funding rate (funding skew) — weighting by
    // notional OI so a handful of tiny/thin markets can't swing the read
    // the way a plain average would. Delisted and zero-OI assets (e.g.
    // MATIC in the fixture, OI "0.0" post-delist) are excluded as noise.
    const assets: Record<string, number> = {};
    let totalOiUsd = 0;
    let weightedFundingSum = 0;

    meta.universe.forEach((asset, i) => {
      const ctx = assetCtxs[i];
      if (!ctx || asset.isDelisted) return;
      const oi = Number(ctx.openInterest);
      if (!oi) return;
      const markPx = Number(ctx.markPx);
      const funding = Number(ctx.funding);
      if (Number.isNaN(markPx) || Number.isNaN(funding)) return; // malformed numeric string — drop this asset, don't poison the aggregates
      const notionalOi = oi * markPx;
      assets[asset.name] = notionalOi;
      totalOiUsd += notionalOi;
      weightedFundingSum += funding * notionalOi;
    });

    const fundingSkew = totalOiUsd > 0 ? weightedFundingSum / totalOiUsd : 0;
    const topAssets = Object.entries(assets)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([name, oiUsd]) => ({ name, oiUsd }));

    return { status: "ok", totalOiUsd, fundingSkew, topAssets, assets };
  } catch (err) {
    return {
      status: `error:${err instanceof Error ? err.message : String(err)}`,
      totalOiUsd: 0,
      fundingSkew: 0,
      topAssets: [],
      assets: {},
    };
  }
}
