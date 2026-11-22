import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { type Piece, PieceType, Team } from "../backend";
import type { GameMode } from "../hooks/use-game-mode";
import { useWindowTheme } from "../hooks/use-window-theme";
import type { RecordedMove } from "../types/chess";
import { PIECE_VALUE, STARTING_COUNTS } from "../types/chess";
import type { DrinkingToast } from "../types/drinking";
import type { ExerciseToast } from "../types/exercise";
import { MedievalPiece } from "./MedievalPieces";
import { WindowThemeDots } from "./WindowThemeDots";

/**
 * Captured pieces tray — derives the captured set locally by counting each
 * piece type currently on the board and subtracting from the standard
 * starting counts (8 pawns, 2 knights, 2 bishops, 2 rooks, 1 queen, 1 king
 * per side). The missing pieces per side are the captured set.
 *
 * No backend call for the captured set — purely derived from the `board`
 * array in the poll snapshot. Updates automatically on each poll response.
 *
 * Layout: two rows — White's captures (pieces White has lost) on top,
 * Black's captures on the bottom. Each captured piece renders as a small
 * merida piece icon (reusing MedievalPiece at ~22px) consistent with the
 * board piece set. Captures are sorted by piece value (queen first) for
 * readability.
 *
 * --- Captured-piece challenge pop-up --------------------------------
 * Clicking a captured piece icon opens a small pop-up positioned next to
 * that icon, revealing the challenge associated with that capture (e.g.
 * "White: 2 drinks (rook)" or "Black: 5x push-ups"). The challenge is
 * looked up by joining the captured piece to the drinking/exercise
 * assignment lists.
 *
 * PRIMARY JOIN (assignments-direct, always-on during play):
 * The drinking/exercise assignment hooks are ALWAYS-ON and poll every
 * 1500ms regardless of phase. Each assignment carries `team` (the side
 * that LOST the piece), `capturedPiece` (the piece type), and `moveIndex`
 * (the capture's move index, in capture sequence). We group assignments
 * by (team, capturedPiece) and index them in capture-sequence order; the
 * Nth captured piece icon of type T for side S joins to the Nth
 * assignment of type T for side S. This works during the Playing phase
 * even when the `moves` array from getGameRecord is empty or
 * timing-lagged, because the assignments are populated independently.
 *
 * FALLBACK JOIN (moves-bridge, used when moves IS populated):
 * For Celebration/Draw phases (and any case where the moves array is
 * available), we also build a per-(lostSide, pieceType) ordered list of
 * move indices from `moves` (RecordedMove[]). If the primary
 * assignments-direct join does not resolve a challenge for a given
 * (side, pieceType, nthOfType), we fall back to the moves-bridge join:
 * the Nth move index for that (side, pieceType) is matched against
 * `assignment.moveIndex` across BOTH assignment lists. The first match
 * (drinking preferred, then exercise) becomes the pop-up's challenge.
 *
 * Only one pop-up is open at a time. The pop-up is dismissible by
 * clicking the piece again, clicking elsewhere, pressing Escape, or
 * clicking the close button.
 */

/** A resolved challenge for a captured piece, ready to render in the
 * pop-up. Discriminated by kind so the pop-up can render the right
 * challenge text + accent. */
interface CapturedChallenge {
  /** "drinking" or "exercise" — which assignment list matched. */
  kind: "drinking" | "exercise";
  /** The team that LOST the piece (owes the challenge). */
  team: "white" | "black";
  /** The capture trigger (Capture / EnPassant). */
  trigger: "Capture" | "EnPassant";
  /** Drinking: number of drinks. Exercise: number of reps. */
  count: number;
  /** Exercise only: the exercise kind label. */
  exercise?: "ninja-roll" | "push-ups" | "squats" | "cartwheel" | "crunches";
  /** The piece type that was captured (for the "(piece)" suffix). Comes
   * directly from the matched assignment's capturedPiece field for both
   * drinking and exercise challenges. */
  capturedPiece: "pawn" | "knight" | "bishop" | "rook" | "queen";
}

interface CapturedTrayProps {
  /** 64-element board array from the snapshot. */
  board: Array<Piece | null>;
  /** Drinking assignments (mapped to DrinkingToast[]), used to look up
   * the challenge for a captured piece via moveIndex. */
  drinkingAssignments: DrinkingToast[];
  /** Exercise assignments (mapped to ExerciseToast[]), used to look up
   * the challenge for a captured piece via moveIndex. */
  exerciseAssignments: ExerciseToast[];
  /** The recorded move list from useGameState. Each RecordedMove has an
   * `index` and a `capturedPiece`; the move index joins to the
   * assignment's `moveIndex`. */
  moves: RecordedMove[];
  /** The live game mode (off|exercise|drinking), sourced from the
   * route's 150ms-synced gameMode state. Filters the captured-piece
   * pop-up's challenge resolution by mode: when 'drinking' only drinking
   * assignments are surfaced, when 'exercise' only exercise assignments,
   * and when 'off' the legacy drinking-preference behavior is preserved
   * (both lists merged, drinking preferred). Both assignment sets remain
   * always-on and retained in React Query cache regardless of mode —
   * this prop only affects which kind the pop-up resolves to, never
   * whether the hooks poll. */
  mode: GameMode;
  /** When true, render only the tray body — no header, no collapse toggle,
   * no per-window theme dots, and the tray's own persisted open state is
   * bypassed (the body is always shown). Used when the tray is embedded in
   * a tab under the board. When absent, the component behaves exactly as
   * before. */
  embedded?: boolean;
}

/** Count pieces currently on the board, grouped by team and piece type. */
function countBoardPieces(
  board: Array<Piece | null>,
): Record<Team, Partial<Record<PieceType, number>>> {
  const counts: Record<Team, Partial<Record<PieceType, number>>> = {
    [Team.White]: {},
    [Team.Black]: {},
  };
  for (const square of board) {
    if (!square) continue;
    counts[square.color][square.pieceType] =
      (counts[square.color][square.pieceType] ?? 0) + 1;
  }
  return counts;
}

/** Derive the list of captured piece types for a given side (pieces that
 * side has LOST). Sorted by piece value descending (queen first). */
function capturedForSide(board: Array<Piece | null>, side: Team): PieceType[] {
  const counts = countBoardPieces(board)[side];
  const captured: PieceType[] = [];
  for (const pieceType of Object.keys(STARTING_COUNTS) as PieceType[]) {
    const onBoard = counts[pieceType] ?? 0;
    const missing = STARTING_COUNTS[pieceType] - onBoard;
    // King is never captured; clamp to 0 to avoid phantom captures if the
    // board ever reports a missing king (e.g. during celebration teardown).
    const safe = pieceType === PieceType.King ? 0 : Math.max(0, missing);
    for (let i = 0; i < safe; i++) captured.push(pieceType);
  }
  // Sort by piece value descending (queen, rook, bishop/knight, pawn).
  captured.sort((a, b) => PIECE_VALUE[b] - PIECE_VALUE[a]);
  return captured;
}

/** Total point value of a captured set (sum of PIECE_VALUE per piece). */
function capturedPoints(captured: PieceType[]): number {
  return captured.reduce((sum, pieceType) => sum + PIECE_VALUE[pieceType], 0);
}

/** Material advantage in pawns units, positive = White ahead. */
function materialAdvantage(board: Array<Piece | null>): number {
  let white = 0;
  let black = 0;
  for (const square of board) {
    if (!square) continue;
    const v = PIECE_VALUE[square.pieceType];
    if (square.color === Team.White) white += v;
    else black += v;
  }
  return white - black;
}

/* --- Open/collapsed persistence (tco-captured-open) ------------------- */

const OPEN_KEY = "tco-captured-open";
const DEFAULT_OPEN = false; // collapsed by default on first visit

function readStoredOpen(): boolean {
  if (typeof window === "undefined") return DEFAULT_OPEN;
  try {
    const raw = window.localStorage.getItem(OPEN_KEY);
    if (raw === null) return DEFAULT_OPEN;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "boolean") return parsed;
  } catch {
    // Corrupt or unreadable — fall back to the default (collapsed).
  }
  return DEFAULT_OPEN;
}

function writeStoredOpen(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OPEN_KEY, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable (private mode, etc.) — the
    // window still works in-session via React state, just won't persist.
  }
}

/* --- Challenge join: assignments-direct (primary) + moves-bridge (fallback) --- */

/**
 * Build a per-(lostSide, pieceType) ordered list of move indices from the
 * recorded move list. A move "lost" a piece for side S when:
 *   - the move captured a piece (`capturedPiece` is set), AND
 *   - the captured piece belonged to S.
 *
 * The captured piece's color is the OPPOSITE of `move.team` (the moving
 * side captured the opponent's piece). So a move with `team === White`
 * captured a Black piece → Black lost it. The captured piece type comes
 * from `move.capturedPiece` (a backend PieceType enum value like "Pawn").
 *
 * The result is a nested map: `moveIndicesBySideAndType[side][pieceType]`
 * is an ascending list of move indices for captures of that piece type
 * for that side. The Nth captured piece icon of type T for side S joins
 * to the Nth entry here.
 *
 * This is the FALLBACK join used when the moves array IS populated
 * (Celebration/Draw phases). During Playing the moves array may be empty
 * or timing-lagged, so the primary join (buildAssignmentIndexMap) is
 * used instead — it reads directly from the always-on assignment hooks.
 */
function buildCaptureMoveIndexMap(
  moves: RecordedMove[],
): Record<Team, Partial<Record<PieceType, number[]>>> {
  const map: Record<Team, Partial<Record<PieceType, number[]>>> = {
    [Team.White]: {},
    [Team.Black]: {},
  };
  for (const move of moves) {
    // Skip moves that did not capture a piece.
    if (move.capturedPiece === undefined || move.capturedPiece === null) {
      continue;
    }
    // The captured piece belonged to the side OPPOSITE the mover.
    const lostSide: Team = move.team === Team.White ? Team.Black : Team.White;
    const pieceType = move.capturedPiece as PieceType;
    const bucket = map[lostSide][pieceType] ?? [];
    bucket.push(Number(move.index));
    map[lostSide][pieceType] = bucket;
  }
  return map;
}

/**
 * Build a per-(lostSide, pieceType) ordered list of assignments from the
 * drinking + exercise assignment lists. This is the PRIMARY join used
 * during the Playing phase: the assignment hooks are ALWAYS-ON (they
 * poll every 1500ms regardless of phase), so they are populated even
 * when the `moves` array from getGameRecord is empty or timing-lagged.
 *
 * Each assignment carries `team` (the side that LOST the piece),
 * `capturedPiece` (the piece type), and is in capture-sequence order
 * (the hooks sort by index ascending). We group assignments by
 * (team, capturedPiece) preserving that order. The Nth captured piece
 * icon of type T for side S joins to the Nth assignment of type T for
 * side S.
 *
 * Drinking assignments are preferred over exercise assignments at the
 * same (side, pieceType, nthOfType) position: a single capture produces
 * at most one drinking OR one exercise assignment (the game mode is
 * single-state), so in practice only one list is populated at a time,
 * but we prefer drinking when both happen to have an entry.
 */
interface AssignmentIndexEntry {
  kind: "drinking" | "exercise";
  /** The DrinkingToast or ExerciseToast this entry came from. */
  assignment: DrinkingToast | ExerciseToast;
}

function buildAssignmentIndexMap(
  drinkingAssignments: DrinkingToast[],
  exerciseAssignments: ExerciseToast[],
): Record<Team, Partial<Record<PieceType, AssignmentIndexEntry[]>>> {
  const map: Record<
    Team,
    Partial<Record<PieceType, AssignmentIndexEntry[]>>
  > = {
    [Team.White]: {},
    [Team.Black]: {},
  };

  // Helper to push an assignment into the right bucket. The local
  // PieceType unions in types/drinking.ts and types/exercise.ts are both
  // "pawn"|"knight"|"bishop"|"rook"|"queen" and map 1:1 to the backend
  // PieceType enum values used by the board's PieceType (Pawn, Knight,
  // Bishop, Rook, Queen). We normalize the lowercase string to the
  // backend PieceType enum value via a single mapping.
  const pushAssignment = (
    kind: "drinking" | "exercise",
    assignment: DrinkingToast | ExerciseToast,
  ) => {
    const team: Team = assignment.team === "white" ? Team.White : Team.Black;
    const pieceStr = assignment.capturedPiece as string;
    const pieceType = lowercasePieceTypeToBackend(pieceStr);
    const bucket = map[team][pieceType] ?? [];
    bucket.push({ kind, assignment });
    map[team][pieceType] = bucket;
  };

  // Both hooks return assignments sorted by index ascending (capture
  // sequence). To preserve capture-sequence ordering across the two
  // lists when both are populated, we merge them by moveIndex. In
  // practice only one list is populated at a time (single-state mode),
  // but merging is safe and correct.
  const merged: Array<{
    kind: "drinking" | "exercise";
    assignment: DrinkingToast | ExerciseToast;
    moveIndex: number;
  }> = [];
  for (const d of drinkingAssignments) {
    merged.push({ kind: "drinking", assignment: d, moveIndex: d.moveIndex });
  }
  for (const e of exerciseAssignments) {
    merged.push({ kind: "exercise", assignment: e, moveIndex: e.moveIndex });
  }
  merged.sort((a, b) => a.moveIndex - b.moveIndex);

  for (const entry of merged) {
    pushAssignment(entry.kind, entry.assignment);
  }

  return map;
}

/** Map a lowercase frontend piece type string ("pawn", "knight", ...)
 * to the backend PieceType enum value used by the board's Piece
 * (Pawn, Knight, Bishop, Rook, Queen). The two unions are 1:1. */
function lowercasePieceTypeToBackend(piece: string): PieceType {
  switch (piece) {
    case "pawn":
      return PieceType.Pawn;
    case "knight":
      return PieceType.Knight;
    case "bishop":
      return PieceType.Bishop;
    case "rook":
      return PieceType.Rook;
    case "queen":
      return PieceType.Queen;
    default:
      // Defensive — the unions only emit the five capturable types.
      return PieceType.Pawn;
  }
}

/** Look up the challenge for a captured piece. `nthOfType` is the 0-based
 * index of this captured piece among all captured pieces of the same
 * type for the same side (in the tray's display order). Returns the
 * matching challenge or null if no assignment matches.
 *
 * PRIMARY: read directly from the assignment index map (always-on
 * during play). FALLBACK: if the primary map has no entry at this
 * (side, pieceType, nthOfType) position, fall back to the moves-bridge
 * map (used during Celebration/Draw when moves is populated).
 *
 * MODE FILTERING: when `mode` is 'drinking' or 'exercise', only
 * assignment entries whose `kind` tag matches the mode are considered
 * at the PRIMARY join position — so a midgame mode switch re-resolves
 * the pop-up to the selected mode's challenge instantly from the
 * retained assignment data with no re-fetch. When `mode` is 'off', the
 * legacy drinking-preference behavior is preserved (both kinds merged,
 * drinking preferred at the same position). The FALLBACK (moves-bridge)
 * join is mode-filtered the same way: 'drinking' prefers drinking only,
 * 'exercise' prefers exercise only, 'off' prefers drinking then
 * exercise. */
function lookupChallenge(
  side: Team,
  pieceType: PieceType,
  nthOfType: number,
  assignmentMap: Record<
    Team,
    Partial<Record<PieceType, AssignmentIndexEntry[]>>
  >,
  captureMap: Record<Team, Partial<Record<PieceType, number[]>>>,
  drinkingAssignments: DrinkingToast[],
  exerciseAssignments: ExerciseToast[],
  mode: GameMode,
): CapturedChallenge | null {
  // PRIMARY: assignments-direct join.
  const assignmentEntries = assignmentMap[side][pieceType] ?? [];
  // Mode filter: when a specific mode is active, only entries whose
  // kind matches that mode are eligible at this position. When mode is
  // 'off', no filter is applied (legacy drinking-preference behavior).
  const modeFilteredEntries =
    mode === "off"
      ? assignmentEntries
      : assignmentEntries.filter((e) => e.kind === mode);
  const entry = modeFilteredEntries[nthOfType];
  if (entry) {
    if (entry.kind === "drinking") {
      const drinking = entry.assignment as DrinkingToast;
      return {
        kind: "drinking",
        team: drinking.team,
        trigger: drinking.trigger,
        count: drinking.drinks,
        capturedPiece: drinking.capturedPiece,
      };
    }
    const exercise = entry.assignment as ExerciseToast;
    return {
      kind: "exercise",
      team: exercise.team,
      trigger: exercise.trigger,
      count: exercise.reps,
      exercise: exercise.exercise,
      capturedPiece: exercise.capturedPiece,
    };
  }

  // FALLBACK: moves-bridge join. Used when the primary map has no entry
  // (e.g. Celebration/Draw where moves is populated but the assignment
  // hooks may have been cleared, or vice versa). The Nth move index for
  // this (side, pieceType) is matched against assignment.moveIndex.
  const moveIndices = captureMap[side][pieceType] ?? [];
  const moveIndex = moveIndices[nthOfType];
  if (moveIndex === undefined) return null;

  // Mode-filtered fallback: 'drinking' considers only drinking
  // assignments, 'exercise' only exercise, 'off' prefers drinking then
  // exercise (legacy behavior). A move can produce at most one drinking
  // assignment and one exercise assignment (the game mode is single-
  // state), so the first match in the considered set wins.
  if (mode !== "exercise") {
    const drinking = drinkingAssignments.find((a) => a.moveIndex === moveIndex);
    if (drinking) {
      return {
        kind: "drinking",
        team: drinking.team,
        trigger: drinking.trigger,
        count: drinking.drinks,
        capturedPiece: drinking.capturedPiece,
      };
    }
  }
  if (mode !== "drinking") {
    const exercise = exerciseAssignments.find((a) => a.moveIndex === moveIndex);
    if (exercise) {
      return {
        kind: "exercise",
        team: exercise.team,
        trigger: exercise.trigger,
        count: exercise.reps,
        exercise: exercise.exercise,
        capturedPiece: exercise.capturedPiece,
      };
    }
  }
  return null;
}

/* --- Pop-up text helpers (mirror DrinkingToasts / ExerciseToasts) ----- */

function teamLabel(team: "white" | "black"): string {
  return team === "white" ? "White" : "Black";
}

function triggerBadgeClass(trigger: "Capture" | "EnPassant"): string {
  return trigger === "EnPassant"
    ? "toast-trigger-badge toast-trigger-en-passant"
    : "toast-trigger-badge toast-trigger-capture";
}

function triggerBadgeText(trigger: "Capture" | "EnPassant"): string {
  return trigger === "EnPassant" ? "en passant" : "capture";
}

function exerciseLabel(
  exercise: "ninja-roll" | "push-ups" | "squats" | "cartwheel" | "crunches",
): string {
  switch (exercise) {
    case "ninja-roll":
      return "ninja roll";
    case "push-ups":
      return "push-ups";
    case "squats":
      return "squats";
    case "cartwheel":
      return "cartwheel";
    case "crunches":
      return "crunches";
  }
}

/** Build the challenge text for the pop-up, mirroring the toast text
 * format ("White: 2 drinks (rook)" / "Black: 5x push-ups"). */
function challengeText(challenge: CapturedChallenge): string {
  if (challenge.kind === "drinking") {
    const drinks = `${challenge.count} ${challenge.count === 1 ? "drink" : "drinks"}`;
    if (challenge.trigger === "EnPassant") {
      return `${teamLabel(challenge.team)}: ${drinks}`;
    }
    return `${teamLabel(challenge.team)}: ${drinks} (${challenge.capturedPiece})`;
  }
  return `${teamLabel(challenge.team)}: ${challenge.count}x ${exerciseLabel(challenge.exercise ?? "push-ups")}`;
}

/* --- Captured row with click-to-pop-up ------------------------------- */

/** A captured piece icon that opens a challenge pop-up on click. */
function CapturedPieceIcon({
  side,
  pieceType,
  nthOfType,
  challenge,
  isOpen,
  onToggle,
  iconRef,
}: {
  side: Team;
  pieceType: PieceType;
  nthOfType: number;
  challenge: CapturedChallenge | null;
  isOpen: boolean;
  onToggle: () => void;
  iconRef: (el: HTMLButtonElement | null) => void;
}) {
  // If there is no challenge for this captured piece, render a non-
  // interactive icon (the original aria-hidden behavior) so clicking
  // does nothing and no pop-up opens.
  if (!challenge) {
    return (
      <span
        className={`inline-flex w-[22px] h-[22px] items-center justify-center leading-none ${
          side === Team.White ? "piece-glow-white" : "piece-glow-black"
        }`}
        aria-hidden="true"
      >
        <MedievalPiece pieceType={pieceType} color={side} />
      </span>
    );
  }

  const label = `${teamLabel(side === Team.White ? "white" : "black")} captured ${pieceType.toLowerCase()} — ${challengeText(challenge)}`;

  return (
    <button
      type="button"
      ref={iconRef}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      data-ocid={`captured_tray.piece.${nthOfType + 1}`}
      aria-label={label}
      aria-expanded={isOpen}
      className={`inline-flex w-[22px] h-[22px] items-center justify-center leading-none rounded-sm transition-smooth cursor-pointer hover:ring-2 hover:ring-ring/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        side === Team.White ? "piece-glow-white" : "piece-glow-black"
      } ${isOpen ? "ring-2 ring-ring" : ""}`}
    >
      <MedievalPiece pieceType={pieceType} color={side} />
    </button>
  );
}

/** The challenge pop-up, positioned absolutely relative to the tray
 * panel. Anchored to the bottom-left of the open icon so it appears
 * "next to" the piece. Uses the same toast surface tokens
 * (--toast-bg / --toast-border) and the team chip + trigger badge
 * conventions from DrinkingToasts / ExerciseToasts. */
function ChallengePopup({
  challenge,
  onClose,
}: {
  challenge: CapturedChallenge;
  onClose: () => void;
}) {
  const isDrinking = challenge.kind === "drinking";
  return (
    <dialog
      open
      data-ocid="captured_tray.popup"
      aria-label="Captured piece challenge"
      className={`captured-challenge-popup ${
        challenge.team === "white" ? "team-white" : "team-black"
      }`}
      // Stop propagation so clicking inside the pop-up does not close it
      // via the document-level outside-click handler. The keyboard
      // handler mirrors this for keyboard navigation.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="captured-challenge-popup-body">
        <div className="captured-challenge-popup-meta">
          {isDrinking ? (
            // Martini-glass icon (mirrors DrinkingToasts).
            <svg
              className="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 4h16l-8 9z" />
              <path d="M10.5 13.5h3" />
              <path d="M11 14v5" />
              <path d="M13 14v5" />
              <path d="M8 21h8" />
            </svg>
          ) : (
            // Dumbbell icon (mirrors ExerciseToasts).
            <svg
              className="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
              <path d="M3 9v6" />
              <path d="M6 7.5v9" />
              <path d="M21 9v6" />
              <path d="M18 7.5v9" />
            </svg>
          )}
          <span
            className={`captured-challenge-popup-team ${
              challenge.team === "white" ? "team-white" : "team-black"
            }`}
            aria-hidden="true"
          >
            {challenge.team === "white" ? "W" : "B"}
          </span>
        </div>
        <span className="captured-challenge-popup-text">
          {challengeText(challenge)}
        </span>
        <span
          className={triggerBadgeClass(challenge.trigger)}
          aria-label={`Trigger: ${triggerBadgeText(challenge.trigger)}`}
        >
          {triggerBadgeText(challenge.trigger)}
        </span>
      </div>
      <button
        type="button"
        onClick={onClose}
        data-ocid="captured_tray.popup.close_button"
        aria-label="Close challenge pop-up"
        className="captured-challenge-popup-close"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </dialog>
  );
}

function CapturedRow({
  side,
  captured,
  label,
  assignmentMap,
  captureMap,
  drinkingAssignments,
  exerciseAssignments,
  mode,
  isOpen,
  onOpenChange,
  registerIconRef,
}: {
  side: Team;
  captured: PieceType[];
  label: string;
  assignmentMap: Record<
    Team,
    Partial<Record<PieceType, AssignmentIndexEntry[]>>
  >;
  captureMap: Record<Team, Partial<Record<PieceType, number[]>>>;
  drinkingAssignments: DrinkingToast[];
  exerciseAssignments: ExerciseToast[];
  mode: GameMode;
  isOpen: (key: string) => boolean;
  onOpenChange: (key: string | null) => void;
  registerIconRef: (key: string, el: HTMLButtonElement | null) => void;
}) {
  // Build stable keys without using the array index (biome noArrayIndexKey).
  // Pieces of the same type are indistinguishable, so we key by type plus a
  // per-type running counter. The running counter ALSO serves as the
  // `nthOfType` join key into the capture-move-index map.
  const keyed: Array<{
    key: string;
    pieceType: PieceType;
    nthOfType: number;
    challenge: CapturedChallenge | null;
  }> = [];
  const perType: Partial<Record<PieceType, number>> = {};
  for (const pieceType of captured) {
    const n = (perType[pieceType] ?? 0) + 1;
    perType[pieceType] = n;
    const key = `${side === Team.White ? "white" : "black"}-${pieceType}-${n}`;
    // nthOfType is 0-based to index into the capture-move-index bucket.
    const nthOfType = n - 1;
    const challenge = lookupChallenge(
      side,
      pieceType,
      nthOfType,
      assignmentMap,
      captureMap,
      drinkingAssignments,
      exerciseAssignments,
      mode,
    );
    keyed.push({ key, pieceType, nthOfType, challenge });
  }

  return (
    <div className="flex items-center gap-1.5 min-h-7">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground w-10 shrink-0">
        {label}
      </span>
      <div className="flex items-center flex-wrap gap-0.5 min-h-0">
        {keyed.length === 0 ? (
          <span className="text-[10px] text-muted-foreground/60 italic">—</span>
        ) : (
          keyed.map((entry) => (
            <CapturedPieceIcon
              key={entry.key}
              side={side}
              pieceType={entry.pieceType}
              nthOfType={entry.nthOfType}
              challenge={entry.challenge}
              isOpen={isOpen(entry.key)}
              onToggle={() =>
                onOpenChange(isOpen(entry.key) ? null : entry.key)
              }
              iconRef={(el) => registerIconRef(entry.key, el)}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function CapturedTray({
  board,
  drinkingAssignments,
  exerciseAssignments,
  moves,
  mode,
  embedded = false,
}: CapturedTrayProps) {
  // "White's captures" = pieces White has captured = pieces Black has lost.
  // Convention: show the capturing side's row labeled by that side, with the
  // captured pieces rendered in the OPPONENT's color (the color they were).
  const whiteCaptured = capturedForSide(board, Team.Black); // pieces Black lost
  const blackCaptured = capturedForSide(board, Team.White); // pieces White lost
  const advantage = materialAdvantage(board);
  const whitePoints = capturedPoints(whiteCaptured);
  const blackPoints = capturedPoints(blackCaptured);

  // Self-contained collapsible open state, persisted to localStorage.
  // Defaults to collapsed.
  const [open, setOpen] = useState<boolean>(() => readStoredOpen());
  const { windowTheme, setWindowTheme, rootRef } =
    useWindowTheme("captured_tray");

  // Persist React state → localStorage whenever it changes.
  useEffect(() => {
    writeStoredOpen(open);
  }, [open]);

  // --- Challenge pop-up state ---------------------------------------
  // openKey identifies which captured piece icon's pop-up is open
  // (e.g. "Black-rook-2"). null = no pop-up. Only one is open at a time.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Refs to the open icon's button element, keyed by openKey, so the
  // pop-up can be positioned relative to it.
  const iconRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  // Build the capture-move-index map once per moves change.
  const captureMap = useMemo(() => buildCaptureMoveIndexMap(moves), [moves]);

  // Build the assignment index map once per assignment change. This is
  // the PRIMARY join (assignments-direct), always-on during play.
  const assignmentMap = useMemo(
    () => buildAssignmentIndexMap(drinkingAssignments, exerciseAssignments),
    [drinkingAssignments, exerciseAssignments],
  );

  // Close the pop-up when the tray collapses (so a pop-up does not
  // linger pointing at a now-unmounted icon). Skipped when embedded, where
  // the body is always shown regardless of the persisted open state.
  useEffect(() => {
    if (!embedded && !open) setOpenKey(null);
  }, [open, embedded]);

  // Close on Escape and on outside click. The pop-up itself stops
  // propagation; icon clicks stop propagation too. Any other click lands
  // on the document and closes the pop-up.
  useEffect(() => {
    if (!openKey) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenKey(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      // If the pointer landed inside the pop-up or on an icon button,
      // those handlers stop propagation and this never fires. Anything
      // else closes the pop-up.
      const target = e.target as Node | null;
      const popup = document.querySelector('[data-ocid="captured_tray.popup"]');
      if (popup && target && popup.contains(target)) return;
      setOpenKey(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openKey]);

  // Clean up icon refs for keys that are no longer open to avoid leaks.
  useEffect(() => {
    if (openKey) return;
    iconRefs.current.clear();
  }, [openKey]);

  const registerIconRef = (key: string, el: HTMLButtonElement | null) => {
    if (el) iconRefs.current.set(key, el);
    else iconRefs.current.delete(key);
  };

  const isOpen = (key: string) => openKey === key;

  // Position the pop-up relative to the open icon. We compute it on
  // render from the icon's bounding rect so it tracks scroll/resize
  // naturally (the pop-up is position:fixed).
  const openIconEl = openKey ? iconRefs.current.get(openKey) : null;
  let popupStyle: React.CSSProperties | undefined;
  if (openIconEl) {
    const rect = openIconEl.getBoundingClientRect();
    // Place the pop-up below and to the right of the icon, clamped to
    // the viewport. A min-width keeps the challenge text readable.
    const popupWidth = 240;
    const margin = 6;
    let left = rect.right + margin;
    // If the pop-up would overflow the right edge, flip to the left.
    if (left + popupWidth > window.innerWidth - 8) {
      left = rect.left - popupWidth - margin;
    }
    // If it would still overflow (very narrow viewport), clamp to 8px.
    left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8));
    let top = rect.bottom + margin;
    // If the pop-up would overflow the bottom, place it above the icon.
    const estHeight = 64;
    if (top + estHeight > window.innerHeight - 8) {
      top = rect.top - estHeight - margin;
    }
    top = Math.max(8, top);
    popupStyle = {
      position: "fixed",
      left,
      top,
      width: popupWidth,
      zIndex: 60,
    };
  }

  // Resolve the challenge for the open key so we can render the pop-up.
  // `mode` is a dependency so the pop-up re-resolves instantly from the
  // retained assignment data on a midgame mode switch with no re-fetch
  // (both assignment sets are always-on and retained in React Query
  // cache; only the kind filter changes).
  const openChallenge = useMemo<CapturedChallenge | null>(() => {
    if (!openKey) return null;
    // openKey format: "<side>-<pieceType>-<n>" where side is "white"|"black".
    const match = openKey.match(/^(white|black)-(\w+)-(\d+)$/);
    if (!match) return null;
    const sideStr = match[1];
    const pieceTypeStr = match[2] as PieceType;
    const n = Number(match[3]);
    const side: Team = sideStr === "white" ? Team.White : Team.Black;
    return lookupChallenge(
      side,
      pieceTypeStr,
      n - 1,
      assignmentMap,
      captureMap,
      drinkingAssignments,
      exerciseAssignments,
      mode,
    );
  }, [
    openKey,
    assignmentMap,
    captureMap,
    drinkingAssignments,
    exerciseAssignments,
    mode,
  ]);

  return (
    <div
      ref={rootRef}
      data-ocid="captured_tray.panel"
      className="flex h-full flex-col bg-card overflow-hidden"
    >
      {/* Header — three-part flex row: left shrink-0 toggle button, centred
       * per-window theme dots, right shrink-0 material-advantage badge. The
       * dots stay centred and never overlap either side. Hidden entirely
       * when embedded (the tab supplies its own label). */}
      {embedded ? null : (
        <div className="relative flex w-full items-center justify-between border-b border-border">
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            data-ocid="captured_tray.header"
            aria-expanded={open}
            aria-controls="captured-tray-body"
            className="flex min-w-0 shrink-0 items-center gap-1.5 px-4 py-3 text-left transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <ChevronRight
              className={`size-4 shrink-0 text-muted-foreground transition-smooth ${
                open ? "hidden" : "block"
              }`}
              aria-hidden="true"
            />
            <ChevronDown
              className={`size-4 shrink-0 text-muted-foreground transition-smooth ${
                open ? "block" : "hidden"
              }`}
              aria-hidden="true"
            />
            <span className="window-heading text-sm font-semibold">
              Captured
            </span>
          </button>

          <WindowThemeDots
            value={windowTheme}
            onChange={setWindowTheme}
            label="Piece tray"
            ocidPrefix="captured_tray"
          />

          <div className="flex shrink-0 items-center px-4">
            {open ? (
              advantage !== 0 && (
                <span
                  className={`text-xs font-mono font-semibold tabular-nums ${
                    advantage > 0 ? "text-team-white" : "text-team-black"
                  }`}
                  aria-label={`Material advantage ${Math.abs(advantage)} for ${advantage > 0 ? "White" : "Black"}`}
                >
                  {advantage > 0 ? `+${advantage}` : advantage}
                </span>
              )
            ) : (
              <span
                className="flex items-center gap-1.5 text-xs font-mono font-semibold tabular-nums text-muted-foreground"
                aria-label={`Captured points: White ${whitePoints}, Black ${blackPoints}`}
              >
                <span className="text-team-white-captured">
                  WHITE {whitePoints}
                </span>
                <span aria-hidden="true">|</span>
                <span className="text-team-black-captured">
                  {blackPoints} BLACK
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Body — conditionally UNMOUNTED when collapsed (same approach as
       * the other windows: the body is not in the DOM when collapsed, so
       * the card shrinks to header-only height naturally). When collapsed
       * the header still shows the material-advantage badge; the "WHITE — /
       * BLACK —" points summary rows live in the body and are hidden. When
       * embedded, the body is always shown (no header, no collapse). */}
      {embedded || open ? (
        <div
          id="captured-tray-body"
          className={`flex flex-col gap-1 px-4 py-3 ${
            embedded ? "min-h-0 flex-1 overflow-y-auto momentum-scroll" : ""
          }`}
        >
          <CapturedRow
            side={Team.Black}
            captured={whiteCaptured}
            label="White"
            assignmentMap={assignmentMap}
            captureMap={captureMap}
            drinkingAssignments={drinkingAssignments}
            exerciseAssignments={exerciseAssignments}
            mode={mode}
            isOpen={isOpen}
            onOpenChange={setOpenKey}
            registerIconRef={registerIconRef}
          />
          <CapturedRow
            side={Team.White}
            captured={blackCaptured}
            label="Black"
            assignmentMap={assignmentMap}
            captureMap={captureMap}
            drinkingAssignments={drinkingAssignments}
            exerciseAssignments={exerciseAssignments}
            mode={mode}
            isOpen={isOpen}
            onOpenChange={setOpenKey}
            registerIconRef={registerIconRef}
          />
        </div>
      ) : null}

      {/* Challenge pop-up — rendered as a fixed-position overlay so it
       * is never clipped by the tray's overflow-hidden. Only one is
       * open at a time (gated on openKey + openChallenge). */}
      {openChallenge && popupStyle && (
        <div style={popupStyle}>
          <ChallengePopup
            challenge={openChallenge}
            onClose={() => setOpenKey(null)}
          />
        </div>
      )}
    </div>
  );
}

export default CapturedTray;
