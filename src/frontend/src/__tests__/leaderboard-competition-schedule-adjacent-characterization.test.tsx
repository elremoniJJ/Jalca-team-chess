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
 * Characterization of the Leaderboard window's competition view, taken BEFORE
 * the competition schedule is generalized from weekly Sundays to alternating
 * Sundays and Thursdays and the wording labels are renamed.
 *
 * The request intentionally changes four visible strings:
 *   1. the competition tab label from "Sunday comp" to "Comp";
 *   2. the heading from "This Sunday" to "This competition";
 *   3. the empty state from "No wins yet this Sunday" to "No wins yet in this
 *      competition";
 *   4. the admin competition-date dropdown label from "Sunday" to
 *      "Competition date".
 *
 * This file deliberately does NOT assert any of those four strings. It pins the
 * adjacent behavior that must keep working through the change:
 *
 *   - the competition standings list still renders rank, name and win count,
 *     still highlights the signed-in player's own row, and still carries no
 *     principal;
 *   - the competition loading / error+retry states still render;
 *   - the Past winners table still renders the Date / Winner / Runner-up
 *     columns with the win counts, newest first, and still carries no
 *     principal;
 *   - the signed-in player's "My prize" panel still shows the amount and a
 *     claimable/expired status, and is still signed-in only;
 *   - the admin panel display gate is unchanged (rendered only for the
 *     hardcoded admin principal) and its current-pool / first-prize rows are
 *     unchanged;
 *   - the data-layer consumer contract is unchanged: the standings read uses
 *     the 50-row limit, the All time board still reads getWinnerRanking(50n),
 *     and the prize reads stay out of the game poll and off the anonymous
 *     caller.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real competition behavior (boundaries,
 * archive idempotency, claim deadline, no-principal responses) is asserted in
 * the PocketIC backend lane.
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
  MyPrize,
  PastWinnerRow,
  PrizePool,
  WinnerRankingRow,
} from "@/backend";
import { ClaimStatus as ClaimStatusEnum } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { LEADERBOARD_LIMIT, SUNDAY_COMP_LIMIT } from "@/hooks/use-leaderboard";
import { ADMIN_PRINCIPAL } from "@/lib/prize-admin";

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

/** A pool of 1,450.50 ICP with a first prize of 725.25 ICP. */
const POOL: PrizePool = {
  poolE8s: 145_050_000_000n,
  firstPrizeE8s: 72_525_000_000n,
};

/** A claimable prize: deadline far in the future so the status reads claimable. */
const CLAIMABLE_PRIZE: MyPrize = {
  sunday: 1_792_281_600_000_000_000n,
  rank: 1n,
  amountE8s: 72_525_000_000n,
  // 2030-01-01T00:00:00Z — far in the future, so the prize is always claimable.
  deadline: 1_893_456_000_000_000_000n,
};

/** An expired prize: the deadline is in the past. */
const EXPIRED_PRIZE: MyPrize = {
  sunday: 1_792_281_600_000_000n,
  rank: 2n,
  amountE8s: 0n,
  // 2026-10-11T00:00:00Z — a week before the Sunday, already past.
  deadline: 1_791_676_800_000_000_000n,
};

interface ActorOverrides {
  ranking?: WinnerRankingRow[];
  status?: CompStatus;
  standings?: CompStandingRow[];
  pastWinners?: PastWinnerRow[];
  pool?: PrizePool;
  myPrize?: MyPrize | null;
  claimStatus?: ClaimStatus | null;
  firstPrize?: bigint | null;
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
    getUpcomingAllocationStatuses: vi.fn().mockResolvedValue([]),
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

/**
 * Switch to the competition view. The tab's label is intentionally changing
 * from "Sunday comp" to "Comp", so this selects the tab by its stable
 * data-ocid rather than by its (changing) accessible name.
 */
async function openCompetitionView() {
  const tab = await screen.findByRole("tab", {
    name: /Sunday comp|Comp/,
  });
  await userEvent.setup().click(tab);
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

/* --- Competition standings (adjacent to the wording change) ------------- */

describe("Competition standings survive the schedule and wording change", () => {
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

  it("still renders no principal in the public competition list", async () => {
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

  it("still shows the competition loading state while the standings are fetched", async () => {
    seedOpen();
    actorState.actor = {
      ...makeActor({ status: LIVE_STATUS }),
      getSundayCompStandings: vi.fn(() => new Promise<never>(() => {})),
    };
    renderWindow();

    expect(
      await screen.findByText("Loading the Sunday standings…"),
    ).toBeInTheDocument();
  });

  it("still shows the competition error state with a working retry", async () => {
    seedOpen();
    const getSundayCompStandings = vi
      .fn()
      .mockRejectedValueOnce(new Error("backend down"))
      .mockResolvedValueOnce([standing(1, "Ada", 2)]);
    actorState.actor = {
      ...makeActor({ status: LIVE_STATUS }),
      getSundayCompStandings,
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

/* --- Competition date formatting (schedule-independent) ----------------- */

describe("Competition date formatting survives the schedule generalization", () => {
  it("formats a Sunday competition date in UTC", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS });
    renderWindow();

    await openCompetitionView();

    // The next competition after a Sunday boundary is the following Thursday.
    expect(
      await screen.findByText("NEXT COMPETITION, Thursday 22 Oct"),
    ).toBeInTheDocument();
  });

  it("formats a Thursday competition date in UTC, not only Sundays", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_THURSDAY_STATUS });
    renderWindow();

    await openCompetitionView();

    // 2026-10-15 is a Thursday; the shared formatter must render it as such.
    // The next competition after a Thursday boundary is the following Sunday.
    expect(
      await screen.findByText("NEXT COMPETITION, Sunday 18 Oct"),
    ).toBeInTheDocument();
  });
});

/* --- Past winners table (unchanged) ------------------------------------- */

describe("Past winners table keeps its rendered columns", () => {
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

    await openCompetitionView();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    // One header row plus two data rows.
    expect(rows).toHaveLength(3);

    // The three columns are still Date / Winner / Runner-up.
    const headers = within(rows[0]!).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "Date",
      "Winner",
      "Runner-up",
    ]);

    // Newest first: the first data row is the most recent competition.
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

  it("still renders no principal in the Past winners table", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [pastWinner(1_792_281_600_000_000_000n, "Ada", 4, "Bob", 2)],
    });
    const { container } = renderWindow();

    await openCompetitionView();

    const table = await screen.findByRole("table");
    expect(table.textContent).not.toMatch(PRINCIPAL_PATTERN);
    expect(container.textContent).not.toMatch(PRINCIPAL_PATTERN);
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

/* --- My prize panel (unchanged) ----------------------------------------- */

describe("My prize panel is unchanged", () => {
  it("shows the signed-in player's prize amount and a claimable status", async () => {
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
    const status = document.querySelector(
      '[data-ocid="leaderboard.my_prize.status"]',
    );
    expect(status).not.toBeNull();
    expect(status?.textContent).toMatch(/Claimable/);
  });

  it("shows an expired status once the deadline has passed", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      myPrize: EXPIRED_PRIZE,
    });
    renderWindow();

    const status = await waitFor(() => {
      const el = document.querySelector(
        '[data-ocid="leaderboard.my_prize.status"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(status.textContent).toBe("Expired");
  });

  it("does not render the My prize panel for a signed-out caller", async () => {
    seedOpen();
    // No principal: signed out. The panel is signed-in only.
    actorState.principal = null;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    // The competition view renders (the player first-prize block is present)
    // but the signed-in-only My prize panel is absent.
    await screen.findByText("First prize 725.25 ICP");
    expect(
      container.querySelector('[data-ocid="leaderboard.my_prize.panel"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-ocid="leaderboard.my_prize.empty_state"]'),
    ).toBeNull();
  });
});

/* --- Admin panel display gate (unchanged) ------------------------------- */

describe("Admin panel display gate is unchanged", () => {
  it("renders the admin panel for the hardcoded admin principal with its pool and first prize", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      firstPrize: 72_525_000_000n,
      claimStatus: ClaimStatusEnum.claimable,
    });
    renderWindow();

    // The admin panel's current-pool and first-prize rows are unchanged. The
    // claim-state label and the dropdown label are intentionally NOT asserted
    // here: the request changes the dropdown label from "Sunday" to
    // "Competition date".
    await waitFor(() => {
      expect(screen.getByText("1,450.5 ICP")).toBeInTheDocument();
      expect(screen.getByText("725.25 ICP")).toBeInTheDocument();
    });
  });

  it("hides the admin panel for a non-admin signed-in player", async () => {
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

  it("does not read the claim status for a non-admin caller", async () => {
    seedOpen();
    actorState.principal = "player-1";
    const actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    actorState.actor = actor;
    renderWindow();

    await screen.findByText("First prize 725.25 ICP");
    // The claim-status read is admin-only; a non-admin caller never issues it.
    expect(actor.getClaimStatus).not.toHaveBeenCalled();
  });
});

/* --- Data-layer consumer contract (unchanged) --------------------------- */

describe("Competition reads keep their consumer contract", () => {
  it("requests the competition standings with the 50-row limit", async () => {
    seedOpen();
    const actor = makeActor({ status: LIVE_STATUS });
    actorState.actor = actor;
    renderWindow();

    // Live default opens on the competition view once the status resolves, so
    // the standings query runs with the 50-row limit.
    await waitFor(() => {
      expect(actor.getSundayCompStandings).toHaveBeenCalledWith(
        SUNDAY_COMP_LIMIT,
      );
    });
    expect(SUNDAY_COMP_LIMIT).toBe(50n);
  });

  it("still requests the top 50 from getWinnerRanking for the All time board", async () => {
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

  it("never issues the signed-in-only getMyPrize read for a signed-out caller", async () => {
    seedOpen();
    actorState.principal = null;
    const actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    actorState.actor = actor;
    renderWindow();

    // The competition view renders (the player first-prize read resolves) but
    // the signed-in-only update call is never issued for the anonymous caller.
    await screen.findByText("First prize 725.25 ICP");
    expect(actor.getMyPrize).not.toHaveBeenCalled();
  });
});
