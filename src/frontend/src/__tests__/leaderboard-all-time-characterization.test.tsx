import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the EXISTING "All time" leaderboard, taken BEFORE the
 * Sunday comp view and its All time / Sunday comp toggle are added.
 *
 * The request intentionally adds a second view inside the same Leaderboard
 * window, switched by a toggle, and states that the existing board becomes the
 * "All time" view and its rendering is otherwise unchanged. This file pins the
 * adjacent, working behavior the change must NOT disturb:
 *
 *   - the window still renders the existing ranked board (rank, username, win
 *     count) from `getWinnerRanking(50n)`, ordered most-wins-first;
 *   - the signed-in player's own row is still highlighted with the "You" badge;
 *   - the public list still carries no principal;
 *   - the empty / loading / error+retry states still render;
 *   - the collapse contract (aria-expanded, body unmounted while collapsed,
 *     JSON-boolean localStorage persistence) is unchanged.
 *
 * It deliberately does NOT assert the absence of a toggle or a Sunday view:
 * those are the intentional additions. It asserts only that the pre-existing
 * All time board keeps working.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real `getWinnerRanking` behavior is
 * asserted in the PocketIC backend lane.
 */

// The hook module imports useActorState from lib/backend-actor, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the actor seam directly, exactly as the existing leaderboard cover
// does.
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
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { LEADERBOARD_LIMIT } from "@/hooks/use-leaderboard";

function row(
  rank: number,
  displayName: string,
  wins: number,
  isMe = false,
): WinnerRankingRow {
  return { rank: BigInt(rank), displayName, wins: BigInt(wins), isMe };
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
  actorState.actor = null;
  actorState.isLoading = false;
  actorState.error = null;
  vi.clearAllMocks();
});

describe("All time leaderboard is unchanged by the Sunday comp addition", () => {
  it("renders the existing ranked board from getWinnerRanking(50n) in server order", async () => {
    seedOpen();
    const getWinnerRanking = vi
      .fn()
      .mockResolvedValue([row(1, "Ada", 5), row(2, "Bob", 3), row(3, "Cy", 1)]);
    actorState.actor = { getWinnerRanking };
    renderWindow();

    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);

    // Each row keeps its rank, username and win count, in the server's
    // most-wins-first order.
    expect(within(items[0]!).getByText("1")).toBeInTheDocument();
    expect(within(items[0]!).getByText("Ada")).toBeInTheDocument();
    expect(within(items[0]!).getByText("5")).toBeInTheDocument();
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Ada"),
      expect.stringContaining("Bob"),
      expect.stringContaining("Cy"),
    ]);

    // The existing board still requests the top 50 from the same query.
    expect(getWinnerRanking).toHaveBeenCalledWith(LEADERBOARD_LIMIT);
    expect(LEADERBOARD_LIMIT).toBe(50n);
  });

  it("still highlights the signed-in player's own row with the You badge", async () => {
    seedOpen();
    actorState.actor = {
      getWinnerRanking: vi
        .fn()
        .mockResolvedValue([row(1, "Ada", 5, true), row(2, "Bob", 3)]),
    };
    renderWindow();

    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");

    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(within(items[0]!).getByText("You")).toBeInTheDocument();
    expect(items[1]).not.toHaveAttribute("aria-current");
    expect(within(items[1]!).queryByText("You")).not.toBeInTheDocument();
  });

  it("still renders no principal in the public list", async () => {
    seedOpen();
    actorState.actor = {
      getWinnerRanking: vi.fn().mockResolvedValue([row(1, "Ada", 5)]),
    };
    const { container } = renderWindow();

    await screen.findByText("Ada");
    const list = container.querySelector('[data-ocid="leaderboard.list"]');
    expect(list).not.toBeNull();
    expect(list?.textContent).toContain("Ada");
    // A principal-shaped token must never leak into the rendered list.
    expect(list?.textContent).not.toMatch(/[a-z0-9]{5}-[a-z0-9]{5}/i);
  });

  it("still shows the existing empty state when there are no ranked wins", async () => {
    seedOpen();
    actorState.actor = { getWinnerRanking: vi.fn().mockResolvedValue([]) };
    renderWindow();

    expect(await screen.findByText("No ranked wins yet")).toBeInTheDocument();
  });

  it("still shows the existing loading state while the ranking is fetched", () => {
    seedOpen();
    actorState.actor = {
      getWinnerRanking: vi.fn(() => new Promise<never>(() => {})),
    };
    renderWindow();

    expect(
      document.querySelector('[data-ocid="leaderboard.loading_state"]'),
    ).not.toBeNull();
  });

  it("still shows the existing error state with a working retry", async () => {
    seedOpen();
    const getWinnerRanking = vi
      .fn()
      .mockRejectedValueOnce(new Error("backend down"))
      .mockResolvedValueOnce([row(1, "Ada", 3)]);
    actorState.actor = { getWinnerRanking };
    renderWindow();

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(
      document.querySelector('[data-ocid="leaderboard.error_state"]'),
    ).not.toBeNull();

    await userEvent.setup().click(retry);
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(getWinnerRanking).toHaveBeenCalledTimes(2);
  });

  it("keeps the collapse contract: collapsed by default, body unmounted, JSON-boolean persistence", async () => {
    const user = userEvent.setup();
    actorState.actor = { getWinnerRanking: vi.fn().mockResolvedValue([]) };
    const first = renderWindow();

    const header = screen.getByRole("button", { name: /Leaderboard/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      document.querySelector('[data-ocid="leaderboard.empty_state"]'),
    ).toBeNull();

    // Opening mounts the body and writes the JSON boolean true.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("No ranked wins yet")).toBeInTheDocument();
    expect(window.localStorage.getItem("tco-leaderboard-open")).toBe("true");

    // Remount restores the expanded state from localStorage.
    first.unmount();
    renderWindow();
    expect(screen.getByRole("button", { name: /Leaderboard/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
