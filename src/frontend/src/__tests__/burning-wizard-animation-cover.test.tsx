import "@testing-library/jest-dom/vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the NEW three-frame "Something is burning" wizard animation on the
 * Chessboard.
 *
 * The request adds a burning-animation layer BENEATH the existing spell image
 * overlay, over the SAME fixed b6-g3 block. While an NFT burn (spell cast) is
 * pending, the three supplied frames (burning-1/2/3.png) play in order
 * 1 -> 2 -> 3 -> 1, one second apart, as a PRE-ROLL before the spell image.
 * The sequence is latched locally: once a genuine pending burn starts it, it
 * finishes its pre-roll and keeps looping even if the polled prop clears
 * mid-sequence. The real spell image wins the render over the burning loop
 * (z-index 20 vs 19) so a same-tick handoff never shows a stale burning frame.
 * A Subao Ve cast is not a failure: it plays the same pre-roll and then hands
 * off to its own spell image; a Legacy cast is a resolved no-op and never shows
 * the loop.
 *
 * These are component/integration contracts with no actor or network access.
 * The loop is driven by the `lastBurnAndPlay` prop exactly as the game route
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
  LegacyReason,
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

/** A defensive Subao Ve cast: kind SubaoVe, no offensive resolution. */
function subaoVeResult(): BurnAndPlayResult {
  return {
    tokenId: 45n,
    spellName: "Subao Ve",
    gameNumber: 7n,
    team: Team.White,
    kind: SpellKind.SubaoVe,
    removedSquares: [],
    insufficientMaterial: false,
    transformedSquares: [],
  };
}

/** A legacy burn-and-play result: no resolution, legacyReason set. */
function legacyResult(spellName: string): BurnAndPlayResult {
  return {
    tokenId: 44n,
    spellName,
    team: Team.White,
    kind: SpellKind.Major,
    legacyReason: LegacyReason.keysAbsent,
    removedSquares: [],
    insufficientMaterial: false,
    transformedSquares: [],
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

describe("Chessboard burning-wizard animation", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows the burning pre-roll while a burn is pending and hands off to the spell image", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(pendingResult("Tia Lua", 42n));

    // The pre-roll starts immediately and the spell image is suppressed.
    expect(burningOverlay(container)).not.toBeNull();
    expect(spellOverlay(container)).toHaveClass(
      "spell-effect-overlay-suppressed",
    );

    // After the 3-frame pre-roll the sequence stops and the spell image shows.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(burningOverlay(container)).toBeNull();
    expect(spellOverlay(container)).not.toHaveClass(
      "spell-effect-overlay-suppressed",
    );
  });

  it("advances one frame per second, looping 1 -> 2 -> 3 -> 1", () => {
    vi.useFakeTimers();
    // A burn whose spell has no effect image: the sequence must keep looping
    // after the pre-roll rather than hand off to nothing.
    const { container } = renderBoard(pendingResult("Unknown Spell", 42n));

    const frame = () => burningOverlay(container)?.className ?? "";
    expect(frame()).toContain("burning-wizard-frame-1");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(frame()).toContain("burning-wizard-frame-2");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(frame()).toContain("burning-wizard-frame-3");

    // Loops back to frame 1 rather than stopping after three frames.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(frame()).toContain("burning-wizard-frame-1");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(frame()).toContain("burning-wizard-frame-2");
  });

  it("keeps the latched sequence running when the pending state clears mid-pre-roll", () => {
    vi.useFakeTimers();
    const { container, rerender } = renderBoard(pendingResult("Tia Lua", 42n));

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(burningOverlay(container)?.className).toContain(
      "burning-wizard-frame-2",
    );

    // Pending clears mid-sequence: the latched sequence must keep running
    // rather than stopping on the same tick.
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

  it("restarts from frame 1 for a new burn after the previous one cleared", () => {
    vi.useFakeTimers();
    const { container, rerender } = renderBoard(pendingResult("Tia Lua", 42n));

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(burningOverlay(container)?.className).toContain(
      "burning-wizard-frame-3",
    );

    // Clear, then a genuinely new burn arrives.
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
        lastBurnAndPlay={pendingResult("Mua Lua", 99n)}
      />,
    );
    expect(burningOverlay(container)?.className).toContain(
      "burning-wizard-frame-1",
    );
  });

  it("positions the loop over the fixed b6-g3 block, mirrored when flipped", () => {
    const { container, unmount } = renderBoard(pendingResult("Tia Lua", 42n));

    const overlay = burningOverlay(container);
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
    unmount();

    const { container: flipped } = renderBoard(pendingResult("Tia Lua", 42n), {
      orientation: Team.Black,
    });
    // Flipped: rows mirror to rank 3..6 from the top (top = 300px).
    expect(burningOverlay(flipped)).toHaveStyle({
      left: "100px",
      top: "300px",
      width: "600px",
      height: "400px",
    });
  });

  it("keeps the board clickable and the loop non-interactive while shown", async () => {
    const user = userEvent.setup();
    const { container } = renderBoard(pendingResult("Tia Lua", 42n));

    const overlay = burningOverlay(container);
    expect(overlay).not.toBeNull();
    // The overlay carries the .burning-wizard-overlay class, whose CSS sets
    // pointer-events:none, and is aria-hidden so it is not an interactive
    // target. jsdom does not apply stylesheet rules, so the class is the
    // observable contract here.
    expect(overlay).toHaveClass("burning-wizard-overlay");
    expect(overlay).toHaveAttribute("aria-hidden", "true");

    // The loop does not swallow the tap: the rook's square is still reachable.
    const square = screen.getByRole("button", { name: /Square a1/ });
    await user.click(square);
    expect(square).toBeEnabled();
  });

  it("applies the fade class when motion is allowed and omits it under reduce-motion", () => {
    const { container, unmount } = renderBoard(pendingResult("Tia Lua", 42n));
    expect(burningOverlay(container)).toHaveClass(
      "burning-wizard-overlay-fade",
    );
    unmount();

    stubMatchMedia(true);
    const { container: reduced } = renderBoard(pendingResult("Tia Lua", 42n));
    const overlay = burningOverlay(reduced);
    expect(overlay).not.toBeNull();
    expect(overlay).not.toHaveClass("burning-wizard-overlay-fade");
  });

  it("plays the pre-roll then hands off to the Subao Ve image for a Subao Ve cast", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(subaoVeResult());

    // The Subao Ve cast now starts the same pre-roll as every other spell.
    expect(burningOverlay(container)).not.toBeNull();
    expect(spellOverlay(container)).toHaveClass(
      "spell-effect-overlay-suppressed",
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // On handoff the sequence stops and the Subao Ve image shows.
    expect(burningOverlay(container)).toBeNull();
    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass("spell-effect-subao-ve");
  });

  it("shows no loop for a legacy cast with no board effect", () => {
    const { container } = renderBoard(legacyResult("Tia Lua"));

    expect(burningOverlay(container)).toBeNull();
  });

  it("renders the real spell image on top of the loop on a same-tick handoff", () => {
    const { container } = renderBoard(pendingResult("Tia Lua", 42n));

    // Both layers are mounted for the same burn: the spell image must win the
    // render. jsdom does not apply stylesheet z-index, so the observable
    // contract is the class pair plus the stylesheet rule asserted below.
    const burning = burningOverlay(container);
    const spell = spellOverlay(container);
    expect(burning).not.toBeNull();
    expect(spell).not.toBeNull();
    expect(spell).toHaveClass("spell-effect-10");
  });
});

/* ------------------------------------------------------------------ */
/* Stylesheet contract the burning-wizard layer depends on             */
/* ------------------------------------------------------------------ */

const CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

describe("burning-wizard stylesheet", () => {
  it("keeps the loop non-interactive, absolutely positioned and beneath the spell overlay", () => {
    const rule = CSS.match(/\.burning-wizard-overlay\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? "";
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/pointer-events:\s*none/);
    // z-index 19, below the spell-effect overlay's 20, so the real spell image
    // wins a same-tick handoff.
    expect(body).toMatch(/z-index:\s*19/);
  });

  it("keeps the spell-effect overlay above the burning loop", () => {
    const rule = CSS.match(/\.spell-effect-overlay\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule?.[1] ?? "").toMatch(/z-index:\s*20/);
  });

  it("maps each of the three frames to its own asset in play order", () => {
    for (const n of [1, 2, 3]) {
      expect(CSS).toMatch(
        new RegExp(
          `\\.burning-wizard-frame-${n}\\s*\\{[^}]*url\\(["']?/assets/spells/burning-${n}\\.png["']?\\)`,
        ),
      );
    }
  });

  it("keeps the fade animation and its keyframes", () => {
    expect(CSS).toMatch(
      /\.burning-wizard-overlay-fade\s*\{[^}]*animation:\s*burning-wizard-fade\b/,
    );
    expect(CSS).toMatch(/@keyframes\s+burning-wizard-fade\s*\{/);
  });
});

/* ------------------------------------------------------------------ */
/* On-disk frame assets the loop depends on                            */
/* ------------------------------------------------------------------ */

const SPELL_ASSET_DIR = resolve(process.cwd(), "public/assets/spells");

/** Read a PNG's pixel dimensions from its IHDR chunk (bytes 16..24). */
function pngDimensions(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  // PNG signature (8 bytes) + IHDR length/type (8 bytes) then width/height.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("burning-wizard frame assets", () => {
  it("ships a non-empty PNG for each of the three frames", () => {
    for (const n of [1, 2, 3]) {
      const path = resolve(SPELL_ASSET_DIR, `burning-${n}.png`);
      const stat = statSync(path);
      expect(stat.isFile(), `burning-${n}.png should be a file`).toBe(true);
      expect(stat.size, `burning-${n}.png should not be empty`).toBeGreaterThan(
        0,
      );
      const header = readFileSync(path).subarray(0, 8);
      expect(
        header.equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ),
        `burning-${n}.png should have a PNG signature`,
      ).toBe(true);
    }
  });

  it("gives all three frames identical final dimensions so the wizard never shifts", () => {
    const dims = [1, 2, 3].map((n) =>
      pngDimensions(resolve(SPELL_ASSET_DIR, `burning-${n}.png`)),
    );
    expect(dims[1]).toEqual(dims[0]);
    expect(dims[2]).toEqual(dims[0]);
  });

  it("authors the frames at 2x the ~340x340 display size", () => {
    const { width, height } = pngDimensions(
      resolve(SPELL_ASSET_DIR, "burning-1.png"),
    );
    // ~340x340 displayed, authored at 2x internally for high-DPI crispness.
    expect(width).toBe(680);
    expect(height).toBe(680);
  });
});
