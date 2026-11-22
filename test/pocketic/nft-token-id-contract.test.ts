import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the accepted mint_auto token-id contract, read
 * through the real canister's public `getApiDoc()` query.
 *
 * The request repoints the capped per-player game-end mint tier from a
 * sequential per-player `mint_auto` loop to the collection canister's batched
 * `mint_auto_batch` entrypoint: two index-aligned vecs (recipient accounts and
 * per-recipient metadata vecs) are passed in chunks of at most 50, the
 * canister assigns each id internally, and each returned `#Ok(tokenId)` is
 * mapped back to its player by index and used to update the local NftRecord.
 * The additive guaranteed tier and the fixed-recipient mint still use the
 * single `mint_auto` entrypoint. All token-id computation, the
 * `icrc7_total_supply` query on the mint path, and the retry loop are removed.
 * The `api-doc.mo` mixin is a changed file that publishes that contract to API
 * consumers, so this file pins the published text against the accepted
 * behavior.
 *
 * The per-mint floor-safety check (`isMintAutoSafe` / `highestRecordedTokenId`
 * / `mintAutoCounterStart`) and the `getMintAutoSafety` public query have been
 * removed, so this file no longer asserts them. The published doc must state
 * that there is no per-mint safety gate.
 *
 * What the replica CAN observe: `getApiDoc()` resolves to the published
 * documentation string, and that string states the accepted mint_auto
 * assignment, the absence of supply-derived ids and the retry loop, and the
 * absence of a per-mint safety gate.
 *
 * What the replica CANNOT observe: the mint path itself. The game-end mint
 * calls the external ICRC-7 collection canister
 * (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica, and
 * there is no public method to conclude a game or seed the local NFT store.
 * The mint_auto call and the returned-id recording are therefore NOT exercised
 * here. See episode.coverageLimits.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

let pic: PocketIc | undefined;
let actor: _SERVICE;

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
  ({ actor } = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  }));
});

afterAll(async () => {
  await pic?.tearDown();
});

it("publishes the mint_auto token-id assignment contract through getApiDoc", async () => {
  const doc = await actor.getApiDoc();

  // The capped tier calls the batched mint_auto_batch entrypoint with two
  // index-aligned vecs; the additive tiers still use the single mint_auto
  // entrypoint. Neither takes a token id.
  expect(doc).toContain("Token id assignment");
  expect(doc).toContain("batched `mint_auto_batch` entrypoint");
  expect(doc).toContain("two index-aligned vecs");
  expect(doc).toContain("chunks of at most 50 recipients per call");
  expect(doc).toContain("still use the single `mint_auto` entrypoint");
  expect(doc).toContain("Neither entrypoint takes a token id");

  // The canister assigns the id internally from a monotonic counter starting
  // at 200 that is never affected by burns.
  expect(doc).toContain("assigns each token id internally");
  expect(doc).toContain("monotonic counter that starts at **200**");
  expect(doc).toContain("never affected by burns");

  // The removed behavior is explicitly documented as absent: no token-id
  // computation, no supply-derived candidate id, no icrc7_total_supply query
  // on the mint path, and no collision retry loop.
  expect(doc).toContain("no token-id computation");
  expect(doc).toContain("no supply-derived candidate id");
  expect(doc).toContain("no `icrc7_total_supply` query on the mint path");
  expect(doc).toContain("no collision retry loop");

  // The returned #Ok(tokenId) is the assigned id and updates the NftRecord.
  expect(doc).toContain("The returned `#Ok(tokenId)` is the assigned id");
  expect(doc).toContain("used to update the local NftRecord");

  // The per-mint safety gate is removed: the published doc states there is no
  // per-mint safety gate, and no longer describes the removed refusal.
  expect(doc).toContain("there is no per-mint");
  expect(doc).toContain("safety gate");
  expect(doc).not.toContain("highest token id ever recorded in the local");
  expect(doc).not.toContain("at or above 200 the mint is reported as");
});

it("no longer describes supply-derived ids or the 16-attempt retry", async () => {
  const doc = await actor.getApiDoc();

  // The old contract must be gone: no bounded 16-attempt retry, no
  // collision-exhaustion failure reason, no "derived from the collection
  // canister's" requested-id derivation.
  expect(doc).not.toContain("bounded limit of 16 attempts");
  expect(doc).not.toContain("token id already exists after 16 attempts");
  expect(doc).not.toContain("succeeds after one or more collision retries");
  expect(doc).not.toContain("derived from the collection canister's");
});

it("no longer exposes the removed getMintAutoSafety query", async () => {
  // The accepted requirement removes the getMintAutoSafety public query from
  // the actor surface. The generated declarations no longer type it, so this
  // asserts the runtime surface does not carry it either.
  expect(
    (actor as unknown as Record<string, unknown>).getMintAutoSafety,
  ).toBeUndefined();
});
