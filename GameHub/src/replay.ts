// replay.ts — compact room action log/debug snapshot helpers.
// Stored in Durable Object metadata so hibernation/restarts keep recent context.

export interface ReplayEntry {
  seq: number;
  t: number;
  kind: string;
  actor?: string;
  seat?: number;
  gameId?: string | null;
  action?: string;
  detail?: Record<string, unknown>;
}

export const MAX_REPLAY_ENTRIES = 120;

export function appendReplay(log: ReplayEntry[] | undefined, entry: Omit<ReplayEntry, "seq" | "t">, now = Date.now()): ReplayEntry[] {
  const base = Array.isArray(log) ? log : [];
  const last = base.length ? base[base.length - 1].seq : 0;
  const next: ReplayEntry = { seq: last + 1, t: now, ...entry };
  const out = [...base, next];
  return out.length > MAX_REPLAY_ENTRIES ? out.slice(out.length - MAX_REPLAY_ENTRIES) : out;
}

export function summarizeGameState(gameId: string | null, gameState: any): Record<string, unknown> | null {
  if (!gameId || !gameState) return null;
  const players = Array.isArray(gameState.players) ? gameState.players : [];
  const base: Record<string, unknown> = {
    gameId,
    schemaVersion: gameState.schemaVersion ?? null,
    phase: gameState.phase ?? null,
    players: players.map((p: any, seat: number) => ({
      seat,
      name: p?.name,
      status: p?.status,
      totalScore: p?.totalScore,
      roundScore: p?.roundScore,
      banked: p?.banked,
      penalties: p?.penalties,
    })),
  };
  if (gameId === "skyjo") Object.assign(base, { round: gameState.round, currentPlayer: gameState.currentPlayer, turnAction: gameState.turnAction });
  if (gameId === "flip7") Object.assign(base, { round: gameState.round, current: gameState.current, pendingAction: gameState.pendingAction });
  if (gameId === "qwixx") Object.assign(base, { round: gameState.round, activeSeat: gameState.activeSeat, locked: gameState.locked });
  return base;
}
