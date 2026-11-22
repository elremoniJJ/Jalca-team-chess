import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the behavior ADJACENT to the accepted Ranked/Guest badge
 * and Comp-view own-wins changes, taken BEFORE those changes land.
 *
 * The request intentionally:
 *   1. adds a Ranked/Guest badge to the game header alongside the Spectating
 *      badge;
 *   2. adds a guest notice line and the signed-in player's own competition wins
 *      (credited name and principal) to the Comp view.
 *
 * Those two things are intentional, so this file deliberately does NOT assert
 * the presence of a Ranked/Guest badge, does NOT assert the absence of a guest
 * notice or an own-wins line, and does NOT pin the exact credited-name or
 * principal wording. What it protects is the behavior ADJACENT to the change
 * that must survive it:
 *
 *   - the game route still passes the spectator flag and the leave-spectating
 *     handler to Layout, so the existing Spectating badge and leave control
 *     keep working when the Ranked/Guest badge is added beside them;
 *   - the Comp view still renders the standings with rank, name and win count,
 *     still highlights the signed-in player's own row, and still carries no
 *     principal in any public response;
 *   - the backend's own-wins read (`getMyWins`) still returns only the caller's
 *     own {wins, rank} with no principal, which is the seam the credited-name
 *     and principal line will read from.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage, not deployed browser E2E. The real getMyWins behavior is asserted
 * in the PocketIC backend lane.
 */

/* --- Game route mocks --------------------------------------------------- */

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

// The spectator state seam. `useSpectator` returns a stable suffix for a
// spectator and null for a player; the test drives it per case.
const spectatorState = vi.hoisted(() => ({
  suffix: null as string | null,
}));

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  // The game route's gameplay identity and the Comp card read the active
  // identity; with no ranked session it resolves to the guest principal.
  useActiveIdentity: () => "player-1",
  // The Ranked/Guest badge follows the ranked session flag, not the slot.
  useRankedSession: () => false,
  useSpectator: () => spectatorState.suffix,
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity: vi.fn(),
  clearWalletAddress: vi.fn(),
  clearSpectator: vi.fn(),
  readWalletAddress: () => "",
  isSpectating: () => spectatorState.suffix !== null,
  // The game route reads the ranked key slot on mount to decide the
  // Ranked/Guest badge; the mock must expose the same key string the real
  // module exports.
  RANKED_STORAGE_KEY: "team-chess-ranked-principal",
}));

// The LeaderboardWindow's actor seam. `actor` is null until a Comp-view test
// assigns a typed fake; the game route never reads it.
const actorState = vi.hoisted(() => ({
  actor: null as {
    getWinnerRanking: (limit: bigint) => Promise<unknown>;
    getSundayCompStandings: (limit: bigint) => Promise<unknown>;
    getSundayCompStatus: () => Promise<unknown>;
    getPastWinners: () => Promise<unknown>;
    getMyWins: () => Promise<unknown>;
  } | null,
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: actorState.actor,
    isLoading: actorState.isLoading,
    error: actorState.error,
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

vi.mock("@/hooks/use-mint-attempts", () => ({
  useMintAttemptsByGame: () => ({ groups: [] }),
}));

vi.mock("@/hooks/use-shield-resolution-snapshot", () => ({
  useShieldResolutionSnapshot: () => ({ data: null, isLoading: false }),
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

// Capture the props the route hands to Layout. The stub renders a marker so
// the test can assert the spectator wiring without mounting the heavy real
// windows.
const { capturedLayoutProps } = vi.hoisted(() => ({
  capturedLayoutProps: {
    current: null as {
      spectator?: boolean;
      onLeaveSpectating?: () => void;
      onLogout?: () => void;
    } | null,
  },
}));

vi.mock("@/components/Layout", () => ({
  Layout: (props: {
    spectator?: boolean;
    onLeaveSpectating?: () => void;
    onLogout?: () => void;
  }) => {
    capturedLayoutProps.current = props;
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

import type {
  CompStandingRow,
  CompStatus,
  MyWins,
  PastWinnerRow,
} from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { Route as gameRoute } from "@/routes/game";

const GameRouteComponent = gameRoute.options.component!;

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  spectatorState.suffix = null;
  capturedLayoutProps.current = null;
});

/* --- Game route: spectator wiring survives the Ranked/Guest badge ------- */
describe("Game route spectator wiring survives the Ranked/Guest badge addition", () => {
  it("passes the spectator flag and leave handler to Layout for a spectator", () => {
    spectatorState.suffix = "spectator-suffix";
    // The route renders its error branch when the actor is null, so give it a
    // truthy actor; the route never calls it in this test.
    actorState.actor = makeActor();
    renderWithProviders(<GameRouteComponent />);

    const props = capturedLayoutProps.current;
    expect(props).not.toBeNull();
    expect(props?.spectator).toBe(true);
    expect(typeof props?.onLeaveSpectating).toBe("function");
  });

  it("passes spectator=false and a logout handler to Layout for a player", () => {
    spectatorState.suffix = null;
    actorState.actor = makeActor();
    renderWithProviders(<GameRouteComponent />);

    const props = capturedLayoutProps.current;
    expect(props).not.toBeNull();
    expect(props?.spectator).toBe(false);
    expect(typeof props?.onLogout).toBe("function");
  });
});

/* --- Comp view: standings and own-row highlight ------------------------- */

const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

function standing(
  rank: number,
  displayName: string,
  wins: number,
  isMe = false,
): CompStandingRow {
  return { rank: BigInt(rank), displayName, wins: BigInt(wins), isMe };
}

function pastWinner(
  sunday: bigint,
  winnerName: string | undefined,
  winnerWins: number | undefined,
  runnerUpName: string | undefined,
  runnerUpWins: number | undefined,
): PastWinnerRow {
  return {
    sunday,
    winnerName,
    winnerWins: winnerWins === undefined ? undefined : BigInt(winnerWins),
    runnerUpName,
    runnerUpWins: runnerUpWins === undefined ? undefined : BigInt(runnerUpWins),
  };
}

const LIVE_STATUS: CompStatus = {
  live: true,
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 6n * 3_600n + 12n * 60n,
};

const FROZEN_STATUS: CompStatus = {
  live: false,
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 2n * 86_400n + 5n * 3_600n,
};

interface ActorOverrides {
  standings?: CompStandingRow[];
  status?: CompStatus;
  pastWinners?: PastWinnerRow[];
  myWins?: MyWins;
}

function makeActor(overrides: ActorOverrides = {}) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi
      .fn()
      .mockResolvedValue(overrides.standings ?? []),
    getSundayCompStatus: vi
      .fn()
      .mockResolvedValue(overrides.status ?? FROZEN_STATUS),
    getPastWinners: vi.fn().mockResolvedValue(overrides.pastWinners ?? []),
    getMyWins: vi
      .fn()
      .mockResolvedValue(overrides.myWins ?? { rank: 0n, wins: 0n }),
  };
}

function seedOpen() {
  window.localStorage.setItem("tco-leaderboard-open", "true");
}

async function openSundayView() {
  await userEvent
    .setup()
    .click(await screen.findByRole("tab", { name: "Comp" }));
}

describe("Comp view standings survive the guest-notice and own-wins addition", () => {
  it("still renders the standings with rank, name and win count", async () => {
    seedOpen();
    actorState.actor = makeActor({
      standings: [standing(1, "Ada", 3, true), standing(2, "Bob", 1)],
      status: LIVE_STATUS,
    });
    renderWithProviders(<LeaderboardWindow />);

    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Ada")).toBeInTheDocument();
    expect(within(items[0]!).getByText("3")).toBeInTheDocument();
    expect(items[0]).toHaveAttribute("aria-current", "true");
  });

  it("still highlights the signed-in player's own row and no other", async () => {
    seedOpen();
    actorState.actor = makeActor({
      standings: [standing(1, "Ada", 3, true), standing(2, "Bob", 1)],
      status: LIVE_STATUS,
    });
    renderWithProviders(<LeaderboardWindow />);

    const list = await screen.findByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(items[1]).not.toHaveAttribute("aria-current");
  });

  it("still renders no principal in the public Sunday list", async () => {
    seedOpen();
    actorState.actor = makeActor({
      standings: [standing(1, "Ada", 3)],
      status: LIVE_STATUS,
    });
    const { container } = renderWithProviders(<LeaderboardWindow />);

    await screen.findByText("Ada");
    const list = container.querySelector(
      '[data-ocid="leaderboard.sunday.list"]',
    );
    expect(list).not.toBeNull();
    expect(list?.textContent).not.toMatch(PRINCIPAL_PATTERN);
  });

  it("still shows the empty state when the standings are empty", async () => {
    seedOpen();
    actorState.actor = makeActor({ standings: [], status: LIVE_STATUS });
    renderWithProviders(<LeaderboardWindow />);

    expect(
      await screen.findByText("No wins yet in this competition"),
    ).toBeInTheDocument();
  });

  it("still lists the Past winners columns with win counts, newest first", async () => {
    seedOpen();
    const newest = 1_792_281_600_000_000_000n;
    const older = newest - 604_800_000_000_000n;
    actorState.actor = makeActor({
      status: FROZEN_STATUS,
      pastWinners: [
        pastWinner(newest, "Ada", 4, "Bob", 2),
        pastWinner(older, "Cy", 1, undefined, undefined),
      ],
    });
    renderWithProviders(<LeaderboardWindow />);

    await openSundayView();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    const headers = within(rows[0]!).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "Date",
      "Winner",
      "Runner-up",
    ]);
    expect(within(rows[1]!).getByText("Ada")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("4 wins")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Cy")).toBeInTheDocument();
  });
});

/* --- Backend own-wins seam ---------------------------------------------- */

describe("getMyWins consumer contract", () => {
  it("returns only the caller's own wins and rank, with no principal", async () => {
    const actor = makeActor({ myWins: { rank: 2n, wins: 5n } });

    const result = await actor.getMyWins();

    expect(result).toEqual({ rank: 2n, wins: 5n });
    // The own-wins read carries no principal field — the credited name and
    // principal line must not read one from this response.
    expect(Object.keys(result).sort()).toEqual(["rank", "wins"]);
  });
});
