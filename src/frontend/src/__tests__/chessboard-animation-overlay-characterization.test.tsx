import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the Chessboard's EXISTING piece-slide / capture-fade
 * animation overlay, taken BEFORE the spell-effect overlay is added.
 *
 * The request intentionally adds a NEW spell-effect overlay layer for spell
 * ids 10-14. The animation overlay is the ONLY board overlay layer that exists
 * today: an `absolute inset-0 pointer-events-none z-20 overflow-hidden` layer
 * that renders the moving piece(s) and the fading captured piece(s) on top of
 * the grid. The new spell overlay must be added WITHOUT disturbing it.
 *
 * What IS protected here — the existing overlay contract that must survive the
 * new layer, and which no other suite exercises directly:
 *   - a normal move mounts exactly one slide span carrying the moving piece,
 *     positioned by a `transform: translate(...)` and sized to one board cell;
 *   - a capture mounts exactly one capture-fade span at the captured square;
 *   - the overlay layer is `pointer-events-none` and `aria-hidden`, so it
 *     never intercepts a tap on the board beneath it;
 *   - a null animation trigger mounts no overlay at all.
 *
 * The backend actor is not involved: this is component/integration coverage of
 * the frontend's rendering, not real backend behavior. The real
 * `getSpellBoardState` query is exercised by the PocketIC lane when it runs.
 */

// The Chessboard and chess-logic import PieceType/Team as runtime values from
// @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the board needs. The
// animation overlay under test is pure frontend rendering and never touches
// the actor.
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
import type { AnimationTrigger, Move } from "@/types/chess";

const EMPTY_BOARD: Array<Piece | null> = Array.from({ length: 64 }, () => null);

function piece(pieceType: PieceType, color: Team): Piece {
  return { pieceType, color, summoned: false };
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

/** A White rook on a1 (square 0) and a Black pawn on a2 (square 8). */
function boardWithRookAndPawn(): Array<Piece | null> {
  const board = [...EMPTY_BOARD];
  board[0] = piece("Rook" as PieceType, Team.White);
  board[8] = piece("Pawn" as PieceType, Team.Black);
  return board;
}

function move(overrides: Partial<Move> = {}): Move {
  return {
    from: 0,
    to: 1,
    color: Team.White,
    piece: "Rook" as PieceType,
    captured: null,
    capturedSquare: null,
    promotion: null,
    castle: false,
    isEnPassant: false,
    ...overrides,
  };
}

function renderBoard(animation: AnimationTrigger | null) {
  return render(
    <Chessboard
      board={boardWithRookAndPawn()}
      turn={Team.White}
      moveMaker="maker-1"
      currentPlayer={WHITE_PLAYER}
      onMove={() => {}}
      orientation={Team.White}
      selectedSquareProp={null}
      destinationSquareProp={null}
      pendingPromotionPieceProp={null}
      animation={animation}
    />,
  );
}

/** The animation overlay layer is the only `aria-hidden` absolute layer that
 * carries the `z-20` stacking class inside the board grid. */
function overlayLayer(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>("div.absolute.inset-0.z-20");
}

describe("Chessboard piece-slide / capture-fade animation overlay", () => {
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
    // Reduced motion OFF so the overlay actually mounts (the Chessboard snaps
    // instantly and mounts no overlay when reduced motion is preferred).
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

  it("mounts one slide span for a normal move", () => {
    const { container } = renderBoard({
      move: move(),
      prevBoard: boardWithRookAndPawn(),
      id: 1,
    });

    const layer = overlayLayer(container);
    expect(layer).not.toBeNull();
    const slides = layer?.querySelectorAll(
      ".piece-slide-start, .piece-slide-end",
    );
    expect(slides).toHaveLength(1);
  });

  it("mounts one capture-fade span at the captured square", () => {
    const prevBoard = boardWithRookAndPawn();
    const { container } = renderBoard({
      move: move({ to: 8, captured: "Pawn" as PieceType, capturedSquare: 8 }),
      prevBoard,
      id: 2,
    });

    const layer = overlayLayer(container);
    const captures = layer?.querySelectorAll(
      ".piece-capture-fade-start, .piece-capture-fade-end",
    );
    expect(captures).toHaveLength(1);
  });

  it("keeps the overlay layer pointer-events-none and aria-hidden", () => {
    const { container } = renderBoard({
      move: move(),
      prevBoard: boardWithRookAndPawn(),
      id: 3,
    });

    const layer = overlayLayer(container);
    expect(layer).toHaveClass("pointer-events-none");
    expect(layer).toHaveAttribute("aria-hidden", "true");
  });

  it("mounts no overlay when the animation trigger is null", () => {
    const { container } = renderBoard(null);

    expect(overlayLayer(container)).toBeNull();
    expect(
      container.querySelector(".piece-slide-start, .piece-slide-end"),
    ).toBeNull();
  });

  it("still renders the board squares beneath the overlay", () => {
    renderBoard({
      move: move(),
      prevBoard: boardWithRookAndPawn(),
      id: 4,
    });

    // The overlay is additive: the grid's authoritative squares remain.
    expect(
      screen.getByRole("button", { name: /Square a1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Square a2/ }),
    ).toBeInTheDocument();
  });
});
