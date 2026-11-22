import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the two prize behaviors the frontend suite cannot see:
 *
 *   - the admin-only backend call `getAdminPrizeOverview` is rejected for every
 *     caller other than the hardcoded compile-time admin principal (the
 *     frontend admin panel is a display gate only; this backend check is the
 *     security boundary);
 *   - the parallel 10-place archive records up to ten placements per finalized
 *     Sunday and never returns a principal.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose prize methods are unimplemented stubs. This file installs the app's own
 * compiled wasm into the platform's PocketIC replica and drives the real public
 * API.
 *
 * What the replica CAN observe without controlling the wall clock:
 *   - `getAdminPrizeOverview` traps for the anonymous principal and for a
 *     signed-in non-admin principal (the security-boundary acceptance
 *     criterion: an admin-only backend call from a non-admin principal is
 *     rejected).
 *   - `getArchivedPrizePool(sunday)` answers the archived pool shape for a
 *     finalized Sunday, and the archived pool carries no principals.
 *   - `getMyPrize` answers null for a signed-in caller with no placement, and
 *     traps for the anonymous principal.
 *
 * What the replica CANNOT observe here:
 *   - The POSITIVE admin path. The admin principal is a fixed compile-time
 *     literal, and the lane may not construct a `Principal` by hand (the
 *     package that exports that class is not importable from the lane
 *     directory), so no caller reachable through `createIdentity(seed)` can
 *     present that exact principal. Only the rejection half of the admin gate
 *     is asserted here.
 *   - A real Sunday win populating a placement, so the 10-place archive's "up
 *     to ten placements" cap and the per-placement rank/name/wins values cannot
 *     be driven through the public API without the canister clock landing
 *     inside a Sunday window and a concluded game. The pure
 *     `SundayComp.topPlacements` cap is exercised only indirectly.
 * See episode.coverageLimits.
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

/* --- Admin-only backend call -------------------------------------------- */

it("rejects getAdminPrizeOverview for the anonymous principal", async () => {
  const { canisterId } = await install();

  // A freshly created actor calls as the anonymous principal until an identity
  // is set. The admin-only call must reject it.
  const guest = guestActor(canisterId);
  await expect(guest.getAdminPrizeOverview()).rejects.toThrow();
});

it("rejects getAdminPrizeOverview for a signed-in non-admin principal", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-non-admin");

  // A signed-in caller who is not the hardcoded admin principal is rejected.
  actor.setIdentity(alice);
  await expect(actor.getAdminPrizeOverview()).rejects.toThrow();
});

/* --- 10-place archive shape --------------------------------------------- */

it("answers the archived prize pool shape for a finalized Sunday with no principals", async () => {
  const { actor } = await install();

  // The first Past winners read finalizes the previous completed Sunday (with
  // no wins, so no placements) into both archives. Its archived pool is then
  // readable by that Sunday's date.
  const past = await actor.getPastWinners();
  expect(past).toHaveLength(1);
  const sunday = past[0]!.sunday;

  const archived = await actor.getArchivedPrizePool(sunday);
  expect(archived).toHaveLength(1);
  const pool = archived[0]!;
  // The archived pool carries exactly the three public fields: the Sunday date
  // and the two amounts. No principal field exists.
  expect(Object.keys(pool).sort()).toEqual([
    "firstPrizeE8s",
    "poolE8s",
    "sunday",
  ]);
  expect(pool.sunday).toBe(sunday);
  expect(pool.poolE8s).toBe(0n);
  expect(pool.firstPrizeE8s).toBe(0n);
});

it("answers the archived prize pool null for a Sunday with no archived competition", async () => {
  const { actor } = await install();

  // A Sunday far in the past with no archived competition answers null rather
  // than trapping.
  await expect(actor.getArchivedPrizePool(0n)).resolves.toEqual([]);
});

it("answers getMyPrize null for a signed-in caller with no placement and no principals", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-archive-alice");

  // A signed-in caller with no archived placement gets null rather than a trap.
  actor.setIdentity(alice);
  await expect(actor.getMyPrize()).resolves.toEqual([]);
});

it("traps getMyPrize for the anonymous principal", async () => {
  const { canisterId } = await install();

  // getMyPrize is signed-in only; the anonymous principal is rejected.
  const guest = guestActor(canisterId);
  await expect(guest.getMyPrize()).rejects.toThrow();
});
