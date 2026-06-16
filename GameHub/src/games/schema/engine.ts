// games/schema/engine.ts — dispatch a GameSpec (data) to the right interpreter,
// returning the hub's standard GameModule. No untrusted code is ever run: each
// engine only selects among audited, bounded behaviours. See docs/GAME_SCHEMA.md.
import type { GameModule } from "../types";
import type { GameSpec } from "./spec";
import { makePressYourLuckGame } from "./engine-pyl";
import { makeRollAndWriteGame } from "./engine-raw";

export function makeSchemaGame(spec: GameSpec): GameModule {
  if (spec && spec.kind === "pressYourLuck") return makePressYourLuckGame(spec);
  if (spec && spec.kind === "rollAndWrite") return makeRollAndWriteGame(spec);
  throw new Error(`Unsupported GameSpec kind: ${(spec as any)?.kind}`);
}
