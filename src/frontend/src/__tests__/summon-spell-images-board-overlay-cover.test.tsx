import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the acceptance criterion that casting one of the three new summon
 * spells (Lazarus id 23, Cuoclot Sac Wonmuc Rook id 24, Anne Boleyn id 25)
 * shows its own image on the board AFTER the 3-frame burning pre-roll.
 *
 * The request wires each of the three spells into `SPELL_EFFECT_IDS` in
 * Chessboard.tsx, so a fired cast hands off from the burning pre-roll to the
 * `.spell-effect-<id>` overlay class (which the sibling assets cover pins to
 * `/assets/spells/<id>.png`). Before the change these three names had no
 * mapping, so a fired cast rendered no post-pre-roll image at all.
 *
 * This is component/integration coverage driven by the `lastBurnAndPlay` prop
 * exactly as the game route supplies it; the real backend burn-and-play path is
 * not exercised. See episode.coverageLimits.
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

/** A fired burn-and-play result for the given summon spell name. */
function firedSummonResult(spellName: string): BurnAndPlayResult {
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

/** The three new summon spells and the overlay class each must render. */
const SUMMON_SPELLS: Array<[string, number]> = [
  ["Lazarus", 23],
  ["Cuoclot Sac Wonmuc Rook", 24],
  ["Anne Boleyn", 25],
];

describe("Chessboard summon-spell post-pre-roll image", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows each summon spell's own effect image after the 3-frame pre-roll", () => {
    vi.useFakeTimers();

    for (const [spellName, spellId] of SUMMON_SPELLS) {
      const { container, unmount } = renderBoard(firedSummonResult(spellName));

      // The overlay element is mounted immediately but suppressed while the
      // burning pre-roll plays, so no spell image is shown yet.
      const overlay = spellOverlay(container);
      expect(overlay, `${spellName} should mount an overlay`).not.toBeNull();
      expect(overlay).toHaveClass(`spell-effect-${spellId}`);
      expect(overlay).toHaveClass("spell-effect-overlay-suppressed");

      // After the 3-frame pre-roll the spell image takes over.
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(spellOverlay(container)).not.toHaveClass(
        "spell-effect-overlay-suppressed",
      );

      unmount();
    }
  });

  it("keeps the summon spell image visible for its own window after handoff", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(firedSummonResult("Anne Boleyn"));

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).not.toBeNull();

    // The 4s window starts at handoff, not at the cast.
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(spellOverlay(container)).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(spellOverlay(container)).toBeNull();
  });
});
