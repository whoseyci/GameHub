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
import { getGame, GAME_CATALOGUE, TICK_RUNNERS } from "./games/registry";

export interface Env {
  Room: DurableObjectNamespace<Room>;
  Lobby: DurableObjectNamespace<Lobby>;
  ASSETS: Fetcher;
  [key: string]: unknown;
}

export const LOBBY_SINGLETON = "public-lobby";
const IDLE_MS = 10 * 60 * 1000;       // close room after 10 min idle
const EMPTY_GRACE_MS = 45 * 1000;     // close shortly after everyone leaves

type ConnState = { pid?: string };
interface Member { id: string; name: string; }
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
      this.gameId = m.gameId ?? null;
      this.tickAt = m.tickAt ?? null;
    }
    this.gameState = (await this.ctx.storage.get<any>("gameState")) ?? null;
    // Auto-reply to pings without waking us for heavy work.
    try { this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong")); } catch {}
  }

  private async persistMeta() {
    await this.ctx.storage.put("meta", {
      members: this.members, pending: this.pending, hostId: this.hostId,
      isPublic: this.isPublic, quickGame: this.quickGame, maxPlayers: this.maxPlayers,
      lastActivity: this.lastActivity, gameId: this.gameId, tickAt: this.tickAt,
    });
  }
  private async persistGame() {
    if (this.gameState) await this.ctx.storage.put("gameState", this.gameState);
    else await this.ctx.storage.delete("gameState");
  }

  private memberIdx(pid: string) { return this.members.findIndex((m) => m.id === pid); }
  private pendingIdx(pid: string) { return this.pending.findIndex((p) => p.id === pid); }

  // Re-arm the single alarm to the soonest of: pending game tick, idle close.
  private armAlarm() {
    const idleAt = this.lastActivity + IDLE_MS;
    const next = this.tickAt ? Math.min(this.tickAt, idleAt) : idleAt;
    this.ctx.storage.setAlarm(next);
  }
  private touch() { this.lastActivity = Date.now(); this.armAlarm(); }

  async onAlarm() {
    const now = Date.now();
    // 1) run a due game tick
    if (this.tickAt && now >= this.tickAt - 50 && this.gameId && this.gameState) {
      this.tickAt = null;
      const runner = TICK_RUNNERS[this.gameId];
      if (runner) { runner(this.gameState); await this.persistGame(); }
      this.scheduleTick();        // a tick may queue another (e.g. chained turn-ends)
      await this.persistMeta();
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

  /* ---- State broadcast (personalized per connection) ---- */
  private broadcastState() {
    for (const conn of this.getConnections<ConnState>()) this.sendTo(conn);
  }
  private sendTo(conn: Connection<ConnState>) {
    const pid = conn.state?.pid;
    const seat = pid ? this.memberIdx(pid) : -1;
    if (this.gameId && this.gameState) {
      const g = getGame(this.gameId)!;
      conn.send(JSON.stringify({
        type: "game",
        isHost: pid === this.hostId,
        view: g.viewFor(this.gameState, seat),
      }));
    } else {
      conn.send(JSON.stringify({
        type: "room",
        isHost: pid === this.hostId,
        code: this.name,
        isPublic: this.isPublic,
        quickGame: this.quickGame,
        catalogue: GAME_CATALOGUE,
        members: this.members.map((m) => ({ id: m.id, name: m.name })),
      }));
    }
  }

  onConnect(conn: Connection<ConnState>, _ctx: ConnectionContext) {
    this.armAlarm();
    conn.send(JSON.stringify({ type: "hello" }));
  }

  async onMessage(conn: Connection<ConnState>, raw: string) {
    let msg: any; try { msg = JSON.parse(raw as string); } catch { return; }

    /* ---- join / reconnect ---- */
    if (msg.type === "join") {
      const pid: string = msg.pid;
      const name: string = (msg.name || "Player").slice(0, 20);
      conn.setState({ pid });
      this.touch();

      const mi = this.memberIdx(pid);
      if (mi >= 0) {
        this.members[mi].name = name; // reconnect
      } else if (this.gameId) {
        // game in progress -> spectate, queued for next game/round
        if (this.pendingIdx(pid) < 0 && this.members.length + this.pending.length < this.maxPlayers) {
          this.pending.push({ id: pid, name });
          conn.send(JSON.stringify({ type: "spectating", message: "Game in progress — you'll join next round." }));
        } else if (this.members.length + this.pending.length >= this.maxPlayers) {
          conn.send(JSON.stringify({ type: "error", message: "Room is full." }));
          return;
        }
      } else {
        if (this.members.length === 0) {
          this.hostId = pid;
          this.isPublic = !!msg.isPublic;
          this.quickGame = msg.quickGame ?? null;
          this.maxPlayers = msg.maxPlayers || 8;
        }
        if (this.members.length >= this.maxPlayers) { conn.send(JSON.stringify({ type: "error", message: "Room is full." })); return; }
        this.members.push({ id: pid, name });
      }
      await this.persistMeta();
      await this.lobbyUpdate();
      this.broadcastState();

      // Quick-play auto-start: once enough solos are waiting, begin.
      if (this.quickGame && !this.gameId) this.maybeQuickStart();
      return;
    }

    const pid = conn.state?.pid;
    if (!pid) return;
    const isHost = pid === this.hostId;
    const seat = this.memberIdx(pid);

    /* ---- host: launch a game from the room lobby ---- */
    if (msg.type === "launch_game" && isHost && !this.gameId) {
      this.startGame(msg.gameId);
      await this.persistMeta(); await this.persistGame(); await this.lobbyUpdate();
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
      this.scheduleTick();
      await this.persistMeta(); await this.persistGame(); await this.lobbyUpdate();
      this.broadcastState();
      return;
    }

    /* ---- host: return to room lobby (keep the group together) ---- */
    if (msg.type === "to_room" && isHost) {
      this.gameId = null; this.gameState = null; this.tickAt = null;
      // absorb spectators into the group now that we're between games
      for (const p of this.pending) if (this.memberIdx(p.id) < 0 && this.members.length < this.maxPlayers) this.members.push(p);
      this.pending = [];
      await this.persistMeta(); await this.persistGame(); await this.lobbyUpdate();
      this.broadcastState();
      return;
    }

    /* ---- gameplay action ---- */
    if (msg.type === "action" && this.gameId && this.gameState && seat >= 0) {
      this.touch();
      const g = getGame(this.gameId)!;
      g.applyAction(this.gameState, seat, msg);
      this.scheduleTick();
      await this.persistGame();
      this.broadcastState();
      return;
    }
  }

  private startGame(gameId: string) {
    const g = getGame(gameId);
    if (!g) return;
    if (this.members.length < g.meta.minPlayers) return;
    this.touch();
    this.gameId = gameId;
    this.gameState = g.create(this.members.map((m) => m.name));
    this.scheduleTick();
  }

  private maybeQuickStart() {
    const g = this.quickGame ? getGame(this.quickGame) : null;
    if (!g) return;
    // Auto-start when we reach a comfortable size; host can start earlier.
    const target = Math.min(g.meta.maxPlayers, Math.max(g.meta.minPlayers, 3));
    if (this.members.length >= target) {
      this.startGame(this.quickGame!);
      this.persistMeta(); this.persistGame(); this.lobbyUpdate(); this.broadcastState();
    }
  }

  async onClose(conn: Connection<ConnState>) {
    const pid = conn.state?.pid;
    if (!pid) return;
    const pi = this.pendingIdx(pid);
    if (pi >= 0) this.pending.splice(pi, 1);

    // Between games, leaving frees your seat. Mid-game, your seat is kept so you
    // can reconnect; the engine simply waits (host can advance turns).
    if (!this.gameId) {
      const mi = this.memberIdx(pid);
      if (mi >= 0) {
        this.members.splice(mi, 1);
        if (pid === this.hostId) this.hostId = this.members[0]?.id ?? null;
      }
    }
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
      const b = (await req.json()) as any;
      if (b.action === "remove") delete this.rooms[b.code];
      else this.rooms[b.code] = {
        code: b.code, hostName: b.hostName ?? "?", players: b.players ?? 1,
        maxPlayers: b.maxPlayers ?? 8, gameId: b.gameId ?? null, inGame: !!b.inGame, updatedAt: Date.now(),
      };
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
    return (
      (await routePartykitRequest(request, env)) ||
      (await env.ASSETS.fetch(request)) ||
      new Response("Not Found", { status: 404 })
    );
  },
};
