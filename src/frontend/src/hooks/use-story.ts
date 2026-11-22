import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StoryRow } from "../backend";
import { useActorState } from "../lib/backend-actor";

/**
 * use-story — the data layer for the Story window.
 *
 * The story is deliberately NOT part of the 1500ms game poll. This hook uses
 * its own React Query with NO `refetchInterval`, and the query is enabled ONLY
 * while the Story panel is open (`enabled` flag). When the panel is collapsed
 * the query is disabled, so no request runs and the story text/counters are
 * never fetched on the game poll.
 *
 * Mutations (append / fill / delete-press / keep-press) invalidate the story
 * query on success so the panel refetches the authoritative section list.
 *
 * Voting is one-per-principal-per-section, enforced server-side. Each
 * `StoryRow` carries caller-relative `hasVotedDelete` / `hasVotedKeep` flags,
 * so after a successful press the invalidated refetch returns the caller's own
 * vote state and the UI can lock the controls. Anonymous callers are rejected
 * by the backend; the UI additionally disables the controls when signed out.
 */

export const STORY_QUERY_KEY = ["storySections"] as const;

/**
 * The caller-relative cache key. `getStorySections` returns per-principal
 * `hasVotedDelete` / `hasVotedKeep` flags, so the cached rows are only valid
 * for the principal that fetched them. Including the principal in the key
 * means signing out and signing in as a different principal reads a distinct
 * cache entry instead of the previous principal's vote locks.
 */
export function storyQueryKey(caller: string | null) {
  return [...STORY_QUERY_KEY, caller ?? "anonymous"] as const;
}

/**
 * Fetch the ordered story sections. `enabled` is the panel-open flag — pass
 * `false` while the Story window is collapsed so no request is issued.
 *
 * `caller` is the signed-in principal (or null when signed out). It is part of
 * the query key so the caller-relative vote flags never leak between
 * principals, and it is a dependency of the query so signing in/out refetches.
 */
export function useStorySections(enabled: boolean, caller: string | null) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<StoryRow[], Error>({
    queryKey: storyQueryKey(caller),
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getStorySections();
    },
    // No refetchInterval — the story must never join the game poll.
    enabled: enabled && !!actor,
  });

  return {
    sections: query.data ?? [],
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}

/** Writer-only: append a new section of story text. */
export function useAppendStorySection() {
  const { actor } = useActorState();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.appendStorySection(text);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORY_QUERY_KEY });
    },
  });
}

/** Writer-only: fill a deleted section's gap with new text. */
export function useFillStoryGap() {
  const { actor } = useActorState();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ index, text }: { index: bigint; text: string }) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.fillStoryGap(index, text);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORY_QUERY_KEY });
    },
  });
}

/**
 * Public: press Delete on a section (removes it only at the threshold).
 * Rejected server-side if the caller's principal already voted on the section.
 */
export function usePressStoryDelete() {
  const { actor } = useActorState();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (index: bigint) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.pressStoryDelete(index);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORY_QUERY_KEY });
    },
  });
}

/**
 * Public: press Keep on a section (raises the Keep counter).
 * Rejected server-side if the caller's principal already voted on the section.
 */
export function usePressStoryKeep() {
  const { actor } = useActorState();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (index: bigint) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.pressStoryKeep(index);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORY_QUERY_KEY });
    },
  });
}
