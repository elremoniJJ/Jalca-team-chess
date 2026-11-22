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

// The window carries deterministic `data-ocid` markers rather than roles or
// labels for its result/error states, so map getByTestId onto that attribute.
configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted change that adds an admin-only manual finalize action
 * to the Leaderboard window's admin panel.
 *
 * The request adds a "Force finalize" control that calls the backend's
 * `adminFinalizeCompetitions` and reports which competitions were archived (or
 * a clear "nothing to finalize" message). The control lives inside the admin
 * panel, which is itself gated on the hardcoded admin principal; the backend
 * traps for any other caller, so no non-admin ever reaches the action.
 *
 * This file asserts the observable frontend behavior of that control:
 *   - the admin sees the control and clicking it calls the backend once;
 *   - a non-empty report lists the archived competitions by their UTC date;
 *   - an empty report shows the "nothing to finalize" message;
 *   - a failed call surfaces the error state;
 *   - a non-admin signed-in player never sees the control.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real admin gate (anonymous and
 * non-admin callers rejected) and the timer-driven finalize are asserted in the
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
    adminFinalizeCompetitions: () => Promise<unknown>;
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

import type { CompStatus, FinalizeReport, PrizePool } from "@/backend";
import { ClaimStatus as ClaimStatusEnum } from "@/backend";
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

/** A pool of 1,450.50 ICP with a first prize of 725.25 ICP. */
const POOL: PrizePool = {
  poolE8s: 145_050_000_000n,
  firstPrizeE8s: 72_525_000_000n,
};

/** Sunday 18 Oct 2026 00:00:00 UTC, in nanoseconds. */
const SUNDAY_18_OCT = 1_792_281_600_000_000_000n;

interface ActorOverrides {
  status?: CompStatus;
  pool?: PrizePool;
  finalize?: () => Promise<FinalizeReport>;
}

/** Build a typed actor fake with the leaderboard, prize and finalize methods. */
function makeActor(overrides: ActorOverrides = {}) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi.fn().mockResolvedValue([]),
    getSundayCompStatus: vi
      .fn()
      .mockResolvedValue(overrides.status ?? FROZEN_STATUS),
    getPastWinners: vi.fn().mockResolvedValue([]),
    getCurrentPrizePool: vi.fn().mockResolvedValue(overrides.pool ?? POOL),
    getMyPrize: vi.fn().mockResolvedValue(null),
    getClaimStatus: vi.fn().mockResolvedValue(ClaimStatusEnum.claimable),
    getFirstPrizeForSunday: vi.fn().mockResolvedValue(null),
    getUpcomingAllocationStatuses: vi.fn().mockResolvedValue([]),
    getAdminPrizeClaims: vi.fn().mockResolvedValue({ rows: [] }),
    adminFinalizeCompetitions: vi.fn(
      overrides.finalize ??
        (() =>
          Promise.resolve({
            archived: [],
            lastFinalizedSunday: 0n,
          } satisfies FinalizeReport)),
    ),
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

/* --- Admin manual finalize control -------------------------------------- */

describe("Admin manual finalize control", () => {
  it("calls the backend once and lists the archived competitions for the admin", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    const actor = makeActor({
      finalize: () =>
        Promise.resolve({
          archived: [SUNDAY_18_OCT],
          lastFinalizedSunday: SUNDAY_18_OCT,
        }),
    });
    actorState.actor = actor;
    renderWindow();

    await openSundayView();

    const button = await screen.findByRole("button", {
      name: "Force finalize",
    });
    await userEvent.setup().click(button);

    // The backend action is called exactly once.
    await waitFor(() =>
      expect(actor.adminFinalizeCompetitions).toHaveBeenCalledTimes(1),
    );

    // The report lists the archived competition by its UTC date.
    const result = await screen.findByTestId(
      "leaderboard.admin.finalize.result",
    );
    expect(
      within(result).getByText("Archived 1 competition"),
    ).toBeInTheDocument();
    expect(within(result).getByText("Sunday 18 Oct")).toBeInTheDocument();
  });

  it("shows the nothing-to-finalize message when the report is empty", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      finalize: () =>
        Promise.resolve({ archived: [], lastFinalizedSunday: 0n }),
    });
    renderWindow();

    await openSundayView();

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Force finalize" }));

    expect(
      await screen.findByText(
        "Nothing to finalize — the archive is up to date.",
      ),
    ).toBeInTheDocument();
  });

  it("surfaces an error state when the finalize call fails", async () => {
    seedOpen();
    actorState.principal = ADMIN_PRINCIPAL;
    actorState.actor = makeActor({
      finalize: () => Promise.reject(new Error("not the admin")),
    });
    renderWindow();

    await openSundayView();

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Force finalize" }));

    expect(
      await screen.findByTestId("leaderboard.admin.finalize.error_state"),
    ).toBeInTheDocument();
  });

  it("never shows the finalize control to a non-admin signed-in player", async () => {
    seedOpen();
    actorState.principal = "player-1";
    actorState.actor = makeActor();
    renderWindow();

    await openSundayView();

    // The Sunday view renders, but the admin panel (and its finalize control)
    // is absent for a non-admin caller.
    await screen.findByText("NEXT COMPETITION, Thursday 22 Oct");
    expect(
      screen.queryByRole("button", { name: "Force finalize" }),
    ).not.toBeInTheDocument();
  });
});
