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
 * Cover for the accepted Comp-tab header and admin-label change in
 * LeaderboardWindow.tsx.
 *
 * The request replaces the old live/final-results header, the separate "First
 * prize" card and the "Final results" card with ONE live/next competition
 * header that carries the pool and first prize, plus a compact last-competition
 * line; and it adds competition-date labels and a next-competition allocation
 * line to the admin cards.
 *
 * This file asserts the accepted, observable behavior that the existing
 * leaderboard tests do not already pin:
 *
 *   - on a competition day the header reads "LIVE NOW, <date>" with the time
 *     remaining and "Pool X ICP, First prize Y ICP" for THIS competition (or
 *     "No prize set for this competition");
 *   - on a non-competition day the header reads "NEXT COMPETITION, <date>" with
 *     "Starts in Xd Yh", the local start time, the NEXT competition's pool and
 *     first prize (or "No prize set yet"), and one compact last-competition
 *     line (or "No wins recorded");
 *   - the player-facing pool is derived as the first prize times two;
 *   - the next competition key is derived from status.sunday ONLY: a Sunday
 *     boundary yields the following Thursday, a Thursday boundary the following
 *     Sunday, and an unknown boundary yields no next prize block;
 *   - the admin cards carry competition-date labels and a next-competition
 *     allocation line.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real schedule arithmetic, the archive
 * reads and the prize reads are asserted in the PocketIC backend lane, not here.
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
  ClaimStatus,
  CompStatus,
  PastWinnerRow,
  SundayAllocationStatus,
} from "@/backend";
import { ClaimStatus as ClaimStatusEnum } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { ADMIN_PRINCIPAL } from "@/lib/prize-admin";

/* --- Fixtures ----------------------------------------------------------- */

/**
 * A live competition status: Sunday 18 Oct 2026 00:00 UTC, 6h 12m remaining.
 * The day number (floor(sunday / 1 day)) is 20744, and 20744 mod 7 == 3, so
 * this is a Sunday boundary and the next competition is the following Thursday.
 */
const LIVE_STATUS: CompStatus = {
  live: true,
  // 2026-10-18T00:00:00Z in nanoseconds.
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 6n * 3_600n + 12n * 60n,
};

/**
 * A frozen status on the same Sunday boundary: the last competition ended, the
 * next competition starts in 2d 5h. The next key is the following Thursday
 * (22 Oct 2026).
 */
const FROZEN_STATUS: CompStatus = {
  live: false,
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 2n * 86_400n + 5n * 3_600n,
};

/**
 * A frozen status whose competition date is a THURSDAY: 2026-10-15T00:00:00Z.
 * The day number is 20741, and 20741 mod 7 == 0, so the next competition is the
 * following Sunday (18 Oct 2026).
 */
const FROZEN_THURSDAY_STATUS: CompStatus = {
  live: false,
  sunday: 1_792_022_400_000_000_000n,
  secondsRemaining: 2n * 86_400n + 5n * 3_600n,
};

/**
 * A frozen status whose competition date is neither a Sunday nor a Thursday:
 * 2026-10-13T00:00:00Z is a Tuesday (day number 20739, 20739 mod 7 == 2), so no
 * next competition key can be derived and no next prize block is shown.
 */
const FROZEN_UNKNOWN_STATUS: CompStatus = {
  live: false,
  sunday: 1_791_849_600_000_000_000n,
  secondsRemaining: 2n * 86_400n + 5n * 3_600n,
};

/** The next upcoming Sunday (UTC) the admin dropdown offers. */
const NEXT_SUNDAY = 1_792_886_400_000_000_000n; // 2026-10-25T00:00:00Z

const UPCOMING_STATUSES: SundayAllocationStatus[] = [
  { sunday: NEXT_SUNDAY, allocated: false, poolE8s: undefined },
];

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
  pastWinners?: PastWinnerRow[];
  firstPrize?: bigint | null;
  nextFirstPrize?: bigint | null;
  claimStatus?: ClaimStatus | null;
  upcomingStatuses?: SundayAllocationStatus[];
}

/**
 * Build a typed actor fake. `getFirstPrizeForSunday` is keyed by the Sunday it
 * is asked for, so the current competition's first prize and the next
 * competition's first prize can differ — exactly as the real backend returns
 * different stored allocations per Sunday.
 */
function makeActor(overrides: ActorOverrides = {}) {
  const currentSunday = (overrides.status ?? FROZEN_STATUS).sunday;
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi.fn().mockResolvedValue([]),
    getSundayCompStatus: vi
      .fn()
      .mockResolvedValue(overrides.status ?? FROZEN_STATUS),
    getPastWinners: vi.fn().mockResolvedValue(overrides.pastWinners ?? []),
    getMyPrize: vi.fn().mockResolvedValue(null),
    getClaimStatus: vi
      .fn()
      .mockResolvedValue(
        overrides.claimStatus === undefined
          ? ClaimStatusEnum.claimable
          : overrides.claimStatus,
      ),
    getFirstPrizeForSunday: vi.fn((sunday: bigint) => {
      if (sunday === currentSunday) {
        return Promise.resolve(
          overrides.firstPrize === undefined ? null : overrides.firstPrize,
        );
      }
      return Promise.resolve(
        overrides.nextFirstPrize === undefined
          ? null
          : overrides.nextFirstPrize,
      );
    }),
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

/* --- Live competition header -------------------------------------------- */

describe("Comp header on a competition day", () => {
  it("reads 'LIVE NOW, <date>' with the time remaining and the pool and first prize", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    // The live default opens on Comp.
    expect(
      await screen.findByText("LIVE NOW, Sunday 18 Oct"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ends in 6h 12m")).toBeInTheDocument();

    // The pool is derived as the first prize times two: 72,525,000,000 e8s
    // first prize -> 145,050,000,000 e8s pool = 1,450.5 ICP.
    const panel = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.prize.panel"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(panel).getByText("Pool 1,450.5 ICP")).toBeInTheDocument();
    expect(
      within(panel).getByText("First prize 725.25 ICP"),
    ).toBeInTheDocument();
  });

  it("reads 'No prize set for this competition' when the competition has no allocation", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: LIVE_STATUS, firstPrize: null });
    const { container } = renderWindow();

    expect(
      await screen.findByText("LIVE NOW, Sunday 18 Oct"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("No prize set for this competition"),
    ).toBeInTheDocument();
    // No allocation means no prize panel at all.
    expect(
      container.querySelector('[data-ocid="leaderboard.prize.panel"]'),
    ).toBeNull();
  });
});

/* --- Non-competition header --------------------------------------------- */

describe("Comp header on a non-competition day", () => {
  it("reads 'NEXT COMPETITION, <date>' with 'Starts in Xd Yh' and the local start time", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS });
    renderWindow();

    await openCompView();

    // The Sunday boundary's next competition is the following Thursday.
    expect(
      await screen.findByText("NEXT COMPETITION, Thursday 22 Oct"),
    ).toBeInTheDocument();
    // The remaining time and the viewer's local start time share one line.
    expect(screen.getByText(/Starts in 2d 5h/)).toBeInTheDocument();
    expect(screen.getByText(/your time/)).toBeInTheDocument();
  });

  it("shows the next competition's pool and first prize", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      // The current Sunday has no allocation; the NEXT competition does.
      firstPrize: null,
      nextFirstPrize: 5_000_000_000n,
    });
    const { container } = renderWindow();

    await openCompView();

    const panel = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.prize.panel"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // 50 ICP first prize -> 100 ICP pool.
    expect(within(panel).getByText("Pool 100 ICP")).toBeInTheDocument();
    expect(within(panel).getByText("First prize 50 ICP")).toBeInTheDocument();
  });

  it("reads 'No prize set yet' when the next competition has no allocation", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      firstPrize: null,
      nextFirstPrize: null,
    });
    const { container } = renderWindow();

    await openCompView();

    expect(await screen.findByText("No prize set yet")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="leaderboard.prize.panel"]'),
    ).toBeNull();
  });

  it("shows the compact last-competition line with the winner and win count", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [pastWinner(1_792_281_600_000_000_000n, "Ada", 4, "Bob", 2)],
    });
    const { container } = renderWindow();

    await openCompView();

    const line = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.sunday.last_competition"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(line.textContent).toBe(
      "Last competition: Sunday 18 Oct, winner Ada (4 wins)",
    );
  });

  it("reads 'No wins recorded' when the archive has no winner", async () => {
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
    const { container } = renderWindow();

    await openCompView();

    const line = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.sunday.last_competition"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(line.textContent).toBe("No wins recorded");
  });

  it("reads 'No wins recorded' when no competition has been archived", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS, pastWinners: [] });
    const { container } = renderWindow();

    await openCompView();

    const line = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.sunday.last_competition"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(line.textContent).toBe("No wins recorded");
  });
});

/* --- Next competition key derived from status.sunday only ---------------- */

describe("next competition key is derived from status.sunday only", () => {
  it("derives the following Sunday from a Thursday boundary", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_THURSDAY_STATUS });
    renderWindow();

    await openCompView();

    // 2026-10-15 is a Thursday; the next competition is the following Sunday.
    expect(
      await screen.findByText("NEXT COMPETITION, Sunday 18 Oct"),
    ).toBeInTheDocument();
  });

  it("shows no next prize block when the boundary is neither Sunday nor Thursday", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_UNKNOWN_STATUS,
      nextFirstPrize: 50_000_000_000n,
    });
    const { container } = renderWindow();

    await openCompView();

    // The header still renders, but with no derivable next key there is no
    // next-competition prize block.
    expect(await screen.findByText("NEXT COMPETITION")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="leaderboard.prize.panel"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-ocid="leaderboard.prize.empty_state"]'),
    ).toBeNull();
  });
});

/* --- Admin competition-date labels and next allocation line -------------- */

describe("admin cards carry competition-date labels and a next allocation line", () => {
  it("labels the current pool and first prize with the competition date", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
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

    // The current competition's Sunday is 18 Oct 2026.
    expect(
      within(panel).getByText("Current pool — Sunday 18 Oct"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText("First prize — Sunday 18 Oct"),
    ).toBeInTheDocument();
  });

  it("shows the next competition's allocation line with its pool and first prize", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
      nextFirstPrize: 5_000_000_000n,
      claimStatus: ClaimStatusEnum.claimable,
    });
    const { container } = renderWindow();

    const next = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.admin.next_allocation"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // The next competition after the Sunday boundary is Thursday 22 Oct.
    expect(
      within(next).getByText("Next competition — Thursday 22 Oct"),
    ).toBeInTheDocument();
    // 50 ICP first prize -> 100 ICP pool.
    expect(within(next).getByText("Pool 100 ICP")).toBeInTheDocument();
    expect(within(next).getByText("First prize 50 ICP")).toBeInTheDocument();
  });

  it("reads 'No prize set yet' in the next allocation line when unallocated", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
      nextFirstPrize: null,
      claimStatus: ClaimStatusEnum.claimable,
    });
    const { container } = renderWindow();

    const next = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.admin.next_allocation"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(next).getByText("No prize set yet")).toBeInTheDocument();
  });
});
