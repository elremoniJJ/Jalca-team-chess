import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the EXISTING "All time" leaderboard data seam, taken
 * BEFORE the Sunday comp view and its All time / Sunday comp toggle are added.
 *
 * The request adds a second view inside the same Leaderboard window and states
 * that the existing board becomes the "All time" view and its rendering is
 * otherwise unchanged. The sibling
 * leaderboard-all-time-characterization.test.tsx already pins the rendered
 * board, its states and the collapse contract. This file protects the two
 * adjacent seams that the Sunday addition is most likely to disturb and that
 * the rendered-board file does not assert:
 *
 *   1. the `useLeaderboard` hook's public contract — the query key
 *      `["winnerRanking"]`, the `getWinnerRanking(50n)` call, and the
 *      `enabled` gate that keeps the ranking out of the game poll while the
 *      panel is collapsed. A Sunday view that reuses or renames this key, or
 *      that drops the enabled gate, would silently change All time behavior;
 *   2. the game route's post-game refresh — the transition into
 *      Celebration/Draw invalidates exactly the leaderboard query key, which is
 *      what refetches an open All time panel after a win without a reload.
 *
 * It deliberately does NOT assert the absence of a toggle or a Sunday view:
 * those are the intentional additions. It asserts only that the pre-existing
 * All time data seam keeps working.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real `getWinnerRanking` behavior is
 * asserted in the PocketIC backend lane.
 */

// The hook module imports useActorState from lib/backend-actor, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the actor seam directly, exactly as the existing leaderboard tests do.
const actorState = vi.hoisted(() => ({
  actor: null as {
    getWinnerRanking: (limit: bigint) => Promise<unknown>;
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

import type { WinnerRankingRow } from "@/backend";
import {
  LEADERBOARD_LIMIT,
  LEADERBOARD_QUERY_KEY,
  useLeaderboard,
} from "@/hooks/use-leaderboard";

function row(
  rank: number,
  displayName: string,
  wins: number,
  isMe = false,
): WinnerRankingRow {
  return { rank: BigInt(rank), displayName, wins: BigInt(wins), isMe };
}

/** A tiny probe that renders the hook's observable output. */
function HookProbe({ enabled }: { enabled: boolean }) {
  const { rows, isLoading, error } = useLeaderboard(enabled);
  return (
    <div>
      <span data-ocid="probe.loading">{isLoading ? "loading" : "idle"}</span>
      <span data-ocid="probe.error">{error ? "error" : "ok"}</span>
      <ul data-ocid="probe.rows">
        {rows.map((r) => (
          <li key={`${r.rank.toString()}-${r.displayName}`}>
            {r.displayName}:{r.wins.toString()}
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderProbe(enabled: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <HookProbe enabled={enabled} />
      </QueryClientProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  actorState.actor = null;
  actorState.isLoading = false;
  actorState.error = null;
  vi.clearAllMocks();
});

describe("useLeaderboard keeps the All time data contract", () => {
  it("exposes the stable winnerRanking query key and the 50-row limit", () => {
    // The route invalidates this exact key after a game concludes, and the
    // panel requests the server cap. Both are part of the All time contract.
    expect(LEADERBOARD_QUERY_KEY).toEqual(["winnerRanking"]);
    expect(LEADERBOARD_LIMIT).toBe(50n);
  });

  it("fetches getWinnerRanking(50n) and returns the rows when enabled", async () => {
    const getWinnerRanking = vi
      .fn()
      .mockResolvedValue([row(1, "Ada", 5), row(2, "Bob", 3)]);
    actorState.actor = { getWinnerRanking };
    renderProbe(true);

    await waitFor(() => {
      expect(getWinnerRanking).toHaveBeenCalledWith(LEADERBOARD_LIMIT);
    });
    const list = await screen.findByText("Ada:5");
    expect(list).toBeInTheDocument();
    expect(screen.getByText("Bob:3")).toBeInTheDocument();
  });

  it("does not fetch while disabled, so the ranking stays out of the game poll", async () => {
    const getWinnerRanking = vi.fn().mockResolvedValue([]);
    actorState.actor = { getWinnerRanking };
    renderProbe(false);

    // Give React Query a chance to run any query it would have started.
    await waitFor(() => {
      expect(document.querySelector('[data-ocid="probe.rows"]')).not.toBeNull();
    });
    expect(getWinnerRanking).not.toHaveBeenCalled();
  });

  it("surfaces the actor error through the hook's error field", async () => {
    actorState.actor = { getWinnerRanking: vi.fn().mockResolvedValue([]) };
    actorState.error = new Error("actor unavailable");
    renderProbe(true);

    expect(await screen.findByText("error")).toBeInTheDocument();
  });
});
