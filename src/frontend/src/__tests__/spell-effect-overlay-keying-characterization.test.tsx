import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the spell-effect overlay's ADJACENT behavior, taken
 * BEFORE the overlay is changed to stay mounted for its full 2 seconds when
 * the backend clears `lastBurnAndPlay` on turn advance.
 *
 * The request intentionally changes ONE thing: the overlay must remain mounted
 * for the full 2s after a burn result arrives, even though the backend nulls
 * `lastBurnAndPlay` when the turn advances. This file does NOT assert the
 * current early-unmount behavior (that is the bug being fixed) and does NOT
 * assert the fixed persistence (it does not exist yet).
 *
 * What IS protected here — the burn-identity keying that must survive the fix:
 *   - a NEW burn arriving before the 2s window elapses replaces the shown
 *     effect and restarts the 2s window, so the newest cast is the one shown;
 *   - the overlay is keyed on the burn's identity (tokenId + spellName +
 *     gameNumber), so a re-poll of the SAME burn does not restart the window.
 *
 * These are component/integration contracts with no actor or network access.
 * The overlay is driven by the `lastBurnAndPlay` prop exactly as the game route
 * supplies it.
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
function firedResult(
  spellName: string,
  tokenId: bigint,
  overrides: Partial<BurnAndPlayResult> = {},
): BurnAndPlayResult {
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
    ...overrides,
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

describe("Chessboard spell-effect overlay burn-identity keying", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("replaces the shown effect and restarts the pre-roll + window when a new burn arrives", () => {
    vi.useFakeTimers();
    const first = firedResult("Tia Lua", 42n);
    const { container, rerender } = renderBoard(first);

    // Complete the first pre-roll so its spell image is visible.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).toHaveClass("spell-effect-10");

    // 1s into the first window, a DIFFERENT burn arrives (different token id).
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
    // The newest cast's image is shown, and its own 4s window has restarted:
    // 1s after the replacement it is still mounted...
    expect(spellOverlay(container)).toHaveClass("spell-effect-14");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(spellOverlay(container)).not.toBeNull();
    // ...and it clears exactly 4s after the replacement, not 4s after the first.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).toBeNull();
  });

  it("does not restart the window when the same burn is re-polled", () => {
    vi.useFakeTimers();
    const result = firedResult("Tia Lua", 42n);
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
