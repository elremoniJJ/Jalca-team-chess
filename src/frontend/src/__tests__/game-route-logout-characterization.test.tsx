import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the GameRoute logout paths, taken BEFORE the end-game
 * modal's "Log out" button is changed to call the backend logout.
 *
 * The request intentionally changes `handleModalLogout` (the EndGameModal's
 * "Log out" handler) so that it calls `actor.logout(principal)` before its
 * existing local cleanup and navigation. That navigation-only behavior is
 * exactly what this file must NOT freeze.
 *
 * What it protects is the behavior ADJACENT to that change that must survive
 * it — the observable contract the game route already honors:
 *
 *   - the HEADER "Log out" handler (handleLogout) calls the backend
 *     `actor.logout(principal)` with the player's principal, then clears the
 *     persisted guest identity and wallet address, then navigates to "/".
 *     This is the path the modal logout is being changed to mirror, so it is
 *     the working baseline the change must not disturb;
 *   - the END-GAME MODAL "Log out" handler is wired (the route passes a
 *     handler, not undefined) and performs the same local cleanup and
 *     navigation to "/". The backend call it will gain is deliberately NOT
 *     asserted here in either direction.
 *
 * The route's hooks are mocked (no real actor, no polling, no network). The
 * backend is entirely mocked, so this is component/integration coverage of the
 * frontend wiring — NOT real backend behavior.
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
  actorLogout,
  clearGuestIdentity,
  clearWalletAddress,
  navigate,
  capturedHeaderLogout,
  capturedModalLogout,
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
    actorLogout: vi.fn().mockResolvedValue(undefined),
    clearGuestIdentity: vi.fn(),
    clearWalletAddress: vi.fn(),
    navigate: vi.fn(),
    capturedHeaderLogout: { current: null as (() => unknown) | null },
    capturedModalLogout: { current: null as (() => unknown) | null },
  };
});

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => PRINCIPAL,
  useActiveIdentity: () => PRINCIPAL,
  useRankedSession: () => false,
  useSpectator: () => null,
  isSpectating: () => false,
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity,
  clearRankedIdentity: vi.fn(),
  clearRankedSession: vi.fn(),
  clearSpectator: vi.fn(),
  clearWalletAddress,
  readWalletAddress: () => "",
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: { logout: actorLogout },
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({ logout: actorLogout }),
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

// Capture the navigate function the route uses so the logout handlers'
// navigation can be observed.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigate };
});

// Layout is stubbed to capture the header `onLogout` handler and render the
// board slot (where the EndGameModal lives).
vi.mock("@/components/Layout", () => ({
  Layout: ({
    onLogout,
    windows,
  }: {
    onLogout?: () => unknown;
    windows: { board: React.ReactNode };
  }) => {
    capturedHeaderLogout.current = onLogout ?? null;
    return <div>{windows.board}</div>;
  },
  // MoveHistory / PlayerList / CapturedTray now render inside the board
  // slot's tab panel and call usePanelCollapseContext; on desktop it
  // returns null.
  usePanelCollapseContext: () => null,
}));

// The EndGameModal is stubbed to capture the `onLogout` handler the route
// wires to its footer "Log out" button.
vi.mock("@/components/EndGameModal", () => ({
  EndGameModal: ({ onLogout }: { onLogout?: () => unknown }) => {
    capturedModalLogout.current = onLogout ?? null;
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

describe("GameRoute logout wiring", () => {
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
    actorLogout.mockClear();
    clearGuestIdentity.mockClear();
    clearWalletAddress.mockClear();
    navigate.mockClear();
    capturedHeaderLogout.current = null;
    capturedModalLogout.current = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("header Log out calls the backend logout with the principal, clears local state, and navigates home", async () => {
    renderRoute();

    const headerLogout = capturedHeaderLogout.current;
    expect(headerLogout).toBeTypeOf("function");

    await headerLogout?.();

    expect(actorLogout).toHaveBeenCalledWith(PRINCIPAL);
    expect(clearGuestIdentity).toHaveBeenCalled();
    expect(clearWalletAddress).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("wires the end-game modal Log out handler and it clears local state and navigates home", async () => {
    renderRoute();

    const modalLogout = capturedModalLogout.current;
    expect(modalLogout).toBeTypeOf("function");

    await modalLogout?.();

    // The local cleanup + navigation are the adjacent behavior that must
    // survive the change. The backend call the modal logout is gaining is
    // intentionally not asserted here.
    expect(clearGuestIdentity).toHaveBeenCalled();
    expect(clearWalletAddress).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });
});
