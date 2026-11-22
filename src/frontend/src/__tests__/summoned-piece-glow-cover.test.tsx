import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the summoned-piece glow.
 *
 * The accepted request gives a piece placed by a summon spell (Thayma, Hipsy
 * Titam, Lazarus, Cuoclot Sac Wonmuc Rook, Anne Boleyn) a permanent yellow
 * drop-shadow glow, distinguishing it from every other piece. The backend
 * marks such a piece with `summoned = true`; the Chessboard's single-piece
 * render adds `piece-glow-summoned` when that marker is set.
 *
 * What this file covers, through the real Chessboard component:
 *   - a summoned piece renders with the yellow `piece-glow-summoned` class in
 *     addition to its color glow;
 *   - an ordinary piece of the SAME type does not glow, so the marker never
 *     bleeds onto a sibling;
 *   - the glow lives on the piece's own square span, so it follows the piece
 *     when the board changes (the piece moves) and leaves the old square;
 *   - a captured summoned piece (absent from the board) leaves no glow;
 *   - a promoted piece (summoned = false) never glows, even though a summon
 *     spell may have been cast earlier in the game;
 *   - a fresh game board (all pieces summoned = false) has no glow anywhere.
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

function piece(pieceType: PieceType, color: Team, summoned = false): Piece {
  return { pieceType, color, summoned };
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

const FILE_LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];

function squareToName(square: number): string {
  return `${FILE_LETTERS[square % 8]}${Math.floor(square / 8) + 1}`;
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

/** Every element in the rendered board carrying the summoned glow class. */
function summonedGlowSpans(): HTMLElement[] {
  const board = document.querySelector<HTMLElement>(
    '[data-ocid="chess.board"]',
  );
  if (!board) return [];
  return Array.from(
    board.querySelectorAll<HTMLElement>(".piece-glow-summoned"),
  );
}

describe("Chessboard summoned-piece glow", () => {
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

  it("renders a summoned piece with the yellow glow on its own square", () => {
    const board = [...EMPTY_BOARD];
    board[24] = piece("Rook" as PieceType, Team.White, true); // a4

    renderBoard(board);

    const glow = pieceGlowSpan(24);
    expect(glow).not.toBeNull();
    expect(glow).toHaveClass("piece-glow-summoned");
    // The color glow is still present alongside the summoned marker.
    expect(glow).toHaveClass("piece-glow-white");
  });

  it("does not glow an ordinary piece of the same type as a summoned one", () => {
    const board = [...EMPTY_BOARD];
    board[24] = piece("Rook" as PieceType, Team.White, true); // a4 summoned
    board[25] = piece("Rook" as PieceType, Team.White, false); // b4 ordinary

    renderBoard(board);

    expect(pieceGlowSpan(24)).toHaveClass("piece-glow-summoned");
    expect(pieceGlowSpan(25)).not.toHaveClass("piece-glow-summoned");
    // Exactly one summoned glow on the board.
    expect(summonedGlowSpans()).toHaveLength(1);
  });

  it("moves the glow with the piece and leaves the old square", () => {
    const before = [...EMPTY_BOARD];
    before[24] = piece("Rook" as PieceType, Team.White, true); // a4
    const first = renderBoard(before);
    expect(pieceGlowSpan(24)).toHaveClass("piece-glow-summoned");
    first.unmount();

    const after = [...EMPTY_BOARD];
    after[32] = piece("Rook" as PieceType, Team.White, true); // a5
    renderBoard(after);
    expect(pieceGlowSpan(32)).toHaveClass("piece-glow-summoned");
    // The origin square no longer holds a piece, so it has no glow span.
    expect(pieceGlowSpan(24)).toBeNull();
    expect(summonedGlowSpans()).toHaveLength(1);
  });

  it("removes the glow when the summoned piece is captured", () => {
    // Before the capture the summoned rook sits on a4 and glows.
    const before = [...EMPTY_BOARD];
    before[24] = piece("Rook" as PieceType, Team.White, true); // a4 summoned
    const first = renderBoard(before);
    expect(pieceGlowSpan(24)).toHaveClass("piece-glow-summoned");
    first.unmount();

    // After the capture the rook is gone from the board and the capturing
    // black queen occupies a4. No summoned glow remains anywhere.
    const after = [...EMPTY_BOARD];
    after[24] = piece("Queen" as PieceType, Team.Black, false); // a4 capturer
    renderBoard(after);

    expect(pieceGlowSpan(24)).not.toHaveClass("piece-glow-summoned");
    expect(summonedGlowSpans()).toHaveLength(0);
  });

  it("never glows a promoted piece even after a summon was cast", () => {
    // A promoted piece is an ordinary piece: a White Queen that arrived via
    // promotion carries summoned = false and must not glow, even though a
    // summon spell may have been cast earlier in the game.
    const board = [...EMPTY_BOARD];
    board[56] = piece("Queen" as PieceType, Team.White, false); // a8 promoted

    renderBoard(board);

    const glow = pieceGlowSpan(56);
    expect(glow).not.toBeNull();
    expect(glow).not.toHaveClass("piece-glow-summoned");
    expect(summonedGlowSpans()).toHaveLength(0);
  });

  /**
   * Characterization of the summoned-glow seam ADJACENT to the Newkai Dodan
   * change, taken BEFORE the production edit.
   *
   * The request gives each knight that replaced an enemy queen the summoned
   * glow, driven by a new `transformedSquares` list on the burn-and-play
   * result. That new path is deliberately NOT asserted here. What IS protected
   * is the existing glow contract the new path must not disturb: the glow is
   * driven solely by the piece's own `summoned` flag on the board, so a piece
   * with `summoned = true` glows and a piece with `summoned = false` does not,
   * regardless of any burn result the board is handed.
   */
  it("drives the glow from the piece's own summoned flag, not a burn result", () => {
    const board = [...EMPTY_BOARD];
    board[24] = piece("Knight" as PieceType, Team.Black, true); // a4 summoned
    board[25] = piece("Knight" as PieceType, Team.Black, false); // b4 ordinary

    renderBoard(board);

    expect(pieceGlowSpan(24)).toHaveClass("piece-glow-summoned");
    expect(pieceGlowSpan(25)).not.toHaveClass("piece-glow-summoned");
    expect(summonedGlowSpans()).toHaveLength(1);
  });

  it("shows no glow anywhere on a fresh game board", () => {
    // The standard starting position: every piece summoned = false.
    const board = [...EMPTY_BOARD];
    const backRank: PieceType[] = [
      "Rook",
      "Knight",
      "Bishop",
      "Queen",
      "King",
      "Bishop",
      "Knight",
      "Rook",
    ] as PieceType[];
    for (let file = 0; file < 8; file += 1) {
      board[file] = piece(backRank[file], Team.White, false);
      board[8 + file] = piece("Pawn" as PieceType, Team.White, false);
      board[48 + file] = piece("Pawn" as PieceType, Team.Black, false);
      board[56 + file] = piece(backRank[file], Team.Black, false);
    }

    renderBoard(board);

    expect(summonedGlowSpans()).toHaveLength(0);
  });
});

/**
 * Cover for the Newkai Dodan transformed-knight summoned glow.
 *
 * The accepted request turns every enemy queen into an enemy knight on the
 * same square, reporting those squares in the burn-and-play result's
 * `transformedSquares` list. The Chessboard paints the SAME yellow summoned
 * glow on each of those squares for the spell's window, so a freshly
 * transformed knight reads as a summoned piece even before the next board poll
 * carries its `summoned` marker.
 *
 * What this file covers, through the real Chessboard component:
 *   - a burn result carrying `transformedSquares` renders one
 *     `spell-transformed-glow` overlay per listed square, positioned over that
 *     square from the board geometry;
 *   - a burn result with an empty `transformedSquares` renders no glow;
 *   - the glow is a per-square overlay layer, distinct from the skull markers
 *     and from the piece's own `piece-glow-summoned` wrapper;
 *   - the glow clears 6 seconds after the cast, matching the skull markers;
 *   - the glow survives the polled prop going null mid-window (latched).
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering — not real backend behavior. The real
 * Newkai Dodan cast path is exercised by the PocketIC lane when it runs. See
 * episode.coverageLimits.
 */

/** A fired Newkai Dodan burn-and-play result carrying transformed squares. */
function newkaiResult(
  transformedSquares: Array<bigint>,
  overrides: Partial<BurnAndPlayResult> = {},
): BurnAndPlayResult {
  return {
    tokenId: 42n,
    spellName: "Newkai Dodan",
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
    transformedSquares,
    insufficientMaterial: false,
    ...overrides,
  };
}

/** A minimal board with a single White rook on a1 so the grid renders. */
function boardWithRook(): Array<Piece | null> {
  const board = [...EMPTY_BOARD];
  board[0] = piece("Rook" as PieceType, Team.White, false);
  return board;
}

function renderBoardWithBurn(lastBurnAndPlay: BurnAndPlayResult | null) {
  return render(
    <Chessboard
      board={boardWithRook()}
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

/** All per-square transformed-knight glow overlays currently rendered. */
function transformedGlowSpans(container: HTMLElement): Array<HTMLElement> {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-ocid^="chess.spell_transformed."]',
    ),
  );
}

describe("Chessboard Newkai Dodan transformed-knight glow", () => {
  beforeEach(() => {
    // Measure the board at a deterministic 800px (100px per cell) so the
    // per-square glow geometry is assertable.
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
            value: 800,
          });
          this.cb([], this as unknown as ResizeObserver);
        }
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
    vi.useRealTimers();
  });

  it("renders one summoned glow per transformed square", () => {
    // Newkai Dodan transformed queens on d4 (27) and f6 (45).
    const { container } = renderBoardWithBurn(newkaiResult([27n, 45n]));

    const glows = transformedGlowSpans(container);
    expect(glows).toHaveLength(2);
    expect(
      container.querySelector('[data-ocid="chess.spell_transformed.27"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="chess.spell_transformed.45"]'),
    ).not.toBeNull();
    for (const glow of glows) {
      expect(glow).toHaveClass("spell-transformed-glow");
    }
  });

  it("positions each glow over its own square from the board geometry", () => {
    // Board measured at 800px -> 100px per cell. Standard orientation:
    // square 27 (d4) is file 3, rank 3 -> col 3, row 7-3=4 -> (300px, 400px).
    const { container } = renderBoardWithBurn(newkaiResult([27n]));

    const glow = container.querySelector<HTMLElement>(
      '[data-ocid="chess.spell_transformed.27"]',
    );
    expect(glow).not.toBeNull();
    expect(glow).toHaveStyle({
      transform: "translate(300px, 400px)",
      width: "100px",
      height: "100px",
    });
  });

  it("renders no glow when the cast transformed no queens", () => {
    const { container } = renderBoardWithBurn(newkaiResult([]));

    expect(transformedGlowSpans(container)).toHaveLength(0);
  });

  it("keeps the transformed glow distinct from the skull markers", () => {
    // A cast that both destroyed and transformed queens: the destroyed square
    // gets a skull marker, the transformed square gets the summoned glow.
    const { container } = renderBoardWithBurn(
      newkaiResult([45n], { removedSquares: [27n] }),
    );

    const glow = container.querySelector<HTMLElement>(
      '[data-ocid="chess.spell_transformed.45"]',
    );
    expect(glow).not.toBeNull();
    expect(glow).toHaveClass("spell-transformed-glow");
    expect(glow).not.toHaveClass("spell-marker");

    const marker = container.querySelector<HTMLElement>(
      '[data-ocid="chess.spell_marker.27"]',
    );
    expect(marker).not.toBeNull();
    expect(marker).toHaveClass("spell-marker");
    expect(marker).not.toHaveClass("spell-transformed-glow");
  });

  it("clears the transformed glow 6 seconds after the cast", () => {
    vi.useFakeTimers();
    const { container } = renderBoardWithBurn(newkaiResult([27n]));

    expect(transformedGlowSpans(container)).toHaveLength(1);

    // Still present just before 6s...
    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(transformedGlowSpans(container)).toHaveLength(1);
    // ...and cleared exactly at 6000ms.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(transformedGlowSpans(container)).toHaveLength(0);
  });

  it("keeps the transformed glow mounted when the polled prop goes null mid-window", () => {
    vi.useFakeTimers();
    const result = newkaiResult([27n]);
    const { container, rerender } = renderBoardWithBurn(result);

    expect(transformedGlowSpans(container)).toHaveLength(1);

    // 1s in, the turn advances and the backend clears the result: the polled
    // prop goes null. The latched glow must survive.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    rerender(
      <Chessboard
        board={boardWithRook()}
        turn={Team.White}
        moveMaker="maker-1"
        currentPlayer={WHITE_PLAYER}
        onMove={() => {}}
        orientation={Team.White}
        selectedSquareProp={null}
        destinationSquareProp={null}
        pendingPromotionPieceProp={null}
        lastBurnAndPlay={null}
      />,
    );

    expect(transformedGlowSpans(container)).toHaveLength(1);
    // The glow still clears on its own 6s schedule.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(transformedGlowSpans(container)).toHaveLength(0);
  });
});

/**
 * Characterization of the transformed-glow rendering ADJACENT to the
 * insufficient-material correction, taken BEFORE that correction lands.
 *
 * The request corrects WHEN the backend fires the insufficient-material draw
 * for a Newkai Dodan cast: only when the resulting board is genuinely
 * insufficient material, and never when the spell had no board effect. That
 * decision is a BACKEND value on the burn-and-play result's
 * `insufficientMaterial` field; the frontend does not read it. The correction
 * is the intentional change, so the field's VALUE is deliberately NOT asserted
 * here.
 *
 * What IS protected is the frontend rendering contract the correction must not
 * disturb: the per-square transformed glow and the skull markers are driven
 * ONLY by `transformedSquares` and `removedSquares`, never by
 * `insufficientMaterial`. A cast that both transformed and destroyed queens
 * must render the same two overlay layers whether the backend reports the
 * resulting board as insufficient material or not — otherwise a backend-only
 * correction would silently change what the board paints.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering — not real backend behavior. The real
 * spell-path draw decision is exercised by the PocketIC lane when it runs. See
 * episode.coverageLimits.
 */
describe("Chessboard transformed glow is independent of the insufficient-material flag", () => {
  beforeEach(() => {
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
            value: 800,
          });
          this.cb([], this as unknown as ResizeObserver);
        }
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
    vi.useRealTimers();
  });

  it("renders the same glow and skull layers whether the draw fired or not", () => {
    // A cast that transformed d4 (27) and destroyed f6 (45). The backend's
    // insufficient-material verdict differs between the two renders; the
    // frontend's overlay layers must not.
    const drawFired = renderBoardWithBurn(
      newkaiResult([27n], {
        removedSquares: [45n],
        insufficientMaterial: true,
      }),
    );
    const drawNotFired = renderBoardWithBurn(
      newkaiResult([27n], {
        removedSquares: [45n],
        insufficientMaterial: false,
      }),
    );

    for (const { container } of [drawFired, drawNotFired]) {
      expect(transformedGlowSpans(container)).toHaveLength(1);
      expect(
        container.querySelector('[data-ocid="chess.spell_transformed.27"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-ocid="chess.spell_marker.45"]'),
      ).not.toBeNull();
    }
  });

  it("renders no glow when the cast transformed nothing, regardless of the flag", () => {
    // A Newkai Dodan cast with no enemy queen has no board effect: the backend
    // must not fire the draw, and the frontend must paint no glow either way.
    const { container } = renderBoardWithBurn(
      newkaiResult([], { insufficientMaterial: true }),
    );

    expect(transformedGlowSpans(container)).toHaveLength(0);
  });
});
