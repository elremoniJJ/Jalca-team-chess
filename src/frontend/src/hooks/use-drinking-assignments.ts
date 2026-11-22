import { useQuery } from "@tanstack/react-query";
import type {
  PieceType as BackendPieceType,
  TriggerType as BackendTriggerType,
  DrinkingAssignment,
} from "../backend";
import { useActorState } from "../lib/backend-actor";
import { getGamePollMs } from "../lib/poll-interval";
import type { DrinkingToast, PieceType, TriggerType } from "../types/drinking";

/*
 * useDrinkingAssignments — the isolated retrieve-computation read path for
 * the drinking-game feature, parallel to use-exercise-assignments.ts.
 *
 * Per the spec, the frontend must RETRIEVE drinking assignments from the
 * backend's retrieve-computation entry point (getDrinkingAssignments)
 * rather than deriving them locally from the polled game state. This hook
 * polls actor.getDrinkingAssignments() at the shared game cadence
 * (getGamePollMs(): 1500ms for players, 5000ms for spectators) via React
 * Query and returns the list mapped to the local DrinkingToast shape.
 *
 * The backend drinking methods (createDrinkingAssignment,
 * getDrinkingAssignments, removeLastDrinkingAssignment, getDrinkingStats)
 * and the DrinkingAssignment / PieceType / Team / DrinkingStats types are
 * generated into backend.d.ts, and the actor returned by useActorState() is
 * already typed as the generated Backend interface. We therefore call the
 * generated method directly and map from the generated record — no local
 * actor interface and no cast.
 *
 * Backend → frontend mapping (per the dispatch contract):
 *   - id            = String(assignment.index)
 *   - team          = assignment.lostTeam  (#White → "white", #Black → "black")
 *   - drinks        = Number(assignment.drinks)
 *   - capturedPiece = map PieceType (#Pawn → "pawn", #Knight → "knight",
 *                    #Bishop → "bishop", #Rook → "rook", #Queen → "queen",
 *                    #King → "king" — the backend's pieceModifier maps
 *                    #King -> 5 drinks to extend the pawn1..queen4
 *                    progression, so a king capture surfaces 5 drinks in
 *                    the toast UI)
 *   - trigger       = assignment.trigger  (#Capture → "Capture",
 *                    #EnPassant → "EnPassant"; defaults to "Capture" when
 *                    undefined for backward compat with assignments
 *                    written before the trigger field landed)
 *
 * The hook returns the assignments already mapped to DrinkingToast[] so
 * the route can diff against its shown-indices ref and push new toasts.
 * The list is sorted by index ascending (capture sequence) so the route
 * preserves the order in which captures occurred.
 */

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

function mapAssignment(assignment: DrinkingAssignment): DrinkingToast {
  return {
    id: String(assignment.index),
    team: assignment.lostTeam === "White" ? "white" : "black",
    drinks: Number(assignment.drinks),
    capturedPiece: mapPieceType(assignment.capturedPiece),
    trigger: mapTrigger(assignment.trigger),
    moveIndex: Number(assignment.moveIndex),
  };
}

/** Shared React Query keys for the drinking feature. */
export const DRINKING_QUERY_KEYS = {
  assignments: ["drinkingAssignments"] as const,
};

/**
 * Polls the backend's retrieve-computation entry point
 * (getDrinkingAssignments) at the shared game cadence and returns the
 * assignments mapped to the local DrinkingToast shape, sorted by capture
 * index ascending.
 *
 * The hook is always enabled (the route gates toast *display* on the
 * three-state mode selector, but retrieval continues regardless so
 * toggling to Drinking mid-game surfaces already-collected assignments
 * without a refetch delay). Per the spec, switching modes clears the
 * other mode's toasts for a clean slate — retrieval continuing while
 * another mode is active is harmless (the route simply does not push new
 * drinking toasts while the mode is not Drinking).
 */
export function useDrinkingAssignments() {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<DrinkingToast[], Error>({
    queryKey: DRINKING_QUERY_KEYS.assignments,
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      const assignments = await actor.getDrinkingAssignments();
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
