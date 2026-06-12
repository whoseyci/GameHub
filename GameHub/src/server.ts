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
import { MAX_LEGAL_ACTIONS } from "./games/types";
import { cleanId, cleanInt, cleanName, parseClientMessage } from "./protocol";
import { appendReplay, summarizeGameState, type ReplayEntry } from "./replay";
import {
  newReplayBundle, pushAction, freezeReplay, replayKey,
  REPLAY_INDEX_KEY, REPLAY_KEEP,
  type ReplayBundle, type ReplayIndexEntry,
} from "./replay-capture";
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
interface Member {
  id: string; name: string;
  bot?: boolean; difficulty?: string;
  // W6: per-member ready flag for quick-play / group lobbies. Defaults to
  // false; cleared back to false whenever a game ends. Auto-true for bots
  // (they're always ready). When ALL non-bot members are ready AND the
  // count is in the game's [min..max] range, maybeQuickStart() launches.
  ready?: boolean;
}
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
  // W6: a group is a persistent multi-game room hosted by one player. Group
  // rooms (public) appear in the lobby as "join the group" tiles rather than
  // "join the game" tiles. Variants pass through launch_game.
  isGroup = false;
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

  // ─── Replay capture (deterministic per-game bundles) ─────────────────
  // currentReplay holds the live capture while a game is in progress; it gets
  // frozen and persisted under `replay:<id>` once the game ends (or the room
  // returns to its lobby / starts a new game). `replayIndex` is the small
  // metadata list the public API uses to enumerate replays without scanning
  // storage. `replayCounter` is monotonic per-room and feeds the replay id.
  currentReplay: ReplayBundle | null = null;
  replayIndex: ReplayIndexEntry[] = [];
  replayCounter = 0;
  private actionSeq = 0; // monotonic action sequence per room, for replay events

  async onStart() {
    const m = await this.ctx.storage.get<any>("meta");
    if (m) {
      this.members = m.members ?? [];
      this.pending = m.pending ?? [];
      this.hostId = m.hostId ?? null;
      this.isPublic = m.isPublic ?? false;
      this.isGroup = m.isGroup ?? false;
      this.quickGame = m.quickGame ?? null;
      this.maxPlayers = m.maxPlayers ?? 8;
      this.lastActivity = m.lastActivity ?? Date.now();
      this.actionLog = m.actionLog ?? [];
      this.gameId = m.gameId ?? null;
      this.tickAt = m.tickAt ?? null;
      this.replayCounter = m.replayCounter ?? 0;
    }
    this.gameState = (await this.ctx.storage.get<any>("gameState")) ?? null;
    this.currentReplay = (await this.ctx.storage.get<ReplayBundle>("currentReplay")) ?? null;
    this.replayIndex = (await this.ctx.storage.get<ReplayIndexEntry[]>(REPLAY_INDEX_KEY)) ?? [];
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
      isPublic: this.isPublic, isGroup: this.isGroup, quickGame: this.quickGame, maxPlayers: this.maxPlayers,
      lastActivity: this.lastActivity, actionLog: this.actionLog,
      gameId: this.gameId, tickAt: this.tickAt,
      replayCounter: this.replayCounter,
    });
  }
  private async persistGame() {
    if (this.gameState) await this.ctx.storage.put("gameState", this.gameState);
    else await this.ctx.storage.delete("gameState");
  }
  private async persistReplay() {
    if (this.currentReplay) await this.ctx.storage.put("currentReplay", this.currentReplay);
    else await this.ctx.storage.delete("currentReplay");
    await this.ctx.storage.put(REPLAY_INDEX_KEY, this.replayIndex);
  }
  private async persistRoom() {
    await this.persistMeta();
    await this.persistGame();
    await this.persistReplay();
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
      members: this.members.map((m, seat) => ({ seat, id: m.id, name: m.name, bot: !!m.bot, difficulty: m.difficulty, ready: !!m.ready })),
      pending: this.pending,
      hostId: this.hostId,
      isPublic: this.isPublic,
      isGroup: this.isGroup,
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
    // ─── Public replay API (mounted by the Worker fetch handler) ───────
    // /replays         → small list { replays: ReplayIndexEntry[] }
    // /replays/<id>    → full bundle ReplayBundle (or 404)
    if (url.pathname === "/replays") {
      return Response.json({ code: this.name, replays: this.replayIndex });
    }
    if (url.pathname.startsWith("/replays/")) {
      const id = decodeURIComponent(url.pathname.slice("/replays/".length));
      // First check the live in-memory bundle (game still ongoing)
      if (this.currentReplay && this.currentReplay.id === id) {
        return Response.json(this.currentReplay, { headers: { "cache-control": "no-store" } });
      }
      const stored = await this.ctx.storage.get<ReplayBundle>(replayKey(id));
      if (!stored) return new Response("Replay not found", { status: 404 });
      return Response.json(stored, {
        headers: {
          // Frozen replays are immutable, so they're aggressively cacheable.
          "cache-control": stored.endedAt ? "public, max-age=86400, immutable" : "no-store",
        },
      });
    }
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
        // Capture the tick as a pseudo-action so client replay can drive it the
        // same way the server did. We use a synthetic action name the client's
        // replay player understands (it calls completeTick instead of applyAction).
        this.actionSeq += 1;
        if (this.currentReplay) pushAction(this.currentReplay, -1, { action: "__tick__" }, this.actionSeq);
        // Game might have ended on a tick — finalize so the replay is preserved.
        if (g.isOver(this.gameState) && this.currentReplay && !this.currentReplay.endedAt) {
          this.finalizeCurrentReplay();
        }
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
  /** Count humans + ready humans (used by ready-gating + lobby counters). */
  private humanCount() { return this.members.filter((m) => !m.bot).length; }
  private readyCount() { return this.members.filter((m) => !m.bot && m.ready).length; }

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
          humans: this.humanCount(),
          ready: this.readyCount(),
          maxPlayers: this.maxPlayers,
          gameId: this.quickGame ?? this.gameId,   // what they're playing/queuing for
          inGame: !!this.gameId,
          // W6: groups are persistent multi-game rooms hosted by one player.
          // For now we just propagate the visibility + host name; group-shard
          // routing happens later (see W6 part-2).
          isGroup: !!this.isGroup,
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
      if (!viewCache.has(s)) {
        const view: any = g.viewFor(this.gameState, s);
        // API-8: auto-attach legality hints for the viewer's seat when the
        // game opts in. Spectators (-1) get nothing. Capped so a buggy
        // legalActions() can never blow up the view payload.
        if (s >= 0 && g.legalActions && view && view.state) {
          try {
            const legal = g.legalActions(this.gameState, s) || [];
            view.state.legal = Array.isArray(legal) ? legal.slice(0, MAX_LEGAL_ACTIONS) : [];
          } catch (e) {
            console.warn(`legalActions(${this.gameId}, ${s}) threw:`, e);
            view.state.legal = [];
          }
        }
        viewCache.set(s, view);
      }
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
        // Shareable replay handle for the in-progress game (or the most recently
        // finished one, if we're between rounds). Lets the client surface a
        // "📺 Watch / share replay" button without an extra round-trip.
        replayId: this.currentReplay?.id ?? this.replayIndex[0]?.id ?? null,
        roomCode: this.name,
        // Seat → identity map (pid + name + bot flag). Powers the client-side
        // recent-players social graph: when a game ends, the client records
        // every non-bot opponent so it can suggest them next time. Only
        // public fields, identical to what's already in the 'room' broadcast.
        seats: this.members.map((m, i) => ({ seat: i, pid: m.id, name: m.name, bot: !!m.bot })),
      }));
    } else {
      conn.send(JSON.stringify({
        type: "room",
        isHost,
        code: this.name,
        isPublic: this.isPublic,
        isGroup: this.isGroup,
        quickGame: this.quickGame,
        maxPlayers: this.maxPlayers,
        catalogue: GAME_CATALOGUE,
        // W6: ready flag on each member so the client can render the ready-up
        // checklist in quick-play / group lobbies.
        members: this.members.map((m) => ({ id: m.id, name: m.name, bot: !!m.bot, difficulty: m.difficulty, ready: !!m.ready })),
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
            this.isGroup = !!msg.isGroup;
            this.quickGame = msg.quickGame ?? null;
            this.maxPlayers = Math.max(2, Math.min(8, msg.maxPlayers || 8));
          }
          if (this.members.length >= this.maxPlayers) { conn.send(JSON.stringify({ type: "room_full", message: "Room is full." })); return; }
          // W6: in quick-play rooms, the host is auto-ready (they joined
          // explicitly with intent to play). In persistent groups + custom
          // rooms, ready stays false so all members opt in deliberately.
          const autoReady = !!this.quickGame && pid === this.hostId;
          this.members.push({ id: pid, name, ready: autoReady });
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
        // W6: bots are always ready (they don't need to opt in).
        this.members.push({ id: "bot_" + Math.random().toString(36).slice(2, 8), name: names[n - 1] || "Bot " + n, bot: true, difficulty: diff, ready: true });
        this.log({ kind: "add_bot", actor: pid, detail: { difficulty: diff } });
        await this.persistMeta(); await this.lobbyUpdate(); this.broadcastState();
        if (this.quickGame) await this.maybeQuickStart();
      }
      return;
    }
    if (msg.type === "remove_bot" && isHost && !this.gameId) {
      const idx = this.members.findIndex((m) => m.bot);
      if (idx >= 0) { const [bot] = this.members.splice(idx, 1); this.log({ kind: "remove_bot", actor: pid, detail: { bot: bot.name } }); await this.persistMeta(); await this.lobbyUpdate(); this.broadcastState(); }
      return;
    }

    /* ---- W6: per-member ready toggle ---- */
    if (msg.type === "set_ready" && !this.gameId) {
      // Each connection may carry several seats (pass-and-play). Apply the
      // ready flag to every controlled seat the connection is asking about,
      // or to all of them if msg.seat is omitted.
      const controlled = this.controlledPids(conn);
      const targetPid = msg.pid && controlled.includes(String(msg.pid)) ? String(msg.pid) : null;
      const wanted = !!msg.ready;
      for (const m of this.members) {
        if (m.bot) continue;
        if (targetPid && m.id !== targetPid) continue;
        if (!targetPid && !controlled.includes(m.id)) continue;
        m.ready = wanted;
      }
      this.log({ kind: "set_ready", actor: pid, detail: { ready: wanted, pid: targetPid } });
      await this.persistMeta();
      // Lobby cares about ready counts; refresh the row so landing tiles
      // reflect "3 ready of 4 needed" live.
      if (this.isPublic) await this.lobbyUpdate();
      this.broadcastState();
      // If we hit the all-ready gate for a quick-play / group lobby, launch.
      if ((this.quickGame || this.isGroup) && this.canAllReadyStart()) {
        const launchGameId = this.quickGame || msg.gameId;
        if (launchGameId) this.startGame(launchGameId);
      }
      return;
    }

    /* ---- host: launch a game from the room lobby ---- */
    if (msg.type === "launch_game" && isHost && !this.gameId) {
      // W6: variant is an opt-in string the game module may read off
      // state.variant (e.g. "extreme" for a Skyjo Extreme rules set).
      // Validation is the game's job; we just pass through a sanitized
      // string. Games that don't implement variants ignore it.
      const variant = msg.variant ? cleanId(msg.variant) : null;
      const err = this.startGame(msg.gameId, variant || undefined);
      if (err) { conn.send(JSON.stringify({ type: "error", message: err })); return; }
      this.log({ kind: "launch_game", actor: pid, gameId: this.gameId, detail: { players: this.members.length, variant } });
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
      this.actionSeq += 1;
      if (this.currentReplay) pushAction(this.currentReplay, seat, { action: "next_round" }, this.actionSeq);
      this.log({ kind: "next_round", actor: pid, seat, gameId: this.gameId });
      this.scheduleTick();
      await this.persistRoom(); await this.lobbyUpdate();
      this.broadcastState();
      return;
    }

    /* ---- host: return to room lobby (keep the group together) ---- */
    if (msg.type === "to_room" && isHost) {
      this.log({ kind: "to_room", actor: pid, seat, gameId: this.gameId });
      // W6: clear all ready flags when returning to the room lobby so the
      // next game requires explicit re-opt-in. Bots stay ready.
      for (const m of this.members) if (!m.bot) m.ready = false;
      // Make sure the replay for the game just finished is preserved before
      // we drop the game state.
      if (this.currentReplay) this.finalizeCurrentReplay();
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
      this.actionSeq += 1;
      if (this.currentReplay) pushAction(this.currentReplay, actSeat, msg, this.actionSeq);
      this.log({ kind: "action", actor: pid, seat: actSeat, gameId: this.gameId, action: msg.action, detail: msg.botSeat != null ? { botSeat: msg.botSeat } : undefined });
      // If this action ended the game, freeze the replay capture so it's persisted
      // even if the host stays in the post-game screen for a long time.
      if (g.isOver(this.gameState) && this.currentReplay && !this.currentReplay.endedAt) {
        this.finalizeCurrentReplay();
      }
      this.scheduleTick();
      await this.persistRoom();
      this.broadcastState();
      return;
    }
  }

  private startGame(gameId: string, variant?: string): string | null {
    const g = getGame(gameId);
    if (!g) return "Unknown game.";
    if (this.members.length < g.meta.minPlayers) return `${g.meta.name} needs at least ${g.meta.minPlayers} players.`;
    if (this.members.length > g.meta.maxPlayers) return `${g.meta.name} supports at most ${g.meta.maxPlayers} players.`;
    this.touch();
    // If a previous replay was somehow left live (e.g. host launched a new game
    // without ending the prior cleanly), freeze and persist it first so we never
    // lose data — then start a fresh capture.
    if (this.currentReplay) this.finalizeCurrentReplay();
    this.gameId = gameId;
    this.gameState = g.create(this.members.map((m) => m.name));
    // W6: stash the chosen variant on state so the game module can branch on
    // it. Games that don't implement variants ignore the field; the platform
    // never enforces a variant catalogue (each module owns its own set).
    if (variant && this.gameState && typeof this.gameState === "object") {
      this.gameState.variant = variant;
    }
    this.actionSeq = 0;
    this.replayCounter += 1;
    this.currentReplay = newReplayBundle({
      roomCode: this.name,
      gameId,
      names: this.members.map((m) => m.name),
      bots: this.members.map((m) => !!m.bot),
      initialState: this.gameState,
      counter: this.replayCounter,
    });
    this.scheduleTick();
    return null;
  }

  /** Move the live replay into the persisted index, evicting old entries. */
  private finalizeCurrentReplay(): void {
    if (!this.currentReplay) return;
    const r = this.currentReplay;
    // Build a final summary from the game module if it provides one
    let summary: ReplayBundle["finalSummary"];
    try {
      const g = r.gameId && this.gameState ? getGame(r.gameId) : null;
      const v = g?.viewFor(this.gameState, -1);
      if (v?.summary) summary = { winners: v.summary.winners, rows: v.summary.rows };
    } catch { /* never let summary extraction throw */ }
    freezeReplay(r, summary);

    // Update the index (newest first)
    const indexEntry: ReplayIndexEntry = {
      id: r.id,
      gameId: r.gameId,
      names: r.names,
      createdAt: r.createdAt,
      endedAt: r.endedAt,
      actionCount: r.actions.length,
      winners: summary?.winners,
    };
    this.replayIndex = [indexEntry, ...this.replayIndex.filter((e) => e.id !== r.id)];

    // Async eviction: write the new bundle, drop any past the cap
    void this.ctx.storage.put(replayKey(r.id), r);
    while (this.replayIndex.length > REPLAY_KEEP) {
      const evicted = this.replayIndex.pop();
      if (evicted) void this.ctx.storage.delete(replayKey(evicted.id));
    }
    this.currentReplay = null;
  }

  /**
   * W6: returns true when this quick-play / group room can auto-launch the
   * pending game. The gate is:
   *   1. We have a game id (quickGame or, for groups, msg-supplied)
   *   2. Player count is in the game's [min..max] range
   *   3. EVERY human member has set ready=true (bots auto-ready)
   *   4. There's at least one human (no all-bot lobbies launching ghosts)
   */
  private canAllReadyStart(): boolean {
    const gid = this.quickGame; // group launches come through msg.gameId path
    if (!gid) return false;
    const g = getGame(gid);
    if (!g) return false;
    const n = this.members.length;
    if (n < g.meta.minPlayers || n > g.meta.maxPlayers) return false;
    const humans = this.humanCount();
    if (humans === 0) return false;
    return this.readyCount() === humans;
  }

  private async maybeQuickStart() {
    if (!this.canAllReadyStart()) return;
    this.startGame(this.quickGame!);
    await this.persistRoom(); await this.lobbyUpdate(); this.broadcastState();
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
  // W6: richer fields for landing-tile counts + ready-state visibility.
  humans?: number;      // non-bot member count
  ready?: number;       // how many humans have set ready=true
  isGroup?: boolean;    // persistent group room (vs ephemeral quick-play)
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
  /** W6: per-game aggregator for landing-tile counts. */
  private counts() {
    this.prune();
    const out: Record<string, { gameId: string; waiting: number; inGame: number; rooms: number; ready: number; humans: number }> = {};
    for (const r of Object.values(this.rooms)) {
      if (!r.gameId) continue;
      const slot = out[r.gameId] = out[r.gameId] || { gameId: r.gameId, waiting: 0, inGame: 0, rooms: 0, ready: 0, humans: 0 };
      slot.rooms += 1;
      const players = r.players || 0;
      if (r.inGame) slot.inGame += players;
      else slot.waiting += players;
      slot.humans += r.humans || 0;
      slot.ready += r.ready || 0;
    }
    return Object.values(out);
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
        const humans = cleanInt(b.humans, 0, maxPlayers) ?? players;
        const ready = cleanInt(b.ready, 0, humans) ?? 0;
        const gameId = b.gameId == null ? null : cleanId(b.gameId);
        this.rooms[code] = {
          code, hostName: cleanName(b.hostName, "?"), players,
          humans, ready,
          maxPlayers, gameId: gameId && getGame(gameId) ? gameId : null, inGame: !!b.inGame,
          isGroup: !!b.isGroup,
          updatedAt: Date.now(),
        };
      }
      await this.ctx.storage.put("rooms", this.rooms);
      // Broadcast both the legacy room list AND the per-game counts so the
      // landing can light up its tiles in real time without polling.
      const rooms = this.list();
      const counts = this.counts();
      this.broadcast(JSON.stringify({ type: "rooms", rooms, counts }));
      return Response.json({ ok: true });
    }
    return Response.json({ rooms: this.list(), counts: this.counts() });
  }
  onConnect(conn: Connection) {
    conn.send(JSON.stringify({ type: "rooms", rooms: this.list(), counts: this.counts() }));
  }
}

/* ============================================================
   Worker entry
   ============================================================ */
// Shared room-code validator (used by debug + public replay routes).
const VALID_CODE = /^[A-Za-z0-9_-]{1,64}$/;

// CORS headers for the public replay API — replays are read-only, public, and
// designed to be embedded/shared, so we allow cross-origin reads.
const REPLAY_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-max-age": "86400",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ─── Debug endpoint (token-gated) ─────────────────────────────────
    if (url.pathname.startsWith("/debug/room/")) {
      if (!env.DEBUG_TOKEN) return new Response("Debug disabled", { status: 404 });
      const supplied = url.searchParams.get("token") || request.headers.get("x-debug-token");
      if (supplied !== env.DEBUG_TOKEN) return new Response("Unauthorized", { status: 401 });
      const code = decodeURIComponent(url.pathname.slice("/debug/room/".length));
      if (!VALID_CODE.test(code)) return new Response("Bad room code", { status: 400 });
      const room = await getServerByName(env.Room, code);
      return room.fetch("https://room/debug");
    }

    // ─── Public replay API ────────────────────────────────────────────
    //   GET  /api/replays/<code>           → ReplayIndexEntry[]
    //   GET  /api/replay/<code>/<replayId> → ReplayBundle
    // Replays only contain public game state (no player IPs / private chat),
    // so no auth is required. Bundles are immutable, hence aggressively cached.
    if (url.pathname.startsWith("/api/replay")) {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: REPLAY_CORS });
      }
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405, headers: REPLAY_CORS });
      }
      const listMatch = url.pathname.match(/^\/api\/replays\/([^/]+)\/?$/);
      const oneMatch = url.pathname.match(/^\/api\/replay\/([^/]+)\/([^/]+)\/?$/);
      if (listMatch) {
        const code = decodeURIComponent(listMatch[1]);
        if (!VALID_CODE.test(code)) return new Response("Bad room code", { status: 400, headers: REPLAY_CORS });
        const room = await getServerByName(env.Room, code);
        const r = await room.fetch("https://room/replays");
        return new Response(r.body, { status: r.status, headers: { ...REPLAY_CORS, "content-type": "application/json" } });
      }
      if (oneMatch) {
        const code = decodeURIComponent(oneMatch[1]);
        const id = decodeURIComponent(oneMatch[2]);
        if (!VALID_CODE.test(code)) return new Response("Bad room code", { status: 400, headers: REPLAY_CORS });
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return new Response("Bad replay id", { status: 400, headers: REPLAY_CORS });
        const room = await getServerByName(env.Room, code);
        const r = await room.fetch(`https://room/replays/${encodeURIComponent(id)}`);
        const headers = new Headers(r.headers);
        for (const [k, v] of Object.entries(REPLAY_CORS)) headers.set(k, v);
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
        return new Response(r.body, { status: r.status, headers });
      }
      return new Response("Not Found", { status: 404, headers: REPLAY_CORS });
    }

    return (
      (await routePartykitRequest(request, env)) ||
      (await env.ASSETS.fetch(request)) ||
      new Response("Not Found", { status: 404 })
    );
  },
};
