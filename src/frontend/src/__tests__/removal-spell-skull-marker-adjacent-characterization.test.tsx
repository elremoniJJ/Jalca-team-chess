import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the behavior ADJACENT to the per-square death-square
 * skull marker change, taken BEFORE the production edit.
 *
 * The request intentionally changes two things:
 *   1. the spell image overlay duration (2s -> 4s), and
 *   2. the burn-and-play result gains a removed-squares field, so the frontend
 *      can render a skull marker on each square where a piece was removed.
 *
 * Neither of those is asserted here. What IS protected is the surrounding
 * overlay behavior the request must not disturb:
 *   - the existing spell image overlay still appears for every enabled removal
 *     spell (ids 3, 4, 6, 10-17) with its own `.spell-effect-<id>` class, in
 *     ADDITION to the new skull markers;
 *   - a shield-cancelled cast still shows the Spell blocked image and a legacy
 *     cast still shows no image;
 *   - the overlay still covers the fixed b6-g3 block and mirrors with the
 *     board's flip;
 *   - the overlay still never intercepts clicks and stays aria-hidden;
 *   - the latch still keeps the overlay mounted when the polled prop goes null
 *     mid-window, and a genuinely new burn still replaces the shown effect;
 *   - the `useShieldResolutionSnapshot` consumer seam still surfaces
 *     `lastBurnAndPlay` and the per-team shield totals.
 *
 * The duration is deliberately NOT pinned: the request changes it from 2s to
 * 4s, so any assertion on the exact 2000ms boundary would be obsolete. The
 * latch test instead asserts the overlay survives a null poll and eventually
 * clears, which holds for either duration.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering and mapping — not real backend
 * behavior. The real burn-and-play path is exercised by the PocketIC lane.
 */

// The Chessboard imports enum values from @/backend at runtime, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the component needs.
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
function firedResult(
  spellName: string,
  overrides: Partial<BurnAndPlayResult> = {},
): BurnAndPlayResult {
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
    ...overrides,
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

/** The 11 enabled removal spells with their id-named overlay class. */
const REMOVAL_SPELLS: Array<{ name: string; id: number }> = [
  { name: "Bendika", id: 3 },
  { name: "Bendika Tah", id: 4 },
  { name: "Mayban Dadoy Tron", id: 6 },
  { name: "Tia Lua", id: 10 },
  { name: "Cau Lua", id: 11 },
  { name: "Hoa Boc", id: 12 },
  { name: "Buc Tung Lua", id: 13 },
  { name: "Mua Lua", id: 14 },
  { name: "Chila Cao", id: 15 },
  { name: "Handom Zitie Zumuc", id: 16 },
  { name: "Bamburgh", id: 17 },
];

describe("Chessboard removal-spell overlay (adjacent characterization)", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("still shows each enabled removal spell's own effect image when it fires", () => {
    for (const spell of REMOVAL_SPELLS) {
      const { container, unmount } = renderBoard(firedResult(spell.name));
      const overlay = spellOverlay(container);
      expect(overlay, `${spell.name} should show an overlay`).not.toBeNull();
      expect(overlay).toHaveClass(`spell-effect-${spell.id}`);
      unmount();
    }
  });

  it("still shows the Spell blocked image when a cast is cancelled by a shield", () => {
    const { container } = renderBoard(cancelledResult("Tia Lua"));

    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass("spell-effect-spell-blocked");
    expect(overlay).not.toHaveClass("spell-effect-10");
  });

  it("still shows no image for a legacy cast with no board effect", () => {
    const { container } = renderBoard(legacyResult("Tia Lua"));

    expect(spellOverlay(container)).toBeNull();
  });

  it("still positions the overlay over the fixed b6-g3 block from the board geometry", () => {
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

  it("still mirrors the overlay geometry when the board is flipped", () => {
    const { container } = renderBoard(firedResult("Tia Lua"), {
      orientation: Team.Black,
    });

    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    // Flipped: columns mirror to 1..6 (same left/width), rows mirror to
    // rank 3..6 from the top (top = 300px, height = 400px).
    expect(overlay).toHaveStyle({
      left: "100px",
      top: "300px",
      width: "600px",
      height: "400px",
    });
  });

  it("still never intercepts clicks and stays aria-hidden while shown", async () => {
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
        lastBurnAndPlay={firedResult("Tia Lua")}
      />,
    );

    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass("spell-effect-overlay");
    expect(overlay).toHaveAttribute("aria-hidden", "true");

    // The overlay does not swallow the tap: clicking the rook's square still
    // reaches the board's own click handler.
    await user.click(screen.getByRole("button", { name: /Square a1/ }));
    expect(screen.getByRole("button", { name: /Square a1/ })).toBeEnabled();
  });

  it("still applies the fade class when motion is allowed and omits it under reduce-motion", () => {
    const { container } = renderBoard(firedResult("Tia Lua"));
    expect(spellOverlay(container)).toHaveClass("spell-effect-overlay-fade");

    cleanup();
    stubMatchMedia(true);
    const { container: reduced } = renderBoard(firedResult("Tia Lua"));
    const overlay = spellOverlay(reduced);
    expect(overlay).not.toBeNull();
    expect(overlay).not.toHaveClass("spell-effect-overlay-fade");
  });

  it("still keeps the overlay mounted when the polled prop goes null mid-window", () => {
    vi.useFakeTimers();
    const result = firedResult("Tia Lua");
    const { container, rerender } = renderBoard(result);

    // The 3s pre-roll plays first; the spell image is suppressed until it
    // completes.
    expect(spellOverlay(container)).toHaveClass(
      "spell-effect-overlay-suppressed",
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).toHaveClass("spell-effect-10");

    // 1s into the spell window, the turn advances and the backend clears the
    // result: the polled prop goes null. The latched burn must keep the
    // overlay mounted.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
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

    // Still mounted right after the prop goes null — the latch survives.
    expect(spellOverlay(container)).toHaveClass("spell-effect-10");

    // The window eventually closes (duration is intentionally not pinned: the
    // request changes it from 2s to 4s). Advance well past either duration.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(spellOverlay(container)).toBeNull();
  });

  it("still replaces the latched effect when a genuinely new burn arrives", () => {
    vi.useFakeTimers();
    const first = firedResult("Tia Lua", { tokenId: 42n });
    const { container, rerender } = renderBoard(first);

    expect(spellOverlay(container)).toHaveClass("spell-effect-10");

    // 1s in, a genuinely NEW burn arrives (different token id). It must
    // replace the latch and show its own effect.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const second = firedResult("Mua Lua", { tokenId: 99n });
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
        lastBurnAndPlay={second}
      />,
    );

    expect(spellOverlay(container)).toHaveClass("spell-effect-14");
  });

  it("still does not restart the effect when the same burn is re-polled", () => {
    vi.useFakeTimers();
    const result = firedResult("Tia Lua");
    const { container, rerender } = renderBoard(result);

    // Complete the pre-roll so the spell image is visible.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(spellOverlay(container)).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // A re-poll delivers the same burn identity — the window must not reset.
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
        lastBurnAndPlay={result}
      />,
    );
    // Advance past the original window; the re-poll must not have extended it.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(spellOverlay(container)).toBeNull();
  });
});

/**
 * The `useShieldResolutionSnapshot` consumer seam. The request adds a
 * removed-squares field to the burn-and-play result; the hook must keep
 * surfacing `lastBurnAndPlay` and the per-team shield totals unchanged so the
 * route can still drive the toast and the board can still read the burn.
 */
const { getShieldResolutionSnapshot, useActorState } = vi.hoisted(() => ({
  getShieldResolutionSnapshot: vi.fn(),
  useActorState: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({ useActorState }));

import type { ShieldResolutionSnapshot } from "@/backend";
import { useShieldResolutionSnapshot } from "@/hooks/use-shield-resolution-snapshot";

function SnapshotHarness() {
  const { data, isLoading } = useShieldResolutionSnapshot();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="white">{data?.whiteShield.toString() ?? "NONE"}</span>
      <span data-testid="black">{data?.blackShield.toString() ?? "NONE"}</span>
      <span data-testid="last">
        {data?.lastBurnAndPlay
          ? `${data.lastBurnAndPlay.spellName}:${data.lastBurnAndPlay.tokenId.toString()}`
          : "NONE"}
      </span>
    </div>
  );
}

function renderHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SnapshotHarness />
    </QueryClientProvider>,
  );
}

function snapshot(
  overrides: Partial<ShieldResolutionSnapshot> = {},
): ShieldResolutionSnapshot {
  return {
    whiteShield: 0n,
    blackShield: 0n,
    ...overrides,
  };
}

describe("useShieldResolutionSnapshot (adjacent characterization)", () => {
  beforeEach(() => {
    getShieldResolutionSnapshot.mockReset();
    useActorState.mockReturnValue({
      actor: { getShieldResolutionSnapshot },
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("still surfaces the per-team shield totals and the pending burn", async () => {
    getShieldResolutionSnapshot.mockResolvedValue(
      snapshot({
        whiteShield: 6n,
        blackShield: 4n,
        lastBurnAndPlay: {
          tokenId: 42n,
          spellName: "Tia Lua",
          gameNumber: 7n,
          team: Team.White,
          kind: SpellKind.Minor,
          removedSquares: [],
          insufficientMaterial: false,
          transformedSquares: [],
        },
      }),
    );
    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("white")).toHaveTextContent("6");
    });
    expect(screen.getByTestId("black")).toHaveTextContent("4");
    expect(screen.getByTestId("last")).toHaveTextContent("Tia Lua:42");
  });

  it("still resolves an absent pending burn to undefined rather than trapping", async () => {
    getShieldResolutionSnapshot.mockResolvedValue(snapshot());
    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("last")).toHaveTextContent("NONE");
  });
});
