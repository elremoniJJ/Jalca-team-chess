import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the accepted "concluded-game number" and
 * "Spells cast accumulation" changes.
 *
 * The accepted request intentionally changes two things:
 *   1. the Game Record modal's NFT Mint Results section will read the number
 *      of the game that just ended instead of the live post-increment counter
 *      (so its displayed game number and listed attempts change for a
 *      concluded game); and
 *   2. the "Spells cast" list will stop clearing on every move completion and
 *      will instead accumulate for the whole game, clearing only at game
 *      start and game end.
 *
 * Those two behaviors are deliberately NOT asserted here — pinning the current
 * (pre-change) selection or the current per-turn clearing would fight the
 * change.
 *
 * What IS protected is the behavior ADJACENT to the change that must survive
 * it:
 *
 *   - The modal's mint-status section stays INTERNALLY CONSISTENT: whatever
 *     game number the modal displays, the attempts it lists are the attempts
 *     recorded for that same number. The change moves which number is chosen,
 *     not the invariant that the displayed number and the listed attempts
 *     agree.
 *   - When no attempt group matches the displayed game number, the section
 *     shows its empty message rather than another game's attempts.
 *   - The "Spells cast" list stays SPLIT between White and Black: each team's
 *     window lists only that team's cast spells, each entry carries its
 *     outcome marker, and Subao Ve never appears as a list item.
 *
 * The actor is a typed local mock (no real canister, no network), so this file
 * proves the frontend consumer contract only. The backend's own retention and
 * per-spell outcome classification are the PocketIC lane's job. See
 * episode.coverageLimits.
 */

// EndGameModal imports enum values as runtime values from @/backend, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the modal and its helpers
// need.
vi.mock("@/backend", () => ({
  EndState: {
    Draw: "Draw",
    Checkmate: "Checkmate",
    Timeout: "Timeout",
    Stalemate: "Stalemate",
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
  RecipientRole: { Drawer: "Drawer", Winner: "Winner" },
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  SpellComplexity: { Easy: "Easy", Complex: "Complex", Moderate: "Moderate" },
  SpellUse: { On: "On", Off: "Off" },
  BurnedSpellCategory: {
    SubaoVe: "SubaoVe",
    Minor: "Minor",
    Major: "Major",
    Balls: "Balls",
  },
  SpellCastOutcome: {
    succeeded: "succeeded",
    prevented: "prevented",
    noEffect: "noEffect",
  },
}));

// The modal reads useActorState; return a null actor so no spell table / mint
// queries fire from the modal itself.
const { useActorState } = vi.hoisted(() => ({ useActorState: vi.fn() }));
vi.mock("@/lib/backend-actor", () => ({ useActorState }));

// Heavy board/piece renderers — mock to markers so the modal test stays
// focused on the mint-status content.
vi.mock("@/components/Chessboard", () => ({
  Chessboard: () => <div data-testid="chessboard" />,
}));
vi.mock("@/components/MedievalPiece", () => ({
  MedievalPiece: () => <div data-testid="medieval-piece" />,
}));

// The team spell windows read these hooks; mock them so the window test stays
// focused on the Spells cast split.
const {
  useGameState,
  useSpellBoardState,
  useBurnState,
  useShieldResolutionSnapshot,
  useGameMeta,
} = vi.hoisted(() => ({
  useGameState: vi.fn(),
  useSpellBoardState: vi.fn(),
  useBurnState: vi.fn(),
  useShieldResolutionSnapshot: vi.fn(),
  useGameMeta: vi.fn(),
}));
vi.mock("@/hooks/use-game-state", () => ({ useGameState }));
vi.mock("@/hooks/use-spell-board-state", () => ({ useSpellBoardState }));
vi.mock("@/hooks/use-burn-state", () => ({ useBurnState }));
vi.mock("@/hooks/use-shield-resolution-snapshot", () => ({
  useShieldResolutionSnapshot,
}));
vi.mock("@/hooks/use-game-meta", () => ({ useGameMeta }));

// OisyBurnPanel is a large surface owned by the isolated Oisy feature; mock it
// to a marker so this file stays focused on the team spell windows.
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

import {
  EndState,
  GamePhase,
  GameResult__1,
  RecipientRole,
  SpellUse,
  Team,
} from "@/backend";
import type { MintAttempt, MintAttemptGroup, MintOutcome } from "@/backend";
import { EndGameModal } from "@/components/EndGameModal";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";
import type { GameRecord } from "@/types/chess";

/* ------------------------------------------------------------------ */
/* EndGameModal fixtures                                               */
/* ------------------------------------------------------------------ */

function makeRecord(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    active: false,
    concluded: true,
    openingName: "Italian Game - Giuoco Piano",
    result: GameResult__1.WhiteWin,
    endState: EndState.Checkmate,
    moves: [
      {
        username: "Ada",
        team: Team.White,
        notation: "e4",
        fromSquare: 12n,
        toSquare: 28n,
        timestamp: 1_000_000_000n,
        index: 0n,
        gaveCheck: false,
        isCastling: false,
        isEnPassant: false,
      },
    ],
    playerList: [
      { principal: "p1", username: "Ada", listPosition: 0n, team: Team.White },
    ],
    stalePlayerList: [],
    rosters: [
      {
        team: Team.White,
        count: 1n,
        members: [
          {
            principal: "p1",
            username: "Ada",
            listPosition: 0n,
            team: Team.White,
          },
        ],
      },
      { team: Team.Black, count: 0n, members: [] },
    ],
    finalBoard: [],
    ...overrides,
  };
}

/** Build one MintAttempt fixture with the given outcome. */
function makeAttempt(
  id: bigint,
  gameNumber: bigint,
  username: string,
  outcome: MintOutcome,
): MintAttempt {
  return {
    id,
    gameNumber,
    recipientWalletAddress: "aaaaa-aa",
    recipientUsername: username,
    recipientTeam: Team.White,
    recipientRole: RecipientRole.Winner,
    outcome,
    attemptedAt: 1_000_000_000n,
  };
}

function renderModal(props: Partial<Parameters<typeof EndGameModal>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EndGameModal
        phase={GamePhase.Celebration}
        record={makeRecord()}
        loading={false}
        gameNumber={7n}
        currentWalletAddress=""
        onRequestNewGame={vi.fn().mockResolvedValue(undefined)}
        onLogout={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("EndGameModal mint-status consistency (adjacent to the concluded-game-number change)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useActorState.mockReturnValue({
      actor: null,
      isLoading: false,
      error: null,
      retry: () => {},
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("lists the attempts recorded for the same game number the modal displays", () => {
    // The modal displays "Game #7" and must list game 7's attempts — the
    // displayed number and the listed attempts stay consistent. The change
    // moves which number is chosen, not this invariant.
    const groups: MintAttemptGroup[] = [
      {
        gameNumber: 7n,
        attempts: [
          makeAttempt(0n, 7n, "Ada", {
            __kind__: "succeeded",
            succeeded: { tokenId: 12n },
          }),
        ],
      },
      {
        gameNumber: 6n,
        attempts: [
          makeAttempt(1n, 6n, "Grace", {
            __kind__: "failed",
            failed: "mint canister call trapped",
          }),
        ],
      },
    ];
    renderModal({ gameNumber: 7n, mintAttemptGroups: groups });

    expect(screen.getByText("Game #7")).toBeInTheDocument();
    const section = document.querySelector(
      '[data-ocid="end_game.section.mint_status"]',
    );
    expect(section).not.toBeNull();
    expect(within(section as HTMLElement).getByText("Ada")).toBeInTheDocument();
    expect(
      screen.getByText("Minted successfully — token #12"),
    ).toBeInTheDocument();
    // The other game's attempt is not listed for this game.
    expect(
      screen.queryByText("Failed — the mint call errored"),
    ).not.toBeInTheDocument();
  });

  it("shows the empty message when no group matches the displayed game number", () => {
    const groups: MintAttemptGroup[] = [
      {
        gameNumber: 6n,
        attempts: [
          makeAttempt(0n, 6n, "Ada", {
            __kind__: "succeeded",
            succeeded: { tokenId: 3n },
          }),
        ],
      },
    ];
    renderModal({ gameNumber: 7n, mintAttemptGroups: groups });

    expect(screen.getByText("Game #7")).toBeInTheDocument();
    expect(
      screen.getByText("No NFT mint attempts recorded for this game."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Minted successfully — token #3"),
    ).not.toBeInTheDocument();
  });

  it("keeps the displayed game number and the selected attempts in agreement for a different number", () => {
    // Same invariant at a different number: the modal displays "Game #8" and
    // lists game 8's attempts, not game 7's.
    const groups: MintAttemptGroup[] = [
      {
        gameNumber: 8n,
        attempts: [
          makeAttempt(1n, 8n, "Grace", {
            __kind__: "failed",
            failed: "mint canister call trapped",
          }),
        ],
      },
      {
        gameNumber: 7n,
        attempts: [
          makeAttempt(0n, 7n, "Ada", {
            __kind__: "succeeded",
            succeeded: { tokenId: 12n },
          }),
        ],
      },
    ];
    renderModal({ gameNumber: 8n, mintAttemptGroups: groups });

    expect(screen.getByText("Game #8")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(
      screen.getByText("Failed — the mint call errored"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Minted successfully — token #12"),
    ).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* Team spell windows — the White/Black split                          */
/* ------------------------------------------------------------------ */

/** A burned spell entry as the backend's getBurnState returns it. */
interface BurnedSpellFixture {
  spellName: string;
  gameNumber: bigint;
  team: string;
  category: string;
  outcome: string;
}

function burnedSpell(
  spellName: string,
  gameNumber: bigint,
  team: string,
  category: string,
  outcome: string,
): BurnedSpellFixture {
  return { spellName, gameNumber, team, category, outcome };
}

function burnStateWith(overrides: {
  whiteMinorMajor?: BurnedSpellFixture[];
  whiteSubaoVe?: BurnedSpellFixture[];
  blackMinorMajor?: BurnedSpellFixture[];
  blackSubaoVe?: BurnedSpellFixture[];
}) {
  return {
    data: {
      burnOccurredThisTurn: true,
      burnedByTeam: ["White"],
      whiteWindow: {
        minorMajorSpells: overrides.whiteMinorMajor ?? [],
        subaoVeSpells: overrides.whiteSubaoVe ?? [],
      },
      blackWindow: {
        minorMajorSpells: overrides.blackMinorMajor ?? [],
        subaoVeSpells: overrides.blackSubaoVe ?? [],
      },
    },
    isLoading: false,
    error: null,
  };
}

function renderWindow() {
  // The window body (which mounts the team spell windows) is only rendered
  // when the window is expanded. The window persists its open state under
  // "tco-wallet-connection-open" and is collapsed by default, so seed the
  // persisted open state before rendering to exercise the body.
  window.localStorage.setItem("tco-wallet-connection-open", "true");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WalletConnectionWindow spellUse={SpellUse.On} />
    </QueryClientProvider>,
  );
}

function teamWindow(
  container: HTMLElement,
  team: "white" | "black",
): HTMLElement {
  const el = container.querySelector(`[data-ocid="team_spell_window.${team}"]`);
  if (el === null) throw new Error(`team_spell_window.${team} not rendered`);
  return el as HTMLElement;
}

describe("TeamSpellWindow White/Black split (adjacent to the Spells cast accumulation change)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useGameState.mockReturnValue({
      data: { moveMaker: "player-1", turn: "White" },
      isLoading: false,
      error: null,
      moves: [],
      lastMove: null,
      prevBoard: null,
      checkSquare: null,
    });
    useSpellBoardState.mockReturnValue({
      spellContext: undefined,
      isLoading: false,
    });
    useActorState.mockReturnValue({
      actor: null,
      isLoading: false,
      error: null,
      retry: () => {},
    });
    useShieldResolutionSnapshot.mockReturnValue({ data: undefined });
    useGameMeta.mockReturnValue({
      gameNumber: 10n,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps each team's cast spells in that team's own window", () => {
    // The accumulation change must not merge the two teams: White's window
    // lists only White's casts, Black's only Black's.
    useBurnState.mockReturnValue(
      burnStateWith({
        whiteMinorMajor: [
          burnedSpell("White Minor", 7n, "White", "Minor", "succeeded"),
        ],
        blackMinorMajor: [
          burnedSpell("Black Major", 8n, "Black", "Major", "prevented"),
        ],
      }),
    );

    const { container } = renderWindow();

    const white = within(teamWindow(container, "white"));
    expect(white.getByText("White Minor")).toBeInTheDocument();
    expect(white.queryByText("Black Major")).not.toBeInTheDocument();

    const black = within(teamWindow(container, "black"));
    expect(black.getByText("Black Major")).toBeInTheDocument();
    expect(black.queryByText("White Minor")).not.toBeInTheDocument();
  });

  it("shows each entry's outcome marker and never lists Subao Ve as an item", () => {
    useBurnState.mockReturnValue(
      burnStateWith({
        whiteMinorMajor: [
          burnedSpell("Minor Spell", 7n, "White", "Minor", "succeeded"),
          burnedSpell("Major Spell", 9n, "White", "Major", "prevented"),
          burnedSpell("Balls Spell", 4n, "White", "Balls", "noEffect"),
          // Defensive filter: a Subao Ve entry in the minor/major list must
          // never render as a list item.
          burnedSpell("Subao Ve", 5n, "White", "SubaoVe", "noEffect"),
        ],
      }),
    );

    const { container } = renderWindow();

    const white = within(teamWindow(container, "white"));
    expect(white.getByText("Minor Spell")).toBeInTheDocument();
    expect(white.getByText("Major Spell")).toBeInTheDocument();
    expect(white.getByText("Balls Spell")).toBeInTheDocument();
    expect(white.getByLabelText("Successful cast")).toBeInTheDocument();
    expect(white.getByLabelText("Unsuccessful cast")).toBeInTheDocument();
    expect(white.getByLabelText("No effect")).toBeInTheDocument();

    // Subao Ve is the counter label, so assert no list item carries it.
    expect(
      container.querySelector('[data-ocid="team_spell_window.white.item.4"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-ocid="team_spell_window.white.item.3"]'),
    ).toHaveTextContent("Balls Spell");
  });
});
