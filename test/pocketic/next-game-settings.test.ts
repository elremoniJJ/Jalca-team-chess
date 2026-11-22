import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the `getNextGameSettings` public query.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `getNextGameSettings` is an unimplemented stub. This file calls the
 * real public query on a freshly installed canister, so a stubbed backend traps
 * here instead of passing.
 *
 * What the replica CAN observe:
 *   - `getNextGameSettings` answers a fresh canister with the defaults
 *     (Random / On) rather than trapping on uninitialized state;
 *   - the query resolves the MAJORITY of the live vote store: with two players
 *     both voting OFF / Standard it returns Off / Standard, and with a tie it
 *     falls back to the defaults (Random / On).
 *
 * What the replica CANNOT observe: the settings actually APPLIED to the next
 * game. `startNewGame` applies the tally only when a game actually starts,
 * which requires a full game to be played out in-sandbox; this file therefore
 * asserts the resolved settings the start path consumes, not the applied board.
 * See episode.coverageLimits.
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

it("answers the next-game settings with the defaults on a fresh canister", async () => {
  const actor = await freshActor();

  // No votes have been cast, so the tally resolves to the defaults rather
  // than trapping on uninitialized state.
  await expect(actor.getNextGameSettings()).resolves.toEqual({
    startingPosition: { Random: null },
    spellUse: { On: null },
  });
});

it("resolves the majority of the live vote store for the next game", async () => {
  const actor = await freshActor();

  // castVote only accepts logged-in players, so log two in first. The second
  // login starts a new game, which clears the vote store before any vote here.
  await actor.login("next-settings-player-1", "NextAda", [], { none: null });
  await actor.login("next-settings-player-2", "NextBob", [], { none: null });

  // Both players vote for the same non-default options (spells OFF, Standard).
  await actor.castVote("next-settings-player-1", {
    startingPosition: { Standard: null },
    spellUse: { Off: null },
  });
  await actor.castVote("next-settings-player-2", {
    startingPosition: { Standard: null },
    spellUse: { Off: null },
  });

  // The next-game settings resolve to the majority the players chose.
  await expect(actor.getNextGameSettings()).resolves.toEqual({
    startingPosition: { Standard: null },
    spellUse: { Off: null },
  });
});

it("falls back to the defaults when the vote is tied", async () => {
  const actor = await freshActor();

  await actor.login("tie-player-1", "TieAda", [], { none: null });
  await actor.login("tie-player-2", "TieBob", [], { none: null });

  // A 1-1 split on both questions is a tie, which resolves to the defaults.
  await actor.castVote("tie-player-1", {
    startingPosition: { Random: null },
    spellUse: { On: null },
  });
  await actor.castVote("tie-player-2", {
    startingPosition: { Standard: null },
    spellUse: { Off: null },
  });

  await expect(actor.getNextGameSettings()).resolves.toEqual({
    startingPosition: { Random: null },
    spellUse: { On: null },
  });
});
