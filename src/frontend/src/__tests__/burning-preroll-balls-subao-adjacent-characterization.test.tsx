import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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
 * what a Subao Ve cast currently renders, nor what a Balls cast currently
 * renders, nor whether the Balls sequence currently loops. Freezing either
 * would protect the behavior the request intentionally changes.
 *
 * What IS protected is the adjacent, currently-working behavior the change
 * must not disturb:
 *   1. a fired non-Balls, non-Subao-Ve spell (Tia Lua) still plays the 3-frame
 *      pre-roll first, one frame per second, with the spell image suppressed
 *      until the pre-roll completes;
 *   2. that spell's image still takes over on handoff and the burning sequence
 *      stops (the overlay is gone);
 *   3. a cast cancelled by a shield still shows the supplied Spell blocked
 *      image and the sequence stops;
 *   4. the opponent-board redone squares still appear for a fired Balls cast
 *      (the per-square opponent-image layer is driven by `spellContext`, not by
 *      the spell-effect overlay, so it must survive the overlay change);
 *   5. the default route still renders a visible, non-empty screen.
 *
 * The backend actor is a typed local mock (or absent entirely for the pure
 * rendering surfaces), so this is component/integration coverage of the
 * frontend's rendering — not real backend behavior. See episode.coverageLimits.
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
  OpponentBoardImage,
  type Piece,
  type PieceType,
  type PlayerInfo,
  SpellKind,
  SpellResolutionOutcome,
  Team,
  WalletSource,
} from "@/backend";
import { Chessboard } from "@/components/Chessboard";
import type { SpellContext } from "@/lib/chess-logic";

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

/** A fired burn-and-play result for the given spell name and kind. */
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

function renderBoard(
  lastBurnAndPlay: BurnAndPlayResult | null,
  spellContext?: SpellContext,
) {
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
      spellContext={spellContext}
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

describe("burning pre-roll adjacent to the Subao Ve and Balls changes", () => {
  beforeEach(() => {
    stubResizeObserver(800);
    stubMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("still plays the 3-frame pre-roll first for a fired non-Balls spell", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(firedResult("Tia Lua"));

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

  it("still hands off to the spell image and stops the sequence after the pre-roll", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(firedResult("Tia Lua"));

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

  it("still shows the Spell blocked image and stops the sequence for a shield-cancelled cast", () => {
    vi.useFakeTimers();
    const { container } = renderBoard(cancelledResult("Tia Lua"));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    const spell = spellOverlay(container);
    expect(spell).not.toBeNull();
    expect(spell).toHaveClass("spell-effect-spell-blocked");
    expect(spell).not.toHaveClass("spell-effect-10");
    expect(burningOverlay(container)).toBeNull();
  });

  it("still paints the opponent-board redone squares for a fired Balls cast", () => {
    // The per-square opponent-image layer is driven by `spellContext`, which
    // the backend sets when a Balls spell fires on the opponent's board. It is
    // independent of the spell-effect overlay, so it must survive the overlay
    // change. A White viewer whose opponent (Black) cast Hairy Balls sees the
    // image on every square of their own board.
    const { container } = renderBoard(
      firedResult("Hairy Balls", {
        kind: SpellKind.Balls,
      }),
      {
        whiteOpponentImage: OpponentBoardImage.Hairy,
      },
    );

    const board = container.querySelector("[data-ocid='chess.board']");
    expect(board).not.toBeNull();
    expect(board).toHaveClass("board-opponent-image");

    const squares = container.querySelectorAll("[data-ocid^='chess.square.']");
    expect(squares.length).toBe(64);
    for (const square of squares) {
      expect(square).toHaveClass("board-square-opponent-image-hairy");
    }
  });

  it("still leaves the caster's own board untouched for a fired Balls cast", () => {
    // White cast Hairy Balls: the backend sets blackOpponentImage (it covers
    // Black's board). A White viewer — the caster — sees no image on their own
    // board.
    const { container } = renderBoard(
      firedResult("Hairy Balls", {
        kind: SpellKind.Balls,
      }),
      {
        blackOpponentImage: OpponentBoardImage.Hairy,
      },
    );

    const board = container.querySelector("[data-ocid='chess.board']");
    expect(board).not.toHaveClass("board-opponent-image");
    const squares = container.querySelectorAll("[data-ocid^='chess.square.']");
    expect(squares.length).toBe(64);
    for (const square of squares) {
      expect(square.className).not.toMatch(/board-square-opponent-image-/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Default route still renders a visible screen                        */
/* ------------------------------------------------------------------ */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { configure } from "@testing-library/react";

configure({ testIdAttribute: "data-ocid" });

// The login route imports WalletSource as a runtime value from @/backend; the
// module is already mocked above with the enum values the route needs. The
// route also consumes useInternetIdentity() and the identity hooks; mock them
// with inert states so the real render path mounts without network access.
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
  useInternetIdentity: () => ({
    identity: null,
    isAuthenticated: false,
    isLoggingIn: false,
    login: vi.fn(),
    loginError: null,
  }),
}));

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useWalletAddress: () => ["", vi.fn()],
  startSpectating: vi.fn(() => "spectator-suffix"),
  generateRankedKey: vi.fn(() => "ranked-key-generated"),
  setRankedIdentity: vi.fn(),
  isSpectating: () => false,
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

vi.mock("@/lib/audio-unlock", () => ({ unlockAudio: vi.fn() }));

const actorState = vi.hoisted(() => ({
  actor: {} as Record<string, unknown> | null,
  isLoading: false,
  error: null as Error | null,
  retry: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: actorState.actor,
    isLoading: actorState.isLoading,
    error: actorState.error,
    retry: actorState.retry,
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

import { Route as rootRoute } from "@/routes/__root";
import { Route as indexRoute } from "@/routes/index";

function buildRouter() {
  const root = createRootRoute({
    component: rootRoute.options.component,
    errorComponent: rootRoute.options.errorComponent,
  });
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: indexRoute.options.component,
  });
  return createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

function renderDefaultRoute() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={buildRouter()} />
    </QueryClientProvider>,
  );
}

describe("default route still renders a visible screen (adjacent characterization)", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    actorState.actor = {};
    actorState.isLoading = false;
    actorState.error = null;
    vi.clearAllMocks();
  });

  it("renders the login form with the Player/Spectator toggle once the actor is ready", async () => {
    actorState.actor = {};

    const { container } = renderDefaultRoute();

    expect(await screen.findByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByTestId("login.mode_toggle")).toBeInTheDocument();
    expect(screen.getByTestId("login.primary_button")).toBeInTheDocument();
    expect(
      screen.getByTestId("login.internet_identity_button"),
    ).toBeInTheDocument();
    // The rendered tree is not empty — the user does not get a blank page.
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });
});
