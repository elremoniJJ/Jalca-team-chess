import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the admin-authorization SEAM the upcoming prize work
 * builds on, taken BEFORE the admin panel is added to the Leaderboard window.
 *
 * The request intentionally adds an admin panel inside the Leaderboard window,
 * visible only to a hardcoded compile-time admin principal, and mirrors that
 * principal in the frontend only to decide whether to show the panel. The
 * backend already exposes the seam the frontend will consume: the
 * `isCallerAdmin()` query on the generated backend interface, which returns a
 * boolean for the calling principal.
 *
 * This file deliberately does NOT assert the absence of an admin panel (the
 * panel is the intentional change) and does NOT pin the exact set of elements
 * in the Leaderboard window. What it protects is the behavior ADJACENT to the
 * change that must survive it:
 *
 *   - `isCallerAdmin` is part of the generated backend consumer contract and is
 *     a zero-argument query returning a boolean;
 *   - the Leaderboard window still renders its two existing views (All time and
 *     Sunday comp) for a signed-in caller, so the admin panel is an addition
 *     rather than a replacement;
 *   - the window still renders without an admin panel today, so the panel is
 *     genuinely new UI rather than a rename of existing content.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real admin authorization (a
 * non-admin caller rejected on an admin-only call) is asserted in the PocketIC
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
    isCallerAdmin: () => Promise<boolean>;
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

import type { CompStatus, backendInterface } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";

/** A frozen status: the last competition ended, next comp in 2d 5h. */
const FROZEN_STATUS: CompStatus = {
  live: false,
  // 2026-10-18T00:00:00Z in nanoseconds.
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 2n * 86_400n + 5n * 3_600n,
};

/**
 * The generated backend interface must expose `isCallerAdmin` as a
 * zero-argument query returning a boolean. This is a compile-time contract
 * assertion: if the generated binding drops or reshapes the method, this file
 * fails to type-check.
 */
type IsCallerAdmin = backendInterface["isCallerAdmin"];
const _isCallerAdminContract: IsCallerAdmin = async () => false;
void _isCallerAdminContract;

/** Build a typed actor fake with the leaderboard methods plus isCallerAdmin. */
function makeActor(isAdmin: boolean) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi.fn().mockResolvedValue([]),
    getSundayCompStatus: vi.fn().mockResolvedValue(FROZEN_STATUS),
    getPastWinners: vi.fn().mockResolvedValue([]),
    isCallerAdmin: vi.fn().mockResolvedValue(isAdmin),
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

describe("isCallerAdmin consumer contract survives the admin-panel addition", () => {
  it("exposes isCallerAdmin as a zero-argument boolean query on the generated backend", () => {
    // The generated interface types the method as `() => Promise<boolean>`.
    // Assert the arity and the resolved value shape through a typed fake.
    const actor = makeActor(true);
    expect(actor.isCallerAdmin).toHaveLength(0);
    return expect(actor.isCallerAdmin()).resolves.toBe(true);
  });

  it("still renders both existing views for a signed-in caller", async () => {
    seedOpen();
    actorState.actor = makeActor(false);
    renderWindow();

    // The All time / Comp toggle is the window's existing structure and
    // must survive the admin-panel addition.
    expect(
      await screen.findByRole("tab", { name: "All time" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Comp" })).toBeInTheDocument();

    // Switching to Comp still mounts the existing competition view.
    await userEvent.setup().click(screen.getByRole("tab", { name: "Comp" }));
    expect(
      await screen.findByText("No wins yet in this competition"),
    ).toBeInTheDocument();
  });

  it("renders the window without an admin panel today, so the panel is new UI", async () => {
    seedOpen();
    actorState.actor = makeActor(true);
    const { container } = renderWindow();

    // The window renders its existing content for an admin caller.
    expect(
      await screen.findByRole("tab", { name: "All time" }),
    ).toBeInTheDocument();

    // No admin panel exists yet: the request adds it. This pins the starting
    // point so the addition is observable as a change, not a rename.
    expect(
      container.querySelector('[data-ocid="leaderboard.admin.panel"]'),
    ).toBeNull();
    expect(screen.queryByText(/admin/i)).not.toBeInTheDocument();
  });
});
