import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the accepted game-conclusion mint changes:
 *
 *   1. the unconditional mint to the fixed principal
 *      g2pdm-hmunr-5miqy-43zdt-fxmqu-yrqli-kqsjh-pusdw-gctym-kzi5w-4qe is
 *      removed;
 *   2. the game number stamped on the end-of-game NFT is the game just played
 *      (N), not the incremented next game number (N+1).
 *
 * What the replica CAN observe:
 *   - `getGameNumber()` on a fresh canister is 1 (the first game), so the
 *     number the conclusion path captures before incrementing is the game just
 *     played.
 *   - `mintGameNfts()` answers a fresh canister without trapping (the recorder
 *     has not concluded, so it is a no-op) and records no mint attempt.
 *   - `getMintAttemptsByGame()` stays empty after that no-op call.
 *
 * What the replica CANNOT observe: the mint path itself. The game-end mint
 * calls the external ICRC-7 collection canister
 * (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica, and
 * there is no public method to conclude a game or seed the local NFT store.
 * The fixed-recipient removal and the N-vs-N+1 stamp are therefore NOT
 * exercised at runtime here; they are pinned by the frontend source-contract
 * tests. See episode.coverageLimits.
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

it("reports the first game as game number 1 on a fresh canister", async () => {
  const actor = await freshActor();

  // The conclusion path captures this number BEFORE incrementing, so the NFT
  // minted at the end of the first game is stamped 1, not 2.
  await expect(actor.getGameNumber()).resolves.toBe(1n);
});

it("answers the game-end mint entry point without trapping and records no attempt", async () => {
  const actor = await freshActor();

  // The recorder has not concluded a game, so mintGameNfts is a no-op. It must
  // resolve rather than trap, and no mint attempt may be recorded.
  await expect(actor.mintGameNfts()).resolves.toBeNull();
  await expect(actor.getMintAttemptsByGame()).resolves.toEqual([]);
  await expect(actor.getMintStatusesForGame()).resolves.toEqual([]);
});
