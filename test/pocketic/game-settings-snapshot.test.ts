import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the `getGameSettingsSnapshot` public query.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `getGameSettingsSnapshot` is an unimplemented stub. This file calls the
 * real public query on a freshly installed canister, so a stubbed backend traps
 * here instead of passing.
 *
 * What the replica CAN observe:
 *   - `getGameSettingsSnapshot` answers a fresh canister with the zero-vote
 *     snapshot (defaults Random / On, all counts 0) rather than trapping on
 *     uninitialized state;
 *   - the snapshot is FIXED for the current game: casting votes for the next
 *     game moves the live `getVoteTally` but leaves the snapshot unchanged.
 *
 * What the replica CANNOT observe: a snapshot captured from a concluded game.
 * `captureVotesAtGameEnd` runs only when a game actually ends, which requires a
 * full game to be played out in-sandbox; this file therefore does not assert the
 * post-game capture path. See episode.coverageLimits.
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

it("answers the fixed game-settings snapshot instead of trapping", async () => {
  const actor = await freshActor();

  // On a fresh canister no game has concluded, so the snapshot resolves to the
  // zero-vote defaults: Random / On with all counts 0.
  const snapshot = await actor.getGameSettingsSnapshot();
  expect(snapshot).toEqual({
    startingPosition: { Random: null },
    spellUse: { On: null },
    standardCount: 0n,
    randomCount: 0n,
    spellOnCount: 0n,
    spellOffCount: 0n,
  });
});

it("keeps the game-settings snapshot fixed while votes are cast for the next game", async () => {
  const actor = await freshActor();

  // castVote only accepts logged-in players, so log two in first. The second
  // login starts a new game, which clears the vote store before any vote here.
  await actor.login("snapshot-player-1", "SnapshotAda", [], { none: null });
  await actor.login("snapshot-player-2", "SnapshotBob", [], { none: null });

  const before = await actor.getGameSettingsSnapshot();

  // Two players cast votes for the next game (spells ON, Random).
  await actor.castVote("snapshot-player-1", {
    startingPosition: { Random: null },
    spellUse: { On: null },
  });
  await actor.castVote("snapshot-player-2", {
    startingPosition: { Random: null },
    spellUse: { On: null },
  });

  // The live tally reflects the new votes...
  const tally = await actor.getVoteTally();
  expect(tally.spellOnCount).toBe(2n);
  expect(tally.randomCount).toBe(2n);

  // ...but the fixed snapshot is unchanged: it still reports the zero-vote
  // defaults captured before any game concluded.
  const after = await actor.getGameSettingsSnapshot();
  expect(after).toEqual(before);
});
