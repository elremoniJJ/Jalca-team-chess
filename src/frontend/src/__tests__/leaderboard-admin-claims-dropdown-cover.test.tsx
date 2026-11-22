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
 * Cover for the accepted change that reworks the admin prize-claims area from
 * an always-open list of claim rows into a dropdown of allocated competition
 * dates plus a per-competition detail view.
 *
 * The accepted, observable behavior asserted here:
 *   - the admin sees a dropdown of competition dates, newest first, covering
 *     every competition with a confirmed pool prize (past, present, future);
 *   - selecting a date reveals that competition's detail: the pool prize, the
 *     past winners, and the claim status buckets (unclaimed / paying / paid);
 *   - an upcoming competition with a confirmed pool shows "No winners yet";
 *   - the dropdown and its detail are admin-only: a non-admin caller never sees
 *     them and never issues the admin reads.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real admin-only rejection and the
 * real archive reads are asserted in the PocketIC backend lane, not here.
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
    getMyPrize: () => Promise<unknown>;
    getClaimStatus: (sunday: bigint) => Promise<unknown>;
    getFirstPrizeForSunday: (sunday: bigint) => Promise<unknown>;
    getUpcomingAllocationStatuses: () => Promise<unknown>;
    previewPrizeAllocation: (poolE8s: bigint) => Promise<unknown>;
    savePrizeAllocation: (sunday: bigint, poolE8s: bigint) => Promise<unknown>;
    clearPrizeAllocation: (sunday: bigint) => Promise<unknown>;
    getAdminAllocatedCompetitionDates: () => Promise<unknown>;
    getAdminCompetitionDetail: (sunday: bigint) => Promise<unknown>;
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
  AdminCompetitionDate,
  AdminCompetitionDetail,
  CompStatus,
} from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { ADMIN_PRINCIPAL } from "@/lib/prize-admin";

/* --- Fixtures ----------------------------------------------------------- */

/** A frozen status: the last competition ended, next comp in 2d 5h. */
const FROZEN_STATUS: CompStatus = {
  live: false,
  // 2026-10-18T00:00:00Z in nanoseconds.
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 2n * 86_400n + 5n * 3_600n,
};

/** Sunday 25 Oct 2026 00:00:00 UTC, in nanoseconds. */
const SUNDAY_25_OCT = 1_792_886_400_000_000_000n;
/** Sunday 1 Nov 2026 00:00:00 UTC, in nanoseconds. */
const SUNDAY_1_NOV = 1_793_491_200_000_000_000n;

/**
 * The admin allocated-competition dates, newest first: a past competition with
 * winners and a future competition with a confirmed pool but no winners yet.
 */
const ADMIN_DATES: AdminCompetitionDate[] = [
  { sunday: SUNDAY_1_NOV, poolE8s: 1_000_000_000n },
  { sunday: SUNDAY_25_OCT, poolE8s: 145_050_000_000n },
];

/** The detail for the past competition: winners and all three claim buckets. */
const PAST_DETAIL: AdminCompetitionDetail = {
  sunday: SUNDAY_25_OCT,
  poolE8s: 145_050_000_000n,
  firstPrizeE8s: 72_525_000_000n,
  winnerName: "Ada",
  winnerWins: 4n,
  runnerUpName: "Bob",
  runnerUpWins: 2n,
  unclaimed: [{ rank: 3n, amountE8s: 0n }],
  paying: [{ rank: 2n, amountE8s: 0n }],
  paid: [{ rank: 1n, amountE8s: 72_525_000_000n, blockIndex: 42n }],
};

/** The detail for the upcoming competition: a confirmed pool, no winners yet. */
const UPCOMING_DETAIL: AdminCompetitionDetail = {
  sunday: SUNDAY_1_NOV,
  poolE8s: 1_000_000_000n,
  firstPrizeE8s: 500_000_000n,
  unclaimed: [],
  paying: [],
  paid: [],
};

interface ActorOverrides {
  status?: CompStatus;
  dates?: AdminCompetitionDate[];
  detail?: (sunday: bigint) => AdminCompetitionDetail;
}

/** Build a typed actor fake with the leaderboard, prize and admin methods. */
function makeActor(overrides: ActorOverrides = {}) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi.fn().mockResolvedValue([]),
    getSundayCompStatus: vi
      .fn()
      .mockResolvedValue(overrides.status ?? FROZEN_STATUS),
    getPastWinners: vi.fn().mockResolvedValue([]),
    getMyPrize: vi.fn().mockResolvedValue(null),
    getClaimStatus: vi.fn().mockResolvedValue(null),
    getFirstPrizeForSunday: vi.fn().mockResolvedValue(null),
    getUpcomingAllocationStatuses: vi.fn().mockResolvedValue([]),
    previewPrizeAllocation: vi.fn().mockResolvedValue(null),
    savePrizeAllocation: vi.fn().mockResolvedValue(null),
    clearPrizeAllocation: vi.fn().mockResolvedValue(null),
    getAdminAllocatedCompetitionDates: vi
      .fn()
      .mockResolvedValue(overrides.dates ?? ADMIN_DATES),
    getAdminCompetitionDetail: vi
      .fn()
      .mockImplementation((sunday: bigint) =>
        Promise.resolve(
          overrides.detail
            ? overrides.detail(sunday)
            : sunday === SUNDAY_1_NOV
              ? UPCOMING_DETAIL
              : PAST_DETAIL,
        ),
      ),
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

/** Switch to the competition view (frozen default is All time). */
async function openSundayView() {
  await userEvent
    .setup()
    .click(await screen.findByRole("tab", { name: "Comp" }));
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

/* --- Dropdown of allocated competition dates ---------------------------- */

describe("admin prize-claims dropdown", () => {
  it("lists every allocated competition date, newest first", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor();
    renderWindow();

    await openSundayView();

    const select = await screen.findByLabelText("Competition date");
    const options = within(select).getAllByRole("option");
    // The disabled placeholder plus the two allocated dates.
    expect(options).toHaveLength(3);
    expect(options[0]).toBeDisabled();

    // Newest first: 1 Nov before 25 Oct.
    expect(options[1]!.textContent).toContain("Sunday 1 Nov 2026");
    expect(options[2]!.textContent).toContain("Sunday 25 Oct 2026");
  });

  it("shows the empty state when no competition has a confirmed pool", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({ dates: [] });
    renderWindow();

    await openSundayView();

    expect(
      await screen.findByText(
        "No competitions with a confirmed prize pool yet",
      ),
    ).toBeInTheDocument();
  });
});

/* --- Per-competition detail --------------------------------------------- */

describe("admin competition detail", () => {
  it("reveals the pool prize, past winners and claim buckets for a selected date", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    const actor = makeActor();
    actorState.actor = actor;
    renderWindow();

    await openSundayView();

    const select = await screen.findByLabelText("Competition date");
    await userEvent.setup().selectOptions(select, SUNDAY_25_OCT.toString());

    // The detail read is issued for the selected date.
    await waitFor(() =>
      expect(actor.getAdminCompetitionDetail).toHaveBeenCalledWith(
        SUNDAY_25_OCT,
      ),
    );

    const detail = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.admin.claims.detail"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // The pool prize and first prize.
    expect(within(detail).getByText("Pool 1,450.5 ICP")).toBeInTheDocument();
    expect(
      within(detail).getByText("First prize 725.25 ICP"),
    ).toBeInTheDocument();

    // The past winners.
    expect(within(detail).getByText("Ada")).toBeInTheDocument();
    expect(within(detail).getByText("4 wins")).toBeInTheDocument();
    expect(within(detail).getByText("Runner-up Bob")).toBeInTheDocument();
    expect(within(detail).getByText("2 wins")).toBeInTheDocument();

    // The three claim-status buckets with their counts.
    expect(within(detail).getByText("Unclaimed (1)")).toBeInTheDocument();
    expect(within(detail).getByText("Paying (1)")).toBeInTheDocument();
    expect(within(detail).getByText("Paid (1)")).toBeInTheDocument();
  });

  it("shows 'No winners yet' for an upcoming competition with a confirmed pool", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor();
    renderWindow();

    await openSundayView();

    const select = await screen.findByLabelText("Competition date");
    await userEvent.setup().selectOptions(select, SUNDAY_1_NOV.toString());

    const detail = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.admin.claims.detail"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    expect(
      detail.querySelector(
        '[data-ocid="leaderboard.admin.claims.detail.no_winners"]',
      ),
    ).not.toBeNull();
    expect(within(detail).getByText("No winners yet")).toBeInTheDocument();
    // The upcoming competition still shows its confirmed pool.
    expect(within(detail).getByText("Pool 10 ICP")).toBeInTheDocument();
  });
});

/* --- Admin-only gating -------------------------------------------------- */

describe("admin prize-claims gating", () => {
  it("never shows the dropdown or detail to a non-admin caller", async () => {
    seedOpen();
    actorState.principal = "player-1";
    const actor = makeActor();
    actorState.actor = actor;
    const { container } = renderWindow();

    await openSundayView();

    // The Comp view renders, but the admin-only claims area is absent.
    expect(await screen.findByText("This competition")).toBeInTheDocument();
    expect(
      container.querySelector(
        '[data-ocid="leaderboard.admin.claims.date_select"]',
      ),
    ).toBeNull();
    // The admin-only reads are never issued for a non-admin caller.
    expect(actor.getAdminAllocatedCompetitionDates).not.toHaveBeenCalled();
    expect(actor.getAdminCompetitionDetail).not.toHaveBeenCalled();
  });
});
