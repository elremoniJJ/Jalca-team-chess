import { useQuery } from "@tanstack/react-query";
import type { MintAttemptGroup } from "../backend";
import { useActorState } from "../lib/backend-actor";
import { getGamePollMs } from "../lib/poll-interval";

/**
 * useMintAttemptsByGame — polls the backend's `getMintAttemptsByGame()`
 * query every 1500ms, matching the cadence already used by
 * `use-game-state.ts` / `use-game-record.ts` / `use-game-meta.ts` so all
 * backend reads stay on the same poll beat.
 *
 * The backend retains mint attempts across games (capped at the 10 most
 * recent distinct game numbers) and returns them grouped by game, most
 * recent game first. The game conclusion modal selects the group matching
 * the current game number, so the indication reflects the current game's
 * attempts and updates when a new game concludes.
 *
 * Returns:
 *  - `groups`: MintAttemptGroup[] — the retained attempts grouped by game
 *    (empty array while loading or when nothing has been recorded).
 *  - `isLoading`: true while the actor initializes OR the first fetch is in
 *    flight with no cached value yet.
 *  - `error`: the first error from the query (or the actor).
 */
export function useMintAttemptsByGame() {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<MintAttemptGroup[]>({
    queryKey: ["mintAttemptsByGame"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getMintAttemptsByGame();
    },
    enabled: !!actor,
    refetchInterval: getGamePollMs(),
  });

  return {
    groups: query.data ?? [],
    isLoading:
      actorLoading ||
      (query.isLoading && !query.error && query.data === undefined),
    error: actorError ?? query.error,
  };
}
