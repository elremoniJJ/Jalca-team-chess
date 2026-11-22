import { useQuery } from "@tanstack/react-query";
import type {
  CompStandingRow,
  CompStatus,
  MyWins,
  PastWinnerRow,
  WinnerRankingRow,
} from "../backend";
import { useActorState } from "../lib/backend-actor";

/**
 * use-leaderboard — the data layer for the Leaderboard window.
 *
 * The window has two views, switched by an All time / Sunday comp toggle:
 *
 *   - All time  — the existing ranked board, `getWinnerRanking(limit)`.
 *   - Sunday comp — the current Sunday competition standings plus the archive
 *     of past winners.
 *
 * None of these queries join the 1500ms game poll: each uses its own React
 * Query with NO `refetchInterval`, and each is enabled ONLY while the
 * Leaderboard panel is open (`enabled` flag). When the panel is collapsed the
 * queries are disabled, so no request runs.
 *
 * The backend query `getWinnerRanking(limit)` is reused as-is: it returns the
 * top rows ordered by wins descending (then earliest last-win), capped at 50
 * server-side, carries no principals, and marks `isMe` true only for the
 * caller. The frontend requests the maximum of 50 so the panel shows the top
 * 50 entries.
 *
 * Refresh: the panel refetches when it is opened (the query is enabled on open
 * and React Query refetches a stale/disabled→enabled query) and again after a
 * game concludes (the route calls `refetch` on the celebration transition), so
 * a fresh win appears without a page reload.
 */

/** The maximum number of ranking rows the panel shows (matches the server cap). */
export const LEADERBOARD_LIMIT = 50n;

export const LEADERBOARD_QUERY_KEY = ["winnerRanking"] as const;

/**
 * Fetch the ranked leaderboard. `enabled` is the panel-open flag — pass `false`
 * while the Leaderboard window is collapsed so no request is issued.
 */
export function useLeaderboard(enabled: boolean) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<WinnerRankingRow[], Error>({
    queryKey: LEADERBOARD_QUERY_KEY,
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getWinnerRanking(LEADERBOARD_LIMIT);
    },
    // No refetchInterval — the leaderboard must never join the game poll.
    enabled: enabled && !!actor,
  });

  return {
    rows: query.data ?? [],
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}

/* --- Sunday comp -------------------------------------------------------- */

/** The maximum number of Sunday-comp standings rows the panel shows. */
export const SUNDAY_COMP_LIMIT = 50n;

export const SUNDAY_COMP_STANDINGS_QUERY_KEY = ["sundayCompStandings"] as const;
export const SUNDAY_COMP_STATUS_QUERY_KEY = ["sundayCompStatus"] as const;
export const PAST_WINNERS_QUERY_KEY = ["pastWinners"] as const;
export const MY_WINS_QUERY_KEY = ["myWins"] as const;

/**
 * Fetch the current Sunday competition standings.
 *
 * `getSundayCompStandings` is an UPDATE call (not a query): the backend
 * finalizes the archive lazily on read, so it must be invoked as a mutation-
 * style update. React Query still drives it here — the call is idempotent and
 * the result is cached under its own key.
 *
 * `enabled` is the panel-open flag; pass `false` while the window is collapsed
 * so no request is issued.
 */
export function useSundayCompStandings(enabled: boolean) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<CompStandingRow[], Error>({
    queryKey: SUNDAY_COMP_STANDINGS_QUERY_KEY,
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getSundayCompStandings(SUNDAY_COMP_LIMIT);
    },
    // No refetchInterval — the standings must never join the game poll.
    enabled: enabled && !!actor,
  });

  return {
    rows: query.data ?? [],
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}

/**
 * Fetch the competition status: whether a competition is live, the seconds
 * remaining, and the Sunday (UTC) the status refers to. This is a plain query
 * on the backend.
 */
export function useSundayCompStatus(enabled: boolean) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<CompStatus, Error>({
    queryKey: SUNDAY_COMP_STATUS_QUERY_KEY,
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getSundayCompStatus();
    },
    enabled: enabled && !!actor,
  });

  return {
    status: query.data ?? null,
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}

/**
 * Fetch the signed-in caller's own competition wins and rank.
 *
 * `getMyWins` is a plain backend query that returns ONLY the caller's own
 * `{ wins, rank }` — it carries no principal and no name, so the Comp view
 * pairs it with the caller's own standings row (the `isMe` row) for the
 * credited name and with the identity the app already holds for the principal.
 *
 * `enabled` is the panel-open flag combined with the signed-in gate: pass
 * `false` while the window is collapsed or the caller is a guest, so no request
 * is issued. Like the other leaderboard reads it has NO `refetchInterval`, so it
 * never joins the 1500ms game poll.
 */
export function useMyWins(enabled: boolean) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<MyWins, Error>({
    queryKey: MY_WINS_QUERY_KEY,
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getMyWins();
    },
    enabled: enabled && !!actor,
  });

  return {
    myWins: query.data ?? null,
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}

/**
 * Fetch the archive of past competition winners, newest first.
 *
 * `getPastWinners` is an UPDATE call (not a query): the backend finalizes the
 * archive lazily on read, so it must be invoked as a mutation-style update.
 * React Query still drives it here — the call is idempotent and the result is
 * cached under its own key.
 */
export function usePastWinners(enabled: boolean) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<PastWinnerRow[], Error>({
    queryKey: PAST_WINNERS_QUERY_KEY,
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getPastWinners();
    },
    enabled: enabled && !!actor,
  });

  return {
    rows: query.data ?? [],
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}
