// Keyless crypto market-context fetcher: CoinGecko global market cap /
// BTC dominance, alternative.me Fear & Greed, DefiLlama stablecoin cap,
// Deribit BTC DVOL (implied vol index).
import { z } from "zod";
import { proxyFetch } from "./proxy-fetch";

export type CryptoContextResult = {
  status: "ok" | `error:${string}`;
  metrics: Record<string, number>;
};

const CoinGeckoSchema = z.object({
  data: z.object({
    total_market_cap: z.object({ usd: z.number() }),
    market_cap_percentage: z.object({ btc: z.number() }),
  }),
});

const FngSchema = z.object({
  data: z.array(z.object({ value: z.string() })).min(1),
});

// Only peggedUSD is read; assets pegged to other currencies simply lack the
// key. z.object strips unknown keys, so odd fields elsewhere can't fail the
// parse of a 400+ asset payload.
const StablecoinsSchema = z.object({
  peggedAssets: z.array(
    z.object({
      pegType: z.string(),
      circulating: z.object({ peggedUSD: z.number().optional() }),
    }),
  ),
});

// Data points are [timestamp, open, high, low, close].
const DeribitSchema = z.object({
  result: z.object({ data: z.array(z.array(z.number())).min(1) }),
});

async function getJson(url: string): Promise<unknown> {
  const res = await proxyFetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const SOURCES: Record<string, () => Promise<Record<string, number>>> = {
  coingecko: async () => {
    const parsed = CoinGeckoSchema.parse(await getJson("https://api.coingecko.com/api/v3/global"));
    return {
      total_mcap_usd: parsed.data.total_market_cap.usd,
      btc_dominance_pct: parsed.data.market_cap_percentage.btc,
    };
  },
  fng: async () => {
    const parsed = FngSchema.parse(await getJson("https://api.alternative.me/fng/?limit=1"));
    const value = Number(parsed.data[0]!.value);
    if (Number.isNaN(value)) throw new Error("fear/greed value is not numeric");
    return { fear_greed: value };
  },
  defillama: async () => {
    const parsed = StablecoinsSchema.parse(
      await getJson("https://stablecoins.llama.fi/stablecoins?includePrices=false"),
    );
    const cap = parsed.peggedAssets
      .filter((a) => a.pegType === "peggedUSD")
      .reduce((sum, a) => sum + (a.circulating.peggedUSD ?? 0), 0);
    return { stablecoin_cap_usd: cap };
  },
  deribit: async () => {
    const now = Date.now();
    const url = `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&resolution=3600&start_timestamp=${now - 2 * 3_600_000}&end_timestamp=${now}`;
    const parsed = DeribitSchema.parse(await getJson(url));
    const close = parsed.result.data.at(-1)?.[4];
    if (close === undefined) throw new Error("DVOL data point missing close");
    return { btc_dvol: close };
  },
};

// Per-source catch, mirroring fred.ts: one dead API must not discard the
// others, but zero metrics with every source failing is an error, not "ok".
export async function fetchCryptoContext(): Promise<CryptoContextResult> {
  let firstError: string | undefined;
  const results = await Promise.all(
    Object.entries(SOURCES).map(async ([name, fn]) => {
      try {
        return await fn();
      } catch (err) {
        firstError ??= `${name}: ${err instanceof Error ? err.message : String(err)}`;
        return {};
      }
    }),
  );

  const metrics: Record<string, number> = Object.assign({}, ...results);
  if (Object.keys(metrics).length === 0) {
    return { status: `error:${firstError ?? "all sources failed"}`, metrics: {} };
  }
  return { status: "ok", metrics };
}
