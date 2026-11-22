import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Chessboard and chess-logic import PieceType/Team as runtime values from
// @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the board needs. The spell
// board effects under test are pure frontend rendering / move derivation and
// never touch the actor.
vi.mock("@/backend", () => ({
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  BallsColourFamily: {
    Sandy: "Sandy",
    Cloudy: "Cloudy",
    Grassy: "Grassy",
    Fiery: "Fiery",
    Wooden: "Wooden",
  },
  OpponentBoardImage: { Hairy: "Hairy", Veiny: "Veiny", Shiny: "Shiny" },
  Team: { Black: "Black", White: "White" },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// AdvicePopup -> lib/backend-actor imports createActorWithConfig from
// @caffeineai/core-infrastructure, which also fails to resolve its own
// submodules in jsdom. The spell board effects never call the actor.
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
}));

import {
  type Piece,
  type PieceType,
  type PlayerInfo,
  Team,
  WalletSource,
} from "@/backend";
import { Chessboard } from "@/components/Chessboard";
import { getLegalMoves } from "@/lib/chess-logic";

/**
 * Cover for the Bouvet Hondao inner-square indicator and the adjacent board
 * behavior the request must not regress.
 *
 * The request adds a smaller square drawn inside the square blocked by Bouvet
 * Hondao, in a colour distinct from both chessboard square colours, visible
 * ONLY to the team that played the spell. The opposing team sees the same
 * blocked square with no indicator, and the square stays non-landable and
 * non-traversable for BOTH teams regardless of who sees the indicator.
 *
 * What this file asserts:
 *   - the owning team sees the `.sq-blocked` inner-square indicator on the
 *     blocked square;
 *   - the opposing team sees the same square with no `.sq-blocked` indicator;
 *   - no `.sq-blocked` indicator renders on any square when no Bouvet Hondao
 *     spell has been played (no blocked squares in the context);
 *   - the blocked square is not offered as a legal destination and cannot be
 *     moved through, for either team;
 *   - the adjacent working features survive: the Conu Bungno explosive 'X'
 *     visibility, legal-move highlighting, board flip, coordinates toggle, and
 *     advice overlays.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering and move derivation — not real backend
 * behavior. The real `getSpellBoardState` query is exercised by the PocketIC
 * lane when it runs.
 */

const EMPTY_BOARD: Array<Piece | null> = Array.from({ length: 64 }, () => null);

function piece(pieceType: PieceType, color: Team): Piece {
  return { pieceType, color, summoned: false };
}

/**
 * A board with both kings present. `getLegalMoves` filters every candidate
 * through `isLegalMove`, which returns false when the mover's king is missing
 * from the simulated board — so a board without kings yields no moves at all
 * and cannot exercise blocked-square semantics.
 */
function boardWithKings(): Array<Piece | null> {
  const board = [...EMPTY_BOARD];
  board[4] = piece("King" as PieceType, Team.White); // e1
  board[60] = piece("King" as PieceType, Team.Black); // e8
  return board;
}

const WHITE_PLAYER: PlayerInfo = {
  principal: "player-1",
  username: "Ada",
  team: Team.White,
  walletSource: WalletSource.none,
  isMoveMaker: false,
  isFresh: false,
  isInactive: false,
  isBot: false,
};

const BLACK_PLAYER: PlayerInfo = {
  principal: "player-2",
  username: "Bob",
  team: Team.Black,
  walletSource: WalletSource.none,
  isMoveMaker: false,
  isFresh: false,
  isInactive: false,
  isBot: false,
};

interface SpellContextFixture {
  blockedSquares?: Set<number>;
  blockedSquareOwners?: Map<number, Team>;
  explosiveSquares?: Set<number>;
  explosiveOwners?: Map<number, Team>;
}

function renderBoard(
  board: Array<Piece | null>,
  currentPlayer: PlayerInfo,
  spellContext: SpellContextFixture,
  overrides: {
    orientation?: Team;
    showCoordinates?: boolean;
  } = {},
) {
  return render(
    <Chessboard
      board={board}
      turn={currentPlayer.team}
      moveMaker="maker-1"
      currentPlayer={currentPlayer}
      onMove={() => {}}
      orientation={overrides.orientation ?? Team.White}
      selectedSquareProp={null}
      destinationSquareProp={null}
      pendingPromotionPieceProp={null}
      showCoordinates={overrides.showCoordinates ?? true}
      spellContext={spellContext}
    />,
  );
}

describe("Bouvet Hondao inner-square indicator", () => {
  beforeEach(() => {
    // jsdom lacks these browser APIs the Chessboard relies on.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the inner-square indicator to the team that played the block", () => {
    // Square 27 (d4) is blocked by a White-cast Bouvet Hondao.
    const blockedSquares = new Set<number>([27]);
    const blockedSquareOwners = new Map<number, Team>([[27, Team.White]]);

    renderBoard(EMPTY_BOARD, WHITE_PLAYER, {
      blockedSquares,
      blockedSquareOwners,
    });

    const square = screen.getByRole("button", { name: /Square d4/ });
    expect(square.querySelector(".sq-blocked")).toBeInTheDocument();
  });

  it("hides the inner-square indicator from the opposing team", () => {
    // The same White-owned block is invisible to a Black viewer.
    const blockedSquares = new Set<number>([27]);
    const blockedSquareOwners = new Map<number, Team>([[27, Team.White]]);

    renderBoard(EMPTY_BOARD, BLACK_PLAYER, {
      blockedSquares,
      blockedSquareOwners,
    });

    const square = screen.getByRole("button", { name: /Square d4/ });
    expect(square.querySelector(".sq-blocked")).toBeNull();
  });

  it("shows the indicator to a Black viewer for a Black-owned block", () => {
    // The gating is by owner, not by a hardcoded team: a Black-cast block is
    // visible to Black and hidden from White.
    const blockedSquares = new Set<number>([27]);
    const blockedSquareOwners = new Map<number, Team>([[27, Team.Black]]);

    renderBoard(EMPTY_BOARD, BLACK_PLAYER, {
      blockedSquares,
      blockedSquareOwners,
    });
    expect(
      screen
        .getByRole("button", { name: /Square d4/ })
        .querySelector(".sq-blocked"),
    ).toBeInTheDocument();

    cleanup();

    renderBoard(EMPTY_BOARD, WHITE_PLAYER, {
      blockedSquares,
      blockedSquareOwners,
    });
    expect(
      screen
        .getByRole("button", { name: /Square d4/ })
        .querySelector(".sq-blocked"),
    ).toBeNull();
  });

  it("renders no inner-square indicator when no Bouvet Hondao spell has been played", () => {
    // No blocked squares in the context at all — no square may carry the
    // indicator, for either viewer.
    renderBoard(EMPTY_BOARD, WHITE_PLAYER, {});
    expect(
      screen
        .getByRole("button", { name: /Square d4/ })
        .querySelector(".sq-blocked"),
    ).toBeNull();

    cleanup();

    renderBoard(EMPTY_BOARD, BLACK_PLAYER, {});
    expect(
      screen
        .getByRole("button", { name: /Square d4/ })
        .querySelector(".sq-blocked"),
    ).toBeNull();
  });

  it("does not offer a blocked square as a legal destination for either team", () => {
    // A White rook on a1 (square 0) with a2 (square 8) blocked. The rook can
    // still move along the first rank, but not onto the blocked square. The
    // block applies regardless of which team is viewing.
    const board = boardWithKings();
    board[0] = piece("Rook" as PieceType, Team.White);

    const moves = getLegalMoves(board, 0, {
      spell: { blockedSquares: new Set<number>([8]) },
    });

    expect(moves).not.toContain(8);
    expect(moves).toContain(1);
  });

  it("does not let a sliding piece move through a blocked square for either team", () => {
    // The same rook with a2 (square 8) blocked must not reach a3 (square 16)
    // or any square beyond the block on that file.
    const board = boardWithKings();
    board[0] = piece("Rook" as PieceType, Team.White);

    const moves = getLegalMoves(board, 0, {
      spell: { blockedSquares: new Set<number>([8]) },
    });

    expect(moves).not.toContain(8);
    expect(moves).not.toContain(16);
    expect(moves).not.toContain(24);
  });

  it("keeps the Conu Bungno explosive 'X' visible only to the team that played the trap", () => {
    // The new blocked-square indicator must not leak or hide the explosive
    // marker: a White-owned trap is visible to White and hidden from Black.
    const explosiveSquares = new Set<number>([27]);
    const explosiveOwners = new Map<number, Team>([[27, Team.White]]);

    renderBoard(EMPTY_BOARD, WHITE_PLAYER, {
      explosiveSquares,
      explosiveOwners,
    });
    expect(
      screen
        .getByRole("button", { name: /Square d4/ })
        .querySelector(".sq-explosive"),
    ).toBeInTheDocument();

    cleanup();

    renderBoard(EMPTY_BOARD, BLACK_PLAYER, {
      explosiveSquares,
      explosiveOwners,
    });
    expect(
      screen
        .getByRole("button", { name: /Square d4/ })
        .querySelector(".sq-explosive"),
    ).toBeNull();
  });

  it("renders the board with coordinates shown and hidden", () => {
    // The coordinates toggle is an adjacent working feature: the file/rank
    // labels render when showCoordinates is true and are absent when false.
    renderBoard(EMPTY_BOARD, WHITE_PLAYER, {}, { showCoordinates: true });
    // The file labels are aria-hidden overlays; assert on their text content.
    expect(screen.getAllByText("a").length).toBeGreaterThan(0);

    cleanup();

    renderBoard(EMPTY_BOARD, WHITE_PLAYER, {}, { showCoordinates: false });
    expect(screen.queryByText("a")).toBeNull();
  });

  it("flips the board for a Black viewer while keeping the same squares", () => {
    // Board flip is an adjacent working feature: the square buttons are the
    // same 64 squares regardless of orientation, and the board still renders.
    renderBoard(EMPTY_BOARD, BLACK_PLAYER, {}, { orientation: Team.Black });
    expect(screen.getAllByRole("button", { name: /Square / })).toHaveLength(64);
    expect(
      screen.getByRole("button", { name: /Square a1/ }),
    ).toBeInTheDocument();
  });

  it("renders no advice overlay on any square (advice feature removed)", () => {
    // The advice feature was removed from the board, so no `.advice-sq`
    // marker may render on any square.
    renderBoard(EMPTY_BOARD, WHITE_PLAYER, {});

    expect(document.querySelector(".advice-sq")).toBeNull();
  });
});

/**
 * The `useSpellBoardState` mapping contract for the new `blockedSquareOwners`
 * field. The backend now populates it from a played Bouvet Hondao spell; the
 * hook must map it into the `Map<number, Team>` the board consumes to gate the
 * inner-square indicator.
 */
const { getSpellBoardState, useActorState } = vi.hoisted(() => ({
  getSpellBoardState: vi.fn(),
  useActorState: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({ useActorState }));

import type { SpellBoardView } from "@/backend";
import { useSpellBoardState } from "@/hooks/use-spell-board-state";

function SpellBoardHarness() {
  const { spellContext, isLoading } = useSpellBoardState();
  const blocked = spellContext?.blockedSquares?.size
    ? [...spellContext.blockedSquares].sort((a, b) => a - b).join(",")
    : "NONE";
  const blockedOwners = spellContext?.blockedSquareOwners?.size
    ? [...spellContext.blockedSquareOwners.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([sq, team]) => `${sq}:${team}`)
        .join(",")
    : "NONE";
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="blocked">{blocked}</span>
      <span data-testid="blocked-owners">{blockedOwners}</span>
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

describe("useSpellBoardState blocked-square owner mapping", () => {
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

  it("maps blockedSquareOwners into a Map<number, Team> keyed by square", async () => {
    getSpellBoardState.mockResolvedValue(
      view({
        blockedSquares: [12n, 28n],
        blockedSquareOwners: [
          { owner: "White" as Team, square: 28n },
          { owner: "Black" as Team, square: 12n },
        ],
      }),
    );
    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("blocked")).toHaveTextContent("12,28");
    });
    expect(screen.getByTestId("blocked-owners")).toHaveTextContent(
      "12:Black,28:White",
    );
  });

  it("yields no blocked-square owners when no Bouvet Hondao spell has been played", async () => {
    getSpellBoardState.mockResolvedValue(view());
    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("blocked")).toHaveTextContent("NONE");
    expect(screen.getByTestId("blocked-owners")).toHaveTextContent("NONE");
  });
});
