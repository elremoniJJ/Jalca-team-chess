import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the game route's `handleRequestNewGame` seam, taken
 * BEFORE the accepted presence change.
 *
 * The request intentionally changes the presence model (an inactive state at
 * ~90s, a ~30-minute delete cutoff, `heartbeat` returning an error for an
 * unknown principal) and requires the client to show a "You were removed, tap
 * to rejoin" banner when `heartbeat` or `requestNewGame` reports the player is
 * unknown. It also requires the end-game modal to display the `requestNewGame`
 * error rather than ignoring it.
 *
 * This file deliberately does NOT assert the new banner, the new inactive
 * state, or the new `heartbeat` error result — those are the change. What it
 * protects is the behavior ADJACENT to the change that must survive it: the
 * route's existing mapping of the backend `requestNewGame` result to the
 * modal's `onRequestNewGame` return value.
 *
 *   - `#ok` resolves to `undefined` (success) and dismisses the modal;
 *   - `#err` resolves to the backend's error string, so the modal can surface
 *     it inline and stay open;
 *   - a thrown/rejected call resolves to a non-empty fallback error string
 *     rather than rejecting, so the modal never sees an unhandled rejection.
 *
 * The route's hooks are mocked (no real actor, no polling, no network). The
 * backend is entirely mocked, so this is component/integration coverage of the
 * frontend wiring — NOT real backend behavior. The real `requestNewGame`
 * contract is exercised by the PocketIC lane.
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
}));

const PRINCIPAL = "player-1";

const {
  currentSnapshot,
  currentRecord,
  actorRequestNewGame,
  capturedRequestNewGame,
  capturedOnRemoved,
} = vi.hoisted(() => {
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
    spellWinName: string | undefined;
  } = {
    phase: "Celebration",
    board: [],
    players: [],
    turn: "White",
    moveMaker: undefined,
    timerRemainingMs: 300000n,
    winner: "White",
    celebrationSecondsLeft: undefined,
    openingName: undefined,
    spellUseEnabled: false,
    spellWinName: undefined,
  };
  const currentRecord: { value: Record<string, unknown> | null } = {
    value: null,
  };
  return {
    currentSnapshot,
    currentRecord,
    actorRequestNewGame: vi.fn(),
    capturedRequestNewGame: { current: null as (() => unknown) | null },
    capturedOnRemoved: { current: null as (() => void) | null },
  };
});

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => PRINCIPAL,
  useActiveIdentity: () => PRINCIPAL,
  useRankedSession: () => false,
  useSpectator: () => null,
  isSpectating: () => false,
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity: vi.fn(),
  clearWalletAddress: vi.fn(),
  clearRankedIdentity: vi.fn(),
  clearRankedSession: vi.fn(),
  clearSpectator: vi.fn(),
  readWalletAddress: () => "",
  readRankedIdentity: () => null,
  RANKED_STORAGE_KEY: "team-chess-ranked-principal",
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: { requestNewGame: actorRequestNewGame },
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({ requestNewGame: actorRequestNewGame }),
}));

vi.mock("@/hooks/use-heartbeat", () => ({
  useHeartbeat: (
    _principal: string,
    _isMoveMaker: boolean,
    _enabled: boolean,
    onRemoved?: () => void,
  ) => {
    capturedOnRemoved.current = onRemoved ?? null;
    return { pingNow: vi.fn() };
  },
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
  useGameRecord: () => ({
    data: currentRecord.value,
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

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// Layout is stubbed to render the board slot (where the EndGameModal lives).
vi.mock("@/components/Layout", () => ({
  Layout: ({ windows }: { windows: { board: React.ReactNode } }) => (
    <div>{windows.board}</div>
  ),
  // MoveHistory / PlayerList / CapturedTray now render inside the board
  // slot's tab panel and call usePanelCollapseContext; on desktop it
  // returns null.
  usePanelCollapseContext: () => null,
}));

// The EndGameModal is stubbed to capture the `onRequestNewGame` handler the
// route wires to its footer "New game" button.
vi.mock("@/components/EndGameModal", () => ({
  EndGameModal: ({
    onRequestNewGame,
  }: {
    onRequestNewGame?: () => unknown;
  }) => {
    capturedRequestNewGame.current = onRequestNewGame ?? null;
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

describe("GameRoute requestNewGame result mapping", () => {
  beforeEach(() => {
    currentSnapshot.phase = "Celebration";
    currentSnapshot.winner = "White";
    currentRecord.value = {
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
    actorRequestNewGame.mockReset();
    capturedRequestNewGame.current = null;
    capturedOnRemoved.current = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("maps #ok to undefined (success) and calls the backend with the player's principal", async () => {
    actorRequestNewGame.mockResolvedValue({ __kind__: "ok", ok: null });
    renderRoute();

    const requestNewGame = capturedRequestNewGame.current;
    expect(requestNewGame).toBeTypeOf("function");

    const result = await requestNewGame?.();

    expect(actorRequestNewGame).toHaveBeenCalledWith(PRINCIPAL);
    expect(result).toBeUndefined();
  });

  it("maps #err to the backend's error string so the modal can surface it", async () => {
    actorRequestNewGame.mockResolvedValue({
      __kind__: "err",
      err: "requestNewGame: principal is not a logged-in player",
    });
    renderRoute();

    const requestNewGame = capturedRequestNewGame.current;
    expect(requestNewGame).toBeTypeOf("function");

    const result = await requestNewGame?.();

    expect(result).toBe("requestNewGame: principal is not a logged-in player");
  });

  it("resolves to a non-empty fallback error string when the call rejects", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    actorRequestNewGame.mockRejectedValue(new Error("backend down"));
    renderRoute();

    const requestNewGame = capturedRequestNewGame.current;
    expect(requestNewGame).toBeTypeOf("function");

    const result = await requestNewGame?.();

    expect(typeof result).toBe("string");
    expect((result as string).length).toBeGreaterThan(0);
    consoleError.mockRestore();
  });

  // The accepted presence change requires the client to show the "You were
  // removed, tap to rejoin" banner when requestNewGame reports the principal
  // is unknown, and NOT on a transient network error. The route's
  // handleRequestNewGame sets the banner on an explicit #err result only.
  it("shows the removed banner when requestNewGame reports an unknown principal", async () => {
    actorRequestNewGame.mockResolvedValue({
      __kind__: "err",
      err: "requestNewGame: principal is not a logged-in player",
    });
    renderRoute();

    // No banner before the call.
    expect(
      screen.queryByText("You were removed, tap to rejoin"),
    ).not.toBeInTheDocument();

    const requestNewGame = capturedRequestNewGame.current;
    await requestNewGame?.();

    expect(
      await screen.findByText("You were removed, tap to rejoin"),
    ).toBeInTheDocument();
  });

  it("does not show the removed banner on a transient network error", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    actorRequestNewGame.mockRejectedValue(new Error("backend down"));
    renderRoute();

    const requestNewGame = capturedRequestNewGame.current;
    await requestNewGame?.();

    expect(
      screen.queryByText("You were removed, tap to rejoin"),
    ).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  // The accepted presence change requires the client to show the "You were
  // removed, tap to rejoin" banner when the heartbeat reports the principal is
  // unknown. The route wires useHeartbeat's onRemoved callback to set the
  // banner; this test invokes that callback directly (the hook itself is
  // covered by use-heartbeat-cadence-cover.test.tsx).
  it("shows the removed banner when the heartbeat reports the player is unknown", async () => {
    renderRoute();

    // No banner before the heartbeat reports a removal.
    expect(
      screen.queryByText("You were removed, tap to rejoin"),
    ).not.toBeInTheDocument();

    const onRemoved = capturedOnRemoved.current;
    expect(onRemoved).toBeTypeOf("function");
    onRemoved?.();

    expect(
      await screen.findByText("You were removed, tap to rejoin"),
    ).toBeInTheDocument();
  });
});
