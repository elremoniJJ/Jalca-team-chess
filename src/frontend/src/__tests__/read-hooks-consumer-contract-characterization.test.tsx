import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the read-only polls become true queries.
 *
 * The request intentionally changes the backend's update-vs-query
 * classification for several read methods (getGameState, getGameRecord,
 * getExerciseAssignments, getDrinkingAssignments, getBets,
 * getResults) and moves maintenance off the client call path. None of that
 * is visible from the frontend: the generated actor wrapper exposes the same
 * method names and the same return shapes either way. So this file
 * deliberately does NOT freeze the update/query classification (a Candid
 * concern) nor any maintenance side effect.
 *
 * What it protects is the behavior ADJACENT to the change that must survive
 * it — the frontend consumer contract of the read hooks, which is the seam
 * the conversion touches:
 *
 *   - each hook calls the exact actor method with the exact arguments the
 *     backend contract expects (getGameState(principal) and the no-arg
 *     reads);
 *   - each hook maps the backend response to the same local shape the UI
 *     consumes (the "same data shape as before" acceptance criterion);
 *   - the hooks remain callable and resolve rather than throwing.
 *
 * The actor is a typed local mock (no real canister, no network). The
 * backend's own query/update classification is NOT exercised here — that is
 * the PocketIC lane's job.
 */

// use-advice imports Team as a runtime value from @/backend, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the hooks need.
vi.mock("@/backend", () => ({
  Team: { Black: "Black", White: "White" },
}));

// The read hooks reach the backend through useActorState() from
// lib/backend-actor. Mock it with a typed actor whose read methods are
// vi.fn()s so the test captures the exact call and controls the response.
const {
  getGameState,
  getGameRecord,
  getExerciseAssignments,
  getDrinkingAssignments,
} = vi.hoisted(() => ({
  getGameState: vi.fn(),
  getGameRecord: vi.fn(),
  getExerciseAssignments: vi.fn(),
  getDrinkingAssignments: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {
      getGameState,
      getGameRecord,
      getExerciseAssignments,
      getDrinkingAssignments,
    },
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

import type { GamePhase } from "@/backend";
import { useDrinkingAssignments } from "@/hooks/use-drinking-assignments";
import { useExerciseAssignments } from "@/hooks/use-exercise-assignments";
import { useGameRecord } from "@/hooks/use-game-record";
import { useGameState } from "@/hooks/use-game-state";

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/** A minimal but complete GameStateSnapshot fixture (the shape the backend
 * returns and the UI consumes). */
const gameStateFixture = {
  spellBoardState: {
    blockedSquares: [],
    explosiveSquares: [],
    shields: [],
  },
  spellUseEnabled: false,
  turn: "White",
  timerRemainingMs: 300000n,
  players: [
    {
      principal: "player-1",
      username: "Ada",
      team: "White",
      isMoveMaker: true,
    },
  ],
  board: Array.from({ length: 64 }, () => null),
  moveMaker: "player-1",
  phase: "Playing",
};

describe("read hooks frontend consumer contract", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("useGameState calls actor.getGameState(principal) and exposes the snapshot", async () => {
    getGameState.mockResolvedValue(gameStateFixture);

    function Harness() {
      const { data, isLoading } = useGameState("player-1");
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="phase">{data?.phase ?? "none"}</span>
          <span data-testid="players">{data?.players.length ?? -1}</span>
        </div>
      );
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getGameState).toHaveBeenCalledWith("player-1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("phase")).toHaveTextContent("Playing");
    });
    expect(screen.getByTestId("players")).toHaveTextContent("1");
  });

  it("useGameRecord calls actor.getGameRecord() and exposes the record", async () => {
    getGameRecord.mockResolvedValue({
      moves: [],
      active: true,
      concluded: false,
      openingName: "",
      rosters: [],
      playerList: [],
      finalBoard: [],
    });

    function Harness() {
      const { data, loading } = useGameRecord("Playing" as GamePhase);
      return (
        <div>
          <span data-testid="loading">{String(loading)}</span>
          <span data-testid="active">{String(data?.active ?? "none")}</span>
        </div>
      );
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getGameRecord).toHaveBeenCalledWith();
    });
    await waitFor(() => {
      expect(screen.getByTestId("active")).toHaveTextContent("true");
    });
  });

  it("useExerciseAssignments calls actor.getExerciseAssignments() and maps the backend shape", async () => {
    getExerciseAssignments.mockResolvedValue([
      {
        index: 2n,
        lostTeam: "White",
        capturedPiece: "Knight",
        reps: 10n,
        exercise: "PushUps",
        timestamp: 1n,
        trigger: "Capture",
        moveIndex: 5n,
      },
    ]);

    function Harness() {
      const { assignments } = useExerciseAssignments();
      const first = assignments[0];
      return (
        <div>
          <span data-testid="count">{assignments.length}</span>
          <span data-testid="id">{first?.id ?? "none"}</span>
          <span data-testid="team">{first?.team ?? "none"}</span>
          <span data-testid="reps">{first?.reps ?? -1}</span>
          <span data-testid="exercise">{first?.exercise ?? "none"}</span>
          <span data-testid="piece">{first?.capturedPiece ?? "none"}</span>
          <span data-testid="trigger">{first?.trigger ?? "none"}</span>
          <span data-testid="moveIndex">{first?.moveIndex ?? -1}</span>
        </div>
      );
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getExerciseAssignments).toHaveBeenCalledWith();
    });
    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("1");
    });
    // Backend -> local mapping is preserved: index -> id string, lostTeam ->
    // lowercase team, reps -> number, variant names -> local unions.
    expect(screen.getByTestId("id")).toHaveTextContent("2");
    expect(screen.getByTestId("team")).toHaveTextContent("white");
    expect(screen.getByTestId("reps")).toHaveTextContent("10");
    expect(screen.getByTestId("exercise")).toHaveTextContent("push-ups");
    expect(screen.getByTestId("piece")).toHaveTextContent("knight");
    expect(screen.getByTestId("trigger")).toHaveTextContent("Capture");
    expect(screen.getByTestId("moveIndex")).toHaveTextContent("5");
  });

  it("useDrinkingAssignments calls actor.getDrinkingAssignments() and maps the backend shape", async () => {
    getDrinkingAssignments.mockResolvedValue([
      {
        index: 3n,
        lostTeam: "Black",
        capturedPiece: "Queen",
        drinks: 4n,
        timestamp: 1n,
        trigger: "EnPassant",
        moveIndex: 7n,
      },
    ]);

    function Harness() {
      const { assignments } = useDrinkingAssignments();
      const first = assignments[0];
      return (
        <div>
          <span data-testid="count">{assignments.length}</span>
          <span data-testid="id">{first?.id ?? "none"}</span>
          <span data-testid="team">{first?.team ?? "none"}</span>
          <span data-testid="drinks">{first?.drinks ?? -1}</span>
          <span data-testid="piece">{first?.capturedPiece ?? "none"}</span>
          <span data-testid="trigger">{first?.trigger ?? "none"}</span>
          <span data-testid="moveIndex">{first?.moveIndex ?? -1}</span>
        </div>
      );
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getDrinkingAssignments).toHaveBeenCalledWith();
    });
    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("1");
    });
    expect(screen.getByTestId("id")).toHaveTextContent("3");
    expect(screen.getByTestId("team")).toHaveTextContent("black");
    expect(screen.getByTestId("drinks")).toHaveTextContent("4");
    expect(screen.getByTestId("piece")).toHaveTextContent("queen");
    expect(screen.getByTestId("trigger")).toHaveTextContent("EnPassant");
    expect(screen.getByTestId("moveIndex")).toHaveTextContent("7");
  });
});
