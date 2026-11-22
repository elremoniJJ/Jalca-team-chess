import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the win-credit-preview change.
 *
 * The request intentionally changes two things:
 *   1. `loginRanked` re-adds the ranked binding after `loginInternal` returns
 *      and before `pruneBindings()`, so a concurrent login's prune cannot leave
 *      a ranked player on the roster with no binding. The pre-await binding
 *      write and every existing trap guard are unchanged.
 *   2. A new public query `getWinCreditPreview` reports, for every roster
 *      player, username, team, seconds since lastPing, pingFresh and isBound,
 *      plus the current phase, game number, whether the Sunday competition is
 *      live at the canister's clock, and the winner team during Celebration.
 *      It never returns a roster key or any principal.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose methods are unimplemented stubs. This file installs the app's own
 * compiled wasm into the platform's PocketIC replica and drives the real public
 * API through the generated declarations (no mock).
 *
 * What the replica CAN observe:
 *   - `getWinCreditPreview` answers on a fresh canister with an empty roster,
 *     game 1, a known phase, and no celebration winner.
 *   - After a ranked login the preview lists the player with username, team,
 *     a fresh ping, and isBound true; after a guest login isBound is false.
 *   - The preview response carries no roster key and no principal anywhere.
 *   - `loginRanked` still writes the binding before the await and still rejects
 *     the anonymous principal, an invalid key, and a key bound to a different
 *     caller (the trap guards are unchanged).
 *   - A ranked login leaves the binding in place so a later ranked login with
 *     the same key is still accepted (the post-await re-add keeps the binding
 *     through the prune).
 *
 * What the replica CANNOT observe: the exact interleaving of a concurrent
 * logout/maintenance prune during the `loginInternal` await (PocketIC runs
 * messages serially), and the Sunday-live boundary at a controlled clock. See
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

it("answers the preview empty on a fresh canister with no winner", async () => {
  const { actor } = await install();

  const preview = await actor.getWinCreditPreview();
  expect(preview.players).toEqual([]);
  expect(preview.gameNumber).toBe(1n);
  expect(["Playing", "Celebration", "Draw", "Paused"]).toContain(
    Object.keys(preview.phase)[0],
  );
  // No celebration is in progress, so there is no winner team.
  expect(preview.celebrationWinner).toEqual([]);
  expect(typeof preview.competitionLive).toBe("boolean");
});

it("reports a ranked player as bound and a guest as unbound", async () => {
  const { actor } = await install();
  const alice = createIdentity("preview-cover-alice");

  // A ranked login binds the roster key to Alice's principal.
  actor.setIdentity(alice);
  await actor.loginRanked("preview-cover-key-1", "Ada", [], { none: null });

  // A guest login puts a second player on the roster with no binding.
  await actor.login("preview-cover-key-2", "Bob", [], { none: null });

  const preview = await actor.getWinCreditPreview();
  expect(preview.players).toHaveLength(2);

  const ada = preview.players.find((p) => p.username === "Ada");
  const bob = preview.players.find((p) => p.username === "Bob");
  expect(ada).toBeDefined();
  expect(bob).toBeDefined();

  // The ranked player's key has a binding; the guest's does not.
  expect(ada?.isBound).toBe(true);
  expect(bob?.isBound).toBe(false);

  // Both just logged in, so their pings are fresh and their ages are small.
  expect(ada?.pingFresh).toBe(true);
  expect(bob?.pingFresh).toBe(true);
  expect(ada?.secondsSinceLastPing).toBeLessThanOrEqual(5n);
  expect(bob?.secondsSinceLastPing).toBeLessThanOrEqual(5n);

  // Each row carries a team variant.
  expect(["White", "Black"]).toContain(Object.keys(ada!.team)[0]);
  expect(["White", "Black"]).toContain(Object.keys(bob!.team)[0]);
});

it("returns no roster key and no principal in the preview", async () => {
  const { actor } = await install();
  const alice = createIdentity("preview-cover-alice");

  actor.setIdentity(alice);
  await actor.loginRanked("preview-cover-key-1", "Ada", [], { none: null });

  const preview = await actor.getWinCreditPreview();
  expect(preview.players).toHaveLength(1);

  // The row exposes exactly the five documented fields — no roster key, no
  // principal, no extra leak.
  const row = preview.players[0]!;
  expect(Object.keys(row).sort()).toEqual(
    ["isBound", "pingFresh", "secondsSinceLastPing", "team", "username"].sort(),
  );
  expect(row).not.toHaveProperty("principal");
  expect(row).not.toHaveProperty("rosterKey");

  // The top-level response exposes exactly the five documented fields.
  expect(Object.keys(preview).sort()).toEqual(
    [
      "celebrationWinner",
      "competitionLive",
      "gameNumber",
      "phase",
      "players",
    ].sort(),
  );
  expect(preview).not.toHaveProperty("principal");
});

it("still rejects the anonymous principal and an invalid key from loginRanked", async () => {
  const { actor } = await install();

  // A freshly created actor calls as the anonymous principal.
  await expect(
    actor.loginRanked("preview-cover-key-1", "Ada", [], { none: null }),
  ).rejects.toThrow();

  // An empty key and an over-long key are both invalid.
  actor.setIdentity(createIdentity("preview-cover-alice"));
  await expect(
    actor.loginRanked("", "Ada", [], { none: null }),
  ).rejects.toThrow();
  await expect(
    actor.loginRanked("k".repeat(129), "Ada", [], { none: null }),
  ).rejects.toThrow();
});

it("still rejects a key bound to a different caller", async () => {
  const { actor } = await install();
  const alice = createIdentity("preview-cover-alice");
  const bob = createIdentity("preview-cover-bob");

  actor.setIdentity(alice);
  await actor.loginRanked("preview-cover-key-1", "Ada", [], { none: null });

  // Bob cannot take over Alice's bound slot.
  actor.setIdentity(bob);
  await expect(
    actor.loginRanked("preview-cover-key-1", "Bob", [], { none: null }),
  ).rejects.toThrow();
});

it("keeps the binding through the prune so a later ranked login is accepted", async () => {
  const { actor } = await install();
  const alice = createIdentity("preview-cover-alice");

  // Alice binds a key and logs in. The key is on the roster, so the prune at
  // the end of loginRanked must NOT remove her binding: a later ranked login
  // with the same key is still accepted (the binding survived the prune).
  actor.setIdentity(alice);
  await actor.loginRanked("preview-cover-key-1", "Ada", [], { none: null });

  const again = await actor.loginRanked("preview-cover-key-1", "Ada", [], {
    none: null,
  });
  // The binding survived the prune, so the same caller may log in again with
  // the same key. The re-login path re-uniquifies the name against the roster
  // (the player already exists), so the returned name is the adjusted one.
  expect(again.principal).toBe("preview-cover-key-1");
  expect(again.username).toBe("Ada_copy");

  // The preview still reports the player as bound after the second login.
  const preview = await actor.getWinCreditPreview();
  const ada = preview.players.find((p) => p.username === "Ada_copy");
  expect(ada?.isBound).toBe(true);
});
