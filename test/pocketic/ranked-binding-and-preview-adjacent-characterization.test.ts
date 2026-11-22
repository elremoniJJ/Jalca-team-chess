import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization taken BEFORE the ranked-binding / retried-ranked-login
 * change.
 *
 * The request intentionally changes two things:
 *   1. the Sunday competition win is recorded in the same message execution as
 *      the All-time win, before any await, so a concurrent stale-player cleanup
 *      cannot remove the ranked binding in between;
 *   2. a retried ranked login reuses the ranked key already in the ranked slot
 *      instead of minting a fresh one.
 *
 * This file deliberately does NOT assert either intentional change. What it
 * protects is the behavior ADJACENT to the change that must survive it:
 *
 *   - `getWinCreditPreview` still reports `isBound` true for a ranked player
 *     who has just logged in, and `isBound` false for a guest, with a fresh
 *     ping for both;
 *   - `getWinCreditPreview` still reports `competitionLive` as a boolean and
 *     still carries no roster key and no principal;
 *   - `loginRanked` still rejects the anonymous principal, an invalid key, and
 *     a key bound to a different caller, and still accepts the same caller
 *     re-logging in with the same key (the binding survives the prune).
 *
 * The real canister is installed and called through the generated declarations
 * (no mock). The frontend suite mocks the actor, so it passes unchanged against
 * a canister whose methods are unimplemented stubs; this file is the only place
 * the real public API is exercised.
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

it("reports a ranked player as bound and a guest as unbound in the preview", async () => {
  const { actor } = await install();
  const alice = createIdentity("adjacent-preview-alice");

  // A ranked login binds the roster key to Alice's principal.
  actor.setIdentity(alice);
  await actor.loginRanked("adjacent-key-1", "Ada", [], { none: null });

  // A guest login puts a second player on the roster with no binding.
  await actor.login("adjacent-key-2", "Bob", [], { none: null });

  const preview = await actor.getWinCreditPreview();
  expect(preview.players).toHaveLength(2);

  const ada = preview.players.find((p) => p.username === "Ada");
  const bob = preview.players.find((p) => p.username === "Bob");
  expect(ada).toBeDefined();
  expect(bob).toBeDefined();

  // The ranked player's key has a binding; the guest's does not.
  expect(ada?.isBound).toBe(true);
  expect(bob?.isBound).toBe(false);

  // Both just logged in, so their pings are fresh.
  expect(ada?.pingFresh).toBe(true);
  expect(bob?.pingFresh).toBe(true);

  // The competition-live flag is a boolean and the response carries no
  // principal and no roster key.
  expect(typeof preview.competitionLive).toBe("boolean");
  expect(preview).not.toHaveProperty("principal");
  for (const row of preview.players) {
    expect(row).not.toHaveProperty("principal");
    expect(row).not.toHaveProperty("rosterKey");
  }
});

it("still rejects the anonymous principal and an invalid key from loginRanked", async () => {
  const { actor } = await install();

  // A freshly created actor calls as the anonymous principal.
  await expect(
    actor.loginRanked("adjacent-key-1", "Ada", [], { none: null }),
  ).rejects.toThrow();

  // An empty key and an over-long key are both invalid.
  actor.setIdentity(createIdentity("adjacent-preview-alice"));
  await expect(
    actor.loginRanked("", "Ada", [], { none: null }),
  ).rejects.toThrow();
  await expect(
    actor.loginRanked("k".repeat(129), "Ada", [], { none: null }),
  ).rejects.toThrow();
});

it("still rejects a key bound to a different caller", async () => {
  const { actor } = await install();
  const alice = createIdentity("adjacent-preview-alice");
  const bob = createIdentity("adjacent-preview-bob");

  actor.setIdentity(alice);
  await actor.loginRanked("adjacent-key-1", "Ada", [], { none: null });

  // Bob cannot take over Alice's bound slot.
  actor.setIdentity(bob);
  await expect(
    actor.loginRanked("adjacent-key-1", "Bob", [], { none: null }),
  ).rejects.toThrow();
});

it("keeps the binding through the prune so a later ranked login is accepted", async () => {
  const { actor } = await install();
  const alice = createIdentity("adjacent-preview-alice");

  // Alice binds a key and logs in. The key is on the roster, so the prune at
  // the end of loginRanked must NOT remove her binding: a later ranked login
  // with the same key is still accepted.
  actor.setIdentity(alice);
  await actor.loginRanked("adjacent-key-1", "Ada", [], { none: null });

  const again = await actor.loginRanked("adjacent-key-1", "Ada", [], {
    none: null,
  });
  expect(again.principal).toBe("adjacent-key-1");

  // The preview still reports the player as bound after the second login.
  const preview = await actor.getWinCreditPreview();
  const ada = preview.players.find((p) => p.username.startsWith("Ada"));
  expect(ada?.isBound).toBe(true);
});
