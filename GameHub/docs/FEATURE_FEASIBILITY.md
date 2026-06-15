# Feature Feasibility & Cost Assessment

> Scope: a *thorough assessment only* (no implementation) of four requested
> features against GameHub's current stack and the **Cloudflare free tier**.
> Date: 2026-06-15.

## Current stack (what we're building on)

- **Hosting:** Cloudflare Workers + **SQLite-backed Durable Objects** (`Room`,
  `Lobby`), `partyserver`, static assets served from `public/`.
- **Realtime:** WebSockets with **Hibernation enabled** (`static options =
  { hibernate: true }`) — idle rooms cost ~nothing; the DO sleeps and wakes on
  message. This is the single most important cost lever and we already use it.
- **Persistence:** `ctx.storage` (DO SQLite) for room meta, game state, replays.
- **Client:** vanilla JS in `public/js`, game engines in `src/games/*`,
  server-authoritative state machine.

## The Cloudflare free tier, in the numbers that matter here

| Limit | Free tier | Notes |
|---|---|---|
| Worker requests | **100,000 / day** | Page loads + asset fetches share this. WS upgrade = 1 request; messages over an open socket do **not** each cost a request. |
| CPU time / invocation | **10 ms** (free) | This is the scary one. Active compute only — **I/O wait is free**. Our game ticks are tiny; chat/emoji are trivial. Voice mixing would NOT fit. |
| DO SQLite storage | **5 GB / account, 1 GB / object** | Plenty for game state + chat history if we prune. |
| WebSocket msg size | 32 MiB received | Fine for text/JSON; irrelevant for our payloads. |
| External subrequests | **50 / invocation** | Matters only if we call 3rd-party APIs (e.g. a TURN/STT service for voice). |
| Worker script size | **3 MB** | A graphical builder's runtime + saved game defs must stay lean. |

Sources: Cloudflare DO limits, Workers free-plan limits (2026).

**Rule of thumb:** anything that is *event passing* (chat, emoji, presence) is
cheap and a great fit. Anything that is *continuous media or heavy compute*
(voice mixing, running arbitrary user code on the edge) fights the 10 ms CPU
limit and/or needs paid services.

---

## 1. Graphical game builder (players submit games; you edit layouts no-code)

**Two very different sub-features bundled here. Split them:**

### 1a. No-code **layout editor** for *existing* games (you rearrange/resize)
- **Difficulty: Medium.** **Cost: ~free.**
- We already have the right primitives: `renderTable` slots (opponents / center /
  focus / status), the **Kit.Fit** auto-scaler, the card-size CSS variables, and
  `--reel-size`-style knobs. A layout editor would be a **client-side** tool that
  edits a JSON "layout descriptor" (which slot each piece goes in, min/max scale,
  padding, opponent strip density) and the renderer reads that descriptor.
- No edge cost: it's UI + a small JSON blob saved per game (in `ctx.storage` or
  even the repo). CPU is trivial.
- Risk: our games currently hard-code their DOM in each `0X-*.js`. To make them
  *fully* layout-driven we'd refactor each game's render to emit "pieces" the
  layout engine places. That's the real work — call it 1–2 focused sprints to
  retrofit the 4 existing games to a declarative layout schema, then the editor
  itself is comparatively small.

### 1b. Players **submit whole new games** they built
- **Difficulty: High → Very High.** **Cost: low-to-real depending on approach.**
- The hard part isn't layout — it's the **rules engine**. A submitted game needs
  logic (turn order, legal moves, scoring). Options:
  - **(A) Data-only games** (no custom code): a constrained "game schema" that
    can only express variants of patterns we support (roll-and-mark, set-collect,
    flip-and-score). Safe, fits CPU, no sandboxing needed. **Most realistic.**
    Think "Qwixx-like with your own colors/rows" rather than "any board game".
  - **(B) Arbitrary user code on the edge:** running untrusted JS in our Worker
    is a **hard no** on free tier — the 10 ms CPU limit + security/sandboxing
    (you'd need isolates-in-isolates or a WASM sandbox) make this impractical and
    risky. Don't.
  - **(C) Submission + human review pipeline:** players submit a schema (A), it
    lands in a queue/table, **you** approve it in an admin view, approved games
    get added to the catalogue. Cheap, safe, and social. Good middle ground.
- **Recommendation:** do **1a** first (high value, reuses Kit.Fit), then a
  **schema-based** 1b (option A/C). Avoid arbitrary-code submissions entirely.

---

## 2. Text chat
- **Difficulty: Low.** **Cost: ~free and an excellent fit.**
- The `Room` DO already has every connection; a chat message is one `onMessage`
  branch that broadcasts to the room and (optionally) appends to a capped history
  in `ctx.storage` (e.g. last 100 messages, pruned). Messages over the existing
  open WebSocket **don't each cost a request**, and CPU per message is microscopic.
- Work: a message type, broadcast, a small in-room history, a client chat panel
  (we can reuse the preview-safe inline-style approach). Moderation = a basic
  profanity filter + rate limit (trivial, all in-DO).
- **Verdict:** the easiest, highest-ratio social feature. Strong yes.

---

## 3. Animated reaction emojis
- **Difficulty: Low.** **Cost: ~free, delightful, on-brand.**
- Same transport as chat: a tiny `{type:'react', emoji:'🎉', seat}` broadcast.
  The animation is **pure client CSS/JS** (we already have a particle/FX toolkit
  — see the jackpot confetti/sparks in `00-roller.js`), so the edge does almost
  nothing. Rate-limit per seat to prevent spam.
- Work: a reaction bar UI + a reusable "float/burst an emoji over the board"
  animation (generalize the jackpot FX). Could ship alongside chat in one sprint.
- **Verdict:** cheap, fun, very much in the game-feel direction. Strong yes.

---

## 4. Voice chat
- **Difficulty: High.** **Cost: the only one that likely needs $$ / 3rd-party.**
- Two architectures:
  - **(A) Peer-to-peer WebRTC (mesh):** browsers connect directly; our server
    only does **signaling** (exchange SDP/ICE over the existing WebSocket — cheap,
    fits free tier). BUT WebRTC needs **STUN/TURN** servers for NAT traversal.
    STUN is light; **TURN relays media and is bandwidth-heavy** — Cloudflare has
    *Cloudflare Calls / Realtime* (TURN + SFU) which is a separate, **paid/metered**
    product. Mesh also degrades past ~4–5 participants (every peer sends to every
    other peer).
  - **(B) SFU (server mixes/forwards streams):** scales better but means routing
    media — **not** something a 10 ms-CPU Worker does; you'd use Cloudflare
    Realtime SFU (paid) or an external provider (Daily, LiveKit, Agora).
- **Edge CPU reality:** Workers cannot mix/transcode audio (10 ms CPU, 128 MB,
  no long-lived media pipeline). So the Worker's only realistic job is
  **signaling**; the media path lives in WebRTC + TURN/SFU.
- **Verdict:** Feasible as *signaling-only over our existing WS* + **P2P WebRTC
  for ≤4 players**, with free STUN and a TURN fallback that will cost money under
  load. Beyond small rooms, you need a paid SFU. This is the most expensive and
  complex of the four — recommend it **last**, and only if there's demand.

---

## Suggested order (value ÷ cost ÷ risk)

1. **Text chat (#2)** — easiest, social backbone. ~free.
2. **Animated reaction emojis (#3)** — cheap, fun, reuses our FX kit. ~free.
3. **No-code layout editor (#1a)** — high value, reuses Kit.Fit; needs a render
   refactor to a declarative layout schema first.
4. **Schema-based community games (#1b, option A/C)** — powerful, safe; build on
   the layout schema + a human-review submission flow. **No arbitrary edge code.**
5. **Voice chat (#4)** — last; P2P+signaling for tiny rooms, paid SFU for scale.

> None of #2/#3 meaningfully threaten the free tier (event passing over an
> already-open, hibernating socket). #1 is mostly client work. #4 is the only one
> that structurally needs paid infrastructure for anything beyond a few players.
