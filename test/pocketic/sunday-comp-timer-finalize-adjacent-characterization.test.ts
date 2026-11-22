import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the backend competition archive, taken BEFORE the change
 * that moves finalization onto the recurring maintenance timer (so a finished
 * competition is archived when its day ends even with no reader) and adds an
 * admin-only manual finalize action.
 *
 * The request intentionally changes WHEN finalization runs (the timer, plus a
 * manual admin trigger) and backfills archive rows. This file deliberately does
 * NOT assert the timer-driven finalize, the manual finalize action, or any
 * backfilled winner — those are the intentional changes.
 *
 * What it protects is the archive read contract ADJACENT to that change, which
 * the Past winners table and the other archive-backed reads depend on, and which
 * the new timer-driven finalize must not disturb:
 *
 *   - the archive-backed reads still answer without trapping and still finalize
 *     the previous completed competition exactly once, even while the recurring
 *     maintenance timer is producing rounds (the timer now also finalizes, so
 *     the exactly-once guarantee must hold across BOTH triggers);
 *   - repeated and interleaved reads, with the timer running between them, never
 *     add or drop a Past winners row for the same date;
 *   - the public Past winners row keeps exactly the 2-place shape and leaks no
 *     principal;
 *   - the existing admin-only gate on `getAdminPrizeOverview` still rejects the
 *     anonymous principal and a signed-in non-admin principal — the security
 *     boundary the new admin-only manual finalize action must mirror.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose archive methods are unimplemented stubs. This file installs the app's
 * own compiled wasm into the platform's PocketIC replica and drives the real
 * public API.
 *
 * What the replica CANNOT observe here: a real win inside a competition window
 * populating a winner and runner-up, and the POSITIVE admin path (the admin
 * principal is a fixed compile-time literal no `createIdentity(seed)` caller can
 * present). See episode.coverageLimits.
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

it("keeps the archive exactly-once while the maintenance timer runs rounds", async () => {
  const { actor } = await install();

  // The first read finalizes the previous completed competition exactly once.
  const first = await actor.getPastWinners();
  expect(first).toHaveLength(1);

  // Produce rounds so the recurring maintenance timer fires. The timer now also
  // finalizes; it must not add a second row for the same date.
  await pic?.tick(5);

  const afterTimer = await actor.getPastWinners();
  expect(afterTimer.map((r) => r.sunday)).toEqual(first.map((r) => r.sunday));

  // Interleave the two finalizing entry points with more timer rounds: the
  // archive stays stable and no date is duplicated.
  await actor.getSundayCompStandings(50n);
  await pic?.tick(5);
  const final = await actor.getPastWinners();
  expect(final.map((r) => r.sunday)).toEqual(first.map((r) => r.sunday));

  const sundays = final.map((r) => r.sunday);
  expect(new Set(sundays.map((s) => s.toString())).size).toBe(sundays.length);
  for (const sunday of sundays) {
    expect(sunday % 86_400_000_000_000n).toBe(0n);
  }
});

it("keeps the Past winners row to the 2-place shape with no principal", async () => {
  const { actor } = await install();

  const rows = await actor.getPastWinners();
  expect(rows).toHaveLength(1);

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

it("still rejects getAdminPrizeOverview for the anonymous principal", async () => {
  const { canisterId } = await install();

  // A freshly created actor calls as the anonymous principal until an identity
  // is set. The existing admin-only call must still reject it — the security
  // boundary the new admin-only manual finalize action must mirror.
  const guest = guestActor(canisterId);
  await expect(guest.getAdminPrizeOverview()).rejects.toThrow();
});

it("still rejects getAdminPrizeOverview for a signed-in non-admin principal", async () => {
  const { actor } = await install();
  const alice = createIdentity("timer-finalize-non-admin");

  // A signed-in caller who is not the hardcoded admin principal is rejected.
  actor.setIdentity(alice);
  await expect(actor.getAdminPrizeOverview()).rejects.toThrow();
});
