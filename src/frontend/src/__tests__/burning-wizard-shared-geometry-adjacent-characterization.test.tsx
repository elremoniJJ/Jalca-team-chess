import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the SHARED GEOMETRY contract between the burning-wizard
 * overlay and the spell-effect overlay, taken BEFORE the accepted pre-roll
 * timing change.
 *
 * The request intentionally changes the burning sequence's TIMING: the three
 * frames become a pre-roll that plays before the spell image, and the frames
 * are latched locally so they finish/loop even when the polled burn-pending
 * prop clears mid-sequence. Those two behaviors are the intentional change, so
 * this file deliberately does NOT pin them.
 *
 * What IS protected here — the surrounding contract the timing change must not
 * disturb, and which the acceptance criteria call out as unchanged:
 *   - the burning overlay and the spell overlay are positioned from the SAME
 *     fixed b6-g3 rect, so the handoff never jumps between two different
 *     regions (the spell image "wins the render" over the same block);
 *   - that shared rect mirrors identically for both overlays when the board is
 *     flipped;
 *   - the spell overlay still clears 4 seconds after the cast regardless of
 *     whether the burning overlay is present, so the handoff target's lifetime
 *     is independent of the pre-roll.
 *
 * The backend actor is never touched: both overlays are driven by the
 * `lastBurnAndPlay` prop exactly as the game route supplies it, so this is
 * component/integration coverage of the frontend's rendering, not real backend
 * behavior. See episode.coverageLimits.
 */

// The Chessboard imports PieceType/Team/SpellResolutionOutcome as runtime
// values from @/backend, which transitively pulls in @caffeineai/object-storage
// and @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the board needs. The overlays
// under test are pure frontend rendering and never touch the actor.
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

/** The four inline geometry values both overlays position themselves with. */
function rectOf(el: HTMLElement) {
  return {
    left: el.style.left,
    top: el.style.top,
    width: el.style.width,
    height: el.style.height,
  };
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

describe("burning-wizard and spell overlays share one geometry", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("positions both overlays over the identical b6-g3 rect", () => {
    const { container } = renderBoard(pendingResult("Tia Lua", 42n));

    const burning = burningOverlay(container);
    const spell = spellOverlay(container);
    expect(burning).not.toBeNull();
    expect(spell).not.toBeNull();

    // The handoff target must not jump: both layers use the same fixed block.
    expect(rectOf(burning as HTMLElement)).toEqual(
      rectOf(spell as HTMLElement),
    );
    expect(rectOf(spell as HTMLElement)).toEqual({
      left: "100px",
      top: "100px",
      width: "600px",
      height: "400px",
    });
  });

  it("mirrors both overlays to the same rect when the board is flipped", () => {
    const { container } = renderBoard(pendingResult("Tia Lua", 42n), {
      orientation: Team.Black,
    });

    const burning = burningOverlay(container);
    const spell = spellOverlay(container);
    expect(burning).not.toBeNull();
    expect(spell).not.toBeNull();

    expect(rectOf(burning as HTMLElement)).toEqual(
      rectOf(spell as HTMLElement),
    );
    // Flipped: rows mirror to rank 3..6 from the top (top = 300px).
    expect(rectOf(spell as HTMLElement)).toEqual({
      left: "100px",
      top: "300px",
      width: "600px",
      height: "400px",
    });
  });
});
