import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted change to the admin panel's prize figures:
 *
 *   The admin panel's "Current pool" and "First prize" now read the STORED
 *   Sunday allocation (5 ICP / 2.5 ICP for a 500,000,000 e8s / 250,000,000 e8s
 *   stored allocation) instead of the recomputed per-win pool (0.03 ICP /
 *   0.015 ICP). The stored pool is derived as twice the stored first prize,
 *   because the stored allocation's first prize is half its total pool.
 *
 * The backend actor is a typed local mock throughout: this is
 * component/integration coverage, not deployed browser E2E. The real stored
 * allocation read (`getFirstPrizeForSunday`) is asserted in the PocketIC
 * backend lane, not here.
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

import type { ClaimStatus, CompStatus } from "@/backend";
import { ClaimStatus as ClaimStatusEnum } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { ADMIN_PRINCIPAL } from "@/lib/prize-admin";

/** A live competition status: Sunday 18 Oct 2026 00:00 UTC. */
const LIVE_STATUS: CompStatus = {
  live: true,
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 6n * 3_600n + 12n * 60n,
};

/**
 * The stored Sunday allocation the acceptance criteria name: a 500,000,000 e8s
 * (5 ICP) total pool whose stored first prize is 250,000,000 e8s (2.5 ICP).
 * The admin panel derives the stored pool as twice the stored first prize.
 */
const STORED_FIRST_PRIZE_E8S = 250_000_000n;

/**
 * The recomputed per-win pool the admin panel must NO LONGER show: a 0.03 ICP
 * pool with a 0.015 ICP first prize. `getCurrentPrizePool` still returns it, so
 * a regression that reads the recomputed pool instead of the stored allocation
 * would render these figures.
 */
const RECOMPUTED_POOL = {
  poolE8s: 3_000_000n,
  firstPrizeE8s: 1_500_000n,
};

interface ActorOverrides {
  firstPrize?: bigint | null;
  claimStatus?: ClaimStatus | null;
}

/** Build a typed actor fake with the leaderboard and prize methods. */
function makeActor(overrides: ActorOverrides = {}) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi.fn().mockResolvedValue([]),
    getSundayCompStatus: vi.fn().mockResolvedValue(LIVE_STATUS),
    getPastWinners: vi.fn().mockResolvedValue([]),
    getCurrentPrizePool: vi.fn().mockResolvedValue(RECOMPUTED_POOL),
    getArchivedPrizePool: vi.fn().mockResolvedValue(null),
    getMyPrize: vi.fn().mockResolvedValue(null),
    getClaimStatus: vi
      .fn()
      .mockResolvedValue(
        overrides.claimStatus === undefined
          ? ClaimStatusEnum.claimable
          : overrides.claimStatus,
      ),
    getFirstPrizeForSunday: vi
      .fn()
      .mockResolvedValue(
        overrides.firstPrize === undefined ? null : overrides.firstPrize,
      ),
    getUpcomingAllocationStatuses: vi.fn().mockResolvedValue([]),
    previewPrizeAllocation: vi.fn().mockResolvedValue(null),
    savePrizeAllocation: vi.fn().mockResolvedValue(null),
    clearPrizeAllocation: vi.fn().mockResolvedValue(null),
  };
}

function renderWindow() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LeaderboardWindow />
    </QueryClientProvider>,
  );
}

/** Seed the panel open so the body mounts regardless of the default. */
function seedOpen() {
  window.localStorage.setItem("tco-leaderboard-open", "true");
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

describe("admin panel stored Sunday allocation", () => {
  it("shows the stored 5 ICP pool and 2.5 ICP first prize, not the recomputed 0.03 / 0.015 ICP", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      firstPrize: STORED_FIRST_PRIZE_E8S,
      claimStatus: ClaimStatusEnum.claimable,
    });
    const { container } = renderWindow();

    const panel = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.admin.panel"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // The stored allocation is 500,000,000 e8s (5 ICP) and 250,000,000 e8s
    // (2.5 ICP). The stored pool is derived as twice the stored first prize.
    expect(
      panel.querySelector('[data-ocid="leaderboard.admin.pool"]')?.textContent,
    ).toBe("5 ICP");
    expect(
      panel.querySelector('[data-ocid="leaderboard.admin.first_prize"]')
        ?.textContent,
    ).toBe("2.5 ICP");

    // The recomputed per-win figures never appear in the admin panel.
    expect(within(panel).queryByText("0.03 ICP")).not.toBeInTheDocument();
    expect(within(panel).queryByText("0.015 ICP")).not.toBeInTheDocument();
  });

  it("reads the stored first prize for the current competition's Sunday", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    const actor = makeActor({
      firstPrize: STORED_FIRST_PRIZE_E8S,
      claimStatus: ClaimStatusEnum.claimable,
    });
    actorState.actor = actor;
    renderWindow();

    // The stored allocation is read through the player-facing first-prize query
    // for the current Sunday, not through the recomputed pool read.
    await waitFor(() => {
      expect(actor.getFirstPrizeForSunday).toHaveBeenCalledWith(
        LIVE_STATUS.sunday,
      );
    });
  });

  it("shows 0 ICP for both figures when the Sunday has no stored allocation", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      firstPrize: null,
      claimStatus: null,
    });
    const { container } = renderWindow();

    const panel = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.admin.panel"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // No stored allocation: both figures read 0 ICP, never the recomputed pool.
    expect(
      panel.querySelector('[data-ocid="leaderboard.admin.pool"]')?.textContent,
    ).toBe("0 ICP");
    expect(
      panel.querySelector('[data-ocid="leaderboard.admin.first_prize"]')
        ?.textContent,
    ).toBe("0 ICP");
    expect(within(panel).queryByText("0.03 ICP")).not.toBeInTheDocument();
  });
});
