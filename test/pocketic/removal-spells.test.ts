import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type {
  _SERVICE,
  Piece,
  PieceType,
  Team,
} from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the five REMOVAL spells (ids 10-14: Tia Lua, Cau Lua,
 * Hoa Boc, Buc Tung Lua, Mua Lua) in the burn-and-play path.
 *
 * The request wires these five Minor fire spells so that, when one fires on the
 * board, up to N random enemy Pawns leave `gameState.board` (N = 1/2/3/4/5 for
 * ids 10/11/12/13/14). The frontend suite mocks the actor, so it passes
 * unchanged against a canister whose `burnAndPlay` is an unimplemented stub.
 * This file calls the real public API on a freshly installed canister, so a
 * stubbed backend traps here instead of passing.
 *
 * What the replica CAN observe:
 *   - `burnAndPlay` is implemented and each of the five removal spell names
 *     reaches the burn path without trapping the canister;
 *   - a burn that fails at the external collection canister leaves the board
 *     returned by `getGameState` unchanged — no pawn is removed;
 *   - the board read itself resolves with the expected 64-cell shape.
 *
 * What the replica CANNOT observe: the actual pawn removal. `burnAndPlay`
 * performs the real burn through the external ICRC-7 collection canister
 * (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica, so the
 * burn step returns `#err("burn canister call trapped")` before
 * `removeEnemyPieces` runs. The removal budget (N = 1..5), the strict-exceed
 * shield gate, the caster's-own-pieces exclusion, and the fewer-than-N
 * behaviour are therefore NOT exercised here; the static spell-table wording is
 * covered by the frontend characterization suite against typed mocks. See
 * episode.coverageLimits.
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
  await actor.login("removal-player-1", "Ada", [], { none: null });
  await actor.login("removal-player-2", "Bob", [], { none: null });
  const opening = await actor.getGameState("removal-player-1");
  expect(opening.moveMaker.length).toBe(1);
  const move = await actor.attemptMove(opening.moveMaker[0], 12n, 28n, []);
  expect(move).toHaveProperty("ok");
  const state = await actor.getGameState("removal-player-1");
  expect(state.moveMaker.length).toBe(1);
  return state.moveMaker[0];
}

/** Count the pieces of a given type and colour on the board. */
function countPieces(
  board: Array<[] | [Piece]>,
  pieceType: keyof PieceType,
  color: keyof Team,
): number {
  return board.filter((cell) => {
    if (cell.length === 0) return false;
    const piece = cell[0];
    return (
      piece !== undefined &&
      pieceType in (piece.pieceType as Record<string, unknown>) &&
      color in (piece.color as Record<string, unknown>)
    );
  }).length;
}

// The five removal spells with their token ids (the ids double as burn token
// ids here). The removal budget N = 1/2/3/4/5 is not observable through the
// public API on this replica; see the file header.
const REMOVAL_SPELLS: Array<{ id: bigint; name: string }> = [
  { id: 10n, name: "Tia Lua" },
  { id: 11n, name: "Cau Lua" },
  { id: 12n, name: "Hoa Boc" },
  { id: 13n, name: "Buc Tung Lua" },
  { id: 14n, name: "Mua Lua" },
];

it("reaches the burn path for each removal spell without trapping", async () => {
  const actor = await freshActor();
  const maker = await startGamePastOpening(actor);

  // Each of the five removal spell names must reach the burn step rather than
  // trapping on an unimplemented branch. The external collection canister is
  // absent from this replica, so the burn maps to a per-token #err. A failed
  // burn does not flip the one-burn-per-turn flag, so all five can be attempted
  // in the same turn.
  for (const spell of REMOVAL_SPELLS) {
    const result = await actor.burnAndPlay(maker, {
      tokenId: spell.id,
      kind: { Minor: null },
      spellName: spell.name,
      gameNumber: [1n],
    });
    expect(result, `${spell.name} should reach the burn path`).toEqual({
      err: "burn canister call trapped",
    });
  }
});

it("leaves the board unchanged when a removal spell's burn fails", async () => {
  const actor = await freshActor();
  const maker = await startGamePastOpening(actor);

  const before = await actor.getGameState("removal-player-1");
  // The board is the 64-cell array getGameState returns.
  expect(before.board).toHaveLength(64);
  const blackPawnsBefore = countPieces(before.board, "Pawn", "Black");
  const whitePawnsBefore = countPieces(before.board, "Pawn", "White");
  expect(blackPawnsBefore).toBeGreaterThan(0);

  // Attempt the largest removal spell. The burn fails at the external
  // canister, so no pawn may leave the board.
  const result = await actor.burnAndPlay(maker, {
    tokenId: 14n,
    kind: { Minor: null },
    spellName: "Mua Lua",
    gameNumber: [1n],
  });
  expect(result).toEqual({ err: "burn canister call trapped" });

  const after = await actor.getGameState("removal-player-1");
  expect(countPieces(after.board, "Pawn", "Black")).toBe(blackPawnsBefore);
  expect(countPieces(after.board, "Pawn", "White")).toBe(whitePawnsBefore);
});
