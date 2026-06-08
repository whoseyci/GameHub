// protocol.ts — small runtime guard for untrusted websocket messages.
// TypeScript types do not protect the server from malformed browser payloads.

export const MAX_WS_MESSAGE_BYTES = 16 * 1024;
export const MAX_NAME_LENGTH = 20;
export const MAX_GAME_ID_LENGTH = 40;

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function cleanName(value: unknown, fallback = "Player"): string {
  const raw = typeof value === "string" ? value : fallback;
  // Trim control characters and dangerous bidi/control surprises; keep emoji.
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME_LENGTH);
  return cleaned || fallback;
}

export function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return SAFE_ID.test(v) ? v : null;
}

export function cleanBool(value: unknown): boolean {
  return value === true;
}

export function cleanInt(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export function parseClientMessage(raw: string): any | null {
  if (typeof raw !== "string" || raw.length > MAX_WS_MESSAGE_BYTES) return null;
  let msg: any;
  try { msg = JSON.parse(raw); } catch { return null; }
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return null;

  switch (msg.type) {
    case "join": {
      const pid = cleanId(msg.pid);
      if (!pid) return null;
      return {
        type: "join",
        pid,
        name: cleanName(msg.name),
        isPublic: cleanBool(msg.isPublic),
        quickGame: msg.quickGame == null ? null : cleanId(msg.quickGame),
        maxPlayers: cleanInt(msg.maxPlayers, 2, 8) ?? 8,
      };
    }
    case "add_bot":
      return { type: "add_bot", difficulty: ["easy", "medium", "hard"].includes(msg.difficulty) ? msg.difficulty : "medium" };
    case "remove_bot":
    case "next_round":
    case "to_room":
      return { type: msg.type };
    case "launch_game": {
      const gameId = cleanId(msg.gameId);
      return gameId ? { type: "launch_game", gameId } : null;
    }
    case "action": {
      if (typeof msg.action !== "string" || msg.action.length > 40) return null;
      const out: any = { type: "action", action: msg.action };
      if (Number.isInteger(msg.index)) out.index = msg.index;
      if (Number.isInteger(msg.target)) out.target = msg.target;
      if (Number.isInteger(msg.botSeat)) out.botSeat = msg.botSeat;
      if (typeof msg.c === "string" && msg.c.length <= 16) out.c = msg.c;
      if (Number.isInteger(msg.i)) out.i = msg.i;
      return out;
    }
    default:
      return null;
  }
}
