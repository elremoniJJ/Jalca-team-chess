import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the per-window theme dot picker added to each of the eight game
 * windows' headers.
 *
 * What this file asserts (accepted behavior):
 *   - each of the eight windows renders a single-row, six-dot picker in its
 *     header, with the dots centred by default;
 *   - each dot is a ~14-16px visible circle inside a larger transparent hit
 *     area, so it stays tappable;
 *   - selecting a dot applies that theme to that window only (via the
 *     data-window-theme attribute on the window root) and persists the pick
 *     under the window's own localStorage key;
 *   - a saved pick is re-read on load;
 *   - the global theme toggle clears every per-window pick and sets the
 *     global theme;
 *   - on a narrow container the dots shrink first (to a ~12px minimum) and
 *     only shift off-centre if even the minimum still collides.
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
import { CapturedTray } from "@/components/CapturedTray";
import { MoveHistory } from "@/components/MoveHistory";
import { PlayerList } from "@/components/PlayerList";
import { PredictionBetWindow } from "@/components/PredictionBetWindow";
import { StatusWindow } from "@/components/StatusWindow";
import { StoryWindow } from "@/components/StoryWindow";
import { ThemePalette } from "@/components/ThemePalette";
import { VotingWindow } from "@/components/VotingWindow";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";
import { WindowThemeDots } from "@/components/WindowThemeDots";
import { useTheme } from "@/hooks/use-theme";
import {
  WINDOW_THEME_KEY_PREFIX,
  windowThemeKey,
} from "@/hooks/use-window-theme";

function withQueryClient(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

/** The six theme ids in picker order. */
const THEME_ORDER = [
  "light",
  "dark",
  "dark-neon",
  "fire",
  "water",
  "bubblegum",
] as const;

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

/**
 * Render each of the eight windows. Returns a cleanup-free render; callers
 * assert against the returned container.
 */
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
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.className = "";
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/* --- Every window renders a centred single-row picker ------------------ */

describe("each window renders a centred single-row theme dot picker", () => {
  for (const prefix of WINDOW_PREFIXES) {
    it(`${prefix} renders six dots in one non-wrapping row`, () => {
      renderWindow(prefix);

      const dots = dotButtons(prefix);
      expect(dots).toHaveLength(THEME_ORDER.length);

      // The row is a single flex line that never wraps.
      const fieldset = dots[0].parentElement as HTMLElement;
      expect(fieldset.className).toContain("flex-nowrap");

      // The container centres the row by default (no off-centre shift).
      expect(dotsFor(prefix).className).toContain("justify-center");
    });
  }

  it("labels each dot with its theme and marks the active one", () => {
    renderWindow("status_window");

    const dots = dotButtons("status_window");
    expect(dots[0]).toHaveAttribute("aria-label", "Light theme");
    expect(dots[1]).toHaveAttribute("aria-label", "Dark theme");
    expect(dots[2]).toHaveAttribute("aria-label", "Neon theme");
    expect(dots[3]).toHaveAttribute("aria-label", "Fire theme");
    expect(dots[4]).toHaveAttribute("aria-label", "Water theme");
    expect(dots[5]).toHaveAttribute("aria-label", "Bubblegum theme");

    // No pick yet → nothing is pressed.
    for (const dot of dots) {
      expect(dot).toHaveAttribute("aria-pressed", "false");
    }
  });
});

/* --- Dot size and tap padding ------------------------------------------ */

describe("dots are ~14-16px with extra invisible tap padding", () => {
  it("renders a 16px visible dot inside a larger transparent hit area", () => {
    renderWindow("status_window");

    const dot = dotButtons("status_window")[0];
    const visible = dot.querySelector("span") as HTMLElement;

    // Visible circle is within the 14-16px band (16px at the default size).
    expect(visible.style.width).toBe("16px");
    expect(visible.style.height).toBe("16px");

    // The button (hit area) is larger than the visible dot, so the extra
    // padding is invisible but tappable.
    expect(dot.style.width).toBe("28px");
    expect(dot.style.height).toBe("28px");
    expect(Number.parseFloat(dot.style.width)).toBeGreaterThan(
      Number.parseFloat(visible.style.width),
    );
  });
});

/* --- Selecting a dot re-themes that window only and persists ----------- */

describe("selecting a dot re-themes that window only and persists", () => {
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
    // MoveHistory's root carries no data-ocid; it is the top-level child of
    // the render container that owns the move_history dots.
    const moveRoot = Array.from(container.children).find((child) =>
      child.querySelector('[data-ocid="move_history.theme_dots"]'),
    ) as HTMLElement;
    expect(moveRoot).toBeTruthy();

    // Pick fire in the status window only.
    const statusDots = dotsFor("status_window");
    await user.click(
      within(statusDots).getByRole("button", { name: "Fire theme" }),
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

/* --- Global toggle clears every per-window pick ------------------------ */

describe("global theme toggle clears per-window picks", () => {
  it("clears every window key and sets the global theme", async () => {
    const user = userEvent.setup();

    // Seed picks for several windows.
    window.localStorage.setItem(windowThemeKey("status_window"), "fire");
    window.localStorage.setItem(windowThemeKey("move_history"), "water");
    window.localStorage.setItem(windowThemeKey("player_list"), "dark");

    render(<ThemePalette />);

    await user.click(
      screen.getByRole("button", {
        name: /Theme: Light\. Click to choose a theme/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Dark theme" }));

    // Global theme applied and persisted.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("theme")).toBe("dark");

    // Every per-window key is gone.
    for (const prefix of WINDOW_PREFIXES) {
      expect(window.localStorage.getItem(windowThemeKey(prefix))).toBeNull();
    }
    // No stray prefixed keys remain.
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      expect(key?.startsWith(WINDOW_THEME_KEY_PREFIX)).toBe(false);
    }
  });

  it("drops a mounted window's in-memory pick when the global toggle fires", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(windowThemeKey("status_window"), "fire");

    render(
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
        <ThemePalette />
      </>,
    );

    const root = document.querySelector(
      '[data-ocid="status_window"]',
    ) as HTMLElement;
    expect(root).toHaveAttribute("data-window-theme", "fire");

    await user.click(
      screen.getByRole("button", {
        name: /Theme: Light\. Click to choose a theme/,
      }),
    );
    // Scope to the popover: the status window's own dot is also named
    // "Water theme", so a global query would be ambiguous.
    const popover = document.querySelector(
      '[data-ocid="header.theme_popover"]',
    ) as HTMLElement;
    await user.click(
      within(popover).getByRole("button", { name: "Water theme" }),
    );

    // The window dropped its pick without a reload.
    expect(root).not.toHaveAttribute("data-window-theme");
    expect(
      window.localStorage.getItem(windowThemeKey("status_window")),
    ).toBeNull();
    expect(document.documentElement.classList.contains("theme-water")).toBe(
      true,
    );
  });
});

/* --- Narrow-width shrink-then-shift behavior --------------------------- */

describe("narrow container shrinks dots first, then shifts off-centre", () => {
  /** Force the picker's measured width to `width` px. */
  function stubWidth(width: number) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return width;
      },
    });
  }

  afterEach(() => {
    // Restore the jsdom default (0) so other tests are unaffected.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 0;
      },
    });
  });

  it("keeps 16px dots when the full row fits", () => {
    stubWidth(400);
    render(
      <WindowThemeDots
        value={null}
        onChange={() => {}}
        label="Test"
        ocidPrefix="probe"
      />,
    );

    const dot = screen.getByRole("button", { name: "Light theme" });
    expect((dot.querySelector("span") as HTMLElement).style.width).toBe("16px");
    expect(dotsFor("probe").className).toContain("justify-center");
  });

  it("shrinks dots toward the 12px minimum before shifting", () => {
    // Row at 16px needs 6*(16+12)+5*2 = 178px; at 12px needs 154px.
    // 160px fits only after shrinking, so dots shrink and stay centred.
    stubWidth(160);
    render(
      <WindowThemeDots
        value={null}
        onChange={() => {}}
        label="Test"
        ocidPrefix="probe"
      />,
    );

    const dot = screen.getByRole("button", { name: "Light theme" });
    const size = Number.parseFloat(
      (dot.querySelector("span") as HTMLElement).style.width,
    );
    expect(size).toBeGreaterThanOrEqual(12);
    expect(size).toBeLessThan(16);
    expect(dotsFor("probe").className).toContain("justify-center");
  });

  it("shifts off-centre only when even the 12px minimum collides", () => {
    // 100px cannot fit the 154px minimum row.
    stubWidth(100);
    render(
      <WindowThemeDots
        value={null}
        onChange={() => {}}
        label="Test"
        ocidPrefix="probe"
      />,
    );

    const dot = screen.getByRole("button", { name: "Light theme" });
    expect((dot.querySelector("span") as HTMLElement).style.width).toBe("12px");
    expect(dotsFor("probe").className).toContain("justify-end");
    expect(dotsFor("probe").className).not.toContain("justify-center");
  });
});

/* --- Global theme hook still works (adjacent behavior) ----------------- */

describe("global theme hook remains intact", () => {
  it("cycles through the six themes in order", async () => {
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
    }
  });
});
