import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the spell-effect overlay LATCH fix on the Chessboard.
 *
 * The backend clears `lastBurnAndPlay` when the turn advances
 * (`clearBurnAndPlayForNewTurn`), and the game route polls
 * `getShieldResolutionSnapshot` every 1500ms. Before the fix the overlay was
 * derived directly from the polled prop, so a turn advance inside the window
 * unmounted the image early. The fix latches the burn result locally when it
 * first arrives, so the overlay stays mounted for its full duration even when
 * the polled prop goes null mid-window.
 *
 * What IS covered here — the accepted behavior and the regression it fixes:
 *   - a burn result that arrives and is then cleared to null by a later poll
 *     keeps the overlay mounted until the full window elapses;
 *   - the duration is 4s (still mounted at 3999ms, gone at 4000ms);
 *   - a genuinely NEW burn arriving mid-window still replaces the shown effect
 *     and restarts its own window (the latch does not freeze the first
 *     burn forever).
 *
 * These are component/integration contracts with no actor or network access.
 * The overlay is driven by the `lastBurnAndPlay` prop exactly as the game route
 * supplies it; the real backend burn path is not exercised here.
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

/** A fired burn-and-play result for the given spell name and token. */
function firedResult(spellName: string, tokenId: bigint): BurnAndPlayResult {
  return {
    tokenId,
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

/** The spell-effect overlay is the only element carrying the
 * `data-ocid="chess.spell_effect"` marker. */
function spellOverlay(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-ocid="chess.spell_effect"]',
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

describe("Chessboard spell-effect overlay latch", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("stays mounted for the full 4s window after the pre-roll when the polled prop goes null", () => {
    vi.useFakeTimers();
    const result = firedResult("Tia Lua", 42n);
    const { container, rerender } = renderBoard(result);

    // The 3s pre-roll plays first; the spell image is suppressed until it
    // completes.
    expect(spellOverlay(container)).toHaveClass(
      "spell-effect-overlay-suppressed",
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).toHaveClass("spell-effect-10");
    expect(spellOverlay(container)).not.toHaveClass(
      "spell-effect-overlay-suppressed",
    );

    // 1s into the spell window, the turn advances and the backend clears the
    // result: the polled prop goes null. The latched burn must keep the
    // overlay mounted.
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

    // Still mounted right after the prop goes null...
    expect(spellOverlay(container)).toHaveClass("spell-effect-10");
    // ...and at 3999ms into the spell window, just before it elapses.
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(spellOverlay(container)).not.toBeNull();
    // ...and gone exactly at 4000ms into the spell window.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(spellOverlay(container)).toBeNull();
  });

  it("keeps the overlay mounted across repeated null polls within the window", () => {
    vi.useFakeTimers();
    const result = firedResult("Mua Lua", 77n);
    const { container, rerender } = renderBoard(result);

    // Complete the pre-roll so the spell image is visible.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).toHaveClass("spell-effect-14");

    // Two consecutive 1500ms polls both deliver null (the backend cleared the
    // result on turn advance). The latch must survive both.
    for (let i = 0; i < 2; i += 1) {
      act(() => {
        vi.advanceTimersByTime(750);
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
      expect(spellOverlay(container)).toHaveClass("spell-effect-14");
    }

    // 1500ms elapsed into the spell window; it closes at 4000ms.
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(spellOverlay(container)).toBeNull();
  });

  it("replaces the latched effect and restarts the window when a new burn arrives", () => {
    vi.useFakeTimers();
    const first = firedResult("Tia Lua", 42n);
    const { container, rerender } = renderBoard(first);

    // Complete the first pre-roll so its spell image is visible.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).toHaveClass("spell-effect-10");

    // 1s into the spell window, a genuinely NEW burn arrives (different token
    // id). It must replace the latch and start its own pre-roll + window.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const second = firedResult("Mua Lua", 99n);
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

    // The new burn restarts the pre-roll, so its image is suppressed again.
    expect(spellOverlay(container)).toHaveClass(
      "spell-effect-overlay-suppressed",
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).toHaveClass("spell-effect-14");
    // 1s after the replacement it is still mounted (its own window restarted)...
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(spellOverlay(container)).not.toBeNull();
    // ...and clears 4s after the replacement, not 4s after the first burn.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).toBeNull();
  });
});
