import { useQuery } from "@tanstack/react-query";
import type { BurnStateSnapshot } from "../backend";
import { useActorState } from "../lib/backend-actor";
import { getGamePollMs } from "../lib/poll-interval";

/**
 * useBurnState — polls the backend's `getBurnState` query every 1500ms
 * (matching the cadence of use-game-state / use-game-meta) and returns the
 * current per-turn burned-spell team-window state.
 *
 * The burn state is scoped to a single turn and never persists across turns
 * or sessions:
 *  - `burnOccurredThisTurn` tells the UI whether a burn already happened this
 *    turn, so all burn buttons disable until a new turn begins.
 *  - `whiteWindow` / `blackWindow` carry the burned spells (spell name + game
 *    number) to render into each team's embedded window.
 */
export function useBurnState() {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<BurnStateSnapshot>({
    queryKey: ["burnState"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getBurnState();
    },
    enabled: !!actor,
    refetchInterval: getGamePollMs(),
  });

  const isLoading = actorLoading || (query.isLoading && !query.error);
  const error = actorError ?? query.error;

  return {
    data: query.data,
    isLoading,
    error,
  };
}
