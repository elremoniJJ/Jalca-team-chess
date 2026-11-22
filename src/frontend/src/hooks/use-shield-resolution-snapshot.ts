import { useQuery } from "@tanstack/react-query";
import type { ShieldResolutionSnapshot } from "../backend";
import { useActorState } from "../lib/backend-actor";
import { getGamePollMs } from "../lib/poll-interval";

/**
 * useShieldResolutionSnapshot — polls the backend's
 * `getShieldResolutionSnapshot` query every 1500ms (matching the cadence of
 * use-burn-state / use-game-state) and returns the current per-team shield
 * totals plus `lastBurnAndPlay`, the most recent burn-and-play result.
 *
 * The route watches `lastBurnAndPlay` for a new burn (a change in the burn's
 * identity) and pushes one burn-and-play toast per burn. The shield totals
 * are also surfaced to the team windows in WalletConnectionWindow.
 */
export function useShieldResolutionSnapshot() {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<ShieldResolutionSnapshot>({
    queryKey: ["shieldResolutionSnapshot"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getShieldResolutionSnapshot();
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
