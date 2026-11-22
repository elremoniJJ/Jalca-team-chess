import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the behavior ADJACENT to the guest-identity / logout
 * change, taken BEFORE that change.
 *
 * The request intentionally changes three things:
 *   1. `useGuestIdentity()` stops returning the ranked slot when it is
 *      populated and returns the guest pseudo-principal unconditionally;
 *   2. `runGuestLogin` uses the guest key for `actor.login(...)` and for the
 *      gameState query key instead of the value from `useGuestIdentity()`;
 *   3. `handleLogout` and `handleModalLogout` additionally call
 *      `clearRankedIdentity()`.
 *
 * None of those three edits is asserted here. What this file protects is the
 * surrounding working behavior that must survive them:
 *
 *   - the guest login path still calls `actor.login(principal, username, null,
 *     WalletSource.none)` and seeds the `["gameState", principal]` cache, then
 *     navigates to /game — the guest path with no ranked slot is unchanged;
 *   - the ranked login path still mints a key, calls `loginRanked`, and writes
 *     the ranked slot via `setRankedIdentity` only after the backend accepts;
 *   - both logout handlers still clear the guest identity, wallet address and
 *     spectator state, clear the persistent selection, and navigate home. The
 *     change only ADDS `clearRankedIdentity`, so the existing cleanup must
 *     survive it.
 *
 * The backend actor is mocked throughout; this is component/integration
 * coverage of the frontend wiring, not deployed browser E2E. The real
 * `login`/`loginRanked`/`logout` behavior is the PocketIC lane's job.
 */

// The routes import WalletSource as a runtime value from @/backend, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the routes need.
vi.mock("@/backend", () => ({
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
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

// The login route consumes useInternetIdentity() for the ranked-play option.
// The real @caffeineai/core-infrastructure package fails to resolve its own
// submodules in jsdom, so mock the hook with a controllable state.
const identityState = vi.hoisted(() => ({
  identity: null as { getPrincipal: () => { toText: () => string } } | null,
  isAuthenticated: false,
  isLoggingIn: false,
  login: vi.fn(),
  loginError: null as { message: string } | null,
}));

vi.mock("@caffeineai/core-infrastructure", () => ({
  useInternetIdentity: () => ({
    identity: identityState.identity,
    isAuthenticated: identityState.isAuthenticated,
    isLoggingIn: identityState.isLoggingIn,
    login: identityState.login,
    loginError: identityState.loginError,
  }),
}));

// The identity hooks. `useGuestIdentity` returns a stable guest
// pseudo-principal (the guest path with no ranked slot). `generateRankedKey`
// and `setRankedIdentity` are spies so the ranked write path can be observed.
const identityHooks = vi.hoisted(() => ({
  generateRankedKey: vi.fn(() => "ranked-key-generated"),
  setRankedIdentity: vi.fn(),
  setRankedSession: vi.fn(),
  clearRankedSession: vi.fn(),
}));

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  // The game route's gameplay identity and the Comp card read the active
  // identity; with no ranked session it resolves to the guest principal.
  useActiveIdentity: () => "player-1",
  // The Ranked/Guest badge follows the ranked session flag, not the slot.
  useRankedSession: () => false,
  useWalletAddress: () => ["", vi.fn()],
  generateRankedKey: identityHooks.generateRankedKey,
  setRankedIdentity: identityHooks.setRankedIdentity,
  setRankedSession: identityHooks.setRankedSession,
  clearRankedSession: identityHooks.clearRankedSession,
  // The game route reads the spectator state and the poll-interval helper
  // reads isSpectating(); both must be present on the mock. This test is a
  // non-spectator player, so both report "not spectating".
  useSpectator: () => null,
  isSpectating: () => false,
  readSpectator: () => null,
  clearSpectator: vi.fn(),
  clearGuestIdentity: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "",
  clearRankedIdentity: vi.fn(),
  readRankedIdentity: () => null,
  RANKED_STORAGE_KEY: "team-chess-ranked-principal",
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

// The login route calls getActor() on submit; the game route resolves the
// actor for logout. Mock both so the exact arguments are captured without
// touching the real actor.
const actorMethods = vi.hoisted(() => ({
  login: vi.fn(),
  loginRanked: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: { logout: actorMethods.logout },
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({
    login: actorMethods.login,
    loginRanked: actorMethods.loginRanked,
    logout: actorMethods.logout,
  }),
}));

vi.mock("@/lib/audio-unlock", () => ({ unlockAudio: vi.fn() }));

// The game route's hooks are mocked (no real actor, no polling, no network).
const gameState = vi.hoisted(() => ({
  snapshot: {
    phase: "Celebration",
    board: [] as Array<{ pieceType: string; color: string } | null>,
    players: [] as Array<{
      principal: string;
      username: string;
      team: string;
      isMoveMaker: boolean;
    }>,
    turn: "White",
    moveMaker: undefined as string | undefined,
    timerRemainingMs: 300000n,
    winner: "White" as string | undefined,
    celebrationSecondsLeft: undefined as bigint | undefined,
    openingName: undefined as string | undefined,
    spellUseEnabled: false,
    spellWinName: undefined as string | undefined,
  },
  record: {
    value: null as Record<string, unknown> | null,
  },
}));

vi.mock("@/hooks/use-heartbeat", () => ({ useHeartbeat: () => {} }));
vi.mock("@/hooks/use-sound-effects", () => ({ useSoundEffects: () => {} }));

vi.mock("@/hooks/use-game-state", () => ({
  useGameState: () => ({
    data: gameState.snapshot,
    isLoading: false,
    error: null,
    moves: [],
    lastMove: null,
    prevBoard: null,
    checkSquare: null,
  }),
}));

vi.mock("@/hooks/use-game-record", () => ({
  useGameRecord: () => ({
    data: gameState.record.value,
    loading: false,
    error: null,
  }),
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

vi.mock("@/hooks/use-kick", () => ({
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

// Capture the navigate function the routes use so navigation can be observed.
const navigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigate };
});

// Layout is stubbed to capture the header `onLogout` handler and render the
// board slot (where the EndGameModal lives).
const captured = vi.hoisted(() => ({
  headerLogout: { current: null as (() => unknown) | null },
  modalLogout: { current: null as (() => unknown) | null },
}));

vi.mock("@/components/Layout", () => ({
  Layout: ({
    onLogout,
    windows,
  }: {
    onLogout?: () => unknown;
    windows: { board: React.ReactNode };
  }) => {
    captured.headerLogout.current = onLogout ?? null;
    return <div>{windows.board}</div>;
  },
}));

// The EndGameModal is stubbed to capture the `onLogout` handler the route
// wires to its footer "Log out" button.
vi.mock("@/components/EndGameModal", () => ({
  EndGameModal: ({ onLogout }: { onLogout?: () => unknown }) => {
    captured.modalLogout.current = onLogout ?? null;
    return <div data-testid="end-game-modal" />;
  },
}));

vi.mock("@/components/Chessboard", () => ({
  Chessboard: () => <div data-testid="chessboard" />,
}));
vi.mock("@/components/BoardToolbar", () => ({
  BoardToolbar: () => <div data-testid="board-toolbar" />,
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
vi.mock("@/components/ExerciseToasts", () => ({
  ExerciseToasts: () => <div data-testid="exercise-toasts" />,
}));
vi.mock("@/components/DrinkingToasts", () => ({
  DrinkingToasts: () => <div data-testid="drinking-toasts" />,
}));
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

import { WalletSource } from "@/backend";
import { Route as gameRoute } from "@/routes/game";
import { Route as indexRoute } from "@/routes/index";

const LoginRouteComponent = indexRoute.options.component!;
const GameRouteComponent = gameRoute.options.component!;

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    ),
  };
}

describe("guest login path (adjacent to the guest-key change)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
    identityState.identity = null;
    identityState.isAuthenticated = false;
    identityState.isLoggingIn = false;
    identityState.loginError = null;
  });

  it("calls login with the guest principal, username, and no wallet, then navigates to /game", async () => {
    const user = userEvent.setup();
    actorMethods.login.mockResolvedValue({ gameState: null });
    renderWithQueryClient(<LoginRouteComponent />);

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByTestId("login.primary_button"));

    expect(actorMethods.login).toHaveBeenCalledWith(
      "player-1",
      "Ada",
      null,
      WalletSource.none,
    );
    expect(actorMethods.loginRanked).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/game" });
  });

  it("seeds the gameState cache under the guest principal after a successful login", async () => {
    const user = userEvent.setup();
    const snapshot = { players: [], phase: "Playing" };
    actorMethods.login.mockResolvedValue({ gameState: snapshot });
    const { queryClient } = renderWithQueryClient(<LoginRouteComponent />);

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByTestId("login.primary_button"));

    expect(queryClient.getQueryData(["gameState", "player-1"])).toEqual(
      snapshot,
    );
  });

  it("shows the generic error and does not navigate when the guest login fails", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    actorMethods.login.mockRejectedValue(new Error("backend down"));
    renderWithQueryClient(<LoginRouteComponent />);

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByTestId("login.primary_button"));

    expect(
      await screen.findByText("Could not join the game. Please try again."),
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("ranked login write path (adjacent to the guest-key change)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
    identityState.identity = null;
    identityState.isAuthenticated = false;
    identityState.isLoggingIn = false;
    identityState.loginError = null;
  });

  it("mints a key, calls loginRanked, and writes the ranked slot only after the backend accepts", async () => {
    const user = userEvent.setup();
    actorMethods.loginRanked.mockResolvedValue({ gameState: null });
    identityState.identity = {
      getPrincipal: () => ({ toText: () => "ii-principal" }),
    };
    identityState.isAuthenticated = true;
    renderWithQueryClient(<LoginRouteComponent />);

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByTestId("login.internet_identity_button"));

    expect(identityHooks.generateRankedKey).toHaveBeenCalled();
    expect(actorMethods.loginRanked).toHaveBeenCalledWith(
      "ranked-key-generated",
      "Ada",
      null,
      WalletSource.none,
    );
    expect(identityHooks.setRankedIdentity).toHaveBeenCalledWith(
      "ranked-key-generated",
    );
  });

  it("does not write the ranked slot when loginRanked rejects", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    actorMethods.loginRanked.mockRejectedValue(new Error("backend down"));
    identityState.identity = {
      getPrincipal: () => ({ toText: () => "ii-principal" }),
    };
    identityState.isAuthenticated = true;
    renderWithQueryClient(<LoginRouteComponent />);

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByTestId("login.internet_identity_button"));

    expect(identityHooks.setRankedIdentity).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("game route logout cleanup (adjacent to the clearRankedIdentity addition)", () => {
  beforeEach(() => {
    gameState.snapshot.phase = "Celebration";
    gameState.snapshot.winner = "White";
    gameState.record.value = {
      active: false,
      concluded: true,
      openingName: "Italian Game - Giuoco Piano",
      result: "WhiteWin",
      endState: "Checkmate",
      moves: [],
      playerList: [],
      stalePlayerList: [],
      rosters: [],
      finalBoard: [],
    };
    actorMethods.logout.mockReset();
    actorMethods.logout.mockResolvedValue(undefined);
    navigate.mockClear();
    captured.headerLogout.current = null;
    captured.modalLogout.current = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("header Log out calls the backend logout with the principal, then navigates home", async () => {
    renderWithQueryClient(<GameRouteComponent />);

    const headerLogout = captured.headerLogout.current;
    expect(headerLogout).toBeTypeOf("function");

    await headerLogout?.();

    expect(actorMethods.logout).toHaveBeenCalledWith("player-1");
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("modal Log out calls the backend logout with the principal, then navigates home", async () => {
    renderWithQueryClient(<GameRouteComponent />);

    const modalLogout = captured.modalLogout.current;
    expect(modalLogout).toBeTypeOf("function");

    await modalLogout?.();

    expect(actorMethods.logout).toHaveBeenCalledWith("player-1");
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("still navigates home when the backend logout rejects", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    actorMethods.logout.mockRejectedValueOnce(new Error("backend down"));

    renderWithQueryClient(<GameRouteComponent />);
    const headerLogout = captured.headerLogout.current;
    expect(headerLogout).toBeTypeOf("function");

    await headerLogout?.();

    expect(navigate).toHaveBeenCalledWith({ to: "/" });
    consoleError.mockRestore();
  });
});
