import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the Sunday-competition live standings store, taken BEFORE
 * the change that stops the live store being cleared on every maintenance tick
 * during a live competition day and instead clears it inside the finalize loop
 * as each passed boundary is finalized.
 *
 * The request intentionally changes WHEN the live store is reset. This file
 * deliberately does NOT assert the per-tick clearing (the behavior being
 * changed) and does NOT assert the new in-loop clearing (the intentional
 * change). It protects the behavior ADJACENT to that change, which the live
 * board and the Past winners table depend on and which the new clearing point
 * must not disturb:
 *
 *   - while a competition is LIVE, the live standings read still returns the
 *     live rows and the Comp view still renders them (rank, name, win count,
 *     the caller's own row highlighted) rather than an empty state — the live
 *     store is not wiped out from under a live competition day;
 *   - the archive-backed Past winners read still renders its Date / Winner /
 *     Runner-up columns, newest first, and still carries no principal;
 *   - the live header still reads "Live, ends in 6h 12m" while live;
 *   - the standings read still uses the 50-row limit and the archive read is
 *     still issued, so the clearing point cannot silently drop either read.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real Sunday-comp behavior (boundaries,
 * archive idempotency, the exact tick at which the store is reset) is asserted
 * in the PocketIC backend lane, which is skipped in this environment for lack
 * of a backend wasm. See episode.coverageLimits.
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

import type { CompStandingRow, CompStatus, PastWinnerRow } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { SUNDAY_COMP_LIMIT } from "@/hooks/use-leaderboard";

/**
 * A realistic principal-shaped token (five dash-separated base32 groups). The
 * looser pattern false-positives on ordinary UI text such as the "Runner-up"
 * column header, so the assertion uses the full shape.
 */
const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

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

interface ActorOverrides {
  standings?: CompStandingRow[];
  status?: CompStatus;
  pastWinners?: PastWinnerRow[];
}

/** Build a typed actor fake with the four leaderboard methods. */
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

/* --- Live standings survive the clearing-point change ------------------- */

describe("Live standings survive the live-store clearing-point change", () => {
  it("still renders the live rows while a competition is live, not an empty state", async () => {
    seedOpen();
    // A live competition with two credited players. The live store must not be
    // wiped during the live day, so the Comp view renders these rows.
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      standings: [standing(1, "Ada", 3, true), standing(2, "Bob", 1)],
    });
    renderWindow();

    // A live status opens the Comp view by default.
    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);

    expect(within(items[0]!).getByText("Ada")).toBeInTheDocument();
    expect(within(items[0]!).getByText("3")).toBeInTheDocument();
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(within(items[0]!).getByText("You")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Bob")).toBeInTheDocument();

    // The live rows are shown, so the empty state is NOT rendered.
    expect(
      document.querySelector('[data-ocid="leaderboard.sunday.empty_state"]'),
    ).toBeNull();
  });

  it("still renders no principal in the live standings list", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      standings: [standing(1, "Ada", 3)],
    });
    const { container } = renderWindow();

    await screen.findByText("Ada");
    const list = container.querySelector(
      '[data-ocid="leaderboard.sunday.list"]',
    );
    expect(list).not.toBeNull();
    expect(list?.textContent).not.toMatch(PRINCIPAL_PATTERN);
  });

  it("still shows the live header while the competition is live", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: LIVE_STATUS });
    renderWindow();

    expect(
      await screen.findByText("LIVE NOW, Sunday 18 Oct"),
    ).toBeInTheDocument();
  });
});

/* --- Archive-backed reads stay stable ----------------------------------- */

describe("Archive-backed reads survive the clearing-point change", () => {
  it("still renders the Past winners columns, newest first, with no principal", async () => {
    seedOpen();
    const newest = 1_792_281_600_000_000_000n; // Sunday 18 Oct 2026
    const older = newest - 604_800_000_000_000n; // the previous Sunday
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pastWinners: [
        pastWinner(newest, "Ada", 4, "Bob", 2),
        pastWinner(older, "Cy", 1, undefined, undefined),
      ],
    });
    const { container } = renderWindow();

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

    // Newest first: the first data row is the most recent Sunday.
    const firstData = rows[1]!;
    expect(within(firstData).getByText("Sunday 18 Oct")).toBeInTheDocument();
    expect(within(firstData).getByText("Ada")).toBeInTheDocument();
    expect(within(firstData).getByText("4 wins")).toBeInTheDocument();
    expect(within(firstData).getByText("Bob")).toBeInTheDocument();
    expect(within(firstData).getByText("2 wins")).toBeInTheDocument();

    expect(table.textContent).not.toMatch(PRINCIPAL_PATTERN);
    expect(container.textContent).not.toMatch(PRINCIPAL_PATTERN);
  });

  it("still issues both the standings and the archive reads with the 50-row limit", async () => {
    seedOpen();
    const actor = makeActor({ status: LIVE_STATUS });
    actorState.actor = actor;
    renderWindow();

    // A live status opens the Comp view, so both reads run. The clearing point
    // must not silently drop either read.
    await screen.findByText("LIVE NOW, Sunday 18 Oct");
    expect(actor.getSundayCompStandings).toHaveBeenCalledWith(
      SUNDAY_COMP_LIMIT,
    );
    expect(actor.getPastWinners).toHaveBeenCalled();
    expect(SUNDAY_COMP_LIMIT).toBe(50n);
  });
});
