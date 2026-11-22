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
 * Cover for the accepted LeaderboardWindow copy changes:
 *
 *   1. Past winners table — when a competition has a winner but no runner-up,
 *      the runner-up cell reads "No runner-up" instead of a bare dash. When a
 *      competition has no winner at all, the winner cell reads "No wins
 *      recorded" and the runner-up cell stays a dash.
 *   2. MyCompWins — the label "Principal" is renamed to "Player key"; the
 *      value (the active identity) is unchanged.
 *   3. Admin allocation dropdown — the placeholder "Select a Sunday" is renamed
 *      to "Select a competition".
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real archive reads are asserted in
 * the PocketIC backend lane, not here.
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
  CompStandingRow,
  CompStatus,
  PastWinnerRow,
  SundayAllocationStatus,
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

/** A live competition status: Sunday 18 Oct 2026 00:00 UTC, 6h 12m remaining. */
const LIVE_STATUS: CompStatus = {
  live: true,
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 6n * 3_600n + 12n * 60n,
};

/** The next upcoming Sunday (UTC) the admin dropdown offers. */
const NEXT_SUNDAY = 1_792_886_400_000_000_000n; // 2026-10-25T00:00:00Z

const UPCOMING_STATUSES: SundayAllocationStatus[] = [
  { sunday: NEXT_SUNDAY, allocated: false, poolE8s: undefined },
];

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
  firstPrize?: bigint | null;
  upcomingStatuses?: SundayAllocationStatus[];
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
      .mockResolvedValue(overrides.status ?? FROZEN_STATUS),
    getPastWinners: vi.fn().mockResolvedValue(overrides.pastWinners ?? []),
    getMyPrize: vi.fn().mockResolvedValue(null),
    getClaimStatus: vi.fn().mockResolvedValue(null),
    getFirstPrizeForSunday: vi
      .fn()
      .mockResolvedValue(
        overrides.firstPrize === undefined ? null : overrides.firstPrize,
      ),
    getUpcomingAllocationStatuses: vi
      .fn()
      .mockResolvedValue(overrides.upcomingStatuses ?? UPCOMING_STATUSES),
    previewPrizeAllocation: vi.fn().mockResolvedValue(null),
    savePrizeAllocation: vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: { sunday: NEXT_SUNDAY, allocated: true, poolE8s: 1_000_000_000n },
    }),
    clearPrizeAllocation: vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: { sunday: NEXT_SUNDAY, allocated: false, poolE8s: undefined },
    }),
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

/* --- Past winners runner-up / winner cell copy -------------------------- */

describe("Past winners table cell copy", () => {
  it("shows 'No runner-up' when a winner exists without a runner-up", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [
        pastWinner(1_792_281_600_000_000_000n, "Ada", 4, undefined, undefined),
      ],
    });
    renderWindow();

    await openSundayView();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    const dataRow = rows[1]!;

    // The winner cell carries the winner; the runner-up cell reads the new copy.
    expect(within(dataRow).getByText("Ada")).toBeInTheDocument();
    expect(within(dataRow).getByText("No runner-up")).toBeInTheDocument();
    // The bare dash is gone from the runner-up cell.
    expect(within(dataRow).queryByText("—")).not.toBeInTheDocument();
  });

  it("shows 'No wins recorded' in the winner cell and a dash in the runner-up cell when there is no winner", async () => {
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

    await openSundayView();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    const dataRow = rows[1]!;

    expect(within(dataRow).getByText("No wins recorded")).toBeInTheDocument();
    // The runner-up cell stays a dash when there is no winner at all.
    expect(within(dataRow).getByText("—")).toBeInTheDocument();
    expect(within(dataRow).queryByText("No runner-up")).not.toBeInTheDocument();
  });

  it("still renders the winner and runner-up names with their win counts", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [pastWinner(1_792_281_600_000_000_000n, "Ada", 4, "Bob", 2)],
    });
    renderWindow();

    await openSundayView();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    const dataRow = rows[1]!;

    expect(within(dataRow).getByText("Ada")).toBeInTheDocument();
    expect(within(dataRow).getByText("4 wins")).toBeInTheDocument();
    expect(within(dataRow).getByText("Bob")).toBeInTheDocument();
    expect(within(dataRow).getByText("2 wins")).toBeInTheDocument();
    // Neither fallback copy appears when both places are filled.
    expect(within(dataRow).queryByText("No runner-up")).not.toBeInTheDocument();
    expect(
      within(dataRow).queryByText("No wins recorded"),
    ).not.toBeInTheDocument();
  });
});

/* --- MyCompWins label --------------------------------------------------- */

describe("MyCompWins label", () => {
  it("shows the label 'Player key' with the active identity value unchanged", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      standings: [standing(1, "Ada", 3, true)],
    });
    const { container } = renderWindow();

    // The signed-in player's own wins panel renders with the renamed label.
    await screen.findByText("My competition wins");
    expect(await screen.findByText("Player key")).toBeInTheDocument();
    // The old label is gone.
    expect(screen.queryByText("Principal")).not.toBeInTheDocument();

    // The value is the active identity, unchanged by the rename: the panel
    // still renders a non-empty identity string under the renamed label.
    const value = container.querySelector(
      '[data-ocid="leaderboard.my_wins.principal"]',
    );
    expect(value).not.toBeNull();
    expect(value?.textContent?.trim()).not.toBe("");
  });
});

/* --- Admin allocation dropdown placeholder ------------------------------ */

describe("Admin allocation dropdown placeholder", () => {
  it("reads 'Select a competition' as the placeholder option", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    renderWindow();

    const select = await screen.findByRole("combobox");
    const options = within(select).getAllByRole("option");
    // The first option is the disabled placeholder.
    expect(options[0]?.textContent).toBe("Select a competition");
    expect(options[0]).toBeDisabled();
    // The old placeholder text is gone.
    expect(screen.queryByText("Select a Sunday")).not.toBeInTheDocument();
  });

  it("still lists the upcoming Sundays below the placeholder", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    renderWindow();

    const select = await screen.findByRole("combobox");
    const options = within(select).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[1]?.textContent).toContain("Sunday 25 Oct 2026, 00:00 UTC");
    expect(options[1]?.textContent).toContain("No allocation");
  });
});
