import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the owned-NFT read path, taken BEFORE the
 * batched-metadata change.
 *
 * The request changes HOW the wallet grid loads metadata: instead of one
 * backend request per token id, it will use a single batched backend call.
 * That call shape is intentionally changing, so it is NOT asserted here.
 *
 * What IS protected — the observable result the batched rewrite must keep:
 *   - fetchOwnedNfts keeps the per-token display name and null thumbnail
 *     while mapping every backend metadata field onto the OisyNft;
 *   - the read routes through the backend actor, never the signer.
 *
 * The backend actor is mocked with a typed local mock (the real
 * @caffeineai/core-infrastructure package does not resolve its submodules in
 * jsdom). The mock exposes BOTH the current per-token read and a batched read
 * so this file keeps passing whichever call shape the implementation uses.
 */

const { getNftsForOwner, getNftMetadata, getNftMetadataBatch } = vi.hoisted(
  () => ({
    getNftsForOwner: vi.fn(),
    getNftMetadata: vi.fn(),
    getNftMetadataBatch: vi.fn(),
  }),
);

vi.mock("@/lib/backend-actor", () => ({
  getActor: vi.fn().mockResolvedValue({
    getNftsForOwner,
    getNftMetadata,
    getNftMetadataBatch,
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
}));

import { EndState, GameResult__1, RecipientRole, Team } from "@/backend";
import { fetchOwnedNfts } from "@/oisy-burn/oisy-signer";

/** A backend MintMetadata-shaped record for one token. */
function backendMetadata(id: bigint) {
  return {
    gameNumber: id * 10n,
    gameResult: GameResult__1.WhiteWin,
    endState: EndState.Checkmate,
    moveCount: 42n,
    recipientRole: RecipientRole.Winner,
    recipientTeam: Team.White,
    recipientUsername: `Player ${id}`,
    recipientWalletAddress: `wallet-${id}`,
    concludedAt: 1_000_000_000n,
    spellName: `Spell ${id}`,
    spellId: id,
    finalBoardState: [],
  };
}

/**
 * Configure the mocked actor so BOTH read shapes resolve consistently: the
 * per-token getNftMetadata and a batched getNftMetadataBatch. The
 * implementation under test may use either; the observable result must match.
 */
function mockMetadataFor(failing: bigint[] = []) {
  getNftMetadata.mockImplementation(async (id: bigint) => {
    if (failing.includes(id)) throw new Error("metadata unavailable");
    return backendMetadata(id);
  });
  getNftMetadataBatch.mockImplementation(async (requested: bigint[]) => {
    return requested.map((id) =>
      failing.includes(id) ? null : backendMetadata(id),
    );
  });
}

describe("fetchOwnedNfts display contract", () => {
  beforeEach(() => {
    getNftsForOwner.mockReset();
    getNftMetadata.mockReset();
    getNftMetadataBatch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the per-token display name and null thumbnail while mapping metadata", async () => {
    getNftsForOwner.mockResolvedValue([1n]);
    mockMetadataFor();

    const nfts = await fetchOwnedNfts({ owner: "aaaaa-aa", subaccount: null });

    expect(nfts).toHaveLength(1);
    // The display name is derived from the token id, and no thumbnail is
    // available — both are part of the grid's rendering contract.
    expect(nfts[0].name).toBe("JALCA Game NFT #1");
    expect(nfts[0].thumbnailUrl).toBeNull();
    // Every backend metadata field is mapped onto the OisyNft.
    expect(nfts[0]).toMatchObject({
      id: 1n,
      gameNumber: 10n,
      spellName: "Spell 1",
      gameResult: GameResult__1.WhiteWin,
      endState: EndState.Checkmate,
      moveCount: 42n,
      recipientRole: RecipientRole.Winner,
      recipientTeam: Team.White,
      recipientUsername: "Player 1",
      recipientWalletAddress: "wallet-1",
      concludedAt: 1_000_000_000n,
    });
  });

  it("keeps the display name and null metadata fields for a token whose metadata read fails", async () => {
    getNftsForOwner.mockResolvedValue([1n]);
    mockMetadataFor([1n]);

    const nfts = await fetchOwnedNfts({ owner: "aaaaa-aa", subaccount: null });

    expect(nfts).toHaveLength(1);
    expect(nfts[0].name).toBe("JALCA Game NFT #1");
    expect(nfts[0].thumbnailUrl).toBeNull();
    expect(nfts[0].spellName).toBeNull();
    expect(nfts[0].gameNumber).toBeNull();
  });
});
