import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the Chessboard's SINGLE-PIECE render seam, taken BEFORE
 * the summoned-piece glow is added.
 *
 * The request gives a piece placed by a summon spell a permanent yellow
 * drop-shadow glow, distinguishing it from every other piece. The intentional
 * change adds a `summoned` marker to the piece record and a yellow
 * drop-shadow class to the single-piece render in Chessboard.tsx.
 *
 * What IS protected here — the adjacent behavior that must survive the change:
 *   - an ordinary (non-summoned) piece still renders with exactly its
 *     color-based glow class (`piece-glow-white` / `piece-glow-black`) and
 *     carries no summoned/yellow marker;
 *   - two pieces of the SAME type on the board each render with their own
 *     color glow, so a marker on one piece never bleeds onto another;
 *   - the glow class is attached to the piece's own square, so it follows the
 *     piece when the board changes (the piece moves) rather than staying on a
 *     fixed square.
 *
 * The backend actor is not involved: this is component/integration coverage of
 * the frontend's rendering, not real backend behavior. The real summon path is
 * exercised by the PocketIC lane when it runs. See episode.coverageLimits.
 */

// The Chessboard imports PieceType/Team as runtime values from @/backend, which
// transitively pulls in @caffeineai/object-storage and @caffeineai/core-
// infrastructure. Those packages fail to resolve their own submodules in the
// jsdom test environment (a pre-existing dependency issue), so mock the backend
// module with the enum values the board needs. The render under test is pure
// frontend rendering and never touches the actor.
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
// submodules in jsdom. The board rendering under test never calls the actor.
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

const EMPTY_BOARD: Array<Piece | null> = Array.from({ length: 64 }, () => null);

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

function piece(pieceType: PieceType, color: Team): Piece {
  return { pieceType, color, summoned: false };
}

function renderBoard(board: Array<Piece | null>) {
  return render(
    <Chessboard
      board={board}
      turn={Team.White}
      moveMaker="maker-1"
      currentPlayer={WHITE_PLAYER}
      onMove={() => {}}
      orientation={Team.White}
      selectedSquareProp={null}
      destinationSquareProp={null}
      pendingPromotionPieceProp={null}
    />,
  );
}

/** The single-piece wrapper span inside a square button. It is the only
 * element carrying a `piece-glow-*` class inside the grid. */
function pieceGlowSpan(square: number): HTMLElement | null {
  const button = screen.getByRole("button", {
    name: new RegExp(`Square ${squareToName(square)}`),
  });
  return button.querySelector<HTMLElement>(
    ".piece-glow-white, .piece-glow-black",
  );
}

const FILE_LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];

function squareToName(square: number): string {
  return `${FILE_LETTERS[square % 8]}${Math.floor(square / 8) + 1}`;
}

describe("Chessboard single-piece glow (pre-summon baseline)", () => {
  beforeEach(() => {
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

  it("renders an ordinary White piece with only its color glow class", () => {
    const board = [...EMPTY_BOARD];
    board[0] = piece("Rook" as PieceType, Team.White); // a1

    renderBoard(board);

    const glow = pieceGlowSpan(0);
    expect(glow).not.toBeNull();
    expect(glow).toHaveClass("piece-glow-white");
    expect(glow).not.toHaveClass("piece-glow-black");
  });

  it("renders an ordinary Black piece with only its color glow class", () => {
    const board = [...EMPTY_BOARD];
    board[60] = piece("King" as PieceType, Team.Black); // e8

    renderBoard(board);

    const glow = pieceGlowSpan(60);
    expect(glow).not.toBeNull();
    expect(glow).toHaveClass("piece-glow-black");
    expect(glow).not.toHaveClass("piece-glow-white");
  });

  it("gives two pieces of the same type their own color glow, with no bleed", () => {
    // Two rooks of the same type, one per color. A marker on one must never
    // appear on the other.
    const board = [...EMPTY_BOARD];
    board[0] = piece("Rook" as PieceType, Team.White); // a1
    board[7] = piece("Rook" as PieceType, Team.Black); // h1

    renderBoard(board);

    const whiteGlow = pieceGlowSpan(0);
    const blackGlow = pieceGlowSpan(7);
    expect(whiteGlow).toHaveClass("piece-glow-white");
    expect(whiteGlow).not.toHaveClass("piece-glow-black");
    expect(blackGlow).toHaveClass("piece-glow-black");
    expect(blackGlow).not.toHaveClass("piece-glow-white");
  });

  it("renders a promoted piece with only its color glow, never a summoned marker", () => {
    // A promoted piece is an ordinary piece: a White Queen that arrived via
    // promotion must render with exactly its color glow class and no
    // summoned/yellow marker, even though a summon spell may have been cast
    // earlier in the game.
    const board = [...EMPTY_BOARD];
    board[56] = piece("Queen" as PieceType, Team.White); // a8, promoted pawn

    renderBoard(board);

    const glow = pieceGlowSpan(56);
    expect(glow).not.toBeNull();
    expect(glow).toHaveClass("piece-glow-white");
    expect(glow).not.toHaveClass("piece-glow-black");
  });

  it("attaches the glow to the piece's own square as the board changes", () => {
    // The same White rook first on a1, then on a4. The glow must follow the
    // piece to its new square and leave the old square empty.
    const before = [...EMPTY_BOARD];
    before[0] = piece("Rook" as PieceType, Team.White); // a1
    const first = renderBoard(before);
    expect(pieceGlowSpan(0)).toHaveClass("piece-glow-white");
    first.unmount();

    const after = [...EMPTY_BOARD];
    after[24] = piece("Rook" as PieceType, Team.White); // a4
    renderBoard(after);
    expect(pieceGlowSpan(24)).toHaveClass("piece-glow-white");
    // The origin square no longer holds a piece, so it has no glow span.
    expect(pieceGlowSpan(0)).toBeNull();
  });
});
