import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The game route and its children carry deterministic `data-ocid` markers
// rather than `data-testid`. Configure the test-id attribute so getByTestId
// can target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Game-route gating cover for the guided tour (new coverage only — no existing
 * test file is edited).
 *
 * The tour component itself is covered by guided-tour-behavior.test.tsx. This
 * file covers the /game route's decision to MOUNT it, which the component
 * tests cannot see:
 *
 *   - the tour auto-starts only once the board window is present AND the
 *     game.loading_state element is gone (the "board ready" gate);
 *   - the Layout "Replay guide" button restarts the tour at step 1 even when
 *     the login toggle is off (no pending flag);
 *   - the tour ends (and the pending flag is cleared) when the end-game modal
 *     or the celebration overlay appears mid-tour.
 *
 * The backend actor and the route's data hooks are mocked; this is
 * component/integration coverage, not deployed browser E2E.
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
}));

// The route's hooks. We mock every hook the route consumes so the test can
// drive the phase transitions deterministically without a real actor or the
// heavy polling hooks.
const { currentSnapshot, actorLoading } = vi.hoisted(() => {
  const currentSnapshot: {
    phase: string;
    board: Array<{ pieceType: string; color: string } | null>;
    players: Array<{
      principal: string;
      username: string;
      team: string;
      isMoveMaker: boolean;
    }>;
    turn: string;
    moveMaker: string | undefined;
    timerRemainingMs: bigint;
    winner: string | undefined;
    celebrationSecondsLeft: bigint | undefined;
    openingName: string | undefined;
    spellUseEnabled: boolean;
  } = {
    phase: "Playing",
    board: [],
    players: [],
    turn: "White",
    moveMaker: undefined,
    timerRemainingMs: 300000n,
    winner: undefined,
    celebrationSecondsLeft: undefined,
    openingName: undefined,
    spellUseEnabled: false,
  };
  return { currentSnapshot, actorLoading: { value: false } };
});

// The real Layout renders StoryWindow, which consumes useInternetIdentity().
// The real @caffeineai/core-infrastructure package requires an
// InternetIdentityProvider and fails to resolve its own submodules in jsdom,
// so mock the hook with an anonymous, idle state. This test never exercises
// sign-in.
vi.mock("@caffeineai/core-infrastructure", () => ({
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
  useActorState: () => ({
    actor: {},
    isLoading: actorLoading.value,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/hooks/use-heartbeat", () => ({
  useHeartbeat: () => ({ pingNow: vi.fn() }),
}));
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
  useGameMeta: () => ({ gameNumber: 1n, isLoading: false, error: null }),
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

vi.mock("@/hooks/use-exercise-assignments", () => ({
  useExerciseAssignments: () => ({ assignments: [] }),
}));
vi.mock("@/hooks/use-drinking-assignments", () => ({
  useDrinkingAssignments: () => ({ assignments: [] }),
}));
vi.mock("@/hooks/use-game-mode", () => ({
  useGameMode: () => ({ mode: "off", setMode: vi.fn(), cycle: vi.fn() }),
}));

// Keep the real useNavigate but make it a no-op so the route's navigation
// handlers (not exercised here) do not throw.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// The route renders the real Layout (so the "Replay guide" button is
// observable) but stubs the heavy board/overlay children. The board window
// renders a marker so the tour's "board ready" gate can be satisfied.
vi.mock("@/components/Chessboard", () => ({
  Chessboard: () => <div data-testid="chessboard" />,
}));
vi.mock("@/components/CelebrationOverlay", () => ({
  CelebrationOverlay: () => <div data-testid="celebration-overlay" />,
}));
vi.mock("@/components/TurnAnnouncementOverlay", () => ({
  TurnAnnouncementOverlay: () => <div data-testid="turn-announcement" />,
}));
vi.mock("@/components/MoveMakerIndicator", () => ({
  MoveMakerIndicator: () => <div data-testid="move-maker" />,
}));
vi.mock("@/components/TurnIndicator", () => ({
  TurnIndicator: () => <div data-testid="turn-indicator" />,
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
vi.mock("@/components/BoardToolbar", () => ({
  BoardToolbar: () => <div data-testid="board-toolbar" />,
}));
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

import { GamePhase } from "@/backend";
import { GUIDE_PENDING_KEY, readGuidePending } from "@/lib/guide-preference";
import { Route as gameRoute } from "@/routes/game";

// Render the route's component directly (rather than through the router) so
// the test can re-render it with a new mocked snapshot. The route's
// useNavigate is mocked to a no-op, so no router context is required.
const GameRouteComponent = gameRoute.options.component!;

describe("GameRoute guided-tour gating", () => {
  beforeEach(() => {
    window.localStorage.clear();
    currentSnapshot.phase = "Playing";
    actorLoading.value = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  const renderRoute = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const utils = render(
      <QueryClientProvider client={queryClient}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );
    return {
      ...utils,
      rerender: () =>
        utils.rerender(
          <QueryClientProvider client={queryClient}>
            <GameRouteComponent />
          </QueryClientProvider>,
        ),
    };
  };

  it("auto-starts the tour once the board is present and the game is not loading", async () => {
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    renderRoute();

    // The board window is rendered by the real Layout, so the tour's
    // "board ready" gate is satisfied and the card appears.
    await waitFor(() => {
      expect(screen.getByTestId("guided_tour.card")).toBeInTheDocument();
    });
    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      "1 of 9",
    );
  });

  it("does not start the tour while the game is still loading", async () => {
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    actorLoading.value = true;
    renderRoute();

    // The route renders ConnectingState (game.loading_state) instead of the
    // board, so the tour must not mount.
    expect(screen.getByTestId("game.loading_state")).toBeInTheDocument();
    expect(screen.queryByTestId("guided_tour.card")).not.toBeInTheDocument();
  });

  it("does not start the tour when no pending flag is set", () => {
    renderRoute();
    expect(screen.queryByTestId("guided_tour.card")).not.toBeInTheDocument();
  });

  it("restarts the tour at step 1 from the Replay guide button even with the toggle off", async () => {
    const user = userEvent.setup();
    // No pending flag — the login toggle is off.
    expect(readGuidePending()).toBe(false);
    renderRoute();

    expect(screen.queryByTestId("guided_tour.card")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("header.replay_guide.button"));

    await waitFor(() => {
      expect(screen.getByTestId("guided_tour.card")).toBeInTheDocument();
    });
    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      "1 of 9",
    );
  });

  it("ends the tour and clears the pending flag when the celebration overlay appears", async () => {
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    const { rerender } = renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId("guided_tour.card")).toBeInTheDocument();
    });

    // The game concludes — the celebration overlay appears mid-tour.
    currentSnapshot.phase = GamePhase.Celebration;
    rerender();

    await waitFor(() => {
      expect(screen.queryByTestId("guided_tour.card")).not.toBeInTheDocument();
    });
    expect(readGuidePending()).toBe(false);
  });
});
