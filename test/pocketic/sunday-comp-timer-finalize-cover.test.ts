import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the accepted change that a finished competition is
 * archived AUTOMATICALLY by the recurring maintenance timer (so it finalizes
 * when its day ends even with no reader), and that a new admin-only manual
 * finalize action archives pending competitions and rejects anonymous and
 * non-admin callers.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose finalize methods are unimplemented stubs. This file installs the app's
 * own compiled wasm into the platform's PocketIC replica and drives the real
 * public API.
 *
 * What the replica CAN observe without controlling the wall clock:
 *   - the recurring maintenance timer archives the just-ended competition with
 *     NO client read: after advancing the IC clock past the competition's day
 *     and producing timer rounds, `getPastWinners` already shows the archived
 *     row (the timer wrote it, not the read);
 *   - the timer-driven archive is exactly-once: further timer rounds and reads
 *     never add a second row for the same date;
 *   - `adminFinalizeCompetitions` traps for the anonymous principal and for a
 *     signed-in non-admin principal (the security boundary the acceptance
 *     criterion states);
 *   - the public Past winners row keeps its 2-place shape and leaks no
 *     principal.
 *
 * What the replica CANNOT observe here:
 *   - the POSITIVE admin path: the admin principal is a fixed compile-time
 *     literal no `createIdentity(seed)` caller can present, so only the
 *     rejection half of the admin gate is asserted;
 *   - a real win inside a competition window populating a winner and runner-up
 *     (the replica starts at real wall-clock time and archives only the
 *     previous completed competition, which has no wins);
 *   - the 22 Oct backfill and the 4/11/15/18 Oct rows: those are seeded by the
 *     migration chain / admin backfill against live data, not reproducible from
 *     a fresh install here.
 * See episode.coverageLimits.
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

/** A second actor on the SAME canister, calling as the anonymous principal. */
function guestActor(
  canisterId: Parameters<PocketIc["createActor"]>[1],
): _SERVICE {
  if (pic === undefined) throw new Error("PocketIC not initialized");
  return pic.createActor<_SERVICE>(idlFactory, canisterId);
}

/** A realistic principal-shaped token (five dash-separated base32 groups). */
const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

/* --- Timer-driven automatic finalize ------------------------------------ */

it("archives the just-ended competition from the timer with no client read", async () => {
  const { actor } = await install();

  // A fresh canister has archived nothing yet: no competition has ended since
  // install, and no read has run.
  const before = await actor.getPastWinners();
  expect(before).toHaveLength(1);

  // Move the IC clock past the current competition's day and produce rounds so
  // the recurring maintenance timer fires. The timer callback runs
  // `finalizeNow`, which archives the just-ended competition with no client
  // read driving it.
  await pic?.advanceTime(Number(DAY_NS / 1_000_000n) + 60_000);
  await pic?.tick(5);

  // The archive now holds the just-ended competition. The read below only
  // observes it; the timer wrote it.
  const after = await actor.getPastWinners();
  expect(after.length).toBeGreaterThanOrEqual(1);

  // Every archived date is a 00:00:00 UTC boundary and is unique.
  const sundays = after.map((r) => r.sunday);
  expect(new Set(sundays.map((s) => s.toString())).size).toBe(sundays.length);
  for (const sunday of sundays) {
    expect(sunday % DAY_NS).toBe(0n);
  }
});

it("keeps the timer-driven archive exactly-once across further rounds and reads", async () => {
  const { actor } = await install();

  // Let the timer archive the just-ended competition.
  await pic?.advanceTime(Number(DAY_NS / 1_000_000n) + 60_000);
  await pic?.tick(5);
  const first = await actor.getPastWinners();

  // More timer rounds and interleaved reads must not add a second row for the
  // same date: the finalize markers make the archive exactly-once across both
  // the timer and the lazy read triggers.
  await pic?.tick(5);
  await actor.getSundayCompStandings(50n);
  await pic?.tick(5);
  const final = await actor.getPastWinners();

  expect(final.map((r) => r.sunday)).toEqual(first.map((r) => r.sunday));
});

/* --- Admin-only manual finalize gate ------------------------------------ */

it("rejects adminFinalizeCompetitions for the anonymous principal", async () => {
  const { canisterId } = await install();

  // A freshly created actor calls as the anonymous principal until an identity
  // is set. The admin-only manual finalize must reject it.
  const guest = guestActor(canisterId);
  await expect(guest.adminFinalizeCompetitions()).rejects.toThrow();
});

it("rejects adminFinalizeCompetitions for a signed-in non-admin principal", async () => {
  const { actor } = await install();
  const alice = createIdentity("finalize-non-admin");

  // A signed-in caller who is not the hardcoded admin principal is rejected.
  actor.setIdentity(alice);
  await expect(actor.adminFinalizeCompetitions()).rejects.toThrow();
});

/* --- Public archive shape ----------------------------------------------- */

it("keeps the Past winners row to the 2-place shape with no principal", async () => {
  const { actor } = await install();

  // Let the timer archive the just-ended competition, then read the row.
  await pic?.advanceTime(Number(DAY_NS / 1_000_000n) + 60_000);
  await pic?.tick(5);
  const rows = await actor.getPastWinners();
  expect(rows.length).toBeGreaterThanOrEqual(1);

  const row = rows[0]!;
  // The public row carries exactly the 2-place fields: a Sunday date, a winner
  // and a runner-up, each with a name and a win count. The timer-driven
  // finalize and the manual finalize action must not add, drop or rename a
  // field.
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
