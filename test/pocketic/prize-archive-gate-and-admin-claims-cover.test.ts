import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the accepted change that a competition is archived
 * only when it has a confirmed prize pool, that every competition dated before
 * Sunday 1 November 2026 (UTC) is removed from archives, allocations and
 * claims, and that the admin prize-claims reads are admin-only.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose archive methods are unimplemented stubs. This file installs the app's
 * own compiled wasm into the platform's PocketIC replica and drives the real
 * public API.
 *
 * What the replica CAN observe without controlling the wall clock:
 *   - the archive gate: the previous completed competition has NO confirmed
 *     prize allocation, so the first archive-backed read archives nothing and
 *     the Past winners table is empty (a competition with no confirmed pool is
 *     never archived);
 *   - the removal cutoff: no archive-backed read returns a date before
 *     1 November 2026, and the archived-pool read for such a date answers none;
 *   - the admin-only gate on the two new reads: both trap for the anonymous
 *     principal and for a signed-in non-admin principal.
 *
 * What the replica CANNOT observe here:
 *   - The POSITIVE archive path (a competition with a confirmed pool being
 *     archived with its winners). The admin principal is a fixed compile-time
 *     literal and the lane may not construct a `Principal` by hand, so no caller
 *     reachable through `createIdentity(seed)` can save an allocation or read
 *     the admin detail. Only the rejection half of the admin gate is asserted.
 *   - A real Sunday win populating a winner and runner-up, which needs the
 *     canister clock to land inside a competition window and a concluded game.
 *   See episode.coverageLimits.
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

/**
 * The permanent removal cutoff: Sunday 1 November 2026 00:00:00 UTC, in
 * nanoseconds. 1970-01-01 was a Thursday, so day 20758 is a Sunday.
 */
const REMOVAL_CUTOFF = 20_758n * 86_400_000_000_000n;

/* --- Archive gate: no confirmed pool means no archive ------------------- */

it("archives nothing when the completed competition has no confirmed pool", async () => {
  const { actor } = await install();

  // A fresh canister has no prize allocation for the previous completed
  // competition, so the archive gate refuses to archive it. The Past winners
  // table is therefore empty: a competition with no confirmed pool is never
  // archived.
  const rows = await actor.getPastWinners();
  expect(rows).toEqual([]);
});

it("keeps the archive empty across repeated and interleaved reads", async () => {
  const { actor } = await install();

  // The gate is stable: no read re-introduces an unallocated competition.
  const first = await actor.getPastWinners();
  await actor.getSundayCompStandings(50n);
  const second = await actor.getPastWinners();
  expect(second).toEqual(first);
  expect(second).toEqual([]);
});

/* --- Removal cutoff: nothing before 1 November 2026 --------------------- */

it("returns no competition dated before the 1 November 2026 cutoff", async () => {
  const { actor } = await install();

  const rows = await actor.getPastWinners();
  for (const row of rows) {
    expect(row.sunday).toBeGreaterThanOrEqual(REMOVAL_CUTOFF);
  }
});

it("answers no archived pool for a date before the cutoff", async () => {
  const { actor } = await install();

  // A removed date must not be readable by its date, even after the archive
  // reads have run their cleanup pass.
  await actor.getPastWinners();
  const removed = REMOVAL_CUTOFF - 86_400_000_000_000n;
  await expect(actor.getArchivedPrizePool(removed)).resolves.toEqual([]);
});

/* --- Admin-only gate on the new prize-claims reads ---------------------- */

it("rejects getAdminAllocatedCompetitionDates for the anonymous principal", async () => {
  const { canisterId } = await install();

  // The admin-only dropdown read must reject the anonymous principal.
  const guest = guestActor(canisterId);
  await expect(guest.getAdminAllocatedCompetitionDates()).rejects.toThrow();
});

it("rejects getAdminAllocatedCompetitionDates for a signed-in non-admin principal", async () => {
  const { actor } = await install();
  const alice = createIdentity("admin-dates-non-admin");

  // A signed-in caller who is not the hardcoded admin principal is rejected.
  actor.setIdentity(alice);
  await expect(actor.getAdminAllocatedCompetitionDates()).rejects.toThrow();
});

it("rejects getAdminCompetitionDetail for the anonymous principal", async () => {
  const { canisterId } = await install();

  // The admin-only detail read must reject the anonymous principal.
  const guest = guestActor(canisterId);
  await expect(guest.getAdminCompetitionDetail(REMOVAL_CUTOFF)).rejects.toThrow();
});

it("rejects getAdminCompetitionDetail for a signed-in non-admin principal", async () => {
  const { actor } = await install();
  const alice = createIdentity("admin-detail-non-admin");

  // A signed-in caller who is not the hardcoded admin principal is rejected.
  actor.setIdentity(alice);
  await expect(actor.getAdminCompetitionDetail(REMOVAL_CUTOFF)).rejects.toThrow();
});
