// server.ts — Game Hub on Cloudflare Workers + Durable Objects (PartyServer).
//
//   Room  DO  (binding "Room",  url /parties/room/<CODE>)  — a persistent group
//             that can launch games, return to its lobby, and launch again.
//   Lobby DO  (binding "Lobby", url /parties/lobby/public-lobby) — discovery of
//             public/quick-play rooms.
//
// EFFICIENCY (free plan: 1M DO req/mo, 400K GB-s/mo):
//   • Hibernation ON — idle rooms get evicted from memory (≈0 GB-s) but keep
//     sockets open. State lives in storage + per-connection attachments.
//   • ping/pong auto-response so keep-alives never wake the DO.
//   • Lobby is pinged ONLY on membership/game-status change (not per action),
//     slashing cross-DO subrequests.
//   • One alarm drives BOTH game ticks and idle close (no extra timers).
import {
  Server, Connection, ConnectionContext, routePartykitRequest, getServerByName,
} from "partyserver";
import { getGame, GAME_CATALOGUE } from "./games/registry";
import { cleanId, cleanInt, cleanName, parseClientMessage } from "./protocol";
import { appendReplay, summarizeGameState, type ReplayEntry } from "./replay";
import type { ErrorCode, ServerError, ActionRejected } from "./games/types";

// ─── Structured error / event protocol (Proposal 10) ───────────────────
// One shape for every server-sent error so the client can branch on a code
// (and know whether it can recover) instead of parsing free-text strings.
function serverError(code: ErrorCode, message: string, recoverable = false): ServerError {
  return { type: "error", code, message, recoverable };
}
function actionRejected(reason: string, originalAction: string): ActionRejected {
  return { type: "action_rejected", reason, originalAction };
}

export interface Env {
  Room: DurableObjectNamespace<Room>;
  Lobby: DurableObjectNamespace<Lobby>;
  ASSETS: Fetcher;
  DEBUG_TOKEN?: string;
  [key: string]: unknown;
}

export const LOBBY_SINGLETON = "public-lobby";
const IDLE_MS = 10 * 60 * 1000;       // close room after 10 min idle
const EMPTY_GRACE_MS = 45 * 1000;     // close shortly after everyone leaves
const SAFE_ROOM_CODE = /^[A-Za-z0-9_-]{1,64}$/;

// Per-connection rate limit (token bucket). Each inbound message that the hub
// acts on can fan out to N broadcasts + storage writes, so unbounded message
// rates are an amplification vector. ~15 msgs/sec sustained with a burst of 30
// is far above any legitimate UI cadence (taps, bot turns) but blocks floods.
const RATE_REFILL_PER_SEC = 15;
const RATE_BURST = 30;
type Bucket = { tokens: number; last: number };

type ConnState = { pid?: string; pids?: string[] };
interface Member { id: string; name: string; bot?: boolean; difficulty?: string; }
interface Pending { id: string; name: string; }

/* ============================================================
   ROOM — persistent group + game launcher
   ============================================================ */
export class Room extends Server<Env> {
  static options = { hibernate: true };

  members: Member[] = [];   // people in the group (persist across games)
  pending: Pending[] = [];  // late joiners spectating until next game/round
  hostId: string | null = null;
  isPublic = false;
  quickGame: string | null = null; // if set, this is a quick-play room for that game
  maxPlayers = 8;
  lastActivity = Date.now();
  actionLog: ReplayEntry[] = [];
  // In-memory rate-limit buckets, keyed by connection id. Not persisted: after
  // hibernation the socket is idle, and a fresh bucket on wake is safe (full).
  private rateBuckets = new Map<string, Bucket>();

  // current game (null => in room lobby)
  gameId: string | null = null;
  gameState: any = null;
  tickAt: number | null = null; // when a deferred game tick should run

  async onStart() {
    const m = await this.ctx.storage.get<any>("meta");
    if (m) {
      this.members = m.members ?? [];
      this.pending = m.pending ?? [];
      this.hostId = m.hostId ?? null;
      this.isPublic = m.isPublic ?? false;
      this.quickGame = m.quickGame ?? null;
      this.maxPlayers = m.maxPlayers ?? 8;
      this.lastActivity = m.lastActivity ?? Date.now();
      this.actionLog = m.actionLog ?? [];
      this.gameId = m.gameId ?? null;
      this.tickAt = m.tickAt ?? null;
    }
    this.gameState = (await this.ctx.storage.get<any>("gameState")) ?? null;
    // State migration (Proposal 3): an in-progress game persisted by an OLDER deploy
    // may have a stale schema. Run the game's migrate() once on load so a deploy can't
    // crash live rooms. Failures are logged, never thrown (a bad migrate shouldn't
    // brick room startup).
    if (this.gameId && this.gameState) {
      const g = getGame(this.gameId);
      if (g?.migrate) { try { g.migrate(this.gameState); } catch (e) { console.error("migrate() failed for", this.gameId, e); } }
    }
    // Auto-reply to pings without waking us for heavy work.
    try { this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong")); } catch {}
  }

  private async persistMeta() {
    await this.ctx.storage.put("meta", {
      members: this.members, pending: this.pending, hostId: this.hostId,
      isPublic: this.isPublic, quickGame: this.quickGame, maxPlayers: this.maxPlayers,
      lastActivity: this.lastActivity, actionLog: this.actionLog,
      gameId: this.gameId, tickAt: this.tickAt,
    });
  }
  private async persistGame() {
    if (this.gameState) await this.ctx.storage.put("gameState", this.gameState);
    else await this.ctx.storage.delete("gameState");
  }
  private async persistRoom() {
    await this.persistMeta();
    await this.persistGame();
  }

  private memberIdx(pid: string) { return this.members.findIndex((m) => m.id === pid); }
  private pendingIdx(pid: string) { return this.pending.findIndex((p) => p.id === pid); }
  private livePids(excludeConnId?: string) {
    return new Set(
      [...this.getConnections<ConnState>()]
        .filter((c) => c.id !== excludeConnId)
        .flatMap((c) => c.state?.pids?.length ? c.state.pids : (c.state?.pid ? [c.state.pid] : []))
        .filter((pid): pid is string => !!pid)
    );
  }
  private reassignHostIfGone(excludeConnId?: string) {
    if (!this.hostId) return;
    const live = this.livePids(excludeConnId);
    if (live.has(this.hostId)) return;
    const nextConnected = this.members.find((m) => !m.bot && live.has(m.id));
    if (nextConnected) { this.hostId = nextConnected.id; return; }
    if (!this.gameId) this.hostId = this.members.find((m) => !m.bot)?.id ?? this.members[0]?.id ?? null;
  }

  private controlledPids(conn: Connection<ConnState>): string[] {
    const pids = conn.state?.pids?.length ? conn.state.pids : (conn.state?.pid ? [conn.state.pid] : []);
    return pids.filter((pid, i) => !!pid && pids.indexOf(pid) === i);
  }
  private controlledSeats(conn: Connection<ConnState>): number[] {
    return this.controlledPids(conn).map((pid) => this.memberIdx(pid)).filter((i) => i >= 0);
  }
  private primarySeatFor(conn: Connection<ConnState>): number {
    const seats = this.controlledSeats(conn);
    if (!seats.length) return -1;
    if (this.gameId && this.gameState) {
      const g = getGame(this.gameId)!;
      const view = g.viewFor(this.gameState, -1);
      const vs = view.state;
      if (vs) {
        // Simultaneous-turn games: pick the first controlled seat that can act
        if (vs.currentSeat < 0 && vs.actingCount && vs.actingCount > 1) {
          const actSeat = seats.find((i) => vs.players?.[i]?.status === "active");
          if (actSeat != null) return actSeat;
        }
        // Standard turn-based: use the currentSeat
        if (vs.currentSeat >= 0 && seats.includes(vs.currentSeat)) return vs.currentSeat;
      }
    }
    return seats[0];
  }

  // Is `seat` allowed to act in the current game right now? Uses the game's
  // standardized GameViewState so this stays game-agnostic. Turn-based games
  // expose currentSeat; simultaneous-turn games mark actable seats "active".
  // This gates host-driven BOT moves (S1): a host may only puppet a bot when it
  // is genuinely that bot's turn — it can't fire arbitrary out-of-turn actions
  // for bot seats. The game's applyAction remains the final rule authority.
  private isSeatActable(seat: number): boolean {
    if (seat < 0) return false;
    if (!this.gameId || !this.gameState) return false;
    const g = getGame(this.gameId);
    const vs = g?.viewFor(this.gameState, -1).state;
    if (!vs) return true; // game doesn't expose turn info → defer to applyAction
    if (vs.currentSeat >= 0) return vs.currentSeat === seat;
    // Simultaneous-turn game: the seat must be currently active.
    return vs.players?.[seat]?.status === "active";
  }

  // Token-bucket rate limit per connection. Returns false when the connection
  // has exceeded its budget and the message should be dropped.
  private allowMessage(conn: Connection<ConnState>): boolean {
    const now = Date.now();
    let b = this.rateBuckets.get(conn.id);
    if (!b) { b = { tokens: RATE_BURST, last: now }; this.rateBuckets.set(conn.id, b); }
    b.tokens = Math.min(RATE_BURST, b.tokens + ((now - b.last) / 1000) * RATE_REFILL_PER_SEC);
    b.last = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  // Re-arm the single alarm to the soonest of: pending game tick, idle close.
  private armAlarm() {
    const idleAt = this.lastActivity + IDLE_MS;
    const next = this.tickAt ? Math.min(this.tickAt, idleAt) : idleAt;
    this.ctx.storage.setAlarm(next);
  }
  private touch() { this.lastActivity = Date.now(); this.armAlarm(); }
  private log(entry: Omit<ReplayEntry, "seq" | "t">) { this.actionLog = appendReplay(this.actionLog, entry); }
  private debugSnapshot() {
    return {
      code: this.name,
      now: Date.now(),
      liveConnections: [...this.getConnections()].length,
      members: this.members.map((m, seat) => ({ seat, id: m.id, name: m.name, bot: !!m.bot, difficulty: m.difficulty })),
      pending: this.pending,
      hostId: this.hostId,
      isPublic: this.isPublic,
      quickGame: this.quickGame,
      maxPlayers: this.maxPlayers,
      lastActivity: this.lastActivity,
      idleMs: Date.now() - this.lastActivity,
      gameId: this.gameId,
      tickAt: this.tickAt,
      game: summarizeGameState(this.gameId, this.gameState),
      replay: this.actionLog,
    };
  }

  async onRequest(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === "/debug") return Response.json(this.debugSnapshot());
    if (url.pathname === "/replay") return Response.json({ code: this.name, replay: this.actionLog });
    return Response.json({ ok: true, room: this.name });
  }

  async onAlarm() {
    const now = Date.now();
    // 1) run a due game tick
    if (this.tickAt && now >= this.tickAt - 50 && this.gameId && this.gameState) {
      this.tickAt = null;
      const g = getGame(this.gameId);
      if (g?.completeTick) {
        g.completeTick(this.gameState);
        this.log({ kind: "tick", gameId: this.gameId });
      }
      this.scheduleTick();        // a tick may queue another (e.g. chained turn-ends)
      await this.persistRoom();
      this.broadcastState();
    }
    // 2) idle / empty close
    const live = [...this.getConnections()].length;
    const idle = now - this.lastActivity >= IDLE_MS;
    if (live === 0 || idle) {
      try { await this.lobbyUpdate(true); } catch {}
      for (const c of this.getConnections()) { try { c.close(4000, "Room closed (inactive)."); } catch {} }
      await this.ctx.storage.deleteAll();
      this.members = []; this.pending = []; this.gameId = null; this.gameState = null; this.tickAt = null;
      return;
    }
    this.armAlarm();
  }

  // Ask the active game if it wants a deferred tick, and schedule the alarm.
  private scheduleTick() {
    this.tickAt = null;
    if (this.gameId && this.gameState) {
      const g = getGame(this.gameId);
      if (g?.tick) {
        const delay = g.tick(this.gameState);
        if (delay != null) this.tickAt = Date.now() + delay;
      }
    }
    this.armAlarm();
  }

  /* ---- Lobby discovery (only called on membership/status change) ---- */
  private async lobbyUpdate(remove = false) {
    if (!this.isPublic) return;
    try {
      const lobby = await getServerByName(this.env.Lobby, LOBBY_SINGLETON);
      await lobby.fetch("https://lobby/u", {
        method: "POST",
        body: JSON.stringify({
          action: remove ? "remove" : "update",
          code: this.name,
          hostName: this.members.find((m) => m.id === this.hostId)?.name ?? "?",
          players: this.members.length + this.pending.length,
          maxPlayers: this.maxPlayers,
          gameId: this.quickGame ?? this.gameId,   // what they're playing/queuing for
          inGame: !!this.gameId,
        }),
      });
    } catch {}
  }

  /* ---- State broadcast (personalized per connection) ----
     viewFor() is computed at most once per seat per broadcast and shared across
     every connection that controls that seat. Previously each connection
     recomputed its seats' views plus an extra "primary" view, making a single
     action O(connections × seats) view builds; now it is O(distinct seats). */
  private broadcastState() {
    // Per-broadcast memo: seat -> serialized GameView (and -1 for the spectator view).
    const viewCache = new Map<number, unknown>();
    const g = this.gameId && this.gameState ? getGame(this.gameId)! : null;
    const viewOf = (s: number) => {
      if (!g) return undefined;
      if (!viewCache.has(s)) viewCache.set(s, g.viewFor(this.gameState, s));
      return viewCache.get(s);
    };
    // The bot manifest is identical for every connection; build it once.
    const bots = g
      ? this.members.map((m, i) => (m.bot ? { seat: i, difficulty: m.difficulty } : null)).filter(Boolean)
      : null;
    for (const conn of this.getConnections<ConnState>()) this.sendTo(conn, viewOf, bots);
  }
  private sendTo(
    conn: Connection<ConnState>,
    viewOf?: (s: number) => unknown,
    bots?: unknown,
  ) {
    const pids = this.controlledPids(conn);
    const seat = this.primarySeatFor(conn);
    const isHost = pids.includes(this.hostId || "");
    if (this.gameId && this.gameState) {
      const g = getGame(this.gameId)!;
      // Allow direct calls (e.g. onConnect) without a prebuilt cache.
      const view = viewOf ?? ((s: number) => g.viewFor(this.gameState, s));
      const botList = bots ?? this.members.map((m, i) => (m.bot ? { seat: i, difficulty: m.difficulty } : null)).filter(Boolean);
      const seats = this.controlledSeats(conn);
      conn.send(JSON.stringify({
        type: "game",
        isHost,
        controlledSeats: seats,
        views: seats.map((s) => ({ seat: s, view: view(s) })),
        // seats that are bots + their difficulty, so the HOST can drive them
        bots: botList,
        view: view(seat),
      }));
    } else {
      conn.send(JSON.stringify({
        type: "room",
        isHost,
        code: this.name,
        isPublic: this.isPublic,
        quickGame: this.quickGame,
        maxPlayers: this.maxPlayers,
        catalogue: GAME_CATALOGUE,
        members: this.members.map((m) => ({ id: m.id, name: m.name, bot: !!m.bot, difficulty: m.difficulty })),
      }));
    }
  }

  onConnect(conn: Connection<ConnState>, _ctx: ConnectionContext) {
    if (!SAFE_ROOM_CODE.test(this.name)) {
      try { conn.close(1008, "Bad room code."); } catch {}
      return;
    }
    this.armAlarm();
    conn.send(JSON.stringify({ type: "hello" }));
  }

  async onMessage(conn: Connection<ConnState>, raw: string) {
    // Drop floods before doing any parsing/work (S3). Auto-response ping/pong
    // frames never reach here, so this only bounds real client messages.
    if (!this.allowMessage(conn)) return;
    const msg = parseClientMessage(raw as string);
    if (!msg) return;

    /* ---- join / reconnect ---- */
    if (msg.type === "join") {
      if (!SAFE_ROOM_CODE.test(this.name)) { try { conn.close(1008, "Bad room code."); } catch {} return; }
      const seats = (msg.seats && msg.seats.length ? msg.seats : [{ pid: msg.pid, name: msg.name }]).slice(0, 8);
      const pids = seats.map((s: any) => s.pid);
      conn.setState({ pid: pids[0], pids });
      this.touch();

      for (const seatInfo of seats) {
        const pid: string = seatInfo.pid;
        const name: string = (seatInfo.name || "Player").slice(0, 20);
        const mi = this.memberIdx(pid);
        if (mi >= 0) {
          this.members[mi].name = name;
        } else if (this.gameId) {
          if (this.pendingIdx(pid) < 0 && this.members.length + this.pending.length < this.maxPlayers) {
            this.pending.push({ id: pid, name });
            conn.send(JSON.stringify({ type: "spectating", message: "Game in progress — you'll join next round." }));
          } else if (this.members.length + this.pending.length >= this.maxPlayers) {
            conn.send(JSON.stringify({ type: "room_full", message: "Room is full." }));
            return;
          }
        } else {
          if (this.members.length === 0) {
            this.hostId = pid;
            this.isPublic = !!msg.isPublic;
            this.quickGame = msg.quickGame ?? null;
            this.maxPlayers = Math.max(2, Math.min(8, msg.maxPlayers || 8));
          }
          if (this.members.length >= this.maxPlayers) { conn.send(JSON.stringify({ type: "room_full", message: "Room is full." })); return; }
          this.members.push({ id: pid, name });
        }
        this.log({ kind: "join", actor: pid, gameId: this.gameId, detail: { name, seat: this.memberIdx(pid), pending: this.pendingIdx(pid) >= 0 } });
      }
      await this.persistMeta();
      await this.lobbyUpdate();
      this.broadcastState();

      // Quick-play auto-start: once enough solos are waiting, begin.
      if (this.quickGame && !this.gameId) await this.maybeQuickStart();
      return;
    }

    const pid = conn.state?.pid;
    const pids = this.controlledPids(conn);
    if (!pid || !pids.length) return;
    const isHost = pids.includes(this.hostId || "");
    const seat = this.memberIdx(pid);

    /* ---- host: add / remove a bot (only between games) ---- */
    if (msg.type === "add_bot" && isHost && !this.gameId) {
      if (this.members.length < this.maxPlayers) {
        const diff = ["easy", "medium", "hard"].includes(msg.difficulty) ? msg.difficulty : "medium";
        const n = this.members.filter((m) => m.bot).length + 1;
        const names = ["Botley", "Chip", "Ada", "Turing", "Pixel", "Nova", "Echo", "Zar"];
          this.members.push({ id: "bot_" + Math.random().toString(36).slice(2, 8), name: (names[n - 1] || "Bot " + n) + " 🤖", bot: true, difficulty: diff });
        this.log({ kind: "add_bot", actor: pid, detail: { difficulty: diff } });
        await this.persistMeta(); await this.lobbyUpdate(); this.broadcastState();
      }
      return;
    }
    if (msg.type === "remove_bot" && isHost && !this.gameId) {
      const idx = this.members.findIndex((m) => m.bot);
      if (idx >= 0) { const [bot] = this.members.splice(idx, 1); this.log({ kind: "remove_bot", actor: pid, detail: { bot: bot.name } }); await this.persistMeta(); await this.lobbyUpdate(); this.broadcastState(); }
      return;
    }

    /* ---- host: launch a game from the room lobby ---- */
    if (msg.type === "launch_game" && isHost && !this.gameId) {
      const err = this.startGame(msg.gameId);
      if (err) { conn.send(JSON.stringify({ type: "error", message: err })); return; }
      this.log({ kind: "launch_game", actor: pid, gameId: this.gameId, detail: { players: this.members.length } });
      await this.persistRoom(); await this.lobbyUpdate();
      this.broadcastState();
      return;
    }

    /* ---- host: next round / new game within the current game ---- */
    if (msg.type === "next_round" && isHost && this.gameId && this.gameState) {
      this.touch();
      const g = getGame(this.gameId)!;
      // Seat spectators at the game's fair join score, then advance.
      if (g.addPlayer) {
        const startScore = g.joinScore ? g.joinScore(this.gameState) : 0;
        for (const p of this.pending) {
          if (this.members.length >= this.maxPlayers) break;
          g.addPlayer(this.gameState, p.name, startScore);
          this.members.push({ id: p.id, name: p.name });
        }
        this.pending = [];
      }
      g.applyAction(this.gameState, seat, { action: "next_round" });
      this.log({ kind: "next_round", actor: pid, seat, gameId: this.gameId });
      this.scheduleTick();
      await this.persistRoom(); await this.lobbyUpdate();
      this.broadcastState();
      return;
    }

    /* ---- host: return to room lobby (keep the group together) ---- */
    if (msg.type === "to_room" && isHost) {
      this.log({ kind: "to_room", actor: pid, seat, gameId: this.gameId });
      this.gameId = null; this.gameState = null; this.tickAt = null;
      // absorb spectators into the group now that we're between games
      for (const p of this.pending) if (this.memberIdx(p.id) < 0 && this.members.length < this.maxPlayers) this.members.push(p);
      this.pending = [];
      await this.persistRoom(); await this.lobbyUpdate();
      this.broadcastState();
      return;
    }

    /* ---- gameplay action ---- */
    if (msg.type === "action" && this.gameId && this.gameState) {
      // Determine which seat is acting. The HOST may drive BOT seats on their behalf
      // (bots "think" on the host's client to keep server compute ~0).
      let actSeat = seat;
      if (msg.seat != null) {
        const requested = msg.seat | 0;
        if (this.controlledSeats(conn).includes(requested)) actSeat = requested;
        else { conn.send(JSON.stringify(actionRejected("You don't control that seat.", String(msg.action ?? "")))); return; }
      }
      if (msg.botSeat != null && isHost) {
        const bi = msg.botSeat | 0;
        // The host may only drive a BOT seat, and only when it is actually that
        // bot's turn to act (S1). This stops a malicious/modified host from
        // firing arbitrary out-of-turn moves on behalf of bot seats.
        if (this.members[bi] && this.members[bi].bot && this.isSeatActable(bi)) actSeat = bi;
        else { conn.send(JSON.stringify(actionRejected("Not that bot's turn.", String(msg.action ?? "")))); return; }
      }
      if (actSeat < 0) { conn.send(JSON.stringify(actionRejected("You are spectating.", String(msg.action ?? "")))); return; }
      this.touch();
      const g = getGame(this.gameId)!;
      g.applyAction(this.gameState, actSeat, msg);
      this.log({ kind: "action", actor: pid, seat: actSeat, gameId: this.gameId, action: msg.action, detail: msg.botSeat != null ? { botSeat: msg.botSeat } : undefined });
      this.scheduleTick();
      await this.persistRoom();
      this.broadcastState();
      return;
    }
  }

  private startGame(gameId: string): string | null {
    const g = getGame(gameId);
    if (!g) return "Unknown game.";
    if (this.members.length < g.meta.minPlayers) return `${g.meta.name} needs at least ${g.meta.minPlayers} players.`;
    if (this.members.length > g.meta.maxPlayers) return `${g.meta.name} supports at most ${g.meta.maxPlayers} players.`;
    this.touch();
    this.gameId = gameId;
    this.gameState = g.create(this.members.map((m) => m.name));
    this.scheduleTick();
    return null;
  }

  private async maybeQuickStart() {
    const g = this.quickGame ? getGame(this.quickGame) : null;
    if (!g) return;
    // Auto-start when we reach a comfortable size; host can start earlier.
    const target = Math.min(g.meta.maxPlayers, Math.max(g.meta.minPlayers, 3));
    if (this.members.length >= target) {
      this.startGame(this.quickGame!);
      await this.persistRoom(); await this.lobbyUpdate(); this.broadcastState();
    }
  }

  async onClose(conn: Connection<ConnState>) {
    this.rateBuckets.delete(conn.id);
    const closingPids = this.controlledPids(conn);
    if (!closingPids.length) return;
    for (const pid of closingPids) {
      const pi = this.pendingIdx(pid);
      if (pi >= 0) this.pending.splice(pi, 1);
    }

    // Between games, leaving frees your seat(s). Mid-game, seats are kept so you
    // can reconnect; the engine simply waits (host can advance turns).
    if (!this.gameId) {
      for (const pid of closingPids) {
        const mi = this.memberIdx(pid);
        if (mi >= 0) this.members.splice(mi, 1);
      }
    }
    if (this.hostId && closingPids.includes(this.hostId)) this.reassignHostIfGone(conn.id);
    await this.persistMeta();
    await this.lobbyUpdate(this.members.length === 0 && this.pending.length === 0);
    this.broadcastState();

    const live = [...this.getConnections()].filter((c) => c.id !== conn.id).length;
    if (live === 0) this.ctx.storage.setAlarm(Date.now() + EMPTY_GRACE_MS);
  }
}

/* ============================================================
   LOBBY — public/quick-play discovery (hibernates too)
   ============================================================ */
interface RoomInfo {
  code: string; hostName: string; players: number; maxPlayers: number;
  gameId: string | null; inGame: boolean; updatedAt: number;
}
const STALE_MS = 30_000;

export class Lobby extends Server<Env> {
  static options = { hibernate: true };
  rooms: Record<string, RoomInfo> = {};

  async onStart() {
    this.rooms = (await this.ctx.storage.get<Record<string, RoomInfo>>("rooms")) ?? {};
    try { this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong")); } catch {}
  }
  private prune() {
    const now = Date.now();
    for (const k in this.rooms) if (now - this.rooms[k].updatedAt > STALE_MS) delete this.rooms[k];
  }
  private list() {
    this.prune();
    return Object.values(this.rooms)
      .filter((r) => r.players < r.maxPlayers)
      .sort((a, b) => Number(a.inGame) - Number(b.inGame) || b.updatedAt - a.updatedAt);
  }
  async onRequest(req: Request) {
    if (req.method === "POST") {
      const url = new URL(req.url);
      // Room DOs call us with lobby.fetch("https://lobby/u", ...). Reject direct
      // public POSTs to the PartyServer route so strangers cannot forge lobby rows.
      if (url.hostname !== "lobby" || url.pathname !== "/u") return new Response("Forbidden", { status: 403 });
      const b = (await req.json()) as any;
      const code = cleanId(b.code);
      if (!code) return new Response("Bad room code", { status: 400 });
      if (b.action === "remove") delete this.rooms[code];
      else {
        const maxPlayers = cleanInt(b.maxPlayers, 2, 8) ?? 8;
        const players = cleanInt(b.players, 0, maxPlayers) ?? 1;
        const gameId = b.gameId == null ? null : cleanId(b.gameId);
        this.rooms[code] = {
          code, hostName: cleanName(b.hostName, "?"), players,
          maxPlayers, gameId: gameId && getGame(gameId) ? gameId : null, inGame: !!b.inGame, updatedAt: Date.now(),
        };
      }
      await this.ctx.storage.put("rooms", this.rooms);
      this.broadcast(JSON.stringify({ type: "rooms", rooms: this.list() }));
      return Response.json({ ok: true });
    }
    return Response.json({ rooms: this.list() });
  }
  onConnect(conn: Connection) {
    conn.send(JSON.stringify({ type: "rooms", rooms: this.list() }));
  }
}

/* ============================================================
   Worker entry
   ============================================================ */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/debug/room/")) {
      if (!env.DEBUG_TOKEN) return new Response("Debug disabled", { status: 404 });
      const supplied = url.searchParams.get("token") || request.headers.get("x-debug-token");
      if (supplied !== env.DEBUG_TOKEN) return new Response("Unauthorized", { status: 401 });
      const code = decodeURIComponent(url.pathname.slice("/debug/room/".length));
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) return new Response("Bad room code", { status: 400 });
      const room = await getServerByName(env.Room, code);
      return room.fetch("https://room/debug");
    }
    return (
      (await routePartykitRequest(request, env)) ||
      (await env.ASSETS.fetch(request)) ||
      new Response("Not Found", { status: 404 })
    );
  },
};
