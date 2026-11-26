import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import type { BoardFrameList } from "../backend";
import { useActorState } from "../lib/backend-actor";

/**
 * useBoardFrames - the saved board positions of the current game (start of
 * game, after every move, after every spell) for the replay buttons.
 *
 * The list is fetched again only when `changeKey` changes (the game poll
 * sees a new move or spell), not on a timer, so it costs nothing while the
 * board is quiet. Query calls are free in cycles anyway.
 */
export function useBoardFrames(enabled: boolean, changeKey: string) {
  const { actor } = useActorState();
  const query = useQuery<BoardFrameList>({
    queryKey: ["boardFrames"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getBoardFrames();
    },
    enabled: !!actor && enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const refetch = query.refetch;
  // biome-ignore lint/correctness/useExhaustiveDependencies: changeKey is the trigger
  useEffect(() => {
    if (actor && enabled) void refetch();
  }, [changeKey, actor, enabled, refetch]);
  return query.data ?? null;
}
