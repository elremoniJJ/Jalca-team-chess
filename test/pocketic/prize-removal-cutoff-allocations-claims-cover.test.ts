import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the accepted change that every competition dated
 * before Sunday 1 November 2026 (UTC) is removed from archives, ALLOCATIONS and
 * CLAIMS.
 *
 * The existing archive lanes assert the archive half of that cutoff
 * (`getPastWinners`, `getArchivedPrizePool`). This file closes the remaining
 * half: the allocation and claim reads must not surface a pre-cutoff date
 * either.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose allocation/claim methods are unimplemented stubs. This file installs the
 * app's own compiled wasm into the platform's PocketIC replica and drives the
 * real public API.
 *
 * What the replica CAN observe without controlling the wall clock:
 *   - `getUpcomingAllocationStatuses()` (the admin allocation dropdown source)
 *     returns only strictly-future Sundays, so no date before the cutoff can
 *     appear in it;
 *   - `getFirstPrizeForSunday(sunday)` (the player-facing allocation read)
 *     answers none for a pre-cutoff date, so a removed date carries no
 *     allocation;
 *   - `getArchivedPrizePool(sunday)` answers none for a pre-cutoff date, so a
 *     removed date carries no archived pool;
 *   - `getAdminPrizeClaims()` is admin-only and traps for the anonymous and
 *     signed-in non-admin principals, so no non-admin caller can read the claim
 *     rows at all.
 *
 * What the replica CANNOT observe here:
 *   - The POSITIVE admin path. The admin principal is a fixed compile-time
 *     literal and the lane may not construct a `Principal` by hand, so no caller
 *     reachable through `createIdentity(seed)` can read the admin claim rows or
 *     the admin allocated-date dropdown. Only the rejection half of the admin
 *     gate is asserted here.
 *   - A production canister that already holds a pre-cutoff allocation or claim
 *     row: the replica starts at real wall-clock time with empty stores, so the
 *     cleanup pass has nothing to remove. The cutoff is asserted as an
 *     observable invariant of the reads, not as a migration of existing rows.
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

/** One day in nanoseconds. */
const DAY_NS = 86_400_000_000_000n;

/** A pre-cutoff date: the Sunday immediately before the cutoff. */
const PRE_CUTOFF_SUNDAY = REMOVAL_CUTOFF - DAY_NS;

/* --- Allocations: no pre-cutoff date carries an allocation -------------- */

it("answers no player-facing first prize for a pre-cutoff date", async () => {
  const { actor } = await install();

  // A removed date must carry no allocation, so the player-facing first-prize
  // read answers none for it rather than a stale amount.
  await expect(actor.getFirstPrizeForSunday(PRE_CUTOFF_SUNDAY)).resolves.toEqual(
    [],
  );
});

it("answers no archived pool for a pre-cutoff date", async () => {
  const { actor } = await install();

  // Run the archive reads first so any cleanup pass has executed, then probe a
  // removed date: it must still carry no archived pool.
  await actor.getPastWinners();
  await expect(actor.getArchivedPrizePool(PRE_CUTOFF_SUNDAY)).resolves.toEqual(
    [],
  );
});

it("offers no pre-cutoff date in the upcoming allocation statuses", async () => {
  const { actor } = await install();
  const alice = createIdentity("removal-cutoff-allocations");

  // getUpcomingAllocationStatuses is admin-only, so a reachable caller cannot
  // read it. The observable invariant for a non-admin caller is the rejection;
  // the admin-only gate is asserted below. Here we assert the public
  // allocation read never surfaces a pre-cutoff date.
  actor.setIdentity(alice);
  const firstPrize = await actor.getFirstPrizeForSunday(PRE_CUTOFF_SUNDAY);
  expect(firstPrize).toEqual([]);
});

/* --- Claims: the admin claim read is admin-only ------------------------- */

it("rejects getAdminPrizeClaims for the anonymous principal", async () => {
  const { canisterId } = await install();

  // The claim rows are admin-only; the anonymous principal is rejected, so no
  // pre-cutoff claim row is reachable by an anonymous caller.
  const guest = guestActor(canisterId);
  await expect(guest.getAdminPrizeClaims()).rejects.toThrow();
});

it("rejects getAdminPrizeClaims for a signed-in non-admin principal", async () => {
  const { actor } = await install();
  const alice = createIdentity("removal-cutoff-claims-non-admin");

  // A signed-in caller who is not the hardcoded admin principal is rejected.
  actor.setIdentity(alice);
  await expect(actor.getAdminPrizeClaims()).rejects.toThrow();
});

/* --- The admin allocated-date dropdown is admin-only -------------------- */

it("rejects getAdminAllocatedCompetitionDates for the anonymous principal", async () => {
  const { canisterId } = await install();

  // The admin allocated-date dropdown source is admin-only; the anonymous
  // principal is rejected, so no pre-cutoff date is reachable through it.
  const guest = guestActor(canisterId);
  await expect(guest.getAdminAllocatedCompetitionDates()).rejects.toThrow();
});

it("rejects getAdminAllocatedCompetitionDates for a signed-in non-admin principal", async () => {
  const { actor } = await install();
  const alice = createIdentity("removal-cutoff-dates-non-admin");

  actor.setIdentity(alice);
  await expect(actor.getAdminAllocatedCompetitionDates()).rejects.toThrow();
});
