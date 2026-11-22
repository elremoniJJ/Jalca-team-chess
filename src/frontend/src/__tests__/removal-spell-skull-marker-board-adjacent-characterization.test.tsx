import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the BOARD-RENDERING behavior ADJACENT to the per-square
 * death-square skull marker change, taken BEFORE the production edit.
 *
 * The request adds a small skull marker image on each chess square where a
 * removal spell removed a piece, IN ADDITION to the existing spell image
 * overlay, and extends the overlay duration from 2s to 4s. It also adds a
 * removed-squares field to the burn-and-play result.
 *
 * None of those new things is asserted here. What IS protected is the
 * surrounding board rendering the marker addition must not disturb:
 *   - the board still renders every square as a labelled button, and a piece
 *     on a square still renders its glyph (the marker is an ADDITION, not a
 *     replacement for the piece or the square);
 *   - the spell-effect overlay is still the ONLY element carrying the
 *     `chess.spell_effect` marker, so a marker implementation that reused that
 *     marker would be caught;
 *   - the overlay still renders as a sibling of the square buttons inside the
 *     board grid, so it stays a board-layer element rather than a per-square
 *     child;
 *   - a fired removal spell still shows its overlay while the board's own
 *     pieces remain rendered underneath it.
 *
 * The duration is deliberately NOT pinned (the request changes it 2s -> 4s),
 * and the removed-squares field is deliberately NOT referenced (it does not
 * exist yet). The backend actor is a typed local mock, so this is
 * component/integration coverage of the frontend's rendering — not real
 * backend behavior.
 */

// The Chessboard imports enum values from @/backend at runtime, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the component needs.
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
  SpellKind: {
    Balls: "Balls",
    Major: "Major",
    Minor: "Minor",
    SubaoVe: "SubaoVe",
  },
  SpellResolutionOutcome: {
    fired: "fired",
    cancelled: "cancelled",
    legacy: "legacy",
  },
}));

// AdvicePopup -> lib/backend-actor imports createActorWithConfig from
// @caffeineai/core-infrastructure, which also fails to resolve its own
// submodules in jsdom. The board rendering under test never calls the actor.
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
}));

import {
  type BurnAndPlayResult,
  type Piece,
  type PieceType,
  type PlayerInfo,
  SpellKind,
  SpellResolutionOutcome,
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

/** A board with a White rook on a1 and a Black rook on h8. */
function boardWithTwoRooks(): Array<Piece | null> {
  const board = [...EMPTY_BOARD];
  board[0] = {
    pieceType: "Rook" as PieceType,
    color: Team.White,
    summoned: false,
  };
  board[63] = {
    pieceType: "Rook" as PieceType,
    color: Team.Black,
    summoned: false,
  };
  return board;
}

/** A fired burn-and-play result for the given spell name. */
function firedResult(spellName: string): BurnAndPlayResult {
  return {
    tokenId: 42n,
    spellName,
    gameNumber: 7n,
    team: Team.White,
    kind: SpellKind.Major,
    resolution: {
      attacker: Team.White,
      defender: Team.Black,
      spellValue: 5n,
      shieldBefore: 0n,
      shieldAfter: 0n,
      outcome: SpellResolutionOutcome.fired,
      firesOnBoard: true,
    },
    removedSquares: [],
    insufficientMaterial: false,
    transformedSquares: [],
  };
}

function renderBoard(lastBurnAndPlay: BurnAndPlayResult | null) {
  return render(
    <Chessboard
      board={boardWithTwoRooks()}
      turn={Team.White}
      moveMaker="maker-1"
      currentPlayer={WHITE_PLAYER}
      onMove={() => {}}
      orientation={Team.White}
      selectedSquareProp={null}
      destinationSquareProp={null}
      pendingPromotionPieceProp={null}
      lastBurnAndPlay={lastBurnAndPlay}
    />,
  );
}

/** Stub ResizeObserver so the board measures a deterministic 800px width. */
function stubResizeObserver(width: number) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(el: Element) {
        Object.defineProperty(el, "clientWidth", {
          configurable: true,
          value: width,
        });
        this.cb([], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    },
  );
}

function stubMatchMedia(reducedMotion: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: reducedMotion,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  );
}

describe("Chessboard board rendering (skull-marker adjacent characterization)", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("still renders all 64 squares as labelled buttons", () => {
    const { container } = renderBoard(null);

    const squares = container.querySelectorAll('[data-ocid^="chess.square."]');
    expect(squares).toHaveLength(64);
    // Every square is a button with an accessible label.
    for (const square of Array.from(squares)) {
      expect(square.tagName).toBe("BUTTON");
      expect(square.getAttribute("aria-label")).toMatch(/^Square /);
    }
  });

  it("still renders a piece glyph on each occupied square", () => {
    const { container } = renderBoard(null);

    // The two rooks are still rendered: their squares carry the piece label.
    const a1 = container.querySelector('[data-ocid="chess.square.0"]');
    const h8 = container.querySelector('[data-ocid="chess.square.63"]');
    expect(a1?.getAttribute("aria-label")).toContain("White Rook");
    expect(h8?.getAttribute("aria-label")).toContain("Black Rook");

    // The piece glyph is an SVG inside the square, not replaced by anything.
    expect(a1?.querySelector("svg")).not.toBeNull();
    expect(h8?.querySelector("svg")).not.toBeNull();
  });

  it("still renders the spell overlay as the sole chess.spell_effect element", () => {
    const { container } = renderBoard(firedResult("Tia Lua"));

    const overlays = container.querySelectorAll(
      '[data-ocid="chess.spell_effect"]',
    );
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toHaveClass("spell-effect-overlay");
  });

  it("still renders the overlay as a board-layer sibling, not a square child", () => {
    const { container } = renderBoard(firedResult("Tia Lua"));

    const overlay = container.querySelector('[data-ocid="chess.spell_effect"]');
    expect(overlay).not.toBeNull();
    // The overlay is not nested inside any square button.
    expect(overlay?.closest('[data-ocid^="chess.square."]')).toBeNull();
  });

  it("still shows the overlay while the board's own pieces remain rendered", () => {
    const { container } = renderBoard(firedResult("Tia Lua"));

    // The overlay is present...
    expect(
      container.querySelector('[data-ocid="chess.spell_effect"]'),
    ).not.toBeNull();
    // ...and the pieces underneath are still rendered (the overlay is an
    // addition, not a replacement).
    const a1 = container.querySelector('[data-ocid="chess.square.0"]');
    expect(a1?.querySelector("svg")).not.toBeNull();
  });
});
