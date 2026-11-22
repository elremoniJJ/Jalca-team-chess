import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the accepted ranked-binding / retried-ranked-login
 * change.
 *
 * The accepted behavior:
 *   1. A ranked (Internet Identity) player's binding is present at game
 *      conclusion so `recordWins` and `recordCompWins` credit the win, and the
 *      Sunday win is recorded in the same message execution as the All-time
 *      win, before any await, so a concurrent stale-player cleanup cannot
 *      remove the ranked binding in between.
 *   2. A retried ranked login reuses the same minted ranked key already in the
 *      ranked slot instead of minting a fresh one, so no second roster entry is
 *      created under a new key.
 *   3. `getWinCreditPreview` reports `isBound` true for a ranked player who has
 *      just logged in, and `competitionLive` is a boolean.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose methods are unimplemented stubs. This file installs the app's own
 * compiled wasm into the platform's PocketIC replica and drives the real public
 * API through the generated declarations (no mock).
 *
 * What the replica CAN observe:
 *   - A ranked login binds the key; `getWinCreditPreview` reports the player
 *     `isBound` true with a fresh ping, and `competitionLive` is a boolean.
 *   - A retried ranked login with the SAME key does not create a second roster
 *     entry: the preview still lists exactly one player for that key.
 *   - A guest login is unaffected: the guest is on the roster with `isBound`
 *     false.
 *
 * What the replica CANNOT observe: the exact interleaving of a concurrent
 * logout/maintenance prune during the `loginInternal` await (PocketIC runs
 * messages serially), and a real Sunday win (the replica starts at real
 * wall-clock time and advancing to a Sunday window is impractical). See
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

/** Install a fresh canister and return its actor plus canister id. */
async function install(): Promise<{
  actor: _SERVICE;
  canisterId: Parameters<PocketIc["createActor"]>[1];
}> {
  if (pic === undefined) throw new Error("PocketIC not initialized");
  const { actor, canisterId } = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  });
  return { actor, canisterId };
}

it("reports a ranked player as bound with a fresh ping after login", async () => {
  const { actor } = await install();
  const alice = createIdentity("retry-cover-alice");

  actor.setIdentity(alice);
  await actor.loginRanked("retry-cover-key-1", "Ada", [], { none: null });

  const preview = await actor.getWinCreditPreview();
  const ada = preview.players.find((p) => p.username === "Ada");
  expect(ada).toBeDefined();
  // The ranked player's key has a binding and a fresh ping.
  expect(ada?.isBound).toBe(true);
  expect(ada?.pingFresh).toBe(true);
  // The competition-live flag is a boolean.
  expect(typeof preview.competitionLive).toBe("boolean");
});

it("does not create a second roster entry when a ranked login is retried with the same key", async () => {
  const { actor } = await install();
  const alice = createIdentity("retry-cover-alice");

  // The first ranked login binds the key and puts the player on the roster.
  actor.setIdentity(alice);
  await actor.loginRanked("retry-cover-key-1", "Ada", [], { none: null });

  const afterFirst = await actor.getWinCreditPreview();
  expect(afterFirst.players).toHaveLength(1);

  // A retry with the SAME key (the accepted reuse behavior) must not create a
  // second roster entry under a new key: the roster still holds exactly one
  // player, and that player is still bound.
  await actor.loginRanked("retry-cover-key-1", "Ada", [], { none: null });

  const afterRetry = await actor.getWinCreditPreview();
  expect(afterRetry.players).toHaveLength(1);
  expect(afterRetry.players[0]?.isBound).toBe(true);
});

it("leaves a guest login unaffected: the guest is on the roster unbound", async () => {
  const { actor } = await install();

  // A guest login puts the player on the roster with no binding.
  await actor.login("retry-cover-guest-1", "Guest", [], { none: null });

  const preview = await actor.getWinCreditPreview();
  const guest = preview.players.find((p) => p.username === "Guest");
  expect(guest).toBeDefined();
  expect(guest?.isBound).toBe(false);
  expect(guest?.pingFresh).toBe(true);
});
