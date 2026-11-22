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
 * Characterization of the Leaderboard window's Comp (Sunday comp) view, taken
 * BEFORE the Admin panel is moved from above the "This competition" standings
 * block to below the Past winners table.
 *
 * The request intentionally changes the Admin panel's POSITION within the Comp
 * view. It states that the panel's pool, first prize, claim state, allocation
 * controls and claims list are unchanged in content and behavior, and that the
 * "This competition" standings block and the Past winners table are unchanged.
 *
 * This file deliberately does NOT pin the Admin panel's position relative to
 * the standings block or the Past winners table — that is the intentional
 * change. What it protects is the behavior ADJACENT to the move that must
 * survive it:
 *
 *   - the Comp view still renders its existing content blocks: the competition
 *     header, the player-facing first prize, the "This competition" standings
 *     block and the Past winners table;
 *   - the Admin panel still renders for the hardcoded admin principal and still
 *     shows the current pool, first prize and claim state;
 *   - the Admin panel's allocation controls still list the upcoming Sundays and
 *     still save after the two-step confirmation;
 *   - the Admin panel's claims list still renders its per-competition groups;
 *   - the All time view and the "My prize" panel are unchanged.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real archive reads (the removed
 * competitions, newest-first ordering, idempotency) are asserted in the
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
  ClaimStatus,
  CompStandingRow,
  CompStatus,
  MyPrize,
  PastWinnerRow,
  PrizePool,
  PrizePreviewResult,
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

/** A frozen status: the last competition ended, next comp in 2d 5h. */
const FROZEN_STATUS: CompStatus = {
  live: false,
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 2n * 86_400n + 5n * 3_600n,
};

/** A pool of 1,450.50 ICP with a first prize of 725.25 ICP. */
const POOL: PrizePool = {
  poolE8s: 145_050_000_000n,
  firstPrizeE8s: 72_525_000_000n,
};

/** A claimable prize: deadline far in the future so the status reads claimable. */
const CLAIMABLE_PRIZE: MyPrize = {
  sunday: 1_792_281_600_000_000n,
  rank: 1n,
  amountE8s: 72_525_000_000n,
  // 2030-01-01T00:00:00Z — far in the future, so the prize is always claimable.
  deadline: 1_893_456_000_000_000_000n,
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

/** A backend-computed preview for a 10 ICP pool. */
const PREVIEW: PrizePreviewResult = {
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

/**
 * The admin dropdown's allocated competition dates: one Sunday with a confirmed
 * pool, so selecting it reveals the detail below.
 */
const ADMIN_DATES: AdminCompetitionDate[] = [
  { sunday: 1_792_281_600_000_000_000n, poolE8s: 145_050_000_000n },
];

/**
 * The admin competition detail for the selected Sunday: an unclaimed, a paying
 * and a paid entry. The paid entry carries a recipient principal and a block
 * index, which the admin panel renders.
 */
const ADMIN_DETAIL: AdminCompetitionDetail = {
  sunday: 1_792_281_600_000_000_000n,
  poolE8s: 145_050_000_000n,
  firstPrizeE8s: 72_525_000_000n,
  unclaimed: [{ rank: 3n, amountE8s: 1_000_000n }],
  paying: [{ rank: 2n, amountE8s: 2_000_000n }],
  paid: [
    {
      rank: 1n,
      amountE8s: 4_000_000n,
      recipient: {
        toText: () => "aaaaa-aa",
      } as never,
      blockIndex: 42n,
    },
  ],
};

function standing(
  rank: number,
  displayName: string,
  wins: number,
  isMe = false,
): CompStandingRow {
  return { rank: BigInt(rank), displayName, wins: BigInt(wins), isMe };
}

function pastWinner(
  sunday: bigint,
  winnerName: string | undefined,
  winnerWins: number | undefined,
  runnerUpName: string | undefined,
  runnerUpWins: number | undefined,
): PastWinnerRow {
  return {
    sunday,
    winnerName,
    winnerWins: winnerWins === undefined ? undefined : BigInt(winnerWins),
    runnerUpName,
    runnerUpWins: runnerUpWins === undefined ? undefined : BigInt(runnerUpWins),
  };
}

interface ActorOverrides {
  status?: CompStatus;
  standings?: CompStandingRow[];
  pastWinners?: PastWinnerRow[];
  pool?: PrizePool;
  myPrize?: MyPrize | null;
  claimStatus?: ClaimStatus | null;
  firstPrize?: bigint | null;
  upcomingStatuses?: SundayAllocationStatus[];
  preview?: PrizePreviewResult;
  adminDates?: AdminCompetitionDate[];
  adminDetail?: AdminCompetitionDetail | null;
}

/** Build a typed actor fake with the leaderboard and prize methods. */
function makeActor(overrides: ActorOverrides = {}) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi
      .fn()
      .mockResolvedValue(overrides.standings ?? []),
    getSundayCompStatus: vi
      .fn()
      .mockResolvedValue(overrides.status ?? LIVE_STATUS),
    getPastWinners: vi.fn().mockResolvedValue(overrides.pastWinners ?? []),
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
    getUpcomingAllocationStatuses: vi
      .fn()
      .mockResolvedValue(overrides.upcomingStatuses ?? UPCOMING_STATUSES),
    previewPrizeAllocation: vi
      .fn()
      .mockResolvedValue(overrides.preview ?? PREVIEW),
    savePrizeAllocation: vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: { sunday: NEXT_SUNDAY, allocated: true, poolE8s: 1_000_000_000n },
    }),
    clearPrizeAllocation: vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: { sunday: NEXT_SUNDAY, allocated: false, poolE8s: undefined },
    }),
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

/* --- Comp view content blocks survive the Admin move -------------------- */

describe("Comp view content blocks survive the Admin panel move", () => {
  it("still renders the header, first prize, standings and Past winners table", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      standings: [standing(1, "Ada", 3)],
      pastWinners: [pastWinner(1_792_281_600_000_000_000n, "Bob", 4, "Cy", 2)],
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    // The live default opens on Comp; every existing content block renders.
    expect(
      await screen.findByText("LIVE NOW, Sunday 18 Oct"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        container.querySelector('[data-ocid="leaderboard.prize.panel"]'),
      ).not.toBeNull();
    });
    expect(await screen.findByText("This competition")).toBeInTheDocument();
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(await screen.findByText("Bob")).toBeInTheDocument();
  });

  it("keeps the 'This competition' standings block and the Past winners table", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      standings: [standing(1, "Ada", 3)],
      pastWinners: [pastWinner(1_792_281_600_000_000_000n, "Bob", 4, "Cy", 2)],
    });
    const { container } = renderWindow();

    await screen.findByText("Ada");
    // The standings list and the Past winners table are both present and
    // distinct; the move must not remove or merge either.
    expect(
      container.querySelector('[data-ocid="leaderboard.sunday.list"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="leaderboard.past_winners.table"]'),
    ).not.toBeNull();
  });
});

/* --- Admin panel content is unchanged ----------------------------------- */

describe("Admin panel content is unchanged by the move", () => {
  it("still shows the current pool, first prize and claim state", async () => {
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

    // The pool, first prize and claim state are unchanged in content.
    expect(within(panel).getByText("1,450.5 ICP")).toBeInTheDocument();
    expect(within(panel).getByText("725.25 ICP")).toBeInTheDocument();
    expect(within(panel).getByText("Claimable")).toBeInTheDocument();
  });

  it("still lists the upcoming Sundays in the allocation dropdown", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      claimStatus: ClaimStatusEnum.claimable,
    });
    renderWindow();

    const select = await screen.findByRole("combobox");
    const options = within(select).getAllByRole("option");
    // A placeholder plus the two upcoming Sundays.
    expect(options).toHaveLength(3);
    expect(options[1]?.textContent).toContain("Sunday 25 Oct 2026, 00:00 UTC");
    expect(options[1]?.textContent).toContain("No allocation");
    expect(options[2]?.textContent).toContain("Allocated");
  });

  it("still saves an allocation after the two-step confirmation", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    const actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      claimStatus: ClaimStatusEnum.claimable,
    });
    actorState.actor = actor;
    renderWindow();

    const user = userEvent.setup();
    await user.selectOptions(
      await screen.findByRole("combobox"),
      NEXT_SUNDAY.toString(),
    );
    await user.type(screen.getByLabelText("Total pool (ICP)"), "10");

    const confirm = screen.getByRole("button", {
      name: "Confirm total prize",
    });
    // First press opens the warning; nothing is saved.
    await user.click(confirm);
    expect(
      await screen.findByText(
        /Saving this allocation makes the first prize public/,
      ),
    ).toBeInTheDocument();
    expect(actor.savePrizeAllocation).not.toHaveBeenCalled();

    // Second press saves for the selected Sunday.
    await user.click(confirm);
    await waitFor(() => {
      expect(actor.savePrizeAllocation).toHaveBeenCalledWith(
        NEXT_SUNDAY,
        1_000_000_000n,
      );
    });
    expect(await screen.findByText("Allocation saved.")).toBeInTheDocument();
  });

  it("still renders the claims dropdown and the selected competition's groups", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      claimStatus: ClaimStatusEnum.claimable,
      adminDates: ADMIN_DATES,
      adminDetail: ADMIN_DETAIL,
    });
    const { container } = renderWindow();

    const select = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.admin.claims.date_select"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLSelectElement;
    });
    await userEvent
      .setup()
      .selectOptions(select, ADMIN_DETAIL.sunday.toString());

    const detail = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.admin.claims.detail"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // The three claim-state groups render with their counts.
    expect(within(detail).getByText("Unclaimed (1)")).toBeInTheDocument();
    expect(within(detail).getByText("Paying (1)")).toBeInTheDocument();
    expect(within(detail).getByText("Paid (1)")).toBeInTheDocument();
    // The paid entry carries its block index.
    expect(within(detail).getByText("Block 42")).toBeInTheDocument();
  });

  it("still hides the admin panel for a non-admin signed-in player", async () => {
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
});

/* --- All time and My prize unchanged ------------------------------------ */

describe("All time view and My prize panel are unchanged", () => {
  it("still renders the All time board when the frozen default applies", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS });
    renderWindow();

    const allTimeTab = await screen.findByRole("tab", { name: "All time" });
    expect(allTimeTab).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("No ranked wins yet")).toBeInTheDocument();
  });

  it("still renders the My prize panel for a signed-in player", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      myPrize: CLAIMABLE_PRIZE,
    });
    renderWindow();

    // Query the live document: the panel node is replaced when the claim modal
    // opens on load, so a captured reference can go stale.
    await waitFor(() => {
      expect(screen.getByText("725.25 ICP")).toBeInTheDocument();
    });
  });
});
