// protocol.ts — small runtime guard for untrusted websocket messages.
// TypeScript types do not protect the server from malformed browser payloads.
import type { GameModule } from "./games/types";

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

// Generic, bounded action payload. Lets a NEW game send its own action fields
// without editing this file's per-field whitelist (the old approach). We still
// hard-bound the shape so a malformed/hostile browser payload can't blow up the
// Durable Object: only a shallow object of primitives, capped keys, bounded
// strings/numbers, no nested objects/arrays/functions. The game's applyAction()
// remains the final authority on whether the fields are meaningful.
export const MAX_PAYLOAD_KEYS = 12;
export const MAX_PAYLOAD_STRING = 64;
// Numeric payload fields are bounded to a sane range. Game action payloads are
// board indices, card values, seat numbers, etc. — all small. Without a bound a
// hostile client could send 1e308 (passes Number.isFinite) which a game might
// feed to Array(n) / a loop bound / an index, hanging or OOM-ing the Durable
// Object (amplification DoS). ±1,000,000 is far above any legitimate field.
export const MAX_PAYLOAD_NUMBER = 1_000_000;
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
// Reserved keys the hub itself interprets — never let the payload override them.
const RESERVED_KEYS = new Set(["type", "action", "seat", "botSeat", "pid", "name"]);

export function cleanPayload(value: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  let keys = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keys >= MAX_PAYLOAD_KEYS) break;
    if (!SAFE_KEY.test(k) || RESERVED_KEYS.has(k)) continue;
    if (typeof v === "string") {
      if (v.length > MAX_PAYLOAD_STRING) continue;
      // strip control characters
      out[k] = v.replace(/[\u0000-\u001f\u007f]/g, "");
    } else if (typeof v === "number") {
      // Finite AND magnitude-bounded — see MAX_PAYLOAD_NUMBER. Non-finite
      // (NaN/Infinity) and out-of-range values are dropped, not clamped, so a
      // game never silently acts on a coerced value.
      if (!Number.isFinite(v) || Math.abs(v) > MAX_PAYLOAD_NUMBER) continue;
      out[k] = v;
    } else if (typeof v === "boolean") {
      out[k] = v;
    } else {
      continue; // drop nested objects/arrays/null/functions
    }
    keys++;
  }
  return out;
}


export function cleanSeats(value: unknown, fallbackPid: string, fallbackName: string): Array<{ pid: string; name: string }> {
  if (!Array.isArray(value)) return [{ pid: fallbackPid, name: fallbackName }];
  const out: Array<{ pid: string; name: string }> = [];
  for (const item of value.slice(0, 8) as any[]) {
    const pid = cleanId(item?.pid);
    if (!pid) continue;
    out.push({ pid, name: cleanName(item?.name, fallbackName) });
  }
  return out.length ? out : [{ pid: fallbackPid, name: fallbackName }];
}

export function parseClientMessage(raw: string, gameModule?: GameModule | null): any | null {
  if (typeof raw !== "string" || raw.length > MAX_WS_MESSAGE_BYTES) return null;
  let msg: any;
  try { msg = JSON.parse(raw); } catch { return null; }
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return null;

  switch (msg.type) {
    case "join": {
      const pid = cleanId(msg.pid);
      if (!pid) return null;
      const name = cleanName(msg.name);
      const seats = cleanSeats(msg.seats, pid, name);
      const token = typeof msg.token === "string" ? cleanId(msg.token) || undefined : undefined;
      const variant = typeof msg.variant === "string" ? cleanId(msg.variant) || undefined : undefined;
      return {
        type: "join",
        pid,
        name,
        token,
        variant,
        seats,
        isPublic: cleanBool(msg.isPublic),
        // W6 part 2: group flag travels with the very first join (creates the
        // room AS a persistent group). Subsequent joiners' flag is ignored on
        // the server (only the first member's settings stick).
        isGroup: cleanBool(msg.isGroup),
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
    case "set_ready": {
      // W6: per-member ready toggle. Optional `pid` lets a pass-and-play
      // host toggle a specific controlled seat; omitted toggles all the
      // seats this connection controls.
      const out: any = { type: "set_ready", ready: cleanBool(msg.ready) };
      const pid = cleanId(msg.pid);
      if (pid) out.pid = pid;
      const gameId = cleanId(msg.gameId);
      if (gameId) out.gameId = gameId;
      return out;
    }
    case "set_group": {
      // W6 part 2: host-only toggle that flips this room into a persistent
      // group (or back). Server enforces host + between-games preconditions.
      return { type: "set_group", isGroup: cleanBool(msg.isGroup) };
    }
    case "launch_game": {
      const gameId = cleanId(msg.gameId);
      if (!gameId) return null;
      // W6: opt-in variant string. Games that don't implement variants
      // ignore the field; the platform never enforces a catalogue (each
      // game module owns its own set).
      const variant = msg.variant ? cleanId(msg.variant) : null;
      const out: any = { type: "launch_game", gameId };
      if (variant) out.variant = variant;
      return out;
    }
    case "chat": {
      // Free-form room chat. Bounded + trimmed; empty messages dropped.
      const text = typeof msg.text === "string" ? msg.text.replace(/\s+/g, " ").trim().slice(0, 240) : "";
      if (!text) return null;
      const out: any = { type: "chat", text };
      const pid = cleanId(msg.pid);
      if (pid) out.pid = pid;          // optional: which controlled seat is "speaking"
      return out;
    }
    case "react": {
      // Animated reaction. `emoji` now carries an EMOTION ID (e.g. "furious",
      // "smug") that the client maps to a self-contained animated character — no
      // literal emoji. Bounded to a short safe token; legacy emoji strings still
      // pass (the client falls back gracefully).
      const emoji = typeof msg.emoji === "string" ? msg.emoji.slice(0, 24) : "";
      if (!emoji.trim()) return null;
      const out: any = { type: "react", emoji };
      const pid = cleanId(msg.pid);
      if (pid) out.pid = pid;
      return out;
    }
    case "action": {
      if (typeof msg.action !== "string" || msg.action.length > 40) return null;
      const cleanedPayload = cleanPayload(msg);
      const baseAction = { action: msg.action, ...cleanedPayload };
      if (gameModule?.parseAction) {
        const parsed = gameModule.parseAction(baseAction);
        if (!parsed) return null;
        const out: any = { type: "action", ...parsed };
        if (Number.isInteger(msg.botSeat)) out.botSeat = msg.botSeat;
        if (Number.isInteger(msg.seat)) out.seat = msg.seat;
        return out;
      }
      const out: any = { type: "action", ...baseAction };
      if (Number.isInteger(msg.botSeat)) out.botSeat = msg.botSeat; else delete out.botSeat;
      if (Number.isInteger(msg.seat)) out.seat = msg.seat; else delete out.seat;
      return out;
    }
    default:
      return null;
  }
}
