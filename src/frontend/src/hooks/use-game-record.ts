import { useQuery } from "@tanstack/react-query";
import type { GamePhase } from "../backend";
import { useActorState } from "../lib/backend-actor";
import { getGamePollMs } from "../lib/poll-interval";
import type { GameRecord } from "../types/chess";

/**
 * useGameRecord — fetches the backend `getGameRecord()` via React Query,
 * polling every 1500ms (matching `use-game-state`) while the game phase
 * is `Playing`, `Celebration`, or `Draw`. Polling stops when the phase is
 * undefined or `Paused`, so we don't burn cycles before the game starts.
 *
 * Polling during `Playing` is required so the captured-piece pop-up can
 * resolve each captured piece's associated challenge mid-game: the join
 * in `CapturedTray` needs the `RecordedMove[]` from `getGameRecord`,
 * which carries the `index` and `capturedPiece` fields used to link a
 * captured piece to its `DrinkingAssignment`/`ExerciseAssignment`.
 *
 * The hook is phase-driven: pass the current `phase` from the live game
 * state snapshot. When the phase transitions into a polled state, the
 * query enables and starts polling; when it transitions to a non-polled
 * state (e.g. Paused), the query disables and the cached record stays
 * available but is no longer refetched.
 *
 * Returns the `GameRecord` data plus a `loading` flag that is true while
 * the actor is initializing OR the first fetch is in flight (and no cached
 * record exists yet).
 */
export function useGameRecord(phase: GamePhase | undefined) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  // Poll during active play AND terminal/celebration phases. `enabled`
  // gates both the initial fetch and `refetchInterval`, so when the phase
  // is undefined or Paused polling stops automatically. Polling during
  // Playing is required so the captured-piece pop-up can resolve each
  // captured piece's associated challenge mid-game (the join needs the
  // RecordedMove[] from getGameRecord, which carries index+capturedPiece).
  const shouldPoll =
    phase !== undefined &&
    (phase === "Playing" || phase === "Celebration" || phase === "Draw");

  const query = useQuery<GameRecord>({
    queryKey: ["gameRecord"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getGameRecord() as Promise<GameRecord>;
    },
    enabled: !!actor && shouldPoll,
    refetchInterval: shouldPoll ? getGamePollMs() : false,
  });

  return {
    data: query.data ?? null,
    // Loading while the actor initializes OR the first fetch is in flight
    // with no cached record yet. Once we have data, subsequent background
    // refetches do NOT flip loading back to true.
    loading:
      actorLoading ||
      (query.isLoading && !query.error && query.data === undefined),
    error: actorError ?? query.error,
  };
}
