import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// The window's markers use `data-ocid`, not `data-testid`. Configure the
// testing-library test-id attribute once so the stable markers can be selected
// by their data-ocid rather than by their (intentionally changing) labels.
configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the three seams the accepted request changed:
 *
 *   1. the Past winners table's fallback cells — "No wins recorded" for a
 *      missing winner and "No runner-up" for a missing runner-up;
 *   2. the MyCompWins label "Player key" (value unchanged);
 *   3. the admin allocation dropdown placeholder "Select a competition".
 *
 * It also protects the adjacent working behavior that must survive the rename:
 * the table's columns, the winner/runner-up values and win counts, the empty
 * state, the MyCompWins value, and the dropdown's option list.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real archive and allocation behavior
 * is asserted in the PocketIC backend lane.
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

/** The upcoming competition dates the backend returns for the admin dropdown. */
const UPCOMING_STATUSES: SundayAllocationStatus[] = [
  { sunday: 1_792_281_600_000_000_000n, allocated: false, poolE8s: undefined },
  { sunday: 1_792_627_200_000_000_000n, allocated: false, poolE8s: undefined },
];

interface ActorOverrides {
  ranking?: WinnerRankingRow[];
  status?: CompStatus;
  standings?: CompStandingRow[];
  pastWinners?: PastWinnerRow[];
  pool?: PrizePool;
  claimStatus?: ClaimStatus | null;
  firstPrize?: bigint | null;
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
      .mockResolvedValue(overrides.status ?? FROZEN_STATUS),
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
      .mockResolvedValue(overrides.upcomingStatuses ?? []),
    previewPrizeAllocation: vi.fn().mockResolvedValue(null),
    savePrizeAllocation: vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: { sunday: 0n, allocated: false, poolE8s: undefined },
    }),
    clearPrizeAllocation: vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: { sunday: 0n, allocated: false, poolE8s: undefined },
    }),
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

/** Switch to the competition view by its stable data-ocid. */
async function openCompetitionView() {
  await userEvent
    .setup()
    .click(await screen.findByTestId("leaderboard.view_tab.sunday_comp"));
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

/* --- Past winners fallback cells (accepted behavior) -------------------- */

describe("Past winners table fallback cells", () => {
  it("renders 'No runner-up' in the runner-up cell when a winner has no runner-up", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [
        pastWinner(1_792_281_600_000_000_000n, "Cy", 1, undefined, undefined),
      ],
    });
    renderWindow();
    await openCompetitionView();

    const table = await screen.findByTestId("leaderboard.past_winners.table");
    const rows = within(table).getAllByRole("row");
    const dataRow = rows[1]!;

    // The winner is present with its win count.
    expect(within(dataRow).getByText("Cy")).toBeInTheDocument();
    expect(within(dataRow).getByText("1 win")).toBeInTheDocument();

    // The runner-up cell shows the accepted "No runner-up" fallback.
    const cells = within(dataRow).getAllByRole("cell");
    expect(cells[2]!.textContent).toBe("No runner-up");
  });

  it("renders 'No wins recorded' in the winner cell when there is no winner", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [
        pastWinner(
          1_792_281_600_000_000_000n,
          undefined,
          undefined,
          undefined,
          undefined,
        ),
      ],
    });
    renderWindow();
    await openCompetitionView();

    const table = await screen.findByTestId("leaderboard.past_winners.table");
    const rows = within(table).getAllByRole("row");
    const dataRow = rows[1]!;
    const cells = within(dataRow).getAllByRole("cell");

    // The winner cell shows the accepted "No wins recorded" fallback.
    expect(cells[1]!.textContent).toBe("No wins recorded");
    // With no winner at all, the runner-up cell stays a bare dash.
    expect(cells[2]!.textContent).toBe("—");
  });

  it("still renders the Date / Winner / Runner-up columns and win counts", async () => {
    seedOpen();
    const newest = 1_792_281_600_000_000_000n; // Sunday 18 Oct 2026
    const older = newest - 604_800_000_000_000n; // the previous Sunday
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [
        pastWinner(newest, "Ada", 4, "Bob", 2),
        pastWinner(older, "Cy", 1, undefined, undefined),
      ],
    });
    renderWindow();
    await openCompetitionView();

    const table = await screen.findByTestId("leaderboard.past_winners.table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);

    const header = rows[0]!;
    expect(within(header).getByText("Date")).toBeInTheDocument();
    expect(within(header).getByText("Winner")).toBeInTheDocument();
    expect(within(header).getByText("Runner-up")).toBeInTheDocument();

    const firstData = rows[1]!;
    expect(within(firstData).getByText("Sunday 18 Oct")).toBeInTheDocument();
    expect(within(firstData).getByText("Ada")).toBeInTheDocument();
    expect(within(firstData).getByText("4 wins")).toBeInTheDocument();
    expect(within(firstData).getByText("Bob")).toBeInTheDocument();
    expect(within(firstData).getByText("2 wins")).toBeInTheDocument();
  });

  it("still shows the empty state when no competition has been archived", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS, pastWinners: [] });
    renderWindow();
    await openCompetitionView();

    expect(
      await screen.findByText("No competitions archived yet"),
    ).toBeInTheDocument();
  });
});

/* --- MyCompWins label (accepted behavior) ------------------------------- */

describe("MyCompWins panel", () => {
  it("labels the identity row 'Player key' and shows the player identity value", async () => {
    seedOpen();
    actorState.principal = "ii-principal";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      standings: [standing(1, "Ada", 3, true)],
    });
    renderWindow();

    const panel = await screen.findByTestId("leaderboard.my_wins.panel");
    expect(within(panel).getByText("Player key")).toBeInTheDocument();

    // The value is the active identity the app holds for the player; the
    // label rename must not change it.
    const value = within(panel).getByTestId("leaderboard.my_wins.principal");
    expect(value.textContent).toBeTruthy();
  });

  it("still shows the wins count and credited name", async () => {
    seedOpen();
    actorState.principal = "ii-principal";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      standings: [standing(1, "Ada", 3, true)],
    });
    renderWindow();

    const panel = await screen.findByTestId("leaderboard.my_wins.panel");
    expect(within(panel).getByText("Wins")).toBeInTheDocument();
    expect(within(panel).getByText("3 wins")).toBeInTheDocument();
    expect(within(panel).getByText("Credited name")).toBeInTheDocument();
    expect(within(panel).getByText("Ada")).toBeInTheDocument();
  });
});

/* --- Admin allocation dropdown placeholder (accepted behavior) ---------- */

describe("admin allocation dropdown", () => {
  it("keeps the 'Select a competition' placeholder and the upcoming option list", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      upcomingStatuses: UPCOMING_STATUSES,
    });
    renderWindow();

    const select = await screen.findByTestId(
      "leaderboard.admin.allocation.sunday_select",
    );

    // The placeholder option reads the accepted "Select a competition".
    expect(
      within(select).getByRole("option", { name: "Select a competition" }),
    ).toBeInTheDocument();

    // The upcoming competition dates still populate the dropdown.
    await waitFor(() => {
      expect(
        within(select).getByRole("option", {
          name: /Sunday 18 Oct 2026, 00:00 UTC — No allocation/,
        }),
      ).toBeInTheDocument();
    });
  });
});
