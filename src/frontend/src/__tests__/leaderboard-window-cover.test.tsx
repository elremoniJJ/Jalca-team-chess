import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the new "Leaderboard" collapsible window on the game page.
 *
 * The request adds one more collapsible window below the Story window that
 * reuses the shared collapsible-window contract (chevron header, aria-expanded,
 * JSON-boolean localStorage persistence, body unmounted while collapsed) and
 * shows the ranked leaderboard: rank, username and win count ordered by most
 * wins first, at most the top 50, with a friendly empty state, loading and
 * error states (with retry), and the signed-in player's own row highlighted.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real `getWinnerRanking` behavior is
 * asserted in the PocketIC backend lane.
 */

// The component imports WinnerRankingRow as a type only, but the hook module
// imports useActorState from lib/backend-actor, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test environment
// (a pre-existing dependency issue), so mock the actor seam directly.
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

/* --- Collapse / persistence contract ------------------------------------ */

describe("LeaderboardWindow collapsible behavior", () => {
  it("is collapsed by default and expands its body when the header is toggled", async () => {
    const user = userEvent.setup();
    actorState.actor = { getWinnerRanking: vi.fn().mockResolvedValue([]) };
    renderWindow();

    const header = screen.getByRole("button", { name: /Leaderboard/ });
    // Collapsed by default: aria-expanded false and the body absent.
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      document.querySelector('[data-ocid="leaderboard.empty_state"]'),
    ).toBeNull();

    // Expanding mounts the body (the empty state appears).
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("No ranked wins yet")).toBeInTheDocument();

    // Collapsing unmounts the body again.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      document.querySelector('[data-ocid="leaderboard.empty_state"]'),
    ).toBeNull();
  });

  it("persists the toggled state to localStorage as a JSON boolean and restores it on remount", async () => {
    const user = userEvent.setup();
    actorState.actor = { getWinnerRanking: vi.fn().mockResolvedValue([]) };
    const first = renderWindow();

    // Starts collapsed; opening writes the JSON boolean true.
    await user.click(screen.getByRole("button", { name: /Leaderboard/ }));
    expect(window.localStorage.getItem("tco-leaderboard-open")).toBe("true");

    // Remount: the expanded state is restored from localStorage.
    first.unmount();
    renderWindow();
    expect(screen.getByRole("button", { name: /Leaderboard/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("restores a collapsed state written by a previous session", () => {
    window.localStorage.setItem("tco-leaderboard-open", "false");
    actorState.actor = { getWinnerRanking: vi.fn().mockResolvedValue([]) };
    renderWindow();

    expect(screen.getByRole("button", { name: /Leaderboard/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      document.querySelector('[data-ocid="leaderboard.empty_state"]'),
    ).toBeNull();
  });

  it("renders the per-window theme dots in the Leaderboard header", () => {
    actorState.actor = { getWinnerRanking: vi.fn().mockResolvedValue([]) };
    renderWindow();

    const dots = document.querySelector(
      '[data-ocid="leaderboard_window.theme_dots"]',
    );
    expect(dots).not.toBeNull();
    expect(
      within(dots as HTMLElement).getAllByRole("button").length,
    ).toBeGreaterThan(0);
  });
});

/* --- Data loading: list, empty, loading, error/retry -------------------- */

describe("LeaderboardWindow data states", () => {
  it("shows the empty state when there are no ranked wins", async () => {
    seedOpen();
    actorState.actor = { getWinnerRanking: vi.fn().mockResolvedValue([]) };
    renderWindow();

    expect(await screen.findByText("No ranked wins yet")).toBeInTheDocument();
  });

  it("shows a loading state while the ranking is being fetched", () => {
    seedOpen();
    // A never-resolving fetch keeps the query in its loading state.
    actorState.actor = {
      getWinnerRanking: vi.fn(() => new Promise<never>(() => {})),
    };
    renderWindow();

    expect(
      document.querySelector('[data-ocid="leaderboard.loading_state"]'),
    ).not.toBeNull();
  });

  it("shows an error state with a retry control when the fetch fails", async () => {
    seedOpen();
    const getWinnerRanking = vi
      .fn()
      .mockRejectedValueOnce(new Error("backend down"))
      .mockResolvedValueOnce([row(1, "Ada", 3)]);
    actorState.actor = { getWinnerRanking };
    renderWindow();

    // Error state with the retry affordance.
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(
      document.querySelector('[data-ocid="leaderboard.error_state"]'),
    ).not.toBeNull();

    // Retrying refetches and renders the recovered list.
    await userEvent.setup().click(retry);
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(getWinnerRanking).toHaveBeenCalledTimes(2);
  });

  it("renders rank, username and win count ordered by most wins first", async () => {
    seedOpen();
    actorState.actor = {
      getWinnerRanking: vi
        .fn()
        .mockResolvedValue([
          row(1, "Ada", 5),
          row(2, "Bob", 3),
          row(3, "Cy", 1),
        ]),
    };
    renderWindow();

    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);

    // Each row carries its rank, username and win count, in server order.
    expect(within(items[0]!).getByText("1")).toBeInTheDocument();
    expect(within(items[0]!).getByText("Ada")).toBeInTheDocument();
    expect(within(items[0]!).getByText("5")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Bob")).toBeInTheDocument();
    expect(within(items[2]!).getByText("Cy")).toBeInTheDocument();

    // The rendered order matches the server's most-wins-first order.
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Ada"),
      expect.stringContaining("Bob"),
      expect.stringContaining("Cy"),
    ]);
  });

  it("requests at most the top 50 entries from the backend", async () => {
    seedOpen();
    const getWinnerRanking = vi.fn().mockResolvedValue([]);
    actorState.actor = { getWinnerRanking };
    renderWindow();

    await screen.findByText("No ranked wins yet");
    expect(getWinnerRanking).toHaveBeenCalledWith(LEADERBOARD_LIMIT);
    expect(LEADERBOARD_LIMIT).toBe(50n);
  });

  it("does not fetch the ranking while the panel is collapsed", async () => {
    // Collapsed by default: the body is unmounted and the query is disabled, so
    // the leaderboard never joins the game poll. Opening the panel is what
    // triggers the first request.
    const getWinnerRanking = vi.fn().mockResolvedValue([]);
    actorState.actor = { getWinnerRanking };
    renderWindow();

    expect(getWinnerRanking).not.toHaveBeenCalled();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /Leaderboard/ }));
    await screen.findByText("No ranked wins yet");
    expect(getWinnerRanking).toHaveBeenCalledTimes(1);
  });

  it("highlights the signed-in player's own row when they appear", async () => {
    seedOpen();
    actorState.actor = {
      getWinnerRanking: vi
        .fn()
        .mockResolvedValue([row(1, "Ada", 5, true), row(2, "Bob", 3)]),
    };
    renderWindow();

    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");

    // The caller's own row is marked and carries the "You" badge; the other
    // row is not.
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(within(items[0]!).getByText("You")).toBeInTheDocument();
    expect(items[1]).not.toHaveAttribute("aria-current");
    expect(within(items[1]!).queryByText("You")).not.toBeInTheDocument();
  });

  it("never renders a principal value in the list", async () => {
    seedOpen();
    // The backend response carries only displayName/wins/rank/isMe; a principal
    // must never be shown. Seed a row whose display name is a username and
    // assert no principal-shaped text leaks into the rendered list.
    actorState.actor = {
      getWinnerRanking: vi.fn().mockResolvedValue([row(1, "Ada", 5)]),
    };
    const { container } = renderWindow();

    await screen.findByText("Ada");
    const list = container.querySelector('[data-ocid="leaderboard.list"]');
    expect(list).not.toBeNull();
    // The only text in the row is the rank, the username and the win count.
    expect(list?.textContent).toContain("Ada");
    expect(list?.textContent).not.toMatch(/[a-z0-9]{5}-[a-z0-9]{5}/i);
  });
});
