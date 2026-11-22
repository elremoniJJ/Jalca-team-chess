import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted MINT-STATUS INDICATION behavior in the game
 * conclusion modal, plus the frontend consumer contract of the hook that
 * feeds it.
 *
 * Accepted behavior this file asserts:
 *   - A visible mint-status indication renders near the top of the modal
 *     body, ABOVE the existing Game # / NFT-sent block.
 *   - Each retained attempt is listed with the player and a plain-language
 *     reason, and the five required outcomes render DISTINCTLY:
 *       minted, skipped (stale heartbeat), skipped (no wallet),
 *       failed (hex account ID), failed (mint call error).
 *   - A clear summary state is shown when there are no attempts for the
 *     current game.
 *   - The indication reflects the CURRENT game's attempts: it selects the
 *     group matching the modal's gameNumber, so a new game's conclusion
 *     shows that game's attempts (and not an older game's).
 *   - The hook calls the real actor method `getMintAttemptsByGame()` and
 *     exposes the grouped result.
 *
 * The actor is a typed local mock (no real canister, no network). The
 * backend's own retention/pruning behavior is NOT exercised here — that is
 * the PocketIC lane's job. See episode.coverageLimits.
 */

// EndGameModal imports enum values (EndState, GameResult__1, Team, PieceType)
// as runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test environment
// (a pre-existing dependency issue), so mock the backend module with the enum
// values the modal and its helpers need.
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

import {
  EndState,
  GamePhase,
  GameResult__1,
  RecipientRole,
  Team,
} from "@/backend";
import type { MintAttempt, MintAttemptGroup, MintOutcome } from "@/backend";
import { EndGameModal } from "@/components/EndGameModal";
import { useMintAttemptsByGame } from "@/hooks/use-mint-attempts";
import type { GameRecord } from "@/types/chess";

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

describe("EndGameModal mint-status indication", () => {
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

  it("renders the indication near the top, above the Game # / NFT-sent block", () => {
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
    ];
    renderModal({
      mintAttemptGroups: groups,
      currentWalletAddress: "aaaaa-aa",
    });

    const section = document.querySelector(
      '[data-ocid="end_game.section.mint_status"]',
    );
    expect(section).not.toBeNull();

    // The indication is inside the scrollable modal body.
    const body = document.querySelector(
      '[data-ocid="end_game.dialog"] .min-h-0.flex-1.overflow-y-auto',
    );
    expect(body?.contains(section)).toBe(true);

    // It precedes the Game # / NFT-sent block (the insertion point is ABOVE
    // that block).
    const gameNumber = screen.getByText("Game #7");
    expect(
      (section as HTMLElement).compareDocumentPosition(gameNumber) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The Game # / NFT-sent block still renders below it.
    expect(screen.getByText("NFT sent")).toBeInTheDocument();
  });

  it("lists each player's outcome with a distinct plain-language reason", () => {
    const groups: MintAttemptGroup[] = [
      {
        gameNumber: 7n,
        attempts: [
          makeAttempt(0n, 7n, "Ada", {
            __kind__: "succeeded",
            succeeded: { tokenId: 12n },
          }),
          makeAttempt(1n, 7n, "Grace", {
            __kind__: "skipped",
            skipped: "stale heartbeat at game conclusion",
          }),
          makeAttempt(2n, 7n, "Bob", {
            __kind__: "skipped",
            skipped: "no wallet address supplied",
          }),
          makeAttempt(3n, 7n, "Cara", {
            __kind__: "failed",
            failed:
              "hex account IDs are not supported for minting; please use your principal textual address",
          }),
          makeAttempt(4n, 7n, "Dan", {
            __kind__: "failed",
            failed: "mint canister call trapped",
          }),
        ],
      },
    ];
    renderModal({ mintAttemptGroups: groups });

    // Each player is listed within the mint-status section (the same names
    // also appear in the rosters / leaderboards, so scope the query).
    const section = document.querySelector(
      '[data-ocid="end_game.section.mint_status"]',
    );
    expect(section).not.toBeNull();
    for (const name of ["Ada", "Grace", "Bob", "Cara", "Dan"]) {
      expect(
        within(section as HTMLElement).getByText(name),
      ).toBeInTheDocument();
    }

    // The five required outcomes render distinctly.
    expect(
      screen.getByText("Minted successfully — token #12"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Skipped — heartbeat was stale at game conclusion"),
    ).toBeInTheDocument();
    expect(screen.getByText("Skipped — no wallet address")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Failed — wallet address is a hex account ID, not a principal",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Failed — the mint call errored"),
    ).toBeInTheDocument();

    // The aggregate summary counts each outcome.
    const summary = screen.getByText(/attempts?/);
    expect(summary).toHaveTextContent("1 minted");
    expect(summary).toHaveTextContent("2 skipped");
    expect(summary).toHaveTextContent("2 failed");
  });

  it("shows a clear summary state when there are no attempts for the current game", () => {
    // Groups exist for an older game, but none for the current game 7.
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
    renderModal({ mintAttemptGroups: groups });

    expect(
      screen.getByText("No NFT mint attempts recorded for this game."),
    ).toBeInTheDocument();
    // The older game's attempt is not shown as this game's result.
    expect(
      screen.queryByText("Minted successfully — token #3"),
    ).not.toBeInTheDocument();
  });

  it("shows the empty summary state when no groups are supplied at all", () => {
    renderModal();
    expect(
      screen.getByText("No NFT mint attempts recorded for this game."),
    ).toBeInTheDocument();
  });

  it("reflects the current game's attempts when a new game concludes", () => {
    // Game 7 concluded with one attempt; game 8 concluded with a different
    // one. The modal for game 8 must show game 8's attempt, not game 7's.
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
    // The previous game's attempt is not shown for the current game.
    expect(
      screen.queryByText("Minted successfully — token #12"),
    ).not.toBeInTheDocument();
  });

  it("labels a whole-pass failure attempt with a neutral player label", () => {
    // A whole-pass failure is recorded with an empty username; the row must
    // still render with a neutral label rather than a blank player.
    const groups: MintAttemptGroup[] = [
      {
        gameNumber: 7n,
        attempts: [
          makeAttempt(0n, 7n, "", {
            __kind__: "failed",
            failed: "mint pass failed",
          }),
        ],
      },
    ];
    renderModal({ mintAttemptGroups: groups });

    expect(screen.getByText("Game-wide mint pass")).toBeInTheDocument();
    expect(screen.getByText("Failed — mint pass failed")).toBeInTheDocument();
  });
});

/**
 * Frontend consumer contract for the hook that feeds the indication. The
 * actor is a typed local mock; the backend's retention/pruning is NOT
 * exercised here.
 */
describe("useMintAttemptsByGame consumer contract", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("calls actor.getMintAttemptsByGame() and exposes the grouped result", async () => {
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
    ];
    const getMintAttemptsByGame = vi.fn().mockResolvedValue(groups);
    useActorState.mockReturnValue({
      actor: { getMintAttemptsByGame },
      isLoading: false,
      error: null,
      retry: () => {},
    });

    function Harness() {
      const { groups: exposed, isLoading } = useMintAttemptsByGame();
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="count">{exposed.length}</span>
          <span data-testid="game">
            {String(exposed[0]?.gameNumber ?? "none")}
          </span>
        </div>
      );
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(getMintAttemptsByGame).toHaveBeenCalledWith();
    });
    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent("1");
    });
    expect(screen.getByTestId("game")).toHaveTextContent("7");
  });

  it("exposes an empty group list while the actor is unavailable", async () => {
    useActorState.mockReturnValue({
      actor: null,
      isLoading: true,
      error: null,
      retry: () => {},
    });

    function Harness() {
      const { groups, isLoading } = useMintAttemptsByGame();
      return (
        <div>
          <span data-testid="loading">{String(isLoading)}</span>
          <span data-testid="count">{groups.length}</span>
        </div>
      );
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("count")).toHaveTextContent("0");
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
  });
});
