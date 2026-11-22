import type { Principal } from "@icp-sdk/core/principal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminCompetitionDate,
  AdminCompetitionDetail,
  AdminPrizeOverview__1,
  AllocationResult,
  ArchivedPrizePool,
  ClaimResult,
  ClaimStatus,
  FinalizeReport,
  MyPrize,
  PrizeBalancesResult,
  PrizePool,
  PrizePreviewResult,
  SundayAllocationStatus,
} from "../backend";
import { useActorState } from "../lib/backend-actor";
import {
  PAST_WINNERS_QUERY_KEY,
  SUNDAY_COMP_STANDINGS_QUERY_KEY,
  SUNDAY_COMP_STATUS_QUERY_KEY,
} from "./use-leaderboard";

/**
 * use-prize — the data layer for the prize reads added to the Leaderboard
 * window.
 *
 * Four reads, each its own React Query with NO `refetchInterval` and enabled
 * ONLY while the surface that shows it is visible, so the prize reads never
 * join the 1500ms game poll:
 *
 *   - `getCurrentPrizePool()` — the current competition's pool and first
 *     prize. Shown in the Sunday comp view and the admin panel.
 *   - `getArchivedPrizePool(sunday)` — an archived competition's pool and
 *     first prize. Used by the player's "my prize" view for a past
 *     competition.
 *   - `getMyPrize()` — the signed-in caller's own claimable prize for the
 *     current or a recent competition, or none. An UPDATE call (the backend
 *     finalizes the archive lazily on read) and signed-in only: it traps for
 *     anonymous callers, so it is enabled only when a signed-in principal is
 *     present.
 *   - `getClaimStatus(sunday)` — whether a prize is claimable or expired at
 *     the current time.
 *   - `getFirstPrizeForSunday(sunday)` — the player-facing first prize for a
 *     Sunday, or none when that Sunday has no allocation. This is the ONLY
 *     prize figure the player view reads; it never returns the pool, the fees
 *     or any principal.
 *
 * The admin allocation surface adds three more:
 *
 *   - `getUpcomingAllocationStatuses()` — the next 8 upcoming Sundays (UTC,
 *     never today or past) with each Sunday's allocation status, for the admin
 *     dropdown. Admin-only on the backend.
 *   - `previewPrizeAllocation(poolE8s)` — the backend-computed preview figures
 *     (first prize, all ten rank prizes, prizes total, ten ledger fees, pool
 *     required) plus the rejections and warnings for a candidate total pool.
 *     Admin-only on the backend.
 *   - `savePrizeAllocation` / `clearPrizeAllocation` — the admin mutations that
 *     write and clear a Sunday's allocation. Both invalidate the allocation
 *     statuses, the player-facing first prize and the current pool so the admin
 *     panel and the player view refresh without a page reload.
 *
 * Every hook tolerates an actor that does not expose the prize method (for
 * example a test double or an older binding): the query resolves to a null /
 * empty result instead of throwing, so the surrounding window keeps rendering.
 */

/* --- Current competition pool ------------------------------------------- */

export const CURRENT_PRIZE_POOL_QUERY_KEY = ["currentPrizePool"] as const;

/**
 * Fetch the current competition's prize pool and first-prize amount.
 * `enabled` is the surface-visible flag — pass `false` while the surface that
 * shows it is hidden so no request is issued.
 */
export function useCurrentPrizePool(enabled: boolean) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<PrizePool | null, Error>({
    queryKey: CURRENT_PRIZE_POOL_QUERY_KEY,
    queryFn: async () => {
      if (!actor || typeof actor.getCurrentPrizePool !== "function")
        return null;
      return actor.getCurrentPrizePool();
    },
    // No refetchInterval — the prize reads must never join the game poll.
    enabled: enabled && !!actor,
  });

  return {
    pool: query.data ?? null,
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}

/* --- Archived competition pool ------------------------------------------ */

export const ARCHIVED_PRIZE_POOL_QUERY_KEY = ["archivedPrizePool"] as const;

/**
 * Fetch an archived competition's prize pool and first-prize amount, or null
 * when the competition has no archived pool. `sunday` is the competition's
 * Sunday (UTC) timestamp; pass null to disable the read.
 */
export function useArchivedPrizePool(sunday: bigint | null, enabled: boolean) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<ArchivedPrizePool | null, Error>({
    queryKey: [...ARCHIVED_PRIZE_POOL_QUERY_KEY, sunday?.toString() ?? "none"],
    queryFn: async () => {
      if (sunday === null) return null;
      if (!actor || typeof actor.getArchivedPrizePool !== "function")
        return null;
      return actor.getArchivedPrizePool(sunday);
    },
    enabled: enabled && sunday !== null && !!actor,
  });

  return {
    pool: query.data ?? null,
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}

/* --- The caller's own prize --------------------------------------------- */

export const MY_PRIZE_QUERY_KEY = ["myPrize"] as const;

/**
 * Fetch the signed-in caller's own claimable prize for the current or a recent
 * competition, or null. `getMyPrize` is an UPDATE call and traps for anonymous
 * callers, so `enabled` must be false while signed out. `signedIn` is the
 * caller's signed-in flag; the read is issued only when both `enabled` and
 * `signedIn` are true.
 */
export function useMyPrize(enabled: boolean, signedIn: boolean) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<MyPrize | null, Error>({
    queryKey: MY_PRIZE_QUERY_KEY,
    queryFn: async () => {
      if (!actor || typeof actor.getMyPrize !== "function") return null;
      return actor.getMyPrize();
    },
    enabled: enabled && signedIn && !!actor,
  });

  return {
    prize: query.data ?? null,
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}

/* --- Claim status ------------------------------------------------------- */

export const CLAIM_STATUS_QUERY_KEY = ["claimStatus"] as const;

/**
 * Fetch the claim status of a prize at the current time: claimable within its
 * window, expired after the deadline passes. `sunday` is the competition's
 * Sunday (UTC) timestamp; pass null to disable the read.
 */
export function useClaimStatus(sunday: bigint | null, enabled: boolean) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<ClaimStatus | null, Error>({
    queryKey: [...CLAIM_STATUS_QUERY_KEY, sunday?.toString() ?? "none"],
    queryFn: async () => {
      if (sunday === null) return null;
      if (!actor || typeof actor.getClaimStatus !== "function") return null;
      return actor.getClaimStatus(sunday);
    },
    enabled: enabled && sunday !== null && !!actor,
  });

  return {
    status: query.data ?? null,
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}

/* --- Player-facing first prize for a Sunday ----------------------------- */

export const FIRST_PRIZE_FOR_SUNDAY_QUERY_KEY = [
  "firstPrizeForSunday",
] as const;

/**
 * Fetch the player-facing first prize for a Sunday, or null when that Sunday
 * has no allocation. `getFirstPrizeForSunday` returns ONLY the first prize
 * amount — never the pool, the fees or any principal — so the player view can
 * show "First prize: X ICP" for allocated Sundays and nothing otherwise.
 * `sunday` is the competition's Sunday (UTC) timestamp; pass null to disable.
 */
export function useFirstPrizeForSunday(
  sunday: bigint | null,
  enabled: boolean,
) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<bigint | null, Error>({
    queryKey: [
      ...FIRST_PRIZE_FOR_SUNDAY_QUERY_KEY,
      sunday?.toString() ?? "none",
    ],
    queryFn: async () => {
      if (sunday === null) return null;
      if (!actor || typeof actor.getFirstPrizeForSunday !== "function")
        return null;
      return actor.getFirstPrizeForSunday(sunday);
    },
    enabled: enabled && sunday !== null && !!actor,
  });

  return {
    firstPrizeE8s: query.data ?? null,
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}

/* --- Admin allocation: upcoming Sundays --------------------------------- */

export const UPCOMING_ALLOCATION_STATUSES_QUERY_KEY = [
  "upcomingAllocationStatuses",
] as const;

/**
 * Fetch the allocation status of each of the next 8 upcoming Sundays (UTC,
 * never today or past), for the admin dropdown. `getUpcomingAllocationStatuses`
 * is admin-only on the backend and traps for any other caller, so `enabled`
 * must be false unless the caller is the admin principal.
 */
export function useUpcomingAllocationStatuses(enabled: boolean) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<SundayAllocationStatus[], Error>({
    queryKey: UPCOMING_ALLOCATION_STATUSES_QUERY_KEY,
    queryFn: async () => {
      if (!actor || typeof actor.getUpcomingAllocationStatuses !== "function")
        return [];
      return actor.getUpcomingAllocationStatuses();
    },
    enabled: enabled && !!actor,
  });

  return {
    statuses: query.data ?? [],
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}

/* --- Admin allocation: preview ------------------------------------------ */

export const PRIZE_PREVIEW_QUERY_KEY = ["prizePreview"] as const;

/**
 * Fetch the backend-computed preview for a candidate total pool: the first
 * prize, all ten rank prizes, the prizes total, the ten ledger fees and the
 * pool required, plus the rejections and warnings. The figures come from the
 * backend so the frontend never disagrees with what a save would compute.
 *
 * `poolE8s` is the candidate total pool in e8s; pass null to disable the read
 * (for example while the amount field is empty). Admin-only on the backend.
 */
export function usePrizePreview(poolE8s: bigint | null, enabled: boolean) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<PrizePreviewResult | null, Error>({
    queryKey: [...PRIZE_PREVIEW_QUERY_KEY, poolE8s?.toString() ?? "none"],
    queryFn: async () => {
      if (poolE8s === null) return null;
      if (!actor || typeof actor.previewPrizeAllocation !== "function")
        return null;
      return actor.previewPrizeAllocation(poolE8s);
    },
    enabled: enabled && poolE8s !== null && !!actor,
  });

  return {
    preview: query.data ?? null,
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}

/* --- Admin allocation: save and clear ----------------------------------- */

/**
 * Save an allocation for a Sunday from a total pool in e8s. On success the
 * allocation statuses, the player-facing first prize and the current pool are
 * invalidated so the admin panel and the player view refresh without a page
 * reload.
 *
 * `savePrizeAllocation` traps on a Sunday that has already started, so the
 * caller must catch the trap rather than branch on `#rejected` for that case.
 */
export function useSavePrizeAllocation() {
  const { actor } = useActorState();
  const queryClient = useQueryClient();

  return useMutation<
    AllocationResult,
    Error,
    { sunday: bigint; poolE8s: bigint }
  >({
    mutationFn: async ({ sunday, poolE8s }) => {
      if (!actor || typeof actor.savePrizeAllocation !== "function")
        throw new Error("Backend is not ready");
      return actor.savePrizeAllocation(sunday, poolE8s);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: UPCOMING_ALLOCATION_STATUSES_QUERY_KEY,
      });
      void queryClient.invalidateQueries({
        queryKey: FIRST_PRIZE_FOR_SUNDAY_QUERY_KEY,
      });
      void queryClient.invalidateQueries({
        queryKey: CURRENT_PRIZE_POOL_QUERY_KEY,
      });
    },
  });
}

/**
 * Clear the allocation for a Sunday. Available until that Sunday starts. On
 * success the allocation statuses, the player-facing first prize and the
 * current pool are invalidated so the admin panel and the player view refresh
 * without a page reload.
 *
 * `clearPrizeAllocation` traps on a Sunday that has already started, so the
 * caller must catch the trap.
 */
export function useClearPrizeAllocation() {
  const { actor } = useActorState();
  const queryClient = useQueryClient();

  return useMutation<AllocationResult, Error, { sunday: bigint }>({
    mutationFn: async ({ sunday }) => {
      if (!actor || typeof actor.clearPrizeAllocation !== "function")
        throw new Error("Backend is not ready");
      return actor.clearPrizeAllocation(sunday);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: UPCOMING_ALLOCATION_STATUSES_QUERY_KEY,
      });
      void queryClient.invalidateQueries({
        queryKey: FIRST_PRIZE_FOR_SUNDAY_QUERY_KEY,
      });
      void queryClient.invalidateQueries({
        queryKey: CURRENT_PRIZE_POOL_QUERY_KEY,
      });
    },
  });
}

/* --- Claim the caller's own prize --------------------------------------- */

/**
 * Claim the caller's own prize for `competition` at `rank`, paying `recipient`.
 *
 * The amount is never sent from the browser: the backend reads the stored prize
 * and calls the prize canister with it. The recipient is locked at the first
 * attempt, so a retry of a `paying` place must pass the same recipient — the
 * caller passes the recipient it already recorded, never a freshly typed one.
 *
 * On success the caller's own prize and the admin claims overview are
 * invalidated so the player view and the admin panel refresh without a page
 * reload.
 */
export function useClaimPrize() {
  const { actor } = useActorState();
  const queryClient = useQueryClient();

  return useMutation<
    ClaimResult,
    Error,
    { competition: bigint; rank: bigint; recipient: Principal }
  >({
    mutationFn: async ({ competition, rank, recipient }) => {
      if (!actor || typeof actor.claimPrize !== "function")
        throw new Error("Backend is not ready");
      return actor.claimPrize(competition, rank, recipient);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_PRIZE_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: ADMIN_PRIZE_CLAIMS_QUERY_KEY,
      });
    },
  });
}

/* --- Admin claims overview ---------------------------------------------- */

export const ADMIN_PRIZE_CLAIMS_QUERY_KEY = ["adminPrizeClaims"] as const;

/**
 * Fetch the admin-only prize overview: for each competition, its unclaimed,
 * paying and paid prizes with the amount, the recipient principal for paid ones
 * and the block index. `getAdminPrizeClaims` is admin-only on the backend and
 * traps for any other caller, so `enabled` must be false unless the caller is
 * the admin principal.
 */
export function useAdminPrizeClaims(enabled: boolean) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<AdminPrizeOverview__1 | null, Error>({
    queryKey: ADMIN_PRIZE_CLAIMS_QUERY_KEY,
    queryFn: async () => {
      if (!actor || typeof actor.getAdminPrizeClaims !== "function")
        return null;
      return actor.getAdminPrizeClaims();
    },
    enabled: enabled && !!actor,
  });

  return {
    overview: query.data ?? null,
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}

/* --- Admin allocated competition dates (dropdown) ----------------------- */

export const ADMIN_ALLOCATED_DATES_QUERY_KEY = [
  "adminAllocatedCompetitionDates",
] as const;

/**
 * Fetch the competition dates that have a confirmed prize pool, newest first,
 * for the admin prize-claims dropdown. Covers every competition with a
 * confirmed pool — past, present and future. Each row carries the Sunday (UTC)
 * boundary and the stored total pool; no principals.
 *
 * `getAdminAllocatedCompetitionDates` is admin-only on the backend and traps
 * for any other caller, so `enabled` must be false unless the caller is the
 * admin principal.
 */
export function useAdminAllocatedCompetitionDates(enabled: boolean) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<AdminCompetitionDate[], Error>({
    queryKey: ADMIN_ALLOCATED_DATES_QUERY_KEY,
    queryFn: async () => {
      if (
        !actor ||
        typeof actor.getAdminAllocatedCompetitionDates !== "function"
      )
        return [];
      return actor.getAdminAllocatedCompetitionDates();
    },
    enabled: enabled && !!actor,
  });

  return {
    dates: query.data ?? [],
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}

/* --- Admin competition detail (selected date) --------------------------- */

export const ADMIN_COMPETITION_DETAIL_QUERY_KEY = [
  "adminCompetitionDetail",
] as const;

/**
 * Fetch the detail for one competition date selected in the admin
 * prize-claims dropdown: the confirmed pool prize and first prize, the past
 * winners (winner and runner-up names and win counts, each absent when there
 * are none), and the claim status buckets (unclaimed / paying / paid). An
 * upcoming competition with a confirmed pool shows no winners yet.
 *
 * `getAdminCompetitionDetail` is admin-only on the backend and traps for any
 * other caller, so `enabled` must be false unless the caller is the admin
 * principal. `sunday` is the competition's Sunday (UTC) timestamp; pass null to
 * disable the read.
 */
export function useAdminCompetitionDetail(
  sunday: bigint | null,
  enabled: boolean,
) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const query = useQuery<AdminCompetitionDetail | null, Error>({
    queryKey: [
      ...ADMIN_COMPETITION_DETAIL_QUERY_KEY,
      sunday?.toString() ?? "none",
    ],
    queryFn: async () => {
      if (sunday === null) return null;
      if (!actor || typeof actor.getAdminCompetitionDetail !== "function")
        return null;
      return actor.getAdminCompetitionDetail(sunday);
    },
    enabled: enabled && sunday !== null && !!actor,
  });

  return {
    detail: query.data ?? null,
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    refetch: query.refetch,
  };
}

/* --- Admin force-finalize ----------------------------------------------- */

/**
 * Force-finalize every competition whose day has fully passed, archiving each
 * one exactly once. `adminFinalizeCompetitions` is admin-only on the backend
 * and traps for any other caller, so the control that calls it is rendered only
 * for the admin principal.
 *
 * On success the Past winners archive, the current Sunday standings, the
 * competition status and the current pool are invalidated so the newly archived
 * rows and the reset standings appear without a page reload.
 *
 * Like the sibling hooks, the mutation tolerates an actor that does not expose
 * the method (a test double or an older binding): it rejects with a clear
 * message instead of throwing a TypeError.
 */
export function useAdminFinalizeCompetitions() {
  const { actor } = useActorState();
  const queryClient = useQueryClient();

  return useMutation<FinalizeReport, Error, void>({
    mutationFn: async () => {
      if (!actor || typeof actor.adminFinalizeCompetitions !== "function")
        throw new Error("Backend is not ready");
      return actor.adminFinalizeCompetitions();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PAST_WINNERS_QUERY_KEY });
      void queryClient.invalidateQueries({
        queryKey: SUNDAY_COMP_STANDINGS_QUERY_KEY,
      });
      void queryClient.invalidateQueries({
        queryKey: SUNDAY_COMP_STATUS_QUERY_KEY,
      });
      void queryClient.invalidateQueries({
        queryKey: CURRENT_PRIZE_POOL_QUERY_KEY,
      });
      void queryClient.invalidateQueries({
        queryKey: ADMIN_ALLOCATED_DATES_QUERY_KEY,
      });
      void queryClient.invalidateQueries({
        queryKey: ADMIN_COMPETITION_DETAIL_QUERY_KEY,
      });
    },
  });
}

/* --- Admin prize-canister funds check ----------------------------------- */

/**
 * Read the prize canister's ICP and cycles balances on demand.
 *
 * `getPrizeCanisterBalances` is admin-only on the backend and traps for any
 * other caller, so the control that calls it is rendered only for the admin
 * principal. It is a read-only check: it never moves funds and changes no
 * state.
 *
 * This is a mutation rather than a query because the check is triggered by an
 * explicit button press, not by mounting the panel — the admin decides when to
 * ask the prize canister. The mutation tolerates an actor that does not expose
 * the method (a test double or an older binding): it rejects with a clear
 * message instead of throwing a TypeError, so the panel shows its error state
 * rather than breaking.
 *
 * The backend returns a result type, not a trap: `{ __kind__: "ok", ok }` with
 * the balances, or `{ __kind__: "err", err }` with a failure message. The
 * caller unwraps it; a definite `err` is surfaced as a rejected mutation so the
 * panel can show the "did not answer" message.
 */
export function usePrizeCanisterBalances() {
  const { actor } = useActorState();

  return useMutation<PrizeBalancesResult, Error, void>({
    mutationFn: async () => {
      if (!actor || typeof actor.getPrizeCanisterBalances !== "function")
        throw new Error("Backend is not ready");
      return actor.getPrizeCanisterBalances();
    },
  });
}
