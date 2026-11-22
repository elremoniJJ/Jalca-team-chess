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
 * Characterization of the Comp-tab behavior ADJACENT to the accepted change,
 * taken BEFORE the archive/claims rework lands.
 *
 * The request intentionally changes:
 *   - which competitions are archived (only those with a confirmed prize pool);
 *   - which dates appear in the archives, allocations and claims (nothing
 *     before Sunday 1 Nov 2026);
 *   - the Past winners table (only competitions with a confirmed prize pool);
 *   - the admin prize-claims area (a date dropdown with a per-date detail,
 *     replacing the long always-open list).
 *
 * This file deliberately does NOT assert any of those intentional changes. It
 * protects the behavior that must SURVIVE them:
 *
 *   - the Past winners table still renders a winner and runner-up with their
 *     win counts, and still shows the "No runner-up" / "No wins recorded"
 *     fallbacks and the empty state;
 *   - the admin panel is still gated on the hardcoded admin principal: a
 *     non-admin caller never sees it, and an admin caller does;
 *   - the Comp view still renders its existing sections (This competition,
 *     Past winners) for a signed-in caller.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real archive reads and the real
 * admin gate are asserted in the PocketIC backend lane, not here.
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
  CompStatus,
  PastWinnerRow,
  SundayAllocationStatus,
} from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { ADMIN_PRINCIPAL } from "@/lib/prize-admin";

/* --- Fixtures ----------------------------------------------------------- */

/** A frozen status: the last competition ended, next comp in 2d 5h. */
const FROZEN_STATUS: CompStatus = {
  live: false,
  // 2026-10-18T00:00:00Z in nanoseconds.
  sunday: 1_792_281_600_000_000_000n,
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
    getMyPrize: vi.fn().mockResolvedValue(null),
    getClaimStatus: vi.fn().mockResolvedValue(null),
    getFirstPrizeForSunday: vi
      .fn()
      .mockResolvedValue(
        overrides.firstPrize === undefined ? null : overrides.firstPrize,
      ),
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

/* --- Past winners table rendering survives the filtering change --------- */

describe("Past winners table rendering", () => {
  it("renders a winner and runner-up with their win counts", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [pastWinner(1_792_281_600_000_000_000n, "Ada", 4, "Bob", 2)],
    });
    renderWindow();

    await openSundayView();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    const dataRow = rows[1]!;

    expect(within(dataRow).getByText("Ada")).toBeInTheDocument();
    expect(within(dataRow).getByText("4 wins")).toBeInTheDocument();
    expect(within(dataRow).getByText("Bob")).toBeInTheDocument();
    expect(within(dataRow).getByText("2 wins")).toBeInTheDocument();
  });

  it("keeps the 'No runner-up' fallback for a winner without a runner-up", async () => {
    seedOpen();
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [
        pastWinner(1_792_281_600_000_000_000n, "Ada", 4, undefined, undefined),
      ],
    });
    renderWindow();

    await openSundayView();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    const dataRow = rows[1]!;

    expect(within(dataRow).getByText("Ada")).toBeInTheDocument();
    expect(within(dataRow).getByText("No runner-up")).toBeInTheDocument();
  });

  it("keeps the 'No wins recorded' fallback and the empty state", async () => {
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
    renderWindow();

    await openSundayView();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]!).getByText("No wins recorded")).toBeInTheDocument();
  });

  it("shows the empty state when no competition is archived", async () => {
    seedOpen();
    actorState.actor = makeActor({ status: FROZEN_STATUS, pastWinners: [] });
    renderWindow();

    await openSundayView();

    expect(
      await screen.findByText("No competitions archived yet"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

/* --- Admin gating survives the claims-area rework ----------------------- */

describe("admin panel gating", () => {
  it("does not render the admin panel for a non-admin caller", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor({ status: FROZEN_STATUS });
    const { container } = renderWindow();

    await openSundayView();

    // The Comp view renders, but the admin-only panel is absent.
    expect(await screen.findByText("This competition")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
    ).toBeNull();
  });

  it("renders the admin panel for the hardcoded admin principal", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      firstPrize: 72_525_000_000n,
    });
    const { container } = renderWindow();

    await openSundayView();

    await waitFor(() => {
      expect(
        container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
      ).not.toBeNull();
    });
  });
});
