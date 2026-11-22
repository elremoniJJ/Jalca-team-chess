import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GameSettingsSnapshot,
  NextGameSettings,
  Vote,
  VoteTally,
} from "../backend";
import { getActor, useActorState } from "../lib/backend-actor";
import { getGamePollMs } from "../lib/poll-interval";

/**
 * useVoteTally — polls the backend `getVoteTally()` every 1500ms (matching
 * the cadence of the other game hooks) so the voting window always reflects
 * the live per-option counts and the current winning settings.
 *
 * Returns:
 *  - `tally`: VoteTally | null — the live vote counts + winning settings.
 *  - `isLoading`: true while the actor initializes or the first fetch is in
 *    flight with no cached value yet.
 *  - `error`: the first error from the query (or the actor).
 */
export function useVoteTally() {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const tallyQuery = useQuery<VoteTally>({
    queryKey: ["voteTally"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getVoteTally();
    },
    enabled: !!actor,
    refetchInterval: getGamePollMs(),
  });

  const isLoading = actorLoading || (tallyQuery.isLoading && !tallyQuery.error);

  return {
    tally: tallyQuery.data ?? null,
    isLoading,
    error: actorError ?? tallyQuery.error,
  };
}

/**
 * useNextGameSettings — fetches the backend `getNextGameSettings()` via
 * React Query, polling every 1500ms so the Game # popover always reflects
 * the settings that will be applied to the next game.
 *
 * Returns:
 *  - `settings`: NextGameSettings | null — the winning settings for the
 *    next game (starting position + spell use).
 *  - `isLoading`: true while the actor initializes or the first fetch is in
 *    flight with no cached value yet.
 *  - `error`: the first error from the query (or the actor).
 */
export function useNextGameSettings() {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const settingsQuery = useQuery<NextGameSettings>({
    queryKey: ["nextGameSettings"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getNextGameSettings();
    },
    enabled: !!actor,
    refetchInterval: getGamePollMs(),
  });

  const isLoading =
    actorLoading || (settingsQuery.isLoading && !settingsQuery.error);

  return {
    settings: settingsQuery.data ?? null,
    isLoading,
    error: actorError ?? settingsQuery.error,
  };
}

/**
 * useGameSettingsSnapshot — fetches the backend `getGameSettingsSnapshot()`
 * via React Query, polling every 1500ms so the fixed game summary stays fresh
 * across game transitions.
 *
 * The snapshot is the PERSISTED final tally of the previous game: the winning
 * options (startingPosition + spellUse) plus the four counts. It is fixed for
 * the duration of the current game, so it must NOT be replaced by the live
 * `useVoteTally()` counts.
 *
 * Returns:
 *  - `snapshot`: GameSettingsSnapshot | null — the persisted winning options
 *    and their final counts.
 *  - `isLoading`: true while the actor initializes or the first fetch is in
 *    flight with no cached value yet.
 *  - `error`: the first error from the query (or the actor).
 */
export function useGameSettingsSnapshot() {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const snapshotQuery = useQuery<GameSettingsSnapshot>({
    queryKey: ["gameSettingsSnapshot"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getGameSettingsSnapshot();
    },
    enabled: !!actor,
    refetchInterval: getGamePollMs(),
  });

  const isLoading =
    actorLoading || (snapshotQuery.isLoading && !snapshotQuery.error);

  return {
    snapshot: snapshotQuery.data ?? null,
    isLoading,
    error: actorError ?? snapshotQuery.error,
  };
}

/**
 * useCastVote — mutation that submits a single player's vote for the next
 * game's settings via `castVote(principal, vote)`. On success it invalidates
 * both the vote tally and the next-game-settings queries so the voting
 * window and the Game # popover refresh immediately.
 *
 * Returns the standard React Query mutation object (`mutate`, `isPending`,
 * `isError`, `error`, `reset`).
 */
export function useCastVote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      principal,
      vote,
    }: {
      principal: string;
      vote: Vote;
    }) => {
      const actor = await getActor();
      return actor.castVote(principal, vote);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["voteTally"] });
      void queryClient.invalidateQueries({ queryKey: ["nextGameSettings"] });
    },
  });
}
