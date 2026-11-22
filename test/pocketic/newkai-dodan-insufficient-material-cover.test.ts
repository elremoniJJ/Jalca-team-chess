import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the corrected Newkai Dodan insufficient-material draw
 * decision.
 *
 * The accepted change corrects WHEN the insufficient-material draw fires for a
 * Newkai Dodan cast: only when the resulting board is genuinely insufficient
 * material, and never when the spell had no board effect. The decision lives in
 * `ShieldResolution.burnAndPlay` (lib/shield-and-spell-resolution.mo): the
 * `insufficientMaterial` field is forced to `false` when the spell is Newkai
 * Dodan and no queen was destroyed or transformed, and otherwise runs
 * `ChessGame.isInsufficientMaterial` on the post-spell board. The public
 * `burnAndPlay` wrapper (mixins/shield-and-spell-resolution-api.mo) then calls
 * `concludeByInsufficientMaterial` only when that field is true.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `concludeByInsufficientMaterial` is an unimplemented stub. This file
 * calls the real public API on a freshly installed canister, so a stubbed
 * backend traps here instead of passing.
 *
 * What the replica CAN observe:
 *   - `concludeByInsufficientMaterial` is implemented and concludes the game as
 *     a draw with the `#InsufficientMaterial` end state, exactly the conclusion
 *     the corrected burn-and-play path delegates to;
 *   - the draw conclusion is a no-op once the game has already ended, so a
 *     stray call cannot overwrite a recorded result;
 *   - the pure `isInsufficientMaterialForSquares` rule keeps its verdicts, so
 *     the correction gates WHEN the rule is consulted, not the rule itself.
 *
 * What the replica CANNOT observe: the burn-and-play trigger itself. The burn
 * performs the real burn through the external ICRC-7 collection canister
 * (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica, so
 * `burnAndPlay` returns `#err("burn canister call trapped")` before any board
 * effect or insufficient-material check runs. The populated Newkai Dodan path
 * (a cast that transforms/destroys queens and then consults the rule) is
 * therefore NOT exercised here. See episode.coverageLimits.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

let pic: PocketIc | undefined;

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
});

afterAll(async () => {
  await pic?.tearDown();
});

/** Install a fresh canister and return its actor. */
async function freshActor(): Promise<_SERVICE> {
  if (pic === undefined) throw new Error("PocketIC not initialized");
  const { actor } = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  });
  return actor;
}

/**
 * Start a fresh game with two players (one per team) and return the assigned
 * Move_Maker principal. Two logins balance the teams and start the game.
 */
async function startGameWithMoveMaker(actor: _SERVICE): Promise<string> {
  await actor.login("newkai-draw-player-1", "Ada", [], { none: null });
  await actor.login("newkai-draw-player-2", "Bob", [], { none: null });
  const state = await actor.getGameState("newkai-draw-player-1");
  expect(state.moveMaker.length).toBe(1);
  return state.moveMaker[0];
}

it("concludes the game as an #InsufficientMaterial draw", async () => {
  const actor = await freshActor();
  await startGameWithMoveMaker(actor);

  // The corrected burn-and-play path calls this public method when the
  // post-spell board is genuinely insufficient material. Call it directly with
  // the canister's clock, exactly as the wrapper does.
  await actor.concludeByInsufficientMaterial(1_700_000_000_000_000_000n);

  // The live game state has moved to the draw phase with no winner.
  const state = await actor.getGameState("newkai-draw-player-1");
  expect(state.phase).toEqual({ Draw: null });
  expect(state.winner).toEqual([]);

  // The concluded record carries the #InsufficientMaterial end state and a
  // #Draw result — the same conclusion the normal move path produces.
  const record = await actor.getGameRecord();
  expect(record.concluded).toBe(true);
  expect(record.endState).toEqual([{ InsufficientMaterial: null }]);
  expect(record.result).toEqual([{ Draw: null }]);
});

it("treats a second insufficient-material conclusion after the game has ended as a no-op", async () => {
  const actor = await freshActor();
  await startGameWithMoveMaker(actor);

  await actor.concludeByInsufficientMaterial(1_700_000_000_000_000_000n);

  // A stray second call must not re-conclude or overwrite the recorded result:
  // the `#Playing` guard makes it a no-op.
  await actor.concludeByInsufficientMaterial(1_700_000_000_000_000_001n);

  const state = await actor.getGameState("newkai-draw-player-1");
  expect(state.phase).toEqual({ Draw: null });
  expect(state.winner).toEqual([]);

  const record = await actor.getGameRecord();
  expect(record.endState).toEqual([{ InsufficientMaterial: null }]);
  expect(record.result).toEqual([{ Draw: null }]);
});

it("keeps the pure insufficient-material rule's verdicts the correction gates on", async () => {
  const actor = await freshActor();

  // The correction changes only WHEN the spell path consults this rule; the
  // rule itself must keep its exact verdicts. A K vs K position is a draw...
  await expect(
    actor.isInsufficientMaterialForSquares([
      [4n, { King: null }, { White: null }],
      [60n, { King: null }, { Black: null }],
    ]),
  ).resolves.toBe(true);

  // ...while a queen on the board means mate is still possible, so the
  // corrected path must not fire the draw for a board that still has one.
  await expect(
    actor.isInsufficientMaterialForSquares([
      [4n, { King: null }, { White: null }],
      [3n, { Queen: null }, { White: null }],
      [60n, { King: null }, { Black: null }],
    ]),
  ).resolves.toBe(false);
});
