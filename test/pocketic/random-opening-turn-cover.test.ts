import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Cover for the accepted opening-turn detection change, exercised against the
 * REAL canister through the generated declarations (no mock).
 *
 * Accepted behavior:
 *   - the opening turn is "no REAL move has been made since the opening
 *     finished", detected by comparing the recorder's move count against the
 *     number of moves the opening seeded (`openingMoveCount`), not against
 *     zero;
 *   - a Random opening pre-fills the recorder with its replay moves, so the
 *     first Move_Maker must STILL be treated as the opening Move_Maker: a
 *     non-Subao Ve burn is rejected with the opening-turn error and a Subao Ve
 *     burn is accepted;
 *   - a Standard opening (openingMoveCount 0) behaves exactly as before: the
 *     first Move_Maker's non-Subao Ve burn is rejected and a Subao Ve burn is
 *     accepted.
 *
 * The default vote is #Random, so a fresh game with no votes applies a Random
 * opening. `applyRandomOpening` picks one of 100 named openings at random and
 * may fall back to the Standard Starting Position on a replay failure, so the
 * test reads `openingMoveCount` from the snapshot and asserts the restriction
 * for whichever opening was actually applied — the seeded-move case is the
 * regression this change fixes, and the zero-seed case is the unchanged
 * Standard behavior.
 *
 * The frontend suite mocks the actor and cannot see any of this. A backend
 * whose `recordBurn` is an unimplemented stub would trap here rather than pass.
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
 * Move_Maker principal plus the opening snapshot. Two logins balance the teams
 * and start the game.
 */
async function startGameWithMoveMaker(actor: _SERVICE): Promise<{
  maker: string;
  openingMoveCount: bigint;
  openingName: string;
}> {
  await actor.login("random-open-player-1", "Ada", [], { none: null });
  await actor.login("random-open-player-2", "Bob", [], { none: null });
  const state = await actor.getGameState("random-open-player-1");
  expect(state.moveMaker.length).toBe(1);
  return {
    maker: state.moveMaker[0],
    openingMoveCount: state.openingMoveCount,
    openingName: state.openingName[0] ?? "",
  };
}

/**
 * Find a legal two-square pawn advance for the team to move, read from the
 * live board. A Random opening leaves a non-standard position, so the move is
 * computed from the board rather than hard-coded. Returns [from, to] square
 * indices.
 */
async function legalPawnAdvance(
  actor: _SERVICE,
  principal: string,
): Promise<[bigint, bigint]> {
  const state = await actor.getGameState(principal);
  const isWhiteTurn = "White" in state.turn;
  // White pawns start on rank 1 (indices 8..15), Black on rank 6 (48..55).
  const startRank = isWhiteTurn ? 1 : 6;
  const pawnColor = isWhiteTurn ? "White" : "Black";
  for (let file = 0; file < 8; file += 1) {
    const from = startRank * 8 + file;
    const cell = state.board[from];
    if (cell === undefined || cell.length === 0) continue;
    const piece = cell[0];
    if (piece === undefined) continue;
    if (!("Pawn" in piece.pieceType)) continue;
    if (!(pawnColor in piece.color)) continue;
    const to = isWhiteTurn ? from + 16 : from - 16;
    return [BigInt(from), BigInt(to)];
  }
  throw new Error("no legal opening pawn advance found");
}

it("rejects a non-Subao Ve burn from the opening Move_Maker under a Random opening", async () => {
  const actor = await freshActor();
  const { maker, openingMoveCount } = await startGameWithMoveMaker(actor);

  // The default vote is #Random, so the opening seeded replay moves into the
  // recorder. The opening-turn check must compare the recorder's move count
  // against that seeded count, so the first Move_Maker is still the opening
  // Move_Maker even though the recorder is not empty.
  expect(openingMoveCount).toBeGreaterThan(0n);

  const result = await actor.recordBurn(maker, {
    spellName: "Minor Spell",
    gameNumber: 3n,
    category: { Minor: null },
  });
  expect(result).toEqual({
    err: "The first turn only allows burning a Subao Ve spell",
  });
  // A rejected burn must not flip the per-turn flag.
  const burnState = await actor.getBurnState();
  expect(burnState.burnOccurredThisTurn).toBe(false);
});

it("accepts a Subao Ve burn from the opening Move_Maker under a Random opening", async () => {
  const actor = await freshActor();
  const { maker, openingMoveCount } = await startGameWithMoveMaker(actor);
  expect(openingMoveCount).toBeGreaterThan(0n);

  const result = await actor.recordBurn(maker, {
    spellName: "Subao Ve",
    gameNumber: 7n,
    category: { SubaoVe: null },
  });
  expect(result).toHaveProperty("ok");

  const burnState = await actor.getBurnState();
  expect(burnState.burnOccurredThisTurn).toBe(true);
});

it("rejects a non-Subao Ve burn from the opening Move_Maker under a Standard opening", async () => {
  const actor = await freshActor();
  // Vote Standard so the opening seeds no replay moves (openingMoveCount 0).
  await actor.login("std-open-player-1", "Ada", [], { none: null });
  await actor.castVote("std-open-player-1", {
    startingPosition: { Standard: null },
    spellUse: { On: null },
    turnDuration: { TwoMinutes: null },
  });
  await actor.login("std-open-player-2", "Bob", [], { none: null });

  const state = await actor.getGameState("std-open-player-1");
  expect(state.moveMaker.length).toBe(1);
  const maker = state.moveMaker[0];
  expect(state.openingMoveCount).toBe(0n);

  const result = await actor.recordBurn(maker, {
    spellName: "Minor Spell",
    gameNumber: 3n,
    category: { Minor: null },
  });
  expect(result).toEqual({
    err: "The first turn only allows burning a Subao Ve spell",
  });
  const burnState = await actor.getBurnState();
  expect(burnState.burnOccurredThisTurn).toBe(false);
});

it("accepts a Subao Ve burn from the opening Move_Maker under a Standard opening", async () => {
  const actor = await freshActor();
  await actor.login("std-ve-player-1", "Ada", [], { none: null });
  await actor.castVote("std-ve-player-1", {
    startingPosition: { Standard: null },
    spellUse: { On: null },
    turnDuration: { TwoMinutes: null },
  });
  await actor.login("std-ve-player-2", "Bob", [], { none: null });

  const state = await actor.getGameState("std-ve-player-1");
  expect(state.moveMaker.length).toBe(1);
  const maker = state.moveMaker[0];
  expect(state.openingMoveCount).toBe(0n);

  const result = await actor.recordBurn(maker, {
    spellName: "Subao Ve",
    gameNumber: 7n,
    category: { SubaoVe: null },
  });
  expect(result).toHaveProperty("ok");

  const burnState = await actor.getBurnState();
  expect(burnState.burnOccurredThisTurn).toBe(true);
});

it("allows a non-Subao Ve burn once a real move has been made after a Random opening", async () => {
  const actor = await freshActor();
  const { maker, openingMoveCount } = await startGameWithMoveMaker(actor);
  expect(openingMoveCount).toBeGreaterThan(0n);

  // A real move advances the recorder past the seeded count, so the opening
  // turn is over. The move rotates the Move_Maker to the other team, so
  // re-read the state to find the current maker.
  const [from, to] = await legalPawnAdvance(actor, "random-open-player-1");
  const move = await actor.attemptMove(maker, from, to, []);
  expect(move).toHaveProperty("ok");

  const state = await actor.getGameState("random-open-player-1");
  expect(state.moveMaker.length).toBe(1);
  const nextMaker = state.moveMaker[0];

  const result = await actor.recordBurn(nextMaker, {
    spellName: "Minor Spell",
    gameNumber: 3n,
    category: { Minor: null },
  });
  expect(result).toHaveProperty("ok");
});
