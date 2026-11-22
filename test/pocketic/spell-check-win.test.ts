import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the spell-induced-check win conclusion.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a
 * canister whose `concludeBySpellCheck` is an unimplemented stub. This file
 * calls the real public API on a freshly installed canister, so a stubbed
 * backend traps here instead of passing.
 *
 * `concludeBySpellCheck` is the public seam the burn-and-play path invokes
 * when an offensive spell's board effect leaves the defending king in check.
 * The burn itself cannot succeed in this replica (the external ICRC-7
 * collection canister is absent), so the burn-and-play trigger is not
 * observable here — but the conclusion it delegates to is, and it is the
 * conclusion that carries the accepted behavior:
 *
 *   - the cast spell's name is recorded on both the live game state and the
 *     concluded game record (`spellWinName`);
 *   - the game concludes immediately as a win for the caster (phase
 *     `#Celebration`, winner set);
 *   - the stored end state is `#Checkmate` and the result is the caster's win,
 *     exactly as a normal checkmate — the "by spell" distinction is
 *     display-only;
 *   - the caster's normal move never happens: once the game is in
 *     `#Celebration`, `attemptMove` is rejected with "Game is not in
 *     progress";
 *   - a second `concludeBySpellCheck` after the game has ended is a no-op
 *     (the `#Playing` guard), so a stray call cannot overwrite the recorded
 *     spell name or re-conclude.
 *
 * What the replica CANNOT observe: the burn-and-play trigger itself (the
 * external collection canister is absent, so `burnAndPlay` returns
 * `#err("burn canister call trapped")` before any board effect or check
 * evaluation runs), and the escrow report (JEL's live canister is absent, so
 * `reportOutcomeToJel` maps the rejected call to a safe local outcome). The
 * escrow-facing `#Checkmate` result is asserted here only through the stored
 * recorder state, not through a real JEL call. See episode.coverageLimits.
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
  await actor.login("spell-win-player-1", "Ada", [], { none: null });
  await actor.login("spell-win-player-2", "Bob", [], { none: null });
  const state = await actor.getGameState("spell-win-player-1");
  expect(state.moveMaker.length).toBe(1);
  return state.moveMaker[0];
}

it("concludes a spell-induced check win as a #Checkmate win for the caster", async () => {
  const actor = await freshActor();
  await startGameWithMoveMaker(actor);

  // The burn-and-play path calls this public method when the spell's board
  // effect leaves the defending king in check. Call it directly with the
  // casting team and the cast spell's name.
  await actor.concludeBySpellCheck({ White: null }, "Bendika", 1_700_000_000_000_000_000n);

  // The live game state carries the display-only spell name and has moved to
  // the celebration phase as a win for the caster.
  const state = await actor.getGameState("spell-win-player-1");
  expect(state.spellWinName).toEqual(["Bendika"]);
  expect(state.phase).toEqual({ Celebration: null });
  expect(state.winner).toEqual([{ White: null }]);

  // The concluded record carries the same display-only marker, and the stored
  // end state and result are exactly a normal checkmate win for the caster.
  const record = await actor.getGameRecord();
  expect(record.concluded).toBe(true);
  expect(record.spellWinName).toEqual(["Bendika"]);
  expect(record.endState).toEqual([{ Checkmate: null }]);
  expect(record.result).toEqual([{ WhiteWin: null }]);
});

it("never lets the caster's normal move happen once the spell ends the game", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  await actor.concludeBySpellCheck({ White: null }, "Mayban Dadoy Tron", 1_700_000_000_000_000_000n);

  // The game is no longer #Playing, so the caster's normal move is rejected
  // rather than applied. e2 -> e4 is a legal opening move in a live game, so
  // the rejection is the phase guard, not move legality.
  const move = await actor.attemptMove(maker, 12n, 28n, []);
  expect(move).toEqual({ err: "Game is not in progress" });

  // The rejected move did not disturb the recorded conclusion.
  const record = await actor.getGameRecord();
  expect(record.spellWinName).toEqual(["Mayban Dadoy Tron"]);
  expect(record.endState).toEqual([{ Checkmate: null }]);
});

it("treats a second spell-check conclusion after the game has ended as a no-op", async () => {
  const actor = await freshActor();
  await startGameWithMoveMaker(actor);

  await actor.concludeBySpellCheck({ Black: null }, "Bendika", 1_700_000_000_000_000_000n);

  // A stray second call must not overwrite the recorded spell name or the
  // winner: the `#Playing` guard makes it a no-op.
  await actor.concludeBySpellCheck({ White: null }, "Bamburgh", 1_700_000_000_000_000_001n);

  const state = await actor.getGameState("spell-win-player-1");
  expect(state.spellWinName).toEqual(["Bendika"]);
  expect(state.winner).toEqual([{ Black: null }]);

  const record = await actor.getGameRecord();
  expect(record.spellWinName).toEqual(["Bendika"]);
  expect(record.result).toEqual([{ BlackWin: null }]);
  expect(record.endState).toEqual([{ Checkmate: null }]);
});
