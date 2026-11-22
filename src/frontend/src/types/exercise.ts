/**
 * Local exercise-toast type.
 *
 * This is the FOUNDATION type for the exercise feature. The backend
 * `ExerciseAssignment` type (with fields id, lostTeam, reps, exercise kind,
 * timestamp) is being built in parallel. The wiring task will later swap
 * this local type for the backend-derived one — the toast component and
 * hook are built against this shape so they can land independently of the
 * backend bindings.
 *
 * Shape mirrors the planned backend `ExerciseAssignment`:
 *   - id:        stable unique id (used as the React key + close target)
 *   - team:      the team that LOST the captured piece (does the exercise)
 *   - reps:      number of repetitions assigned for this capture
 *   - exercise:  the exercise kind assigned for this capture
 */

/** The exercise kinds the feature can assign. Matches the backend
 * ExerciseKind enum { NinjaRoll, PushUps, Squats, Cartwheel, Crunches }. */
export type ExerciseKind =
  | "ninja-roll"
  | "push-ups"
  | "squats"
  | "cartwheel"
  | "crunches";

/**
 * The piece types the feature can assign exercises for. Matches the
 * backend variant (Pawn, Knight, Bishop, Rook, Queen). The king is never
 * captured in normal play, so it is not part of the union. Mirrors the
 * PieceType union in types/drinking.ts so the captured-piece pop-up can
 * join exercise assignments to captured piece icons by piece type.
 */
export type PieceType = "pawn" | "knight" | "bishop" | "rook" | "queen";

/**
 * The capture trigger that produced this assignment. Mirrors the backend
 * TriggerType enum { Capture, EnPassant }. The backend only ever emits
 * Capture and EnPassant (castling and check no longer generate
 * challenges; en-passant is treated as a capture). Older assignments
 * written before the trigger field landed may surface undefined; the hook
 * defaults those to "Capture" for backward compatibility.
 */
export type TriggerType = "Capture" | "EnPassant";

/** A single exercise toast. One is produced per capture (while the toggle
 * is ON). Toasts stack downward in capture sequence and do not auto-dismiss. */
export interface ExerciseToast {
  /** Stable unique id — used as the React key and the close target. */
  id: string;
  /** The team that LOST the captured piece (performs the exercise). */
  team: "white" | "black";
  /** Number of repetitions assigned for this capture. */
  reps: number;
  /** The exercise kind assigned for this capture. */
  exercise: ExerciseKind;
  /** The piece type that was captured (drives the rep count). Mapped from
   * the backend ExerciseAssignment.capturedPiece field so the captured-
   * piece pop-up can join exercise assignments to captured piece icons by
   * piece type without depending on the moves array. */
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
