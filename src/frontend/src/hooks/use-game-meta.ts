import { useQuery } from "@tanstack/react-query";
import { useActorState } from "../lib/backend-actor";
import { getGamePollMs } from "../lib/poll-interval";

/**
 * useGameMeta — polls the backend's `getGameNumber` query every 1500ms,
 * matching the cadence already used by `use-game-state.ts` and
 * `use-game-record.ts` so all backend reads stay on the same poll beat.
 *
 * Returns:
 *  - `gameNumber`: bigint | null — the current game number (e.g. 5n).
 *  - `isLoading`: true while the actor initializes OR the first fetch is in
 *    flight with no cached value yet.
 *  - `error`: the first error from the query (or the actor).
 */
export function useGameMeta(_principal: string) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const numberQuery = useQuery<bigint>({
    queryKey: ["gameNumber"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getGameNumber();
    },
    enabled: !!actor,
    refetchInterval: getGamePollMs(),
  });

  // Loading while the actor initializes OR the first fetch is in flight with
  // no cached value yet. Once the query has data, subsequent background
  // refetches do NOT flip loading back.
  const isLoading =
    actorLoading || (numberQuery.isLoading && !numberQuery.error);

  const error = actorError ?? numberQuery.error;

  return {
    gameNumber: numberQuery.data ?? null,
    isLoading,
    error,
  };
}
