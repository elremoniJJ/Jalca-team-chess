import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the burning-wizard behavior ADJACENT to the accepted
 * pre-roll change, taken BEFORE the production edit.
 *
 * The request intentionally changes the burning sequence's TIMING: the three
 * frames become a pre-roll that plays before the spell image, and the frames
 * are latched locally so they finish/loop even when the polled burn-pending
 * prop clears mid-sequence. Those two behaviors are the intentional change, so
 * this file deliberately does NOT pin them (the existing
 * `burning-wizard-animation-cover.test.tsx` pins the old concurrent/stop-on-
 * clear timing and is expected to be updated by the production owner).
 *
 * What IS protected here — the surrounding behavior the timing change must not
 * disturb, and which the acceptance criteria call out as unchanged:
 *   - a Legacy / ineligible cast (resolution null + legacyReason set) is a
 *     resolved no-op: it shows NEITHER the burning loop NOR a spell image;
 *   - a Subao Ve block is NOT a failure: it shows the normal Subao Ve spell
 *     image and never the burning loop;
 *   - the board stays fully clickable while the burning sequence is shown;
 *   - the burning sequence produces no sound;
 *   - the burning overlay stays non-interactive (aria-hidden, pointer-events
 *     none via its class) and is positioned over the fixed b6-g3 block,
 *     mirrored when the board is flipped.
 *
 * The backend actor is never touched: the sequence is driven by the
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

describe("burning-wizard sequence adjacent to the pre-roll change", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows neither the loop nor a spell image for a Legacy / ineligible cast", () => {
    const { container } = renderBoard(legacyResult("Tia Lua"));

    // A Legacy cast is a resolved no-op, not a pending burn: the failure exit
    // must clear the sequence and show no image.
    expect(burningOverlay(container)).toBeNull();
    expect(spellOverlay(container)).toBeNull();
  });

  it("plays the pre-roll then shows the Subao Ve spell image for a Subao Ve cast", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(subaoVeResult());

    // A Subao Ve cast is not a failure: it now plays the same pre-roll as
    // every other spell, with the image suppressed until the pre-roll ends.
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

  it("keeps the board fully clickable while the burning sequence is shown", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const { container } = render(
      <Chessboard
        board={boardWithRook()}
        turn={Team.White}
        moveMaker="maker-1"
        currentPlayer={{ ...WHITE_PLAYER, isMoveMaker: true }}
        onMove={onMove}
        orientation={Team.White}
        selectedSquareProp={null}
        destinationSquareProp={null}
        pendingPromotionPieceProp={null}
        lastBurnAndPlay={pendingResult("Tia Lua", 42n)}
      />,
    );

    const overlay = burningOverlay(container);
    expect(overlay).not.toBeNull();
    // The overlay carries the .burning-wizard-overlay class, whose CSS sets
    // pointer-events:none, and is aria-hidden so it is not an interactive
    // target. jsdom does not apply stylesheet rules, so the class is the
    // observable contract here.
    expect(overlay).toHaveClass("burning-wizard-overlay");
    expect(overlay).toHaveAttribute("aria-hidden", "true");

    // The sequence does not swallow the tap: the rook's square is still a
    // reachable, enabled button.
    const square = screen.getByRole("button", { name: /Square a1/ });
    await user.click(square);
    expect(square).toBeEnabled();
  });

  it("produces no sound while the burning sequence is shown", () => {
    // The board must not construct or play any audio for the sequence. jsdom
    // has no HTMLMediaElement playback, so the observable contract is that no
    // Audio element is created and no play() is invoked.
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

    renderBoard(pendingResult("Tia Lua", 42n));

    expect(audioSpy).not.toHaveBeenCalled();
    expect(playSpy).not.toHaveBeenCalled();
    expect(playSpyOnProto).not.toHaveBeenCalled();
  });

  it("positions the sequence over the fixed b6-g3 block, mirrored when flipped", () => {
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
});

/* ------------------------------------------------------------------ */
/* Stylesheet contract the burning-wizard layer depends on             */
/* ------------------------------------------------------------------ */

const CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

describe("burning-wizard stylesheet adjacent to the pre-roll change", () => {
  it("keeps the sequence non-interactive, absolutely positioned and beneath the spell overlay", () => {
    const rule = CSS.match(/\.burning-wizard-overlay\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? "";
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/pointer-events:\s*none/);
    // z-index 19, below the spell-effect overlay's 20, so the real spell image
    // wins the render on handoff.
    expect(body).toMatch(/z-index:\s*19/);
  });

  it("keeps each of the three frames mapped to its own asset in play order", () => {
    for (const n of [1, 2, 3]) {
      expect(CSS).toMatch(
        new RegExp(
          `\\.burning-wizard-frame-${n}\\s*\\{[^}]*url\\(["']?/assets/spells/burning-${n}\\.png["']?\\)`,
        ),
      );
    }
  });
});
