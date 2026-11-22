import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the two admin-allocation acceptance criteria the sibling
 * leaderboard-prize-cover.test.tsx does not assert:
 *
 *   1. The full set of backend rejections. The acceptance criteria name three
 *      blocking rejections — a pool too small to cover the fees, a pool whose
 *      rank-10 prize rounds to zero, and a pool above the 20 ICP maximum — plus
 *      one non-blocking warning (low ranks paying less than the fee). The
 *      sibling file asserts only the too-small rejection and the warning; this
 *      file pins the other two rejection copies and that each one disables the
 *      confirm button.
 *
 *   2. Refresh without a page reload. After a save or a clear, the admin panel
 *      and the player view must update without a reload. The data layer
 *      (use-prize.ts) does this by invalidating the allocation statuses, the
 *      player-facing first prize and the current pool on success. This file
 *      asserts that invalidation through the real QueryClient the window uses,
 *      so a save/clear that stops refreshing the player view is caught.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real rejection computation and the
 * real save/clear are asserted in the PocketIC backend lane, not here.
 */

// The hook module imports useActorState from lib/backend-actor, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the actor seam directly, exactly as the existing leaderboard tests do.
const actorState = vi.hoisted(() => ({
  actor: null as {
    getWinnerRanking: (limit: bigint) => Promise<unknown>;
    getSundayCompStandings: (limit: bigint) => Promise<unknown>;
    getSundayCompStatus: () => Promise<unknown>;
    getPastWinners: () => Promise<unknown>;
    getCurrentPrizePool: () => Promise<unknown>;
    getArchivedPrizePool: (sunday: bigint) => Promise<unknown>;
    getMyPrize: () => Promise<unknown>;
    getClaimStatus: (sunday: bigint) => Promise<unknown>;
    getFirstPrizeForSunday: (sunday: bigint) => Promise<unknown>;
    getUpcomingAllocationStatuses: () => Promise<unknown>;
    previewPrizeAllocation: (poolE8s: bigint) => Promise<unknown>;
    savePrizeAllocation: (sunday: bigint, poolE8s: bigint) => Promise<unknown>;
    clearPrizeAllocation: (sunday: bigint) => Promise<unknown>;
  } | null,
  isLoading: false,
  error: null as Error | null,
  principal: null as string | null,
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: actorState.actor,
    isLoading: actorState.isLoading,
    error: actorState.error,
    retry: vi.fn(),
    principal: actorState.principal,
  }),
}));

import type {
  CompStatus,
  PrizePool,
  PrizePreviewResult,
  SundayAllocationStatus,
} from "@/backend";
import { ClaimStatus as ClaimStatusEnum, PrizeRejection } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import {
  CURRENT_PRIZE_POOL_QUERY_KEY,
  FIRST_PRIZE_FOR_SUNDAY_QUERY_KEY,
  UPCOMING_ALLOCATION_STATUSES_QUERY_KEY,
} from "@/hooks/use-prize";
import { ADMIN_PRINCIPAL } from "@/lib/prize-admin";

/* --- Fixtures ----------------------------------------------------------- */

/** A live competition status: Sunday 18 Oct 2026 00:00 UTC, 6h 12m remaining. */
const LIVE_STATUS: CompStatus = {
  live: true,
  // 2026-10-18T00:00:00Z in nanoseconds.
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 6n * 3_600n + 12n * 60n,
};

/** A pool of 1,450.50 ICP with a first prize of 725.25 ICP. */
const POOL: PrizePool = {
  poolE8s: 145_050_000_000n,
  firstPrizeE8s: 72_525_000_000n,
};

/** The next upcoming Sunday (UTC) the admin dropdown offers. */
const NEXT_SUNDAY = 1_792_886_400_000_000_000n; // 2026-10-25T00:00:00Z

/** The Sunday after that, for a second dropdown row. */
const FOLLOWING_SUNDAY = NEXT_SUNDAY + 604_800_000_000_000n;

/** Two upcoming Sundays, the first unallocated and the second allocated. */
const UPCOMING_STATUSES: SundayAllocationStatus[] = [
  { sunday: NEXT_SUNDAY, allocated: false, poolE8s: undefined },
  { sunday: FOLLOWING_SUNDAY, allocated: true, poolE8s: 1_000_000_000n },
];

/** A preview the backend rejects: the rank-10 prize rounds to zero. */
const RANK10_ZERO_PREVIEW: PrizePreviewResult = {
  preview: {
    firstPrizeE8s: 1_000n,
    rankPrizesE8s: [1_000n, 500n, 250n, 125n, 62n, 31n, 15n, 7n, 3n, 0n],
    prizesTotalE8s: 1_993n,
    feesTotalE8s: 100_000n,
    poolRequiredE8s: 101_993n,
  },
  rejections: [PrizeRejection.rank10RoundsToZero],
  warnings: [],
};

/** A preview the backend rejects: the pool is above the 20 ICP maximum. */
const ABOVE_MAX_PREVIEW: PrizePreviewResult = {
  preview: {
    firstPrizeE8s: 9_999_999_999n,
    rankPrizesE8s: [
      9_999_999_999n,
      4_999_999_999n,
      2_499_999_999n,
      1_249_999_999n,
      624_999_999n,
      312_499_999n,
      156_249_999n,
      78_124_999n,
      39_062_499n,
      19_531_249n,
    ],
    prizesTotalE8s: 19_980_468_740n,
    feesTotalE8s: 100_000n,
    poolRequiredE8s: 19_980_568_740n,
  },
  rejections: [PrizeRejection.aboveMaximumPool],
  warnings: [],
};

/** A clean preview for a 10 ICP pool, so the confirm button is enabled. */
const OK_PREVIEW: PrizePreviewResult = {
  preview: {
    firstPrizeE8s: 499_999_999n,
    rankPrizesE8s: [
      499_999_999n,
      249_999_999n,
      124_999_999n,
      62_499_999n,
      31_249_999n,
      15_624_999n,
      7_812_499n,
      3_906_249n,
      1_953_124n,
      976_562n,
    ],
    prizesTotalE8s: 999_023_428n,
    feesTotalE8s: 100_000n,
    poolRequiredE8s: 999_123_428n,
  },
  rejections: [],
  warnings: [],
};

interface ActorOverrides {
  preview?: PrizePreviewResult;
  saveResult?: unknown;
  clearResult?: unknown;
}

/** Build a typed actor fake with the leaderboard and prize methods. */
function makeActor(overrides: ActorOverrides = {}) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi.fn().mockResolvedValue([]),
    getSundayCompStatus: vi.fn().mockResolvedValue(LIVE_STATUS),
    getPastWinners: vi.fn().mockResolvedValue([]),
    getCurrentPrizePool: vi.fn().mockResolvedValue(POOL),
    getArchivedPrizePool: vi.fn().mockResolvedValue(null),
    getMyPrize: vi.fn().mockResolvedValue(null),
    getClaimStatus: vi.fn().mockResolvedValue(ClaimStatusEnum.claimable),
    getFirstPrizeForSunday: vi.fn().mockResolvedValue(72_525_000_000n),
    getUpcomingAllocationStatuses: vi.fn().mockResolvedValue(UPCOMING_STATUSES),
    previewPrizeAllocation: vi
      .fn()
      .mockResolvedValue(overrides.preview ?? OK_PREVIEW),
    savePrizeAllocation: vi.fn().mockResolvedValue(
      overrides.saveResult ?? {
        __kind__: "ok",
        ok: { sunday: NEXT_SUNDAY, allocated: true, poolE8s: 1_000_000_000n },
      },
    ),
    clearPrizeAllocation: vi.fn().mockResolvedValue(
      overrides.clearResult ?? {
        __kind__: "ok",
        ok: { sunday: NEXT_SUNDAY, allocated: false, poolE8s: undefined },
      },
    ),
  };
}

/** Render the window as the admin and wait for the allocation controls. */
async function renderAdminAllocation(overrides: ActorOverrides = {}) {
  window.localStorage.setItem("tco-leaderboard-open", "true");
  actorState.principal = ADMIN_PRINCIPAL;
  const actor = makeActor(overrides);
  actorState.actor = actor;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LeaderboardWindow />
    </QueryClientProvider>,
  );
  await screen.findByRole("combobox");
  return { actor, queryClient, ...view };
}

/** Select the first upcoming Sunday in the dropdown. */
async function selectFirstSunday() {
  await userEvent
    .setup()
    .selectOptions(screen.getByRole("combobox"), NEXT_SUNDAY.toString());
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  actorState.actor = null;
  actorState.isLoading = false;
  actorState.error = null;
  actorState.principal = null;
  vi.clearAllMocks();
});

/* --- The full rejection set --------------------------------------------- */

describe("Admin allocation rejections", () => {
  it("shows the rank-10-rounds-to-zero rejection and disables the confirm button", async () => {
    await renderAdminAllocation({ preview: RANK10_ZERO_PREVIEW });
    await selectFirstSunday();

    await userEvent
      .setup()
      .type(screen.getByLabelText("Total pool (ICP)"), "0.001");

    // The rejection copy is shown and the confirm button is disabled.
    expect(
      await screen.findByText("The rank-10 prize rounds to zero."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm total prize" }),
    ).toBeDisabled();
  });

  it("shows the above-maximum-pool rejection and disables the confirm button", async () => {
    await renderAdminAllocation({ preview: ABOVE_MAX_PREVIEW });
    await selectFirstSunday();

    await userEvent
      .setup()
      .type(screen.getByLabelText("Total pool (ICP)"), "200");

    // The rejection copy is shown and the confirm button is disabled.
    expect(
      await screen.findByText("The pool is above the maximum of 20 ICP."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm total prize" }),
    ).toBeDisabled();
  });

  it("keeps the confirm button enabled for a clean preview", async () => {
    await renderAdminAllocation({ preview: OK_PREVIEW });
    await selectFirstSunday();

    await userEvent
      .setup()
      .type(screen.getByLabelText("Total pool (ICP)"), "10");

    // No rejection copy is shown and the confirm button is enabled.
    await waitFor(() => {
      expect(
        document.querySelector(
          '[data-ocid="leaderboard.admin.allocation.preview"]',
        ),
      ).not.toBeNull();
    });
    expect(
      screen.queryByText("The rank-10 prize rounds to zero."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("The pool is above the maximum of 20 ICP."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm total prize" }),
    ).toBeEnabled();
  });
});

/* --- Refresh without a reload ------------------------------------------- */

describe("Admin save and clear refresh the panel and the player view", () => {
  it("invalidates the allocation statuses, the player first prize and the current pool after a save", async () => {
    const { actor, queryClient } = await renderAdminAllocation();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await selectFirstSunday();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Total pool (ICP)"), "10");

    const confirm = screen.getByRole("button", {
      name: "Confirm total prize",
    });
    // First press opens the second confirmation; the second press saves.
    await user.click(confirm);
    await user.click(confirm);

    await waitFor(() => {
      expect(actor.savePrizeAllocation).toHaveBeenCalledWith(
        NEXT_SUNDAY,
        1_000_000_000n,
      );
    });

    // The save invalidates the three keys the admin panel and the player view
    // read, so both refresh without a page reload.
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: UPCOMING_ALLOCATION_STATUSES_QUERY_KEY,
      });
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: FIRST_PRIZE_FOR_SUNDAY_QUERY_KEY,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: CURRENT_PRIZE_POOL_QUERY_KEY,
    });
  });

  it("invalidates the allocation statuses, the player first prize and the current pool after a clear", async () => {
    const { actor, queryClient } = await renderAdminAllocation();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    // Select the second Sunday, which is already allocated.
    await userEvent
      .setup()
      .selectOptions(screen.getByRole("combobox"), FOLLOWING_SUNDAY.toString());

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Clear allocation" }));

    await waitFor(() => {
      expect(actor.clearPrizeAllocation).toHaveBeenCalledWith(FOLLOWING_SUNDAY);
    });

    // The clear invalidates the same three keys, so the panel and the player
    // view refresh without a page reload.
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: UPCOMING_ALLOCATION_STATUSES_QUERY_KEY,
      });
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: FIRST_PRIZE_FOR_SUNDAY_QUERY_KEY,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: CURRENT_PRIZE_POOL_QUERY_KEY,
    });
  });

  it("refetches the player-facing first prize after a save so the player view updates", async () => {
    const { actor } = await renderAdminAllocation();
    await selectFirstSunday();

    // The player-facing first-prize read has already run once for the Sunday.
    await waitFor(() => {
      expect(actor.getFirstPrizeForSunday).toHaveBeenCalled();
    });
    const callsBefore = actor.getFirstPrizeForSunday.mock.calls.length;

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Total pool (ICP)"), "10");
    const confirm = screen.getByRole("button", {
      name: "Confirm total prize",
    });
    await user.click(confirm);
    await user.click(confirm);

    await waitFor(() => {
      expect(actor.savePrizeAllocation).toHaveBeenCalled();
    });

    // The invalidation refetches the player-facing first prize, so the player
    // view picks up the new allocation without a reload.
    await waitFor(() => {
      expect(actor.getFirstPrizeForSunday.mock.calls.length).toBeGreaterThan(
        callsBefore,
      );
    });
  });
});
