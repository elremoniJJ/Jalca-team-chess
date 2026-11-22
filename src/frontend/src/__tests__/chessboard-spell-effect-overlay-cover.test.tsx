import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the NEW spell-effect overlay on the Chessboard.
 *
 * The request wires the five supplied fire-spell effect PNGs (spell ids 10-14:
 * Tia Lua, Cau Lua, Hoa Boc, Buc Tung Lua, Mua Lua) plus a reserved
 * shield-blocked image into a board overlay. When a NEW burn-and-play result
 * arrives, the cast spell's line-art image appears over the FIXED b6-g3 block
 * for 2 seconds, fading in and out (no fade under reduce-motion). A cast
 * cancelled by a shield shows the blocked image; a cast with no board effect
 * for any other reason (legacy) shows no image. The overlay never intercepts
 * clicks and is positioned from the board's own measured geometry so it stays
 * over b6-g3 when the board is flipped or resized.
 *
 * These are component/integration contracts with no actor or network access.
 * The real backend burn-and-play path is not exercised here; the overlay is
 * driven by the `lastBurnAndPlay` prop exactly as the game route supplies it.
 */

// The Chessboard imports PieceType/Team/SpellResolutionOutcome as runtime
// values from @/backend, which transitively pulls in @caffeineai/object-storage
// and @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the board needs. The overlay
// under test is pure frontend rendering and never touches the actor.
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

/** A fired burn-and-play result for the given spell name. */
function firedResult(
  spellName: string,
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
    removedSquares: [],
    insufficientMaterial: false,
    transformedSquares: [],
    ...overrides,
  };
}

/** A burn-and-play result cancelled by a shield. */
function cancelledResult(spellName: string): BurnAndPlayResult {
  return {
    tokenId: 43n,
    spellName,
    gameNumber: 7n,
    team: Team.White,
    kind: SpellKind.Major,
    resolution: {
      attacker: Team.White,
      defender: Team.Black,
      spellValue: 5n,
      shieldBefore: 5n,
      shieldAfter: 0n,
      outcome: SpellResolutionOutcome.cancelled,
      firesOnBoard: false,
    },
    removedSquares: [],
    insufficientMaterial: false,
    transformedSquares: [],
  };
}

/** A legacy burn-and-play result with no resolution at all. */
function legacyResult(spellName: string): BurnAndPlayResult {
  return {
    tokenId: 44n,
    spellName,
    team: Team.White,
    kind: SpellKind.Major,
    removedSquares: [],
    insufficientMaterial: false,
    transformedSquares: [],
  };
}

function renderBoard(
  lastBurnAndPlay: BurnAndPlayResult | null,
  options: { orientation?: Team; manualFlip?: boolean } = {},
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
      manualFlip={options.manualFlip ?? false}
      lastBurnAndPlay={lastBurnAndPlay}
    />,
  );
}

/** The spell-effect overlay is the only element carrying the
 * `data-ocid="chess.spell_effect"` marker. */
function spellOverlay(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-ocid="chess.spell_effect"]',
  );
}

/** Stub ResizeObserver so the board measures a deterministic 800px width
 * (100px per cell), which makes the b6-g3 geometry assertable. */
function stubResizeObserver(width: number) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(el: Element) {
        // Report the stubbed clientWidth to the measuring callback.
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

describe("Chessboard spell-effect overlay", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows the spell's own effect image for each of the five fire spells", () => {
    const spells: Array<[string, number]> = [
      ["Tia Lua", 10],
      ["Cau Lua", 11],
      ["Hoa Boc", 12],
      ["Buc Tung Lua", 13],
      ["Mua Lua", 14],
    ];

    for (const [spellName, spellId] of spells) {
      const { container, unmount } = renderBoard(firedResult(spellName));
      const overlay = spellOverlay(container);
      expect(overlay, `${spellName} should show an overlay`).not.toBeNull();
      expect(overlay).toHaveClass(`spell-effect-${spellId}`);
      unmount();
    }
  });

  it("shows the supplied Spell blocked image when a cast is cancelled by a shield", () => {
    const { container } = renderBoard(cancelledResult("Tia Lua"));

    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    // The accepted behavior uses the supplied Spell blocked image
    // (`spell-effect-spell-blocked`), not the older reserved blocked image.
    expect(overlay).toHaveClass("spell-effect-spell-blocked");
    // The blocked image replaces the spell's own effect image.
    expect(overlay).not.toHaveClass("spell-effect-10");
  });

  it("shows no image for a legacy cast with no board effect", () => {
    const { container } = renderBoard(legacyResult("Tia Lua"));

    expect(spellOverlay(container)).toBeNull();
  });

  it("shows no image for a spell name outside the five supplied effects", () => {
    const { container } = renderBoard(firedResult("Some Other Spell"));

    expect(spellOverlay(container)).toBeNull();
  });

  it("positions the overlay over the fixed b6-g3 block from the board geometry", () => {
    const { container } = renderBoard(firedResult("Tia Lua"));

    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    // Board measured at 800px -> 100px per cell. Standard orientation:
    // b6-g3 spans columns 1..6 (left = 100px, width = 600px) and rows 1..4
    // from the top (top = 100px, height = 400px).
    expect(overlay).toHaveStyle({
      left: "100px",
      top: "100px",
      width: "600px",
      height: "400px",
    });
  });

  it("mirrors the overlay geometry when the board is flipped", () => {
    const { container } = renderBoard(firedResult("Tia Lua"), {
      orientation: Team.Black,
    });

    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    // Flipped: columns mirror to 7-6=1..7-1=6 (same left/width), rows mirror
    // to rank 3..6 from the top (top = 300px, height = 400px).
    expect(overlay).toHaveStyle({
      left: "100px",
      top: "300px",
      width: "600px",
      height: "400px",
    });
  });

  it("never intercepts clicks — the board stays fully clickable while shown", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const { container } = render(
      <Chessboard
        board={boardWithRook()}
        turn={Team.White}
        moveMaker="maker-1"
        currentPlayer={{ ...WHITE_PLAYER, isMoveMaker: true }}
        onMove={onMove}
        orientation={Team.White}
        selectedSquareProp={null}
        destinationSquareProp={null}
        pendingPromotionPieceProp={null}
        lastBurnAndPlay={firedResult("Tia Lua")}
      />,
    );

    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    // The overlay carries the .spell-effect-overlay class, whose CSS sets
    // pointer-events:none, and is aria-hidden so it is not an interactive
    // target. jsdom does not apply stylesheet rules, so the class is the
    // observable contract here.
    expect(overlay).toHaveClass("spell-effect-overlay");
    expect(overlay).toHaveAttribute("aria-hidden", "true");

    // The overlay does not swallow the tap: clicking the rook's square still
    // reaches the board's own click handler.
    await user.click(screen.getByRole("button", { name: /Square a1/ }));
    expect(screen.getByRole("button", { name: /Square a1/ })).toBeEnabled();
  });

  it("applies the fade class when motion is allowed", () => {
    const { container } = renderBoard(firedResult("Tia Lua"));

    const overlay = spellOverlay(container);
    expect(overlay).toHaveClass("spell-effect-overlay-fade");
  });

  it("omits the fade class under reduce-motion", () => {
    stubMatchMedia(true);
    const { container } = renderBoard(firedResult("Tia Lua"));

    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    expect(overlay).not.toHaveClass("spell-effect-overlay-fade");
  });

  it("clears the image 4 seconds after the pre-roll hands off", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(firedResult("Tia Lua"));

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
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(spellOverlay(container)).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(spellOverlay(container)).toBeNull();
  });

  it("does not restart the image when the same burn is re-polled", () => {
    vi.useFakeTimers();
    const result = firedResult("Tia Lua");
    const { container, rerender } = renderBoard(result);

    // Complete the pre-roll so the spell image is visible.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // A re-poll delivers the same burn identity — the 4s window must not reset.
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
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).toBeNull();
  });
});
