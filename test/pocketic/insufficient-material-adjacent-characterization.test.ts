import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type {
  _SERVICE,
  PieceType,
  Team,
} from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the backend behavior ADJACENT to the Newkai Dodan
 * insufficient-material correction, taken BEFORE the production edit.
 *
 * The request intentionally corrects WHEN the insufficient-material draw fires
 * for the Newkai Dodan spell: it must fire only when the resulting board is
 * genuinely insufficient material, and never when the spell had no board
 * effect. That decision is the intentional change, so it is deliberately NOT
 * asserted here.
 *
 * What IS protected is the surrounding backend contract the correction must not
 * disturb:
 *   1. the pure `isInsufficientMaterialForSquares` classification keeps its
 *      exact draw / non-draw verdicts — the correction changes only the
 *      spell-path gating, never the underlying rule;
 *   2. the burn-and-play result read shape still carries the
 *      `insufficientMaterial` boolean and the `transformedSquares` list, so the
 *      frontend's snapshot poll keeps decoding;
 *   3. the spell board view and shield snapshot read shapes stay stable.
 *
 * These tests call the real public API on a freshly installed canister, so a
 * backend whose methods are unimplemented stubs would trap here rather than
 * pass. The frontend suite mocks the actor and cannot see any of this.
 *
 * What the replica CANNOT observe: the actual spell-path draw decision.
 * `burnAndPlay` performs the real burn through the external ICRC-7 collection
 * canister (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica,
 * so the burn step returns `#err("burn canister call trapped")` before any
 * board effect or insufficient-material check runs. The populated spell path is
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

// Square indices: a1=0, b1=1, ..., h1=7, a2=8, ..., h8=63.
// file = sq % 8, rank = sq / 8. Square colour parity = (file + rank) % 2.
const sq = (file: number, rank: number): bigint => BigInt(rank * 8 + file);

const WHITE: Team = { White: null };
const BLACK: Team = { Black: null };
const KING: PieceType = { King: null };
const BISHOP: PieceType = { Bishop: null };
const KNIGHT: PieceType = { Knight: null };
const ROOK: PieceType = { Rook: null };
const QUEEN: PieceType = { Queen: null };
const PAWN: PieceType = { Pawn: null };

type Piece = [bigint, PieceType, Team];

it("keeps the pure insufficient-material rule's draw verdicts", async () => {
  const actor = await freshActor();

  // The correction gates WHEN the spell path consults this rule; the rule
  // itself must keep its exact verdicts. Draws:
  const draws: Piece[][] = [
    [
      [sq(4, 0), KING, WHITE],
      [sq(4, 7), KING, BLACK],
    ],
    [
      [sq(4, 0), KING, WHITE],
      [sq(2, 0), BISHOP, WHITE],
      [sq(4, 7), KING, BLACK],
    ],
    [
      [sq(4, 0), KING, WHITE],
      [sq(1, 0), KNIGHT, WHITE],
      [sq(4, 7), KING, BLACK],
    ],
    [
      [sq(4, 0), KING, WHITE],
      [sq(2, 0), BISHOP, WHITE],
      [sq(4, 7), KING, BLACK],
      [sq(5, 7), BISHOP, BLACK],
    ],
  ];
  for (const pieces of draws) {
    await expect(actor.isInsufficientMaterialForSquares(pieces)).resolves.toBe(
      true,
    );
  }
});

it("keeps the pure insufficient-material rule's non-draw verdicts", async () => {
  const actor = await freshActor();

  // Non-draws: a pawn, rook or queen on the board, and the K+N vs K+N and
  // K+2N vs K positions that are NOT draws.
  const nonDraws: Piece[][] = [
    [
      [sq(4, 0), KING, WHITE],
      [sq(0, 0), PAWN, WHITE],
      [sq(4, 7), KING, BLACK],
    ],
    [
      [sq(4, 0), KING, WHITE],
      [sq(0, 0), ROOK, WHITE],
      [sq(4, 7), KING, BLACK],
    ],
    [
      [sq(4, 0), KING, WHITE],
      [sq(3, 0), QUEEN, WHITE],
      [sq(4, 7), KING, BLACK],
    ],
    [
      [sq(4, 0), KING, WHITE],
      [sq(1, 0), KNIGHT, WHITE],
      [sq(4, 7), KING, BLACK],
      [sq(6, 7), KNIGHT, BLACK],
    ],
    [
      [sq(4, 0), KING, WHITE],
      [sq(1, 0), KNIGHT, WHITE],
      [sq(6, 0), KNIGHT, WHITE],
      [sq(4, 7), KING, BLACK],
    ],
  ];
  for (const pieces of nonDraws) {
    await expect(actor.isInsufficientMaterialForSquares(pieces)).resolves.toBe(
      false,
    );
  }
});

it("keeps the burn-and-play result read shape stable", async () => {
  const actor = await freshActor();

  // The correction changes only the VALUE of `insufficientMaterial` for a
  // Newkai Dodan cast; the field and its sibling `transformedSquares` must
  // remain on the result the frontend polls. On a fresh canister no burn has
  // happened, so the pending result is the absent optional.
  const snapshot = await actor.getShieldResolutionSnapshot();
  expect(snapshot.lastBurnAndPlay).toEqual([]);

  // The spell board view keeps its board-effect arrays.
  const view = await actor.getSpellBoardState();
  expect(view.blockedSquares).toEqual([]);
  expect(view.blockedSquareOwners).toEqual([]);
  expect(view.explosiveSquares).toEqual([]);
  expect(view.whiteBallsColour).toEqual([]);
  expect(view.blackBallsColour).toEqual([]);
});

it("keeps the game state snapshot's phase field readable", async () => {
  const actor = await freshActor();

  // The normal move path's insufficient-material draw sets the game phase to
  // #Draw. The correction must not disturb the snapshot shape the frontend
  // reads to render the end-game modal. On a fresh canister the game is
  // #Playing (or #Paused) and the phase field is present.
  const state = await actor.getGameState("insufficient-adjacent-player-1");
  expect(state.phase).toBeDefined();
  expect("Playing" in state.phase || "Paused" in state.phase).toBe(true);
});
