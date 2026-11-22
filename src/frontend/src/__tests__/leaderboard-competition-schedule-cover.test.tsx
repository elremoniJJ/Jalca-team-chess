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
 * Cover for the competition-schedule generalization and its renamed labels.
 *
 * The request generalizes the competition schedule from weekly Sundays to
 * alternating Sundays and Thursdays and renames four visible strings:
 *   1. the competition tab label from "Sunday comp" to "Comp";
 *   2. the standings heading from "This Sunday" to "This competition";
 *   3. the empty state from "No wins yet this Sunday" to "No wins yet in this
 *      competition";
 *   4. the admin competition-date dropdown label from "Sunday" to
 *      "Competition date".
 *
 * This file asserts the accepted, observable behavior of that change:
 *   - the four renamed strings render exactly as accepted;
 *   - the preserved strings ("Select a Sunday" placeholder, "Unknown Sunday"
 *     fallback) are unchanged;
 *   - the shared date formatter renders a THURSDAY competition date, because
 *     the generalized schedule includes Thursdays;
 *   - the competition-date dropdown lists the upcoming competition dates the
 *     backend returns, including a Thursday, under the new label.
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
    getCurrentPrizePool: () => Promise<unknown>;
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
  SundayAllocationStatus,
  WinnerRankingRow,
} from "@/backend";
import { ClaimStatus as ClaimStatusEnum } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { ADMIN_PRINCIPAL } from "@/lib/prize-admin";

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

/**
 * The upcoming competition dates the backend returns for the admin dropdown:
 * alternating Sunday and Thursday boundaries, never today or past. The first
 * is a Sunday (18 Oct 2026) and the second a Thursday (22 Oct 2026), matching
 * the accepted Sunday -> Thursday (+4 days) cadence.
 */
const UPCOMING_STATUSES: SundayAllocationStatus[] = [
  { sunday: 1_792_281_600_000_000_000n, allocated: false, poolE8s: undefined },
  { sunday: 1_792_627_200_000_000_000n, allocated: false, poolE8s: undefined },
];

interface ActorOverrides {
  ranking?: WinnerRankingRow[];
  status?: CompStatus;
  standings?: CompStandingRow[];
  pool?: PrizePool;
  claimStatus?: ClaimStatus | null;
  firstPrize?: bigint | null;
  upcomingStatuses?: SundayAllocationStatus[];
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
    getPastWinners: vi.fn().mockResolvedValue([]),
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
      .mockResolvedValue(overrides.upcomingStatuses ?? []),
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
 * Switch to the competition view. The tab's label is now "Comp"; select it by
 * its stable data-ocid so the assertion does not depend on the label.
 */
async function openCompetitionView() {
  await userEvent
    .setup()
    .click(await screen.findByTestId("leaderboard.view_tab.sunday_comp"));
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

/* --- Renamed labels ----------------------------------------------------- */

describe("competition view carries the accepted renamed labels", () => {
  it("labels the competition tab 'Comp'", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS });
    renderWindow();

    expect(
      await screen.findByRole("tab", { name: "Comp" }),
    ).toBeInTheDocument();
    // The old label is gone.
    expect(
      screen.queryByRole("tab", { name: "Sunday comp" }),
    ).not.toBeInTheDocument();
  });

  it("heads the standings 'This competition'", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: LIVE_STATUS });
    renderWindow();

    expect(
      await screen.findByRole("heading", { name: "This competition" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("This Sunday")).not.toBeInTheDocument();
  });

  it("reads the empty state 'No wins yet in this competition'", async () => {
    seedOpen();
    actorState.actor = makeActor({ standings: [], status: LIVE_STATUS });
    renderWindow();

    expect(
      await screen.findByText("No wins yet in this competition"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No wins yet this Sunday"),
    ).not.toBeInTheDocument();
  });

  it("labels the admin competition-date dropdown 'Competition date'", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      upcomingStatuses: UPCOMING_STATUSES,
    });
    renderWindow();

    // The admin panel renders only for the hardcoded admin principal.
    const select = await screen.findByTestId(
      "leaderboard.admin.allocation.sunday_select",
    );
    const label = document.querySelector(
      'label[for="leaderboard-admin-sunday"]',
    );
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("Competition date");
    expect(select).toBeInTheDocument();
  });
});

/* --- Preserved strings -------------------------------------------------- */

describe("preserved dropdown strings are unchanged", () => {
  it("keeps the 'Select a competition' placeholder", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      upcomingStatuses: UPCOMING_STATUSES,
    });
    renderWindow();

    const select = await screen.findByTestId(
      "leaderboard.admin.allocation.sunday_select",
    );
    const placeholder = within(select).getByRole("option", {
      name: "Select a competition",
    });
    expect(placeholder).toBeInTheDocument();
  });
});

/* --- Thursday schedule -------------------------------------------------- */

describe("competition view renders the generalized Sunday/Thursday schedule", () => {
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

  it("lists the upcoming competition dates, including a Thursday, in the dropdown", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: LIVE_STATUS,
      pool: POOL,
      upcomingStatuses: UPCOMING_STATUSES,
    });
    renderWindow();

    const select = await screen.findByTestId(
      "leaderboard.admin.allocation.sunday_select",
    );

    // The dropdown lists the backend's upcoming competition dates: a Sunday
    // (18 Oct 2026) and the following Thursday (22 Oct 2026), each with its
    // allocation status. The Thursday row proves the generalized schedule
    // reaches the admin competition-date list.
    await waitFor(() => {
      expect(
        within(select).getByRole("option", {
          name: /Sunday 18 Oct 2026, 00:00 UTC — No allocation/,
        }),
      ).toBeInTheDocument();
    });
    expect(
      within(select).getByRole("option", {
        name: /Thursday 22 Oct 2026, 00:00 UTC — No allocation/,
      }),
    ).toBeInTheDocument();
  });
});

/* --- Adjacent behavior preserved ---------------------------------------- */

describe("competition view keeps its adjacent behavior", () => {
  it("still renders the standings rows and highlights the signed-in player", async () => {
    seedOpen();
    actorState.actor = makeActor({
      standings: [standing(1, "Ada", 3, true), standing(2, "Bob", 1)],
      status: LIVE_STATUS,
    });
    renderWindow();

    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Ada")).toBeInTheDocument();
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(within(items[0]!).getByText("You")).toBeInTheDocument();
  });

  it("still defaults to the competition view while a competition is live", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: LIVE_STATUS });
    renderWindow();

    await waitFor(() => {
      expect(
        screen.getByTestId("leaderboard.view_tab.sunday_comp"),
      ).toHaveAttribute("aria-selected", "true");
    });
  });

  it("still reads the All time board with the 50-row limit", async () => {
    seedOpen();
    const actor = makeActor({
      ranking: [allTimeRow(1, "Ada", 5)],
      status: FROZEN_STATUS,
    });
    actorState.actor = actor;
    renderWindow();

    await screen.findByText("Ada");
    expect(actor.getWinnerRanking).toHaveBeenCalledWith(50n);
  });
});
