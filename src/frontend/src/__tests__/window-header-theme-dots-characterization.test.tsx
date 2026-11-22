import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the eight game windows' HEADER structure and the global
 * theme toggle, taken BEFORE a per-window theme dot picker is added to each
 * window header.
 *
 * The dot picker is an intentional change, so this file deliberately does NOT
 * assert anything about dots, their size, their row, or per-window theme
 * persistence. What it protects is the adjacent header structure and global
 * theming that must survive the edit:
 *
 *   - each of the eight windows still renders its own header title, and the
 *     right-side control that already lives in that header (info button,
 *     wallet OFF/ON state, material-advantage badge, move count, roster
 *     count, or the Story sign-in control) is still present;
 *   - the global theme toggle (useTheme + ThemePalette) still applies the
 *     theme class to <html> and persists the active theme id to the
 *     localStorage key "theme";
 *   - useTheme still cycles through the six themes in order.
 *
 * The backend actor is a typed local mock (no real canister, no network), so
 * this file proves the frontend consumer contract only.
 */

/* --- Backend enum mock (shared by every window under test) ------------- */

vi.mock("@/backend", () => ({
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
  SpellComplexity: { Easy: "Easy", Complex: "Complex", Moderate: "Moderate" },
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
  Pot: { One: "One", Ten: "Ten", Hundred: "Hundred", Thousand: "Thousand" },
  GameOutcome: { white: "white", black: "black", draw: "draw" },
}));

/* --- Hook mocks -------------------------------------------------------- */

// The Layout imports InformationModal, which transitively pulls in
// @caffeineai/core-infrastructure via CanisterCyclesGauge. That package fails
// to resolve its own submodules in the jsdom environment (a pre-existing
// dependency issue), so mock the modal to a marker. This test never opens it.
vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));

// StoryWindow is the only consumer of useInternetIdentity(); mock it to a
// signed-out resting state so the header's sign-in control renders.
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

// The story data layer reaches the backend through useActorState(). Mock it
// with a typed actor whose story methods resolve to empty data.
vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {
      getStorySections: vi.fn().mockResolvedValue([]),
      appendStorySection: vi.fn(),
      fillStoryGap: vi.fn(),
      pressStoryDelete: vi.fn(),
      pressStoryKeep: vi.fn(),
    },
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/hooks/use-voting", () => ({
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
  useCastVote: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-burn-state", () => ({
  useBurnState: () => ({
    data: { burnOccurredThisTurn: false },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-shield-resolution-snapshot", () => ({
  useShieldResolutionSnapshot: () => ({ data: null, isLoading: false }),
}));

vi.mock("@/hooks/use-game-meta", () => ({
  useGameMeta: () => ({ gameNumber: 7n, isLoading: false, error: null }),
}));

vi.mock("@/hooks/use-game-state", () => ({
  useGameState: () => ({
    data: { players: [] },
    isLoading: false,
    error: null,
    moves: [],
    lastMove: null,
    prevBoard: null,
    checkSquare: null,
  }),
}));

vi.mock("@/hooks/use-spell-board-state", () => ({
  useSpellBoardState: () => ({ spellContext: undefined, isLoading: false }),
}));

vi.mock("@/hooks/use-game-mode", () => ({
  useGameMode: () => ({ mode: "off", setMode: vi.fn(), cycle: vi.fn() }),
}));

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "",
}));

// OisyBurnPanel is a large surface owned by the isolated Oisy feature; mock it
// to a marker so the WalletConnectionWindow header assertions stay focused.
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

// The PredictionBetWindow's BettingPanel calls usePbppBet; mock it to the
// hook's resting (disconnected) state so the window renders without a real
// wallet or actor.
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

import {
  GamePhase,
  SpellUse,
  StartingPosition,
  Team,
  WalletSource,
} from "@/backend";
import { CapturedTray } from "@/components/CapturedTray";
import { MoveHistory } from "@/components/MoveHistory";
import { PlayerList } from "@/components/PlayerList";
import { PredictionBetWindow } from "@/components/PredictionBetWindow";
import { StatusWindow } from "@/components/StatusWindow";
import { StoryWindow } from "@/components/StoryWindow";
import { ThemePalette } from "@/components/ThemePalette";
import { VotingWindow } from "@/components/VotingWindow";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";
import { useTheme } from "@/hooks/use-theme";

function withQueryClient(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.className = "";
  vi.clearAllMocks();
});

/* --- Each window keeps its header title and right-side control --------- */

describe("window headers keep their title and right-side control", () => {
  it("VotingWindow keeps its title and Info control", () => {
    withQueryClient(
      <VotingWindow
        spellUse={SpellUse.Off}
        onSpellUseChange={() => {}}
        startingPosition={StartingPosition.Standard}
        onStartingPositionChange={() => {}}
        gameNumber={7n}
      />,
    );

    expect(screen.getByText("Vote on next game")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Toggle voting information" }),
    ).toBeInTheDocument();
  });

  it("StatusWindow keeps its title and collapse control", () => {
    render(
      <StatusWindow
        turn={Team.White}
        phase={GamePhase.Playing}
        moveMaker="player-1"
        players={[]}
        timerRemainingMs={300000n}
        showCoordinates
        onToggleCoordinates={() => {}}
        onFlipBoard={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Game status/ }),
    ).toBeInTheDocument();
  });

  it("WalletConnectionWindow keeps its title and Info control", () => {
    withQueryClient(<WalletConnectionWindow spellUse={SpellUse.On} />);

    expect(screen.getByText("NFT Spell burning")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Toggle NFT wallet information" }),
    ).toBeInTheDocument();
  });

  it("PredictionBetWindow keeps its title and Info control", () => {
    withQueryClient(<PredictionBetWindow />);

    expect(screen.getByText("Prediction Bet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Toggle prediction bet information",
      }),
    ).toBeInTheDocument();
  });

  it("StoryWindow keeps its title, Info control, and sign-in control", () => {
    withQueryClient(<StoryWindow />);

    expect(screen.getByText("Story")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Toggle story information" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in/ })).toBeInTheDocument();
  });

  it("CapturedTray keeps its title and material-advantage badge", () => {
    const board = Array.from({ length: 64 }, () => null);
    render(
      <CapturedTray
        board={board}
        drinkingAssignments={[]}
        exerciseAssignments={[]}
        moves={[]}
        mode="off"
      />,
    );

    expect(screen.getByText("Captured")).toBeInTheDocument();
    // With an empty board the advantage is 0, so the badge is absent; the
    // header toggle itself must still be present and expanded.
    const header = screen.getByRole("button", { name: /Captured/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  it("PlayerList keeps its title and roster count", () => {
    render(
      <PlayerList
        players={[
          {
            principal: "player-1",
            username: "Ada",
            team: Team.White,
            walletSource: WalletSource.none,
            isMoveMaker: true,
            isFresh: true,
            isInactive: false,
            isBot: false,
          },
        ]}
        currentPrincipal="player-1"
      />,
    );

    expect(screen.getByText("Players")).toBeInTheDocument();
    expect(screen.getByText("1W / 0B")).toBeInTheDocument();
  });

  it("MoveHistory keeps its title and move count", () => {
    render(<MoveHistory moves={[]} />);

    expect(screen.getByText("Moves")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});

/* --- Global theme toggle (useTheme + ThemePalette) --------------------- */

describe("global theme toggle", () => {
  it("applies the selected theme class to <html> and persists it under 'theme'", async () => {
    const user = userEvent.setup();
    render(<ThemePalette />);

    await user.click(
      screen.getByRole("button", {
        name: /Theme: Light\. Click to choose a theme/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Dark theme" }));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });

  it("reads the persisted theme on mount and applies its class", () => {
    window.localStorage.setItem("theme", "fire");

    function Probe() {
      const { theme } = useTheme();
      return <span data-testid="theme-value">{theme}</span>;
    }
    render(<Probe />);

    expect(screen.getByTestId("theme-value")).toHaveTextContent("fire");
    expect(document.documentElement.classList.contains("theme-fire")).toBe(
      true,
    );
  });

  it("cycles through the six themes in order and persists each", async () => {
    const user = userEvent.setup();

    function Probe() {
      const { theme, cycleTheme } = useTheme();
      return (
        <button type="button" onClick={cycleTheme}>
          {theme}
        </button>
      );
    }
    render(<Probe />);

    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("light");

    for (const expected of [
      "dark",
      "dark-neon",
      "fire",
      "water",
      "bubblegum",
      "light",
    ]) {
      await user.click(button);
      expect(button).toHaveTextContent(expected);
      expect(window.localStorage.getItem("theme")).toBe(expected);
    }
  });
});
