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
 * Cover for the accepted change that moves the Admin panel in the Leaderboard
 * window's Comp (Sunday comp) view from ABOVE the "This competition" standings
 * block to BELOW the Past winners table.
 *
 * The accepted order is: competition header, first prize, "This competition"
 * standings, Past winners table, then the Admin panel (admin only). This file
 * asserts that observable order in the rendered DOM, and that the panel's
 * content and controls are unchanged by the move.
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

/** The admin dropdown's allocated competition dates: one Sunday with a pool. */
const ADMIN_DATES: AdminCompetitionDate[] = [
  { sunday: 1_792_281_600_000_000_000n, poolE8s: 145_050_000_000n },
];

/** The admin competition detail for the selected Sunday, with a paid entry. */
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

/* --- Admin panel position in the Comp view ------------------------------ */

describe("Admin panel sits below the standings and Past winners in the Comp view", () => {
  it("renders the Admin panel after the 'This competition' standings block", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      standings: [standing(1, "Ada", 3)],
      pastWinners: [pastWinner(1_792_281_600_000_000_000n, "Bob", 4, "Cy", 2)],
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    const standings = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.sunday.list"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    const adminPanel = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.admin.panel"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // DOCUMENT_POSITION_FOLLOWING means the admin panel comes after the
    // standings block in document order (the vertical stack).
    expect(
      standings.compareDocumentPosition(adminPanel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the Admin panel after the Past winners table", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      standings: [standing(1, "Ada", 3)],
      pastWinners: [pastWinner(1_792_281_600_000_000_000n, "Bob", 4, "Cy", 2)],
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    const pastWinners = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.past_winners.table"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    const adminPanel = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.admin.panel"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    expect(
      pastWinners.compareDocumentPosition(adminPanel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the full Comp view order: header, first prize, standings, Past winners, Admin", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      standings: [standing(1, "Ada", 3)],
      pastWinners: [pastWinner(1_792_281_600_000_000_000n, "Bob", 4, "Cy", 2)],
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    await screen.findByText("LIVE NOW, Sunday 18 Oct");
    await waitFor(() => {
      expect(
        container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
      ).not.toBeNull();
    });

    // The ordered markers of the Comp view's blocks, in document order.
    const ordered = Array.from(
      container.querySelectorAll(
        '[data-ocid="leaderboard.sunday.header"], [data-ocid="leaderboard.prize.panel"], [data-ocid="leaderboard.sunday.list"], [data-ocid="leaderboard.past_winners.table"], [data-ocid="leaderboard.admin.panel"]',
      ),
    ).map((el) => el.getAttribute("data-ocid"));

    expect(ordered).toEqual([
      "leaderboard.sunday.header",
      "leaderboard.prize.panel",
      "leaderboard.sunday.list",
      "leaderboard.past_winners.table",
      "leaderboard.admin.panel",
    ]);
  });

  it("does not render the Admin panel for a non-admin signed-in player", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      standings: [standing(1, "Ada", 3)],
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    await screen.findByText("Ada");
    expect(
      container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
    ).toBeNull();
  });
});

/* --- Admin panel content and controls unchanged by the move ------------- */

describe("Admin panel content and controls are unchanged by the move", () => {
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

    expect(within(detail).getByText("Unclaimed (1)")).toBeInTheDocument();
    expect(within(detail).getByText("Paying (1)")).toBeInTheDocument();
    expect(within(detail).getByText("Paid (1)")).toBeInTheDocument();
    expect(within(detail).getByText("Block 42")).toBeInTheDocument();
  });
});
