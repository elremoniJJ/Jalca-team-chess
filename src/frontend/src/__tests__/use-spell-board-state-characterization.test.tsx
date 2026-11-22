import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the SPELL BOARD STATE consumer seam, taken BEFORE the
 * per-game shield / offensive-spell resolution layer is added.
 *
 * The request adds shield totals and offensive-spell resolution, and states
 * that an offensive spell only takes effect on the chessboard when its value
 * strictly exceeds the defending shield. That board-effect decision is
 * backend-owned; the frontend's only board-effect input is this hook, which
 * maps the backend's `getSpellBoardState` view into the `SpellContext` shape
 * the Chessboard and `getLegalMoves` consume. The shield work must not change
 * this mapping.
 *
 * What IS protected here — the hook's transformation contract, which no other
 * suite exercises directly (every other suite mocks the hook to a fixed
 * value):
 *   - `blockedSquares: Array<bigint>` maps to a `Set<number>` of square
 *     indices;
 *   - `explosiveSquares: Array<{owner, square}>` maps to BOTH a
 *     `Set<number>` of squares and a `Map<number, Team>` of the team that
 *     played each trap;
 *   - when `spellUseEnabled` is false the hook returns an empty `SpellContext`
 *     (`{}`) rather than `undefined`, so React Query resolves `isLoading` to
 *     false and the board falls back to standard legal-move highlighting.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the hook's mapping — not real backend behavior. The real
 * `getSpellBoardState` query is exercised by the PocketIC lane when it runs.
 */

const { getSpellBoardState, useActorState } = vi.hoisted(() => ({
  getSpellBoardState: vi.fn(),
  useActorState: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({ useActorState }));

import type { SpellBoardView, Team } from "@/backend";
import { useSpellBoardState } from "@/hooks/use-spell-board-state";

/**
 * A harness exposing the hook's mapped `SpellContext` fields as text so the
 * transformation can be asserted without rendering the Chessboard.
 */
function SpellBoardHarness() {
  const { spellContext, isLoading } = useSpellBoardState();
  const blocked = spellContext?.blockedSquares?.size
    ? [...spellContext.blockedSquares].sort((a, b) => a - b).join(",")
    : "NONE";
  const explosive = spellContext?.explosiveSquares?.size
    ? [...spellContext.explosiveSquares].sort((a, b) => a - b).join(",")
    : "NONE";
  const owners = spellContext?.explosiveOwners?.size
    ? [...spellContext.explosiveOwners.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([sq, team]) => `${sq}:${team}`)
        .join(",")
    : "NONE";
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="blocked">{blocked}</span>
      <span data-testid="explosive">{explosive}</span>
      <span data-testid="owners">{owners}</span>
    </div>
  );
}

function renderHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SpellBoardHarness />
    </QueryClientProvider>,
  );
}

function view(overrides: Partial<SpellBoardView> = {}): SpellBoardView {
  return {
    spellUseEnabled: true,
    blockedSquares: [],
    blockedSquareOwners: [],
    explosiveSquares: [],
    ...overrides,
  };
}

describe("useSpellBoardState mapping", () => {
  beforeEach(() => {
    getSpellBoardState.mockReset();
    useActorState.mockReturnValue({
      actor: { getSpellBoardState },
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("maps blocked squares from bigint to a Set<number>", async () => {
    getSpellBoardState.mockResolvedValue(
      view({ blockedSquares: [12n, 28n, 3n] }),
    );
    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("blocked")).toHaveTextContent("3,12,28");
    });
    // No explosive traps in this view.
    expect(screen.getByTestId("explosive")).toHaveTextContent("NONE");
    expect(screen.getByTestId("owners")).toHaveTextContent("NONE");
  });

  it("maps explosive squares to both a Set<number> and a Map<number, Team> of owners", async () => {
    getSpellBoardState.mockResolvedValue(
      view({
        explosiveSquares: [
          { owner: "White" as Team, square: 40n },
          { owner: "Black" as Team, square: 7n },
        ],
      }),
    );
    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("explosive")).toHaveTextContent("7,40");
    });
    // Each trap's owner is preserved, keyed by the numeric square.
    expect(screen.getByTestId("owners")).toHaveTextContent("7:Black,40:White");
  });

  it("returns an empty SpellContext (not undefined) when spells are disabled", async () => {
    getSpellBoardState.mockResolvedValue(
      view({
        spellUseEnabled: false,
        blockedSquares: [12n],
        explosiveSquares: [{ owner: "White" as Team, square: 40n }],
      }),
    );
    renderHarness();

    // The disabled view yields no blocked/explosive squares, and the query
    // resolves (isLoading false) rather than staying stuck.
    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("blocked")).toHaveTextContent("NONE");
    expect(screen.getByTestId("explosive")).toHaveTextContent("NONE");
    expect(screen.getByTestId("owners")).toHaveTextContent("NONE");
  });
});
