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
 * Characterization of the Leaderboard window's Comp tab, taken BEFORE the top
 * of the Comp tab is reworked.
 *
 * The request intentionally replaces three things at the top of the Comp tab:
 *   1. the header card (SundayCompHeader) becomes a live/next competition
 *      header carrying the pool and the first prize;
 *   2. the separate "First prize" card (PlayerFirstPrize) is folded into that
 *      header;
 *   3. the "Final results" card becomes a compact last-competition line;
 * and it adds competition-date labels plus a next-competition allocation line
 * to the admin cards.
 *
 * This file deliberately does NOT pin the exact structure of the header, the
 * first-prize card or the final-results card, and does NOT assert the admin
 * card labels — those are the intentional change. What it protects is the
 * behavior ADJACENT to the rework that must survive it:
 *
 *   - the Comp tab still renders and the All time / Comp toggle still switches
 *     between the two views;
 *   - the player view still never shows the admin pool amount or a "Pool" row;
 *   - the guest notice and the signed-in player's "My competition wins" block
 *     still render in the Comp view;
 *   - the admin panel still renders only for the hardcoded admin principal and
 *     still shows its current-pool and first-prize rows.
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
  PrizePool,
  WinnerRankingRow,
} from "@/backend";
import { ClaimStatus as ClaimStatusEnum } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { ADMIN_PRINCIPAL } from "@/lib/prize-admin";

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

interface ActorOverrides {
  status?: CompStatus;
  ranking?: WinnerRankingRow[];
  standings?: CompStandingRow[];
  pool?: PrizePool;
  firstPrize?: bigint | null;
  claimStatus?: ClaimStatus | null;
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
      .mockResolvedValue(overrides.status ?? LIVE_STATUS),
    getPastWinners: vi.fn().mockResolvedValue([]),
    getCurrentPrizePool: vi.fn().mockResolvedValue(overrides.pool ?? POOL),
    getArchivedPrizePool: vi.fn().mockResolvedValue(null),
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

/* --- The Comp tab still renders and the toggle still switches ----------- */

describe("The Comp tab still renders and the view toggle still switches", () => {
  it("renders the Comp view when the Comp tab is selected", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS });
    renderWindow();

    // Frozen default is All time; the Comp tab is present and selectable.
    const compTab = await screen.findByRole("tab", { name: "Comp" });
    expect(compTab).toHaveAttribute("aria-selected", "false");

    await userEvent.setup().click(compTab);
    expect(compTab).toHaveAttribute("aria-selected", "true");

    // The Comp view's own content renders: the "This competition" standings
    // block and the Past winners empty state (no competition archived yet).
    expect(await screen.findByText("This competition")).toBeInTheDocument();
    expect(
      await screen.findByText("No competitions archived yet"),
    ).toBeInTheDocument();
  });

  it("switches back to All time from the Comp view", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      ranking: [allTimeRow(1, "Ada", 5)],
    });
    renderWindow();

    await openCompView();
    expect(await screen.findByText("This competition")).toBeInTheDocument();

    await userEvent
      .setup()
      .click(screen.getByRole("tab", { name: "All time" }));

    // The All time board renders its ranked row and the Comp-only block is gone.
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("This competition")).not.toBeInTheDocument();
  });
});

/* --- The player view shows the derived pool ----------------------------- */

describe("The player view shows the derived pool", () => {
  it("renders the pool derived as the first prize times two for a signed-out player", async () => {
    seedOpen();
    // The player view derives its pool frontend-only as the first prize times
    // two; it never reads the admin-only getCurrentPrizePool value.
    actorState.principal = null;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    // The Comp view renders (its standings block is present).
    await screen.findByText("This competition");
    const panel = await waitFor(() => {
      const el = container.querySelector(
        '[data-ocid="leaderboard.prize.panel"]',
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // 72,525,000,000 e8s first prize -> 145,050,000,000 e8s pool = 1,450.5 ICP.
    expect(within(panel).getByText("Pool 1,450.5 ICP")).toBeInTheDocument();
    expect(
      within(panel).getByText("First prize 725.25 ICP"),
    ).toBeInTheDocument();
  });
});

/* --- Guest notice and My competition wins still render ------------------ */

describe("The Comp view's player blocks still render", () => {
  it("still shows the guest notice for a signed-out caller", async () => {
    seedOpen();
    actorState.principal = null;
    actorState.actor = makeActor({ status: LIVE_STATUS });
    renderWindow();

    expect(
      await screen.findByText(
        "Guests do not earn competition wins. Sign in and join as ranked to compete.",
      ),
    ).toBeInTheDocument();
  });

  it("still shows the signed-in player's My competition wins block", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      standings: [standing(1, "Ada", 3, true)],
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
  });
});

/* --- Admin panel gate and its pool / first-prize rows ------------------- */

describe("The admin panel gate and its figures still work", () => {
  it("renders the admin panel for the hardcoded admin principal with its pool and first prize", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
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

    // The admin panel's current-pool and first-prize rows are unchanged. The
    // claim-state label and the new competition-date labels are intentionally
    // NOT asserted here: the request changes those.
    expect(within(panel).getByText("1,450.5 ICP")).toBeInTheDocument();
    expect(within(panel).getByText("725.25 ICP")).toBeInTheDocument();
  });

  it("hides the admin panel for a non-admin signed-in player", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    await screen.findByText("This competition");
    expect(
      container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
    ).toBeNull();
  });
});
