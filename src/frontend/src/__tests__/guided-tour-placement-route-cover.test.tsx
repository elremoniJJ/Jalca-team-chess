import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The game route, Layout and tour carry deterministic `data-ocid` markers
// rather than `data-testid`. Configure the test-id attribute so getByTestId
// can target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted guided-tour PLACEMENT change at the ROUTE level.
 *
 * The focused component cover (guided-tour-placement-cover.test.tsx) proves the
 * placement math against a synthetic target. This file proves the accepted
 * behavior end-to-end through the real /game route and the real Layout, which
 * the component tests cannot see:
 *
 *   - starting the tour on /game shows the card FULLY VISIBLE in the viewport
 *     next to the highlighted window, with no scrolling required;
 *   - the card and the highlight ring stay aligned with the highlighted window
 *     on window resize (both re-read the target's rect);
 *   - on a mobile viewport the card and the highlighted window are both visible
 *     together without the card being cut off.
 *
 * jsdom does not lay out elements, so getBoundingClientRect is stubbed to a
 * deterministic rect for the highlighted window and the card. This is
 * component/integration coverage, not deployed browser E2E. The backend is
 * entirely mocked, so this proves nothing about real backend behavior.
 */

// The route transitively imports components that read these enum values at
// module load. The generated @/backend module pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure, which fail
// to resolve their own submodules in the jsdom test environment (a pre-existing
// dependency issue), so mock the backend module with the enum values needed.
vi.mock("@/backend", () => ({
  EndState: {
    Draw: "Draw",
    Checkmate: "Checkmate",
    Timeout: "Timeout",
    Stalemate: "Stalemate",
    InsufficientMaterial: "InsufficientMaterial",
  },
  GamePhase: {
    Paused: "Paused",
    Draw: "Draw",
    Playing: "Playing",
    Celebration: "Celebration",
  },
  GameResult: { Draw: "Draw", Black: "Black", White: "White" },
  GameResult__1: { Draw: "Draw", BlackWin: "BlackWin", WhiteWin: "WhiteWin" },
  Team: { Black: "Black", White: "White" },
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  SpellKind: {
    SubaoVe: "SubaoVe",
    Minor: "Minor",
    Major: "Major",
    Balls: "Balls",
  },
  SpellResolutionOutcome: {
    fired: "fired",
    cancelled: "cancelled",
    legacy: "legacy",
  },
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
  ExerciseKind: {
    NinjaRoll: "NinjaRoll",
    PushUps: "PushUps",
    Squats: "Squats",
    Cartwheel: "Cartwheel",
    Crunches: "Crunches",
  },
  RecipientRole: { Drawer: "Drawer", Winner: "Winner" },
  SpellCategory: { Block: "Block", Major: "Major", Minor: "Minor" },
  TriggerType: {
    Capture: "Capture",
    EnPassant: "EnPassant",
    Castling: "Castling",
    Check: "Check",
  },
  Pot: {
    One: "One",
    Ten: "Ten",
    Hundred: "Hundred",
    Thousand: "Thousand",
  },
  GameOutcome: { white: "white", black: "black", draw: "draw" },
}));

// Mutable connection state the route reads through its mocked hooks. Each test
// sets the state it needs before rendering.
const { actorState, gameState } = vi.hoisted(() => ({
  actorState: {
    actor: {} as Record<string, unknown> | null,
    isLoading: false,
    error: null as Error | null,
    retry: vi.fn(),
  },
  gameState: {
    data: null as Record<string, unknown> | null,
    isLoading: false,
    error: null as Error | null,
  },
}));

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useActiveIdentity: () => "player-1",
  useRankedSession: () => false,
  useSpectator: () => null,
  isSpectating: () => false,
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity: vi.fn(),
  clearRankedIdentity: vi.fn(),
  clearRankedSession: vi.fn(),
  clearSpectator: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "",
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => actorState,
  getActor: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/hooks/use-heartbeat", () => ({
  useHeartbeat: () => ({ pingNow: vi.fn() }),
}));
vi.mock("@/hooks/use-sound-effects", () => ({ useSoundEffects: () => {} }));

vi.mock("@/hooks/use-game-state", () => ({
  useGameState: () => ({
    data: gameState.data,
    isLoading: gameState.isLoading,
    error: gameState.error,
    moves: [],
    lastMove: null,
    prevBoard: null,
    checkSquare: null,
  }),
}));

vi.mock("@/hooks/use-game-record", () => ({
  useGameRecord: () => ({ data: null, loading: false, error: null }),
}));

vi.mock("@/hooks/use-game-meta", () => ({
  useGameMeta: () => ({ gameNumber: 1n, isLoading: false, error: null }),
}));

vi.mock("@/hooks/use-spell-board-state", () => ({
  useSpellBoardState: () => ({
    spellContext: undefined,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-shield-resolution-snapshot", () => ({
  useShieldResolutionSnapshot: () => ({
    data: undefined,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-mint-attempts", () => ({
  useMintAttemptsByGame: () => ({
    groups: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-resign", () => ({
  useResignState: () => null,
  useCastResignVote: () => ({ mutate: vi.fn(), isPending: false }),
  useWithdrawResignVote: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-board-frames", () => ({ useBoardFrames: () => null }));
vi.mock("@/hooks/use-kick", () => ({
  useKickBot: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null, reset: vi.fn() }),
  useKickState: () => ({ kickState: null, isLoading: false, error: null }),
  useCastKickVote: () => ({ mutate: vi.fn(), isPending: false }),
  useWithdrawKickVote: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-voting", () => ({
  useCastVote: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useVoteTally: () => ({ tally: null, isLoading: false, error: null }),
  useGameSettingsSnapshot: () => ({
    snapshot: null,
    isLoading: false,
    error: null,
  }),
  useNextGameSettings: () => ({
    settings: null,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-exercise-assignments", () => ({
  useExerciseAssignments: () => ({ assignments: [] }),
}));
vi.mock("@/hooks/use-drinking-assignments", () => ({
  useDrinkingAssignments: () => ({ assignments: [] }),
}));
vi.mock("@/hooks/use-game-mode", () => ({
  useGameMode: () => ({ mode: "off", setMode: vi.fn(), cycle: vi.fn() }),
}));

vi.mock("@/lib/use-pbpp-bet", () => ({
  usePbppBet: () => ({
    connection: { status: "disconnected" },
    connect: vi.fn(),
    disconnect: vi.fn(),
    signerAvailable: true,
    anonymous: false,
    setAnonymous: vi.fn(),
    submitState: { status: "idle" },
    submitBet: vi.fn(),
    approveAllowance: vi.fn(),
    checkAllowance: vi.fn().mockResolvedValue(null),
    relayState: { status: "idle" },
    relayBet: vi.fn(),
    getRealBets: vi.fn().mockResolvedValue([]),
    getSettlements: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// Heavy board/overlay children are stubbed so the route mounts cheaply. The
// real Layout is kept so the board window marker (window.board) is the real
// one the tour targets.
vi.mock("@/components/Chessboard", () => ({
  Chessboard: () => <div data-testid="chessboard" />,
}));
vi.mock("@/components/CelebrationOverlay", () => ({
  CelebrationOverlay: () => <div data-testid="celebration-overlay" />,
}));
vi.mock("@/components/TurnAnnouncementOverlay", () => ({
  TurnAnnouncementOverlay: () => <div data-testid="turn-announcement" />,
}));
vi.mock("@/components/EndGameModal", () => ({
  EndGameModal: () => <div data-testid="end-game-modal" />,
}));
vi.mock("@/components/ExerciseToasts", () => ({
  ExerciseToasts: () => <div data-testid="exercise-toasts" />,
}));
vi.mock("@/components/DrinkingToasts", () => ({
  DrinkingToasts: () => <div data-testid="drinking-toasts" />,
}));
vi.mock("@/components/GameModeSelector", () => ({
  GameModeSelector: () => <div data-testid="game-mode-selector" />,
}));
vi.mock("@/components/CapturedTray", () => ({
  CapturedTray: () => <div data-testid="captured-tray" />,
}));
vi.mock("@/components/WalletConnectionWindow", () => ({
  WalletConnectionWindow: () => <div data-testid="wallet-window" />,
}));
vi.mock("@/components/PlayerList", () => ({
  PlayerList: () => <div data-testid="player-list" />,
}));
vi.mock("@/components/MoveHistory", () => ({
  MoveHistory: () => <div data-testid="move-history" />,
}));
vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));
// The Story window consumes useInternetIdentity(), which requires an
// InternetIdentityProvider this test does not mount. Its own behavior is
// covered by its focused test files; here it is stubbed so the ready state
// mounts cheaply and the real Layout (and its board window marker) is what we
// assert.
vi.mock("@/components/StoryWindow", () => ({
  StoryWindow: () => <div data-testid="story-window" />,
}));

import { GUIDED_TOUR_STEPS } from "@/components/GuidedTour";
import { GUIDE_PENDING_KEY } from "@/lib/guide-preference";
import { Route as gameRoute } from "@/routes/game";

const GameRouteComponent = gameRoute.options.component!;

// The first tour step highlights the voting window; the route's real Layout
// renders it with this marker.
const FIRST_TARGET_OCID = GUIDED_TOUR_STEPS[0].targetOcid;

// A deterministic on-screen rect for the highlighted window and the card.
// jsdom reports an all-zero rect for every element, so the tour's placement
// math would otherwise have nothing to work with.
const TARGET_RECT = { top: 300, left: 200, width: 400, height: 120 };
const CARD_RECT = { top: 0, left: 0, width: 384, height: 200 };

// The rect the highlighted target currently reports. Tests mutate this to
// simulate the window moving, then dispatch resize.
let currentTargetRect = { ...TARGET_RECT };

function makeRect(rect: {
  top: number;
  left: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect,
  } as DOMRect;
}

// Records every window.scrollTo call so a test can assert the page scrolled
// once to bring the target into view.
let scrollToCalls: Array<{ top?: number; behavior?: string }> = [];

function installRectStub() {
  currentTargetRect = { ...TARGET_RECT };
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.getAttribute("data-ocid") === FIRST_TARGET_OCID) {
        return makeRect(currentTargetRect);
      }
      // The card reports a deterministic height so the placement math has a
      // real card size to work with; every other element reports zero.
      if (this.getAttribute("data-ocid") === "guided_tour.card") {
        return makeRect(CARD_RECT);
      }
      return makeRect({ top: 0, left: 0, width: 0, height: 0 });
    },
  );
}

const readySnapshot = {
  phase: "Playing",
  board: [],
  players: [
    {
      principal: "player-1",
      username: "Ada",
      team: "White",
      isMoveMaker: true,
    },
  ],
  turn: "White",
  moveMaker: "player-1",
  timerRemainingMs: 300000n,
  winner: undefined,
  celebrationSecondsLeft: undefined,
  openingName: "Italian Game - Giuoco Piano",
  spellUseEnabled: false,
};

function renderRoute() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GameRouteComponent />
    </QueryClientProvider>,
  );
}

describe("Guided tour placement on /game (route cover)", () => {
  beforeEach(() => {
    scrollToCalls = [];
    // jsdom's window.scrollTo is a throwing "not implemented" stub. Replace it
    // with a recorder so the tour's single scroll call is observable and the
    // resize/mobile tests do not emit jsdom noise.
    vi.spyOn(window, "scrollTo").mockImplementation(((
      options?: ScrollToOptions | number,
    ) => {
      if (typeof options === "object" && options !== null) {
        scrollToCalls.push({ top: options.top, behavior: options.behavior });
      } else {
        scrollToCalls.push({ top: options });
      }
    }) as typeof window.scrollTo);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
    actorState.actor = {};
    actorState.isLoading = false;
    actorState.error = null;
    gameState.data = null;
    gameState.isLoading = false;
    gameState.error = null;
  });

  it("shows the card fully visible next to the highlighted window with no scrolling required", async () => {
    installRectStub();
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    gameState.data = readySnapshot;
    renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId("guided_tour.card")).toBeInTheDocument();
    });

    const card = screen.getByTestId("guided_tour.card");
    const top = Number.parseFloat(card.style.top);
    const left = Number.parseFloat(card.style.left);
    const width = Number.parseFloat(card.style.width);
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    // The card is fully inside the viewport: it never runs off any edge, so
    // the user does not need to scroll to read it.
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top + CARD_RECT.height).toBeLessThanOrEqual(viewportH);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + width).toBeLessThanOrEqual(viewportW);

    // It sits next to the highlighted window (below it, since there is room),
    // not pinned to the viewport bottom.
    expect(top).toBeGreaterThanOrEqual(TARGET_RECT.top + TARGET_RECT.height);
    expect(top + CARD_RECT.height).toBeLessThan(viewportH);

    // The highlight ring is aligned with the highlighted window.
    const highlight = screen.getByTestId("guided_tour.highlight");
    expect(highlight.style.top).toBe(`${TARGET_RECT.top - 4}px`);
    expect(highlight.style.left).toBe(`${TARGET_RECT.left - 4}px`);

    // The page scrolled at most once to bring the target into view; it did not
    // scroll repeatedly.
    expect(scrollToCalls.length).toBeLessThanOrEqual(1);
  });

  it("keeps the card and highlight ring aligned with the highlighted window on resize", async () => {
    installRectStub();
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    gameState.data = readySnapshot;
    renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId("guided_tour.card")).toBeInTheDocument();
    });

    const card = screen.getByTestId("guided_tour.card");
    const highlight = screen.getByTestId("guided_tour.highlight");
    const cardLeftBefore = card.style.left;
    const highlightLeftBefore = highlight.style.left;

    // The highlighted window moves on screen; a resize must make the tour
    // re-read its rect so both the card and the ring follow it.
    currentTargetRect = { ...TARGET_RECT, left: 600, top: 200 };
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    // The highlight ring tracks the target's new rect.
    expect(highlight.style.left).toBe(`${currentTargetRect.left - 4}px`);
    expect(highlight.style.top).toBe(`${currentTargetRect.top - 4}px`);
    // The card follows the target horizontally so it stays beside the
    // highlighted window rather than drifting away from it.
    expect(card.style.left).not.toBe(cardLeftBefore);
    expect(highlight.style.left).not.toBe(highlightLeftBefore);
  });

  it("keeps the card and highlighted window both visible on a mobile viewport", async () => {
    installRectStub();
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 360,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 640,
    });

    try {
      window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
      gameState.data = readySnapshot;
      renderRoute();

      await waitFor(() => {
        expect(screen.getByTestId("guided_tour.card")).toBeInTheDocument();
      });

      const card = screen.getByTestId("guided_tour.card");
      const top = Number.parseFloat(card.style.top);
      const left = Number.parseFloat(card.style.left);
      const width = Number.parseFloat(card.style.width);
      const maxHeight = Number.parseFloat(card.style.maxHeight);

      // The card is fully inside the narrow viewport horizontally and its
      // height is capped so it scrolls internally rather than being cut off.
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(360);
      expect(maxHeight).toBeLessThanOrEqual(640);
      expect(top).toBeGreaterThanOrEqual(0);

      // The highlighted window is still on screen and the ring is aligned
      // with it, so both are visible together.
      const highlight = screen.getByTestId("guided_tour.highlight");
      expect(highlight.style.top).toBe(`${TARGET_RECT.top - 4}px`);
      expect(highlight.style.left).toBe(`${TARGET_RECT.left - 4}px`);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalHeight,
      });
    }
  });
});
