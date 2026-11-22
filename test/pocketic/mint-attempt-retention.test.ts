import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the retained mint-attempt reads the game conclusion
 * modal consumes.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `getMintAttemptsByGame` is an unimplemented stub. This file calls the
 * real public methods on a freshly installed canister, so a stubbed backend
 * traps here instead of passing.
 *
 * What the replica CAN observe:
 *   - `getMintAttemptsByGame()` resolves to an empty list on a fresh canister
 *     (no attempts recorded yet) rather than trapping.
 *   - `getMintStatusesForGame()` resolves to an empty list and
 *     `getMintStatusForPlayer(wallet)` resolves to the absent optional.
 *   - `clearNftMintAttempts()` resolves without trapping and leaves the read
 *     empty.
 *   - `mintGameNfts()` answers a fresh canister without trapping (the recorder
 *     has not concluded, so it is a no-op) and records no attempt.
 *
 * What the replica CANNOT observe: the retention/pruning behavior itself
 * (retain across games, cap at the 10 most recent distinct game numbers). The
 * only public path that records a mint attempt is game conclusion, and the
 * game-end mint path calls the external ICRC-7 collection canister
 * (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica — so the
 * mint maps to `#failed` before any attempt is recorded, and there is no public
 * method to conclude a game or seed attempts directly. The 10-game cap and the
 * cross-game retention are therefore NOT exercised here. See
 * episode.coverageLimits.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

let pic: PocketIc | undefined;

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
});

afterAll(async () => {
  await pic?.tearDown();
});

/** Install a fresh canister and return its actor. */
async function freshActor(): Promise<_SERVICE> {
  if (pic === undefined) throw new Error("PocketIC not initialized");
  const { actor } = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  });
  return actor;
}

it("answers the grouped mint-attempt read with an empty list on a fresh canister", async () => {
  const actor = await freshActor();

  // No game has concluded, so no attempt has been recorded. The read must
  // resolve to an empty list rather than trapping on uninitialized state.
  await expect(actor.getMintAttemptsByGame()).resolves.toEqual([]);
});

it("answers the per-game and per-player mint-status reads on a fresh canister", async () => {
  const actor = await freshActor();

  await expect(actor.getMintStatusesForGame()).resolves.toEqual([]);
  // Candid maps ?T to [] | [T]; an absent optional is the empty array.
  await expect(actor.getMintStatusForPlayer("aaaaa-aa")).resolves.toEqual([]);
});

it("clears the retained mint-attempt log without trapping", async () => {
  const actor = await freshActor();

  // clearNftMintAttempts returns unit; PocketIC decodes a zero-value reply to
  // null, so await the call and assert on the later read rather than on the
  // return value.
  await actor.clearNftMintAttempts();
  await expect(actor.getMintAttemptsByGame()).resolves.toEqual([]);
  await expect(actor.getMintStatusesForGame()).resolves.toEqual([]);
});

it("answers the game-end mint entry point on a fresh canister without trapping", async () => {
  const actor = await freshActor();

  // The recorder has not concluded a game, so mintGameNfts is a no-op. It must
  // resolve rather than trap, and no mint attempt may be recorded.
  await expect(actor.mintGameNfts()).resolves.toBeNull();
  await expect(actor.getMintAttemptsByGame()).resolves.toEqual([]);
});
