/**
 * Local drinking-toast type.
 *
 * This is the FOUNDATION type for the drinking-game feature, parallel to
 * types/exercise.ts. The backend `DrinkingAssignment` type (with fields
 * index, lostTeam, capturedPiece, drinks, timestamp) is generated into
 * backend.d.ts. The toast component and hook are built against this local
 * shape so they can land independently of any wiring task.
 *
 * Shape mirrors the backend `DrinkingAssignment`:
 *   - id:            stable unique id (used as the React key + close target)
 *   - team:          the team that LOST the captured piece (drinks)
 *   - drinks:        number of drinks assigned for this capture
 *   - capturedPiece: the piece type that was captured (drives the count)
 */

/**
 * The piece types the feature can assign drinks for. Matches the backend
 * variant (Pawn, Knight, Bishop, Rook, Queen). The king is never captured
 * in normal play, so it is not part of the union.
 */
export type PieceType = "pawn" | "knight" | "bishop" | "rook" | "queen";

/**
 * The capture trigger that produced this assignment. Mirrors the backend
 * TriggerType enum { Capture, EnPassant }. The backend only ever emits
 * Capture and EnPassant (castling and check no longer generate
 * challenges; en-passant is treated as a capture). Older assignments
 * written before the trigger field landed may surface undefined; the
 * hook defaults those to "Capture" for backward compatibility.
 */
export type TriggerType = "Capture" | "EnPassant";

/** A single drinking toast. One is produced per capture (while the mode is
 * Drinking). Toasts stack downward in capture sequence and do not
 * auto-dismiss. */
export interface DrinkingToast {
  /** Stable unique id — used as the React key and the close target. */
  id: string;
  /** The team that LOST the captured piece (drinks). */
  team: "white" | "black";
  /** Number of drinks assigned for this capture. */
  drinks: number;
  /** The piece type that was captured (drives the drink count). */
  capturedPiece: PieceType;
  /** The capture trigger that produced this assignment. Defaults to
   * "Capture" for assignments written before the trigger field landed. */
  trigger: TriggerType;
  /** The index of the RecordedMove that captured the piece this assignment
   * belongs to. Join key: matches `RecordedMove.index` from the game-state
   * moves list. Used by CapturedTray to link a captured piece icon to its
   * challenge pop-up. Converted from the backend's bigint to a number. */
  moveIndex: number;
}
