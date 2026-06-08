import { describe, expect, it } from "vitest";
import { makeSeed, randomInt, shuffleInPlace } from "../src/rng";

describe("deterministic RNG helpers", () => {
  it("produces stable seeds for stable text", () => {
    expect(makeSeed("room:ABC:skyjo")).toBe(makeSeed("room:ABC:skyjo"));
    expect(makeSeed("room:ABC:skyjo")).not.toBe(makeSeed("room:XYZ:skyjo"));
  });

  it("shuffles reproducibly from the same state", () => {
    const a = [1, 2, 3, 4, 5, 6, 7];
    const b = [1, 2, 3, 4, 5, 6, 7];
    const rngA = { rngState: makeSeed("same") };
    const rngB = { rngState: makeSeed("same") };
    shuffleInPlace(a, rngA);
    shuffleInPlace(b, rngB);
    expect(a).toEqual(b);
    expect(rngA.rngState).toBe(rngB.rngState);
  });

  it("bounds random integers", () => {
    const rng = { rngState: makeSeed("bounds") };
    for (let i = 0; i < 100; i++) {
      const n = randomInt(rng, 6);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(6);
    }
  });
});
