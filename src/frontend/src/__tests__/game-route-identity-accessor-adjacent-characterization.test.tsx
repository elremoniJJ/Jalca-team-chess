import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the game route's identity-accessor seam, taken BEFORE
 * the active-identity accessor change.
 *
 * The request intentionally switches the game route (along with the Comp view,
 * the prediction window and the wallet window) from the guest key to an
 * active-identity accessor that returns the ranked key for a ranked session and
 * the guest key for a guest session. None of that new accessor behavior is
 * asserted here — it does not exist yet.
 *
 * What this file protects is the working behavior that must survive the switch:
 * the game route reads ONE principal from the identity accessor and passes that
 * SAME value to every identity-scoped hook it owns — `useGameState`,
 * `useGameMeta`, `usePersistentSelection` (via the selection store) and
 * `useHeartbeat`. The switch must not leave one hook on the guest key and
 * another on the ranked key.
 *
 * The route's hooks are mocked (no real actor, no polling, no network). The
 * backend is entirely mocked, so this is component/integration coverage of the
 * frontend wiring — NOT real backend behavior. The real backend behavior is the
 * PocketIC lane's job.
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

// The identity accessor the route reads. It returns a stable principal so the
// test can assert every identity-scoped hook receives the SAME value.
const IDENTITY = "active-identity-1";

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => IDENTITY,
  // The route's gameplay identity now comes from the active-identity accessor.
  // Return the same stable principal the guest hook returns so the identity
  // wiring assertions below stay unchanged.
  useActiveIdentity: () => IDENTITY,
  // The Ranked/Guest badge follows the ranked session flag, not the slot.
  useRankedSession: () => false,
  useSpectator: () => null,
  useWalletAddress: () => ["", vi.fn()],
  readWalletAddress: () => "",
  clearGuestIdentity: vi.fn(),
  clearRankedIdentity: vi.fn(),
  clearWalletAddress: vi.fn(),
  clearSpectator: vi.fn(),
  RANKED_STORAGE_KEY: "team-chess-ranked-principal",
}));

// The identity-scoped hooks the route owns. Capture the principal each one
// receives so the test can assert they all agree.
const { useGameState, useGameMeta, useHeartbeat } = vi.hoisted(() => ({
  useGameState: vi.fn(),
  useGameMeta: vi.fn(),
  // The route destructures `pingNow` from useHeartbeat; return it while
  // still recording the call arguments the test asserts on. The parameter is
  // declared so `mock.calls[0]?.[0]` is a valid tuple index.
  useHeartbeat: vi.fn((_principal?: string) => ({ pingNow: vi.fn() })),
}));

vi.mock("@/hooks/use-game-state", () => ({ useGameState }));
vi.mock("@/hooks/use-game-meta", () => ({ useGameMeta }));
vi.mock("@/hooks/use-heartbeat", () => ({ useHeartbeat }));
vi.mock("@/hooks/use-sound-effects", () => ({ useSoundEffects: () => {} }));

vi.mock("@/hooks/use-game-record", () => ({
  useGameRecord: () => ({ data: null, loading: false, error: null }),
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

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: null,
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// Layout is stubbed to render the board slot; the route's identity wiring is
// what this file observes, not the layout chrome.
vi.mock("@/components/Layout", () => ({
  Layout: ({ windows }: { windows: { board: React.ReactNode } }) => (
    <div>{windows.board}</div>
  ),
  // MoveHistory / PlayerList / CapturedTray now render inside the board
  // slot's tab panel and call usePanelCollapseContext; on desktop it
  // returns null.
  usePanelCollapseContext: () => null,
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

describe("game route reads one identity and passes it to every identity-scoped hook", () => {
  beforeEach(() => {
    useGameState.mockReturnValue({
      data: {
        phase: "Playing",
        board: [],
        players: [],
        turn: "White",
        moveMaker: undefined,
        timerRemainingMs: 300000n,
      },
      isLoading: false,
      error: null,
      moves: [],
      lastMove: null,
      prevBoard: null,
      checkSquare: null,
    });
    useGameMeta.mockReturnValue({
      gameNumber: 1n,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("passes the accessor's principal to useGameState and useGameMeta", () => {
    renderRoute();

    expect(useGameState).toHaveBeenCalled();
    expect(useGameState.mock.calls[0]?.[0]).toBe(IDENTITY);
    expect(useGameMeta).toHaveBeenCalled();
    expect(useGameMeta.mock.calls[0]?.[0]).toBe(IDENTITY);
  });

  it("passes the accessor's principal to the heartbeat hook", () => {
    renderRoute();

    expect(useHeartbeat).toHaveBeenCalled();
    expect(useHeartbeat.mock.calls[0]?.[0]).toBe(IDENTITY);
  });

  it("uses the same principal for every identity-scoped hook", () => {
    renderRoute();

    const principals = [
      useGameState.mock.calls[0]?.[0],
      useGameMeta.mock.calls[0]?.[0],
      useHeartbeat.mock.calls[0]?.[0],
    ];
    expect(new Set(principals).size).toBe(1);
    expect(principals[0]).toBe(IDENTITY);
  });
});
