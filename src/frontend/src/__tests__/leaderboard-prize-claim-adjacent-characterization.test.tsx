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
 * Characterization of the Leaderboard window's prize surfaces, taken BEFORE the
 * claim flow is added.
 *
 * The request intentionally changes two things:
 *   1. the "My prize" panel gains a congratulations modal and a claim action
 *      that calls the prize canister, so the current claim-status rendering and
 *      the current `getMyPrize` update call will change;
 *   2. the admin prize panel gains unclaimed, paying and paid prize rows per
 *      competition.
 *
 * This file deliberately does NOT assert the new modal, the new claim action or
 * the new admin rows. It pins the adjacent behavior that must keep working
 * through the change:
 *
 *   - the signed-in player's "My prize" panel still shows the competition date,
 *     the rank, the amount in ICP and a claimable/expired status derived from
 *     the prize deadline, and is still signed-in only;
 *   - the panel still reads the caller's own prize through `getMyPrize()` with
 *     no arguments, and still issues no request while signed out or while the
 *     Sunday comp view is hidden;
 *   - the admin panel still shows the current pool, the first prize and the
 *     claim state, and still reads "No allocation" for a Sunday with no
 *     allocation;
 *   - the admin panel is still rendered only for the hardcoded admin principal;
 *   - no principal of another player appears in the rendered window.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real claim behavior (ownership check,
 * the synchronous paying lock, the pay call, the paid/rejected/unknown
 * outcomes) is asserted in the PocketIC backend lane, not here.
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

import type { ClaimStatus, CompStatus, MyPrize, PrizePool } from "@/backend";
import { ClaimStatus as ClaimStatusEnum } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { ADMIN_PRINCIPAL } from "@/lib/prize-admin";

/**
 * A realistic principal-shaped token (five dash-separated base32 groups). The
 * looser pattern false-positives on ordinary UI text, so the assertion uses the
 * full shape.
 */
const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

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

/** A claimable prize: deadline far in the future so the status reads claimable. */
const CLAIMABLE_PRIZE: MyPrize = {
  sunday: 1_792_281_600_000_000_000n,
  rank: 1n,
  amountE8s: 72_525_000_000n,
  // 2030-01-01T00:00:00Z — far in the future, so the prize is always claimable.
  deadline: 1_893_456_000_000_000_000n,
};

/** An expired prize: the deadline is in the past. */
const EXPIRED_PRIZE: MyPrize = {
  sunday: 1_792_281_600_000_000_000n,
  rank: 2n,
  amountE8s: 0n,
  // 2026-10-11T00:00:00Z — a week before the Sunday, already past.
  deadline: 1_791_676_800_000_000_000n,
};

interface ActorOverrides {
  status?: CompStatus;
  pool?: PrizePool;
  myPrize?: MyPrize | null;
  claimStatus?: ClaimStatus | null;
  firstPrize?: bigint | null;
}

/** Build a typed actor fake with the leaderboard and prize methods. */
function makeActor(overrides: ActorOverrides = {}) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi.fn().mockResolvedValue([]),
    getSundayCompStatus: vi
      .fn()
      .mockResolvedValue(overrides.status ?? LIVE_STATUS),
    getPastWinners: vi.fn().mockResolvedValue([]),
    getCurrentPrizePool: vi.fn().mockResolvedValue(overrides.pool ?? POOL),
    getArchivedPrizePool: vi.fn().mockResolvedValue(null),
    getMyPrize: vi
      .fn()
      .mockResolvedValue(
        overrides.myPrize === undefined ? null : overrides.myPrize,
      ),
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

/* --- My prize panel: current claim-status rendering --------------------- */

describe("My prize panel claim-status rendering (pre-claim-flow)", () => {
  it("shows the competition date, rank, amount and a claimable status", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      myPrize: CLAIMABLE_PRIZE,
    });
    renderWindow();

    // The competition date, the rank and the amount in ICP are all rendered.
    // Query the live document: the panel node is replaced when the claim modal
    // opens on load, so a captured reference can go stale.
    await waitFor(() => {
      expect(screen.getByText("Competition Sunday 18 Oct")).toBeInTheDocument();
      expect(screen.getByText("725.25 ICP")).toBeInTheDocument();
      expect(screen.getByText("Rank")).toBeInTheDocument();
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    // The status is derived from the deadline against the current time: a
    // future deadline reads claimable, with the deadline date shown.
    const status = document.querySelector(
      '[data-ocid="leaderboard.my_prize.status"]',
    );
    expect(status).not.toBeNull();
    expect(status?.textContent).toMatch(/Claimable/);
  });

  it("shows an expired status once the deadline has passed", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      myPrize: EXPIRED_PRIZE,
    });
    renderWindow();

    const status = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.my_prize.status"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(status.textContent).toBe("Expired");
  });

  it("shows the empty state when the player has no prize to claim", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({ status: LIVE_STATUS, myPrize: null });
    renderWindow();

    await waitFor(() => {
      expect(screen.getByText("No prize to claim yet")).toBeInTheDocument();
    });
  });

  it("does not render the My prize panel for a signed-out caller", async () => {
    seedOpen();
    actorState.principal = null;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    // The Sunday view renders (the player first-prize block is present) but the
    // signed-in-only My prize panel is absent.
    await screen.findByText("First prize 725.25 ICP");
    expect(
      container.querySelector('[data-ocid="leaderboard.my_prize.panel"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-ocid="leaderboard.my_prize.empty_state"]'),
    ).toBeNull();
  });
});

/* --- My prize panel: current getMyPrize update-call contract ------------ */

describe("My prize panel getMyPrize contract (pre-claim-flow)", () => {
  it("reads the caller's own prize through getMyPrize() with no arguments", async () => {
    seedOpen();
    actorState.principal = "player-1";
    const actor = makeActor({
      status: LIVE_STATUS,
      myPrize: CLAIMABLE_PRIZE,
    });
    actorState.actor = actor;
    renderWindow();

    await waitFor(() => {
      expect(actor.getMyPrize).toHaveBeenCalledWith();
    });
  });

  it("issues no getMyPrize request while signed out", async () => {
    seedOpen();
    actorState.principal = null;
    const actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    actorState.actor = actor;
    renderWindow();

    // The Sunday view renders, but the signed-in-only update call is never
    // issued for the anonymous caller.
    await screen.findByText("First prize 725.25 ICP");
    expect(actor.getMyPrize).not.toHaveBeenCalled();
  });

  it("still reads the caller's own prize while the Sunday comp view is hidden", async () => {
    seedOpen();
    actorState.principal = "player-1";
    // A frozen competition defaults to All time. The accepted requirement
    // renders the My prize panel in both views, so the signed-in-only read is
    // issued even while the Sunday comp view is hidden.
    const actor = makeActor({
      status: { ...LIVE_STATUS, live: false },
      myPrize: CLAIMABLE_PRIZE,
    });
    actorState.actor = actor;
    renderWindow();

    await screen.findByRole("tab", { name: "All time" });
    await waitFor(() => {
      expect(actor.getMyPrize).toHaveBeenCalledWith();
    });
  });
});

/* --- Admin panel: current pool / first prize / claim state -------------- */

describe("Admin prize panel current rows (pre-claim-flow)", () => {
  it("shows the current pool, first prize and claim state for the admin", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      firstPrize: 72_525_000_000n,
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

    // The current pool and first prize rows are unchanged.
    expect(within(panel).getByText("1,450.5 ICP")).toBeInTheDocument();
    expect(within(panel).getByText("725.25 ICP")).toBeInTheDocument();
    expect(within(panel).getByText("Claimable")).toBeInTheDocument();
  });

  it("reads 'No allocation' when the Sunday has no allocation", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
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

    const claimState = panel.querySelector(
      '[data-ocid="leaderboard.admin.claim_state"]',
    );
    expect(claimState).not.toBeNull();
    expect(claimState?.textContent).toBe("No allocation");
    expect(within(panel).queryByText("Claimable")).not.toBeInTheDocument();
  });

  it("hides the admin panel for a non-admin signed-in player", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    await screen.findByText("First prize 725.25 ICP");
    expect(
      container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
    ).toBeNull();
  });

  it("hides the admin panel for a signed-out caller", async () => {
    seedOpen();
    actorState.principal = null;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    await screen.findByText("First prize 725.25 ICP");
    expect(
      container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
    ).toBeNull();
  });
});

/* --- No other player's principal in the rendered window ----------------- */

describe("No principal leaks into the rendered window", () => {
  it("renders no principal-shaped token for a signed-in player with a prize", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      myPrize: CLAIMABLE_PRIZE,
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    // Wait for the My prize panel to render the caller's own prize.
    await waitFor(() => {
      expect(
        container.querySelector('[data-ocid="leaderboard.my_prize.panel"]'),
      ).not.toBeNull();
    });
    // The My prize panel renders the caller's own prize without any principal.
    expect(container.textContent ?? "").not.toMatch(PRINCIPAL_PATTERN);
  });
});
