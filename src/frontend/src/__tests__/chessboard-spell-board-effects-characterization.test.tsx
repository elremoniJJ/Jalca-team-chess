import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
 * Characterization of the frontend SPELL BOARD EFFECTS consumer seam, taken
 * BEFORE the Bouvet Hondao / Conu Bungno board effects are wired end-to-end.
 *
 * The request makes two spells affect the board: Bouvet Hondao blocks one
 * random empty square (no piece may land on or move through it), and Conu
 * Bungno places a single-use explosive trap on one random empty square (the
 * placing team sees an 'X'; the opponent does not; the first non-King piece to
 * land is destroyed and the trap clears). The backend owns which squares are
 * affected; the frontend's only board-effect input is the `SpellContext`
 * threaded into the Chessboard and `getLegalMoves`.
 *
 * What IS protected here — the consumer contract that must survive the
 * backend wiring, and which no other suite exercises directly:
 *   - a blocked square is not offered as a legal destination, and a sliding
 *     piece cannot move THROUGH it to squares beyond;
 *   - an explosive square is revealed as an 'X' only to the team that played
 *     the trap, and hidden from the opponent;
 *   - an explosive square remains a legal destination (the trap destroys the
 *     landing piece rather than forbidding the move).
 *
 * The backend actor is not involved: this is component/integration coverage of
 * the frontend's rendering and move derivation, not real backend behavior. The
 * real `getSpellBoardState` query is exercised by the PocketIC lane when it
 * runs.
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

describe("chessboard spell board effects", () => {
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

  it("reveals an explosive 'X' only to the team that played the trap", () => {
    // Square 27 (d4) holds a trap played by White.
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
    // The same White-owned trap is invisible to a Black viewer.
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

  it("does not offer a blocked square as a legal destination", () => {
    // A White rook on a1 (square 0). Square 8 (a2) is blocked by Bouvet
    // Hondao, so it must not appear among the rook's legal destinations.
    const board = boardWithKings();
    board[0] = piece("Rook" as PieceType, Team.White);

    const moves = getLegalMoves(board, 0, {
      spell: { blockedSquares: new Set<number>([8]) },
    });

    expect(moves).not.toContain(8);
    // The rook can still move along the first rank.
    expect(moves).toContain(1);
  });

  it("does not let a sliding piece move through a blocked square", () => {
    // A White rook on a1 (square 0) with a2 (square 8) blocked: the rook must
    // not reach a3 (square 16) or any square beyond the block on that file.
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
    // A White rook on a1 (square 0) with a2 (square 8) holding a Conu Bungno
    // trap: the trap destroys the landing piece, so the square stays legal.
    const board = boardWithKings();
    board[0] = piece("Rook" as PieceType, Team.White);

    const moves = getLegalMoves(board, 0, {
      spell: { explosiveSquares: new Set<number>([8]) },
    });

    expect(moves).toContain(8);
  });
});
