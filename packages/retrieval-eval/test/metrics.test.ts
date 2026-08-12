import { describe, expect, it } from "vitest";
import {
  dcgAt,
  idcgAt,
  mrrAt,
  ndcgAt,
  percentile,
  recallAt,
} from "../src/metrics/index.js";
import type { Grade } from "../src/types.js";

/**
 * Judgments used across the hand-computed cases below.
 * Relevant set (grade >= 1) is {a, c, d}; `b` is explicitly judged irrelevant.
 */
const judgments: Record<string, Grade> = { a: 3, b: 0, c: 2, d: 1 };

describe("dcgAt", () => {
  it("uses exponential gain (2^rel - 1) with log2(rank + 1) discount", () => {
    // ranked [a, b, c] => 7/log2(2) + 0/log2(3) + 3/log2(4)
    //                   = 7 + 0 + 1.5 = 8.5
    expect(dcgAt(["a", "b", "c"], judgments, 3)).toBeCloseTo(8.5, 10);
  });

  it("truncates at k", () => {
    expect(dcgAt(["a", "b", "c"], judgments, 1)).toBeCloseTo(7, 10);
  });

  it("treats unjudged documents as grade 0", () => {
    expect(dcgAt(["zzz"], judgments, 1)).toBe(0);
  });

  it("returns 0 for an empty ranking", () => {
    expect(dcgAt([], judgments, 10)).toBe(0);
  });
});

describe("idcgAt", () => {
  it("ranks all judged documents by descending grade", () => {
    // ideal [a(3), c(2), d(1)] => 7 + 3/log2(3) + 1/log2(4)
    const expected = 7 + 3 / Math.log2(3) + 1 / 2;
    expect(idcgAt(judgments, 3)).toBeCloseTo(expected, 10);
  });

  it("is 0 when nothing is relevant", () => {
    expect(idcgAt({ a: 0, b: 0 }, 10)).toBe(0);
  });
});

describe("ndcgAt", () => {
  it("is dcg divided by idcg", () => {
    // 8.5 / (7 + 3/log2(3) + 0.5) = 8.5 / 9.3927892... = 0.9049...
    expect(ndcgAt(["a", "b", "c"], judgments, 3)).toBeCloseTo(0.90495, 5);
  });

  it("is 1 for a perfect ranking", () => {
    expect(ndcgAt(["a", "c", "d"], judgments, 3)).toBeCloseTo(1, 10);
  });

  it("is 0 when no relevant document is retrieved", () => {
    expect(ndcgAt(["b", "zzz"], judgments, 10)).toBe(0);
  });

  it("returns NaN when the query has no relevant documents", () => {
    // Undefined, not zero. Callers must exclude these from aggregates.
    expect(ndcgAt(["a"], { a: 0 }, 10)).toBeNaN();
  });

  it("penalises putting a lower grade first", () => {
    const good = ndcgAt(["a", "c"], judgments, 10);
    const worse = ndcgAt(["c", "a"], judgments, 10);
    expect(worse).toBeLessThan(good);
  });
});

describe("mrrAt", () => {
  it("is the reciprocal rank of the first relevant hit", () => {
    expect(mrrAt(["b", "a"], judgments, 10)).toBeCloseTo(0.5, 10);
    expect(mrrAt(["a", "b"], judgments, 10)).toBeCloseTo(1, 10);
    expect(mrrAt(["zzz", "b", "d"], judgments, 10)).toBeCloseTo(1 / 3, 10);
  });

  it("is 0 when no relevant hit appears within k", () => {
    expect(mrrAt(["b", "zzz", "a"], judgments, 2)).toBe(0);
  });

  it("counts grade 1 as relevant", () => {
    expect(mrrAt(["d"], judgments, 10)).toBe(1);
  });
});

describe("recallAt", () => {
  it("is retrieved-relevant over total-relevant", () => {
    // relevant set is {a, c, d}
    expect(recallAt(["a", "b"], judgments, 10)).toBeCloseTo(1 / 3, 10);
    expect(recallAt(["a", "c", "d"], judgments, 10)).toBeCloseTo(1, 10);
  });

  it("respects the cutoff", () => {
    expect(recallAt(["a", "c", "d"], judgments, 2)).toBeCloseTo(2 / 3, 10);
  });

  it("ignores duplicate ids", () => {
    expect(recallAt(["a", "a", "a"], judgments, 10)).toBeCloseTo(1 / 3, 10);
  });

  it("returns NaN when the query has no relevant documents", () => {
    expect(recallAt(["a"], { a: 0 }, 10)).toBeNaN();
  });
});

describe("percentile", () => {
  it("returns the nearest-rank value", () => {
    const xs = [10, 20, 30, 40, 50];
    expect(percentile(xs, 50)).toBe(30);
    expect(percentile(xs, 95)).toBe(50);
  });

  it("does not mutate its input", () => {
    const xs = [3, 1, 2];
    percentile(xs, 50);
    expect(xs).toEqual([3, 1, 2]);
  });

  it("returns NaN for an empty sample", () => {
    expect(percentile([], 50)).toBeNaN();
  });
});
