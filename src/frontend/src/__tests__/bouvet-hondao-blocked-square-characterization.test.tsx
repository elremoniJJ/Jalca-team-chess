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
 * Characterization of the Bouvet Hondao BLOCKED-SQUARE consumer contract,
 * taken BEFORE the blocked square gains its new inner-square indicator.
 *
 * The request adds a smaller square drawn inside the square blocked by Bouvet
 * Hondao, visible only to the team that played the spell, and bumps the
 * wordmark to v260. Neither change may alter the behavior protected here:
 *
 *   - a blocked square is still not offered as a legal destination, and a
 *     sliding piece still cannot move THROUGH it to squares beyond;
 *   - the Conu Bungno explosive 'X' is still revealed only to the team that
 *     played the trap and hidden from the opponent (the new indicator must not
 *     leak the explosive marker to the opponent, nor hide it from the owner);
 *   - the `useSpellBoardState` mapping still turns the backend's
 *     `blockedSquares` / `explosiveSquares` arrays into the `SpellContext`
 *     sets/map the board consumes, and still yields an empty context when
 *     spells are disabled.
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

function renderBoard(
  board: Array<Piece | null>,
  currentPlayer: PlayerInfo,
  spellContext: {
    blockedSquares?: Set<number>;
    explosiveSquares?: Set<number>;
    explosiveOwners?: Map<number, Team>;
  },
) {
  return render(
    <Chessboard
      board={board}
      turn={currentPlayer.team}
      moveMaker="maker-1"
      currentPlayer={currentPlayer}
      onMove={() => {}}
      orientation={Team.White}
      selectedSquareProp={null}
      destinationSquareProp={null}
      pendingPromotionPieceProp={null}
      spellContext={spellContext}
    />,
  );
}

describe("Bouvet Hondao blocked-square consumer contract", () => {
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

  it("does not offer a blocked square as a legal destination", () => {
    // A White rook on a1 (square 0) with a2 (square 8) blocked by Bouvet
    // Hondao. The rook can still move along the first rank, but not onto the
    // blocked square.
    const board = boardWithKings();
    board[0] = piece("Rook" as PieceType, Team.White);

    const moves = getLegalMoves(board, 0, {
      spell: { blockedSquares: new Set<number>([8]) },
    });

    expect(moves).not.toContain(8);
    expect(moves).toContain(1);
  });

  it("does not let a sliding piece move through a blocked square", () => {
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

  it("keeps an explosive square as a legal destination", () => {
    // A Conu Bungno trap on a2 (square 8) destroys the landing piece rather
    // than forbidding the move, so the square stays legal.
    const board = boardWithKings();
    board[0] = piece("Rook" as PieceType, Team.White);

    const moves = getLegalMoves(board, 0, {
      spell: { explosiveSquares: new Set<number>([8]) },
    });

    expect(moves).toContain(8);
  });

  it("reveals the explosive 'X' only to the team that played the trap", () => {
    const explosiveSquares = new Set<number>([27]);
    const explosiveOwners = new Map<number, Team>([[27, Team.White]]);

    renderBoard(EMPTY_BOARD, WHITE_PLAYER, {
      explosiveSquares,
      explosiveOwners,
    });

    const square = screen.getByRole("button", { name: /Square d4/ });
    expect(square.querySelector(".sq-explosive")).toBeInTheDocument();
  });

  it("hides the explosive 'X' from the opponent", () => {
    const explosiveSquares = new Set<number>([27]);
    const explosiveOwners = new Map<number, Team>([[27, Team.White]]);

    renderBoard(EMPTY_BOARD, BLACK_PLAYER, {
      explosiveSquares,
      explosiveOwners,
    });

    const square = screen.getByRole("button", { name: /Square d4/ });
    expect(square.querySelector(".sq-explosive")).toBeNull();
  });

  it("renders no explosive marker when there is no spell context", () => {
    renderBoard(EMPTY_BOARD, WHITE_PLAYER, {});

    const square = screen.getByRole("button", { name: /Square d4/ });
    expect(square.querySelector(".sq-explosive")).toBeNull();
  });
});

/**
 * The `useSpellBoardState` mapping contract. The backend will begin populating
 * `blockedSquares` from a played Bouvet Hondao spell; the hook's job of
 * mapping that array into the `SpellContext` the board consumes must not
 * change.
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

describe("useSpellBoardState blocked-square mapping", () => {
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

  it("maps populated blocked squares from bigint to a Set<number>", async () => {
    getSpellBoardState.mockResolvedValue(
      view({ blockedSquares: [12n, 28n, 3n] }),
    );
    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("blocked")).toHaveTextContent("3,12,28");
    });
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

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("blocked")).toHaveTextContent("NONE");
    expect(screen.getByTestId("explosive")).toHaveTextContent("NONE");
    expect(screen.getByTestId("owners")).toHaveTextContent("NONE");
  });
});
