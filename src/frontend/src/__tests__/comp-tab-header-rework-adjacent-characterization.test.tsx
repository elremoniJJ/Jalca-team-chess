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
 * Characterization of the Comp tab's behavior ADJACENT to the header rework,
 * taken BEFORE the change.
 *
 * The request intentionally replaces three things at the top of the Comp tab:
 *   1. the SundayCompHeader card (live / final-results wording);
 *   2. the separate "First prize" card (PlayerFirstPrize);
 *   3. the "Final results" card;
 * and adds competition-date labels to the admin cards plus a next-competition
 * allocation line.
 *
 * This file deliberately does NOT pin any of those. It protects the behavior
 * that must survive the rework:
 *
 *   - the "This competition" standings list still renders rank, name and win
 *     count, still highlights the signed-in player's own row, and still carries
 *     no principal;
 *   - the standings empty / loading / error+retry states still render;
 *   - the guest notice still renders for a signed-out caller and the
 *     signed-in-only "My competition wins" panel still renders for a signed-in
 *     player;
 *   - the Past winners table still renders Date / Winner / Runner-up with the
 *     win counts, newest first, and still carries no principal;
 *   - the All time board still renders from getWinnerRanking(50n) and still
 *     highlights the caller's own row;
 *   - the collapse contract (aria-expanded, body unmounted while collapsed,
 *     JSON-boolean localStorage persistence) is unchanged.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real Sunday-comp behavior is asserted
 * in the PocketIC backend lane.
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
  WinnerRankingRow,
} from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { LEADERBOARD_LIMIT } from "@/hooks/use-leaderboard";

/**
 * A realistic principal-shaped token (five dash-separated base32 groups). The
 * looser pattern false-positives on ordinary UI text such as the "Runner-up"
 * column header, so the assertion uses the full shape.
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

/** Switch to the competition view (frozen default is All time). */
async function openCompView() {
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

/* --- "This competition" standings (adjacent to the header rework) ------- */

describe("This competition standings survive the header rework", () => {
  it("still renders rank, name and win count and highlights the signed-in player", async () => {
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

  it("still renders no principal in the public standings list", async () => {
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

  it("still shows 'No wins yet in this competition' when the standings are empty", async () => {
    seedOpen();
    actorState.actor = makeActor({ standings: [], status: LIVE_STATUS });
    renderWindow();

    expect(
      await screen.findByText("No wins yet in this competition"),
    ).toBeInTheDocument();
  });

  it("still shows the standings loading state while they are fetched", async () => {
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

  it("still shows the standings error state with a working retry", async () => {
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

/* --- Guest notice and My competition wins (adjacent) -------------------- */

describe("Guest notice and My competition wins survive the header rework", () => {
  it("still shows the guest notice and no My competition wins for a signed-out caller", async () => {
    seedOpen();
    actorState.principal = null;
    actorState.actor = makeActor({ status: LIVE_STATUS });
    const { container } = renderWindow();

    expect(
      await screen.findByText(
        "Guests do not earn competition wins. Sign in and join as ranked to compete.",
      ),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="leaderboard.my_wins.panel"]'),
    ).toBeNull();
  });

  it("still shows the signed-in player's own competition wins and credited name", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      standings: [standing(1, "Ada", 3, true)],
      status: LIVE_STATUS,
    });
    renderWindow();

    expect(await screen.findByText("My competition wins")).toBeInTheDocument();
    const panel = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.my_wins.panel"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(panel).getByText("3 wins")).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="leaderboard.my_wins.credited_name"]')
        ?.textContent,
    ).toBe("Ada");
  });
});

/* --- Past winners table (adjacent to the header rework) ----------------- */

describe("Past winners table survives the header rework", () => {
  it("still lists date, winner, runner-up and win counts, newest first", async () => {
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

    await openCompView();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    // One header row plus two data rows.
    expect(rows).toHaveLength(3);

    const headers = within(rows[0]!).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "Date",
      "Winner",
      "Runner-up",
    ]);

    const firstData = rows[1]!;
    expect(within(firstData).getByText("Sunday 18 Oct")).toBeInTheDocument();
    expect(within(firstData).getByText("Ada")).toBeInTheDocument();
    expect(within(firstData).getByText("4 wins")).toBeInTheDocument();
    expect(within(firstData).getByText("Bob")).toBeInTheDocument();
    expect(within(firstData).getByText("2 wins")).toBeInTheDocument();

    const secondData = rows[2]!;
    expect(within(secondData).getByText("Cy")).toBeInTheDocument();
    expect(within(secondData).getByText("1 win")).toBeInTheDocument();
  });

  it("still renders no principal in the Past winners table", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [pastWinner(1_792_281_600_000_000_000n, "Ada", 4, "Bob", 2)],
    });
    const { container } = renderWindow();

    await openCompView();

    const table = await screen.findByRole("table");
    expect(table.textContent).not.toMatch(PRINCIPAL_PATTERN);
    expect(container.textContent).not.toMatch(PRINCIPAL_PATTERN);
  });

  it("still shows the empty state when no competition has been archived", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS, pastWinners: [] });
    renderWindow();

    await openCompView();

    expect(
      await screen.findByText("No competitions archived yet"),
    ).toBeInTheDocument();
  });
});

/* --- All time board (untouched by the request) -------------------------- */

describe("All time board is untouched by the Comp tab header rework", () => {
  it("still renders the ranked board from getWinnerRanking(50n) in server order", async () => {
    seedOpen();
    const actor = makeActor({
      ranking: [allTimeRow(1, "Ada", 5), allTimeRow(2, "Bob", 3)],
      status: FROZEN_STATUS,
    });
    actorState.actor = actor;
    renderWindow();

    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Ada")).toBeInTheDocument();
    expect(within(items[0]!).getByText("5")).toBeInTheDocument();
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Ada"),
      expect.stringContaining("Bob"),
    ]);

    expect(actor.getWinnerRanking).toHaveBeenCalledWith(LEADERBOARD_LIMIT);
    expect(LEADERBOARD_LIMIT).toBe(50n);
  });

  it("still highlights the signed-in player's own row with the You badge", async () => {
    seedOpen();
    actorState.actor = makeActor({
      ranking: [allTimeRow(1, "Ada", 5, true), allTimeRow(2, "Bob", 3)],
      status: FROZEN_STATUS,
    });
    renderWindow();

    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(within(items[0]!).getByText("You")).toBeInTheDocument();
    expect(items[1]).not.toHaveAttribute("aria-current");
  });
});

/* --- Collapse contract (shared, unchanged) ------------------------------ */

describe("Leaderboard collapse contract is unchanged", () => {
  it("keeps collapsed-by-default, body unmounted, and JSON-boolean persistence", async () => {
    const user = userEvent.setup();
    actorState.actor = makeActor({ status: FROZEN_STATUS });
    const first = renderWindow();

    const header = screen.getByRole("button", { name: /Leaderboard/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      document.querySelector('[data-ocid="leaderboard.empty_state"]'),
    ).toBeNull();

    // Opening mounts the body and writes the JSON boolean true.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("No ranked wins yet")).toBeInTheDocument();
    expect(window.localStorage.getItem("tco-leaderboard-open")).toBe("true");

    // Remount restores the expanded state from localStorage.
    first.unmount();
    renderWindow();
    expect(screen.getByRole("button", { name: /Leaderboard/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
