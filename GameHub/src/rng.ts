// rng.ts — tiny deterministic RNG helpers for reproducible game states/tests.
//
// Game state stored in Durable Objects should be plain JSON. Instead of keeping a
// function/class RNG in memory, games store a numeric rngState and advance it with
// nextRandom(). If rngState is absent (old persisted rooms), ensureRngState()
// backfills one from Math.random() so existing rooms keep working.

export interface RngStateHolder { rngState?: number; }

export function makeSeed(seedText = `${Date.now()}:${Math.random()}`): number {
  // FNV-1a 32-bit hash. Never return 0 so all seed values are visibly initialized.
  let h = 0x811c9dc5;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h || 0x9e3779b9;
}

export function ensureRngState<T extends RngStateHolder>(state: T): T {
  if (!Number.isInteger(state.rngState)) state.rngState = makeSeed();
  return state;
}

export function nextRandom(state: RngStateHolder): number {
  ensureRngState(state);
  // Mulberry32 step: compact, deterministic, good enough for card/dice games.
  let t = (state.rngState = (state.rngState! + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomInt(state: RngStateHolder, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new RangeError("maxExclusive must be a positive integer");
  return Math.floor(nextRandom(state) * maxExclusive);
}

export function shuffleInPlace<T>(items: T[], state: RngStateHolder): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(state, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
