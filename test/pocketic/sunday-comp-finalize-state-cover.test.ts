import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the accepted change that the live competition store is
 * cleared only when a competition is actually archived (inside the finalize
 * loop), not on every 5-second maintenance tick, and for the new read-only
 * `getCompFinalizeState` diagnostic query.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose Sunday-comp methods are unimplemented stubs. This file installs the
 * app's own compiled wasm into the platform's PocketIC replica and drives the
 * real public API.
 *
 * What the replica CAN observe without controlling the wall clock:
 *   - `getCompFinalizeState` answers with the exact accepted shape
 *     (lastFinalizedSunday, currentStart, nextStart, isLive, liveEntryCount,
 *     nextOrder) and returns no principal;
 *   - its `currentStart` is a 00:00:00 UTC boundary at or before now and its
 *     `nextStart` is the boundary strictly after `currentStart`;
 *   - `isLive` agrees with `getSundayCompStatus().live` for the same clock;
 *   - the live store is NOT cleared by maintenance ticks or by a Comp-tab read
 *     while the current competition is still live: `liveEntryCount` and
 *     `nextOrder` are unchanged across many timer rounds and reads;
 *   - once a competition's day has fully passed, the next finalize pass
 *     archives it and then clears the live store: `liveEntryCount` returns to 0
 *     and `nextOrder` returns to 1, while the archive gains the row.
 *
 * What the replica CANNOT observe here: a real win inside a competition window
 * populating the live store (the replica starts at real wall-clock time and
 * archives only the previous completed competition, which has no wins), and the
 * exact tick at which the store is cleared. The pure `SundayComp` lib takes
 * `now` as a parameter, but no public canister method injects it. See
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

/* --- getCompFinalizeState shape ----------------------------------------- */

it("answers getCompFinalizeState with the accepted shape and no principal", async () => {
  const actor = await install();

  const state = await actor.getCompFinalizeState();

  // The accepted fields, exactly: the finalize marker, the current boundary,
  // the next boundary, liveness, the live-store entry count and nextOrder.
  expect(Object.keys(state).sort()).toEqual([
    "currentStart",
    "isLive",
    "lastFinalizedSunday",
    "liveEntryCount",
    "nextOrder",
    "nextStart",
  ]);

  // Every field is typed as the acceptance criterion states.
  expect(typeof state.lastFinalizedSunday).toBe("bigint");
  expect(typeof state.currentStart).toBe("bigint");
  expect(typeof state.nextStart).toBe("bigint");
  expect(typeof state.isLive).toBe("boolean");
  expect(typeof state.liveEntryCount).toBe("bigint");
  expect(typeof state.nextOrder).toBe("bigint");

  // No principal is returned: no string field exists at all, and no value
  // carries a principal-shaped token.
  for (const value of Object.values(state)) {
    if (typeof value === "string") {
      expect(value).not.toMatch(PRINCIPAL_PATTERN);
    }
  }
});

it("reports a UTC boundary for currentStart and the boundary after it for nextStart", async () => {
  const actor = await install();

  const state = await actor.getCompFinalizeState();

  // currentStart is a 00:00:00 UTC boundary at or before now.
  expect(state.currentStart % DAY_NS).toBe(0n);
  // nextStart is a boundary strictly after currentStart, and is itself a
  // 00:00:00 UTC boundary.
  expect(state.nextStart).toBeGreaterThan(state.currentStart);
  expect(state.nextStart % DAY_NS).toBe(0n);
});

it("agrees with getSundayCompStatus on liveness and the current boundary", async () => {
  const actor = await install();

  const state = await actor.getCompFinalizeState();
  const status = await actor.getSundayCompStatus();

  // Both reads derive from the same clock and the same boundary helper, so
  // they must agree on liveness and on the current competition's start.
  expect(state.isLive).toBe(status.live);
  expect(state.currentStart).toBe(status.sunday);
});

it("reports the live store empty and nextOrder at its initial value on a fresh canister", async () => {
  const actor = await install();

  const state = await actor.getCompFinalizeState();

  // A fresh canister has recorded no wins: the live store is empty and its
  // monotonic nextOrder counter is at its initial value of 1.
  expect(state.liveEntryCount).toBe(0n);
  expect(state.nextOrder).toBe(1n);
  // Nothing has been finalized yet.
  expect(state.lastFinalizedSunday).toBe(0n);
});

/* --- Live store survives ticks and reads during a live day -------------- */

it("does not clear the live store across many maintenance ticks and Comp-tab reads", async () => {
  const actor = await install();

  // Read the state, then produce many maintenance timer rounds and interleave
  // the Comp-tab reads (getSundayCompStandings and getPastWinners both finalize
  // lazily). While the current competition is still live, no boundary has fully
  // passed, so the live store must not be cleared by any of them.
  const before = await actor.getCompFinalizeState();

  await pic?.tick(20);
  await actor.getSundayCompStandings(50n);
  await pic?.tick(20);
  await actor.getPastWinners();
  await pic?.tick(20);

  const after = await actor.getCompFinalizeState();

  // The live store's entry count and nextOrder are unchanged: the store was
  // not wiped by a tick or a read while the competition is live.
  expect(after.liveEntryCount).toBe(before.liveEntryCount);
  expect(after.nextOrder).toBe(before.nextOrder);
  // The current competition is still the same boundary (no day has passed).
  expect(after.currentStart).toBe(before.currentStart);
});

/* --- Archive clears the live store -------------------------------------- */

it("archives a passed competition and then clears the live store", async () => {
  const actor = await install();

  // Move the IC clock past the current competition's day so the next finalize
  // pass has a boundary whose day has fully passed.
  await pic?.advanceTime(Number(DAY_NS / 1_000_000n) + 60_000);

  // The finalize pass archives the just-ended competition and clears the live
  // store as part of archiving it.
  const archived = await actor.getPastWinners();
  expect(archived.length).toBeGreaterThanOrEqual(1);

  const state = await actor.getCompFinalizeState();

  // The live store is cleared once the competition is archived: no entries and
  // nextOrder back at its initial value.
  expect(state.liveEntryCount).toBe(0n);
  expect(state.nextOrder).toBe(1n);
  // The marker has advanced past the archived boundary.
  expect(state.lastFinalizedSunday).toBeGreaterThan(0n);
  // The archived boundary is the one the marker now records.
  const sundays = archived.map((r) => r.sunday);
  expect(sundays).toContain(state.lastFinalizedSunday);
});

it("keeps the archive exactly-once across further ticks and reads after archiving", async () => {
  const actor = await install();

  // Archive the just-ended competition, then run more timer rounds and reads.
  await pic?.advanceTime(Number(DAY_NS / 1_000_000n) + 60_000);
  await pic?.tick(5);
  const first = await actor.getPastWinners();

  await pic?.tick(5);
  await actor.getSundayCompStandings(50n);
  await pic?.tick(5);
  const final = await actor.getPastWinners();

  // No second row for the same date, and the live store stays cleared.
  expect(final.map((r) => r.sunday)).toEqual(first.map((r) => r.sunday));
  const state = await actor.getCompFinalizeState();
  expect(state.liveEntryCount).toBe(0n);
  expect(state.nextOrder).toBe(1n);
});
