import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { KickResult, KickState } from "../backend";
import { getActor, useActorState } from "../lib/backend-actor";
import { getGamePollMs } from "../lib/poll-interval";

/**
 * unwrapKickResult — turns the backend `KickResult` variant into a resolved
 * value or a thrown Error. The backend rejects a vote with the `#err` variant
 * (e.g. "not on the same team", "wallet required"); throwing surfaces that
 * message through React Query's `error` / `onError` so the caller can show it
 * with `toast.error` instead of the rejection failing silently.
 */
function unwrapKickResult(result: KickResult): null {
  if (result.__kind__ === "err") {
    throw new Error(result.err);
  }
  return null;
}

/**
 * useKickState — polls the backend `getKickState()` every 1500ms (matching
 * the cadence of the other game hooks) so the players list always reflects
 * the live per-player kick counts and 'kicked by' arrays for every teammate.
 *
 * Returns:
 *  - `kickState`: KickState | null — the live kick state (per-player
 *    kickCount + kickedBy arrays), or null while loading.
 *  - `isLoading`: true while the actor initializes or the first fetch is in
 *    flight with no cached value yet.
 *  - `error`: the first error from the query (or the actor).
 */
export function useKickState() {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const kickQuery = useQuery<KickState>({
    queryKey: ["kickState"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getKickState();
    },
    enabled: !!actor,
    refetchInterval: getGamePollMs(),
  });

  const isLoading = actorLoading || (kickQuery.isLoading && !kickQuery.error);

  return {
    kickState: kickQuery.data ?? null,
    isLoading,
    error: actorError ?? kickQuery.error,
  };
}

/**
 * useCastKickVote — mutation that casts the caller's kick vote against a
 * target teammate via `castKickVote(principal, target)`. On success it
 * invalidates the kick-state query so the live counts / 'kicked by' arrays
 * refresh immediately. A backend `#err` rejection throws an Error carrying the
 * backend message, so the caller can surface it with `toast.error`.
 *
 * Returns the standard React Query mutation object (`mutate`, `isPending`,
 * `isError`, `error`, `reset`).
 */
export function useCastKickVote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      principal,
      target,
    }: {
      principal: string;
      target: string;
    }) => {
      const actor = await getActor();
      return unwrapKickResult(await actor.castKickVote(principal, target));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["kickState"] });
    },
  });
}

/**
 * useWithdrawKickVote — mutation that withdraws the caller's kick vote
 * against a target teammate via `withdrawKickVote(principal, target)`,
 * toggling the vote back off before it succeeds. On success it invalidates
 * the kick-state query so the live counts / 'kicked by' arrays refresh
 * immediately. A backend `#err` rejection throws an Error carrying the
 * backend message, so the caller can surface it with `toast.error`.
 *
 * Returns the standard React Query mutation object (`mutate`, `isPending`,
 * `isError`, `error`, `reset`).
 */
export function useWithdrawKickVote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      principal,
      target,
    }: {
      principal: string;
      target: string;
    }) => {
      const actor = await getActor();
      return unwrapKickResult(await actor.withdrawKickVote(principal, target));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["kickState"] });
    },
  });
}
