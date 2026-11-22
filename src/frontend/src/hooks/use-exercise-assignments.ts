import { useQuery } from "@tanstack/react-query";
import type {
  ExerciseKind as BackendExerciseKind,
  PieceType as BackendPieceType,
  TriggerType as BackendTriggerType,
  ExerciseAssignment,
} from "../backend";
import { useActorState } from "../lib/backend-actor";
import { getGamePollMs } from "../lib/poll-interval";
import type {
  ExerciseKind,
  ExerciseToast,
  PieceType,
  TriggerType,
} from "../types/exercise";

/*
 * useExerciseAssignments — the isolated retrieve-computation read path for
 * the exercise feature.
 *
 * Per the spec, the frontend must RETRIEVE exercise assignments from the
 * backend's retrieve-computation entry point (getExerciseAssignments) rather
 * than deriving them locally from the polled game state. This hook polls
 * actor.getExerciseAssignments() at the shared game cadence
 * (getGamePollMs(): 1500ms for players, 5000ms for spectators) via React
 * Query and returns the list mapped to the local ExerciseToast shape.
 *
 * The backend exercise methods (createExerciseAssignment,
 * getExerciseAssignments) and the ExerciseAssignment / ExerciseKind types
 * are generated into backend.d.ts, and the actor returned by
 * useActorState() is already typed as the generated Backend interface. We
 * therefore call the generated method directly and map from the generated
 * record — no local actor interface and no cast.
 *
 * Backend → frontend mapping (per the dispatch contract):
 *   - id        = String(assignment.index)
 *   - team      = assignment.lostTeam  (#White → "white", #Black → "black")
 *   - reps      = Number(assignment.reps)
 *   - exercise  = map ExerciseKind (#NinjaRoll → "ninja-roll", #PushUps →
 *                "push-ups", #Squats → "squats", #Cartwheel → "cartwheel",
 *                #Crunches → "crunches")
 *   - trigger   = assignment.trigger  (#Capture → "Capture",
 *                #EnPassant → "EnPassant"; defaults to "Capture" when
 *                undefined for backward compat with assignments written
 *                before the trigger field landed)
 *
 * The hook returns the assignments already mapped to ExerciseToast[] so
 * the route can diff against its shown-indices ref and push new toasts.
 * The list is sorted by index ascending (capture sequence) so the route
 * preserves the order in which captures occurred.
 */

function mapExerciseKind(kind: BackendExerciseKind): ExerciseKind {
  switch (kind) {
    case "NinjaRoll":
      return "ninja-roll";
    case "PushUps":
      return "push-ups";
    case "Squats":
      return "squats";
    case "Cartwheel":
      return "cartwheel";
    case "Crunches":
      return "crunches";
    default:
      return "push-ups";
  }
}

/** Map the backend capturedPiece (a backend PieceType variant name like
 * "Pawn", "Knight", ...) to the local frontend PieceType union. The
 * backend ExerciseAssignment carries capturedPiece so the captured-piece
 * pop-up can join exercise assignments to captured piece icons by piece
 * type without depending on the moves array. Defaults to "pawn" for any
 * unrecognized value (defensive — the backend only emits the five
 * capturable piece types). */
function mapPieceType(piece: BackendPieceType): PieceType {
  switch (piece) {
    case "Pawn":
      return "pawn";
    case "Knight":
      return "knight";
    case "Bishop":
      return "bishop";
    case "Rook":
      return "rook";
    case "Queen":
      return "queen";
    default:
      return "pawn";
  }
}

function mapTrigger(trigger: BackendTriggerType | undefined): TriggerType {
  switch (trigger) {
    case "Capture":
      return "Capture";
    case "EnPassant":
      return "EnPassant";
    default:
      // Older assignments written before the trigger field landed surface
      // undefined; default to "Capture" for backward compatibility.
      return "Capture";
  }
}

function mapAssignment(assignment: ExerciseAssignment): ExerciseToast {
  return {
    id: String(assignment.index),
    team: assignment.lostTeam === "White" ? "white" : "black",
    reps: Number(assignment.reps),
    exercise: mapExerciseKind(assignment.exercise),
    capturedPiece: mapPieceType(assignment.capturedPiece),
    trigger: mapTrigger(assignment.trigger),
    moveIndex: Number(assignment.moveIndex),
  };
}

/** Shared React Query keys for the exercise feature. */
export const EXERCISE_QUERY_KEYS = {
  assignments: ["exerciseAssignments"] as const,
};

/**
 * Polls the backend's retrieve-computation entry point
 * (getExerciseAssignments) at the shared game cadence and returns the
 * assignments mapped to the local ExerciseToast shape, sorted by capture
 * index ascending.
 *
 * The hook is always enabled (the route gates toast *display* on the
 * exercise toggle, but retrieval continues regardless so toggling ON
 * mid-game surfaces already-collected assignments without a refetch
 * delay). Per the spec, toggling OFF hides the toast container and stops
 * new toasts without discarding already-collected ones — retrieval
 * continuing while OFF is harmless (the route simply does not push new
 * toasts while the toggle is OFF).
 */
export function useExerciseAssignments() {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<ExerciseToast[], Error>({
    queryKey: EXERCISE_QUERY_KEYS.assignments,
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      const assignments = await actor.getExerciseAssignments();
      return assignments
        .map(mapAssignment)
        .sort((a, b) => Number(a.id) - Number(b.id));
    },
    enabled: !!actor,
    refetchInterval: getGamePollMs(),
  });

  return {
    assignments: query.data ?? [],
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
  };
}
