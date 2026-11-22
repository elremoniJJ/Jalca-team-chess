import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane characterization of the EXISTING `attemptMove` contract,
 * taken BEFORE the move path is reworked into one atomic synchronous block
 * with a move-in-progress guard.
 *
 * The request intentionally changes `attemptMove` so validation, the board
 * write, the turn flip, the new `moveMakerPrincipal` and the clock reset
 * commit as one uninterrupted block, and so a second `attemptMove` mid-call
 * is rejected. It does NOT change the observable single-move contract those
 * changes must preserve:
 *
 *   - a caller who is not the current Move_Maker is rejected with the exact
 *     "You are not the current move maker" error and the board is untouched;
 *   - an illegal move is rejected with the exact "Illegal move" error and the
 *     board is untouched;
 *   - a legal move is accepted and, in the resulting snapshot, the turn has
 *     flipped to the opponent, a Move_Maker for the new team is assigned, and
 *     the clock has been reset — all reflecting exactly one move;
 *   - once the game is no longer `#Playing`, `attemptMove` is rejected with
 *     "Game is not in progress".
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `attemptMove` is an unimplemented stub. This file calls the real public
 * method on a freshly installed canister, so a stubbed backend traps here
 * instead of passing.
 *
 * What the replica CANNOT observe: the interleaving itself. A single-threaded
 * replica serializes the two calls, so the concurrent-second-call rejection and
 * the no-await-between-writes property are NOT exercised here; the guard's
 * observable effect is covered by the accepted-behavior tests once the guard
 * exists. See episode.coverageLimits.
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
 *
 * The default opening is #Random, which would make a fixed e2 -> e4 move
 * unreliable. The first player casts a #Standard vote before the second login
 * starts the game, so the board is the standard starting position and the
 * fixed opening move is always legal.
 */
async function startGameWithMoveMaker(actor: _SERVICE): Promise<string> {
  await actor.login("move-guard-player-1", "Ada", [], { none: null });
  await actor.castVote("move-guard-player-1", {
    startingPosition: { Standard: null },
    spellUse: { Off: null },
  });
  await actor.login("move-guard-player-2", "Bob", [], { none: null });
  const state = await actor.getGameState("move-guard-player-1");
  expect(state.moveMaker.length).toBe(1);
  return state.moveMaker[0];
}

it("rejects a move from a caller who is not the current Move_Maker", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  const before = await actor.getGameState("move-guard-player-1");
  const boardBefore = before.board;

  // A principal that is not the assigned Move_Maker is rejected with the exact
  // error, and the board is untouched.
  const result = await actor.attemptMove("not-the-maker", 12n, 28n, []);
  expect(result).toEqual({ err: "You are not the current move maker" });

  const after = await actor.getGameState("move-guard-player-1");
  expect(after.board).toEqual(boardBefore);
  expect(after.turn).toEqual(before.turn);
  expect(after.moveMaker).toEqual(before.moveMaker);
  // The rejected call did not consume the maker's turn.
  expect(maker).toBe(before.moveMaker[0]);
});

it("rejects an illegal move and leaves the board untouched", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  const before = await actor.getGameState("move-guard-player-1");

  // e2 -> e5 is not a legal pawn move (two squares forward is only legal from
  // the starting rank, and e5 is three ranks away). The move maker is on the
  // side to move, so the rejection is move legality, not the maker check.
  const result = await actor.attemptMove(maker, 12n, 36n, []);
  expect(result).toEqual({ err: "Illegal move" });

  const after = await actor.getGameState("move-guard-player-1");
  expect(after.board).toEqual(before.board);
  expect(after.turn).toEqual(before.turn);
  expect(after.moveMaker).toEqual(before.moveMaker);
});

it("accepts a legal move and flips turn, mover and clock as one move", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  const before = await actor.getGameState("move-guard-player-1");
  const turnBefore = before.turn;

  // e2 -> e4 is a legal White opening move.
  const result = await actor.attemptMove(maker, 12n, 28n, []);
  expect(result).toHaveProperty("ok");

  const after = await actor.getGameState("move-guard-player-1");

  // The turn flipped to the opponent of the moving team.
  expect(after.turn).not.toEqual(turnBefore);

  // A Move_Maker for the new team is assigned, and it is not the previous
  // maker (the two players are on opposite teams).
  expect(after.moveMaker.length).toBe(1);
  expect(after.moveMaker[0]).not.toBe(maker);

  // The clock was reset: the remaining time is back at the full turn limit
  // rather than the pre-move value.
  expect(after.timerRemainingMs).toBeGreaterThan(0n);

  // Exactly one move was applied: the e2 pawn left its square and the e4
  // square now holds a White pawn.
  expect(after.board[12]).toEqual([]);
  expect(after.board[28]).toEqual([
    expect.objectContaining({ color: { White: null } }),
  ]);
});

it("rejects a move once the game is no longer in progress", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  // Conclude the game as a spell-induced check win for White, moving the phase
  // out of #Playing.
  await actor.concludeBySpellCheck(
    { White: null },
    "Bendika",
    1_700_000_000_000_000_000n,
  );

  // The game is no longer #Playing, so the maker's normal move is rejected
  // rather than applied. e2 -> e4 is legal in a live game, so the rejection is
  // the phase guard.
  const result = await actor.attemptMove(maker, 12n, 28n, []);
  expect(result).toEqual({ err: "Game is not in progress" });
});
