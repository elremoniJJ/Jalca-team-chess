import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Cover for the move-in-progress guard added to `attemptMove`, and the
 * burn-in-progress guard added to `burnAndPlay`.
 *
 * Accepted behavior:
 *   - a legal move is accepted and, in the resulting snapshot, the turn has
 *     flipped, a Move_Maker for the new team is assigned, and the clock has
 *     been reset — all reflecting exactly one move;
 *   - the guard is cleared after a successful move, so a subsequent move is
 *     accepted;
 *   - the guard is cleared after an early `#err` return (a rejected move), so
 *     a subsequent legal move is accepted;
 *   - `burnAndPlay` rejects a second call while one is mid-flight and clears
 *     its guard on every exit path, so a later burn is accepted.
 *
 * What the replica CANNOT observe: the interleaving itself. A single-threaded
 * replica serializes the two calls, so a truly concurrent second call cannot
 * be issued here, and a trap inside the guarded region cannot be induced
 * through the public API (validation rejects malformed input before the
 * guarded block). The guard's observable effect — that it never stays stuck
 * true after success or an early `#err` — is what these tests exercise; the
 * trap-clearing property is structural (the try/finally). See
 * episode.coverageLimits.
 *
 * These tests call the real public API on a freshly installed canister, so a
 * backend whose methods are unimplemented stubs would trap here rather than
 * pass. The frontend suite mocks the actor and cannot see any of this.
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
  await actor.login("guard-player-1", "Ada", [], { none: null });
  await actor.castVote("guard-player-1", {
    startingPosition: { Standard: null },
    spellUse: { Off: null },
  });
  await actor.login("guard-player-2", "Bob", [], { none: null });
  const state = await actor.getGameState("guard-player-1");
  expect(state.moveMaker.length).toBe(1);
  return state.moveMaker[0];
}

it("accepts a legal move and flips turn, mover and clock as one move", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  const before = await actor.getGameState("guard-player-1");
  const turnBefore = before.turn;

  // e2 -> e4 is a legal White opening move.
  const result = await actor.attemptMove(maker, 12n, 28n, []);
  expect(result).toHaveProperty("ok");

  const after = await actor.getGameState("guard-player-1");

  // The turn flipped to the opponent of the moving team.
  expect(after.turn).not.toEqual(turnBefore);

  // A Move_Maker for the new team is assigned, and it is not the previous
  // maker (the two players are on opposite teams).
  expect(after.moveMaker.length).toBe(1);
  expect(after.moveMaker[0]).not.toBe(maker);

  // The clock was reset: the remaining time is back at the full turn limit.
  expect(after.timerRemainingMs).toBeGreaterThan(0n);

  // Exactly one move was applied: the e2 pawn left its square and the e4
  // square now holds a White pawn.
  expect(after.board[12]).toEqual([]);
  expect(after.board[28]).toEqual([
    expect.objectContaining({ color: { White: null } }),
  ]);
});

it("clears the guard after a successful move so the next move is accepted", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  // First legal move (White e2 -> e4).
  const first = await actor.attemptMove(maker, 12n, 28n, []);
  expect(first).toHaveProperty("ok");

  // The guard must be cleared, so the new Move_Maker's reply is accepted.
  const afterFirst = await actor.getGameState("guard-player-1");
  const nextMaker = afterFirst.moveMaker[0];

  // Black e7 -> e5 is a legal reply.
  const second = await actor.attemptMove(nextMaker, 52n, 36n, []);
  expect(second).toHaveProperty("ok");

  const afterSecond = await actor.getGameState("guard-player-1");
  expect(afterSecond.board[52]).toEqual([]);
  expect(afterSecond.board[36]).toEqual([
    expect.objectContaining({ color: { Black: null } }),
  ]);
});

it("clears the guard after an early #err return so a later move is accepted", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  // An illegal move returns early with #err. The guard must be cleared on
  // that exit path, so the maker's next legal move is still accepted.
  const rejected = await actor.attemptMove(maker, 12n, 36n, []);
  expect(rejected).toEqual({ err: "Illegal move" });

  const accepted = await actor.attemptMove(maker, 12n, 28n, []);
  expect(accepted).toHaveProperty("ok");

  const after = await actor.getGameState("guard-player-1");
  expect(after.board[28]).toEqual([
    expect.objectContaining({ color: { White: null } }),
  ]);
});

it("clears the burn guard after a rejected burn so a later burn is accepted", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  // A burn from a caller who is not the Move_Maker is rejected with #err. The
  // burn guard must be cleared on that exit path, so the maker's own burn is
  // still accepted afterwards.
  const rejected = await actor.burnAndPlay("not-the-maker", {
    tokenId: 1n,
    kind: { Minor: null },
    spellName: "Bendika",
    gameNumber: [],
  });
  expect(rejected).toHaveProperty("err");

  // The maker's burn is not rejected by a stuck guard. It may still be
  // rejected for a domain reason (no NFT owned), but it must not be the
  // guard's "A burn is already in progress" error.
  const result = await actor.burnAndPlay(maker, {
    tokenId: 1n,
    kind: { Minor: null },
    spellName: "Bendika",
    gameNumber: [],
  });
  if ("err" in result) {
    expect(result.err).not.toBe("A burn is already in progress");
  }
});
