import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ResignState } from "../backend";
import { getActor, useActorState } from "../lib/backend-actor";
import { getGamePollMs } from "../lib/poll-interval";

/** The live resignation vote of both teams (polled while a game is on). */
export function useResignState(enabled: boolean) {
  const { actor } = useActorState();
  const query = useQuery<ResignState>({
    queryKey: ["resignState"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getResignState();
    },
    enabled: !!actor && enabled,
    refetchInterval: enabled ? getGamePollMs() : false,
  });
  return query.data ?? null;
}

function unwrap(result: string): string {
  // The backend answers "ok" or "resigned"; anything else is an error message.
  if (result !== "ok" && result !== "resigned") throw new Error(result);
  return result;
}

/** Vote to resign. Resolves "resigned" when this vote tipped it. */
export function useCastResignVote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ principal }: { principal: string }) => {
      const actor = await getActor();
      return unwrap(await actor.castResignVote(principal));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["resignState"] });
    },
  });
}

/** Take the resignation vote back. */
export function useWithdrawResignVote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ principal }: { principal: string }) => {
      const actor = await getActor();
      return unwrap(await actor.withdrawResignVote(principal));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["resignState"] });
    },
  });
}
