import { PocketIc } from "@dfinity/pic";
import { afterEach, beforeEach, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Cover for the accepted maintenance-trigger change.
 *
 * The request moves maintenance (stale-player cleanup, turn-timeout expiry,
 * celebration expiry) off the client call path and onto a backend recurring
 * timer that fires every 5 seconds, installed in main.mo's actor initializer.
 * heartbeat no longer triggers maintenance; it only records lastPing.
 *
 * This file exercises the REAL canister through the generated declarations
 * (no mock) and pins the observable consequences:
 *
 *   1. Calling a converted read query does NOT run maintenance. A player whose
 *      lastPing is older than the 180s stale cutoff survives a getGameState
 *      query, because a query cannot mutate state and no timer round has run.
 *   2. Maintenance DOES run with no client call, driven by the 5s recurring
 *      timer: after advancing the IC clock past the stale cutoff and producing
 *      rounds, the stale player is removed without any client update call.
 *   3. heartbeat refreshes lastPing, so a heartbeating player survives the
 *      timer's stale cleanup while a silent peer is removed.
 *   4. Existing game behavior is unchanged: a login that arrives while a stale
 *      peer is present and the timer is overdue must still succeed.
 *
 * PocketIC runs with manual progress (no auto-progress), so the timer only
 * fires when this test produces rounds with `tick()`. That is what makes the
 * cases separable: `advanceTime` moves the clock, `tick` produces the round
 * the timer callback needs.
 *
 * Each test installs its own canister so the clock and roster state of one
 * test cannot leak into the next.
 *
 * The turn-timeout and celebration-expiry sub-passes are not driven here (they
 * need a started game and a concluded game respectively); see coverageLimits.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

/**
 * The backend's stale cutoff is 180s (widened from 15s so a non-move-maker
 * heartbeating every 120s is never treated as stale); advance past it with
 * margin.
 */
const PAST_STALE_CUTOFF_MS = 181_000;

let pic: PocketIc | undefined;
let actor: _SERVICE;

beforeEach(async () => {
  pic = await PocketIc.create(PIC_URL);
  ({ actor } = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  }));
});

afterEach(async () => {
  await pic?.tearDown();
  pic = undefined;
});

it("does not run maintenance when a converted read query is called", async () => {
  // A player logs in; login records lastPing at the current IC time.
  await actor.login("query-player", "Ada", [], { none: null });

  const before = await actor.getGameState("query-player");
  expect(before.players.map((p) => p.principal)).toContain("query-player");

  // Move the IC clock past the 180s stale cutoff WITHOUT producing a round, so
  // the recurring timer has not had a chance to fire.
  await pic?.advanceTime(PAST_STALE_CUTOFF_MS);

  // Call a converted read query. If the query still ran maintenance (the old
  // behavior), the now-stale player would be removed here. A true query cannot
  // mutate state, so the player must survive.
  const afterQuery = await actor.getGameState("query-player");
  expect(afterQuery.players.map((p) => p.principal)).toContain("query-player");
});

it("runs maintenance from the 5s recurring timer with no client call", async () => {
  // A fresh player logs in; no further client update call is made until after
  // maintenance has already run.
  await actor.login("timer-player", "Bob", [], { none: null });

  const before = await actor.getGameState("timer-player");
  expect(before.players.map((p) => p.principal)).toContain("timer-player");

  // Advance past the stale cutoff and produce rounds. The recurring timer
  // fires on a round boundary once the clock passes its 5s schedule; the
  // callback awaits runMaintenance, so give it a few rounds to complete.
  await pic?.advanceTime(PAST_STALE_CUTOFF_MS);
  await pic?.tick(5);

  // No client update call drove this: the stale player was removed by the
  // timer's maintenance pass alone.
  const after = await actor.getGameState("timer-player");
  expect(after.players.map((p) => p.principal)).not.toContain("timer-player");
});

it("refreshes lastPing on heartbeat so the player survives the timer's cleanup", async () => {
  // Two players log in. One keeps heartbeating; the other goes silent.
  await actor.login("alive-player", "Cara", [], { none: null });
  await actor.login("silent-player", "Dan", [], { none: null });

  // Advance 100s — under the 180s stale cutoff, so neither player is stale
  // yet. The overdue timer may fire during the heartbeat round below, but it
  // must remove nobody.
  await pic?.advanceTime(100_000);
  await actor.heartbeat("alive-player");

  // Advance another 100s: 200s since login (silent is stale) but only 100s
  // since the heartbeat (alive is fresh). Produce rounds so the timer runs.
  await pic?.advanceTime(100_000);
  await pic?.tick(5);

  const after = await actor.getGameState("alive-player");
  const remaining = after.players.map((p) => p.principal);
  // The heartbeating player's lastPing was refreshed, so it survives.
  expect(remaining).toContain("alive-player");
  // The silent player was removed by the timer's stale cleanup.
  expect(remaining).not.toContain("silent-player");
});

it("still logs in a player while a stale peer is present and the timer is overdue", async () => {
  // A player logs in, then the clock moves past the stale cutoff so the
  // recurring timer is overdue. A second player then logs in. The login update
  // must complete normally: the timer's independent cleanup must not corrupt
  // the roster the login is mutating.
  await actor.login("stale-a", "Ada", [], { none: null });
  await pic?.advanceTime(PAST_STALE_CUTOFF_MS);

  await actor.login("fresh-b", "Bob", [], { none: null });

  const state = await actor.getGameState("fresh-b");
  expect(state.players.map((p) => p.principal)).toContain("fresh-b");
});

it("keeps the roster consistent when the timer removes players during a login's team reassignment", async () => {
  // Regression cover for the IC0503 'Array index out of bounds' trap that the
  // previous cover found: reassignTeams / assignMoveMakerForTeam collected
  // player INDICES, awaited a random draw, and then indexed players.items with
  // a pre-await index. The recurring maintenance timer can run
  // cleanupStalePlayers during that await, removing a player and shrinking the
  // array, so the stale index was out of bounds.
  //
  // The fix re-derives each player by PRINCIPAL after every await and skips
  // players removed mid-pass. This test drives that exact interleaving: two
  // players start a game (one is the Move_Maker), the clock moves past the
  // stale cutoff so the timer is overdue, and a third player logs in. The
  // login's own awaits give the overdue timer a round in which to remove the
  // two stale players — including the Move_Maker, which forces the
  // assignMoveMakerForTeam re-validation branch.
  //
  // Observable contract: the login must not trap, the fresh player must end up
  // with a valid team, and the move maker must never point at a player who is
  // no longer in the roster.
  await actor.login("stale-mover", "Ada", [], { none: null });
  await actor.login("stale-peer", "Bob", [], { none: null });

  // The game started and a Move_Maker was assigned to one of the two players.
  const started = await actor.getGameState("stale-mover");
  expect(started.phase).toEqual({ Playing: null });
  expect(started.moveMaker.length).toBe(1);

  // Both players go stale; the recurring timer is now overdue.
  await pic?.advanceTime(PAST_STALE_CUTOFF_MS);

  // A third player logs in. Its awaits let the overdue timer run its cleanup
  // pass, which removes the two stale players mid-reassignment.
  const login = await actor.login("fresh-c", "Cara", [], { none: null });
  expect(login.principal).toBe("fresh-c");
  expect(login.team).toBeDefined();

  const after = await actor.getGameState("fresh-c");
  const remaining = after.players.map((p) => p.principal);

  // The fresh player survived and carries a valid team.
  expect(remaining).toContain("fresh-c");
  const fresh = after.players.find((p) => p.principal === "fresh-c");
  expect(fresh?.team).toBeDefined();

  // The stale players were removed by the timer, and the move maker (if one is
  // still recorded) points at a player who is actually present — never at a
  // removed principal.
  expect(remaining).not.toContain("stale-mover");
  expect(remaining).not.toContain("stale-peer");
  if (after.moveMaker.length === 1) {
    expect(remaining).toContain(after.moveMaker[0]);
  }
});
