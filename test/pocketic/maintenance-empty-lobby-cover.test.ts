import { PocketIc } from "@dfinity/pic";
import { afterEach, beforeEach, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Cover for the accepted empty-lobby short-circuit in the recurring maintenance
 * pass (`runMaintenance` in chess-game-api.mo).
 *
 * The change adds one guard at the top of the pass: when the RAW player roster
 * is empty (`players.items.size() == 0`) the pass returns immediately without
 * running cleanupStalePlayers, checkTimerExpiry, or checkCelebrationExpiry. The
 * 5-second recurring timer keeps firing; only the work inside each tick is
 * skipped. The guard uses the raw roster size, not totalPlayers(), so a lobby
 * holding only stale players still runs the pass and pauses as before.
 *
 * This file exercises the REAL canister through the generated declarations (no
 * mock) and pins the observable consequences the acceptance criteria state:
 *
 *   1. With zero players, repeated maintenance ticks are inert: nothing traps
 *      and the state stays Paused with an empty roster.
 *   2. Once a player is present, the pass resumes its normal work on the next
 *      tick: a stale player is removed with no client update call.
 *   3. An active game's turn timeout still expires and concludes the game while
 *      a player is present (the players are kept fresh by heartbeating, so the
 *      stale cleanup does not remove them first).
 *   4. The post-conclusion celebration window still closes and the next game
 *      starts once fresh players signal readiness.
 *
 * PocketIC runs with manual progress (no auto-progress), so the recurring timer
 * only fires when this test produces rounds with `tick()` or an update call.
 * Each test installs its own canister so clock and roster state cannot leak.
 *
 * The empty-lobby guard itself is a performance short-circuit: in every state
 * reachable through the public API an empty roster already coincides with
 * `#Paused`, so the guard is not externally distinguishable from the pre-change
 * behavior. What this file can and does prove is that the empty tick is inert
 * and that the pass still does its full work whenever a player is present.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

/** The backend's stale cutoff is 180s; advance past it with margin. */
const PAST_STALE_CUTOFF_MS = 181_000;
/** The backend's turn time limit is 300s. */
const TURN_LIMIT_MS = 300_000;
/** The backend's celebration/draw window is 10s. */
const CELEBRATION_WINDOW_MS = 10_000;
/** Heartbeat cadence used to keep players fresh while the turn timer runs out. */
const HEARTBEAT_STEP_MS = 60_000;

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

/**
 * Advance the clock in heartbeat-sized steps until the 300s turn timer has
 * elapsed, refreshing both players each step so the stale cleanup never removes
 * them before the turn-timeout sub-pass runs. Returns after the game has had a
 * maintenance round to conclude.
 */
async function runTurnTimerOut(
  first: string,
  second: string,
): Promise<void> {
  const steps = Math.ceil((TURN_LIMIT_MS + HEARTBEAT_STEP_MS) / HEARTBEAT_STEP_MS);
  for (let step = 0; step < steps; step += 1) {
    await pic?.advanceTime(HEARTBEAT_STEP_MS);
    await actor.heartbeat(first);
    await actor.heartbeat(second);
  }
  await pic?.tick(5);
}

it("performs no work on repeated maintenance ticks while the lobby is empty", async () => {
  // A fresh canister has zero players and is already Paused.
  const before = await actor.getGameState("nobody");
  expect(before.players).toEqual([]);
  expect(before.phase).toEqual({ Paused: null });

  // Produce several maintenance rounds with no players present. The guard
  // returns immediately each tick: nothing traps and no state changes.
  await pic?.tick(5);
  await pic?.tick(5);
  await pic?.tick(5);

  const after = await actor.getGameState("nobody");
  expect(after.players).toEqual([]);
  expect(after.phase).toEqual({ Paused: null });
  expect(after.moveMaker).toEqual([]);
});

it("resumes stale cleanup on the next tick once a player is present", async () => {
  // One player logs in; the lobby is unbalanced so it stays Paused, but the
  // raw roster is now non-empty and the guard no longer short-circuits.
  await actor.login("resume-player", "Ada", [], { none: null });
  const before = await actor.getGameState("resume-player");
  expect(before.players.map((p) => p.principal)).toContain("resume-player");

  // Advance past the stale cutoff and produce a round. No client update call
  // drives this: the timer's maintenance pass alone removes the stale player.
  await pic?.advanceTime(PAST_STALE_CUTOFF_MS);
  await pic?.tick(5);

  const after = await actor.getGameState("resume-player");
  expect(after.players.map((p) => p.principal)).not.toContain("resume-player");
});

it("expires an active game's turn timeout while a player is present", async () => {
  // Two players start a game (one per team).
  await actor.login("timeout-a", "Ada", [], { none: null });
  await actor.login("timeout-b", "Bob", [], { none: null });
  const started = await actor.getGameState("timeout-a");
  expect(started.phase).toEqual({ Playing: null });

  // Keep both players fresh while the 300s turn timer runs out. Each heartbeat
  // round also lets the overdue maintenance timer run; cleanup must not remove
  // a fresh player, and the turn-timeout sub-pass must conclude the game.
  await runTurnTimerOut("timeout-a", "timeout-b");

  const concluded = await actor.getGameState("timeout-a");
  expect(concluded.phase).toEqual({ Celebration: null });
  expect(concluded.winner.length).toBe(1);
});

it("closes the celebration window while a player is present and starts the next game once fresh players arrive", async () => {
  await actor.login("next-a", "Ada", [], { none: null });
  await actor.login("next-b", "Bob", [], { none: null });

  // Drive the turn timer to expiry so the game concludes into Celebration.
  await runTurnTimerOut("next-a", "next-b");
  const concluded = await actor.getGameState("next-a");
  expect(concluded.phase).toEqual({ Celebration: null });

  // The conclusion marked every player stale, so no fresh players are present
  // and the game stays concluded rather than auto-starting.
  await pic?.advanceTime(CELEBRATION_WINDOW_MS + 1_000);
  await pic?.tick(5);
  const afterWindow = await actor.getGameState("next-a");
  expect(afterWindow.phase).toEqual({ Celebration: null });
  // The 10s window has closed: the countdown has reached zero.
  expect(afterWindow.celebrationSecondsLeft).toEqual([0n]);

  // Both players leave; the lobby empties and transitions to Paused.
  await actor.logout("next-a");
  await actor.logout("next-b");
  const emptied = await actor.getGameState("next-a");
  expect(emptied.players).toEqual([]);
  expect(emptied.phase).toEqual({ Paused: null });

  // Fresh players arrive. The second login balances the teams and starts a
  // brand-new game normally.
  await actor.login("fresh-a", "Cara", [], { none: null });
  await actor.login("fresh-b", "Dan", [], { none: null });
  const next = await actor.getGameState("fresh-a");
  expect(next.phase).toEqual({ Playing: null });
  expect(next.moveMaker.length).toBe(1);
});
