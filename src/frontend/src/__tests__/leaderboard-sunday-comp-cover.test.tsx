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
 * Cover for the Sunday comp view added to the Leaderboard window, switched by
 * the All time / Sunday comp toggle.
 *
 * The request keeps the existing board as "All time" and adds a second view in
 * the same window. This file asserts the accepted, observable behavior of the
 * new view and the toggle:
 *
 *   - the toggle renders both tabs and switches the visible board;
 *   - the Sunday standings render rank, name and win count, with the signed-in
 *     player's own row highlighted and no principal in the public list;
 *   - the header shows "LIVE NOW, Sunday 18 Oct" with "Ends in 6h 12m" while
 *     live and "NEXT COMPETITION, Thursday 22 Oct" with "Starts in 2d 5h" when
 *     frozen;
 *   - the Past winners table lists date, winner, runner-up and win counts,
 *     newest first, with no principal;
 *   - the empty state reads "No wins yet in this competition";
 *   - the toggle defaults to Sunday comp while live and to All time otherwise,
 *     and remembers the player's last manual choice for the visit.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real Sunday-comp behavior (boundaries,
 * archive idempotency, tie-break, no-principal responses) is asserted in the
 * PocketIC backend lane.
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
  } | null,
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: actorState.actor,
    isLoading: actorState.isLoading,
    error: actorState.error,
    retry: vi.fn(),
  }),
}));

import type {
  CompStandingRow,
  CompStatus,
  PastWinnerRow,
  WinnerRankingRow,
} from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { LEADERBOARD_LIMIT, SUNDAY_COMP_LIMIT } from "@/hooks/use-leaderboard";

/**
 * A realistic principal-shaped token (five dash-separated base32 groups). The
 * looser `[a-z0-9]{5}-[a-z0-9]{5}` pattern false-positives on ordinary UI text
 * such as the "Runner-up" column header, so the assertion uses the full shape.
 */
const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

/* --- Fixtures ----------------------------------------------------------- */

function allTimeRow(
  rank: number,
  displayName: string,
  wins: number,
  isMe = false,
): WinnerRankingRow {
  return { rank: BigInt(rank), displayName, wins: BigInt(wins), isMe };
}

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

interface ActorOverrides {
  ranking?: WinnerRankingRow[];
  standings?: CompStandingRow[];
  status?: CompStatus;
  pastWinners?: PastWinnerRow[];
}

/** Build a typed actor fake with the four leaderboard methods. */
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
  vi.clearAllMocks();
});

/* --- Toggle + view switching ------------------------------------------- */

describe("Leaderboard All time / Sunday comp toggle", () => {
  it("renders both tabs and switches the visible board", async () => {
    seedOpen();
    actorState.actor = makeActor({
      ranking: [allTimeRow(1, "Ada", 5)],
      standings: [standing(1, "Bob", 2)],
      status: FROZEN_STATUS,
    });
    renderWindow();

    const allTimeTab = await screen.findByRole("tab", { name: "All time" });
    const sundayTab = screen.getByRole("tab", { name: "Comp" });
    expect(allTimeTab).toBeInTheDocument();
    expect(sundayTab).toBeInTheDocument();

    // Frozen default is All time: the existing board is shown.
    expect(allTimeTab).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Ada")).toBeInTheDocument();

    // Switching to Sunday comp shows the Sunday standings instead.
    await userEvent.setup().click(sundayTab);
    expect(sundayTab).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
  });

  it("requests the Sunday standings with the 50-row limit", async () => {
    seedOpen();
    const actor = makeActor({ status: LIVE_STATUS });
    actorState.actor = actor;
    renderWindow();

    // Live default opens on Sunday comp once the status resolves, so the
    // standings query runs with the 50-row limit.
    await waitFor(() => {
      expect(actor.getSundayCompStandings).toHaveBeenCalledWith(
        SUNDAY_COMP_LIMIT,
      );
    });
    expect(SUNDAY_COMP_LIMIT).toBe(50n);
  });
});

/* --- Sunday standings --------------------------------------------------- */

describe("Sunday comp standings", () => {
  it("renders rank, name and win count and highlights the signed-in player", async () => {
    seedOpen();
    actorState.actor = makeActor({
      standings: [standing(1, "Ada", 3, true), standing(2, "Bob", 1)],
      status: LIVE_STATUS,
    });
    renderWindow();

    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);

    expect(within(items[0]!).getByText("1")).toBeInTheDocument();
    expect(within(items[0]!).getByText("Ada")).toBeInTheDocument();
    expect(within(items[0]!).getByText("3")).toBeInTheDocument();
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(within(items[0]!).getByText("You")).toBeInTheDocument();

    expect(items[1]).not.toHaveAttribute("aria-current");
    expect(within(items[1]!).queryByText("You")).not.toBeInTheDocument();
  });

  it("renders no principal in the public Sunday list", async () => {
    seedOpen();
    actorState.actor = makeActor({
      standings: [standing(1, "Ada", 3)],
      status: LIVE_STATUS,
    });
    const { container } = renderWindow();

    await screen.findByText("Ada");
    const list = container.querySelector(
      '[data-ocid="leaderboard.sunday.list"]',
    );
    expect(list).not.toBeNull();
    expect(list?.textContent).not.toMatch(PRINCIPAL_PATTERN);
  });

  it("shows 'No wins yet in this competition' when the standings are empty", async () => {
    seedOpen();
    actorState.actor = makeActor({ standings: [], status: LIVE_STATUS });
    renderWindow();

    expect(
      await screen.findByText("No wins yet in this competition"),
    ).toBeInTheDocument();
  });

  it("shows the Sunday loading state while the standings are fetched", async () => {
    seedOpen();
    actorState.actor = {
      getWinnerRanking: vi.fn().mockResolvedValue([]),
      getSundayCompStandings: vi.fn(() => new Promise<never>(() => {})),
      getSundayCompStatus: vi.fn().mockResolvedValue(LIVE_STATUS),
      getPastWinners: vi.fn().mockResolvedValue([]),
    };
    renderWindow();

    expect(
      await screen.findByText("Loading the Sunday standings…"),
    ).toBeInTheDocument();
  });

  it("shows the Sunday error state with a working retry", async () => {
    seedOpen();
    const getSundayCompStandings = vi
      .fn()
      .mockRejectedValueOnce(new Error("backend down"))
      .mockResolvedValueOnce([standing(1, "Ada", 2)]);
    actorState.actor = {
      getWinnerRanking: vi.fn().mockResolvedValue([]),
      getSundayCompStandings,
      getSundayCompStatus: vi.fn().mockResolvedValue(LIVE_STATUS),
      getPastWinners: vi.fn().mockResolvedValue([]),
    };
    renderWindow();

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(
      document.querySelector('[data-ocid="leaderboard.sunday.error_state"]'),
    ).not.toBeNull();

    await userEvent.setup().click(retry);
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(getSundayCompStandings).toHaveBeenCalledTimes(2);
  });
});

/* --- Header ------------------------------------------------------------- */

describe("Sunday comp header", () => {
  it("shows 'LIVE NOW, Sunday 18 Oct' with 'Ends in 6h 12m' during a live competition", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: LIVE_STATUS });
    renderWindow();

    expect(
      await screen.findByText("LIVE NOW, Sunday 18 Oct"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ends in 6h 12m")).toBeInTheDocument();
  });

  it("shows 'NEXT COMPETITION, Thursday 22 Oct' with 'Starts in 2d 5h' when frozen", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS });
    renderWindow();

    // Frozen default is All time; switch to Comp to see the header.
    await userEvent
      .setup()
      .click(await screen.findByRole("tab", { name: "Comp" }));

    expect(
      await screen.findByText("NEXT COMPETITION, Thursday 22 Oct"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Starts in 2d 5h/)).toBeInTheDocument();
  });
});

/* --- Past winners table ------------------------------------------------- */

describe("Past winners table", () => {
  it("lists date, winner, runner-up and win counts, newest first", async () => {
    seedOpen();
    // Two archived competitions; the backend returns newest first.
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

    await userEvent
      .setup()
      .click(await screen.findByRole("tab", { name: "Comp" }));

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    // One header row plus two data rows.
    expect(rows).toHaveLength(3);

    // Newest first: the first data row is the most recent Sunday.
    const firstData = rows[1]!;
    expect(within(firstData).getByText("Sunday 18 Oct")).toBeInTheDocument();
    expect(within(firstData).getByText("Ada")).toBeInTheDocument();
    expect(within(firstData).getByText("4 wins")).toBeInTheDocument();
    expect(within(firstData).getByText("Bob")).toBeInTheDocument();
    expect(within(firstData).getByText("2 wins")).toBeInTheDocument();

    // The older competition has a single winner and no runner-up.
    const secondData = rows[2]!;
    expect(within(secondData).getByText("Cy")).toBeInTheDocument();
    expect(within(secondData).getByText("1 win")).toBeInTheDocument();
  });

  it("renders no principal in the Past winners table", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [pastWinner(1_792_281_600_000_000_000n, "Ada", 4, "Bob", 2)],
    });
    const { container } = renderWindow();

    await userEvent
      .setup()
      .click(await screen.findByRole("tab", { name: "Comp" }));

    const table = await screen.findByRole("table");
    expect(table.textContent).not.toMatch(PRINCIPAL_PATTERN);
    expect(container.textContent).not.toMatch(PRINCIPAL_PATTERN);
  });

  it("shows the empty state when no competition has been archived", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS, pastWinners: [] });
    renderWindow();

    await userEvent
      .setup()
      .click(await screen.findByRole("tab", { name: "Comp" }));

    expect(
      await screen.findByText("No competitions archived yet"),
    ).toBeInTheDocument();
  });
});

/* --- Default view + remembered choice ----------------------------------- */

describe("Sunday comp default view and remembered choice", () => {
  it("defaults to Sunday comp while a competition is live", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: LIVE_STATUS });
    renderWindow();

    // The live default is applied once the status query resolves, so wait for
    // the tab to become selected rather than asserting on the first render.
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Comp" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
  });

  it("defaults to All time when no competition is live", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS });
    renderWindow();

    const allTimeTab = await screen.findByRole("tab", { name: "All time" });
    expect(allTimeTab).toHaveAttribute("aria-selected", "true");
  });

  it("remembers the player's last manual choice for the visit", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS });
    const first = renderWindow();

    // Manually choose Comp while frozen.
    await userEvent
      .setup()
      .click(await screen.findByRole("tab", { name: "Comp" }));
    expect(await screen.findByRole("tab", { name: "Comp" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Remount within the same visit: the choice is restored from sessionStorage.
    first.unmount();
    renderWindow();
    expect(await screen.findByRole("tab", { name: "Comp" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("does not let a stale saved choice override the live default", async () => {
    seedOpen();
    // A previous visit saved All time, but a competition is live now.
    window.sessionStorage.setItem("tco-leaderboard-view", "allTime");
    actorState.actor = makeActor({ status: LIVE_STATUS });
    renderWindow();

    // The live default is applied once the status query resolves and overrides
    // the stale saved choice.
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Comp" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
  });
});

/* --- All time unchanged ------------------------------------------------- */

describe("All time view is unchanged by the Sunday addition", () => {
  it("still requests the top 50 from getWinnerRanking", async () => {
    seedOpen();
    const actor = makeActor({
      ranking: [allTimeRow(1, "Ada", 5)],
      status: FROZEN_STATUS,
    });
    actorState.actor = actor;
    renderWindow();

    await screen.findByText("Ada");
    expect(actor.getWinnerRanking).toHaveBeenCalledWith(LEADERBOARD_LIMIT);
    expect(LEADERBOARD_LIMIT).toBe(50n);
  });
});
