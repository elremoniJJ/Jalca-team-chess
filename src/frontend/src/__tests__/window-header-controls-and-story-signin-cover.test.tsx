import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The windows carry deterministic `data-ocid` markers rather than
// `data-testid`. Configure the test-id attribute so getByTestId can target
// them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the three accepted header/Story changes:
 *
 *   1. every window header's right-side control cluster (Info button,
 *      material-advantage badge, move count, roster count) sits flush at the
 *      far right edge of the header, after the centred theme dots;
 *   2. the per-window theme dots remain centred on the true panel middle and
 *      never overlap the restored right-side controls;
 *   3. the Story window Internet Identity sign-in button / principal indicator
 *      renders inside the window BODY directly above the Forever section, not
 *      in the header;
 *   4. the NFT Spell burning window header shows no OFF/ON state label.
 *
 * The assertions are structural and observable: DOM order and the header's
 * flex/absolute layout contract, plus the presence/absence of the sign-in
 * affordance in the header vs. the body. jsdom does not lay out CSS, so the
 * "flush right" and "centred" claims are asserted through the layout contract
 * the components encode (a `justify-between` header whose last child is the
 * shrink-0 control cluster, with the dots as an absolute full-width overlay
 * that is NOT a flex sibling between the title and the controls).
 *
 * The backend actor is a typed local mock (no real canister, no network), so
 * this file proves the frontend consumer contract only. The real Internet
 * Identity provider and the real backend are NOT exercised here.
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
// controllable local state so the sign-in affordance can be exercised.
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

/** The element carrying the given data-ocid. */
function byOcid(ocid: string): HTMLElement {
  const el = document.querySelector(`[data-ocid="${ocid}"]`);
  if (!el) throw new Error(`no element for ${ocid}`);
  return el as HTMLElement;
}

/**
 * The header ROW for a window: the `relative flex ... justify-between` div
 * that wraps the title toggle, the dots overlay, and the right-side controls.
 * It is the nearest ancestor of the header toggle button that carries the
 * `relative` layout class.
 */
function headerRowFor(toggleOcid: string): HTMLElement {
  const toggle = byOcid(toggleOcid);
  const row = toggle.closest(".relative");
  if (!row) throw new Error(`no header row for ${toggleOcid}`);
  return row as HTMLElement;
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
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.className = "";
  vi.clearAllMocks();
});

/* --- Story sign-in lives in the body, above Forever, not the header ---- */

describe("Story sign-in affordance lives in the window body above Forever", () => {
  it("renders the signed-out Sign in control in the body, not the header", async () => {
    const user = userEvent.setup();
    withQueryClient(<StoryWindow />);
    await user.click(screen.getByRole("button", { name: /Story/ }));

    const headerRow = headerRowFor("story_window.header");
    const signIn = screen.getByTestId("story.sign_in_button");

    // The sign-in control is NOT inside the header row.
    expect(headerRow.contains(signIn)).toBe(false);

    // It sits in the window body region, and the Forever section comes after
    // it in DOM order (the sign-in strip is directly above the story content).
    const body = document.querySelector("#story-window-body");
    expect(body).not.toBeNull();
    const windowRoot = headerRow.parentElement as HTMLElement;
    expect(windowRoot.contains(signIn)).toBe(true);

    const forever = document.querySelector(
      '[data-ocid="story.forever_section"]',
    );
    expect(forever).not.toBeNull();
    // The sign-in strip precedes the Forever section in document order.
    const position = signIn.compareDocumentPosition(forever as Node);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the signed-in principal indicator in the body, not the header", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(OTHER_PRINCIPAL));
    withQueryClient(<StoryWindow />);
    await user.click(screen.getByRole("button", { name: /Story/ }));

    const headerRow = headerRowFor("story_window.header");
    const indicator = screen.getByTestId("story.principal_indicator");
    const signOut = screen.getByTestId("story.sign_out_button");

    expect(headerRow.contains(indicator)).toBe(false);
    expect(headerRow.contains(signOut)).toBe(false);

    const windowRoot = headerRow.parentElement as HTMLElement;
    expect(windowRoot.contains(indicator)).toBe(true);
    expect(windowRoot.contains(signOut)).toBe(true);
  });

  it("keeps the header free of any sign-in or principal element", async () => {
    const user = userEvent.setup();
    mockUseInternetIdentity.mockReturnValue(signedInState(WRITER_PRINCIPAL));
    withQueryClient(<StoryWindow />);
    await user.click(screen.getByRole("button", { name: /Story/ }));

    const headerRow = headerRowFor("story_window.header");
    const headerScope = within(headerRow);

    expect(
      headerScope.queryByTestId("story.sign_in_button"),
    ).not.toBeInTheDocument();
    expect(
      headerScope.queryByTestId("story.principal_indicator"),
    ).not.toBeInTheDocument();
    expect(
      headerScope.queryByTestId("story.sign_out_button"),
    ).not.toBeInTheDocument();
    // The header still carries its title and Info control.
    expect(headerScope.getByText("Story")).toBeInTheDocument();
    expect(
      headerScope.getByRole("button", { name: "Toggle story information" }),
    ).toBeInTheDocument();
  });

  it("keeps the sign-in affordance reachable while the panel is collapsed", () => {
    withQueryClient(<StoryWindow />);

    // Collapsed by default: the body is unmounted, but the sign-in strip is
    // always mounted so the affordance stays reachable.
    expect(screen.getByRole("button", { name: /Story/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByTestId("story.sign_in_button")).toBeInTheDocument();
  });
});

/* --- NFT Spell burning header has no OFF/ON state label ---------------- */

describe("NFT Spell burning window header shows no OFF/ON state label", () => {
  it("renders no OFF or ON text in the header for either spell state", () => {
    for (const spellUse of [SpellUse.On, SpellUse.Off]) {
      const { unmount } = withQueryClient(
        <WalletConnectionWindow spellUse={spellUse} />,
      );

      const header = headerRowFor("wallet_connection_window.header");
      const headerScope = within(header);

      // The header keeps its title and Info control...
      expect(headerScope.getByText("NFT Spell burning")).toBeInTheDocument();
      expect(
        headerScope.getByRole("button", {
          name: "Toggle NFT wallet information",
        }),
      ).toBeInTheDocument();

      // ...but carries no OFF/ON state label.
      expect(headerScope.queryByText("OFF")).not.toBeInTheDocument();
      expect(headerScope.queryByText("ON")).not.toBeInTheDocument();
      expect(header.textContent).not.toMatch(/\b(OFF|ON)\b/);

      unmount();
    }
  });
});

/* --- Right-side controls sit flush at the far right of the header ------ */

describe("window header right-side controls sit flush at the far right", () => {
  /**
   * Assert the shared header layout contract: a `justify-between` flex row
   * whose LAST child is the shrink-0 right-side control cluster, with the
   * theme dots rendered as an absolute full-width overlay rather than a flex
   * sibling between the title and the controls. That is what places the
   * controls flush at the far right, clear of the centred dots.
   */
  function assertFlushRightHeader(header: HTMLElement, control: HTMLElement) {
    expect(header.className).toContain("justify-between");
    expect(header.className).toContain("relative");

    // The control is the last element child of the header.
    const children = Array.from(header.children);
    expect(children[children.length - 1]).toBe(control);

    // The dots overlay is absolutely positioned across the full header and is
    // not a flex sibling between the title and the control.
    const dots = header.querySelector('[data-ocid$=".theme_dots"]');
    expect(dots).not.toBeNull();
    expect((dots as HTMLElement).className).toContain("absolute");
    expect((dots as HTMLElement).className).toContain("inset-x-0");
  }

  it("VotingWindow: Info control is the last header child", () => {
    withQueryClient(
      <VotingWindow
        spellUse={SpellUse.Off}
        onSpellUseChange={() => {}}
        startingPosition={StartingPosition.Standard}
        onStartingPositionChange={() => {}}
        gameNumber={7n}
      />,
    );

    const header = headerRowFor("voting_window.header");
    const info = screen.getByRole("button", {
      name: "Toggle voting information",
    });
    assertFlushRightHeader(header, info);
  });

  it("WalletConnectionWindow: Info control is the last header child", () => {
    withQueryClient(<WalletConnectionWindow spellUse={SpellUse.On} />);

    const header = headerRowFor("wallet_connection_window.header");
    const info = screen.getByRole("button", {
      name: "Toggle NFT wallet information",
    });
    assertFlushRightHeader(header, info);
  });

  it("PredictionBetWindow: Info control is the last header child", () => {
    withQueryClient(<PredictionBetWindow />);

    const header = headerRowFor("prediction_bet_window.header");
    const info = screen.getByRole("button", {
      name: "Toggle prediction bet information",
    });
    assertFlushRightHeader(header, info);
  });

  it("StoryWindow: Info control is the last header child", () => {
    withQueryClient(<StoryWindow />);

    const header = headerRowFor("story_window.header");
    const info = screen.getByRole("button", {
      name: "Toggle story information",
    });
    assertFlushRightHeader(header, info);
  });

  it("CapturedTray: material-advantage badge is the last header child", () => {
    render(
      <CapturedTray
        board={Array.from({ length: 64 }, () => null)}
        drinkingAssignments={[]}
        exerciseAssignments={[]}
        moves={[]}
        mode="off"
      />,
    );

    const header = headerRowFor("captured_tray.header");
    const children = Array.from(header.children);
    const last = children[children.length - 1] as HTMLElement;
    // The badge cluster is a plain div (not the dots overlay).
    expect(last).not.toBe(header.querySelector('[data-ocid$=".theme_dots"]'));
    expect(last.className).toContain("shrink-0");
    assertFlushRightHeader(header, last);
  });

  it("PlayerList: roster count is the last header child", () => {
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

    // Desktop render has no header toggle button; the header row is the
    // parent of the theme-dots overlay.
    const header = byOcid("player_list.theme_dots")
      .parentElement as HTMLElement;
    const count = screen.getByText("1W / 0B");
    assertFlushRightHeader(header, count);
  });

  it("MoveHistory: move count is the last header child", () => {
    render(<MoveHistory moves={[]} />);

    const header = byOcid("move_history.theme_dots")
      .parentElement as HTMLElement;
    const count = screen.getByText("0");
    assertFlushRightHeader(header, count);
  });

  it("StatusWindow: header keeps its title and dots overlay with no right control", () => {
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

    const header = headerRowFor("status_window.header");
    expect(header.className).toContain("justify-between");
    expect(header.className).toContain("relative");
    const dots = header.querySelector('[data-ocid="status_window.theme_dots"]');
    expect(dots).not.toBeNull();
    expect((dots as HTMLElement).className).toContain("absolute");
    expect((dots as HTMLElement).className).toContain("inset-x-0");
  });
});

/* --- Theme dots stay centred and never overlap the controls ------------ */

describe("theme dots stay centred on the true panel middle", () => {
  it("renders the dots as a centred absolute overlay, not a flex sibling", () => {
    withQueryClient(<WalletConnectionWindow spellUse={SpellUse.On} />);

    const header = headerRowFor("wallet_connection_window.header");
    const dots = header.querySelector(
      '[data-ocid="wallet_connection_window.theme_dots"]',
    ) as HTMLElement;

    // The overlay spans the full header and centres its row by default.
    expect(dots.className).toContain("absolute");
    expect(dots.className).toContain("inset-x-0");
    expect(dots.className).toContain("justify-center");

    // The right-side control is a shrink-0 sibling, so the overlay's measured
    // free space excludes it and the row can never overlap it.
    const info = screen.getByRole("button", {
      name: "Toggle NFT wallet information",
    });
    expect(info.className).toContain("shrink-0");
  });
});
