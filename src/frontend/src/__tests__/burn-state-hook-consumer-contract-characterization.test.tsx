import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the burn-state data layer's frontend consumer contract,
 * taken BEFORE the "Spells cast" rework adds per-spell outcome data to the
 * backend burn state.
 *
 * The accepted request intentionally changes the SHAPE of the burn state (each
 * burned spell gains an outcome) and the team-window rendering (the bottom
 * "Shield +N / No Subao Ve burned yet" block is removed, the list is renamed
 * "Spells cast", items gain a tick / cross / question mark, the list scrolls
 * and its empty-state text is removed). Those are deliberately NOT asserted
 * here — pinning them would fight the change.
 *
 * What IS protected is the behavior ADJACENT to the change that must survive
 * it: the `useBurnState` hook seam through which the team windows reach the
 * backend's `getBurnState` query.
 *
 *   - `useBurnState` calls `actor.getBurnState()` with no arguments;
 *   - it exposes the returned snapshot unchanged (the per-team windows and
 *     their burned-spell lists survive the round trip);
 *   - it does not call the actor while the actor is not yet initialized;
 *   - it surfaces the actor's loading state while the actor is loading.
 *
 * The actor is a typed local mock (no real canister, no network), so this file
 * proves the frontend consumer contract only. The real backend behavior is the
 * PocketIC lane's job.
 */

// The hook reaches the backend through useActorState() from lib/backend-actor.
// Mock it with a typed actor whose getBurnState is a vi.fn() so the test
// captures the exact call and controls the response.
const { getBurnState, useActorState } = vi.hoisted(() => ({
  getBurnState: vi.fn(),
  useActorState: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({ useActorState }));

import { BurnedSpellCategory, SpellCastOutcome, Team } from "@/backend";
import type { BurnStateSnapshot } from "@/backend";
import { useBurnState } from "@/hooks/use-burn-state";

/** A burn-state snapshot as the backend's getBurnState returns it. */
function burnStateFixture(): BurnStateSnapshot {
  return {
    burnOccurredThisTurn: true,
    burnedByTeam: Team.White,
    whiteWindow: {
      minorMajorSpells: [
        {
          spellName: "Minor Spell",
          gameNumber: 7n,
          team: Team.White,
          category: BurnedSpellCategory.Minor,
          outcome: SpellCastOutcome.succeeded,
        },
      ],
      subaoVeSpells: [
        {
          spellName: "Subao Ve",
          gameNumber: 5n,
          team: Team.White,
          category: BurnedSpellCategory.SubaoVe,
          outcome: SpellCastOutcome.prevented,
        },
      ],
    },
    blackWindow: {
      minorMajorSpells: [],
      subaoVeSpells: [],
    },
  };
}

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/** A harness that renders the hook's observable output. */
function Harness() {
  const { data, isLoading, error } = useBurnState();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="error">{error ? "error" : "none"}</span>
      <span data-testid="white-minor">
        {data?.whiteWindow.minorMajorSpells[0]?.spellName ?? "none"}
      </span>
      <span data-testid="white-minor-game">
        {data?.whiteWindow.minorMajorSpells[0]?.gameNumber.toString() ?? "none"}
      </span>
      <span data-testid="white-subao">
        {data?.whiteWindow.subaoVeSpells[0]?.spellName ?? "none"}
      </span>
      <span data-testid="black-minor-count">
        {data?.blackWindow.minorMajorSpells.length ?? "none"}
      </span>
    </div>
  );
}

describe("useBurnState consumer contract", () => {
  beforeEach(() => {
    getBurnState.mockResolvedValue(burnStateFixture());
    useActorState.mockReturnValue({
      actor: { getBurnState },
      isLoading: false,
      error: null,
      retry: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("calls actor.getBurnState() with no arguments and exposes the snapshot unchanged", async () => {
    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(getBurnState).toHaveBeenCalledWith();
    });
    // The per-team windows and their burned-spell lists survive the round trip
    // unchanged: spell name and bigint game number are exposed as returned.
    await waitFor(() => {
      expect(screen.getByTestId("white-minor")).toHaveTextContent(
        "Minor Spell",
      );
    });
    expect(screen.getByTestId("white-minor-game")).toHaveTextContent("7");
    expect(screen.getByTestId("white-subao")).toHaveTextContent("Subao Ve");
    expect(screen.getByTestId("black-minor-count")).toHaveTextContent("0");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("does not call the actor while the actor is not yet initialized", async () => {
    useActorState.mockReturnValue({
      actor: null,
      isLoading: false,
      error: null,
      retry: vi.fn(),
    });

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("white-minor")).toHaveTextContent("none");
    });
    expect(getBurnState).not.toHaveBeenCalled();
  });

  it("surfaces the actor's loading state while the actor is loading", async () => {
    useActorState.mockReturnValue({
      actor: null,
      isLoading: true,
      error: null,
      retry: vi.fn(),
    });

    renderWithQuery(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("true");
    });
    expect(getBurnState).not.toHaveBeenCalled();
  });
});
