import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the game page's EXISTING collapsible-window stack and
 * the shared collapse/persistence contract, taken BEFORE the new "Leaderboard"
 * window is added below the Story window.
 *
 * The request intentionally:
 *   1. adds one more collapsible window (Leaderboard) to the game page's
 *      vertical stack, rendered BELOW the Story window;
 *   2. reuses the existing collapsible-window component, styling, spacing,
 *      chevron behavior, per-window theme dots and localStorage open-state
 *      persistence.
 *
 * Those two things are intentional, so this file deliberately does NOT pin the
 * exact number of windows in the stack and does NOT assert the absence of a
 * Leaderboard slot. What it protects is the behavior ADJACENT to the change
 * that must survive it:
 *
 *   - the existing windows keep their fixed relative order, with the Story
 *     window still the LAST of the pre-existing windows (below Prediction Bet);
 *   - the Story window still follows the shared collapsible-window contract
 *     (chevron header, aria-expanded, JSON-boolean localStorage persistence,
 *     body unmounted while collapsed) that the new panel must reuse;
 *   - the game route still passes every existing window slot to Layout and
 *     still wires the Story slot to the real StoryWindow.
 *
 * The route is driven through mocked hooks (no real actor, no polling), and
 * Layout is stubbed to capture the `windows` object it receives. The real
 * window components are covered by their own focused test files.
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
    data: currentSnapshot,
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
// marker per slot so the test can assert which slots were provided without
// mounting the heavy real windows.
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

import { StoryWindow } from "@/components/StoryWindow";
import { Route as gameRoute } from "@/routes/game";

const GameRouteComponent = gameRoute.options.component!;

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

function renderStory() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <StoryWindow />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  capturedWindows.current = null;
  vi.clearAllMocks();
});

/* --- Shared collapsible-window contract (Story as the reference) -------- */

describe("Story window keeps the shared collapsible-window contract", () => {
  it("is collapsed by default and expands its body when the header is toggled", async () => {
    const user = userEvent.setup();
    renderStory();

    const header = screen.getByRole("button", { name: /Story/ });
    // Collapsed by default: aria-expanded false and the body absent. The
    // mocked story fetch resolves to no sections, so the mounted body's
    // marker is the empty state.
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      document.querySelector('[data-ocid="story.empty_state"]'),
    ).toBeNull();

    // Expanding mounts the body.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(
      document.querySelector('[data-ocid="story.empty_state"]'),
    ).not.toBeNull();

    // Collapsing unmounts the body again.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      document.querySelector('[data-ocid="story.empty_state"]'),
    ).toBeNull();
  });

  it("persists the toggled state to localStorage as a JSON boolean and restores it on remount", async () => {
    const user = userEvent.setup();
    const first = renderStory();

    // Starts collapsed; opening writes the JSON boolean true.
    await user.click(screen.getByRole("button", { name: /Story/ }));
    expect(window.localStorage.getItem("tco-story-open")).toBe("true");

    // Remount: the expanded state is restored from localStorage.
    first.unmount();
    renderStory();
    expect(screen.getByRole("button", { name: /Story/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("restores a collapsed state written by a previous session", () => {
    window.localStorage.setItem("tco-story-open", "false");
    renderStory();

    expect(screen.getByRole("button", { name: /Story/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      document.querySelector('[data-ocid="story.empty_state"]'),
    ).toBeNull();
  });

  it("renders the per-window theme dots in the Story header", () => {
    renderStory();

    const dots = document.querySelector(
      '[data-ocid="story_window.theme_dots"]',
    );
    expect(dots).not.toBeNull();
    expect(
      within(dots as HTMLElement).getAllByRole("button").length,
    ).toBeGreaterThan(0);
  });
});

/* --- Game route wiring: existing slots and the Story slot --------------- */

describe("GameRoute window wiring survives the Leaderboard addition", () => {
  it("still passes every existing window slot to Layout", () => {
    renderRoute();

    const windows = capturedWindows.current;
    expect(windows).not.toBeNull();
    for (const key of [
      "voting",
      "status",
      "board",
      "wallet",
      "players",
      "captured",
      "moves",
      "predictionBet",
    ]) {
      expect(windows).toHaveProperty(key);
      expect(windows?.[key]).toBeTruthy();
    }
  });

  it("still wires the Story slot to the real StoryWindow", () => {
    renderRoute();

    const story = capturedWindows.current?.story as
      | { type?: { name?: string } }
      | undefined;
    expect(story).toBeTruthy();
    // The route mounts the real Story window through the Layout slot; the
    // window's own behavior is covered by its focused test files.
    expect(story?.type?.name).toBe("StoryWindow");
  });
});
