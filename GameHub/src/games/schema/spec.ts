// games/schema/spec.ts — the declarative GameSpec for schema-defined games.
//
// A GameSpec is DATA (no code). makeSchemaGame() in ./engine.ts interprets it
// into a normal GameModule. v1 targets the press-your-luck / flip-and-score
// family (a generalised Flip 7 / can't-stop). See docs/GAME_SCHEMA.md.
//
// Keep this small + JSON-serializable: a spec must be expressible by the future
// visual editor and storable as data. No functions, no class instances.

export interface DeckEntry {
  /** Face value of the card. */
  value: number;
  /** How many copies of this value are in the bag. */
  count: number;
}

export interface GameSpec {
  /** kind discriminator — only "pressYourLuck" in v1. */
  kind: "pressYourLuck";
  meta: {
    id: string;            // stable, e.g. "septet"
    name: string;
    description: string;
    emoji: string;
    icon?: string;         // Phosphor icon name (preferred in UI)
    minPlayers: number;    // >= 2
    maxPlayers: number;    // <= 8
  };
  /** The bag of number cards, reshuffled each round. */
  deck: DeckEntry[];
  /** Lose-condition for a turn. "duplicate" = drawing a value you already hold. */
  bust: "duplicate";
  /** Optional instant bonus: collect `uniqueCount` distinct cards → +points, turn ends. */
  bonus?: { uniqueCount: number; points: number };
  /** How a kept hand scores. "sum" = sum of face values. */
  scoring: "sum";
  /** First player whose cumulative banked score reaches `target` triggers game end. */
  win: { target: number };
}

/** Bounds the spec so a hostile/buggy spec can't make the engine misbehave. */
export function validateSpec(spec: GameSpec): string[] {
  const errs: string[] = [];
  if (!spec || typeof spec !== "object") return ["spec is not an object"];
  if (spec.kind !== "pressYourLuck") errs.push(`unsupported kind: ${spec.kind}`);
  const m = spec.meta;
  if (!m || !/^[a-z0-9_-]{2,32}$/.test(m.id || "")) errs.push("meta.id must be 2-32 [a-z0-9_-]");
  if (!m?.name) errs.push("meta.name required");
  if (!(m && m.minPlayers >= 2 && m.maxPlayers <= 8 && m.minPlayers <= m.maxPlayers))
    errs.push("meta player counts must satisfy 2 <= min <= max <= 8");
  if (!Array.isArray(spec.deck) || !spec.deck.length) errs.push("deck must be a non-empty array");
  else {
    let total = 0;
    for (const d of spec.deck) {
      if (!Number.isFinite(d.value) || !Number.isInteger(d.count) || d.count < 1 || d.count > 200) {
        errs.push(`bad deck entry ${JSON.stringify(d)}`); break;
      }
      total += d.count;
    }
    if (total < 8) errs.push("deck must have at least 8 cards total");
    if (total > 1000) errs.push("deck too large (max 1000 cards)");
  }
  if (spec.bust !== "duplicate") errs.push(`unsupported bust: ${spec.bust}`);
  if (spec.scoring !== "sum") errs.push(`unsupported scoring: ${spec.scoring}`);
  if (spec.bonus && !(spec.bonus.uniqueCount >= 2 && Number.isFinite(spec.bonus.points)))
    errs.push("bad bonus");
  if (!spec.win || !(spec.win.target > 0)) errs.push("win.target must be > 0");
  return errs;
}
