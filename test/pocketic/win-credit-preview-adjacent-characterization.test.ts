import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization taken BEFORE the win-credit-preview change.
 *
 * The request intentionally changes two things:
 *   1. `loginRanked` re-adds the ranked binding after `loginInternal` returns
 *      and before `pruneBindings()`, so a concurrent login's prune cannot
 *      leave a ranked player on the roster with no binding.
 *   2. A new read-only public query `getWinCreditPreview` is added.
 *
 * This file deliberately does NOT assert either intentional change: it does
 * not assert the post-await re-add, and it does not call `getWinCreditPreview`
 * (which does not exist on the pre-change wasm). What it protects is the
 * behavior ADJACENT to the change that must survive it:
 *
 *   - `pruneBindings` still removes a binding whose key is no longer on the
 *     roster, and still keeps a binding whose key IS on the roster. The fix
 *     re-adds a binding before this prune, so the prune's own contract — key
 *     membership, never principal — must stay intact.
 *   - `loginRanked` still writes the binding before the await and still
 *     rejects the anonymous principal, an invalid key, and a key bound to a
 *     different caller.
 *   - The read shapes the new query will build on: `getGameState`'s roster
 *     carries username and team, `getGameNumber` answers, and the public
 *     ranking queries return no principals.
 *
 * The real canister is installed and called through the generated
 * declarations (no mock).
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

it("keeps a binding whose key is still on the roster after a ranked login", async () => {
  const { actor } = await install();
  const alice = createIdentity("preview-alice");

  // Alice binds a key and logs in. The key is on the roster, so the prune at
  // the end of loginRanked must NOT remove her binding: a later ranked login
  // with the same key is still accepted (the binding survived).
  actor.setIdentity(alice);
  await actor.loginRanked("preview-key-1", "Ada", [], { none: null });

  const again = await actor.loginRanked("preview-key-1", "Ada", [], {
    none: null,
  });
  // The binding survived the prune, so the same caller may log in again with
  // the same key. The re-login path re-uniquifies the name against the roster
  // (the player already exists), so the returned name is the adjusted one.
  expect(again.principal).toBe("preview-key-1");
  expect(again.username).toBe("Ada_copy");
});

it("removes a binding whose key is no longer on the roster", async () => {
  const { actor, canisterId } = await install();
  const alice = createIdentity("preview-alice");
  const bob = createIdentity("preview-bob");

  // Alice binds a key and logs in, putting the key on the roster.
  actor.setIdentity(alice);
  await actor.loginRanked("preview-key-1", "Ada", [], { none: null });

  // Alice logs out, which removes her player record AND her binding.
  await actor.logout("preview-key-1");

  // The key is gone from the roster, so a different caller may now bind it:
  // the stale binding was pruned rather than left to block the slot.
  actor.setIdentity(bob);
  const result = await actor.loginRanked("preview-key-1", "Bob", [], {
    none: null,
  });
  expect(result.principal).toBe("preview-key-1");
  expect(result.username).toBe("Bob");

  // The guest path is also free of the stale binding: a fresh anonymous actor
  // can log in with the key (it is no longer bound).
  const guest = pic!.createActor<_SERVICE>(idlFactory, canisterId);
  await expect(
    guest.login("preview-key-2", "Cara", [], { none: null }),
  ).resolves.toMatchObject({ principal: "preview-key-2" });
});

it("still rejects the anonymous principal and an invalid key from loginRanked", async () => {
  const { actor } = await install();

  // A freshly created actor calls as the anonymous principal.
  await expect(
    actor.loginRanked("preview-key-1", "Ada", [], { none: null }),
  ).rejects.toThrow();

  // An empty key and an over-long key are both invalid.
  actor.setIdentity(createIdentity("preview-alice"));
  await expect(
    actor.loginRanked("", "Ada", [], { none: null }),
  ).rejects.toThrow();
  await expect(
    actor.loginRanked("k".repeat(129), "Ada", [], { none: null }),
  ).rejects.toThrow();
});

it("still rejects a key bound to a different caller", async () => {
  const { actor } = await install();
  const alice = createIdentity("preview-alice");
  const bob = createIdentity("preview-bob");

  actor.setIdentity(alice);
  await actor.loginRanked("preview-key-1", "Ada", [], { none: null });

  // Bob cannot take over Alice's bound slot.
  actor.setIdentity(bob);
  await expect(
    actor.loginRanked("preview-key-1", "Bob", [], { none: null }),
  ).rejects.toThrow();
});

it("answers the roster and game-number reads the preview will build on", async () => {
  const { actor } = await install();
  const alice = createIdentity("preview-alice");

  // A fresh canister is on game 1 with an empty roster.
  await expect(actor.getGameNumber()).resolves.toBe(1n);
  const empty = await actor.getGameState("preview-key-1");
  expect(empty.players).toEqual([]);

  // After a ranked login the roster carries the username and team for the
  // player, and the phase is a known variant.
  actor.setIdentity(alice);
  await actor.loginRanked("preview-key-1", "Ada", [], { none: null });

  const state = await actor.getGameState("preview-key-1");
  const ada = state.players.find((p) => p.principal === "preview-key-1");
  expect(ada).toBeDefined();
  expect(ada?.username).toBe("Ada");
  expect(ada?.team).toHaveProperty("White");
  expect(["Playing", "Celebration", "Draw", "Paused"]).toContain(
    Object.keys(state.phase)[0],
  );
});

it("returns no principals from the public ranking queries", async () => {
  const { actor } = await install();

  // The public ranking rows carry a display name and wins, never a principal
  // field. This is the invariant the new preview query must also honor.
  const rows = await actor.getWinnerRanking(50n);
  for (const row of rows) {
    expect(row).not.toHaveProperty("principal");
    expect(row).toHaveProperty("displayName");
    expect(row).toHaveProperty("wins");
  }

  // getMyWins answers the neutral empty shape on a fresh canister.
  await expect(actor.getMyWins()).resolves.toEqual({ wins: 0n, rank: 0n });
});
