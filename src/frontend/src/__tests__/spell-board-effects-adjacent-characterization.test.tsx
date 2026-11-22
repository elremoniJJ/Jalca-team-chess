import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the behavior ADJACENT to the 12-spell board-effect
 * wiring, taken BEFORE the backend burn-and-play path starts mutating the
 * board for those spells.
 *
 * The request intentionally changes the backend: two shared helpers
 * (`findFirstEmptyFromCentre`, `findFirstEnemyPiece`) and the wiring of 12
 * spells into the burn-and-play path (Bouvet Hondao re-pointed, Conu Bungno
 * placement, and 10 enemy-removal spells). It explicitly does NOT build the
 * Balls palette spells, the friendly-removal trio, the conditional/landing
 * removals, or the transforms/immobilise spells.
 *
 * What IS protected here — the frontend consumer seams those backend changes
 * must not disturb, and which no other suite exercises directly:
 *   1. `useSpellBoardState` still maps the backend's per-team Balls colour
 *      fields (`whiteBallsColour` / `blackBallsColour`) into the `SpellContext`
 *      the board consumes, and still yields `null` (not a stale family) when
 *      the backend reports no family. The Balls palette is explicitly out of
 *      scope for this request, so its consumer mapping must survive untouched.
 *   2. The Chessboard still paints the Balls palette exactly as before: the
 *      viewer's OWN family keeps the light/dark distinction, the OPPONENT's
 *      family renders flat, and no override class is applied when no family is
 *      present. The board-effect wiring must not leak into this purely visual
 *      layer.
 *   3. The burn-and-play toast still renders a Balls spell's kind label and
 *      resolution line verbatim. The request states the toast text and its
 *      math are unchanged.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's mapping and rendering — not real backend
 * behavior. The real `getSpellBoardState` query and the board-effect wiring
 * are exercised by the PocketIC lane when it runs.
 */

// The Chessboard and chess-logic import PieceType/Team as runtime values from
// @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the board needs. The spell
// board effects under test are pure frontend rendering / mapping and never
// touch the actor.
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
}));

// AdvicePopup -> lib/backend-actor imports createActorWithConfig from
// @caffeineai/core-infrastructure, which also fails to resolve its own
// submodules in jsdom. The board rendering under test never calls the actor.
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
}));

import {
  type BallsColourFamily,
  type Piece,
  type PieceType,
  type PlayerInfo,
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

const BLACK_PLAYER: PlayerInfo = {
  principal: "player-2",
  username: "Bob",
  team: Team.Black,
  walletSource: WalletSource.none,
  isMoveMaker: false,
  isFresh: false,
  isInactive: false,
  isBot: false,
};

interface SpellContextFixture {
  blockedSquares?: Set<number>;
  blockedSquareOwners?: Map<number, Team>;
  explosiveSquares?: Set<number>;
  explosiveOwners?: Map<number, Team>;
  whiteBallsColour?: BallsColourFamily | null;
  blackBallsColour?: BallsColourFamily | null;
}

function renderBoard(
  currentPlayer: PlayerInfo,
  spellContext: SpellContextFixture,
) {
  return render(
    <Chessboard
      board={EMPTY_BOARD}
      turn={currentPlayer.team}
      moveMaker="maker-1"
      currentPlayer={currentPlayer}
      onMove={() => {}}
      orientation={Team.White}
      selectedSquareProp={null}
      destinationSquareProp={null}
      pendingPromotionPieceProp={null}
      spellContext={spellContext}
    />,
  );
}

describe("Chessboard Balls palette rendering", () => {
  beforeEach(() => {
    // jsdom lacks these browser APIs the Chessboard relies on.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the light/dark distinction for the viewer's own Balls family", () => {
    // White's board carries the Sandy family. a1 (light) and b1 (dark) must
    // both take the family override while keeping their light/dark tone.
    renderBoard(WHITE_PLAYER, {
      whiteBallsColour: "Sandy" as BallsColourFamily,
    });

    const a1 = screen.getByRole("button", { name: /Square a1/ });
    const b1 = screen.getByRole("button", { name: /Square b1/ });
    expect(a1).toHaveClass("board-square-balls-light");
    expect(b1).toHaveClass("board-square-balls-dark");
  });

  it("renders the opponent's Balls family flat", () => {
    // Black's board carries the Fiery family; a White viewer sees it flat
    // (both tones use the family mid tone, no light/dark distinction).
    renderBoard(BLACK_PLAYER, {
      whiteBallsColour: "Fiery" as BallsColourFamily,
    });

    const a1 = screen.getByRole("button", { name: /Square a1/ });
    const b1 = screen.getByRole("button", { name: /Square b1/ });
    expect(a1).toHaveClass("board-square-balls-flat");
    expect(b1).toHaveClass("board-square-balls-flat");
  });

  it("applies no Balls override when no family is present", () => {
    // No Balls spell has fired on either board: the squares keep only their
    // default light/dark classes and carry no family override.
    renderBoard(WHITE_PLAYER, {});

    const a1 = screen.getByRole("button", { name: /Square a1/ });
    const b1 = screen.getByRole("button", { name: /Square b1/ });
    expect(a1).toHaveClass("board-square-light");
    expect(b1).toHaveClass("board-square-dark");
    expect(a1.className).not.toContain("board-square-balls");
    expect(b1.className).not.toContain("board-square-balls");
  });

  it("prefers the viewer's own family when both teams have one", () => {
    // Both boards carry a family; the viewer's own family wins and keeps the
    // light/dark distinction rather than rendering flat.
    renderBoard(WHITE_PLAYER, {
      whiteBallsColour: "Grassy" as BallsColourFamily,
      blackBallsColour: "Wooden" as BallsColourFamily,
    });

    const a1 = screen.getByRole("button", { name: /Square a1/ });
    const b1 = screen.getByRole("button", { name: /Square b1/ });
    expect(a1).toHaveClass("board-square-balls-light");
    expect(b1).toHaveClass("board-square-balls-dark");
  });
});

/**
 * The `useSpellBoardState` Balls colour mapping. The backend reports each
 * team's active family (or none); the hook must surface it on the
 * `SpellContext` unchanged, and must not invent a family when the backend
 * reports none. The Balls palette is explicitly out of scope for the
 * board-effect request, so this mapping must survive.
 */
const { getSpellBoardState, useActorState } = vi.hoisted(() => ({
  getSpellBoardState: vi.fn(),
  useActorState: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({ useActorState }));

import type { SpellBoardView } from "@/backend";
import { useSpellBoardState } from "@/hooks/use-spell-board-state";

function BallsHarness() {
  const { spellContext, isLoading } = useSpellBoardState();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="white-balls">
        {spellContext?.whiteBallsColour ?? "NONE"}
      </span>
      <span data-testid="black-balls">
        {spellContext?.blackBallsColour ?? "NONE"}
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
      <BallsHarness />
    </QueryClientProvider>,
  );
}

function view(overrides: Partial<SpellBoardView> = {}): SpellBoardView {
  return {
    spellUseEnabled: true,
    blockedSquares: [],
    blockedSquareOwners: [],
    explosiveSquares: [],
    ...overrides,
  };
}

describe("useSpellBoardState Balls colour mapping", () => {
  beforeEach(() => {
    getSpellBoardState.mockReset();
    useActorState.mockReturnValue({
      actor: { getSpellBoardState },
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("surfaces each team's active Balls family independently", async () => {
    getSpellBoardState.mockResolvedValue(
      view({
        whiteBallsColour: "Sandy" as BallsColourFamily,
        blackBallsColour: "Fiery" as BallsColourFamily,
      }),
    );
    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("white-balls")).toHaveTextContent("Sandy");
    });
    expect(screen.getByTestId("black-balls")).toHaveTextContent("Fiery");
  });

  it("yields no family when the backend reports none", async () => {
    getSpellBoardState.mockResolvedValue(view());
    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("white-balls")).toHaveTextContent("NONE");
    expect(screen.getByTestId("black-balls")).toHaveTextContent("NONE");
  });
});
