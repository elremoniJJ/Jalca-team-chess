import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type {
  _SERVICE,
  PieceType,
  Team,
} from "../../src/frontend/src/declarations/backend.did";

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

let pic: PocketIc | undefined;
let actor: _SERVICE;

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
  ({ actor } = await pic.setupCanister<_SERVICE>({ idlFactory, wasm: BACKEND_WASM }));
});

afterAll(async () => {
  await pic?.tearDown();
});

// Square indices: a1=0, b1=1, ..., h1=7, a2=8, ..., h8=63.
// file = sq % 8, rank = sq / 8. Square colour parity = (file + rank) % 2.
const sq = (file: number, rank: number): bigint => BigInt(rank * 8 + file);

const WHITE: Team = { White: null };
const BLACK: Team = { Black: null };
const KING: PieceType = { King: null };
const BISHOP: PieceType = { Bishop: null };
const KNIGHT: PieceType = { Knight: null };

type Piece = [bigint, PieceType, Team];

it("K vs K is a draw by insufficient material", async () => {
  const pieces: Piece[] = [
    [sq(4, 0), KING, WHITE],
    [sq(4, 7), KING, BLACK],
  ];
  await expect(actor.isInsufficientMaterialForSquares(pieces)).resolves.toBe(true);
});

it("K + B vs K is a draw by insufficient material", async () => {
  const pieces: Piece[] = [
    [sq(4, 0), KING, WHITE],
    [sq(2, 0), BISHOP, WHITE],
    [sq(4, 7), KING, BLACK],
  ];
  await expect(actor.isInsufficientMaterialForSquares(pieces)).resolves.toBe(true);
});

it("K + N vs K is a draw by insufficient material", async () => {
  const pieces: Piece[] = [
    [sq(4, 0), KING, WHITE],
    [sq(1, 0), KNIGHT, WHITE],
    [sq(4, 7), KING, BLACK],
  ];
  await expect(actor.isInsufficientMaterialForSquares(pieces)).resolves.toBe(true);
});

it("K + B vs K + B with both bishops on the same square colour is a draw", async () => {
  // c1 (file 2, rank 0) -> parity 0; f8 (file 5, rank 7) -> parity 0. Same colour.
  const pieces: Piece[] = [
    [sq(4, 0), KING, WHITE],
    [sq(2, 0), BISHOP, WHITE],
    [sq(4, 7), KING, BLACK],
    [sq(5, 7), BISHOP, BLACK],
  ];
  await expect(actor.isInsufficientMaterialForSquares(pieces)).resolves.toBe(true);
});

it("K + N vs K + N is NOT a draw by insufficient material", async () => {
  const pieces: Piece[] = [
    [sq(4, 0), KING, WHITE],
    [sq(1, 0), KNIGHT, WHITE],
    [sq(4, 7), KING, BLACK],
    [sq(6, 7), KNIGHT, BLACK],
  ];
  await expect(actor.isInsufficientMaterialForSquares(pieces)).resolves.toBe(false);
});

it("K + 2N vs K is NOT a draw by insufficient material", async () => {
  const pieces: Piece[] = [
    [sq(4, 0), KING, WHITE],
    [sq(1, 0), KNIGHT, WHITE],
    [sq(6, 0), KNIGHT, WHITE],
    [sq(4, 7), KING, BLACK],
  ];
  await expect(actor.isInsufficientMaterialForSquares(pieces)).resolves.toBe(false);
});
