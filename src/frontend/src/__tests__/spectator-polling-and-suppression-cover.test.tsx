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

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted spectator polling + suppression change.
 *
 * Two accepted behaviors are asserted here:
 *   1. The shared `getGamePollMs()` helper returns 5000ms for a spectator and
 *      1500ms for a player. Every polling hook reads its interval from this
 *      helper, so this is the single seam that governs the cadence.
 *   2. A spectator on /game makes no heartbeat, no login/loginRanked and no
 *      castVote call, and the voting controls render read-only.
 *
 * The backend actor and the route's data hooks are mocked; this is
 * component/integration coverage, not deployed browser E2E. The real backend
 * behavior is the PocketIC lane's job.
 */

// The route imports SpellUse/StartingPosition/GamePhase/Team/PieceType as
// runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test environment
// (a pre-existing dependency issue), so mock the backend module with the enum
// values the route and its children need.
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

// The route's spectator state. `useSpectator` returns a stable suffix for a
// spectator and null for a player; the test drives it per case.
const spectatorState = vi.hoisted(() => ({
  suffix: null as string | null,
}));

// The heartbeat seam — the route passes `!isSpectator` as its `enabled` flag.
const heartbeatSpy = vi.hoisted(() => vi.fn());

// The castVote seam — a spectator must never trigger it.
const castVoteMutate = vi.hoisted(() => vi.fn());

// The actor seam — a spectator must make no login/loginRanked/heartbeat call.
const actorMethods = vi.hoisted(() => ({
  login: vi.fn(),
  loginRanked: vi.fn(),
  heartbeat: vi.fn(),
  logout: vi.fn(),
}));

const currentSnapshot = vi.hoisted(() => ({
  phase: "Playing",
  board: [] as Array<{ pieceType: string; color: string } | null>,
  players: [
    {
      principal: "player-1",
      username: "Ada",
      team: "White",
      isMoveMaker: true,
      isFresh: true,
    },
  ],
  turn: "White",
  moveMaker: "player-1" as string | undefined,
  timerRemainingMs: 300000n,
  winner: undefined as string | undefined,
  celebrationSecondsLeft: undefined as bigint | undefined,
  openingName: undefined as string | undefined,
  spellUseEnabled: false,
}));

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
  // The game route's gameplay identity now comes from the active-identity
  // accessor. Return the same stable principal the guest hook returns so the
  // spectator-suppression assertions below stay unchanged.
  useActiveIdentity: () => "player-1",
  // The Ranked/Guest badge follows the ranked session flag, not the slot.
  useRankedSession: () => false,
  useSpectator: () => spectatorState.suffix,
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity: vi.fn(),
  clearWalletAddress: vi.fn(),
  clearSpectator: vi.fn(),
  clearRankedIdentity: vi.fn(),
  clearRankedSession: vi.fn(),
  readWalletAddress: () => "",
  readRankedIdentity: () => null,
  SPECTATOR_USERNAME_PREFIX: "\u0000spectator:",
  // The game route reads the ranked key slot on mount to decide the
  // Ranked/Guest badge; the mock must expose the same key string the real
  // module exports.
  RANKED_STORAGE_KEY: "team-chess-ranked-principal",
  // getGamePollMs() reads the spectator flag imperatively through this
  // accessor, so the cadence test drives it from the same state.
  isSpectating: () => spectatorState.suffix !== null,
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: actorMethods,
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue(actorMethods),
}));

vi.mock("@/hooks/use-heartbeat", () => ({
  useHeartbeat: (...args: unknown[]) => heartbeatSpy(...args),
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
    mutate: castVoteMutate,
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
vi.mock("@/hooks/use-mint-attempts", () => ({
  useMintAttemptsByGame: () => ({ groups: [] }),
}));
vi.mock("@/hooks/use-shield-resolution-snapshot", () => ({
  useShieldResolutionSnapshot: () => ({ data: null }),
}));
vi.mock("@/hooks/use-leaderboard", () => ({
  LEADERBOARD_QUERY_KEY: ["leaderboard"],
  PAST_WINNERS_QUERY_KEY: ["pastWinners"],
  SUNDAY_COMP_STANDINGS_QUERY_KEY: ["sundayCompStandings"],
}));

// The Leaderboard window is not the subject under test; stub it so its own
// leaderboard/prize hooks do not need mocking here.
vi.mock("@/components/LeaderboardWindow", () => ({
  LeaderboardWindow: () => <div data-testid="leaderboard-window" />,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// Stub the heavy board/overlay children; keep the real Layout and
// VotingWindow so the read-only spectator controls are observable.
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

import {
  PLAYER_POLL_MS,
  SPECTATOR_POLL_MS,
  getGamePollMs,
} from "@/lib/poll-interval";
import { Route as gameRoute } from "@/routes/game";

const GameRouteComponent = gameRoute.options.component!;

describe("getGamePollMs shared cadence helper (cover)", () => {
  afterEach(() => {
    spectatorState.suffix = null;
  });

  it("returns 1500ms for a player and 5000ms for a spectator", () => {
    // No spectator state — a player.
    spectatorState.suffix = null;
    expect(getGamePollMs()).toBe(PLAYER_POLL_MS);
    expect(PLAYER_POLL_MS).toBe(1500);

    // Spectator state present — the spectator cadence.
    spectatorState.suffix = "spectator-suffix";
    expect(getGamePollMs()).toBe(SPECTATOR_POLL_MS);
    expect(SPECTATOR_POLL_MS).toBe(5000);
  });
});

describe("GameRoute spectator suppression (cover)", () => {
  beforeEach(() => {
    spectatorState.suffix = "spectator-suffix";
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    spectatorState.suffix = null;
    currentSnapshot.phase = "Playing";
  });

  const renderRoute = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );
  };

  it("makes no heartbeat, login or loginRanked call for a spectator", async () => {
    renderRoute();

    // The route passes `!isSpectator` (false) as the heartbeat's enabled flag.
    await waitFor(() => {
      expect(heartbeatSpy).toHaveBeenCalled();
    });
    const enabledArg = heartbeatSpy.mock.calls[0][2];
    expect(enabledArg).toBe(false);

    expect(actorMethods.login).not.toHaveBeenCalled();
    expect(actorMethods.loginRanked).not.toHaveBeenCalled();
    expect(actorMethods.heartbeat).not.toHaveBeenCalled();
  });

  it("renders the Spectating badge and the leave control for a spectator", () => {
    renderRoute();

    expect(screen.getByTestId("header.spectator_badge")).toBeInTheDocument();
    expect(
      screen.getByTestId("header.leave_spectating.button"),
    ).toBeInTheDocument();
    // The Replay guide button is hidden for a spectator.
    expect(
      screen.queryByTestId("header.replay_guide.button"),
    ).not.toBeInTheDocument();
  });

  it("renders the voting controls read-only for a spectator", async () => {
    const user = userEvent.setup();
    renderRoute();

    // Expand the VotingWindow so its toggles render.
    await user.click(await screen.findByTestId("voting_window.header"));

    expect(
      await screen.findByTestId("voting_window.spectator_note"),
    ).toBeInTheDocument();

    // Changing a toggle must not cast a vote for a spectator.
    const spellOff = await screen.findByTestId("voting_window.spell_toggle.1");
    await user.click(spellOff);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(castVoteMutate).not.toHaveBeenCalled();
  }, 10_000);
});
