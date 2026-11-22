import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the behavior ADJACENT to the two intentional changes in
 * this request, taken BEFORE the production edits land.
 *
 * The request intentionally changes:
 *   - a Subao Ve cast now starts the 3-frame burning pre-roll before handing
 *     off to the Subao Ve image (it previously skipped the pre-roll);
 *   - a Balls spell cast (Hairy/Veiny/Shiny Balls) now shows a spell image and
 *     the burning sequence stops instead of looping forever.
 *
 * Those are the intentional changes, so this file deliberately does NOT pin
 * what a Subao Ve cast currently renders, nor what one of the three image Balls
 * spells currently renders, nor whether their sequence currently loops.
 *
 * What IS protected here is the adjacent, currently-working behavior the change
 * must not disturb: the EXISTING colour Balls spells (Sandy / Cloudy / Grassy /
 * Fiery / Wooden Balls) are a separate path. They are Balls-kind and fired, so
 * they still play the 3-frame pre-roll first, and because they have no entry in
 * the spell-effect image map they still show NO spell image. The new image Balls
 * spells must not change that.
 *
 * This file deliberately does NOT pin whether the sequence stops for the
 * existing colour Balls spells: with no image mapping the handoff never fires,
 * so the sequence currently keeps looping — the very behavior the request
 * intentionally fixes for the three image Balls spells. Freezing it would
 * protect the bug.
 *
 * The backend actor is never touched: the sequence is driven by the
 * `lastBurnAndPlay` prop exactly as the game route supplies it, so this is
 * component/integration coverage of the frontend's rendering — not real backend
 * behavior. See episode.coverageLimits.
 */

// The Chessboard imports enum values from @/backend at runtime, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
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
  LegacyReason: {
    keysAbsent: "keysAbsent",
    wrongType: "wrongType",
    keysDisagree: "keysDisagree",
    readFailed: "readFailed",
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

/** A fired Balls burn-and-play result for the given spell name. */
function firedBallsResult(spellName: string): BurnAndPlayResult {
  return {
    tokenId: 42n,
    spellName,
    gameNumber: 7n,
    team: Team.White,
    kind: SpellKind.Balls,
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

/** The burning-wizard overlay is the only element carrying the
 * `data-ocid="chess.burning_wizard"` marker. */
function burningOverlay(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-ocid="chess.burning_wizard"]',
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

/** The five existing colour Balls spells — a separate, unchanged path. */
const EXISTING_BALLS_SPELLS = [
  "Sandy Balls",
  "Cloudy Balls",
  "Grassy Balls",
  "Fiery Balls",
  "Wooden Balls",
] as const;

describe("burning pre-roll adjacent to the existing colour Balls spells", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("still plays the 3-frame pre-roll first for a fired existing Balls spell", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(firedBallsResult("Sandy Balls"));

    // Frame 1 shows immediately; the existing Balls spells have no image
    // mapping, so no spell overlay is mounted at all.
    expect(burningOverlay(container)?.className).toContain(
      "burning-wizard-frame-1",
    );
    expect(spellOverlay(container)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(burningOverlay(container)?.className).toContain(
      "burning-wizard-frame-2",
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(burningOverlay(container)?.className).toContain(
      "burning-wizard-frame-3",
    );
  });

  it("still shows no spell image for a fired existing Balls spell", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(firedBallsResult("Sandy Balls"));

    // The existing colour Balls spells have no entry in the spell-effect image
    // map, so no spell overlay is ever mounted for them — before, during or
    // after the pre-roll. The new image Balls spells must not change that.
    expect(spellOverlay(container)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).toBeNull();
  });

  it("keeps the same pre-roll-first, no-image behavior for every existing Balls spell", () => {
    vi.useFakeTimers();
    for (const spellName of EXISTING_BALLS_SPELLS) {
      const { container, unmount } = renderBoard(firedBallsResult(spellName));

      expect(
        burningOverlay(container)?.className,
        `${spellName} should start the pre-roll`,
      ).toContain("burning-wizard-frame-1");
      expect(spellOverlay(container)).toBeNull();

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(
        spellOverlay(container),
        `${spellName} should show no spell image`,
      ).toBeNull();
      unmount();
    }
  });
});
