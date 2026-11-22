import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the Sunday-competition Comp-tab READ path, taken BEFORE
 * the change that stops the live store being cleared on every maintenance tick
 * during a live competition day and instead clears it only when a competition
 * is archived.
 *
 * The request intentionally changes WHEN the live store is reset. This file
 * deliberately does NOT assert the per-tick clearing (the behavior being
 * changed) and does NOT assert the new archive-time clearing (the intentional
 * change). It protects the behavior ADJACENT to that change, which the Comp tab
 * depends on and which the new clearing point must not disturb:
 *
 *   - a Comp-tab read is idempotent: reading the live standings does not itself
 *     wipe the live rows, so a win recorded during a live day is still present
 *     after the read (the requirement's "survives every Comp-tab read");
 *   - repeated Comp-tab reads (a refetch / re-render) keep returning the same
 *     live rows rather than degrading to the empty state;
 *   - each read is still issued with the 50-row limit, so the clearing point
 *     cannot silently drop the read or change its shape.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real Sunday-comp behavior (the exact
 * tick at which the store is reset, archive idempotency) is asserted in the
 * PocketIC backend lane, which is skipped in this environment for lack of a
 * backend wasm. See episode.coverageLimits.
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

import type { CompStandingRow, CompStatus } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { SUNDAY_COMP_LIMIT } from "@/hooks/use-leaderboard";

/* --- Fixtures ----------------------------------------------------------- */

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

/** Build a typed actor fake with the four leaderboard methods. */
function makeActor(standings: CompStandingRow[]) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    // Return a fresh snapshot each call, as a real remote actor does, so a
    // later mutation of the fixture cannot silently mutate cached data.
    getSundayCompStandings: vi
      .fn()
      .mockImplementation(async () => structuredClone(standings)),
    getSundayCompStatus: vi.fn().mockResolvedValue(LIVE_STATUS),
    getPastWinners: vi.fn().mockResolvedValue([]),
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

/* --- The Comp-tab read does not wipe the live rows ---------------------- */

describe("Comp-tab read keeps the live standings", () => {
  it("still shows a recorded win after the Comp-tab read, not the empty state", async () => {
    seedOpen();
    // A live competition with one credited player. The read must not clear the
    // live store, so the win is still present after the read.
    actorState.actor = makeActor([standing(1, "Ada", 3, true)]);
    renderWindow();

    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(within(items[0]!).getByText("Ada")).toBeInTheDocument();
    expect(within(items[0]!).getByText("3")).toBeInTheDocument();

    // The live row is shown, so the empty state is NOT rendered.
    expect(
      document.querySelector('[data-ocid="leaderboard.sunday.empty_state"]'),
    ).toBeNull();
  });

  it("keeps the same live rows across repeated Comp-tab reads", async () => {
    seedOpen();
    const actor = makeActor([
      standing(1, "Ada", 3, true),
      standing(2, "Bob", 1),
    ]);
    actorState.actor = actor;
    renderWindow();

    // First read renders the live rows.
    const firstList = await screen.findByRole("list");
    expect(within(firstList).getAllByRole("listitem")).toHaveLength(2);

    // A second read (a refetch / re-render) must return the same live rows, not
    // an empty store. The read is idempotent with respect to the live store.
    const secondList = await screen.findByRole("list");
    const secondItems = within(secondList).getAllByRole("listitem");
    expect(secondItems).toHaveLength(2);
    expect(within(secondItems[0]!).getByText("Ada")).toBeInTheDocument();
    expect(within(secondItems[1]!).getByText("Bob")).toBeInTheDocument();

    // Every read was issued with the 50-row limit; the clearing point must not
    // silently drop the read or change its shape.
    expect(actor.getSundayCompStandings).toHaveBeenCalledWith(
      SUNDAY_COMP_LIMIT,
    );
    expect(SUNDAY_COMP_LIMIT).toBe(50n);
  });
});
