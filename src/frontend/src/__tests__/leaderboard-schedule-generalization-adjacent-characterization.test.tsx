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
// testing-library test-id attribute once so the stable tab markers can be
// selected by their data-ocid rather than by their (intentionally changing)
// labels.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the Leaderboard window behavior ADJACENT to the
 * competition-schedule generalization, taken BEFORE the schedule changes from
 * weekly Sundays to alternating Sundays and Thursdays.
 *
 * The request intentionally changes:
 *   - the competition tab label ('Sunday comp' -> 'Comp');
 *   - the standings heading ('This Sunday' -> 'This competition');
 *   - the empty state ('No wins yet this Sunday' -> 'No wins yet in this
 *     competition');
 *   - the admin dropdown label ('Sunday' -> 'Competition date');
 *   - the schedule itself (weekly Sundays -> alternating Sundays/Thursdays).
 *
 * Those are intentional, so this file deliberately does NOT pin any of those
 * labels and does NOT assert a Sunday-only schedule. What it protects is the
 * behavior that must survive the change:
 *
 *   - the status header still renders the live and frozen states, and the
 *     remaining-time formatter still reads "Xd Yh" / "Xh Ym" / "Xm" across its
 *     boundaries (the schedule change must not alter the countdown format);
 *   - the frozen header still formats the competition date in UTC, and it must
 *     format a THURSDAY date correctly too — the generalized schedule includes
 *     Thursdays, so the shared date formatter must not assume Sunday;
 *   - the default view is still the competition view while a competition is
 *     live and All time otherwise;
 *   - the All time board is untouched: it still reads getWinnerRanking(50n) and
 *     still highlights the signed-in player's own row.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real schedule arithmetic (the shared
 * boundary helper, the window check, the finalization loop and its seed, the
 * claim deadlines, the competition-date list) is asserted in the PocketIC
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

import type { CompStandingRow, CompStatus, WinnerRankingRow } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { LEADERBOARD_LIMIT } from "@/hooks/use-leaderboard";

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

/**
 * A live competition status. The `sunday` field is the competition's start
 * boundary; the schedule generalization keeps the same CompStatus shape, so
 * this fixture only needs a valid boundary at or before now.
 */
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

/**
 * A frozen status whose competition date is a THURSDAY: 2026-10-15T00:00:00Z.
 * The generalized schedule includes Thursdays, so the shared date formatter
 * must render a Thursday date, not only Sundays.
 */
const FROZEN_THURSDAY_STATUS: CompStatus = {
  live: false,
  sunday: 1_792_022_400_000_000_000n,
  secondsRemaining: 2n * 86_400n + 5n * 3_600n,
};

interface ActorOverrides {
  ranking?: WinnerRankingRow[];
  standings?: CompStandingRow[];
  status?: CompStatus;
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
    getPastWinners: vi.fn().mockResolvedValue([]),
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

/* --- Status header: live / frozen and the countdown format -------------- */

describe("competition status header survives the schedule generalization", () => {
  it("renders the live state with the countdown in hours and minutes", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: LIVE_STATUS });
    renderWindow();

    // 6h 12m remaining reads as "6h 12m" — the countdown format is unchanged.
    expect(await screen.findByText("Ends in 6h 12m")).toBeInTheDocument();
  });

  it("renders the frozen state with the countdown in days and hours", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS });
    renderWindow();

    // Frozen default is All time; switch to the competition view to see the
    // header. The tab's label is intentionally changing, so select it by its
    // stable data-ocid rather than by its text.
    await userEvent
      .setup()
      .click(await screen.findByTestId("leaderboard.view_tab.sunday_comp"));

    // 2d 5h remaining reads as "2d 5h" — the countdown format is unchanged.
    expect(await screen.findByText(/Starts in 2d 5h/)).toBeInTheDocument();
  });

  it("formats a Thursday competition date in UTC, not only Sundays", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_THURSDAY_STATUS });
    renderWindow();

    await userEvent
      .setup()
      .click(await screen.findByTestId("leaderboard.view_tab.sunday_comp"));

    // 2026-10-15 is a Thursday; the shared formatter must render it as such.
    // The next competition after a Thursday boundary is the following Sunday.
    expect(
      await screen.findByText("NEXT COMPETITION, Sunday 18 Oct"),
    ).toBeInTheDocument();
  });

  it("formats a Sunday competition date in UTC", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS });
    renderWindow();

    await userEvent
      .setup()
      .click(await screen.findByTestId("leaderboard.view_tab.sunday_comp"));

    // The next competition after a Sunday boundary is the following Thursday.
    expect(
      await screen.findByText("NEXT COMPETITION, Thursday 22 Oct"),
    ).toBeInTheDocument();
  });
});

/* --- Default view: live -> competition view, frozen -> All time --------- */

describe("default view selection survives the schedule generalization", () => {
  it("opens on the competition view while a competition is live", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: LIVE_STATUS });
    renderWindow();

    // The live default is applied once the status query resolves. Select the
    // tab by its stable data-ocid, not its (changing) label.
    await waitFor(() => {
      expect(
        screen.getByTestId("leaderboard.view_tab.sunday_comp"),
      ).toHaveAttribute("aria-selected", "true");
    });
  });

  it("opens on All time when no competition is live", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS });
    renderWindow();

    const allTimeTab = await screen.findByTestId(
      "leaderboard.view_tab.all_time",
    );
    expect(allTimeTab).toHaveAttribute("aria-selected", "true");
  });
});

/* --- All time board: untouched by the schedule change ------------------- */

describe("All time board is untouched by the schedule generalization", () => {
  it("still reads getWinnerRanking(50n) and renders the ranked rows", async () => {
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

/* --- Competition standings: row shape and own-row highlight ------------- */

describe("competition standings row shape survives the schedule generalization", () => {
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
});
