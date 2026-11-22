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
 * Characterization of the Leaderboard window's Sunday comp view, taken BEFORE
 * the change that (a) finalizes a finished competition from the recurring
 * maintenance timer, (b) adds an admin-only manual finalize action surfaced in
 * the leaderboard admin panel, and (c) backfills the 22 Oct and 4/11/15/18 Oct
 * archive rows so the Past winners table shows winner data where it previously
 * showed dashes.
 *
 * Those three things are intentional, so this file deliberately does NOT assert
 * the manual finalize control, the timer-driven finalize, or any specific
 * backfilled winner. What it protects is the behavior ADJACENT to the change
 * that must survive it:
 *
 *   - the admin panel still renders its existing content for the admin
 *     principal — the current pool, the first prize, the claim state, the
 *     allocation controls and the prize-claims section — so the manual finalize
 *     control is an addition rather than a replacement;
 *   - the Past winners table still renders the Date / Winner / Runner-up
 *     columns with the win counts, newest first, and still carries no principal
 *     — the backfill changes the DATA, not the table's structure;
 *   - a Past winners row with no winner still renders its dash fallback, so the
 *     backfill is observable as data rather than a structural change.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real archive behavior (exactly-once
 * finalization, no-principal responses, the admin gate) is asserted in the
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
    getCurrentPrizePool: () => Promise<unknown>;
    getMyPrize: () => Promise<unknown>;
    getClaimStatus: (sunday: bigint) => Promise<unknown>;
    getFirstPrizeForSunday: (sunday: bigint) => Promise<unknown>;
    getUpcomingAllocationStatuses: () => Promise<unknown>;
    getAdminPrizeClaims: () => Promise<unknown>;
    getAdminAllocatedCompetitionDates: () => Promise<unknown>;
    getAdminCompetitionDetail: (sunday: bigint) => Promise<unknown>;
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
  PrizePool,
  SundayAllocationStatus,
} from "@/backend";
import { ClaimStatus as ClaimStatusEnum } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { ADMIN_PRINCIPAL } from "@/lib/prize-admin";

/**
 * A realistic principal-shaped token (five dash-separated base32 groups). The
 * looser `[a-z0-9]{5}-[a-z0-9]{5}` pattern false-positives on ordinary UI text
 * such as the "Runner-up" column header, so the assertion uses the full shape.
 */
const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

/* --- Fixtures ----------------------------------------------------------- */

/** A frozen status: the last competition ended, next comp in 2d 5h. */
const FROZEN_STATUS: CompStatus = {
  live: false,
  // 2026-10-18T00:00:00Z in nanoseconds.
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 2n * 86_400n + 5n * 3_600n,
};

/** A pool of 1,450.50 ICP with a first prize of 725.25 ICP. */
const POOL: PrizePool = {
  poolE8s: 145_050_000_000n,
  firstPrizeE8s: 72_525_000_000n,
};

/** The next upcoming Sunday (UTC) the admin dropdown offers. */
const NEXT_SUNDAY = 1_792_886_400_000_000_000n; // 2026-10-25T00:00:00Z

/** One upcoming Sunday, unallocated. */
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
  pool?: PrizePool;
  pastWinners?: PastWinnerRow[];
  firstPrize?: bigint | null;
  claimStatus?: ClaimStatus | null;
  upcomingStatuses?: SundayAllocationStatus[];
}

/** Build a typed actor fake with the leaderboard and prize methods. */
function makeActor(overrides: ActorOverrides = {}) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi.fn().mockResolvedValue([]),
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
      .mockResolvedValue(overrides.upcomingStatuses ?? UPCOMING_STATUSES),
    getAdminPrizeClaims: vi.fn().mockResolvedValue({ rows: [] }),
    getAdminAllocatedCompetitionDates: vi.fn().mockResolvedValue([]),
    getAdminCompetitionDetail: vi.fn().mockResolvedValue(null),
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

/* --- Admin panel content (adjacent to the new manual finalize control) -- */

describe("Admin panel content survives the manual-finalize addition", () => {
  it("still renders the current pool, first prize and claim state for the admin", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pool: POOL,
      firstPrize: 72_525_000_000n,
      claimStatus: ClaimStatusEnum.claimable,
    });
    const { container } = renderWindow();

    await openSundayView();

    const panel = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.admin.panel"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    // The existing admin content is still present: the pool, the first prize
    // and the claim state. The manual finalize control is an addition.
    expect(within(panel).getByText("1,450.5 ICP")).toBeInTheDocument();
    expect(within(panel).getByText("725.25 ICP")).toBeInTheDocument();
    expect(within(panel).getByText("Claimable")).toBeInTheDocument();
  });

  it("still renders the allocation controls and the prize-claims section", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pool: POOL,
      firstPrize: 72_525_000_000n,
      claimStatus: ClaimStatusEnum.claimable,
    });
    renderWindow();

    await openSundayView();

    // The upcoming-Sunday dropdown and the amount field are the existing
    // allocation controls; the prize-claims section is the existing admin
    // claims overview. Both must survive the manual-finalize addition.
    const select = await screen.findByRole("combobox");
    expect(select).toBeInTheDocument();

    // The amount field appears once a Sunday is selected.
    await userEvent.setup().selectOptions(select, NEXT_SUNDAY.toString());
    expect(screen.getByLabelText("Total pool (ICP)")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm total prize" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear allocation" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        "No competitions with a confirmed prize pool yet",
      ),
    ).toBeInTheDocument();
  });

  it("still hides the admin panel for a non-admin signed-in player", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    await openSundayView();

    // The Sunday view renders (its header is present) but the admin panel is
    // absent for a non-admin caller.
    await screen.findByText("NEXT COMPETITION, Thursday 22 Oct");
    expect(
      container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
    ).toBeNull();
  });
});

/* --- Past winners table (backfill changes data, not structure) ---------- */

describe("Past winners table structure survives the backfill", () => {
  it("still renders the Date / Winner / Runner-up columns with win counts, newest first", async () => {
    seedOpen();
    // Two archived competitions; the backend returns newest first. The newest
    // carries a winner and runner-up (as a backfilled row would); the older has
    // no winner (the dash fallback).
    const newest = 1_792_281_600_000_000_000n; // Sunday 18 Oct 2026
    const older = newest - 604_800_000_000_000n; // the previous Sunday
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [
        pastWinner(newest, "Ohmyohmy", 4, "Bob", 2),
        pastWinner(older, undefined, undefined, undefined, undefined),
      ],
    });
    renderWindow();

    await openSundayView();

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

    // Newest first: the first data row is the most recent Sunday, with the
    // winner and runner-up and their win counts.
    const firstData = rows[1]!;
    expect(within(firstData).getByText("Sunday 18 Oct")).toBeInTheDocument();
    expect(within(firstData).getByText("Ohmyohmy")).toBeInTheDocument();
    expect(within(firstData).getByText("4 wins")).toBeInTheDocument();
    expect(within(firstData).getByText("Bob")).toBeInTheDocument();
    expect(within(firstData).getByText("2 wins")).toBeInTheDocument();

    // The older competition has no winner: the row still renders with its dash
    // fallback, so the backfill is a data change, not a structural one.
    const secondData = rows[2]!;
    expect(within(secondData).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("still renders no principal in the Past winners table", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [
        pastWinner(1_792_281_600_000_000_000n, "Ohmyohmy", 4, "Bob", 2),
      ],
    });
    const { container } = renderWindow();

    await openSundayView();

    const table = await screen.findByRole("table");
    expect(table.textContent).not.toMatch(PRINCIPAL_PATTERN);
    expect(container.textContent).not.toMatch(PRINCIPAL_PATTERN);
  });
});
