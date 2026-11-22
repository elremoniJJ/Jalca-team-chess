import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the 12-spell burn-and-play board-effect wiring.
 *
 * The request adds two shared helpers (`findFirstEmptyFromCentre`,
 * `findFirstEnemyPiece`) and wires 12 spells into the burn-and-play path
 * (Bouvet Hondao re-pointed, Conu Bungno placement, and 10 enemy-removal
 * spells). The frontend suite mocks the actor, so it passes unchanged against
 * a canister whose `burnAndPlay` is an unimplemented stub. This file calls the
 * real public API on a freshly installed canister, so a stubbed backend traps
 * here instead of passing.
 *
 * What the replica CAN observe:
 *   - `burnAndPlay` is implemented and its new spell-name branches (Bouvet
 *     Hondao, Conu Bungno, and the enemy-removal spells such as Bamburgh)
 *     reach the burn path without trapping the canister;
 *   - a burn that fails at the external collection canister leaves the spell
 *     board state unchanged — no blocked square, no explosive trap, and no
 *     piece removal is observable through `getSpellBoardState`.
 *
 * What the replica CANNOT observe: the actual board mutation. `burnAndPlay`
 * performs the real burn through the external ICRC-7 collection canister
 * (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica, so the
 * burn step returns `#err("burn canister call trapped")` before any square is
 * blocked, any trap placed, or any piece removed. The populated-effect path
 * (a fired Bamburgh removing an enemy rook; a cancelled spell removing
 * nothing) is therefore NOT exercised here. See episode.coverageLimits.
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
 * Start a fresh game with two players and advance one legal White pawn move
 * (e2 -> e4) so the current Move_Maker may burn an offensive spell. Returns
 * the current Move_Maker principal.
 */
async function startGamePastOpening(actor: _SERVICE): Promise<string> {
  await actor.login("board-effect-player-1", "Ada", [], { none: null });
  await actor.login("board-effect-player-2", "Bob", [], { none: null });
  const opening = await actor.getGameState("board-effect-player-1");
  expect(opening.moveMaker.length).toBe(1);
  const move = await actor.attemptMove(opening.moveMaker[0], 12n, 28n, []);
  expect(move).toHaveProperty("ok");
  const state = await actor.getGameState("board-effect-player-1");
  expect(state.moveMaker.length).toBe(1);
  return state.moveMaker[0];
}

it("reaches the burn path for a Bamburgh enemy-removal spell without trapping", async () => {
  const actor = await freshActor();
  const maker = await startGamePastOpening(actor);

  // Bamburgh is one of the 10 enemy-removal spells wired into the
  // burn-and-play path. The external collection canister is absent from this
  // replica, so the burn maps to a per-token #err rather than trapping
  // JALCA's canister. This proves the new spell-name branch is wired and the
  // method is implemented; it does not prove the removal, which runs only
  // after a successful burn.
  const result = await actor.burnAndPlay(maker, {
    tokenId: 17n,
    kind: { Major: null },
    spellName: "Bamburgh",
    gameNumber: [1n],
  });
  expect(result).toEqual({ err: "burn canister call trapped" });

  // The failed burn must not have mutated the spell board: no blocked square,
  // no explosive trap, and no Balls colour.
  const view = await actor.getSpellBoardState();
  expect(view.blockedSquares).toEqual([]);
  expect(view.blockedSquareOwners).toEqual([]);
  expect(view.explosiveSquares).toEqual([]);
  expect(view.whiteBallsColour).toEqual([]);
  expect(view.blackBallsColour).toEqual([]);
});

it("reaches the burn path for the Conu Bungno and Bouvet Hondao placement spells without trapping", async () => {
  const actor = await freshActor();
  const maker = await startGamePastOpening(actor);

  // Conu Bungno (trap placement) and Bouvet Hondao (blocked square) are the
  // two placement spells wired into the burn-and-play path. Both must reach
  // the burn step rather than trapping on the new branch.
  const conu = await actor.burnAndPlay(maker, {
    tokenId: 20n,
    kind: { Minor: null },
    spellName: "Conu Bungno",
    gameNumber: [1n],
  });
  expect(conu).toEqual({ err: "burn canister call trapped" });

  // The one-burn-per-turn flag is only flipped by a successful burn, so a
  // second attempt in the same turn is still allowed to reach the burn path.
  const bouvet = await actor.burnAndPlay(maker, {
    tokenId: 18n,
    kind: { Minor: null },
    spellName: "Bouvet Hondao",
    gameNumber: [1n],
  });
  expect(bouvet).toEqual({ err: "burn canister call trapped" });

  // Neither failed burn placed a trap or blocked a square.
  const view = await actor.getSpellBoardState();
  expect(view.blockedSquares).toEqual([]);
  expect(view.explosiveSquares).toEqual([]);
});
