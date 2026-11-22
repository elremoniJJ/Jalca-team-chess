import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the next-game vote/settings flow changes.
 *
 * The request intentionally changes WHEN the frontend casts its vote (the
 * backend's game-end snapshot currently misses the frontend's late castVote)
 * and how the end-game modal is laid out. Neither of those is frozen here.
 *
 * What this file protects is the behavior ADJACENT to that change that must
 * survive it — the frontend consumer contract of the four voting hooks, which
 * is the seam the vote-timing fix touches:
 *
 *   - useVoteTally calls actor.getVoteTally() with no arguments and exposes
 *     the live tally (counts + winning settings);
 *   - useNextGameSettings calls actor.getNextGameSettings() with no arguments
 *     and exposes the winning settings for the next game;
 *   - useGameSettingsSnapshot calls actor.getGameSettingsSnapshot() with no
 *     arguments and exposes the persisted snapshot (winning options + counts);
 *   - useCastVote calls actor.castVote(principal, vote) with the exact
 *     principal and vote the route supplies, and on success invalidates the
 *     voteTally and nextGameSettings queries so the UI refreshes.
 *
 * The actor is a typed local mock (no real canister, no network). The
 * backend's own vote counting / snapshot capture is NOT exercised here — that
 * is the PocketIC lane's job.
 */

// The voting hooks import SpellUse/StartingPosition as runtime values from
// @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the hooks need.
vi.mock("@/backend", () => ({
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
  TurnDuration: {
    TwoMinutes: "TwoMinutes",
    NinetySeconds: "NinetySeconds",
    OneMinute: "OneMinute",
  },
}));

// The voting hooks reach the backend through useActorState() from
// lib/backend-actor. Mock it with a typed actor whose voting methods are
// vi.fn()s so the test captures the exact call and controls the response.
const {
  getVoteTally,
  getNextGameSettings,
  getGameSettingsSnapshot,
  castVote,
  getActor,
} = vi.hoisted(() => ({
  getVoteTally: vi.fn(),
  getNextGameSettings: vi.fn(),
  getGameSettingsSnapshot: vi.fn(),
  castVote: vi.fn(),
  getActor: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {
      getVoteTally,
      getNextGameSettings,
      getGameSettingsSnapshot,
      castVote,
    },
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor,
}));

import { SpellUse, StartingPosition, TurnDuration } from "@/backend";
import {
  useCastVote,
  useGameSettingsSnapshot,
  useNextGameSettings,
  useVoteTally,
} from "@/hooks/use-voting";

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/** The live tally shape the backend returns and the UI consumes. */
const tallyFixture = {
  standardCount: 1n,
  randomCount: 3n,
  spellOnCount: 4n,
  spellOffCount: 2n,
  winning: {
    startingPosition: StartingPosition.Random,
    spellUse: SpellUse.On,
  },
};

/** The persisted snapshot shape the backend returns and the UI consumes. */
const snapshotFixture = {
  standardCount: 1n,
  randomCount: 3n,
  spellOnCount: 4n,
  spellOffCount: 2n,
  startingPosition: StartingPosition.Random,
  spellUse: SpellUse.On,
};

describe("voting hooks frontend consumer contract", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("useVoteTally calls actor.getVoteTally() and exposes the live tally", async () => {
    getVoteTally.mockResolvedValue(tallyFixture);

    function Harness() {
      const { tally, isLoading } = useVoteTally();
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="spellOn">
            {String(tally?.spellOnCount ?? -1n)}
          </span>
          <span data-testid="random">{String(tally?.randomCount ?? -1n)}</span>
          <span data-testid="winningSpell">
            {tally?.winning.spellUse ?? "none"}
          </span>
          <span data-testid="winningPosition">
            {tally?.winning.startingPosition ?? "none"}
          </span>
        </div>
      );
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getVoteTally).toHaveBeenCalledWith();
    });
    await waitFor(() => {
      expect(screen.getByTestId("spellOn")).toHaveTextContent("4");
    });
    expect(screen.getByTestId("random")).toHaveTextContent("3");
    expect(screen.getByTestId("winningSpell")).toHaveTextContent("On");
    expect(screen.getByTestId("winningPosition")).toHaveTextContent("Random");
  });

  it("useNextGameSettings calls actor.getNextGameSettings() and exposes the winning settings", async () => {
    getNextGameSettings.mockResolvedValue({
      startingPosition: StartingPosition.Random,
      spellUse: SpellUse.On,
    });

    function Harness() {
      const { settings, isLoading } = useNextGameSettings();
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="spell">{settings?.spellUse ?? "none"}</span>
          <span data-testid="position">
            {settings?.startingPosition ?? "none"}
          </span>
        </div>
      );
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getNextGameSettings).toHaveBeenCalledWith();
    });
    await waitFor(() => {
      expect(screen.getByTestId("spell")).toHaveTextContent("On");
    });
    expect(screen.getByTestId("position")).toHaveTextContent("Random");
  });

  it("useGameSettingsSnapshot calls actor.getGameSettingsSnapshot() and exposes the persisted snapshot", async () => {
    getGameSettingsSnapshot.mockResolvedValue(snapshotFixture);

    function Harness() {
      const { snapshot, isLoading } = useGameSettingsSnapshot();
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="spell">{snapshot?.spellUse ?? "none"}</span>
          <span data-testid="position">
            {snapshot?.startingPosition ?? "none"}
          </span>
          <span data-testid="spellOn">
            {String(snapshot?.spellOnCount ?? -1n)}
          </span>
        </div>
      );
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getGameSettingsSnapshot).toHaveBeenCalledWith();
    });
    await waitFor(() => {
      expect(screen.getByTestId("spell")).toHaveTextContent("On");
    });
    expect(screen.getByTestId("position")).toHaveTextContent("Random");
    expect(screen.getByTestId("spellOn")).toHaveTextContent("4");
  });

  it("useCastVote calls actor.castVote(principal, vote) with the supplied vote", async () => {
    castVote.mockResolvedValue(undefined);
    getActor.mockResolvedValue({
      castVote,
    });

    function Harness() {
      const { mutate } = useCastVote();
      return (
        <button
          type="button"
          onClick={() =>
            mutate({
              principal: "player-1",
              vote: {
                startingPosition: StartingPosition.Random,
                spellUse: SpellUse.On,
                turnDuration: TurnDuration.TwoMinutes,
              },
            })
          }
        >
          cast
        </button>
      );
    }

    renderWithQuery(<Harness />);
    screen.getByRole("button", { name: "cast" }).click();

    await waitFor(() => {
      expect(castVote).toHaveBeenCalledWith("player-1", {
        startingPosition: StartingPosition.Random,
        spellUse: SpellUse.On,
        turnDuration: TurnDuration.TwoMinutes,
      });
    });
  });

  it("useCastVote invalidates the voteTally and nextGameSettings queries on success", async () => {
    castVote.mockResolvedValue(undefined);
    getActor.mockResolvedValue({ castVote });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    function Harness() {
      const { mutate } = useCastVote();
      return (
        <button
          type="button"
          onClick={() =>
            mutate({
              principal: "player-1",
              vote: {
                startingPosition: StartingPosition.Standard,
                spellUse: SpellUse.Off,
                turnDuration: TurnDuration.TwoMinutes,
              },
            })
          }
        >
          cast
        </button>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
    screen.getByRole("button", { name: "cast" }).click();

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["voteTally"] });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["nextGameSettings"],
    });
  });
});
