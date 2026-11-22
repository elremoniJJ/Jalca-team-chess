import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the Sunday-competition live standings store, taken BEFORE
 * the change that stops the live store being cleared on every maintenance tick
 * during a live competition day and instead clears it inside the finalize loop
 * as each passed boundary is finalized.
 *
 * The request intentionally changes WHEN the live store is reset. This file
 * deliberately does NOT assert the per-tick clearing (the behavior being
 * changed) and does NOT assert the new in-loop clearing (the intentional
 * change). It protects the behavior ADJACENT to that change, which the live
 * board and the Past winners table depend on and which the new clearing point
 * must not disturb:
 *
 *   - the archive-backed reads (`getPastWinners`, `getSundayCompStandings`)
 *     still answer without trapping while the recurring maintenance timer runs
 *     many rounds, and the archive stays exactly-once: no date is duplicated
 *     and no row is dropped by a timer round;
 *   - the live standings read still answers without trapping after the timer
 *     has run rounds, and its rows keep the public shape (rank, displayName,
 *     wins, isMe) with no principal leaked;
 *   - the status read still reports a 00:00:00 UTC boundary at or before now
 *     with non-negative seconds remaining, regardless of how many timer rounds
 *     have run.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose Sunday-comp methods are unimplemented stubs. This file installs the
 * app's own compiled wasm into the platform's PocketIC replica and drives the
 * real public API.
 *
 * What the replica CANNOT observe here: a real win inside a competition window
 * populating the live store, and the exact tick at which the store is reset.
 * The replica starts at real wall-clock time and archives only the previous
 * completed competition, which has no wins; the pure `SundayComp` lib takes
 * `now` as a parameter but no public canister method injects it. See
 * episode.coverageLimits.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

/** One competition day in nanoseconds. */
const DAY_NS = 86_400_000_000_000n;

let pic: PocketIc | undefined;

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
});

afterAll(async () => {
  await pic?.tearDown();
});

/** Install a fresh canister and return its actor. */
async function install(): Promise<_SERVICE> {
  if (pic === undefined) throw new Error("PocketIC not initialized");
  const { actor } = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  });
  return actor;
}

/** A realistic principal-shaped token (five dash-separated base32 groups). */
const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

it("keeps the archive exactly-once across many maintenance timer rounds", async () => {
  const actor = await install();

  // The first read finalizes the previous completed competition exactly once.
  const first = await actor.getPastWinners();
  expect(first).toHaveLength(1);

  // Produce many timer rounds. The recurring maintenance timer now also
  // finalizes; whatever the live-store clearing point becomes, the archive must
  // not gain a second row for the same date nor lose the row it already has.
  await pic?.tick(20);

  const afterTimer = await actor.getPastWinners();
  expect(afterTimer.map((r) => r.sunday)).toEqual(first.map((r) => r.sunday));

  // Interleave the two finalizing entry points with more timer rounds: the
  // archive stays stable and no date is duplicated.
  await actor.getSundayCompStandings(50n);
  await pic?.tick(20);
  const final = await actor.getPastWinners();
  expect(final.map((r) => r.sunday)).toEqual(first.map((r) => r.sunday));

  const sundays = final.map((r) => r.sunday);
  expect(new Set(sundays.map((s) => s.toString())).size).toBe(sundays.length);
  for (const sunday of sundays) {
    expect(sunday % DAY_NS).toBe(0n);
  }
});

it("keeps the live standings read answering with the public shape after timer rounds", async () => {
  const actor = await install();

  // Finalize the previous completed competition, then let the timer run rounds.
  await actor.getPastWinners();
  await pic?.tick(20);

  // The live standings read must still answer without trapping, and every row
  // must keep the public shape: rank, displayName, wins, isMe, and no principal.
  const standings = await actor.getSundayCompStandings(50n);
  expect(Array.isArray(standings)).toBe(true);
  for (const row of standings) {
    expect(Object.keys(row).sort()).toEqual([
      "displayName",
      "isMe",
      "rank",
      "wins",
    ]);
    expect(row.displayName).not.toMatch(PRINCIPAL_PATTERN);
  }
});

it("keeps the status read reporting a UTC boundary after timer rounds", async () => {
  const actor = await install();

  // Let the timer run rounds, then read the status. The reported Sunday must
  // still be a 00:00:00 UTC boundary at or before now, with non-negative
  // seconds remaining, regardless of how many timer rounds have run.
  await pic?.tick(20);

  const status = await actor.getSundayCompStatus();
  expect(typeof status.live).toBe("boolean");
  expect(status.sunday % DAY_NS).toBe(0n);
  expect(status.secondsRemaining).toBeGreaterThanOrEqual(0n);
});

it("keeps the Past winners row to the 2-place shape with no principal", async () => {
  const actor = await install();

  const rows = await actor.getPastWinners();
  expect(rows).toHaveLength(1);

  const row = rows[0]!;
  // The public row carries exactly the 2-place fields: a Sunday date, a winner
  // and a runner-up, each with a name and a win count. The changed live-store
  // clearing point must not add, drop or rename a field.
  expect(Object.keys(row).sort()).toEqual([
    "runnerUpName",
    "runnerUpWins",
    "sunday",
    "winnerName",
    "winnerWins",
  ]);

  for (const value of [row.winnerName, row.runnerUpName]) {
    if (value.length > 0) {
      expect(value[0]).not.toMatch(PRINCIPAL_PATTERN);
    }
  }
});
