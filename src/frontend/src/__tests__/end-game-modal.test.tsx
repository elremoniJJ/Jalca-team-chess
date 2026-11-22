import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
}));

// useReceivedSpellName reads useActorState; return a null actor so no spell
// table / mint queries fire. The spell-name line is intentionally NOT asserted
// here — its display path is the behavior this build changes.
const { useActorState } = vi.hoisted(() => ({ useActorState: vi.fn() }));
vi.mock("@/lib/backend-actor", () => ({ useActorState }));

// Heavy board/piece renderers — mock to markers so the modal test stays
// focused on the summary content.
vi.mock("@/components/Chessboard", () => ({
  Chessboard: () => <div data-testid="chessboard" />,
}));
vi.mock("@/components/MedievalPiece", () => ({
  MedievalPiece: () => <div data-testid="medieval-piece" />,
}));

import { EndState, GamePhase, GameResult__1, Team } from "@/backend";
import { EndGameModal } from "@/components/EndGameModal";
import type { GameRecord } from "@/types/chess";

/**
 * Characterization of the EndGameModal's summary rendering.
 *
 * The build changes how the NFT spell name is displayed (it will read from a
 * value captured at mint time rather than reconstructing it via a wallet
 * lookup). That spell-name line is intentionally NOT frozen here. What IS
 * protected is the surrounding, unchanged summary behavior:
 *   - the modal renders only for terminal Celebration/Draw phases;
 *   - the Game # header and result banner render from the record;
 *   - the leaderboards / rosters render from the record's moves;
 *   - the footer "New game" / "Log out" actions are wired.
 */

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
      {
        username: "Grace",
        team: Team.Black,
        notation: "e5",
        fromSquare: 52n,
        toSquare: 36n,
        timestamp: 2_000_000_000n,
        index: 1n,
        gaveCheck: false,
        isCastling: false,
        isEnPassant: false,
      },
      {
        username: "Ada",
        team: Team.White,
        notation: "Qh5",
        fromSquare: 3n,
        toSquare: 39n,
        timestamp: 3_000_000_000n,
        index: 2n,
        gaveCheck: true,
        isCastling: false,
        isEnPassant: false,
      },
    ],
    playerList: [
      { principal: "p1", username: "Ada", listPosition: 0n, team: Team.White },
      {
        principal: "p2",
        username: "Grace",
        listPosition: 1n,
        team: Team.Black,
      },
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
      {
        team: Team.Black,
        count: 1n,
        members: [
          {
            principal: "p2",
            username: "Grace",
            listPosition: 1n,
            team: Team.Black,
          },
        ],
      },
    ],
    finalBoard: [],
    ...overrides,
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

describe("EndGameModal summary rendering", () => {
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

  it("renders nothing for non-terminal phases", () => {
    renderModal({ phase: GamePhase.Playing });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    cleanup();
    renderModal({ phase: GamePhase.Paused });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the Game # header and result banner from the record", () => {
    renderModal();
    expect(screen.getByText("Game #7")).toBeInTheDocument();
    expect(screen.getByText("White Wins")).toBeInTheDocument();
  });

  it("renders the leaderboards and rosters from the record's moves", () => {
    renderModal();
    // Most Checks — Ada gave check once (appears in the leaderboard, the
    // Final Move line, and the roster, so assert presence via getAllByText).
    expect(screen.getByText("Most Checks")).toBeInTheDocument();
    expect(screen.getAllByText("Ada").length).toBeGreaterThan(0);
    // Players at Conclusion — one per team.
    expect(screen.getByText("Players at Conclusion")).toBeInTheDocument();
    expect(screen.getByText("White:")).toBeInTheDocument();
    expect(screen.getByText("Black:")).toBeInTheDocument();
    // Team rosters — Grace appears only in the Black roster.
    expect(screen.getByText("Team Rosters")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
  });

  it("wires the footer New game and Log out actions", async () => {
    const user = userEvent.setup();
    const onRequestNewGame = vi.fn().mockResolvedValue(undefined);
    const onLogout = vi.fn();
    renderModal({ onRequestNewGame, onLogout });

    await user.click(screen.getByRole("button", { name: "New game" }));
    expect(onRequestNewGame).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

/**
 * Cover for the NFT sent display path this build changes.
 *
 * The modal no longer reconstructs the received spell name via a wallet-address
 * lookup chain. Instead it renders a simple confirmation directly below the
 * Game #:
 *   - with a connected wallet, the text line "NFT sent" renders (the spell
 *     name itself moved to the NFT details modal);
 *   - with no wallet address, the attached picture of the NFT (an <img> with
 *     alt "NFT sent") renders in place of the text line.
 * No backend lookup fires in either case.
 */
describe("EndGameModal NFT sent display", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders the 'NFT sent' confirmation when a wallet is connected", () => {
    renderModal({ currentWalletAddress: "aaaaa-aa" });

    expect(screen.getByText("NFT sent")).toBeInTheDocument();
    // No backend lookup fires for the spell name.
    expect(
      screen.queryByRole("img", { name: "NFT sent" }),
    ).not.toBeInTheDocument();
  });

  it("renders the NFT image when no wallet address is present", () => {
    renderModal({ currentWalletAddress: "" });

    const img = screen.getByRole("img", { name: "NFT sent" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute(
      "src",
      "/assets/generated/knight-favicon.dim_64x64.png",
    );
    // The text confirmation is not shown without a wallet.
    expect(screen.queryByText("NFT sent")).not.toBeInTheDocument();
  });
});
