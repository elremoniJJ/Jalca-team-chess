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
 * Cover for the paid-place skip added to `getMyPrize`, at the frontend consumer
 * seam.
 *
 * The accepted change is backend-only: `Prize.myPrize` takes a fourth `isPaid`
 * predicate and skips a place whose claim is `#paid`, while still returning
 * `#paying` places and unclaimed places. `getMyPrize` builds that predicate from
 * `PrizeClaim.findClaim` and passes it in. The frontend contract is unchanged:
 * `useMyPrize` calls `getMyPrize()` with no arguments and renders whatever it
 * returns.
 *
 * The observable consequence at this seam is the one the change produces: a
 * caller whose only place is already paid now receives `null` from
 * `getMyPrize`, so the window shows the "No prize to claim yet" empty state and
 * opens no congratulations modal. A caller with an unpaid place still receives
 * the prize and sees the modal. This file pins both halves of that consumer
 * contract, plus the no-argument call shape.
 *
 * The backend actor is a typed local mock throughout: this is
 * component/integration coverage, not deployed browser E2E. The real backend
 * behavior (the walk, the predicate, the ownership gate) is asserted in the
 * PocketIC backend lane, not here.
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
    claimPrize: (
      competition: bigint,
      rank: bigint,
      recipient: unknown,
    ) => Promise<unknown>;
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

import type { ClaimResult, CompStatus, MyPrize } from "@/backend";
import { ClaimState } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";

/* --- Fixtures ----------------------------------------------------------- */

/** A live competition status: Sunday 18 Oct 2026 00:00 UTC. */
const LIVE_STATUS: CompStatus = {
  live: true,
  // 2026-10-18T00:00:00Z in nanoseconds.
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 6n * 3_600n + 12n * 60n,
};

/**
 * An unpaid prize. The deadline is far in the future so the panel's
 * `Date.now() < deadline` claimable check holds regardless of the host clock:
 * the modal opens only for a claimable prize.
 */
const UNPAID_PRIZE: MyPrize = {
  sunday: 1_792_281_600_000_000_000n,
  rank: 1n,
  amountE8s: 72_525_000_000n,
  // 2100-01-01T00:00:00Z — far beyond any test host clock.
  deadline: 4_102_444_800_000_000_000n,
};

/** A paid claim result, so the modal settles if a claim is sent. */
const PAID_RESULT: ClaimResult = {
  state: ClaimState.paid,
  amountE8s: 0n,
  blockIndex: 42n,
};

interface ActorOverrides {
  myPrize?: MyPrize | null;
}

/** Build a typed actor fake with the leaderboard and prize methods. */
function makeActor(overrides: ActorOverrides = {}) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi.fn().mockResolvedValue([]),
    getSundayCompStatus: vi.fn().mockResolvedValue(LIVE_STATUS),
    getPastWinners: vi.fn().mockResolvedValue([]),
    getCurrentPrizePool: vi.fn().mockResolvedValue({
      poolE8s: 0n,
      firstPrizeE8s: 0n,
    }),
    getArchivedPrizePool: vi.fn().mockResolvedValue(null),
    getMyPrize: vi
      .fn()
      .mockResolvedValue(
        overrides.myPrize === undefined ? null : overrides.myPrize,
      ),
    getClaimStatus: vi.fn().mockResolvedValue({ claimable: null }),
    getFirstPrizeForSunday: vi.fn().mockResolvedValue(null),
    getUpcomingAllocationStatuses: vi.fn().mockResolvedValue([]),
    previewPrizeAllocation: vi.fn().mockResolvedValue(null),
    savePrizeAllocation: vi.fn().mockResolvedValue(null),
    clearPrizeAllocation: vi.fn().mockResolvedValue(null),
    claimPrize: vi.fn().mockResolvedValue(PAID_RESULT),
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

/* --- A paid place is skipped: getMyPrize returns null ------------------- */

describe("a paid place is skipped at the consumer seam", () => {
  it("shows the empty state and no modal when getMyPrize returns null", async () => {
    seedOpen();
    actorState.principal = "player-1";
    // The paid-skip change makes getMyPrize return null for a caller whose only
    // place is already paid. The window must show the empty state and open no
    // congratulations modal.
    actorState.actor = makeActor({ myPrize: null });
    const { container } = renderWindow();

    expect(
      await screen.findByText("No prize to claim yet"),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="leaderboard.my_prize.empty_state"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="leaderboard.claim.modal"]'),
    ).toBeNull();
  });

  it("reads the caller's own prize through getMyPrize() with no arguments", async () => {
    seedOpen();
    actorState.principal = "player-1";
    const actor = makeActor({ myPrize: null });
    actorState.actor = actor;
    renderWindow();

    // The predicate is built in the backend; the frontend still issues the same
    // no-argument update call.
    await waitFor(() => {
      expect(actor.getMyPrize).toHaveBeenCalledWith();
    });
  });
});

/* --- An unpaid place is still returned ---------------------------------- */

describe("an unpaid place is still returned at the consumer seam", () => {
  it("opens the modal for a returned unpaid prize", async () => {
    seedOpen();
    actorState.principal = "player-1";
    // A place that is not paid (claimable or paying) is still returned by
    // getMyPrize, so the modal opens with the stored amount and rank.
    actorState.actor = makeActor({ myPrize: UNPAID_PRIZE });
    renderWindow();

    const modal = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.claim.modal"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(
      within(modal).getByText("Congratulations — you won a prize!"),
    ).toBeInTheDocument();
    expect(
      within(modal).getByText(/You won 725.25 ICP for rank 1/),
    ).toBeInTheDocument();
  });
});
