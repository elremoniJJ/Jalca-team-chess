import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted spectator polling change in the two assignment hooks.
 *
 * The request moves use-drinking-assignments.ts and use-exercise-assignments.ts
 * from a hardcoded 1500ms interval to the shared getGamePollMs() helper, so a
 * SPECTATOR's assignment polls run at 5000ms while a PLAYER's stay at 1500ms.
 *
 * The existing spectator cover asserts the helper's return value; this file
 * asserts the OBSERVABLE consequence on the two changed hooks: the actor's
 * getDrinkingAssignments / getExerciseAssignments methods are actually called
 * on the spectator cadence and not on the player cadence. A hook that kept a
 * hardcoded 1500ms interval — or that read the wrong branch of the helper —
 * fails here.
 *
 * The backend actor is a typed local mock; this is component/integration
 * coverage, not deployed browser E2E. The real backend behavior is the
 * PocketIC lane's job.
 */

// The hooks import PieceType/TriggerType/ExerciseKind as runtime values from
// @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the hooks need.
vi.mock("@/backend", () => ({
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  TriggerType: {
    Capture: "Capture",
    EnPassant: "EnPassant",
    Castling: "Castling",
    Check: "Check",
  },
  ExerciseKind: {
    NinjaRoll: "NinjaRoll",
    PushUps: "PushUps",
    Squats: "Squats",
    Cartwheel: "Cartwheel",
    Crunches: "Crunches",
  },
}));

// The spectator state seam. `isSpectating` is the accessor getGamePollMs()
// reads imperatively; the test drives it per case.
const spectatorState = vi.hoisted(() => ({
  spectating: false,
}));

vi.mock("@/hooks/use-guest-identity", () => ({
  isSpectating: () => spectatorState.spectating,
}));

// The actor seam — the two assignment read methods are the calls under test.
const actorMethods = vi.hoisted(() => ({
  getDrinkingAssignments: vi.fn(),
  getExerciseAssignments: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: actorMethods,
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
}));

import { useDrinkingAssignments } from "@/hooks/use-drinking-assignments";
import { useExerciseAssignments } from "@/hooks/use-exercise-assignments";

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

function DrinkingHarness() {
  const { assignments } = useDrinkingAssignments();
  return <span data-testid="drinking">{assignments.length}</span>;
}

function ExerciseHarness() {
  const { assignments } = useExerciseAssignments();
  return <span data-testid="exercise">{assignments.length}</span>;
}

describe("assignment hook poll cadence (cover)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    spectatorState.spectating = false;
  });

  it("polls getDrinkingAssignments at 5000ms for a spectator, not 1500ms", async () => {
    spectatorState.spectating = true;
    actorMethods.getDrinkingAssignments.mockResolvedValue([]);

    // Fake only the interval clock so React Testing Library queries and
    // waitFor keep working on real timeouts.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    renderWithQuery(<DrinkingHarness />);

    // The first fetch fires on mount.
    await waitFor(() => {
      expect(actorMethods.getDrinkingAssignments).toHaveBeenCalledTimes(1);
    });

    // Just under the spectator cadence: no second poll yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(actorMethods.getDrinkingAssignments).toHaveBeenCalledTimes(1);

    // Crossing 5000ms triggers the spectator poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(actorMethods.getDrinkingAssignments).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("polls getExerciseAssignments at 5000ms for a spectator, not 1500ms", async () => {
    spectatorState.spectating = true;
    actorMethods.getExerciseAssignments.mockResolvedValue([]);

    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    renderWithQuery(<ExerciseHarness />);

    await waitFor(() => {
      expect(actorMethods.getExerciseAssignments).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(actorMethods.getExerciseAssignments).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(actorMethods.getExerciseAssignments).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("keeps the player cadence at 1500ms for getDrinkingAssignments", async () => {
    spectatorState.spectating = false;
    actorMethods.getDrinkingAssignments.mockResolvedValue([]);

    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    renderWithQuery(<DrinkingHarness />);

    await waitFor(() => {
      expect(actorMethods.getDrinkingAssignments).toHaveBeenCalledTimes(1);
    });

    // A player polls well before the spectator cadence would fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(actorMethods.getDrinkingAssignments).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("keeps the player cadence at 1500ms for getExerciseAssignments", async () => {
    spectatorState.spectating = false;
    actorMethods.getExerciseAssignments.mockResolvedValue([]);

    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    renderWithQuery(<ExerciseHarness />);

    await waitFor(() => {
      expect(actorMethods.getExerciseAssignments).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(actorMethods.getExerciseAssignments).toHaveBeenCalledTimes(2);
  }, 10_000);
});
