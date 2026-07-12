import { describe, expect, test } from "bun:test";
import { computeBaseline } from "./baseline";

describe("computeBaseline", () => {
  test("empty history yields all nulls", () => {
    expect(computeBaseline([])).toEqual({ delta: null, mean30: null, mean90: null, z30: null });
  });

  test("single value: no delta, no z-score (n<5), mean equals value", () => {
    const result = computeBaseline([10]);
    expect(result.delta).toBeNull();
    expect(result.z30).toBeNull();
    expect(result.mean30).toBe(10);
    expect(result.mean90).toBe(10);
  });

  test("delta is latest minus previous", () => {
    const result = computeBaseline([10, 20, 30, 40, 50]);
    expect(result.delta).toBe(10);
  });

  test("z-score appears at n=5 and matches population-stddev math", () => {
    const result = computeBaseline([10, 20, 30, 40, 50]);
    expect(result.mean30).toBe(30);
    // population stddev of [10,20,30,40,50] is sqrt(200) ≈ 14.142
    expect(result.z30).toBeCloseTo((50 - 30) / Math.sqrt(200), 6);
  });

  test("below n=5, z-score stays null even with mean/delta present", () => {
    const result = computeBaseline([10, 20, 30, 40]);
    expect(result.delta).toBe(10);
    expect(result.z30).toBeNull();
  });

  test("flat history (stddev 0) yields a finite z-score of 0, not NaN/Infinity", () => {
    const result = computeBaseline([5, 5, 5, 5, 5]);
    expect(result.z30).toBe(0);
    expect(Number.isFinite(result.z30 as number)).toBe(true);
  });

  test("history over 30 entries uses only the last 30 for mean30", () => {
    // 5 old values of 0 (would drag the mean down if included), then 30 values of 100.
    const history = [...Array(5).fill(0), ...Array(30).fill(100)];
    const result = computeBaseline(history);
    expect(result.mean30).toBe(100);
  });
});
