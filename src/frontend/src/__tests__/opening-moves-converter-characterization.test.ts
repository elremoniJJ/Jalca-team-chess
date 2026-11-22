import { describe, expect, it } from "vitest";

/**
 * Characterization of the opening-moves converter, taken BEFORE the
 * opening-turn detection changes from "the recorder holds zero moves" to
 * "no real move has been made since the opening finished".
 *
 * The request intentionally changes HOW the opening turn is detected, so that
 * a Random opening's seeded replay moves no longer end the opening turn. That
 * detection change is deliberately NOT asserted here.
 *
 * What IS protected is the mechanism the change builds on and must not
 * disturb: `convertOpeningMoves` turns the backend's recorded opening moves
 * (from `getGameRecord().moves`) into the local `Move[]` that `use-game-state`
 * seeds into its `moves` array. The converter must keep:
 *   - filtering to records whose `username === "Opening"` (a real player's
 *     move is never treated as an opening move);
 *   - preserving backend order;
 *   - mapping the SAN notation's leading letter to the right piece type;
 *   - carrying the team, squares, capture, promotion, castling and en-passant
 *     fields through unchanged, including the en-passant captured square.
 *
 * This is a pure-function characterization: no actor, no network, no DOM.
 */

import { PieceType, Team } from "@/backend";
import {
  convertOpeningMoves,
  recordedOpeningToMove,
} from "@/lib/opening-moves";
import type { RecordedMove } from "@/types/chess";

/** A recorded move with sensible defaults; override per test. */
function makeRecord(overrides: Partial<RecordedMove> = {}): RecordedMove {
  return {
    index: 0n,
    username: "Opening",
    notation: "e4",
    team: Team.White,
    fromSquare: 12n,
    toSquare: 28n,
    capturedPiece: undefined,
    promotion: undefined,
    isCastling: false,
    isEnPassant: false,
    gaveCheck: false,
    timestamp: 0n,
    ...overrides,
  };
}

describe("convertOpeningMoves", () => {
  it("keeps only the records whose username is 'Opening'", () => {
    const records: RecordedMove[] = [
      makeRecord({ index: 0n, notation: "e4", toSquare: 28n }),
      makeRecord({ index: 1n, username: "Ada", notation: "e5", toSquare: 36n }),
      makeRecord({ index: 2n, notation: "Nf3", toSquare: 20n }),
    ];

    const moves = convertOpeningMoves(records);

    // The real player's move is excluded; the two opening moves survive in
    // backend order.
    expect(moves).toHaveLength(2);
    expect(moves.map((m) => m.to)).toEqual([28, 20]);
  });

  it("returns an empty list when there are no opening records", () => {
    // A Standard opening seeds zero replay moves, so the converter must yield
    // an empty list rather than inventing a move.
    expect(convertOpeningMoves([])).toEqual([]);
    expect(
      convertOpeningMoves([makeRecord({ username: "Ada", notation: "e4" })]),
    ).toEqual([]);
  });

  it("maps the SAN leading letter to the right piece type", () => {
    const cases: Array<[string, PieceType]> = [
      ["e4", PieceType.Pawn],
      ["Nf3", PieceType.Knight],
      ["Bc4", PieceType.Bishop],
      ["Rc1", PieceType.Rook],
      ["Qd2", PieceType.Queen],
      ["Ke2", PieceType.King],
    ];

    for (const [notation, piece] of cases) {
      expect(recordedOpeningToMove(makeRecord({ notation })).piece).toBe(piece);
    }
  });

  it("carries team, squares, capture, promotion and castling through", () => {
    const move = recordedOpeningToMove(
      makeRecord({
        notation: "exd5",
        team: Team.Black,
        fromSquare: 36n,
        toSquare: 27n,
        capturedPiece: PieceType.Pawn,
        promotion: PieceType.Queen,
        isCastling: true,
      }),
    );

    expect(move).toMatchObject({
      from: 36,
      to: 27,
      color: Team.Black,
      piece: PieceType.Pawn,
      captured: PieceType.Pawn,
      promotion: PieceType.Queen,
      castle: true,
      isEnPassant: false,
    });
    // A normal capture sits on the destination square.
    expect(move.capturedSquare).toBe(27);
  });

  it("computes the en-passant captured square behind the destination", () => {
    // En passant: the captured pawn is on the same file as `to`, same rank as
    // `from`. from = 36 (e5), to = 27 (d6) -> captured square = 35 (d5).
    const move = recordedOpeningToMove(
      makeRecord({
        notation: "exd6",
        fromSquare: 36n,
        toSquare: 27n,
        capturedPiece: PieceType.Pawn,
        isEnPassant: true,
      }),
    );

    expect(move.isEnPassant).toBe(true);
    expect(move.capturedSquare).toBe(35);
  });

  it("leaves capturedSquare null for a non-capture", () => {
    const move = recordedOpeningToMove(makeRecord({ notation: "e4" }));
    expect(move.captured).toBeNull();
    expect(move.capturedSquare).toBeNull();
    expect(move.promotion).toBeNull();
  });
});
