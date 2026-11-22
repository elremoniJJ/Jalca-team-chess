/**
 * Local chess types derived from the backend snapshot.
 *
 * The backend `GameStateSnapshot` (see `../backend.ts`) does NOT expose a
 * `lastMove` or `moves` array — only the current `board`, `turn`, `phase`,
 * etc. To support last-move highlighting, move history, and sound effects
 * without any backend changes, we derive a `Move` record locally by diffing
 * consecutive poll snapshots in `use-game-state.ts`.
 *
 * Square indices follow the backend convention: 0 = a1, 7 = h1, 56 = a8,
 * 63 = h8 (rank-major: index = rank * 8 + file).
 */

import type { Piece, PieceType, Team } from "../backend";
import type {
  EndState as BackendEndState,
  GameRecord as BackendGameRecord,
  GameResult as BackendGameResult,
  PlayerListEntry as BackendPlayerListEntry,
  RecordedMove as BackendRecordedMove,
  TeamRoster as BackendTeamRoster,
} from "../backend";
import {
  EndState as EndStateEnum,
  GameResult as GameResultEnum,
} from "../backend";

/* ------------------------------------------------------------------ */
/* Game record types — re-exported from the generated backend bindings */
/* so UI components can import them from the app's own type system     */
/* (e.g. `import type { GameRecord } from "@/types/chess"`) without    */
/* reaching into `../backend` directly. The backend canister exposes   */
/* `getGameRecord()` which returns a `GameRecord` describing the      */
/* concluded (or in-progress) game: the full move list, the player     */
/* roster per team, the result (WhiteWin/BlackWin/Draw), the end      */
/* state (Checkmate/Stalemate/Draw/Timeout), and the player who was   */
/* to move when a timeout ended the game.                              */
/* ------------------------------------------------------------------ */

/** Result of a concluded game. Mirrors the backend `GameResult` enum. */
export type GameResult = BackendGameResult;
/** How the game ended. Mirrors the backend `EndState` enum. */
export type EndState = BackendEndState;
/** A single recorded move from the game record. Mirrors backend type. */
export type RecordedMove = BackendRecordedMove;
/** A player entry in the game record's player list. Mirrors backend type. */
export type PlayerListEntry = BackendPlayerListEntry;
/** A team's roster (members + count) in the game record. Mirrors backend type. */
export type TeamRoster = BackendTeamRoster;
/** The full game record returned by `actor.getGameRecord()`. Mirrors backend type. */
export type GameRecord = BackendGameRecord;

/** Re-exported enum values so consumers can compare without importing from
 * `../backend` (e.g. `result === GameResult.WhiteWin`). */
export const GameResult = GameResultEnum;
export const EndState = EndStateEnum;

/** A single derived move. `captured` is the piece type that was on the
 * destination square before the move (null for non-captures). `promotion`
 * is the piece type a pawn promoted to (null otherwise). */
export interface Move {
  /** Square index the moving piece started on (0-63). */
  from: number;
  /** Square index the moving piece ended on (0-63). */
  to: number;
  /** Team that made the move. */
  color: Team;
  /** Piece type that moved. */
  piece: PieceType;
  /** Piece type captured on the destination, or null. */
  captured: PieceType | null;
  /** Square the captured piece was on before the move, or null.
   *  - Normal capture: same as `to`.
   *  - En passant: the square BEHIND the destination (same file as `to`,
   *    same rank as `from`) — different from `to`.
   *  - Non-capture: null. */
  capturedSquare: number | null;
  /** Piece type a pawn promoted to (null otherwise). */
  promotion: PieceType | null;
  /** True if this move looked like a king castling (king moved 2 files). */
  castle: boolean;
  /** True if this move was an en-passant capture (pawn captured a pawn on
   * a different square than its destination). */
  isEnPassant: boolean;
}

/** A single piece-slide descriptor for the animation layer. Each describes
 * one piece that should slide from `from` to `to` over the slide duration.
 * Castling produces two (king + rook); all other moves produce one. */
export interface SlideDescriptor {
  /** Square the piece started on (0-63). */
  from: number;
  /** Square the piece ended on (0-63). */
  to: number;
  /** The piece (type + color) that slid. */
  piece: Piece;
}

/** A capture-fade descriptor for the animation layer. Describes a piece
 * that should fade out (over ~150ms) while the capturing piece slides in. */
export interface CaptureDescriptor {
  /** Square the captured piece was on (0-63). For normal captures this is
   * the destination; for en passant it is the behind square. */
  square: number;
  /** The captured piece (type + color). */
  piece: Piece;
}

/** A fully-resolved animation plan for a single move. The Chessboard
 * animation overlay renders one slide per `slides` entry and one fade per
 * `captures` entry. */
export interface AnimationPlan {
  slides: SlideDescriptor[];
  captures: CaptureDescriptor[];
}

/** Animation trigger descriptor passed from the route to the Chessboard.
 *  - `move`: the derived move to animate (king move for castling; the rook
 *    slide is implied and computed by planAnimation).
 *  - `prevBoard`: the board BEFORE the move — used to look up origin pieces
 *    and captured pieces for the overlay.
 *  - `reverse`: when true, slide pieces from `to` back to `from` (used for
 *    optimistic-move revert so the piece slides back to its origin).
 *  - `id`: unique token; a changed id starts a new animation. */
export interface AnimationTrigger {
  move: Move;
  prevBoard: Array<Piece | null>;
  reverse?: boolean;
  id: number;
}

/** Standard starting counts per piece type per side. Used by CapturedTray
 * to derive the captured set by diffing the live board against these. */
export const STARTING_COUNTS: Record<PieceType, number> = {
  Pawn: 8,
  Knight: 2,
  Bishop: 2,
  Rook: 2,
  Queen: 1,
  King: 1,
};

/** Relative piece values for sorting captured trays (higher first). */
export const PIECE_VALUE: Record<PieceType, number> = {
  Pawn: 1,
  Knight: 3,
  Bishop: 3,
  Rook: 5,
  Queen: 9,
  King: 0,
};

/** File letters a-h, indexed by file number 0-7. */
export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

/** Convert a square index (0-63) to algebraic notation, e.g. 0 -> "a1". */
export function squareToAlgebraic(square: number): string {
  const file = square % 8;
  const rank = Math.floor(square / 8);
  return `${FILES[file]}${rank + 1}`;
}
