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
 * Cover for the accepted change that MOVES the Admin panel in the Leaderboard
 * window's Comp (Sunday comp) view from above the "This competition" standings
 * block to the BOTTOM of the view, below the Past winners table.
 *
 * The request is a pure position change: the Admin panel's content, controls and
 * behavior are unchanged, and the All time view and the signed-in "My prize"
 * panel are unchanged. This file asserts the observable ORDER of the Comp view
 * and that the moved panel still carries its content, so a later edit that
 * reorders the view or drops the panel fails here.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real archive removal (the four dates
 * no longer returned by any archive-backed read) is asserted in the PocketIC
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
    getMyPrize: () => Promise<unknown>;
    getClaimStatus: (sunday: bigint) => Promise<unknown>;
    getFirstPrizeForSunday: (sunday: bigint) => Promise<unknown>;
    getUpcomingAllocationStatuses: () => Promise<unknown>;
    getAdminPrizeClaims: () => Promise<unknown>;
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
  CompStandingRow,
  CompStatus,
  PastWinnerRow,
  PrizePool,
  SundayAllocationStatus,
  WinnerRankingRow,
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

function allTimeRow(
  rank: number,
  displayName: string,
  wins: number,
  isMe = false,
): WinnerRankingRow {
  return { rank: BigInt(rank), displayName, wins: BigInt(wins), isMe };
}

/** The next upcoming Sunday (UTC) the admin dropdown offers. */
const NEXT_SUNDAY = 1_792_886_400_000_000_000n; // 2026-10-25T00:00:00Z

/** One upcoming Sunday, unallocated, so the allocation controls render. */
const UPCOMING_STATUSES: SundayAllocationStatus[] = [
  { sunday: NEXT_SUNDAY, allocated: false, poolE8s: undefined },
];

interface ActorOverrides {
  ranking?: WinnerRankingRow[];
  standings?: CompStandingRow[];
  status?: CompStatus;
  pastWinners?: PastWinnerRow[];
  pool?: PrizePool;
  firstPrize?: bigint | null;
  claimStatus?: ClaimStatus | null;
  upcomingStatuses?: SundayAllocationStatus[];
}

/** Build a typed actor fake with the leaderboard and prize methods. */
function makeActor(overrides: ActorOverrides = {}) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue(overrides.ranking ?? []),
    getSundayCompStandings: vi
      .fn()
      .mockResolvedValue(overrides.standings ?? []),
    getSundayCompStatus: vi
      .fn()
      .mockResolvedValue(overrides.status ?? LIVE_STATUS),
    getPastWinners: vi.fn().mockResolvedValue(overrides.pastWinners ?? []),
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
    getAdminPrizeClaims: vi.fn().mockResolvedValue(null),
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

/**
 * The Comp view's top-level blocks, in DOM order, by their data-ocid markers.
 * The competition header, the player first prize, the "This competition"
 * standings list, the Past winners table and the Admin panel are the ordered
 * blocks the accepted requirement names.
 */
function compViewOrder(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(
      '[data-ocid="leaderboard.sunday.header"], [data-ocid="leaderboard.prize.panel"], [data-ocid="leaderboard.sunday.list"], [data-ocid="leaderboard.past_winners.table"], [data-ocid="leaderboard.admin.panel"]',
    ),
  ).map((el) => el.getAttribute("data-ocid") ?? "");
}

/** Render the window as the admin on the Comp view with every block present. */
async function renderAdminCompView() {
  seedOpen();
  actorState.principal = ADMIN_PRINCIPAL;
  const newest = 1_792_281_600_000_000_000n; // Sunday 18 Oct 2026
  const older = newest - 604_800_000_000_000n; // the previous Sunday
  const actor = makeActor({
    status: LIVE_STATUS,
    standings: [standing(1, "Ada", 3)],
    pastWinners: [
      pastWinner(newest, "Ada", 4, "Bob", 2),
      pastWinner(older, "Cy", 1, undefined, undefined),
    ],
    pool: POOL,
    firstPrize: 72_525_000_000n,
    claimStatus: ClaimStatusEnum.claimable,
  });
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

/* --- Comp view order ---------------------------------------------------- */

describe("Comp view block order after the Admin panel move", () => {
  it("renders the Admin panel below the standings block and the Past winners table", async () => {
    const { container } = await renderAdminCompView();

    // The full accepted order: competition header, first prize, "This
    // competition" standings, Past winners table, then the Admin panel.
    expect(compViewOrder(container)).toEqual([
      "leaderboard.sunday.header",
      "leaderboard.prize.panel",
      "leaderboard.sunday.list",
      "leaderboard.past_winners.table",
      "leaderboard.admin.panel",
    ]);
  });

  it("places the Admin panel after the Past winners table in DOM order", async () => {
    const { container } = await renderAdminCompView();

    const pastWinners = container.querySelector(
      '[data-ocid="leaderboard.past_winners.table"]',
    );
    const adminPanel = container.querySelector(
      '[data-ocid="leaderboard.admin.panel"]',
    );
    expect(pastWinners).not.toBeNull();
    expect(adminPanel).not.toBeNull();

    // DOCUMENT_POSITION_FOLLOWING: the admin panel comes after the table.
    expect(
      (pastWinners as Node).compareDocumentPosition(adminPanel as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("places the Admin panel below the 'This competition' standings block", async () => {
    const { container } = await renderAdminCompView();

    const standings = container.querySelector(
      '[data-ocid="leaderboard.sunday.list"]',
    );
    const adminPanel = container.querySelector(
      '[data-ocid="leaderboard.admin.panel"]',
    );
    expect(standings).not.toBeNull();
    expect(adminPanel).not.toBeNull();

    expect(
      (standings as Node).compareDocumentPosition(adminPanel as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

/* --- Admin panel content unchanged -------------------------------------- */

describe("Admin panel content is unchanged by the move", () => {
  it("still shows the pool, first prize and claim state at the bottom", async () => {
    const { container } = await renderAdminCompView();

    const panel = container.querySelector(
      '[data-ocid="leaderboard.admin.panel"]',
    ) as HTMLElement;
    expect(within(panel).getByText("1,450.5 ICP")).toBeInTheDocument();
    expect(within(panel).getByText("725.25 ICP")).toBeInTheDocument();
    expect(within(panel).getByText("Claimable")).toBeInTheDocument();
  });

  it("still renders the allocation controls at the bottom of the view", async () => {
    await renderAdminCompView();

    // The Sunday dropdown is the first admin control; it must still be present
    // after the move.
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();

    // Selecting a Sunday reveals the amount field and the action buttons.
    await userEvent.setup().selectOptions(select, NEXT_SUNDAY.toString());
    expect(screen.getByLabelText("Total pool (ICP)")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm total prize" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear allocation" }),
    ).toBeInTheDocument();
  });

  it("hides the Admin panel for a non-admin caller on the Comp view", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      standings: [standing(1, "Ada", 3)],
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    // The Comp view renders (its standings list is present) but the admin
    // panel is absent for a non-admin caller.
    await screen.findByText("Ada");
    expect(
      container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
    ).toBeNull();
  });
});

/* --- All time view unchanged -------------------------------------------- */

describe("All time view is unchanged by the Admin panel move", () => {
  it("renders the All time board and no Admin panel", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      ranking: [allTimeRow(1, "Ada", 5)],
      status: { ...LIVE_STATUS, live: false },
    });
    const { container } = renderWindow();

    // Frozen default is All time: the existing board is shown.
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="leaderboard.list"]'),
    ).not.toBeNull();
    // The Admin panel belongs to the Comp view only.
    expect(
      container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
    ).toBeNull();
  });

  it("keeps the All time / Comp toggle switching views", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      ranking: [allTimeRow(1, "Ada", 5)],
      standings: [standing(1, "Bob", 2)],
      status: { ...LIVE_STATUS, live: false },
      firstPrize: 72_525_000_000n,
    });
    renderWindow();

    const allTimeTab = await screen.findByRole("tab", { name: "All time" });
    expect(allTimeTab).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Ada")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("tab", { name: "Comp" }));
    expect(await screen.findByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
  });
});
