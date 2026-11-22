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
 * Characterization of the Leaderboard window's prize-adjacent behavior, taken
 * BEFORE the admin allocation controls are added.
 *
 * The request intentionally changes three things in this window:
 *   1. the player-visible "Prize pool" block with the "Pool" row is removed;
 *   2. the admin Claim state label changes from "Claimable" to "No allocation"
 *      when no allocation exists;
 *   3. the admin panel gains allocation controls (Sunday dropdown, amount field,
 *      live preview, confirm flow, clear button).
 *
 * This file deliberately does NOT assert any of those three. It pins the
 * adjacent behavior that must keep working through the change:
 *
 *   - the Sunday comp header wording (live / frozen);
 *   - the Sunday standings list (rank, name, wins, own-row highlight, no
 *     principal);
 *   - the Past winners table (date, winner, runner-up, newest first, no
 *     principal);
 *   - the signed-in player's "My prize" panel (amount, claimable/expired, empty
 *     state, signed-in only);
 *   - the admin panel's display gate (rendered only for the hardcoded admin
 *     principal, hidden for every other caller) and its current-pool /
 *     first-prize rows;
 *   - the prize data-layer consumer contract (the exact actor method and
 *     argument each hook calls, and the enabled / signedIn gates that keep the
 *     reads out of the game poll and off the anonymous caller).
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real prize reads are asserted in the
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
} from "@/backend";
import { ClaimStatus as ClaimStatusEnum } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { ADMIN_PRINCIPAL } from "@/lib/prize-admin";

/**
 * A realistic principal-shaped token (five dash-separated base32 groups). The
 * looser pattern false-positives on ordinary UI text such as the "Runner-up"
 * column header, so the assertion uses the full shape.
 */
const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

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

/* --- Sunday comp header (unchanged wording) ----------------------------- */

describe("Sunday comp header wording is unchanged", () => {
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

/* --- Sunday standings (unchanged) --------------------------------------- */

describe("Sunday standings are unchanged", () => {
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
});

/* --- Past winners table (unchanged) ------------------------------------- */

describe("Past winners table is unchanged", () => {
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

  it("shows the empty state when the player has no prize to claim", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({ status: LIVE_STATUS, myPrize: null });
    renderWindow();

    await waitFor(() => {
      expect(screen.getByText("No prize to claim yet")).toBeInTheDocument();
    });
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

    // The Sunday view renders (the player first-prize block is present) but the
    // signed-in-only My prize panel is absent.
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
    // claim-state label is intentionally NOT asserted here: the request changes
    // it from "Claimable" to "No allocation" when no allocation exists.
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

  it("hides the admin panel for a signed-out caller", async () => {
    seedOpen();
    actorState.principal = null;
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

/* --- Prize data-layer consumer contract (unchanged) --------------------- */

describe("Prize reads stay out of the game poll and off the anonymous caller", () => {
  it("issues the first-prize read only while the Sunday comp view is shown", async () => {
    seedOpen();
    const actor = makeActor({ status: FROZEN_STATUS });
    actorState.actor = actor;
    renderWindow();

    // Frozen default is All time: the prize read is not issued yet.
    await screen.findByRole("tab", { name: "All time" });
    expect(actor.getFirstPrizeForSunday).not.toHaveBeenCalled();

    // Switching to Comp issues the first-prize read; the player view derives
    // its pool from that value and never reads the admin-only current pool.
    await userEvent.setup().click(screen.getByRole("tab", { name: "Comp" }));
    await waitFor(() => {
      expect(actor.getFirstPrizeForSunday).toHaveBeenCalledWith(
        FROZEN_STATUS.sunday,
      );
    });
    expect(actor.getCurrentPrizePool).not.toHaveBeenCalled();
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

    // The Sunday view renders (the player first-prize read resolves) but the
    // signed-in-only update call is never issued for the anonymous caller.
    await screen.findByText("First prize 725.25 ICP");
    expect(actor.getMyPrize).not.toHaveBeenCalled();
  });
});
