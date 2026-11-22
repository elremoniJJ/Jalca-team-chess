import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted fire-and-deplete spell outcome at the frontend
 * consumer seam.
 *
 * The request widens offensive-spell resolution: a spell whose power is at
 * least DOUBLE the defender's current Subao Ve shield now depletes that shield
 * to zero AND still takes effect on the board. The backend reports this as the
 * existing `#fired` outcome with `shieldAfter = 0` and `firesOnBoard = true` —
 * the same shape as a spell that strictly exceeded the shield. The frontend
 * therefore must render it exactly like any other fired spell:
 *   - the burn-and-play toast reads "Fired on the board — <value> vs <team>
 *     shield <before> → 0.", never the cancelled wording;
 *   - the Chessboard spell-effect overlay shows the cast spell's own effect
 *     image, never the Spell blocked image.
 *
 * The adjacent outcomes are protected separately: the strict-exceed fired case
 * and the cancelled case in burn-play-toast.test.tsx and
 * chessboard-spell-effect-overlay-cover.test.tsx. This file pins the NEW
 * double-shield branch through the same two consumers.
 *
 * These are component contracts driven by the `BurnAndPlayResult` the route
 * supplies. The backend resolution math itself is NOT exercised here; the
 * PocketIC lane cannot observe it either (the external collection canister is
 * absent), so it remains a coverage limit.
 */

// The Chessboard imports runtime enum values from @/backend, which transitively
// pulls in @caffeineai/object-storage and @caffeineai/core-infrastructure.
// Those packages fail to resolve their own submodules in jsdom, so mock the
// backend module with the enum values the board and toast need. Neither
// component under test touches the actor.
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
import { BurnPlayToast } from "@/components/BurnPlayToast";
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

function boardWithRook(): Array<Piece | null> {
  const board = [...EMPTY_BOARD];
  board[0] = {
    pieceType: "Rook" as PieceType,
    color: Team.White,
    summoned: false,
  };
  return board;
}

/**
 * A fire-and-deplete result: the spell value is at least double the shield, so
 * the shield drops to zero and the spell still fires on the board. The backend
 * reports this as `#fired` with `shieldAfter = 0`.
 */
function fireAndDepleteResult(
  spellName: string,
  overrides: Partial<BurnAndPlayResult> = {},
): BurnAndPlayResult {
  return {
    tokenId: 77n,
    spellName,
    gameNumber: 7n,
    team: Team.White,
    kind: SpellKind.Major,
    resolution: {
      attacker: Team.White,
      defender: Team.Black,
      spellValue: 10n,
      shieldBefore: 4n,
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

function spellOverlay(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    '[data-ocid="chess.spell_effect"]',
  );
}

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("fire-and-deplete outcome — burn-and-play toast", () => {
  it("reads a double-shield fired spell as fired on the board, not cancelled", () => {
    render(
      <BurnPlayToast
        toasts={[{ id: "burn-1", result: fireAndDepleteResult("Tia Lua") }]}
        onClose={vi.fn()}
      />,
    );

    // The shield was depleted to zero and the spell still fired.
    expect(
      screen.getByText(/Fired on the board — 10 vs Black shield 4 → 0\./),
    ).toBeInTheDocument();
    // It must never be mistaken for a cancelled cast.
    expect(screen.queryByText(/Cancelled/)).not.toBeInTheDocument();
  });

  it("keeps the strict-exceed fired wording unchanged", () => {
    // A spell that strictly exceeds the shield (value > shield, but not double)
    // is the pre-existing fired branch and must render identically.
    render(
      <BurnPlayToast
        toasts={[
          {
            id: "burn-1",
            result: fireAndDepleteResult("Tia Lua", {
              resolution: {
                attacker: Team.White,
                defender: Team.Black,
                spellValue: 5n,
                shieldBefore: 4n,
                shieldAfter: 0n,
                outcome: SpellResolutionOutcome.fired,
                firesOnBoard: true,
              },
            }),
          },
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Fired on the board — 5 vs Black shield 4 → 0\./),
    ).toBeInTheDocument();
  });
});

describe("fire-and-deplete outcome — Chessboard spell-effect overlay", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

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

  it("shows the spell's own effect image for a double-shield fired cast", () => {
    const { container } = renderBoard(fireAndDepleteResult("Tia Lua"));

    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    // Tia Lua is spell id 10; the fired branch shows its own effect image.
    expect(overlay).toHaveClass("spell-effect-10");
    // It must never show the Spell blocked image used for cancelled casts.
    expect(overlay).not.toHaveClass("spell-effect-spell-blocked");
  });

  it("still shows the Spell blocked image for a cancelled cast", () => {
    const { container } = renderBoard(
      fireAndDepleteResult("Tia Lua", {
        resolution: {
          attacker: Team.White,
          defender: Team.Black,
          spellValue: 2n,
          shieldBefore: 6n,
          shieldAfter: 4n,
          outcome: SpellResolutionOutcome.cancelled,
          firesOnBoard: false,
        },
      }),
    );

    const overlay = spellOverlay(container);
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass("spell-effect-spell-blocked");
    expect(overlay).not.toHaveClass("spell-effect-10");
  });
});
