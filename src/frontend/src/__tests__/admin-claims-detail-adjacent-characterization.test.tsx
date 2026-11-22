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
 * Characterization of the admin prize-claims DETAIL rendering ADJACENT to the
 * accepted change, updated to the new date-dropdown + per-date-detail shape.
 *
 * The request intentionally changes the admin prize-claims area's SHAPE: a
 * dropdown of competition dates, newest first, replacing the always-open list.
 * This file protects the per-date DETAIL CONTENT that SURVIVES the rework,
 * now revealed by selecting a date in the dropdown:
 *
 *   - the selected competition's detail is labelled with its UTC date
 *     ("Sunday 18 Oct");
 *   - the three claim-state groups (Unclaimed / Paying / Paid) render with
 *     their counts;
 *   - a paid entry shows its rank, its amount in ICP, its recipient principal
 *     and its ledger block index;
 *   - an unclaimed entry shows its rank and amount and no recipient/block;
 *   - the empty state ("No competitions with a confirmed prize pool yet")
 *     renders when there are no allocated competition dates.
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
    getAdminPrizeClaims: () => Promise<unknown>;
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
  SundayAllocationStatus,
} from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { ADMIN_PRINCIPAL } from "@/lib/prize-admin";

/* --- Fixtures ----------------------------------------------------------- */

/** A live competition status: Sunday 18 Oct 2026 00:00 UTC. */
const LIVE_STATUS: CompStatus = {
  live: true,
  // 2026-10-18T00:00:00Z in nanoseconds.
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 6n * 3_600n + 12n * 60n,
};

const UPCOMING_STATUSES: SundayAllocationStatus[] = [
  // 2026-10-25T00:00:00Z
  { sunday: 1_792_886_400_000_000_000n, allocated: false, poolE8s: undefined },
];

/**
 * A well-formed, non-anonymous, non-canister principal used as a paid entry's
 * recipient. The admin detail renders it verbatim via `toText()`.
 */
const RECIPIENT_TEXT =
  "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mgsg7-rstfj-6ae";

/**
 * The admin dropdown's allocated competition dates: one Sunday with a confirmed
 * pool, so selecting it reveals the detail below.
 */
const ADMIN_DATES: AdminCompetitionDate[] = [
  { sunday: 1_792_281_600_000_000_000n, poolE8s: 145_050_000_000n },
];

/**
 * The admin competition detail for the selected Sunday: an unclaimed, a paying
 * and a paid entry, so every group and every per-entry field is exercised.
 */
const ADMIN_DETAIL: AdminCompetitionDetail = {
  sunday: 1_792_281_600_000_000_000n,
  poolE8s: 145_050_000_000n,
  firstPrizeE8s: 72_525_000_000n,
  unclaimed: [{ rank: 3n, amountE8s: 0n }],
  paying: [{ rank: 2n, amountE8s: 0n }],
  paid: [
    {
      rank: 1n,
      amountE8s: 72_525_000_000n,
      recipient: { toText: () => RECIPIENT_TEXT } as never,
      blockIndex: 42n,
    },
  ],
};

interface ActorOverrides {
  status?: CompStatus;
  firstPrize?: bigint | null;
  adminDates?: AdminCompetitionDate[];
  adminDetail?: AdminCompetitionDetail | null;
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
    getMyPrize: vi.fn().mockResolvedValue(null),
    getClaimStatus: vi.fn().mockResolvedValue(null),
    getFirstPrizeForSunday: vi
      .fn()
      .mockResolvedValue(
        overrides.firstPrize === undefined ? null : overrides.firstPrize,
      ),
    getUpcomingAllocationStatuses: vi.fn().mockResolvedValue(UPCOMING_STATUSES),
    previewPrizeAllocation: vi.fn().mockResolvedValue(null),
    savePrizeAllocation: vi.fn().mockResolvedValue(null),
    clearPrizeAllocation: vi.fn().mockResolvedValue(null),
    getAdminPrizeClaims: vi.fn().mockResolvedValue(null),
    getAdminAllocatedCompetitionDates: vi
      .fn()
      .mockResolvedValue(overrides.adminDates ?? []),
    getAdminCompetitionDetail: vi
      .fn()
      .mockResolvedValue(
        overrides.adminDetail === undefined ? null : overrides.adminDetail,
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

/**
 * Select the given Sunday in the admin prize-claims dropdown, revealing that
 * competition's detail. Waits for the dropdown to render first.
 */
async function selectCompetition(sunday: bigint) {
  const select = await waitFor(() => {
    const el = document.querySelector(
      '[data-ocid="leaderboard.admin.claims.date_select"]',
    );
    expect(el).not.toBeNull();
    return el as HTMLSelectElement;
  });
  await userEvent.setup().selectOptions(select, sunday.toString());
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

/* --- Per-competition detail content survives the dropdown rework -------- */

describe("admin claims detail content", () => {
  it("labels the selected competition with its UTC date and renders the three claim groups", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
      adminDates: ADMIN_DATES,
      adminDetail: ADMIN_DETAIL,
    });
    const { container } = renderWindow();

    await selectCompetition(ADMIN_DETAIL.sunday);

    const detail = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.admin.claims.detail"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // The selected competition is labelled with its UTC date.
    expect(within(detail).getByText("Sunday 18 Oct")).toBeInTheDocument();
    // The three claim-state groups render with their counts.
    expect(within(detail).getByText("Unclaimed (1)")).toBeInTheDocument();
    expect(within(detail).getByText("Paying (1)")).toBeInTheDocument();
    expect(within(detail).getByText("Paid (1)")).toBeInTheDocument();
  });

  it("shows a paid entry's rank, amount, recipient principal and block index", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
      adminDates: ADMIN_DATES,
      adminDetail: ADMIN_DETAIL,
    });
    const { container } = renderWindow();

    await selectCompetition(ADMIN_DETAIL.sunday);

    const paidEntry = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.admin.claims.entry.paid.1"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    expect(paidEntry.textContent).toContain("Rank 1");
    expect(paidEntry.textContent).toContain("725.25 ICP");
    // The recipient principal is rendered verbatim for a paid entry.
    expect(paidEntry.textContent).toContain(RECIPIENT_TEXT);
    expect(paidEntry.textContent).toContain("Block 42");
  });

  it("shows an unclaimed entry's rank and amount with no recipient or block", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
      adminDates: ADMIN_DATES,
      adminDetail: ADMIN_DETAIL,
    });
    const { container } = renderWindow();

    await selectCompetition(ADMIN_DETAIL.sunday);

    const unclaimedEntry = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.admin.claims.entry.unclaimed.1"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    expect(unclaimedEntry.textContent).toContain("Rank 3");
    // An unclaimed entry carries no recipient principal and no block index.
    expect(unclaimedEntry.textContent).not.toContain(RECIPIENT_TEXT);
    expect(unclaimedEntry.textContent).not.toContain("Block");
  });

  it("keeps the empty state when there are no allocated competition dates", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
      adminDates: [],
    });
    renderWindow();

    expect(
      await screen.findByText(
        "No competitions with a confirmed prize pool yet",
      ),
    ).toBeInTheDocument();
  });
});
