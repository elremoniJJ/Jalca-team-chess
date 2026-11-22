import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted board-overlay mapping of the user's original
 * hand-drawn images to Bendika (id 3), Bendika Tah (id 4) and Mayban Dadoy
 * Tron (id 6).
 *
 * When one of those three spells is cast successfully (resolution outcome
 * `fired`), the Chessboard must show the spell's own effect image over the
 * fixed b6-g3 block for 4 seconds, keyed by the `.spell-effect-<id>` class
 * (which the CSS maps to `/assets/spells/<id>.png`). The overlay must clear
 * after the 2s window.
 *
 * The backend actor is not involved: the Chessboard is rendered directly with
 * a typed local `BurnAndPlayResult`, so this is component/integration coverage
 * of the frontend's rendering — not a deployed browser journey and not real
 * backend behavior. See episode.coverageLimits.
 */

// The Chessboard imports enum values from @/backend at runtime, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the component needs.
vi.mock("@/backend", () => ({
  SpellComplexity: { Easy: "Easy", Complex: "Complex", Moderate: "Moderate" },
  SpellCategory: {
    Block: "Block",
    Major: "Major",
    Minor: "Minor",
    Balls: "Balls",
  },
  SpellKind: {
    Major: "Major",
    Minor: "Minor",
    SubaoVe: "SubaoVe",
    Balls: "Balls",
  },
  LegacyReason: {
    keysAbsent: "keysAbsent",
    wrongType: "wrongType",
    keysDisagree: "keysDisagree",
    readFailed: "readFailed",
  },
  BurnedSpellCategory: {
    Major: "Major",
    Minor: "Minor",
    SubaoVe: "SubaoVe",
    Balls: "Balls",
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
  SpellUse: { On: "On", Off: "Off" },
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
  SpellResolutionOutcome: {
    fired: "fired",
    cancelled: "cancelled",
    legacy: "legacy",
  },
}));

// AdvicePopup -> lib/backend-actor imports createActorWithConfig from
// @caffeineai/core-infrastructure, which also fails to resolve its own
// submodules in jsdom. The Chessboard under test never calls the actor.
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

/** The three spells this change maps, with their id-named overlay class. */
const ORIGINAL_IMAGE_SPELLS = [
  { name: "Bendika", id: 3 },
  { name: "Bendika Tah", id: 4 },
  { name: "Mayban Dadoy Tron", id: 6 },
] as const;

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

describe("Chessboard original spell-effect overlay", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows each of the three spells' own effect image when cast successfully", () => {
    for (const spell of ORIGINAL_IMAGE_SPELLS) {
      const { container, unmount } = renderBoard(firedResult(spell.name));
      const overlay = spellOverlay(container);
      expect(overlay, `${spell.name} should show an overlay`).not.toBeNull();
      expect(overlay).toHaveClass(`spell-effect-${spell.id}`);
      unmount();
    }
  });

  it("clears each of the three overlays after the 4-second window", () => {
    vi.useFakeTimers();
    for (const spell of ORIGINAL_IMAGE_SPELLS) {
      const { container, unmount } = renderBoard(firedResult(spell.name));

      // The 3s pre-roll plays first; the spell image is suppressed until it
      // completes.
      expect(spellOverlay(container), `${spell.name} overlay`).toHaveClass(
        "spell-effect-overlay-suppressed",
      );
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(spellOverlay(container), `${spell.name} handoff`).not.toHaveClass(
        "spell-effect-overlay-suppressed",
      );

      // The 4s spell window then runs from the handoff.
      act(() => {
        vi.advanceTimersByTime(3999);
      });
      expect(
        spellOverlay(container),
        `${spell.name} still visible`,
      ).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(spellOverlay(container), `${spell.name} cleared`).toBeNull();
      unmount();
    }
  });
});
