import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted Spells board view.
 *
 * The accepted request:
 *   - adds a Spells button to the board views bar, inserted second, so the
 *     order is Vote, Spells, Bet, Story, Leaderboard, Also on the IC;
 *   - shows the existing wallet / spell-burning window inside the board
 *     overlay through the same open-view mechanism as the other views, with an
 *     optional `embedded` prop that forces the body open, ignores the
 *     per-window localStorage open key and skips the collapsible header,
 *     chevron and per-window theme dots;
 *   - keeps the window's INFO content reachable through the overlay's INFO
 *     button;
 *   - closes the overlay after a successful burn only if Spells is still the
 *     open view;
 *   - disables the overlay's close button, Escape and the other view buttons
 *     while a burn is in progress, exactly like the Bet view.
 *
 * The route is driven through mocked hooks (no real actor, no polling) and the
 * heavy board children are stubbed, exactly as the sibling
 * board-view-bar-and-overlay-cover test does. The real Layout, ViewBar,
 * BoardViewOverlay and WalletConnectionWindow render; only the Oisy burn hook
 * is mocked so a burn can be driven deterministically.
 */

// The route imports SpellUse/StartingPosition/GamePhase/Team/PieceType as
// runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test
// environment, so mock the backend module with the enum values the route and
// its children need.
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
  BurnedSpellCategory: {
    Major: "Major",
    Minor: "Minor",
    SubaoVe: "SubaoVe",
    Balls: "Balls",
  },
  SpellCastOutcome: {
    succeeded: "succeeded",
    prevented: "prevented",
    noEffect: "noEffect",
  },
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
  ClaimState: { claimable: "claimable", paying: "paying", paid: "paid" },
  ClaimStatus: { claimable: "claimable", expired: "expired" },
}));

// A live game snapshot with a consistent mover so the status header renders.
const { currentSnapshot } = vi.hoisted(() => {
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
  } = {
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
    spellUseEnabled: true,
  };
  return { currentSnapshot };
});

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useActiveIdentity: () => "player-1",
  useRankedSession: () => false,
  useSpectator: () => null,
  isSpectating: () => false,
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity: vi.fn(),
  clearRankedIdentity: vi.fn(),
  clearRankedSession: vi.fn(),
  clearSpectator: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "",
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {},
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

// The wallet window's burn hook — the seam that drives a burn's success and
// busy state. `burnState` lets a test flip `burning` and fire the success
// callback through the panel's own effects.
const { useOisyBurn, oisyState } = vi.hoisted(() => ({
  useOisyBurn: vi.fn(),
  oisyState: {
    burning: false,
    nfts: [] as Array<{ id: bigint; name: string; spellName: string }>,
    tokenStates: {} as Record<string, string>,
  },
}));

vi.mock("@/oisy-burn/use-oisy-burn", () => ({ useOisyBurn }));

vi.mock("@/hooks/use-burn-state", () => ({
  useBurnState: () => ({
    data: { burnOccurredThisTurn: false },
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

vi.mock("@/hooks/use-exercise-assignments", () => ({
  useExerciseAssignments: () => ({ assignments: [] }),
}));
vi.mock("@/hooks/use-drinking-assignments", () => ({
  useDrinkingAssignments: () => ({ assignments: [] }),
}));
vi.mock("@/hooks/use-game-mode", () => ({
  useGameMode: () => ({ mode: "off", setMode: vi.fn(), cycle: vi.fn() }),
}));

vi.mock("@/hooks/use-mint-attempts", () => ({
  useMintAttemptsByGame: () => ({ groups: [], isLoading: false, error: null }),
}));

vi.mock("@/hooks/use-leaderboard", () => ({
  LEADERBOARD_QUERY_KEY: ["winnerRanking"],
  PAST_WINNERS_QUERY_KEY: ["pastWinners"],
  SUNDAY_COMP_STANDINGS_QUERY_KEY: ["sundayCompStandings"],
  useLeaderboard: () => ({
    rows: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSundayCompStandings: () => ({
    rows: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  usePastWinners: () => ({
    rows: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSundayCompStatus: () => ({
    status: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useMyWins: () => ({
    myWins: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-prize", () => ({
  useMyPrize: () => ({
    prize: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useClaimStatus: () => ({
    status: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useFirstPrizeForSunday: () => ({
    firstPrizeE8s: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpcomingAllocationStatuses: () => ({
    statuses: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAdminAllocatedCompetitionDates: () => ({
    dates: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAdminCompetitionDetail: () => ({
    detail: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAdminFinalizeCompetitions: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useClaimPrize: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useClearPrizeAllocation: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  usePrizePreview: () => ({
    preview: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  usePrizeCanisterBalances: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useSavePrizeAllocation: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
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
    approveAllowance: vi.fn().mockResolvedValue({ ok: null }),
    checkAllowance: vi.fn().mockResolvedValue(null),
    relayState: { status: "idle" },
    relayBet: vi.fn(),
    getRealBets: vi.fn().mockResolvedValue([]),
    getSettlements: vi.fn().mockResolvedValue([]),
  }),
}));

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

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// Heavy board children are stubbed so the assertions stay focused on the
// Spells view. The real Layout, ViewBar, BoardViewOverlay and
// WalletConnectionWindow render.
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
vi.mock("@/components/CapturedTray", () => ({
  CapturedTray: () => <div data-testid="captured-tray" />,
}));
vi.mock("@/components/PlayerList", () => ({
  PlayerList: () => <div data-testid="player-list" />,
}));
vi.mock("@/components/MoveHistory", () => ({
  MoveHistory: () => <div data-testid="move-history" />,
}));

import { Route as gameRoute } from "@/routes/game";

const GameRouteComponent = gameRoute.options.component!;

function stubOisyBurn() {
  useOisyBurn.mockImplementation(() => ({
    connection: { status: "disconnected" },
    listingOwner: null,
    nfts: oisyState.nfts,
    loadingNfts: false,
    nftsError: null,
    tokenStates: oisyState.tokenStates,
    tokenResults: {},
    burning: oisyState.burning,
    signerAvailable: true,
    isMoveMaker: true,
    burnOccurredThisTurn: false,
    isFirstTurn: false,
    canBurn: true,
    burnDisabledReason: null,
    burnDisabledReasonFor: () => null,
    burnNoteFor: () => null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    refresh: vi.fn(),
    burnOne: vi.fn(),
  }));
}

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

describe("Spells board view", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
    oisyState.burning = false;
    oisyState.nfts = [];
    oisyState.tokenStates = {};
    vi.clearAllMocks();
  });

  it("opens the wallet window embedded inside the overlay with no collapsible header, chevron or theme dots", () => {
    stubOisyBurn();
    renderRoute();

    fireEvent.click(screen.getByTestId("viewbar.spells.button"));

    // The overlay opens with the Spells title and the wallet window body.
    expect(screen.getByTestId("viewoverlay.panel")).toBeInTheDocument();
    expect(screen.getByTestId("viewoverlay.title")).toHaveTextContent("Spells");
    const walletPanel = screen.getByTestId("wallet_connection_window");
    expect(walletPanel).toBeInTheDocument();

    // The embedded path skips the collapsible header, the info button and the
    // per-window theme dots.
    expect(
      screen.queryByTestId("wallet_connection_window.header"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("wallet_connection_window.info_button"),
    ).not.toBeInTheDocument();
    expect(
      walletPanel.querySelector(
        '[data-ocid^="wallet_connection_window.theme"]',
      ),
    ).toBeNull();

    // The body is forced open: the Oisy burn panel renders.
    expect(screen.getByTestId("oisy_burn.panel")).toBeInTheDocument();
  });

  it("ignores the per-window localStorage open key on the embedded path", () => {
    stubOisyBurn();
    // A prior session persisted the standalone window collapsed.
    window.localStorage.setItem("tco-wallet-connection-open", "false");

    renderRoute();
    fireEvent.click(screen.getByTestId("viewbar.spells.button"));

    // The embedded body is open regardless of the stored collapsed state.
    expect(screen.getByTestId("oisy_burn.panel")).toBeInTheDocument();
  });

  it("reaches the wallet window's INFO content from the overlay INFO button", () => {
    stubOisyBurn();
    renderRoute();

    fireEvent.click(screen.getByTestId("viewbar.spells.button"));
    fireEvent.click(screen.getByTestId("viewoverlay.info_button"));

    // The overlay swaps the window body for the wallet window's INFO content.
    const content = screen.getByTestId("viewoverlay.content");
    expect(within(content).getByText("Game NFT spells")).toBeInTheDocument();
    expect(
      within(content).getByTestId(
        "wallet_connection_window.spell_table_button",
      ),
    ).toBeInTheDocument();
  });

  it("opens the full-screen spell modal from the route and keeps it mounted while the info panel is open", () => {
    stubOisyBurn();
    renderRoute();

    // Open the Spells view, then its INFO panel, then the spell table button.
    fireEvent.click(screen.getByTestId("viewbar.spells.button"));
    fireEvent.click(screen.getByTestId("viewoverlay.info_button"));
    fireEvent.click(
      screen.getByTestId("wallet_connection_window.spell_table_button"),
    );

    // The modal is rendered by the route (not inside the embedded window, which
    // the overlay swaps out for its INFO content), so it stays mounted while
    // the info panel is showing. It portals to document.body and covers the
    // whole viewport.
    const dialog = screen.getByTestId("spell_table.dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.className).toMatch(/\bfixed\b/);
    expect(dialog.className).toMatch(/\binset-0\b/);

    // The INFO panel is still open underneath the modal.
    expect(screen.getByTestId("viewoverlay.content")).toBeInTheDocument();
  });

  it("closes the overlay after a successful burn while Spells is the open view", async () => {
    // A burn that completes WHILE the Spells view is open: the token
    // transitions to 'success' after mount, the burn panel's effect reports it
    // through onBurnSuccess, and the route closes the overlay because Spells
    // is the open view. A token already at 'success' when the view mounts is
    // seeded without firing (see the reopen test below), so the transition is
    // driven after mount.
    oisyState.nfts = [
      { id: 42n, name: "JALCA Game NFT #42", spellName: "Minor Spell" },
    ];
    oisyState.tokenStates = {};
    stubOisyBurn();
    const { rerender } = renderRoute();

    fireEvent.click(screen.getByTestId("viewbar.spells.button"));
    expect(screen.getByTestId("viewoverlay.panel")).toBeInTheDocument();

    // The burn completes: the token transitions to 'success'.
    oisyState.tokenStates = { "42": "success" };
    rerender(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <GameRouteComponent />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("viewoverlay.panel")).not.toBeInTheDocument();
    });
  });

  it("keeps the overlay open when a token is already successful at mount", async () => {
    // Reopening the Spells view while an old success entry still exists must
    // NOT immediately close it again: the burn panel seeds tokens already at
    // 'success' on mount without reporting them.
    oisyState.nfts = [
      { id: 42n, name: "JALCA Game NFT #42", spellName: "Minor Spell" },
    ];
    oisyState.tokenStates = { "42": "success" };
    stubOisyBurn();
    renderRoute();

    fireEvent.click(screen.getByTestId("viewbar.spells.button"));

    // Give the panel's effects a chance to run, then assert the overlay is
    // still present.
    await waitFor(() => {
      expect(screen.getByTestId("oisy_burn.panel")).toBeInTheDocument();
    });
    expect(screen.getByTestId("viewoverlay.panel")).toBeInTheDocument();
  });

  it("keeps the overlay open when a burn fails", async () => {
    // A failed burn leaves the token in the 'error' state. The burn panel's
    // success watcher must not report it, so the Spells overlay stays open.
    // This is the adjacent behavior the success-detection refactor must
    // preserve: only a success closes the view.
    oisyState.nfts = [
      { id: 42n, name: "JALCA Game NFT #42", spellName: "Minor Spell" },
    ];
    oisyState.tokenStates = { "42": "error" };
    stubOisyBurn();
    renderRoute();

    fireEvent.click(screen.getByTestId("viewbar.spells.button"));

    // Give the panel's effects a chance to run, then assert the overlay is
    // still present.
    await waitFor(() => {
      expect(screen.getByTestId("oisy_burn.panel")).toBeInTheDocument();
    });
    expect(screen.getByTestId("viewoverlay.panel")).toBeInTheDocument();
  });

  it("disables the close button, Escape and the other view buttons while a burn is in progress", async () => {
    // A burn already in flight: the burn panel reports busy through
    // onBusyChange as soon as the Spells view mounts, so the overlay locks.
    oisyState.nfts = [
      { id: 42n, name: "JALCA Game NFT #42", spellName: "Minor Spell" },
    ];
    oisyState.burning = true;
    stubOisyBurn();
    renderRoute();

    fireEvent.click(screen.getByTestId("viewbar.spells.button"));

    await waitFor(() => {
      expect(screen.getByTestId("viewoverlay.close_button")).toBeDisabled();
    });

    // Every view button is disabled while busy.
    for (const id of [
      "viewbar.vote.button",
      "viewbar.spells.button",
      "viewbar.bet.button",
      "viewbar.story.button",
      "viewbar.leaderboard.button",
      "viewbar.alsoOnIc.button",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }

    // Escape does not close the view while busy.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("viewoverlay.panel")).toBeInTheDocument();
  });

  it("calls the wallet connection hook exactly once per rendered page", () => {
    // The route owns the hook; the embedded window receives the resolved value
    // as a prop and must NOT call the hook itself. Opening, closing and
    // switching views must not add another call.
    stubOisyBurn();
    renderRoute();

    // The route calls the hook once on mount, before any view is open.
    expect(useOisyBurn).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("viewbar.spells.button"));
    expect(useOisyBurn).toHaveBeenCalledTimes(1);

    // Close and reopen the Spells view.
    fireEvent.click(screen.getByTestId("viewoverlay.close_button"));
    expect(useOisyBurn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("viewbar.spells.button"));
    expect(useOisyBurn).toHaveBeenCalledTimes(1);

    // Switch to another view and back.
    fireEvent.click(screen.getByTestId("viewbar.bet.button"));
    expect(useOisyBurn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("viewbar.spells.button"));
    expect(useOisyBurn).toHaveBeenCalledTimes(1);
  });

  it("keeps the wallet connection and loaded spell list across close, reopen and switch", () => {
    // The hoisted hook's resolved value (the connection and the loaded NFT
    // list) is owned by the route, so it survives the Spells view being
    // closed, reopened or switched. The same resolved object is handed to the
    // window each time it mounts.
    oisyState.nfts = [
      { id: 42n, name: "JALCA Game NFT #42", spellName: "Minor Spell" },
    ];
    stubOisyBurn();
    renderRoute();

    // The route resolved the connection once, before any view opened.
    expect(useOisyBurn).toHaveBeenCalledTimes(1);
    const resolved = useOisyBurn.mock.results[0]?.value;
    expect(resolved).toBeDefined();

    fireEvent.click(screen.getByTestId("viewbar.spells.button"));
    expect(screen.getByTestId("oisy_burn.panel")).toBeInTheDocument();

    // Close, reopen, switch away and back — the hook is never called again, so
    // the connection and spell list are never re-resolved.
    fireEvent.click(screen.getByTestId("viewoverlay.close_button"));
    fireEvent.click(screen.getByTestId("viewbar.spells.button"));
    fireEvent.click(screen.getByTestId("viewbar.bet.button"));
    fireEvent.click(screen.getByTestId("viewbar.spells.button"));

    expect(useOisyBurn).toHaveBeenCalledTimes(1);
    expect(useOisyBurn.mock.results[0]?.value).toBe(resolved);
    expect(screen.getByTestId("oisy_burn.panel")).toBeInTheDocument();
  });

  it("discards the wallet connection when the game screen unmounts", () => {
    // The hook lives in the route, so unmounting the game screen (for example
    // at logout) discards the connection and the loaded spell list. A fresh
    // mount calls the hook again.
    stubOisyBurn();
    const { unmount } = renderRoute();
    expect(useOisyBurn).toHaveBeenCalledTimes(1);

    unmount();

    // A fresh game screen mount resolves the connection again.
    renderRoute();
    expect(useOisyBurn).toHaveBeenCalledTimes(2);
  });
});
