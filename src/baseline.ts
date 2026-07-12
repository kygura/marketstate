// Rolling-baseline math shared by every metric persisted in data/summary.json.
// Deliberately simple per SPEC.md: means, deltas, population stddev — no
// decay weighting, no seasonality. z-scores require n>=5 history points.

export type Baseline = {
  delta: number | null;
  mean30: number | null;
  mean90: number | null;
  z30: number | null;
};

export const Z_MIN_N = 5;

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// `history` is oldest-first, ending with the latest (current) value.
export function computeBaseline(history: number[]): Baseline {
  if (history.length === 0) {
    return { delta: null, mean30: null, mean90: null, z30: null };
  }
  const latest = history[history.length - 1] as number;
  const delta = history.length >= 2 ? latest - (history[history.length - 2] as number) : null;

  const window30 = history.slice(-30);
  const window90 = history.slice(-90);
  const mean30 = mean(window30);
  const mean90 = mean(window90);

  let z30: number | null = null;
  if (history.length >= Z_MIN_N) {
    const variance = mean(window30.map((v) => (v - mean30) ** 2));
    const stddev = Math.sqrt(variance);
    z30 = stddev > 0 ? (latest - mean30) / stddev : 0;
  }

  return { delta, mean30, mean90, z30 };
}
