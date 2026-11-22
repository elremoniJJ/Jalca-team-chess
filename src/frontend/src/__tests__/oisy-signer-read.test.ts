import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// oisy-signer imports getActor from lib/backend-actor, which transitively
// pulls in @caffeineai/core-infrastructure. That package fails to resolve its
// own submodules in the jsdom test environment (a pre-existing dependency
// issue), so mock the actor accessor with a typed local mock. The read path
// under test is the backend-routed owned-token query — no signer popup.
const { getNftsForOwner, getNftMetadataBatch } = vi.hoisted(() => ({
  getNftsForOwner: vi.fn(),
  getNftMetadataBatch: vi.fn(),
}));
vi.mock("@/lib/backend-actor", () => ({
  getActor: vi.fn().mockResolvedValue({ getNftsForOwner, getNftMetadataBatch }),
}));

import { fetchOwnedNfts } from "@/oisy-burn/oisy-signer";

/**
 * Characterization of the owned-NFT read path.
 *
 * The request changes the burn flow (a one-time collection-level approval
 * instead of a per-burn popup). The read path must stay unchanged: listing a
 * connected account's NFTs is a backend query with NO signer popup, and it
 * must keep working so the burn grid can render.
 *
 * The metadata read is now a SINGLE batched backend call
 * (getNftMetadataBatch) instead of one getNftMetadata request per token. That
 * call shape is intentionally changing, so this file asserts the batched
 * shape while preserving the observable result:
 *   - fetchOwnedNfts routes through the backend's getNftsForOwner /
 *     getNftMetadataBatch (the single source of truth), never a signer;
 *   - token ids are returned sorted ascending for stable display;
 *   - a metadata read failure degrades to null fields rather than failing the
 *     whole list.
 */

/** A backend MintMetadata-shaped record for one token. */
function backendMetadata(id: bigint) {
  return {
    gameNumber: id * 10n,
    gameResult: null,
    endState: null,
    moveCount: null,
    recipientRole: null,
    recipientTeam: null,
    recipientUsername: null,
    recipientWalletAddress: null,
    concludedAt: null,
    spellName: `Spell ${id}`,
  };
}

describe("fetchOwnedNfts backend read path", () => {
  beforeEach(() => {
    getNftsForOwner.mockReset();
    getNftMetadataBatch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the owned tokens sorted ascending with their metadata", async () => {
    getNftsForOwner.mockResolvedValue([3n, 1n, 2n]);
    getNftMetadataBatch.mockImplementation(async (requested: bigint[]) =>
      requested.map((id) => backendMetadata(id)),
    );

    const nfts = await fetchOwnedNfts({ owner: "aaaaa-aa", subaccount: null });

    expect(getNftsForOwner).toHaveBeenCalledWith("aaaaa-aa");
    // One batched metadata read for the sorted ids, not one call per token.
    expect(getNftMetadataBatch).toHaveBeenCalledTimes(1);
    expect(getNftMetadataBatch).toHaveBeenCalledWith([1n, 2n, 3n]);
    expect(nfts.map((n) => n.id)).toEqual([1n, 2n, 3n]);
    expect(nfts[0].spellName).toBe("Spell 1");
    expect(nfts[0].gameNumber).toBe(10n);
  });

  it("degrades a failed metadata read to null fields instead of failing the list", async () => {
    getNftsForOwner.mockResolvedValue([1n, 2n]);
    // The batch response is positionally aligned with the requested ids: a
    // null entry degrades that token's fields without failing the list.
    getNftMetadataBatch.mockImplementation(async (requested: bigint[]) =>
      requested.map((id) => (id === 1n ? null : backendMetadata(id))),
    );

    const nfts = await fetchOwnedNfts({ owner: "aaaaa-aa", subaccount: null });

    expect(nfts).toHaveLength(2);
    // The failed token keeps its id but carries null metadata fields.
    expect(nfts[0].id).toBe(1n);
    expect(nfts[0].spellName).toBeNull();
    expect(nfts[0].gameNumber).toBeNull();
    // The successful token still carries its metadata.
    expect(nfts[1].spellName).toBe("Spell 2");
  });

  it("degrades the whole list to null fields when the batched call rejects", async () => {
    getNftsForOwner.mockResolvedValue([1n, 2n]);
    getNftMetadataBatch.mockRejectedValue(new Error("metadata unavailable"));

    const nfts = await fetchOwnedNfts({ owner: "aaaaa-aa", subaccount: null });

    expect(nfts).toHaveLength(2);
    expect(nfts.map((n) => n.id)).toEqual([1n, 2n]);
    expect(nfts[0].spellName).toBeNull();
    expect(nfts[1].spellName).toBeNull();
  });

  it("returns an empty list for an account with no owned tokens", async () => {
    getNftsForOwner.mockResolvedValue([]);

    const nfts = await fetchOwnedNfts({ owner: "aaaaa-aa", subaccount: null });

    expect(nfts).toEqual([]);
    expect(getNftMetadataBatch).not.toHaveBeenCalled();
  });
});
