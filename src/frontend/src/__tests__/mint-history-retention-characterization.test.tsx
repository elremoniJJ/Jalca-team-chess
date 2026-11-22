import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the mint-history retention change.
 *
 * The request intentionally changes two things, and this file deliberately
 * does NOT freeze either of them:
 *
 *   1. Mint attempts are currently wiped at `startNewGame`
 *      (`Nft.clearMintAttempts`). After the change they persist across games,
 *      capped at the 10 most recent games. The current wipe-on-new-game
 *      behavior is therefore NOT asserted here.
 *   2. The game conclusion modal currently has no mint-status indication.
 *      After the change a visible indication appears near the top, above the
 *      Game # / NFT-sent block. The absence of that indication is NOT
 *      asserted here.
 *
 * What this file protects is the behavior ADJACENT to those changes that must
 * survive them:
 *
 *   - The EndGameModal's existing summary structure, in particular the
 *     Game # / NFT-sent block that the new indication is inserted ABOVE. The
 *     block must still render, still be the first thing in the modal body,
 *     and still key off `currentWalletAddress`.
 *   - The modal's phase gating and footer actions.
 *   - The frontend consumer contract for the mint-status reads the new
 *     indication will consume: `getMintStatusesForGame()` and
 *     `getMintStatusForPlayer(walletAddress)` resolve to the empty/absent
 *     values on a fresh canister, and the generated `MintStatusEntry` /
 *     `MintOutcome` shapes are what the UI consumes.
 *
 * The actor is a typed local mock (no real canister, no network). The
 * backend's own retention/pruning behavior is NOT exercised here — that is
 * the PocketIC lane's job, and it is unavailable in this dispatch (no
 * compiled wasm on disk). See episode.coverageLimits.
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
// focused on the summary content.
vi.mock("@/components/Chessboard", () => ({
  Chessboard: () => <div data-testid="chessboard" />,
}));
vi.mock("@/components/MedievalPiece", () => ({
  MedievalPiece: () => <div data-testid="medieval-piece" />,
}));

import { EndState, GamePhase, GameResult__1, Team } from "@/backend";
import type { MintOutcome, MintStatusEntry } from "@/backend";
import { EndGameModal } from "@/components/EndGameModal";
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

describe("EndGameModal summary structure survives the mint-status insertion", () => {
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

  it("keeps the Game # / NFT-sent block as the first content in the modal body", () => {
    renderModal({ currentWalletAddress: "aaaaa-aa" });

    const body = document.querySelector(
      '[data-ocid="end_game.dialog"] .min-h-0.flex-1.overflow-y-auto',
    );
    expect(body).not.toBeNull();

    // The Game # header and the NFT sent line are the top of the body — the
    // insertion point for the new mint-status indication is ABOVE this block,
    // so the block itself must remain present and ordered first.
    const gameNumber = screen.getByText("Game #7");
    const nftSent = screen.getByText("NFT sent");
    expect(body?.contains(gameNumber)).toBe(true);
    expect(body?.contains(nftSent)).toBe(true);

    // The Game # block precedes the result banner and every summary section.
    const resultBanner = screen.getByText("White Wins");
    expect(
      gameNumber.compareDocumentPosition(resultBanner) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      nftSent.compareDocumentPosition(resultBanner) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("still keys the NFT-sent block off currentWalletAddress", () => {
    renderModal({ currentWalletAddress: "aaaaa-aa" });
    expect(screen.getByText("NFT sent")).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "NFT sent" }),
    ).not.toBeInTheDocument();

    cleanup();
    renderModal({ currentWalletAddress: "" });
    const img = screen.getByRole("img", { name: "NFT sent" });
    expect(img).toHaveAttribute(
      "src",
      "/assets/generated/knight-favicon.dim_64x64.png",
    );
    expect(screen.queryByText("NFT sent")).not.toBeInTheDocument();
  });

  it("still renders the result banner and every summary section from the record", () => {
    renderModal();

    expect(screen.getByText("White Wins")).toBeInTheDocument();
    expect(screen.getByText("Final Move")).toBeInTheDocument();
    expect(screen.getByText("Most Checks")).toBeInTheDocument();
    expect(
      screen.getByText("Highest Piece-Points Captured"),
    ).toBeInTheDocument();
    expect(screen.getByText("castling move")).toBeInTheDocument();
    expect(screen.getByText("En Passant Captures")).toBeInTheDocument();
    expect(screen.getByText("Promotions")).toBeInTheDocument();
    expect(screen.getByText("Players at Conclusion")).toBeInTheDocument();
    expect(screen.getByText("Team Rosters")).toBeInTheDocument();
  });

  it("still wires the footer New game and Log out actions", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
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
 * Frontend consumer contract for the mint-status reads the new indication
 * will consume. The actor is a typed local mock; the backend's retention and
 * pruning are NOT exercised here.
 */
describe("mint-status read consumer contract", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("types the empty-state reads the modal will consume", async () => {
    // The generated wrapper exposes these two reads. On a fresh canister the
    // game-scoped read resolves to an empty list and the per-player read to
    // the absent optional (null in the wrapper's shape). This pins the
    // consumer-facing shape the new indication must handle.
    const getMintStatusesForGame = vi
      .fn<() => Promise<MintStatusEntry[]>>()
      .mockResolvedValue([]);
    const getMintStatusForPlayer = vi
      .fn<(walletAddress: string) => Promise<MintOutcome | null>>()
      .mockResolvedValue(null);

    await expect(getMintStatusesForGame()).resolves.toEqual([]);
    await expect(getMintStatusForPlayer("aaaaa-aa")).resolves.toBeNull();
    expect(getMintStatusForPlayer).toHaveBeenCalledWith("aaaaa-aa");
  });

  it("accepts the succeeded/skipped/failed outcome variants the UI renders", () => {
    // The three MintOutcome variants the modal's indication must be able to
    // render. This is a type-level contract: it fails to compile if the
    // generated union changes shape.
    const outcomes: MintOutcome[] = [
      { __kind__: "succeeded", succeeded: { tokenId: 1n } },
      { __kind__: "skipped", skipped: "no wallet address supplied" },
      { __kind__: "failed", failed: "mint canister call trapped" },
    ];
    expect(outcomes.map((o) => o.__kind__)).toEqual([
      "succeeded",
      "skipped",
      "failed",
    ]);

    // A MintStatusEntry carries the player identity plus the optional
    // outcome; the wallet address is optional (players with no wallet).
    const entry: MintStatusEntry = {
      username: "Ada",
      team: Team.White,
      walletAddress: "aaaaa-aa",
      outcome: outcomes[0],
    };
    expect(entry.username).toBe("Ada");
    expect(entry.outcome?.__kind__).toBe("succeeded");

    const walletless: MintStatusEntry = {
      username: "Grace",
      team: Team.Black,
    };
    expect(walletless.walletAddress).toBeUndefined();
    expect(walletless.outcome).toBeUndefined();
  });
});
