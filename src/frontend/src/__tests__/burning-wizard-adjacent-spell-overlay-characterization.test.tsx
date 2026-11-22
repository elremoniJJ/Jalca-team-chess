import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the EXISTING spell-effect overlay behavior ADJACENT to
 * the new "Something is burning" wizard animation, taken BEFORE the production
 * edit.
 *
 * The request intentionally adds a burning-animation layer BENEATH the existing
 * spell image overlay: it edits the overlay JSX in
 * `src/frontend/src/components/Chessboard.tsx` and the overlay CSS in
 * `src/frontend/src/index.css`, and adds new static frames under
 * `public/assets/spells/`. The burning loop itself is the intentional change,
 * so this file deliberately does NOT pin it.
 *
 * What IS protected is the pre-existing spell image overlay the new layer must
 * not disturb, because the change edits the exact same JSX block and the same
 * CSS module:
 *   - a fired cast still shows the spell's own `spell-effect-<id>` image;
 *   - a shield-cancelled cast still shows `spell-effect-spell-blocked`;
 *   - a defensive Subao Ve cast still shows `spell-effect-subao-ve`;
 *   - a legacy cast with no board effect still shows no overlay;
 *   - the overlay still sits over the fixed b6-g3 block, mirrored when flipped;
 *   - the board stays clickable and the overlay stays aria-hidden;
 *   - the fade class is applied when motion is allowed and omitted under
 *     reduce-motion;
 *   - the overlay still clears 4 seconds after the cast;
 *   - the stylesheet still carries the overlay rules and per-spell asset
 *     mappings the layer depends on.
 *
 * The backend actor is never touched: the overlay is driven by the
 * `lastBurnAndPlay` prop exactly as the game route supplies it, so this is
 * component/integration coverage of the frontend's rendering, not real backend
 * behavior. See episode.coverageLimits.
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

/** A burn-and-play result cancelled by a shield. */
function cancelledResult(spellName: string): BurnAndPlayResult {
  return {
    tokenId: 43n,
    spellName,
    gameNumber: 7n,
    team: Team.White,
    kind: SpellKind.Major,
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

/** A legacy burn-and-play result with no resolution at all. */
function legacyResult(spellName: string): BurnAndPlayResult {
  return {
    tokenId: 44n,
    spellName,
    team: Team.White,
    kind: SpellKind.Major,
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

describe("spell-effect overlay adjacent to the burning wizard animation", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps showing each fire spell's own effect image when it fires", () => {
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

  it("keeps showing the Spell blocked image when a cast is cancelled by a shield", () => {
    const { container } = renderBoard(cancelledResult("Tia Lua"));

    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass("spell-effect-spell-blocked");
    expect(overlay).not.toHaveClass("spell-effect-10");
  });

  it("keeps showing the Subao Ve image for a defensive Subao Ve cast", () => {
    const { container } = renderBoard(subaoVeResult());

    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass("spell-effect-subao-ve");
  });

  it("keeps showing no overlay for a legacy cast with no board effect", () => {
    const { container } = renderBoard(legacyResult("Tia Lua"));

    expect(spellOverlay(container)).toBeNull();
  });

  it("keeps positioning the overlay over the fixed b6-g3 block", () => {
    const { container } = renderBoard(firedResult("Tia Lua"));

    const overlay = spellOverlay(container);
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
  });

  it("keeps mirroring the overlay geometry when the board is flipped", () => {
    const { container } = renderBoard(firedResult("Tia Lua"), {
      orientation: Team.Black,
    });

    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    // Flipped: columns mirror to 7-6=1..7-1=6 (same left/width), rows mirror
    // to rank 3..6 from the top (top = 300px, height = 400px).
    expect(overlay).toHaveStyle({
      left: "100px",
      top: "300px",
      width: "600px",
      height: "400px",
    });
  });

  it("keeps the board clickable and the overlay non-interactive while shown", async () => {
    const user = userEvent.setup();
    const { container } = renderBoard(firedResult("Tia Lua"));

    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    // The overlay carries the .spell-effect-overlay class, whose CSS sets
    // pointer-events:none, and is aria-hidden so it is not an interactive
    // target. jsdom does not apply stylesheet rules, so the class is the
    // observable contract here.
    expect(overlay).toHaveClass("spell-effect-overlay");
    expect(overlay).toHaveAttribute("aria-hidden", "true");

    // The overlay does not swallow the tap: the rook's square is still a
    // reachable, enabled button.
    const square = screen.getByRole("button", { name: /Square a1/ });
    await user.click(square);
    expect(square).toBeEnabled();
  });

  it("keeps the fade class when motion is allowed and omits it under reduce-motion", () => {
    const { container, unmount } = renderBoard(firedResult("Tia Lua"));
    expect(spellOverlay(container)).toHaveClass("spell-effect-overlay-fade");
    unmount();

    stubMatchMedia(true);
    const { container: reduced } = renderBoard(firedResult("Tia Lua"));
    const overlay = spellOverlay(reduced);
    expect(overlay).not.toBeNull();
    expect(overlay).not.toHaveClass("spell-effect-overlay-fade");
  });

  it("keeps clearing the overlay 4 seconds after the pre-roll hands off", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(firedResult("Tia Lua"));

    // The 3s pre-roll plays first; the spell image is suppressed until it
    // completes, then its own 4s window starts.
    expect(spellOverlay(container)).toHaveClass(
      "spell-effect-overlay-suppressed",
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).not.toHaveClass(
      "spell-effect-overlay-suppressed",
    );
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

/* ------------------------------------------------------------------ */
/* Stylesheet contract the overlay layer depends on                    */
/* ------------------------------------------------------------------ */

const CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

describe("spell-effect overlay stylesheet adjacent to the burning wizard animation", () => {
  it("keeps the overlay rule non-interactive and absolutely positioned", () => {
    const rule = CSS.match(/\.spell-effect-overlay\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? "";
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/pointer-events:\s*none/);
  });

  it("keeps the 4s fade animation and its keyframes", () => {
    expect(CSS).toMatch(
      /\.spell-effect-overlay-fade\s*\{[^}]*animation:\s*spell-effect-fade\b/,
    );
    expect(CSS).toMatch(/@keyframes\s+spell-effect-fade\s*\{/);
  });

  it("keeps each spell overlay class mapped to its own asset", () => {
    const ids = [3, 4, 6, 10, 11, 12, 13, 14, 15, 16, 17];
    for (const id of ids) {
      expect(CSS).toMatch(
        new RegExp(
          `\\.spell-effect-${id}\\s*\\{[^}]*url\\(["']?/assets/spells/${id}\\.png["']?\\)`,
        ),
      );
    }
  });

  it("keeps the Subao Ve and Spell blocked overlay images mapped", () => {
    expect(CSS).toMatch(
      /\.spell-effect-subao-ve\s*\{[^}]*url\(["']?\/assets\/spells\/subao-ve\.png["']?\)/,
    );
    expect(CSS).toMatch(
      /\.spell-effect-spell-blocked\s*\{[^}]*url\(["']?\/assets\/spells\/spell-blocked\.png["']?\)/,
    );
  });
});
