import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted ranked/guest SESSION-FLAG change.
 *
 * The request introduces a session flag (`team-chess-ranked-session`) that —
 * not the mere presence of the ranked slot — decides "ranked versus guest":
 *
 *   1. the Ranked/Guest badge follows the session flag;
 *   2. the game route's gameplay key follows the session flag;
 *   3. the Comp card's own-principal follows the session flag;
 *   4. `runGuestLogin` clears the ranked slot before logging in as guest;
 *   5. a leftover ranked slot with no session flag is cleared on app load;
 *   6. PredictionBetWindow and WalletConnectionWindow read the guest identity
 *      again (not the active identity);
 *   7. the wordmark version constant is v371.
 *
 * This file asserts the accepted behavior directly against the REAL
 * `@/hooks/use-guest-identity` module (so the flag/slot semantics are genuinely
 * exercised) and against the real game route's badge wiring. The backend actor
 * is mocked throughout: this is component/integration coverage of the frontend
 * wiring, NOT deployed browser E2E. The real login/loginRanked behavior is the
 * PocketIC lane's job.
 */

/* --- Real identity module: session-flag semantics ----------------------- */

import {
  RANKED_SESSION_STORAGE_KEY,
  RANKED_STORAGE_KEY,
  clearRankedSession,
  clearStaleRankedSlot,
  readRankedSession,
  setRankedIdentity,
  setRankedSession,
} from "@/hooks/use-guest-identity";

const GUEST_STORAGE_KEY = "team-chess-principal";

describe("ranked session flag is the source of truth for ranked versus guest", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("reports a ranked session only when the session flag is set", () => {
    expect(readRankedSession()).toBe(false);

    setRankedIdentity("ranked-key");
    // A ranked slot alone is NOT a ranked session.
    expect(readRankedSession()).toBe(false);

    setRankedSession();
    expect(readRankedSession()).toBe(true);
    expect(window.localStorage.getItem(RANKED_SESSION_STORAGE_KEY)).toBe(
      "ranked",
    );
  });

  it("clears the session flag on logout", () => {
    setRankedIdentity("ranked-key");
    setRankedSession();
    expect(readRankedSession()).toBe(true);

    clearRankedSession();
    expect(readRankedSession()).toBe(false);
    expect(window.localStorage.getItem(RANKED_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("clears a leftover ranked slot with no session flag on app load", () => {
    // A stale browser: a ranked key from an earlier session, no session flag.
    window.localStorage.setItem(RANKED_STORAGE_KEY, "stale-ranked-key");
    expect(readRankedSession()).toBe(false);

    clearStaleRankedSlot();

    expect(window.localStorage.getItem(RANKED_STORAGE_KEY)).toBeNull();
  });

  it("leaves a genuine ranked session untouched on app load", () => {
    setRankedIdentity("live-ranked-key");
    setRankedSession();

    clearStaleRankedSlot();

    expect(window.localStorage.getItem(RANKED_STORAGE_KEY)).toBe(
      "live-ranked-key",
    );
    expect(readRankedSession()).toBe(true);
  });

  it("is idempotent: a second app-load cleanup finds no ranked slot", () => {
    window.localStorage.setItem(RANKED_STORAGE_KEY, "stale-ranked-key");

    clearStaleRankedSlot();
    clearStaleRankedSlot();

    expect(window.localStorage.getItem(RANKED_STORAGE_KEY)).toBeNull();
  });
});

/* --- Game route: badge and gameplay key follow the session flag --------- */

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

// The game route's gameplay identity comes from the REAL active-identity
// accessor, which reads the real ranked slot + session flag. The guest hook is
// stubbed to a stable guest key so the two paths are distinguishable.
const GUEST_KEY = "guest-pseudo-principal";
const RANKED_KEY = "ranked-key-in-slot";

const { capturedRankedProp, capturedGameStatePrincipal } = vi.hoisted(() => ({
  capturedRankedProp: { current: undefined as boolean | undefined },
  capturedGameStatePrincipal: { current: undefined as string | undefined },
}));

vi.mock("@/hooks/use-guest-identity", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/use-guest-identity")>();
  return {
    ...actual,
    useGuestIdentity: () => GUEST_KEY,
  };
});

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: { logout: vi.fn().mockResolvedValue(undefined) },
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({ logout: vi.fn() }),
}));

vi.mock("@/hooks/use-heartbeat", () => ({ useHeartbeat: () => {} }));
vi.mock("@/hooks/use-sound-effects", () => ({ useSoundEffects: () => {} }));

vi.mock("@/hooks/use-game-state", () => ({
  useGameState: (principal: string) => {
    capturedGameStatePrincipal.current = principal;
    return {
      data: {
        phase: "Paused",
        board: [],
        players: [],
        turn: "White",
        moveMaker: undefined,
        timerRemainingMs: 300000n,
        winner: undefined,
        celebrationSecondsLeft: undefined,
        openingName: undefined,
        spellUseEnabled: false,
        spellWinName: undefined,
      },
      isLoading: false,
      error: null,
      moves: [],
      lastMove: null,
      prevBoard: null,
      checkSquare: null,
    };
  },
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

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// Layout is stubbed to capture the `ranked` prop the route passes to the
// Ranked/Guest badge, and to render the board slot.
vi.mock("@/components/Layout", () => ({
  Layout: ({
    ranked,
    windows,
  }: {
    ranked?: boolean;
    windows: { board: React.ReactNode };
  }) => {
    capturedRankedProp.current = ranked;
    return <div>{windows.board}</div>;
  },
}));

vi.mock("@/components/EndGameModal", () => ({
  EndGameModal: () => <div data-testid="end-game-modal" />,
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

describe("game route badge and gameplay key follow the session flag", () => {
  beforeEach(() => {
    window.localStorage.clear();
    capturedRankedProp.current = undefined;
    capturedGameStatePrincipal.current = undefined;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("shows the Guest badge and plays under the guest key for a guest session", () => {
    window.localStorage.setItem(GUEST_STORAGE_KEY, GUEST_KEY);

    renderRoute();

    expect(capturedRankedProp.current).toBe(false);
    expect(capturedGameStatePrincipal.current).toBe(GUEST_KEY);
  });

  it("shows the Guest badge and plays under the guest key when a stale ranked slot has no session flag", () => {
    // A leftover ranked key from an earlier session, but no session flag.
    window.localStorage.setItem(RANKED_STORAGE_KEY, RANKED_KEY);
    window.localStorage.setItem(GUEST_STORAGE_KEY, GUEST_KEY);

    renderRoute();

    expect(capturedRankedProp.current).toBe(false);
    expect(capturedGameStatePrincipal.current).toBe(GUEST_KEY);
  });

  it("shows the Ranked badge and plays under the ranked key for a ranked session", () => {
    window.localStorage.setItem(RANKED_STORAGE_KEY, RANKED_KEY);
    window.localStorage.setItem(RANKED_SESSION_STORAGE_KEY, "ranked");
    window.localStorage.setItem(GUEST_STORAGE_KEY, GUEST_KEY);

    renderRoute();

    expect(capturedRankedProp.current).toBe(true);
    expect(capturedGameStatePrincipal.current).toBe(RANKED_KEY);
  });
});
