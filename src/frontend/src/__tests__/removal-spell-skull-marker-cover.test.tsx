import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the per-square death-square skull marker overlay on the Chessboard.
 *
 * The accepted behavior:
 *   - a removal spell's burn-and-play result carries `removedSquares`, the board
 *     square index of every piece it removed;
 *   - the board shows a small skull marker image on each of those squares, IN
 *     ADDITION to the existing spell image overlay;
 *   - the spell image overlay lasts 4 seconds (was 2);
 *   - the per-square markers clear 6 seconds after the cast (outlasting the
 *     image);
 *   - a removal that removed no pieces shows the image but no markers.
 *
 * These are component/integration contracts driven by the `lastBurnAndPlay`
 * prop exactly as the game route supplies it. The backend actor is a typed
 * local mock, so this is frontend rendering coverage — not real backend
 * behavior. The real burn-and-play path is exercised by the PocketIC lane.
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

/** A minimal board with a single White rook on a1 so the grid renders. */
function boardWithRook(): Array<Piece | null> {
  const board = [...EMPTY_BOARD];
  board[0] = {
    pieceType: "Rook" as PieceType,
    color: Team.White,
    summoned: false,
  };
  return board;
}

/**
 * A fired removal-spell burn-and-play result carrying the given removed
 * squares. `removedSquares` is the field the request adds to the result.
 */
function removalResult(
  spellName: string,
  removedSquares: Array<bigint>,
  overrides: Partial<BurnAndPlayResult> = {},
): BurnAndPlayResult {
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
    removedSquares,
    insufficientMaterial: false,
    transformedSquares: [],
    ...overrides,
  };
}

function renderBoard(
  lastBurnAndPlay: BurnAndPlayResult | null,
  options: { orientation?: Team } = {},
) {
  return render(
    <Chessboard
      board={boardWithRook()}
      turn={Team.White}
      moveMaker="maker-1"
      currentPlayer={WHITE_PLAYER}
      onMove={() => {}}
      orientation={options.orientation ?? Team.White}
      selectedSquareProp={null}
      destinationSquareProp={null}
      pendingPromotionPieceProp={null}
      lastBurnAndPlay={lastBurnAndPlay}
    />,
  );
}

/** The spell-effect overlay is the only element carrying this marker. */
function spellOverlay(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-ocid="chess.spell_effect"]',
  );
}

/** All per-square skull markers currently rendered. */
function spellMarkers(container: HTMLElement): Array<HTMLElement> {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-ocid^="chess.spell_marker."]',
    ),
  );
}

/** Stub ResizeObserver so the board measures a deterministic 800px width
 * (100px per cell), which makes the marker geometry assertable. */
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

describe("Chessboard per-square death-square skull markers", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows a skull marker on each square a removal spell removed", () => {
    // Tia Lua removed pieces on d4 (27) and f6 (45).
    const { container } = renderBoard(removalResult("Tia Lua", [27n, 45n]));

    const markers = spellMarkers(container);
    expect(markers).toHaveLength(2);
    expect(
      container.querySelector('[data-ocid="chess.spell_marker.27"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="chess.spell_marker.45"]'),
    ).not.toBeNull();
    // Each marker carries the skull-marker class (the death-square image).
    for (const marker of markers) {
      expect(marker).toHaveClass("spell-marker");
    }
  });

  it("shows the spell image overlay in addition to the markers", () => {
    const { container } = renderBoard(removalResult("Tia Lua", [27n]));

    // Both layers are present: the spell image over b6-g3 AND the marker.
    expect(spellOverlay(container)).toHaveClass("spell-effect-10");
    expect(spellMarkers(container)).toHaveLength(1);
  });

  it("positions each marker over its own square from the board geometry", () => {
    // Board measured at 800px -> 100px per cell. Standard orientation:
    // square 27 (d4) is file 3, rank 3 -> col 3, row 7-3=4 -> (300px, 400px).
    const { container } = renderBoard(removalResult("Tia Lua", [27n]));

    const marker = container.querySelector<HTMLElement>(
      '[data-ocid="chess.spell_marker.27"]',
    );
    expect(marker).not.toBeNull();
    expect(marker).toHaveStyle({
      transform: "translate(300px, 400px)",
      width: "100px",
      height: "100px",
    });
  });

  it("mirrors the marker geometry when the board is flipped", () => {
    // Flipped: square 27 (d4) file 3, rank 3 -> col 7-3=4, row 3 -> (400px, 300px).
    const { container } = renderBoard(removalResult("Tia Lua", [27n]), {
      orientation: Team.Black,
    });

    const marker = container.querySelector<HTMLElement>(
      '[data-ocid="chess.spell_marker.27"]',
    );
    expect(marker).not.toBeNull();
    expect(marker).toHaveStyle({
      transform: "translate(400px, 300px)",
    });
  });

  it("shows the spell image but no markers when a removal removed nothing", () => {
    const { container } = renderBoard(removalResult("Tia Lua", []));

    expect(spellOverlay(container)).toHaveClass("spell-effect-10");
    expect(spellMarkers(container)).toHaveLength(0);
  });

  it("keeps the spell image for 4 seconds after the pre-roll and clears it at 7000ms", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(removalResult("Tia Lua", [27n]));

    // The 3s pre-roll plays first; the spell image is suppressed until it
    // completes, then its own 4s window starts.
    expect(spellOverlay(container)).toHaveClass(
      "spell-effect-overlay-suppressed",
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).not.toHaveClass(
      "spell-effect-overlay-suppressed",
    );
    // Still mounted just before the 4s spell window elapses.
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(spellOverlay(container)).not.toBeNull();
    // Gone exactly at 4000ms into the spell window (7000ms after the cast).
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(spellOverlay(container)).toBeNull();
  });

  it("keeps the markers for 6 seconds from the cast, independent of the spell image", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(removalResult("Tia Lua", [27n]));

    expect(spellMarkers(container)).toHaveLength(1);

    // The markers last 6s from the cast, so they are still present just
    // before 6s even though the 3s pre-roll is still running.
    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(spellMarkers(container)).toHaveLength(1);
    // ...and cleared exactly at 6000ms.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(spellMarkers(container)).toHaveLength(0);
  });

  it("keeps the markers mounted when the polled prop goes null mid-window", () => {
    vi.useFakeTimers();
    const result = removalResult("Tia Lua", [27n]);
    const { container, rerender } = renderBoard(result);

    expect(spellMarkers(container)).toHaveLength(1);

    // 1s in, the turn advances and the backend clears the result: the polled
    // prop goes null. The latched markers must survive.
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

    expect(spellMarkers(container)).toHaveLength(1);
    // The markers still clear on their own 6s schedule.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(spellMarkers(container)).toHaveLength(0);
  });

  it("replaces the latched markers when a genuinely new burn arrives", () => {
    vi.useFakeTimers();
    const first = removalResult("Tia Lua", [27n], { tokenId: 42n });
    const { container, rerender } = renderBoard(first);

    expect(
      container.querySelector('[data-ocid="chess.spell_marker.27"]'),
    ).not.toBeNull();

    // 1s in, a genuinely NEW burn arrives (different token id) removing a
    // different square. It must replace the latch.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const second = removalResult("Mua Lua", [45n], { tokenId: 99n });
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
        lastBurnAndPlay={second}
      />,
    );

    expect(
      container.querySelector('[data-ocid="chess.spell_marker.45"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="chess.spell_marker.27"]'),
    ).toBeNull();
  });

  it("does not restart the marker window when the same burn is re-polled", () => {
    vi.useFakeTimers();
    const result = removalResult("Tia Lua", [27n]);
    const { container, rerender } = renderBoard(result);

    expect(spellMarkers(container)).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // A re-poll delivers the same burn identity — the 6s window must not reset.
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
        lastBurnAndPlay={result}
      />,
    );
    // Advance past the original window; the re-poll must not have extended it.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(spellMarkers(container)).toHaveLength(0);
  });

  it("never intercepts clicks and stays aria-hidden while shown", () => {
    const { container } = renderBoard(removalResult("Tia Lua", [27n]));

    const marker = container.querySelector<HTMLElement>(
      '[data-ocid="chess.spell_marker.27"]',
    );
    expect(marker).not.toBeNull();
    expect(marker).toHaveAttribute("aria-hidden", "true");
    // The marker is a board-layer sibling, not nested inside a square button.
    expect(marker?.closest('[data-ocid^="chess.square."]')).toBeNull();
  });

  it("applies the marker fade class when motion is allowed and omits it under reduce-motion", () => {
    const { container } = renderBoard(removalResult("Tia Lua", [27n]));
    expect(spellMarkers(container)[0]).toHaveClass("spell-marker-fade");

    cleanup();
    stubMatchMedia(true);
    const { container: reduced } = renderBoard(removalResult("Tia Lua", [27n]));
    const marker = spellMarkers(reduced)[0];
    expect(marker).not.toBeUndefined();
    expect(marker).not.toHaveClass("spell-marker-fade");
  });
});

/**
 * Characterization of the skull-marker path ADJACENT to the Newkai Dodan
 * change, taken BEFORE that change lands.
 *
 * The request adds a `transformedSquares` list to the burn-and-play result and
 * gives each square in it the summoned-piece glow, alongside the existing
 * `removedSquares` skull markers. That new list is the intentional change, so
 * it is deliberately NOT referenced here.
 *
 * What IS protected is the existing `removedSquares` marker contract the new
 * list must not disturb, because both are per-square overlays driven by the
 * same `lastBurnAndPlay` prop:
 *   - a fired cast whose `removedSquares` is empty still shows the spell image
 *     overlay and renders NO per-square markers;
 *   - a fired cast with `removedSquares` renders exactly one marker per listed
 *     square, and each marker is a skull marker (never a summoned-glow marker);
 *   - the marker overlay is the only per-square overlay layer, so a new
 *     transformed-squares layer cannot silently replace it.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering — not real backend behavior. The real
 * Newkai Dodan cast path is exercised by the PocketIC lane when it runs. See
 * episode.coverageLimits.
 */
describe("Chessboard skull markers adjacent to the Newkai Dodan change", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows the spell image and no markers when removedSquares is empty", () => {
    const { container } = renderBoard(removalResult("Tia Lua", []));

    expect(spellOverlay(container)).not.toBeNull();
    expect(spellMarkers(container)).toHaveLength(0);
  });

  it("renders exactly one skull marker per removed square", () => {
    const { container } = renderBoard(removalResult("Tia Lua", [27n, 45n]));

    const markers = spellMarkers(container);
    expect(markers).toHaveLength(2);
    for (const marker of markers) {
      // Each per-square overlay is a skull marker, not a summoned-glow marker.
      expect(marker).toHaveClass("spell-marker");
      expect(marker).not.toHaveClass("piece-glow-summoned");
    }
  });

  it("keeps the skull-marker overlay as the only per-square marker layer", () => {
    const { container } = renderBoard(removalResult("Tia Lua", [27n]));

    // The only elements carrying a `chess.spell_marker.` ocid are the skull
    // markers; a transformed-squares layer must not reuse that marker.
    const markerOcids = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-ocid^="chess.spell_marker."]',
      ),
    );
    expect(markerOcids).toHaveLength(1);
    expect(markerOcids[0]).toHaveClass("spell-marker");
  });
});
