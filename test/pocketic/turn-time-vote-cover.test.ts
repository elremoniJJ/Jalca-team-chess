import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the accepted "third turn-time vote" contract.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `castVote` / `getVoteTally` / `getNextGameSettings` are unimplemented
 * stubs. This file calls the real public API on a freshly installed canister,
 * so a stubbed backend traps here instead of passing.
 *
 * What the replica CAN observe:
 *   - `castVote` accepts a `turnDuration` field and `getVoteTally` counts it
 *     per option;
 *   - the turn duration is resolved by the SAME strict-majority tally as the
 *     other two settings: a majority for 1 minute or 1.5 minutes wins, and a
 *     tie (or zero votes) resolves to the 2-minute default;
 *   - `getNextGameSettings` returns the resolved `turnDuration`;
 *   - `getGameState` surfaces the resolved `turnDuration` for the current game
 *     and a `timerRemainingMs` consistent with it (the countdown uses the voted
 *     duration, not a fixed 5 minutes).
 *
 * What the replica CANNOT observe: the countdown RESET at each turn flip and at
 * game start, which requires a full game to be played out in-sandbox. See
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

it("counts the turn-duration votes per option and resolves a strict majority", async () => {
  const actor = await freshActor();

  // castVote only accepts logged-in players, so log three in first. The
  // second/third logins start new games, which clear the vote store before any
  // vote here.
  await actor.login("turn-player-1", "TurnAda", [], { none: null });
  await actor.login("turn-player-2", "TurnBob", [], { none: null });
  await actor.login("turn-player-3", "TurnCid", [], { none: null });

  // Two players vote 1 minute; one votes 2 minutes. The turn-duration question
  // has a strict majority for 1 minute.
  await actor.castVote("turn-player-1", {
    startingPosition: { Random: null },
    spellUse: { On: null },
    turnDuration: { OneMinute: null },
  });
  await actor.castVote("turn-player-2", {
    startingPosition: { Random: null },
    spellUse: { On: null },
    turnDuration: { OneMinute: null },
  });
  await actor.castVote("turn-player-3", {
    startingPosition: { Random: null },
    spellUse: { On: null },
    turnDuration: { TwoMinutes: null },
  });

  // The live tally records the exact per-option counts.
  const tally = await actor.getVoteTally();
  expect(tally.oneMinuteCount).toBe(2n);
  expect(tally.twoMinuteCount).toBe(1n);
  expect(tally.ninetySecondCount).toBe(0n);

  // The winning turn duration is the strict majority.
  await expect(actor.getNextGameSettings()).resolves.toEqual({
    startingPosition: { Random: null },
    spellUse: { On: null },
    turnDuration: { OneMinute: null },
  });
});

it("resolves a 1.5-minute majority to 1.5 minutes", async () => {
  const actor = await freshActor();

  await actor.login("ninety-player-1", "NinetyAda", [], { none: null });
  await actor.login("ninety-player-2", "NinetyBob", [], { none: null });
  await actor.login("ninety-player-3", "NinetyCid", [], { none: null });

  await actor.castVote("ninety-player-1", {
    startingPosition: { Random: null },
    spellUse: { On: null },
    turnDuration: { NinetySeconds: null },
  });
  await actor.castVote("ninety-player-2", {
    startingPosition: { Random: null },
    spellUse: { On: null },
    turnDuration: { NinetySeconds: null },
  });
  await actor.castVote("ninety-player-3", {
    startingPosition: { Random: null },
    spellUse: { On: null },
    turnDuration: { OneMinute: null },
  });

  const tally = await actor.getVoteTally();
  expect(tally.ninetySecondCount).toBe(2n);
  expect(tally.oneMinuteCount).toBe(1n);

  await expect(actor.getNextGameSettings()).resolves.toEqual({
    startingPosition: { Random: null },
    spellUse: { On: null },
    turnDuration: { NinetySeconds: null },
  });
});

it("resolves a tied turn-duration vote to the 2-minute default", async () => {
  const actor = await freshActor();

  await actor.login("turn-tie-player-1", "TurnTieAda", [], { none: null });
  await actor.login("turn-tie-player-2", "TurnTieBob", [], { none: null });

  // A 1-1 split between 1 minute and 1.5 minutes is a tie, which resolves to
  // the 2-minute default.
  await actor.castVote("turn-tie-player-1", {
    startingPosition: { Random: null },
    spellUse: { On: null },
    turnDuration: { OneMinute: null },
  });
  await actor.castVote("turn-tie-player-2", {
    startingPosition: { Random: null },
    spellUse: { On: null },
    turnDuration: { NinetySeconds: null },
  });

  await expect(actor.getNextGameSettings()).resolves.toEqual({
    startingPosition: { Random: null },
    spellUse: { On: null },
    turnDuration: { TwoMinutes: null },
  });
});

it("resolves the 2-minute default when no turn-duration votes exist", async () => {
  const actor = await freshActor();

  // No votes have been cast, so the tally resolves to the defaults rather than
  // trapping on uninitialized state.
  await expect(actor.getNextGameSettings()).resolves.toEqual({
    startingPosition: { Random: null },
    spellUse: { On: null },
    turnDuration: { TwoMinutes: null },
  });
});

it("surfaces the resolved turn duration and a matching countdown in the game state", async () => {
  const actor = await freshActor();

  // A fresh canister has no game in progress; the snapshot still answers with
  // the default turn duration and a countdown bounded by it (2 minutes =
  // 120000 ms), not a fixed 5-minute value.
  const state = await actor.getGameState("turn-state-player");
  expect(state.turnDuration).toEqual({ TwoMinutes: null });
  expect(state.timerRemainingMs).toBeLessThanOrEqual(120000n);
});
