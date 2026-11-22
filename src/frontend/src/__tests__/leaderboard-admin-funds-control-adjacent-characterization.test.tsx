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
 * Characterization of the behavior ADJACENT to the admin panel's new
 * "Check prize canister funds" control, taken on the current tree.
 *
 * The request intentionally adds an admin-only, read-only balance check to the
 * admin panel inside the Leaderboard window. This file deliberately does NOT
 * assert the new button, its figures or its failure copy — those are the
 * intentional change and are covered by the funds cover test. What it protects
 * is the behavior AROUND the change that must survive it:
 *
 *   - the admin panel is still gated on the hardcoded admin principal, so a
 *     non-admin signed-in player never sees the panel (and therefore never
 *     reaches the funds control);
 *   - the panel still lives in the Comp (Sunday comp) view only, not All time;
 *   - the panel's existing sections still render for the admin: the stored
 *     pool / first prize / claim state figures, the allocation controls, the
 *     prize-claims section and the finalize control;
 *   - the funds check is read-only: pressing it issues no state-changing call
 *     (no save, clear, claim, finalize or setter) and never moves funds.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real admin authorization and the real
 * prize-canister balance read are asserted in the PocketIC backend lane, not
 * here.
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
    getMyPrize: () => Promise<unknown>;
    getClaimStatus: (sunday: bigint) => Promise<unknown>;
    getFirstPrizeForSunday: (sunday: bigint) => Promise<unknown>;
    getUpcomingAllocationStatuses: () => Promise<unknown>;
    getAdminPrizeClaims: () => Promise<unknown>;
    adminFinalizeCompetitions: () => Promise<unknown>;
    getPrizeCanisterBalances: () => Promise<unknown>;
    savePrizeAllocation: (sunday: bigint, poolE8s: bigint) => Promise<unknown>;
    clearPrizeAllocation: (sunday: bigint) => Promise<unknown>;
    claimPrize: (
      competition: bigint,
      rank: bigint,
      recipient: unknown,
    ) => Promise<unknown>;
    setPrizeCanisterPrincipal: (principal: unknown) => Promise<unknown>;
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
  ClaimStatus,
  CompStatus,
  FinalizeReport,
  PrizeBalancesResult,
  PrizePool,
  SundayAllocationStatus,
} from "@/backend";
import { ClaimStatus as ClaimStatusEnum } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
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

/** One upcoming Sunday, unallocated, so the allocation controls render. */
const UPCOMING_STATUSES: SundayAllocationStatus[] = [
  { sunday: NEXT_SUNDAY, allocated: false, poolE8s: undefined },
];

/** A successful balances read: 1,450.5000 ICP and 3.45 T cycles. */
const BALANCES_OK: PrizeBalancesResult = {
  __kind__: "ok",
  ok: { icpE8s: 145_050_000_000n, cycles: 3_450_000_000_000n },
};

interface ActorOverrides {
  status?: CompStatus;
  pool?: PrizePool;
  firstPrize?: bigint | null;
  claimStatus?: ClaimStatus | null;
  upcomingStatuses?: SundayAllocationStatus[];
  balances?: PrizeBalancesResult;
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
    getUpcomingAllocationStatuses: vi
      .fn()
      .mockResolvedValue(overrides.upcomingStatuses ?? UPCOMING_STATUSES),
    getAdminPrizeClaims: vi.fn().mockResolvedValue({ rows: [] }),
    adminFinalizeCompetitions: vi.fn().mockResolvedValue({
      archived: [],
      lastFinalizedSunday: 0n,
    } satisfies FinalizeReport),
    getPrizeCanisterBalances: vi
      .fn()
      .mockResolvedValue(overrides.balances ?? BALANCES_OK),
    savePrizeAllocation: vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: { sunday: NEXT_SUNDAY, allocated: true, poolE8s: 1_000_000_000n },
    }),
    clearPrizeAllocation: vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: { sunday: NEXT_SUNDAY, allocated: false, poolE8s: undefined },
    }),
    claimPrize: vi.fn().mockResolvedValue({
      state: ClaimStatusEnum.claimable,
      amountE8s: 0n,
      blockIndex: undefined,
      message: undefined,
    }),
    setPrizeCanisterPrincipal: vi.fn().mockResolvedValue(undefined),
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

/** Render the window as the admin on the Comp view and wait for the panel. */
async function renderAdminCompView(overrides: ActorOverrides = {}) {
  seedOpen();
  actorState.principal = ADMIN_PRINCIPAL;
  const actor = makeActor(overrides);
  actorState.actor = actor;
  const view = renderWindow();
  // The live default opens on Comp; wait for the admin panel to mount.
  await waitFor(() => {
    expect(
      view.container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
    ).not.toBeNull();
  });
  return { actor, ...view };
}

/* --- Admin gate and view placement survive the funds addition ----------- */

describe("admin gate and view placement survive the funds addition", () => {
  it("never shows the admin panel to a non-admin signed-in player", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({ firstPrize: 72_525_000_000n });
    const { container } = renderWindow();

    // The Comp view renders (its header is present) but the admin panel is
    // absent for a non-admin caller, so the funds control is unreachable.
    await screen.findByText("LIVE NOW, Sunday 18 Oct");
    expect(
      container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
    ).toBeNull();
  });

  it("keeps the admin panel in the Comp view only, not All time", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: { ...LIVE_STATUS, live: false },
    });
    const { container } = renderWindow();

    // Frozen default is All time: the admin panel belongs to the Comp view.
    await screen.findByRole("tab", { name: "All time" });
    expect(
      container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
    ).toBeNull();

    // Switching to Comp mounts the admin panel.
    await userEvent.setup().click(screen.getByRole("tab", { name: "Comp" }));
    await waitFor(() => {
      expect(
        container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
      ).not.toBeNull();
    });
  });
});

/* --- Existing admin panel sections survive the funds addition ----------- */

describe("existing admin panel sections survive the funds addition", () => {
  it("still shows the stored pool, first prize and claim state figures", async () => {
    const { container } = await renderAdminCompView({
      firstPrize: 72_525_000_000n,
      claimStatus: ClaimStatusEnum.claimable,
    });

    const panel = container.querySelector(
      '[data-ocid="leaderboard.admin.panel"]',
    ) as HTMLElement;

    // The stored pool is derived as twice the stored first prize (1,450.5 ICP),
    // and the first prize is the stored value (725.25 ICP).
    expect(
      panel.querySelector('[data-ocid="leaderboard.admin.pool"]')?.textContent,
    ).toBe("1,450.5 ICP");
    expect(
      panel.querySelector('[data-ocid="leaderboard.admin.first_prize"]')
        ?.textContent,
    ).toBe("725.25 ICP");
    expect(
      panel.querySelector('[data-ocid="leaderboard.admin.claim_state"]')
        ?.textContent,
    ).toBe("Claimable");
  });

  it("still renders the allocation controls, prize claims and finalize sections", async () => {
    await renderAdminCompView();

    // The allocation controls: the Sunday dropdown and, once a Sunday is
    // chosen, the amount field and the two action buttons.
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    await userEvent.setup().selectOptions(select, NEXT_SUNDAY.toString());
    expect(screen.getByLabelText("Total pool (ICP)")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm total prize" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear allocation" }),
    ).toBeInTheDocument();

    // The prize-claims section and the finalize control are still present.
    expect(screen.getByText("Prize claims")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Force finalize" }),
    ).toBeInTheDocument();
  });

  it("still shows the panel heading and the allocation section heading", async () => {
    const { container } = await renderAdminCompView();

    const panel = container.querySelector(
      '[data-ocid="leaderboard.admin.panel"]',
    ) as HTMLElement;

    // The panel's existing heading (outside the panel body) and the allocation
    // section heading are the stable structure the funds block is added beside.
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(within(panel).getByText("Allocate prize")).toBeInTheDocument();
  });
});

/* --- The funds check is read-only --------------------------------------- */

describe("the funds check is read-only", () => {
  it("issues no state-changing call when the funds check is pressed", async () => {
    const { actor } = await renderAdminCompView({
      firstPrize: 72_525_000_000n,
    });

    // The funds control is the admin panel's read-only balance check. Pressing
    // it must call only the read method and never a state-changing one.
    const button = screen.getByRole("button", {
      name: "Check prize canister funds",
    });
    await userEvent.setup().click(button);

    await waitFor(() => {
      expect(actor.getPrizeCanisterBalances).toHaveBeenCalledWith();
    });

    // No save, clear, claim, finalize or setter is ever issued by the check.
    expect(actor.savePrizeAllocation).not.toHaveBeenCalled();
    expect(actor.clearPrizeAllocation).not.toHaveBeenCalled();
    expect(actor.claimPrize).not.toHaveBeenCalled();
    expect(actor.adminFinalizeCompetitions).not.toHaveBeenCalled();
    expect(actor.setPrizeCanisterPrincipal).not.toHaveBeenCalled();
  });
});
