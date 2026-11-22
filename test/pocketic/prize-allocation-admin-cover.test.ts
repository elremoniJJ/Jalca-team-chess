import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the admin allocation controls added to the prize
 * domain.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose allocation methods are unimplemented stubs. This file installs the
 * app's own compiled wasm into the platform's PocketIC replica and drives the
 * real public API.
 *
 * What the replica CAN observe without controlling the wall clock:
 *   - `getFirstPrizeForSunday(sunday)` is a public read: it answers null for a
 *     Sunday with no allocation instead of trapping, and returns no principal.
 *   - The four admin-only allocation methods — `getUpcomingAllocationStatuses`,
 *     `previewPrizeAllocation`, `savePrizeAllocation` and
 *     `clearPrizeAllocation` — reject the anonymous principal and a signed-in
 *     non-admin principal with a trap. This is the security-boundary acceptance
 *     criterion: every admin save and clear checks caller == prizeAdmin() in
 *     the backend and rejects anonymous and non-admin callers.
 *
 * What the replica CANNOT observe here:
 *   - The POSITIVE admin path. The admin principal is a fixed compile-time
 *     literal, and the lane may not construct a `Principal` by hand (the
 *     package that exports that class is not importable from the lane
 *     directory), so no caller reachable through `createIdentity(seed)` can
 *     present that exact principal. Only the rejection half of the admin gate
 *     is asserted here, so a successful save/clear and the resulting allocation
 *     status cannot be driven through the public API.
 *   - The Sunday-window rules (a started Sunday traps) and the pool rejections
 *     (too small for fees, rank-10 rounds to zero, above 20 ICP), because both
 *     are reached only after the admin gate, which no reachable caller passes.
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

/** A realistic principal-shaped token (five dash-separated base32 groups). */
const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

/** The number of nanoseconds in one week. */
const WEEK_NS = 604_800_000_000_000n;

/* --- Public player-facing read ------------------------------------------ */

it("answers getFirstPrizeForSunday null for a Sunday with no allocation", async () => {
  const { actor } = await install();

  // A Sunday far in the future with no allocation answers null rather than
  // trapping. This is the only prize figure the player view reads.
  await expect(actor.getFirstPrizeForSunday(0n)).resolves.toEqual([]);
});

it("answers getFirstPrizeForSunday without trapping for an upcoming Sunday", async () => {
  const { actor } = await install();

  // Derive the canister's own clock from its status read rather than the test
  // host's: the replica's time is authoritative. The next Sunday boundary is
  // strictly after now, so it is a valid upcoming Sunday with no allocation.
  const status = await actor.getSundayCompStatus();
  const nextSunday = status.sunday + WEEK_NS;

  await expect(actor.getFirstPrizeForSunday(nextSunday)).resolves.toEqual([]);
});

it("returns no principal from getFirstPrizeForSunday", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-alloc-reader");

  actor.setIdentity(alice);
  const firstPrize = await actor.getFirstPrizeForSunday(0n);
  // The read carries only an optional amount; no string field may leak a
  // principal-shaped token.
  for (const value of firstPrize) {
    expect(String(value)).not.toMatch(PRINCIPAL_PATTERN);
  }
});

/* --- Admin-only allocation methods: anonymous rejection ----------------- */

it("rejects getUpcomingAllocationStatuses for the anonymous principal", async () => {
  const { canisterId } = await install();

  // A freshly created actor calls as the anonymous principal until an identity
  // is set. The admin-only call must reject it.
  const guest = guestActor(canisterId);
  await expect(guest.getUpcomingAllocationStatuses()).rejects.toThrow();
});

it("rejects previewPrizeAllocation for the anonymous principal", async () => {
  const { canisterId } = await install();

  const guest = guestActor(canisterId);
  await expect(guest.previewPrizeAllocation(1_000_000_000n)).rejects.toThrow();
});

it("rejects savePrizeAllocation for the anonymous principal", async () => {
  const { canisterId } = await install();

  const guest = guestActor(canisterId);
  await expect(
    guest.savePrizeAllocation(0n, 1_000_000_000n),
  ).rejects.toThrow();
});

it("rejects clearPrizeAllocation for the anonymous principal", async () => {
  const { canisterId } = await install();

  const guest = guestActor(canisterId);
  await expect(guest.clearPrizeAllocation(0n)).rejects.toThrow();
});

/* --- Admin-only allocation methods: non-admin rejection ----------------- */

it("rejects getUpcomingAllocationStatuses for a signed-in non-admin principal", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-alloc-non-admin");

  // A signed-in caller who is not the hardcoded admin principal is rejected.
  actor.setIdentity(alice);
  await expect(actor.getUpcomingAllocationStatuses()).rejects.toThrow();
});

it("rejects previewPrizeAllocation for a signed-in non-admin principal", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-alloc-non-admin-preview");

  actor.setIdentity(alice);
  await expect(actor.previewPrizeAllocation(1_000_000_000n)).rejects.toThrow();
});

it("rejects savePrizeAllocation for a signed-in non-admin principal", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-alloc-non-admin-save");

  actor.setIdentity(alice);
  await expect(
    actor.savePrizeAllocation(0n, 1_000_000_000n),
  ).rejects.toThrow();
});

it("rejects clearPrizeAllocation for a signed-in non-admin principal", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-alloc-non-admin-clear");

  actor.setIdentity(alice);
  await expect(actor.clearPrizeAllocation(0n)).rejects.toThrow();
});
