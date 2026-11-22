import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the per-window theme dot picker's LANDSCAPE behavior and
 * the header structure around it, taken BEFORE the orientation-driven
 * visibility change.
 *
 * The request intentionally changes two things:
 *   1. the dots become hidden in vertical/portrait view and shown in
 *      horizontal/landscape view (today visibility is width-only), and
 *   2. the dot row becomes centred on the true middle of the window panel
 *      rather than on the space left over after the left-hand title.
 *
 * This file deliberately does NOT assert either of those changed behaviors.
 * What it protects is the adjacent behavior that must survive the edit:
 *
 *   - in a landscape viewport every one of the eight window headers still
 *     renders its six-dot picker, in a single non-wrapping row;
 *   - each window header still keeps its own title and its right-side control
 *     (info button, wallet state, material badge, move count, roster count, or
 *     the Story sign-in control) alongside the dots;
 *   - selecting a dot in landscape still re-themes that window only and
 *     persists the pick under the window's own localStorage key;
 *   - the Story window still gates the writer composer and the gap-fill
 *     control on the exact writer principal, and still shows neither to a
 *     non-writer.
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

vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));

// StoryWindow is the only consumer of useInternetIdentity(); mock it with a
// controllable local state so the writer gating can be exercised.
const { mockUseInternetIdentity } = vi.hoisted(() => ({
  mockUseInternetIdentity: vi.fn(),
}));

vi.mock("@caffeineai/core-infrastructure", () => ({
  useInternetIdentity: mockUseInternetIdentity,
}));

const {
  getStorySections,
  appendStorySection,
  fillStoryGap,
  pressStoryDelete,
  pressStoryKeep,
} = vi.hoisted(() => ({
  getStorySections: vi.fn(),
  appendStorySection: vi.fn(),
  fillStoryGap: vi.fn(),
  pressStoryDelete: vi.fn(),
  pressStoryKeep: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {
      getStorySections,
      appendStorySection,
      fillStoryGap,
      pressStoryDelete,
      pressStoryKeep,
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

vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
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

import {
  GamePhase,
  SpellUse,
  StartingPosition,
  Team,
  WalletSource,
} from "@/backend";
import type { StoryRow } from "@/backend";
import { CapturedTray } from "@/components/CapturedTray";
import { MoveHistory } from "@/components/MoveHistory";
import { PlayerList } from "@/components/PlayerList";
import { PredictionBetWindow } from "@/components/PredictionBetWindow";
import { StatusWindow } from "@/components/StatusWindow";
import { StoryWindow } from "@/components/StoryWindow";
import { VotingWindow } from "@/components/VotingWindow";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";
import { windowThemeKey } from "@/hooks/use-window-theme";

const WRITER_PRINCIPAL =
  "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae";
const OTHER_PRINCIPAL = "aaaaa-aa-aaaaa-aa-aaaaa-aa-aaaaa-aa-aaaaa-aa";

const FOREVER_TEXT = "Forever placeholder text.";

/** A signed-out hook state. */
function signedOutState() {
  return {
    identity: null,
    login: vi.fn(),
    clear: vi.fn(),
    isAuthenticated: false,
    isLoggingIn: false,
    loginError: null,
  };
}

/** A signed-in hook state carrying the given principal. */
function signedInState(principalText: string) {
  return {
    identity: {
      getPrincipal: () => ({ toText: () => principalText }),
    },
    login: vi.fn(),
    clear: vi.fn(),
    isAuthenticated: true,
    isLoggingIn: false,
    loginError: null,
  };
}

/** The Forever section plus one live appended section. */
function sectionsFixture(): StoryRow[] {
  return [
    {
      index: 0n,
      text: FOREVER_TEXT,
      deleteCount: 0n,
      keepCount: 0n,
      deleted: false,
      hasVotedDelete: false,
      hasVotedKeep: false,
    },
    {
      index: 1n,
      text: "Wilkin met a travelling juggler.",
      deleteCount: 2n,
      keepCount: 1n,
      deleted: false,
      hasVotedDelete: false,
      hasVotedKeep: false,
    },
  ];
}

function withQueryClient(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

/** The eight windows' ocid prefixes, in the order the request lists them. */
const WINDOW_PREFIXES = [
  "status_window",
  "voting_window",
  "wallet_connection_window",
  "prediction_bet_window",
  "story_window",
  "captured_tray",
  "player_list",
  "move_history",
] as const;

/** Render each of the eight windows. */
function renderWindow(prefix: (typeof WINDOW_PREFIXES)[number]) {
  switch (prefix) {
    case "status_window":
      return render(
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
    case "voting_window":
      return withQueryClient(
        <VotingWindow
          spellUse={SpellUse.Off}
          onSpellUseChange={() => {}}
          startingPosition={StartingPosition.Standard}
          onStartingPositionChange={() => {}}
          gameNumber={7n}
        />,
      );
    case "wallet_connection_window":
      return withQueryClient(<WalletConnectionWindow spellUse={SpellUse.On} />);
    case "prediction_bet_window":
      return withQueryClient(<PredictionBetWindow />);
    case "story_window":
      return withQueryClient(<StoryWindow />);
    case "captured_tray":
      return render(
        <CapturedTray
          board={Array.from({ length: 64 }, () => null)}
          drinkingAssignments={[]}
          exerciseAssignments={[]}
          moves={[]}
          mode="off"
        />,
      );
    case "player_list":
      return render(
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
    case "move_history":
      return render(<MoveHistory moves={[]} />);
  }
}

/** The dot picker container for a window, by its data-ocid. */
function dotsFor(prefix: string): HTMLElement {
  const el = document.querySelector(
    `[data-ocid="${prefix}.theme_dots"]`,
  ) as HTMLElement | null;
  if (!el) throw new Error(`no theme dots container for ${prefix}`);
  return el;
}

/** The six dot buttons inside a window's picker. */
function dotButtons(prefix: string): HTMLElement[] {
  return Array.from(dotsFor(prefix).querySelectorAll<HTMLElement>("button"));
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
  mockUseInternetIdentity.mockReturnValue(signedOutState());
  getStorySections.mockResolvedValue(sectionsFixture());
  appendStorySection.mockResolvedValue(undefined);
  fillStoryGap.mockResolvedValue(undefined);
  pressStoryDelete.mockResolvedValue(undefined);
  pressStoryKeep.mockResolvedValue(undefined);

  // jsdom does not evaluate CSS media queries. Report a landscape viewport so
  // the picker's landscape-visible behavior is exercised explicitly.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("landscape"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.className = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/* --- Landscape: every window header still shows its six-dot picker ----- */

describe("landscape viewport keeps the six-dot picker in every window header", () => {
  for (const prefix of WINDOW_PREFIXES) {
    it(`${prefix} renders six dots in one non-wrapping row`, () => {
      renderWindow(prefix);

      const dots = dotButtons(prefix);
      expect(dots).toHaveLength(6);

      // The row is a single flex line that never wraps.
      const fieldset = dots[0].parentElement as HTMLElement;
      expect(fieldset.className).toContain("flex-nowrap");
    });
  }

  it("labels each dot with its theme", () => {
    renderWindow("status_window");

    const dots = dotButtons("status_window");
    expect(dots[0]).toHaveAttribute("aria-label", "Light theme");
    expect(dots[1]).toHaveAttribute("aria-label", "Dark theme");
    expect(dots[2]).toHaveAttribute("aria-label", "Neon theme");
    expect(dots[3]).toHaveAttribute("aria-label", "Fire theme");
    expect(dots[4]).toHaveAttribute("aria-label", "Water theme");
    expect(dots[5]).toHaveAttribute("aria-label", "Bubblegum theme");
  });
});

/* --- Header title and right-side control survive alongside the dots --- */

describe("window headers keep their title and right-side control", () => {
  it("VotingWindow keeps its title and Info control", () => {
    renderWindow("voting_window");

    expect(screen.getByText("Vote on next game")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Toggle voting information" }),
    ).toBeInTheDocument();
    expect(dotButtons("voting_window")).toHaveLength(6);
  });

  it("StatusWindow keeps its title and collapse control", () => {
    renderWindow("status_window");

    expect(
      screen.getByRole("button", { name: /Game status/ }),
    ).toBeInTheDocument();
    expect(dotButtons("status_window")).toHaveLength(6);
  });

  it("WalletConnectionWindow keeps its title and Info control", () => {
    renderWindow("wallet_connection_window");

    expect(screen.getByText("NFT Spell burning")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Toggle NFT wallet information" }),
    ).toBeInTheDocument();
    expect(dotButtons("wallet_connection_window")).toHaveLength(6);
  });

  it("PredictionBetWindow keeps its title and Info control", () => {
    renderWindow("prediction_bet_window");

    expect(screen.getByText("Prediction Bet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Toggle prediction bet information",
      }),
    ).toBeInTheDocument();
    expect(dotButtons("prediction_bet_window")).toHaveLength(6);
  });

  it("StoryWindow keeps its title, Info control, and sign-in control", () => {
    renderWindow("story_window");

    expect(screen.getByText("Story")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Toggle story information" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in/ })).toBeInTheDocument();
    expect(dotButtons("story_window")).toHaveLength(6);
  });

  it("CapturedTray keeps its title and material-advantage badge", () => {
    renderWindow("captured_tray");

    expect(screen.getByText("Captured")).toBeInTheDocument();
    const header = screen.getByRole("button", { name: /Captured/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(dotButtons("captured_tray")).toHaveLength(6);
  });

  it("PlayerList keeps its title and roster count", () => {
    renderWindow("player_list");

    expect(screen.getByText("Players")).toBeInTheDocument();
    expect(screen.getByText("1W / 0B")).toBeInTheDocument();
    expect(dotButtons("player_list")).toHaveLength(6);
  });

  it("MoveHistory keeps its title and move count", () => {
    renderWindow("move_history");

    expect(screen.getByText("Moves")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(dotButtons("move_history")).toHaveLength(6);
  });
});

/* --- Landscape: selecting a dot still re-themes that window only ------ */

describe("landscape dot selection re-themes that window only and persists", () => {
  it("applies the pick to the window root and saves it under its own key", async () => {
    const user = userEvent.setup();
    renderWindow("status_window");

    const root = document.querySelector(
      '[data-ocid="status_window"]',
    ) as HTMLElement;
    expect(root).not.toHaveAttribute("data-window-theme");

    await user.click(screen.getByRole("button", { name: "Fire theme" }));

    expect(root).toHaveAttribute("data-window-theme", "fire");
    expect(window.localStorage.getItem(windowThemeKey("status_window"))).toBe(
      "fire",
    );
    // The global <html> theme is untouched.
    expect(document.documentElement.className).toBe("");
    expect(window.localStorage.getItem("theme")).toBeNull();
  });

  it("re-reads a saved pick on load", () => {
    window.localStorage.setItem(windowThemeKey("status_window"), "water");

    renderWindow("status_window");

    const root = document.querySelector(
      '[data-ocid="status_window"]',
    ) as HTMLElement;
    expect(root).toHaveAttribute("data-window-theme", "water");
    expect(
      screen.getByRole("button", { name: "Water theme (active)" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps two windows' picks independent", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <StatusWindow
          turn={Team.White}
          phase={GamePhase.Playing}
          moveMaker="player-1"
          players={[]}
          timerRemainingMs={300000n}
          showCoordinates
          onToggleCoordinates={() => {}}
          onFlipBoard={() => {}}
        />
        <MoveHistory moves={[]} />
      </>,
    );

    const statusRoot = document.querySelector(
      '[data-ocid="status_window"]',
    ) as HTMLElement;
    const moveRoot = Array.from(container.children).find((child) =>
      child.querySelector('[data-ocid="move_history.theme_dots"]'),
    ) as HTMLElement;
    expect(moveRoot).toBeTruthy();

    await user.click(
      within(dotsFor("status_window")).getByRole("button", {
        name: "Fire theme",
      }),
    );

    expect(statusRoot).toHaveAttribute("data-window-theme", "fire");
    expect(moveRoot).not.toHaveAttribute("data-window-theme");
    expect(window.localStorage.getItem(windowThemeKey("status_window"))).toBe(
      "fire",
    );
    expect(
      window.localStorage.getItem(windowThemeKey("move_history")),
    ).toBeNull();
  });
});

/* --- Story writer gating survives the header change ------------------- */

describe("Story writer gating is unchanged", () => {
  it("shows the composer and gap-fill control to the writer principal", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(WRITER_PRINCIPAL));
    getStorySections.mockResolvedValue([
      {
        index: 0n,
        text: FOREVER_TEXT,
        deleteCount: 0n,
        keepCount: 0n,
        deleted: false,
      },
      {
        index: 1n,
        text: "",
        deleteCount: 10n,
        keepCount: 1n,
        deleted: true,
      },
    ]);
    withQueryClient(<StoryWindow />);
    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);

    // The composer is present for the writer.
    expect(await screen.findByText("Add a new section")).toBeInTheDocument();
    // The deleted gap lives on page 2 under the accepted pagination model.
    await user.click(
      screen.getByRole("button", { name: "Next page of story sections" }),
    );
    // The gap-fill control is present for the writer.
    expect(
      await screen.findByPlaceholderText("Rewrite this section…"),
    ).toBeInTheDocument();
  });

  it("shows neither the composer nor the gap-fill control to a non-writer", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    getStorySections.mockResolvedValue([
      {
        index: 0n,
        text: FOREVER_TEXT,
        deleteCount: 0n,
        keepCount: 0n,
        deleted: false,
      },
      {
        index: 1n,
        text: "",
        deleteCount: 10n,
        keepCount: 1n,
        deleted: true,
      },
    ]);
    withQueryClient(<StoryWindow />);
    await user.click(screen.getByRole("button", { name: /Story/ }));
    await screen.findByText(FOREVER_TEXT);
    // The deleted gap lives on page 2 under the accepted pagination model.
    await user.click(
      screen.getByRole("button", { name: "Next page of story sections" }),
    );

    await screen.findByText("This section was removed and awaits rewriting.");
    expect(screen.queryByText("Add a new section")).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Rewrite this section…"),
    ).not.toBeInTheDocument();
  });
});
