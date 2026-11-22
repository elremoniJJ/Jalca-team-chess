import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted Minor removal spell board overlay on the Chessboard.
 *
 * When a fired cast of Chila Cao (id 15), Handom Zitie Zumuc (id 16) or
 * Bamburgh (id 17) takes effect, its own image appears as a 2-second overlay
 * over the fixed b6-g3 board block, using the same single-image overlay
 * mechanism as the Lua fire spells (ids 10-14). The overlay is driven by the
 * `lastBurnAndPlay` prop exactly as the game route supplies it.
 *
 * These are component/integration contracts with no actor or network access.
 * The real backend burn-and-play path is not exercised here.
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
function firedResult(spellName: string): BurnAndPlayResult {
  return {
    tokenId: 42n,
    spellName,
    gameNumber: 7n,
    team: Team.White,
    kind: SpellKind.Minor,
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

describe("Chessboard Minor removal spell-effect overlay", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows each Minor removal spell's own effect image when fired", () => {
    const spells: Array<[string, number]> = [
      ["Chila Cao", 15],
      ["Handom Zitie Zumuc", 16],
      ["Bamburgh", 17],
    ];

    for (const [spellName, spellId] of spells) {
      const { container, unmount } = renderBoard(firedResult(spellName));
      const overlay = spellOverlay(container);
      expect(overlay, `${spellName} should show an overlay`).not.toBeNull();
      expect(overlay).toHaveClass(`spell-effect-${spellId}`);
      unmount();
    }
  });

  it("positions the Minor removal overlay over the fixed b6-g3 block", () => {
    const { container } = renderBoard(firedResult("Chila Cao"));

    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    // Board measured at 800px -> 100px per cell. Standard orientation:
    // b6-g3 spans columns 1..6 (left = 100px, width = 600px) and rows 1..4
    // from the top (top = 100px, height = 400px) — the same block the Lua
    // fire spells use.
    expect(overlay).toHaveStyle({
      left: "100px",
      top: "100px",
      width: "600px",
      height: "400px",
    });
  });

  it("clears the Minor removal image after 4 seconds", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(firedResult("Bamburgh"));

    // The 3s pre-roll plays first; the spell image is suppressed until it
    // completes.
    expect(spellOverlay(container)).toHaveClass(
      "spell-effect-overlay-suppressed",
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).not.toHaveClass(
      "spell-effect-overlay-suppressed",
    );

    // The 4s spell window then runs from the handoff.
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(spellOverlay(container)).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(spellOverlay(container)).toBeNull();
  });

  it("keeps the five Lua fire spells keyed to their own effect images", () => {
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
});
