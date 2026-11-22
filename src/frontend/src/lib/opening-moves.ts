/**
 * opening-moves — isolated helper that converts the backend's recorded
 * opening moves (from `getGameRecord().moves`, filtered to
 * `username === "Opening"`) into the local `Move` shape consumed by
 * MoveHistory and the sound-effects hook.
 *
 * WHY THIS EXISTS
 *   `use-game-state.ts` derives its `moves` array by diffing consecutive
 *   polled boards via `deriveMove()`. When `startNewGame` applies a
 *   multi-ply opening between two polls, `deriveMove` sees multiple pieces
 *   moved and returns `null`, so the opening moves never appear in the
 *   Moves Window. Instead of touching the existing derivation logic, we
 *   fetch the authoritative recorded opening moves once (when the snapshot
 *   first reports a non-null `openingName`) and seed the `moves` array
 *   with the converted records.
 *
 * The converter only needs the fields that `MoveHistory.toSan()` reads —
 * `castle`, `piece`, `captured`, `to`, `from`, `promotion` — but it fills
 * in the full `Move` shape (including `capturedSquare`, `isEnPassant`,
 * `color`) so the records are indistinguishable from locally-derived ones
 * for any other consumer.
 */

import { PieceType } from "../backend";
import type { Team } from "../backend";
import type { Move, RecordedMove } from "../types/chess";

/** Map a SAN notation string's leading piece letter to its PieceType.
 *  K/Q/R/B/N map to the corresponding piece; anything else (pawn moves
 *  start with a file letter or are castling) is treated as a Pawn. */
function pieceFromSan(notation: string): PieceType {
  const first = notation.charAt(0);
  switch (first) {
    case "K":
      return PieceType.King;
    case "Q":
      return PieceType.Queen;
    case "R":
      return PieceType.Rook;
    case "B":
      return PieceType.Bishop;
    case "N":
      return PieceType.Knight;
    default:
      return PieceType.Pawn;
  }
}

/** Convert a single backend `RecordedMove` (with `username === "Opening"`)
 *  into the local `Move` shape. */
export function recordedOpeningToMove(record: RecordedMove): Move {
  const piece = pieceFromSan(record.notation);
  const captured = record.capturedPiece ?? null;
  const to = Number(record.toSquare);
  const from = Number(record.fromSquare);
  return {
    from,
    to,
    color: record.team as Team,
    piece,
    captured,
    // For normal captures the captured piece sits on `to`; for en passant
    // it sits behind `to`. The backend already tells us via `isEnPassant`,
    // so we set `capturedSquare` accordingly (null when nothing captured).
    capturedSquare:
      captured !== null
        ? record.isEnPassant
          ? // En passant: captured pawn is on the same file as `to`, same
            // rank as `from`. Compute that square (rank-major index).
            Math.floor(from / 8) * 8 + (to % 8)
          : to
        : null,
    promotion: record.promotion ?? null,
    castle: record.isCastling,
    isEnPassant: record.isEnPassant,
  };
}

/** Filter a `RecordedMove[]` down to the opening moves (username ===
 *  "Opening") and convert each to the local `Move` shape, preserving
 *  backend order. Returns `[]` if the input is empty or has no opening
 *  moves. */
export function convertOpeningMoves(records: RecordedMove[]): Move[] {
  return records
    .filter((r) => r.username === "Opening")
    .map(recordedOpeningToMove);
}
