import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization taken BEFORE the "flip the conservative defaults" change.
 *
 * The request intentionally changes the tie-break and zero-vote defaults in
 * `tallyVotes` from Standard/Off to Random/On. That is intentional, so this
 * file deliberately does NOT assert the tie or zero-vote resolution.
 *
 * What it protects is the behavior ADJACENT to that change that must survive
 * it — the parts of the tally that are independent of which option is the
 * default:
 *
 *   - a STRICT majority still wins: the option with more votes is selected,
 *     for each question independently (a mixed result — Random majority on
 *     starting position, Off majority on spell use — resolves to Random/Off);
 *   - one vote per player: re-casting overwrites the player's previous vote,
 *     so the tally reflects the LATEST position, not a sum of every cast.
 *
 * The real canister is installed and called through the generated
 * declarations (no mock). The frontend suite mocks the actor, so it passes
 * unchanged against a canister whose `castVote`/`getVoteTally` are
 * unimplemented stubs; this file calls the real public API instead.
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

it("resolves a strict majority for each question independently", async () => {
  const actor = await freshActor();

  // castVote only accepts logged-in players, so log three in first. The
  // second/third logins start new games, which clear the vote store before
  // any vote here.
  await actor.login("majority-player-1", "MajorityAda", [], { none: null });
  await actor.login("majority-player-2", "MajorityBob", [], { none: null });
  await actor.login("majority-player-3", "MajorityCid", [], { none: null });

  // Two players vote Random / Off; one votes Standard / On. Each question has
  // a strict majority in a DIFFERENT direction, so a tally that coupled the
  // two questions (or hardcoded one option) would fail here.
  await actor.castVote("majority-player-1", {
    startingPosition: { Random: null },
    spellUse: { Off: null },
  });
  await actor.castVote("majority-player-2", {
    startingPosition: { Random: null },
    spellUse: { Off: null },
  });
  await actor.castVote("majority-player-3", {
    startingPosition: { Standard: null },
    spellUse: { On: null },
  });

  // The live tally records the exact counts...
  const tally = await actor.getVoteTally();
  expect(tally.randomCount).toBe(2n);
  expect(tally.standardCount).toBe(1n);
  expect(tally.spellOffCount).toBe(2n);
  expect(tally.spellOnCount).toBe(1n);

  // ...and the winning settings are the strict majority on each question.
  await expect(actor.getNextGameSettings()).resolves.toEqual({
    startingPosition: { Random: null },
    spellUse: { Off: null },
  });
});

it("overwrites a player's previous vote rather than counting both", async () => {
  const actor = await freshActor();

  await actor.login("overwrite-player-1", "OverwriteAda", [], { none: null });
  await actor.login("overwrite-player-2", "OverwriteBob", [], { none: null });
  await actor.login("overwrite-player-3", "OverwriteCid", [], { none: null });

  // Players 1 and 2 vote Random / On; player 3 votes Standard / Off.
  await actor.castVote("overwrite-player-1", {
    startingPosition: { Random: null },
    spellUse: { On: null },
  });
  await actor.castVote("overwrite-player-2", {
    startingPosition: { Random: null },
    spellUse: { On: null },
  });
  await actor.castVote("overwrite-player-3", {
    startingPosition: { Standard: null },
    spellUse: { Off: null },
  });

  // Player 1 changes their mind to Standard / Off. If the re-cast were counted
  // as an ADDITIONAL vote, Random/On would still lead 2-1; because it
  // overwrites, Standard/Off now leads 2-1.
  await actor.castVote("overwrite-player-1", {
    startingPosition: { Standard: null },
    spellUse: { Off: null },
  });

  const tally = await actor.getVoteTally();
  expect(tally.standardCount).toBe(2n);
  expect(tally.randomCount).toBe(1n);
  expect(tally.spellOffCount).toBe(2n);
  expect(tally.spellOnCount).toBe(1n);

  await expect(actor.getNextGameSettings()).resolves.toEqual({
    startingPosition: { Standard: null },
    spellUse: { Off: null },
  });
});
