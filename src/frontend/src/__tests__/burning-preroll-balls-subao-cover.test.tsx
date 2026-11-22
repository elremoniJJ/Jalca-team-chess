import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the two ACCEPTED changes in this request:
 *
 *   1. A Subao Ve cast now starts the 3-frame burning pre-roll instead of
 *      skipping it, then hands off to the Subao Ve image.
 *   2. A fired Balls spell cast (Hairy/Veiny/Shiny Balls) now shows a spell
 *      image in the overlay and the burning sequence stops instead of looping
 *      forever.
 *
 * The accepted observable behavior asserted here:
 *   - Casting Subao Ve plays the 3-frame burning sequence first, then shows the
 *     Subao Ve image.
 *   - Casting Shiny Balls plays the burning sequence, then shows the Shiny
 *     Balls image and the sequence stops.
 *   - Casting Hairy Balls and Veiny Balls each show their own image and stop
 *     the sequence.
 *   - A Balls cast cancelled by a shield shows the blocked image and the
 *     sequence stops.
 *
 * The adjacent, unchanged behavior (a fired non-Balls spell's pre-roll and
 * handoff, the opponent-board redone squares, the default route) is protected
 * by burning-preroll-balls-subao-adjacent-characterization.test.tsx; this file
 * covers only the two intentional changes.
 *
 * These are component/integration contracts with no actor or network access.
 * The sequence is driven by the `lastBurnAndPlay` prop exactly as the game
 * route supplies it; the real backend burn path is not exercised here. See
 * episode.coverageLimits.
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

/** A defensive Subao Ve cast: kind SubaoVe, no offensive resolution. */
function subaoVeResult(): BurnAndPlayResult {
  return {
    tokenId: 55n,
    spellName: "Subao Ve",
    gameNumber: 7n,
    team: Team.White,
    kind: SpellKind.SubaoVe,
    removedSquares: [],
    insufficientMaterial: false,
    transformedSquares: [],
  };
}

/** A fired Balls cast for the given spell name. */
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

/** A Balls cast cancelled by the defending team's shield. */
function cancelledBallsResult(spellName: string): BurnAndPlayResult {
  return {
    tokenId: 43n,
    spellName,
    gameNumber: 7n,
    team: Team.White,
    kind: SpellKind.Balls,
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

describe("Subao Ve cast plays the burning pre-roll then hands off", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("plays the 3-frame burning sequence first, then shows the Subao Ve image", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(subaoVeResult());

    // The Subao Ve cast now starts the pre-roll: frame 1 shows immediately and
    // the Subao Ve image is suppressed until the pre-roll completes.
    expect(burningOverlay(container)?.className).toContain(
      "burning-wizard-frame-1",
    );
    expect(spellOverlay(container)).toHaveClass(
      "spell-effect-overlay-suppressed",
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(burningOverlay(container)?.className).toContain(
      "burning-wizard-frame-2",
    );
    expect(spellOverlay(container)).toHaveClass(
      "spell-effect-overlay-suppressed",
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(burningOverlay(container)?.className).toContain(
      "burning-wizard-frame-3",
    );
    expect(spellOverlay(container)).toHaveClass(
      "spell-effect-overlay-suppressed",
    );

    // After the 3-frame pre-roll the sequence stops and the Subao Ve image
    // takes over.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(burningOverlay(container)).toBeNull();
    const spell = spellOverlay(container);
    expect(spell).not.toBeNull();
    expect(spell).toHaveClass("spell-effect-subao-ve");
    expect(spell).not.toHaveClass("spell-effect-overlay-suppressed");
  });
});

describe("fired Balls cast shows its own image and stops the sequence", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const BALLS = [
    { name: "Hairy Balls", className: "spell-effect-balls-hairy" },
    { name: "Veiny Balls", className: "spell-effect-balls-veiny" },
    { name: "Shiny Balls", className: "spell-effect-balls-shiny" },
  ] as const;

  it("plays the burning sequence, then shows the Shiny Balls image and stops", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(firedBallsResult("Shiny Balls"));

    // The pre-roll plays first; the Balls image is suppressed during it.
    expect(burningOverlay(container)?.className).toContain(
      "burning-wizard-frame-1",
    );
    expect(spellOverlay(container)).toHaveClass(
      "spell-effect-overlay-suppressed",
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // The sequence stops and the Shiny Balls image shows.
    expect(burningOverlay(container)).toBeNull();
    const spell = spellOverlay(container);
    expect(spell).not.toBeNull();
    expect(spell).toHaveClass("spell-effect-balls-shiny");
    expect(spell).not.toHaveClass("spell-effect-overlay-suppressed");
  });

  it("shows each Balls spell's own image and stops the sequence", () => {
    vi.useFakeTimers();
    for (const balls of BALLS) {
      const { container, unmount } = renderBoard(firedBallsResult(balls.name));

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      // The sequence stops (no burning overlay) and the spell's own image is
      // shown, not a stale burning frame and not another Balls image.
      expect(burningOverlay(container)).toBeNull();
      const spell = spellOverlay(container);
      expect(spell).not.toBeNull();
      expect(spell).toHaveClass(balls.className);
      expect(spell).not.toHaveClass("spell-effect-overlay-suppressed");

      unmount();
    }
    vi.useRealTimers();
  });

  it("does not keep looping the burning frames after a fired Balls handoff", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(firedBallsResult("Hairy Balls"));

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(burningOverlay(container)).toBeNull();

    // Past the pre-roll, while the spell image is still in its 4s window, the
    // sequence must stay stopped rather than loop back to a burning frame.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(burningOverlay(container)).toBeNull();
    expect(spellOverlay(container)).toHaveClass("spell-effect-balls-hairy");
  });

  it("shows the blocked image and stops the sequence for a shield-cancelled Balls cast", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(cancelledBallsResult("Shiny Balls"));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // A cancelled Balls cast falls through to the blocked image, not a Balls
    // image, and the sequence stops.
    const spell = spellOverlay(container);
    expect(spell).not.toBeNull();
    expect(spell).toHaveClass("spell-effect-spell-blocked");
    expect(spell).not.toHaveClass("spell-effect-balls-shiny");
    expect(burningOverlay(container)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Stylesheet contract the Balls images depend on                      */
/* ------------------------------------------------------------------ */

const CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

describe("Balls spell-effect stylesheet", () => {
  it("maps each Balls overlay class to its own named asset", () => {
    const expected: Array<[string, string]> = [
      ["hairy", "hairy-balls.png"],
      ["veiny", "veiny-balls.png"],
      ["shiny", "shiny-balls.png"],
    ];
    for (const [slug, asset] of expected) {
      expect(CSS).toMatch(
        new RegExp(
          `\\.spell-effect-balls-${slug}\\s*\\{[^}]*url\\(["']?/assets/spells/${asset}["']?\\)`,
        ),
      );
    }
  });
});
