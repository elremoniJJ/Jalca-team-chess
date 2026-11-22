import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the ACCEPTED pre-roll timing change to the burning-wizard
 * sequence on the Chessboard.
 *
 * The accepted change makes the three-frame "Something is burning" sequence a
 * PRE-ROLL that plays before the spell image/effect:
 *   - the 3 frames play first, one per second, before any spell image appears;
 *   - if the spell image is already available when the 3 frames complete, the
 *     spell image takes over immediately on the next tick;
 *   - if the spell image is not yet available after the 3 frames, the frames
 *     loop 1 -> 2 -> 3 -> 1 until the spell image/effect appear, then the spell
 *     image takes over;
 *   - the frames are latched locally, so the sequence finishes or keeps looping
 *     even if the polled burn-pending prop clears mid-sequence;
 *   - on handoff the spell image is rendered, never a stale burning frame.
 *
 * The unchanged surrounding behavior (Legacy no-op, Subao Ve block, clickable
 * board, no sound, shared geometry) is protected by the adjacent
 * characterization files; this file covers only the accepted timing change.
 *
 * These are component/integration contracts with no actor or network access.
 * The sequence is driven by the `lastBurnAndPlay` prop exactly as the game
 * route supplies it; the real backend burn path is not exercised here. See
 * episode.coverageLimits.
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

/** A pending burn-and-play result for the given spell name and token. */
function pendingResult(
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

describe("Chessboard burning-wizard pre-roll", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("plays the 3-frame pre-roll first, one frame per second, before any spell image", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(pendingResult("Tia Lua", 42n));

    // Frame 1 shows immediately; the spell image is suppressed during the
    // pre-roll even though the effect is already latched.
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
  });

  it("hands off to the spell image on the next tick once the 3 frames complete", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(pendingResult("Tia Lua", 42n));

    // Complete the 3-second pre-roll.
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // The spell image is no longer suppressed and the burning sequence stops.
    const spell = spellOverlay(container);
    expect(spell).not.toBeNull();
    expect(spell).not.toHaveClass("spell-effect-overlay-suppressed");
    expect(spell).toHaveClass("spell-effect-10");
    expect(burningOverlay(container)).toBeNull();
  });

  it("keeps looping the frames when the spell image is not yet available after 3 frames", () => {
    vi.useFakeTimers();
    // A burn whose spell has no effect image yet: the effect is null, so the
    // sequence must keep looping rather than hand off to nothing.
    const { container } = renderBoard(
      pendingResult("Unknown Spell", 42n, {
        resolution: {
          attacker: Team.White,
          defender: Team.Black,
          spellValue: 5n,
          shieldBefore: 0n,
          shieldAfter: 0n,
          outcome: SpellResolutionOutcome.fired,
          firesOnBoard: true,
        },
      }),
    );

    // No spell image is derivable for this spell name.
    expect(spellOverlay(container)).toBeNull();

    // Past the pre-roll the frames keep looping 1 -> 2 -> 3 -> 1.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(burningOverlay(container)?.className).toContain(
      "burning-wizard-frame-1",
    );

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

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(burningOverlay(container)?.className).toContain(
      "burning-wizard-frame-1",
    );
  });

  it("keeps the sequence latched when the polled prop clears mid-pre-roll", () => {
    vi.useFakeTimers();
    const { container, rerender } = renderBoard(pendingResult("Tia Lua", 42n));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(burningOverlay(container)?.className).toContain(
      "burning-wizard-frame-2",
    );

    // The backend clears lastBurnAndPlay mid-sequence: the latched sequence
    // must keep running rather than stopping on the same tick.
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
    expect(burningOverlay(container)).not.toBeNull();

    // It continues to advance after the prop cleared.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(burningOverlay(container)?.className).toContain(
      "burning-wizard-frame-3",
    );
  });

  it("renders the spell image, never a stale burning frame, on handoff", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(pendingResult("Tia Lua", 42n));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // On handoff the burning overlay is gone and the spell image is visible.
    expect(burningOverlay(container)).toBeNull();
    const spell = spellOverlay(container);
    expect(spell).not.toBeNull();
    expect(spell).not.toHaveClass("spell-effect-overlay-suppressed");
  });

  it("keeps the board clickable and produces no sound during the pre-roll", async () => {
    const user = userEvent.setup();
    const audioSpy = vi.fn();
    const playSpy = vi.fn();
    vi.stubGlobal(
      "Audio",
      class {
        constructor(...args: unknown[]) {
          audioSpy(...args);
        }
        play = playSpy;
      },
    );
    const playSpyOnProto = vi.spyOn(window.HTMLMediaElement.prototype, "play");

    const { container } = renderBoard(pendingResult("Tia Lua", 42n));

    const overlay = burningOverlay(container);
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass("burning-wizard-overlay");
    expect(overlay).toHaveAttribute("aria-hidden", "true");

    const square = screen.getByRole("button", { name: /Square a1/ });
    await user.click(square);
    expect(square).toBeEnabled();

    expect(audioSpy).not.toHaveBeenCalled();
    expect(playSpy).not.toHaveBeenCalled();
    expect(playSpyOnProto).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Stylesheet contract the pre-roll suppression depends on             */
/* ------------------------------------------------------------------ */

const CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

describe("burning-wizard pre-roll stylesheet", () => {
  it("suppresses the spell image while the pre-roll plays", () => {
    const rule = CSS.match(/\.spell-effect-overlay-suppressed\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? "";
    expect(body).toMatch(/opacity:\s*0/);
    expect(body).toMatch(/animation:\s*none/);
  });

  it("keeps the burning overlay beneath the spell overlay so the image wins handoff", () => {
    const burning = CSS.match(/\.burning-wizard-overlay\s*\{([^}]*)\}/);
    const spell = CSS.match(/\.spell-effect-overlay\s*\{([^}]*)\}/);
    expect(burning?.[1] ?? "").toMatch(/z-index:\s*19/);
    expect(spell?.[1] ?? "").toMatch(/z-index:\s*20/);
  });
});
