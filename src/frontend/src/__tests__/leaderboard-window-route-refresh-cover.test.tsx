import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the game route's Leaderboard wiring and its post-game refresh.
 *
 * The request adds a "Leaderboard" collapsible window below the Story window
 * and requires the ranking to be refreshed when the panel is opened and again
 * after a game concludes, so a fresh win appears without a page reload.
 *
 * This file protects the two route-level seams the window's own focused tests
 * cannot see:
 *   1. the route passes a `leaderboard` slot to Layout, wired to the real
 *      LeaderboardWindow (the sibling route-wiring characterization file
 *      deliberately asserts only the pre-existing slots);
 *   2. the route invalidates the leaderboard query key on the transition INTO
 *      Celebration/Draw, which is what refetches an open panel after a game
 *      concludes.
 *
 * The route is driven through mocked hooks (no real actor, no polling) and
 * Layout is stubbed to capture the `windows` object it receives. The real
 * window component is covered by leaderboard-window-cover.test.tsx.
 */

// The route imports SpellUse/StartingPosition/GamePhase/Team/PieceType as
// runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test
// environment (a pre-existing dependency issue), so mock the backend module
// with the enum values the route and its children need.
vi.mock("@/backend", () => ({
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
  GamePhase: {
    Paused: "Paused",
    Draw: "Draw",
    Playing: "Playing",
    Celebration: "Celebration",
  },
  Team: { Black: "Black", White: "White" },
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  GameResult: { Draw: "Draw", BlackWin: "BlackWin", WhiteWin: "WhiteWin" },
  EndState: {
    Draw: "Draw",
    Checkmate: "Checkmate",
    Timeout: "Timeout",
    Stalemate: "Stalemate",
  },
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

// The live game phase the route reads. Flipped per test to drive the
// non-celebration → celebration transition that must invalidate the
// leaderboard query.
const { phaseState } = vi.hoisted(() => ({
  phaseState: { phase: "Playing" as string },
}));

const { currentSnapshot } = vi.hoisted(() => {
  const currentSnapshot = {
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
    openingName: undefined,
    spellUseEnabled: false,
  };
  return { currentSnapshot };
});

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "",
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {},
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/hooks/use-heartbeat", () => ({ useHeartbeat: () => {} }));
vi.mock("@/hooks/use-sound-effects", () => ({ useSoundEffects: () => {} }));

vi.mock("@/hooks/use-game-state", () => ({
  useGameState: () => ({
    data: { ...currentSnapshot, phase: phaseState.phase },
    isLoading: false,
    error: null,
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
  useGameMeta: () => ({ gameNumber: 7n, isLoading: false, error: null }),
}));

vi.mock("@/hooks/use-spell-board-state", () => ({
  useSpellBoardState: () => ({
    spellContext: undefined,
    isLoading: false,
    error: null,
  }),
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

vi.mock("@/hooks/use-kick", () => ({
  useKickState: () => ({ kickState: null, isLoading: false, error: null }),
  useCastKickVote: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useWithdrawKickVote: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
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

// Capture the `windows` object the route hands to Layout. The stub renders a
// marker so the test can assert which slots were provided without mounting the
// heavy real windows.
const { capturedWindows } = vi.hoisted(() => ({
  capturedWindows: { current: null as Record<string, unknown> | null },
}));

vi.mock("@/components/Layout", () => ({
  Layout: ({ windows }: { windows: Record<string, unknown> }) => {
    capturedWindows.current = windows;
    return <div data-testid="layout-stub" />;
  },
}));

// Heavy board/overlay children are stubbed so the route mounts cheaply.
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

// The real Layout imports InformationModal, which transitively pulls in
// @caffeineai/core-infrastructure via CanisterCyclesGauge. That package fails
// to resolve its own submodules in the jsdom test environment (a pre-existing
// dependency issue), so mock the modal to a marker. The test never opens it.
vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));

// StoryWindow is the only consumer of useInternetIdentity() in the app. The
// real @caffeineai/core-infrastructure package fails to resolve its own
// submodules in the jsdom environment (a pre-existing dependency issue), so
// mock the hook with a signed-out local state.
vi.mock("@caffeineai/core-infrastructure", () => ({
  useInternetIdentity: () => ({
    identity: null,
    login: vi.fn(),
    clear: vi.fn(),
    isAuthenticated: false,
    isLoggingIn: false,
    loginError: null,
  }),
}));

// The Story data layer reaches the backend through useActorState() from
// lib/backend-actor. The route-level mock above returns an empty actor; the
// Story window's own focused tests cover its data behavior. Here we only need
// the window to mount and expose its collapse contract.
vi.mock("@/hooks/use-story", () => ({
  useStorySections: () => ({
    sections: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAppendStorySection: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useFillStoryGap: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  usePressStoryDelete: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  usePressStoryKeep: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import {
  LEADERBOARD_QUERY_KEY,
  PAST_WINNERS_QUERY_KEY,
  SUNDAY_COMP_STANDINGS_QUERY_KEY,
} from "@/hooks/use-leaderboard";
import { Route as gameRoute } from "@/routes/game";

const GameRouteComponent = gameRoute.options.component!;

function renderRoute() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <GameRouteComponent />
      </QueryClientProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  capturedWindows.current = null;
  phaseState.phase = "Playing";
  vi.clearAllMocks();
});

/* --- Route wiring: the new Leaderboard slot ----------------------------- */

describe("GameRoute wires the Leaderboard window below Story", () => {
  it("passes a leaderboard slot to Layout wired to the real LeaderboardWindow", () => {
    renderRoute();

    const leaderboard = capturedWindows.current?.leaderboard as
      | { type?: { name?: string } }
      | undefined;
    expect(leaderboard).toBeTruthy();
    // The route mounts the real Leaderboard window through the Layout slot;
    // the window's own behavior is covered by leaderboard-window-cover.test.tsx.
    expect(leaderboard?.type?.name).toBe("LeaderboardWindow");
  });
});

/* --- Post-game refresh: invalidate the leaderboard query key ------------ */

describe("GameRoute refreshes the leaderboard after a game concludes", () => {
  it("invalidates the leaderboard query key on the transition into Celebration", () => {
    // Render once with the game still Playing, then flip the phase and rerender
    // the SAME tree so the route's celebration-transition effect observes the
    // non-celebration → celebration edge. A fresh QueryClient per render would
    // hide the invalidation on the client the effect actually uses.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const view = render(
      <QueryClientProvider client={queryClient}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );

    // The game concludes: the phase flips from Playing into Celebration. The
    // route's celebration-transition effect must invalidate the leaderboard
    // query key so an open panel refetches the fresh win without a reload.
    phaseState.phase = "Celebration";
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: LEADERBOARD_QUERY_KEY,
    });
  });

  it("invalidates the Sunday comp standings and Past winners keys on the transition into Celebration", () => {
    // The Sunday comp view is refreshed alongside the All time board so an
    // open Sunday comp view shows a fresh win without a page reload. The
    // route must invalidate both Sunday keys on the same celebration edge.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const view = render(
      <QueryClientProvider client={queryClient}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );

    phaseState.phase = "Celebration";
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: SUNDAY_COMP_STANDINGS_QUERY_KEY,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: PAST_WINNERS_QUERY_KEY,
    });
  });
});
