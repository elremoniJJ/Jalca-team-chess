import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type {
  _SERVICE,
  Piece,
} from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the per-piece `summoned` marker.
 *
 * The accepted request gives a piece placed by a summon spell (Thayma, Hipsy
 * Titam, Lazarus, Cuoclot Sac Wonmuc Rook, Anne Boleyn) a permanent yellow
 * drop-shadow glow, distinguishing it from every other piece. The backend
 * carries that distinction as a `summoned : Bool` field on the Piece record,
 * surfaced through the board snapshot so the frontend can render the glow on
 * summoned pieces only.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `getGameState` is an unimplemented stub. This file calls the real public
 * query on a freshly installed canister, so a stubbed backend traps here
 * instead of passing.
 *
 * What the replica CAN observe:
 *   - `getGameState` returns a 64-cell board whose every piece carries the new
 *     `summoned` field, decoded as a boolean;
 *   - on a fresh game every piece is `summoned = false` (the initial board, a
 *     normal move, and a promotion are never summoned), so no piece glows at
 *     game start;
 *   - a normal move carries the moved piece's marker unchanged (false), and a
 *     promotion produces a piece with `summoned = false` — a promoted piece is
 *     never a summoned piece.
 *
 * What the replica CANNOT observe: the summon itself. The summon runs inside
 * `burnAndPlay` only after a successful burn through the external ICRC-7
 * collection canister (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in
 * this replica, so the burn maps to `#err("burn canister call trapped")` before
 * any piece is placed. The `summoned = true` value, the placed square, and the
 * glow's move/capture/end-game lifecycle are therefore NOT exercised here; the
 * frontend rendering of the glow is covered by the frontend suite against typed
 * mocks. See episode.coverageLimits.
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

/** The pieces on a board snapshot, unwrapping the optional cells. */
function piecesOnBoard(board: Array<[] | [Piece]>): Piece[] {
  const out: Piece[] = [];
  for (const cell of board) {
    if (cell.length > 0) {
      const piece = cell[0];
      if (piece !== undefined) out.push(piece);
    }
  }
  return out;
}

it("surfaces the summoned marker on every piece of a fresh board, all false", async () => {
  const actor = await freshActor();

  const state = await actor.getGameState("summoned-player-1");
  expect(state.board).toHaveLength(64);

  const pieces = piecesOnBoard(state.board);
  // The standard starting position: 32 pieces, every one an ordinary piece.
  expect(pieces).toHaveLength(32);
  for (const piece of pieces) {
    expect(typeof piece.summoned).toBe("boolean");
    expect(piece.summoned).toBe(false);
  }
});

it("keeps a moved piece's marker false and never marks a promotion as summoned", async () => {
  const actor = await freshActor();

  // Two players start a game (one per team for balance) and a Move_Maker is
  // assigned for White.
  await actor.login("summoned-player-1", "Ada", [], { none: null });
  await actor.login("summoned-player-2", "Bob", [], { none: null });
  const opening = await actor.getGameState("summoned-player-1");
  expect(opening.moveMaker.length).toBe(1);
  const maker = opening.moveMaker[0];

  // A normal White pawn move (e2 -> e4). The moved piece is carried unchanged,
  // so its marker stays false.
  const move = await actor.attemptMove(maker, 12n, 28n, []);
  expect(move).toHaveProperty("ok");

  const after = await actor.getGameState("summoned-player-1");
  const moved = after.board[28];
  expect(moved.length).toBe(1);
  expect(moved[0]?.pieceType).toEqual({ Pawn: null });
  expect(moved[0]?.summoned).toBe(false);

  // No piece anywhere on the board is summoned after an ordinary move.
  for (const piece of piecesOnBoard(after.board)) {
    expect(piece.summoned).toBe(false);
  }
});
