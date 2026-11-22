import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the wallet NFT grid's refresh journey, taken BEFORE the
 * batched-metadata change.
 *
 * The request changes HOW the wallet grid loads metadata: instead of one
 * backend request per token id, it will use a single batched backend call.
 * That call shape is intentionally changing, so it is NOT asserted here.
 *
 * What IS protected — the critical journey the batched call feeds:
 *   - connecting loads the owned list through the backend-routed read and
 *     populates the grid;
 *   - refresh() re-reads the owned list through the same backend-routed read
 *     and repopulates the grid with the newer response;
 *   - a failed refresh surfaces the read error without dropping the
 *     connection.
 *
 * The backend actor and the oisy-signer module are mocked with typed local
 * mocks (the real @caffeineai/core-infrastructure package does not resolve its
 * submodules in jsdom, and the signer would open a real popup).
 */

const { getNftsForOwner, getNftMetadata, getNftMetadataBatch } = vi.hoisted(
  () => ({
    getNftsForOwner: vi.fn(),
    getNftMetadata: vi.fn(),
    getNftMetadataBatch: vi.fn(),
  }),
);

// A static spell table used to resolve a spell's burn category from its name.
const { spellTable } = vi.hoisted(() => ({
  spellTable: {
    block: {
      id: 1n,
      complexity: { Moderate: null },
      nftEligible: true,
      meaning: "Defensive shield",
      name: "Subao Ve",
      spell: "block",
      category: { Block: null },
      dropChance: 1n,
    },
    minor: [
      {
        id: 2n,
        complexity: { Easy: null },
        nftEligible: true,
        meaning: "Attacking",
        name: "Minor Spell",
        spell: "minor",
        category: { Minor: null },
        dropChance: 1n,
      },
    ],
    major: [
      {
        id: 3n,
        complexity: { Complex: null },
        nftEligible: true,
        meaning: "Attacking",
        name: "Major Spell",
        spell: "major",
        category: { Major: null },
        dropChance: 1n,
      },
    ],
  },
}));

vi.mock("@/lib/backend-actor", () => ({
  getActor: vi.fn().mockResolvedValue({
    getNftsForOwner,
    getNftMetadata,
    getNftMetadataBatch,
    getSpellTable: vi.fn().mockResolvedValue(spellTable),
  }),
  useActorState: () => ({
    actor: { getSpellTable: vi.fn().mockResolvedValue(spellTable) },
    isLoading: false,
    error: null,
  }),
}));

// OisyBurnPanel imports enum values from @/backend at runtime; mock the module
// so the fixture can use them without pulling in the unresolvable dependency
// chain.
vi.mock("@/backend", () => ({
  GameResult__1: { Draw: "Draw", BlackWin: "BlackWin", WhiteWin: "WhiteWin" },
  EndState: {
    Draw: "Draw",
    Checkmate: "Checkmate",
    Timeout: "Timeout",
    Stalemate: "Stalemate",
  },
  RecipientRole: { Winner: "Winner", Drawer: "Drawer" },
  Team: { Black: "Black", White: "White" },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
  BurnedSpellCategory: { Major: "Major", Minor: "Minor", SubaoVe: "SubaoVe" },
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
}));

// The hook's connect() flow depends on the oisy-signer module: it opens the
// signer synchronously, fetches the Oisy account, and loads owned NFTs. Mock
// the whole module so the test drives the connect/refresh path
// deterministically without opening a real popup or hitting the network.
const {
  openOisySignerSync,
  openBurnSignerSync,
  getOisyAccounts,
  fetchOwnedNfts,
  isSignerAvailable,
  preloadSigner,
  approveCollectionOnce,
  isCollectionApproved,
  resetCollectionApproval,
  clearApprovedBurnSession,
  resumeApprovedSession,
} = vi.hoisted(() => ({
  openOisySignerSync: vi.fn(),
  openBurnSignerSync: vi.fn(),
  getOisyAccounts: vi.fn(),
  fetchOwnedNfts: vi.fn(),
  isSignerAvailable: vi.fn(),
  preloadSigner: vi.fn(),
  approveCollectionOnce: vi.fn(),
  isCollectionApproved: vi.fn(),
  resetCollectionApproval: vi.fn(),
  clearApprovedBurnSession: vi.fn(),
  resumeApprovedSession: vi.fn(),
}));
vi.mock("@/oisy-burn/oisy-signer", () => ({
  openOisySignerSync,
  openBurnSignerSync,
  getOisyAccounts,
  fetchOwnedNfts,
  isSignerAvailable,
  preloadSigner,
  approveCollectionOnce,
  isCollectionApproved,
  resetCollectionApproval,
  clearApprovedBurnSession,
  resumeApprovedSession,
}));

// The mount effect dynamically imports @icp-sdk/signer to probe availability.
vi.mock("@icp-sdk/signer", () => ({ __esModule: true, default: {} }));

// The hook consumes useGameState (Move_Maker principal + move list) and
// useBurnState (one-burn-per-turn flag). Mock them so the burn-restriction
// state is deterministic; this file does not exercise those rules.
vi.mock("@/hooks/use-game-state", () => ({
  useGameState: () => ({
    data: { moveMaker: "player-1", turn: "White" },
    isLoading: false,
    error: null,
    moves: [],
    lastMove: null,
    prevBoard: null,
    checkSquare: null,
  }),
}));
vi.mock("@/hooks/use-burn-state", () => ({
  useBurnState: () => ({
    data: { burnOccurredThisTurn: false },
    isLoading: false,
    error: null,
  }),
}));

import { EndState, GameResult__1, RecipientRole, Team } from "@/backend";
import type { OisyNft } from "@/oisy-burn/types";
import { useOisyBurn } from "@/oisy-burn/use-oisy-burn";

function makeNft(overrides: Partial<OisyNft> = {}): OisyNft {
  return {
    id: 1n,
    name: "JALCA Game NFT #1",
    thumbnailUrl: null,
    gameNumber: 7n,
    gameResult: GameResult__1.WhiteWin,
    endState: EndState.Checkmate,
    moveCount: 42n,
    recipientRole: RecipientRole.Winner,
    recipientTeam: Team.White,
    recipientUsername: "Ada",
    recipientWalletAddress: "wallet-abc",
    concludedAt: 1_000_000_000n,
    spellName: "Minor Spell",
    ...overrides,
  };
}

function RefreshHarness({ principal }: { principal: string }) {
  const oisy = useOisyBurn(principal, true);
  return (
    <div>
      <button type="button" onClick={() => void oisy.connect()}>
        connect
      </button>
      <button type="button" onClick={() => void oisy.refresh()}>
        refresh
      </button>
      <span data-testid="status">{oisy.connection.status}</span>
      <span data-testid="nft-count">{oisy.nfts.length}</span>
      <span data-testid="nfts-error">{oisy.nftsError ?? ""}</span>
    </div>
  );
}

function renderRefreshHarness(principal: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RefreshHarness principal={principal} />
    </QueryClientProvider>,
  );
}

describe("useOisyBurn refresh journey", () => {
  beforeEach(() => {
    openOisySignerSync.mockReset();
    getOisyAccounts.mockReset();
    fetchOwnedNfts.mockReset();
    isSignerAvailable.mockReturnValue(true);
    preloadSigner.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("re-reads the owned list through the backend and repopulates the grid on refresh", async () => {
    const user = userEvent.setup();
    openOisySignerSync.mockReturnValue({} as never);
    getOisyAccounts.mockResolvedValue({
      owner: "owner-principal-abc",
      subaccount: null,
    });
    // First read: one NFT. The refresh read returns two, so the grid must
    // reflect the newer backend response.
    fetchOwnedNfts
      .mockResolvedValueOnce([makeNft({ id: 1n })])
      .mockResolvedValueOnce([
        makeNft({ id: 1n }),
        makeNft({ id: 2n, name: "JALCA Game NFT #2" }),
      ]);
    renderRefreshHarness("player-1");

    await user.click(screen.getByRole("button", { name: "connect" }));
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("connected");
    });
    expect(screen.getByTestId("nft-count")).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: "refresh" }));

    await waitFor(() => {
      expect(screen.getByTestId("nft-count")).toHaveTextContent("2");
    });
    // The refresh re-reads for the connected account through the same
    // backend-routed read path.
    expect(fetchOwnedNfts).toHaveBeenCalledTimes(2);
    expect(fetchOwnedNfts).toHaveBeenLastCalledWith({
      owner: "owner-principal-abc",
      subaccount: null,
    });
  });

  it("surfaces a read error on refresh without dropping the connection", async () => {
    const user = userEvent.setup();
    openOisySignerSync.mockReturnValue({} as never);
    getOisyAccounts.mockResolvedValue({
      owner: "owner-principal-abc",
      subaccount: null,
    });
    fetchOwnedNfts
      .mockResolvedValueOnce([makeNft({ id: 1n })])
      .mockRejectedValueOnce(new Error("backend down"));
    renderRefreshHarness("player-1");

    await user.click(screen.getByRole("button", { name: "connect" }));
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("connected");
    });

    await user.click(screen.getByRole("button", { name: "refresh" }));

    await waitFor(() => {
      expect(screen.getByTestId("nfts-error")).toHaveTextContent(
        "Couldn't load your NFTs",
      );
    });
    // The connection survives a failed read.
    expect(screen.getByTestId("status")).toHaveTextContent("connected");
  });
});
