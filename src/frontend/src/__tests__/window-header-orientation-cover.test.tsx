import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the orientation-driven visibility and true-centre positioning of
 * the per-window theme dot picker, plus the Story writer gating that shares the
 * changed header.
 *
 * Accepted behavior this file asserts in the frontend:
 *   - in a vertical/portrait viewport NO window header renders the six colour
 *     circle buttons, while the title and right-side controls stay;
 *   - in a horizontal/landscape viewport every window header renders them;
 *   - rotating between portrait and landscape shows/hides them live, with no
 *     reload (the matchMedia "change" event drives it);
 *   - the dot row is centred on the true middle of the window panel and sits
 *     at the same horizontal position for a short and a long title;
 *   - the row never overlaps the left title or the right-side controls: when
 *     the true middle would collide it is clamped to the nearest free edge;
 *   - the writer principal still sees the composer and gap-fill control, and a
 *     non-writer still sees neither.
 *
 * The backend actor is a typed local mock (no real canister, no network), so
 * this file proves the frontend consumer contract only. jsdom does not evaluate
 * CSS media queries, so orientation is simulated by stubbing window.matchMedia.
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
import { WindowThemeDots } from "@/components/WindowThemeDots";

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

/** The dot picker container for a window, or null when it is not rendered. */
function dotsFor(prefix: string): HTMLElement | null {
  return document.querySelector(`[data-ocid="${prefix}.theme_dots"]`);
}

/**
 * Install a controllable `window.matchMedia` that reports the given initial
 * orientation and lets a test flip it, firing the "change" listeners the way a
 * device rotation would.
 */
function installMatchMedia(initialLandscape: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  let matches = initialLandscape;
  const mql = {
    get matches() {
      return matches;
    },
    media: "(orientation: landscape)",
    onchange: null,
    addEventListener: (
      _type: string,
      cb: (event: { matches: boolean }) => void,
    ) => listeners.add(cb),
    removeEventListener: (
      _type: string,
      cb: (event: { matches: boolean }) => void,
    ) => listeners.delete(cb),
    addListener: (cb: (event: { matches: boolean }) => void) =>
      listeners.add(cb),
    removeListener: (cb: (event: { matches: boolean }) => void) =>
      listeners.delete(cb),
    dispatchEvent: () => true,
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
  return {
    /** Flip the orientation and notify every registered listener. */
    rotate(nextLandscape: boolean) {
      matches = nextLandscape;
      for (const cb of listeners) cb({ matches: nextLandscape });
    },
  };
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

/* --- Portrait hides the picker in every window header ------------------ */

describe("portrait viewport hides the six-dot picker in every window header", () => {
  for (const prefix of WINDOW_PREFIXES) {
    it(`${prefix} renders no theme dots in portrait`, () => {
      installMatchMedia(false);
      renderWindow(prefix);

      expect(dotsFor(prefix)).toBeNull();
    });
  }

  it("keeps the title and right-side controls in portrait", () => {
    installMatchMedia(false);
    renderWindow("voting_window");

    expect(screen.getByText("Vote on next game")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Toggle voting information" }),
    ).toBeInTheDocument();
    expect(dotsFor("voting_window")).toBeNull();
  });
});

/* --- Landscape shows the picker in every window header ----------------- */

describe("landscape viewport shows the six-dot picker in every window header", () => {
  for (const prefix of WINDOW_PREFIXES) {
    it(`${prefix} renders six dots in landscape`, () => {
      installMatchMedia(true);
      renderWindow(prefix);

      const container = dotsFor(prefix);
      expect(container).not.toBeNull();
      expect(container?.querySelectorAll("button")).toHaveLength(6);
    });
  }
});

/* --- Rotation shows/hides live, without a reload ----------------------- */

describe("rotating the device shows/hides the picker without a reload", () => {
  it("hides the dots when rotating landscape → portrait and restores them on the way back", () => {
    const media = installMatchMedia(true);
    renderWindow("status_window");

    expect(dotsFor("status_window")).not.toBeNull();

    act(() => media.rotate(false));
    expect(dotsFor("status_window")).toBeNull();

    act(() => media.rotate(true));
    expect(dotsFor("status_window")).not.toBeNull();
    expect(dotsFor("status_window")?.querySelectorAll("button")).toHaveLength(
      6,
    );
  });

  it("starts hidden in portrait and reveals the dots when rotated to landscape", () => {
    const media = installMatchMedia(false);
    renderWindow("story_window");

    expect(dotsFor("story_window")).toBeNull();

    act(() => media.rotate(true));
    expect(dotsFor("story_window")).not.toBeNull();
  });
});

/* --- True-centre positioning and collision clamping -------------------- */

describe("the dot row is centred on the true panel middle", () => {
  /**
   * Stub the geometry the picker measures: the header's clientWidth and each
   * sibling's bounding-rect width, keyed off data attributes on the elements.
   */
  function stubGeometry() {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        const raw = this.dataset.testWidth;
        return raw === undefined ? 0 : Number(raw);
      },
    });
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: HTMLElement) {
        const raw = this.dataset.testRectWidth;
        const width = raw === undefined ? 0 : Number(raw);
        return {
          width,
          height: 0,
          top: 0,
          left: 0,
          right: width,
          bottom: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      },
    });
  }

  afterEach(() => {
    // Restore jsdom defaults so other tests are unaffected.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value() {
        return {
          width: 0,
          height: 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      },
    });
  });

  /**
   * A header with a left title, the picker, and a right control, with the
   * measured widths supplied explicitly.
   */
  function HeaderHarness({
    headerWidth,
    leftWidth,
    rightWidth,
    title,
  }: {
    headerWidth: number;
    leftWidth: number;
    rightWidth: number;
    title: string;
  }) {
    return (
      <div
        data-testid="header"
        data-test-width={headerWidth}
        className="relative flex w-full items-center"
      >
        <span data-testid="left" data-test-rect-width={leftWidth}>
          {title}
        </span>
        <WindowThemeDots
          value={null}
          onChange={() => {}}
          label="Test"
          ocidPrefix="probe"
        />
        <span data-testid="right" data-test-rect-width={rightWidth}>
          R
        </span>
      </div>
    );
  }

  /** The translateX offset the picker applied to its row. */
  function rowOffset(): number {
    const fieldset = dotsFor("probe")?.querySelector("fieldset") as HTMLElement;
    const match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(
      fieldset.style.transform,
    );
    if (!match)
      throw new Error(`no translateX in "${fieldset.style.transform}"`);
    return Number(match[1]);
  }

  it("sits at the same position for a short title and a long title", () => {
    installMatchMedia(true);
    stubGeometry();

    // Wide header: the true middle fits between either title length.
    const { unmount } = render(
      <HeaderHarness
        headerWidth={400}
        leftWidth={20}
        rightWidth={100}
        title="Moves"
      />,
    );
    const shortOffset = rowOffset();
    unmount();

    render(
      <HeaderHarness
        headerWidth={400}
        leftWidth={100}
        rightWidth={100}
        title="A very long window title that takes up space"
      />,
    );
    const longOffset = rowOffset();

    // Centred on the panel middle in both cases, independent of title length.
    expect(shortOffset).toBe(0);
    expect(longOffset).toBe(0);
    expect(dotsFor("probe")?.className).toContain("justify-center");
  });

  it("clamps right of the left title when the true middle would overlap it", () => {
    installMatchMedia(true);
    stubGeometry();

    // 400px header, 150px title, 50px controls, 178px row: the free space
    // (200px) fits the row, but the true middle (111px) would start inside the
    // title, so the row shifts right to 150px (offset +39).
    render(
      <HeaderHarness
        headerWidth={400}
        leftWidth={150}
        rightWidth={50}
        title="Long title"
      />,
    );

    expect(rowOffset()).toBeGreaterThan(0);
    expect(dotsFor("probe")?.className).toContain("justify-center");
  });

  it("clamps left of the right-side controls when the true middle would overlap them", () => {
    installMatchMedia(true);
    stubGeometry();

    // 400px header, 50px title, 150px controls, 178px row: the free space
    // (200px) fits the row, but the true middle (111px) would run into the
    // controls, so the row shifts left to 72px (offset -39).
    render(
      <HeaderHarness
        headerWidth={400}
        leftWidth={50}
        rightWidth={150}
        title="Moves"
      />,
    );

    expect(rowOffset()).toBeLessThan(0);
    expect(dotsFor("probe")?.className).toContain("justify-center");
  });

  it("shrinks the dots before shifting, and only shifts when the minimum still collides", () => {
    installMatchMedia(true);
    stubGeometry();

    // 160px fits the row only after shrinking (16px row needs 178px, 12px
    // needs 154px), so the dots shrink and stay centred.
    const { unmount } = render(
      <HeaderHarness
        headerWidth={160}
        leftWidth={0}
        rightWidth={0}
        title="Moves"
      />,
    );
    const shrunk = dotsFor("probe")?.querySelector(
      "button span",
    ) as HTMLElement;
    const shrunkSize = Number.parseFloat(shrunk.style.width);
    expect(shrunkSize).toBeGreaterThanOrEqual(12);
    expect(shrunkSize).toBeLessThan(16);
    expect(rowOffset()).toBe(0);
    unmount();

    // 100px cannot fit even the 154px minimum row, so it shifts off-centre.
    render(
      <HeaderHarness
        headerWidth={100}
        leftWidth={0}
        rightWidth={0}
        title="Moves"
      />,
    );
    const minDot = dotsFor("probe")?.querySelector(
      "button span",
    ) as HTMLElement;
    expect(minDot.style.width).toBe("12px");
    expect(dotsFor("probe")?.className).toContain("justify-end");
  });
});

/* --- Story writer gating survives the header change -------------------- */

describe("Story writer gating is unchanged", () => {
  it("shows the composer and gap-fill control to the writer principal", async () => {
    const user = userEvent.setup();
    installMatchMedia(true);
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

    expect(await screen.findByText("Add a new section")).toBeInTheDocument();
    // The deleted gap lives on page 2 under the accepted pagination model.
    await user.click(
      screen.getByRole("button", { name: "Next page of story sections" }),
    );
    expect(
      await screen.findByPlaceholderText("Rewrite this section…"),
    ).toBeInTheDocument();
  });

  it("shows neither the composer nor the gap-fill control to a non-writer", async () => {
    const user = userEvent.setup();
    installMatchMedia(true);
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
