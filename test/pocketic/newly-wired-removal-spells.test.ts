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
 * Backend lane cover for the seven spells wired into the burn-and-play
 * board-effect path by this request:
 *   - Bendika (id 3) removes all remaining enemy Pawns;
 *   - Bendika Tah (id 4) removes all remaining Pawns of both colours;
 *   - Mayban Dadoy Tron (id 6) removes all remaining enemy Rooks;
 *   - Chila Cao (id 15) removes 1 random enemy Knight;
 *   - Handom Zitie Zumuc (id 16) removes 1 random enemy Bishop;
 *   - Bamburgh (id 17) removes 1 random enemy Rook;
 *   - Bouvet Hondao (id 18) permanently blocks one empty centre square.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `burnAndPlay` is an unimplemented stub. This file calls the real public
 * API on a freshly installed canister, so a stubbed backend traps here instead
 * of passing.
 *
 * What the replica CAN observe:
 *   - `burnAndPlay` is implemented and each of the seven new spell-name
 *     branches reaches the burn path without trapping the canister;
 *   - a burn that fails at the external collection canister leaves the board
 *     returned by `getGameState` unchanged — no piece is removed — and leaves
 *     the spell board state unchanged — no square is blocked;
 *   - the board read itself resolves with the expected 64-cell shape.
 *
 * What the replica CANNOT observe: the actual removal or block. `burnAndPlay`
 * performs the real burn through the external ICRC-7 collection canister
 * (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica, so the
 * burn step returns `#err("burn canister call trapped")` before
 * `removeAllPieces` / `removeEnemyPieces` / `blockBouvetHondao` runs. The
 * removal target and budget, the strict-exceed shield gate, the caster's-own-
 * pieces exclusion, and the centre-square choice are therefore NOT exercised
 * here; the static spell-table wording is covered by the frontend
 * characterization suite against typed mocks. See episode.coverageLimits.
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
  await actor.login("newly-wired-player-1", "Ada", [], { none: null });
  await actor.login("newly-wired-player-2", "Bob", [], { none: null });
  const opening = await actor.getGameState("newly-wired-player-1");
  expect(opening.moveMaker.length).toBe(1);
  const move = await actor.attemptMove(opening.moveMaker[0], 12n, 28n, []);
  expect(move).toHaveProperty("ok");
  const state = await actor.getGameState("newly-wired-player-1");
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

// The seven newly-wired spells with their burn kind and token id. The removal
// target/budget is not observable through the public API on this replica; see
// the file header.
const NEWLY_WIRED_SPELLS: Array<{
  id: bigint;
  name: string;
  kind: { Major: null } | { Minor: null };
}> = [
  { id: 3n, name: "Bendika", kind: { Major: null } },
  { id: 4n, name: "Bendika Tah", kind: { Major: null } },
  { id: 6n, name: "Mayban Dadoy Tron", kind: { Major: null } },
  { id: 15n, name: "Chila Cao", kind: { Minor: null } },
  { id: 16n, name: "Handom Zitie Zumuc", kind: { Minor: null } },
  { id: 17n, name: "Bamburgh", kind: { Minor: null } },
  { id: 18n, name: "Bouvet Hondao", kind: { Minor: null } },
];

it("reaches the burn path for each newly-wired spell without trapping", async () => {
  const actor = await freshActor();
  const maker = await startGamePastOpening(actor);

  // Each of the seven new spell-name branches must reach the burn step rather
  // than trapping on an unimplemented branch. The external collection canister
  // is absent from this replica, so the burn maps to a per-token #err. A failed
  // burn does not flip the one-burn-per-turn flag, so all seven can be
  // attempted in the same turn.
  for (const spell of NEWLY_WIRED_SPELLS) {
    const result = await actor.burnAndPlay(maker, {
      tokenId: spell.id,
      kind: spell.kind,
      spellName: spell.name,
      gameNumber: [1n],
    });
    expect(result, `${spell.name} should reach the burn path`).toEqual({
      err: "burn canister call trapped",
    });
  }
});

it("leaves the board and spell board unchanged when a newly-wired burn fails", async () => {
  const actor = await freshActor();
  const maker = await startGamePastOpening(actor);

  const before = await actor.getGameState("newly-wired-player-1");
  // The board is the 64-cell array getGameState returns.
  expect(before.board).toHaveLength(64);
  const blackPawnsBefore = countPieces(before.board, "Pawn", "Black");
  const whitePawnsBefore = countPieces(before.board, "Pawn", "White");
  const blackRooksBefore = countPieces(before.board, "Rook", "Black");
  const whiteRooksBefore = countPieces(before.board, "Rook", "White");
  expect(blackPawnsBefore).toBeGreaterThan(0);
  expect(blackRooksBefore).toBeGreaterThan(0);

  // Attempt the two "all remaining" removal spells and the block spell. Each
  // burn fails at the external canister, so no piece may leave the board and
  // no square may be blocked.
  for (const spell of [
    { id: 3n, name: "Bendika", kind: { Major: null } as const },
    { id: 4n, name: "Bendika Tah", kind: { Major: null } as const },
    { id: 6n, name: "Mayban Dadoy Tron", kind: { Major: null } as const },
    { id: 18n, name: "Bouvet Hondao", kind: { Minor: null } as const },
  ]) {
    const result = await actor.burnAndPlay(maker, {
      tokenId: spell.id,
      kind: spell.kind,
      spellName: spell.name,
      gameNumber: [1n],
    });
    expect(result).toEqual({ err: "burn canister call trapped" });
  }

  const after = await actor.getGameState("newly-wired-player-1");
  expect(countPieces(after.board, "Pawn", "Black")).toBe(blackPawnsBefore);
  expect(countPieces(after.board, "Pawn", "White")).toBe(whitePawnsBefore);
  expect(countPieces(after.board, "Rook", "Black")).toBe(blackRooksBefore);
  expect(countPieces(after.board, "Rook", "White")).toBe(whiteRooksBefore);

  // No failed burn blocked a square.
  const view = await actor.getSpellBoardState();
  expect(view.blockedSquares).toEqual([]);
  expect(view.blockedSquareOwners).toEqual([]);
});
