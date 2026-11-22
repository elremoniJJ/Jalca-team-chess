import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the accepted "concluded-game number" and
 * "Spells cast accumulation" changes.
 *
 * The accepted request intentionally changes two things:
 *   1. the Game Record modal's NFT Mint Results section will read the number
 *      of the game that just ended instead of the live post-increment counter
 *      (so its displayed game number and listed attempts change for a
 *      concluded game); and
 *   2. the "Spells cast" list will stop clearing on every move completion and
 *      will instead accumulate for the whole game, clearing only at game start
 *      and game end.
 *
 * Those two behaviors are deliberately NOT asserted here — pinning the current
 * (pre-change) selection or the current per-turn clearing would fight the
 * change.
 *
 * What IS protected is the behavior ADJACENT to the change that must survive
 * it — the two data seams the change is built on:
 *
 *   - `useGameMeta` still reads the game number from the backend's
 *     `getGameNumber` query with no arguments and exposes the returned bigint
 *     unchanged. The change moves WHICH number the modal chooses; it must not
 *     change the seam that supplies the number.
 *   - `useBurnState` still reads the per-team burned-spell windows from the
 *     backend's `getBurnState` query with no arguments and exposes the
 *     snapshot unchanged, including each team's `minorMajorSpells` list and
 *     each entry's spell name, game number, team and outcome. The accumulation
 *     change moves WHEN the list clears; it must not change the seam that
 *     supplies the list, nor merge the two teams' windows.
 *
 * The actor is a typed local mock (no real canister, no network), so this file
 * proves the frontend consumer contract only. The backend's own retention and
 * per-spell outcome classification are the PocketIC lane's job. See
 * episode.coverageLimits.
 */

// The hooks reach the backend through useActorState() from lib/backend-actor.
// Mock it with a typed actor whose reads are vi.fn()s so the test captures the
// exact calls and controls the responses.
const { getGameNumber, getBurnState, useActorState } = vi.hoisted(() => ({
  getGameNumber: vi.fn(),
  getBurnState: vi.fn(),
  useActorState: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({ useActorState }));

import { BurnedSpellCategory, SpellCastOutcome, Team } from "@/backend";
import type { BurnStateSnapshot } from "@/backend";
import { useBurnState } from "@/hooks/use-burn-state";
import { useGameMeta } from "@/hooks/use-game-meta";

/** A burn-state snapshot as the backend's getBurnState returns it. */
function burnStateFixture(): BurnStateSnapshot {
  return {
    burnOccurredThisTurn: true,
    burnedByTeam: Team.White,
    whiteWindow: {
      minorMajorSpells: [
        {
          spellName: "White Minor",
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
      minorMajorSpells: [
        {
          spellName: "Black Major",
          gameNumber: 8n,
          team: Team.Black,
          category: BurnedSpellCategory.Major,
          outcome: SpellCastOutcome.prevented,
        },
      ],
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

/** A harness that renders useGameMeta's observable output. */
function GameMetaHarness() {
  const { gameNumber, isLoading, error } = useGameMeta("player-1");
  return (
    <div>
      <span data-testid="game-number">
        {gameNumber !== null ? gameNumber.toString() : "none"}
      </span>
      <span data-testid="game-number-loading">{String(isLoading)}</span>
      <span data-testid="game-number-error">{error ? "error" : "none"}</span>
    </div>
  );
}

/** A harness that renders useBurnState's observable output. */
function BurnStateHarness() {
  const { data, isLoading, error } = useBurnState();
  return (
    <div>
      <span data-testid="burn-loading">{String(isLoading)}</span>
      <span data-testid="burn-error">{error ? "error" : "none"}</span>
      <span data-testid="white-minor">
        {data?.whiteWindow.minorMajorSpells[0]?.spellName ?? "none"}
      </span>
      <span data-testid="white-minor-game">
        {data?.whiteWindow.minorMajorSpells[0]?.gameNumber.toString() ?? "none"}
      </span>
      <span data-testid="white-minor-team">
        {data?.whiteWindow.minorMajorSpells[0]?.team ?? "none"}
      </span>
      <span data-testid="white-minor-outcome">
        {data?.whiteWindow.minorMajorSpells[0]?.outcome ?? "none"}
      </span>
      <span data-testid="black-major">
        {data?.blackWindow.minorMajorSpells[0]?.spellName ?? "none"}
      </span>
      <span data-testid="black-major-team">
        {data?.blackWindow.minorMajorSpells[0]?.team ?? "none"}
      </span>
    </div>
  );
}

describe("useGameMeta game-number seam (adjacent to the concluded-game-number change)", () => {
  beforeEach(() => {
    getGameNumber.mockResolvedValue(7n);
    useActorState.mockReturnValue({
      actor: { getGameNumber },
      isLoading: false,
      error: null,
      retry: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("calls actor.getGameNumber() with no arguments and exposes the bigint unchanged", async () => {
    renderWithQuery(<GameMetaHarness />);

    await waitFor(() => {
      expect(getGameNumber).toHaveBeenCalledWith();
    });
    await waitFor(() => {
      expect(screen.getByTestId("game-number")).toHaveTextContent("7");
    });
    expect(screen.getByTestId("game-number-error")).toHaveTextContent("none");
  });

  it("does not call the actor while the actor is not yet initialized", async () => {
    useActorState.mockReturnValue({
      actor: null,
      isLoading: false,
      error: null,
      retry: vi.fn(),
    });

    renderWithQuery(<GameMetaHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("game-number")).toHaveTextContent("none");
    });
    expect(getGameNumber).not.toHaveBeenCalled();
  });

  it("surfaces the actor's loading state while the actor is loading", async () => {
    useActorState.mockReturnValue({
      actor: null,
      isLoading: true,
      error: null,
      retry: vi.fn(),
    });

    renderWithQuery(<GameMetaHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("game-number-loading")).toHaveTextContent(
        "true",
      );
    });
    expect(getGameNumber).not.toHaveBeenCalled();
  });
});

describe("useBurnState per-team window seam (adjacent to the Spells cast accumulation change)", () => {
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

  it("calls actor.getBurnState() with no arguments and exposes each team's window unchanged", async () => {
    renderWithQuery(<BurnStateHarness />);

    await waitFor(() => {
      expect(getBurnState).toHaveBeenCalledWith();
    });
    // White's window keeps its own cast spell, with its game number, team and
    // outcome intact.
    await waitFor(() => {
      expect(screen.getByTestId("white-minor")).toHaveTextContent(
        "White Minor",
      );
    });
    expect(screen.getByTestId("white-minor-game")).toHaveTextContent("7");
    expect(screen.getByTestId("white-minor-team")).toHaveTextContent("White");
    expect(screen.getByTestId("white-minor-outcome")).toHaveTextContent(
      "succeeded",
    );
    // Black's window is not merged into White's: it carries its own cast spell.
    expect(screen.getByTestId("black-major")).toHaveTextContent("Black Major");
    expect(screen.getByTestId("black-major-team")).toHaveTextContent("Black");
    expect(screen.getByTestId("burn-error")).toHaveTextContent("none");
  });

  it("does not call the actor while the actor is not yet initialized", async () => {
    useActorState.mockReturnValue({
      actor: null,
      isLoading: false,
      error: null,
      retry: vi.fn(),
    });

    renderWithQuery(<BurnStateHarness />);

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

    renderWithQuery(<BurnStateHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("burn-loading")).toHaveTextContent("true");
    });
    expect(getBurnState).not.toHaveBeenCalled();
  });
});
