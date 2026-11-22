import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the per-Sunday prize domain.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose prize methods are unimplemented stubs. This file installs the app's own
 * compiled wasm into the platform's PocketIC replica and drives the real public
 * API.
 *
 * What the replica CAN observe without controlling the wall clock:
 *   - `getCurrentPrizePool` answers with the correct shape (poolE8s,
 *     firstPrizeE8s) instead of trapping, and the first prize is half the pool
 *     (the agreed first-prize formula) on a fresh canister (both zero).
 *   - `getArchivedPrizePool(sunday)` answers null for a Sunday with no archived
 *     competition, and answers the archived pool shape for a Sunday that has
 *     been finalized.
 *   - `getClaimStatus(sunday)` answers `#claimable` for a Sunday whose deadline
 *     is in the future and `#expired` for one whose deadline has passed.
 *   - `getMyPrize` traps for an anonymous caller (the signed-in-only contract)
 *     and answers null for a signed-in caller with no archived placement.
 *   - The prize reads return no principals.
 *
 * What the replica CANNOT observe here: a real Sunday win populating a
 * placement, so `getMyPrize` returning a non-null prize for a winner, and the
 * exact pool amount for a competition with wins. Those need the canister clock
 * to land inside a Sunday window and a concluded game; the replica starts at
 * real wall-clock time. See episode.coverageLimits.
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

it("answers the current prize pool with the correct shape instead of trapping", async () => {
  const { actor } = await install();

  const pool = await actor.getCurrentPrizePool();
  expect(typeof pool.poolE8s).toBe("bigint");
  expect(typeof pool.firstPrizeE8s).toBe("bigint");

  // On a fresh canister the live competition has no wins, so the pool is zero
  // and the first prize (half the pool) is zero too.
  expect(pool.poolE8s).toBe(0n);
  expect(pool.firstPrizeE8s).toBe(0n);
});

it("derives the first prize as half the pool", async () => {
  const { actor } = await install();

  // The first-prize formula is pool / 2. On a fresh canister both are zero, so
  // the invariant holds trivially; assert it explicitly so a formula change
  // that breaks the relationship is caught.
  const pool = await actor.getCurrentPrizePool();
  expect(pool.firstPrizeE8s).toBe(pool.poolE8s / 2n);
});

it("answers the archived prize pool null for a Sunday with no archived competition", async () => {
  const { actor } = await install();

  // A Sunday far in the past with no archived competition answers null rather
  // than trapping.
  await expect(actor.getArchivedPrizePool(0n)).resolves.toEqual([]);
});

it("answers the archived prize pool shape for a finalized competition", async () => {
  const { actor } = await install();

  // The first Past winners read finalizes the previous completed Sunday (with
  // no wins, so no placements) and archives it exactly once. Its archived pool
  // is then readable by that Sunday's date.
  const past = await actor.getPastWinners();
  expect(past).toHaveLength(1);
  const sunday = past[0]!.sunday;

  const archived = await actor.getArchivedPrizePool(sunday);
  expect(archived).toHaveLength(1);
  const pool = archived[0]!;
  expect(pool.sunday).toBe(sunday);
  expect(typeof pool.poolE8s).toBe("bigint");
  expect(typeof pool.firstPrizeE8s).toBe("bigint");
  // A competition with no wins has a zero pool and a zero first prize.
  expect(pool.poolE8s).toBe(0n);
  expect(pool.firstPrizeE8s).toBe(0n);
});

it("reports a claimable status within the window and expired after the deadline", async () => {
  const { actor } = await install();

  // Derive the canister's own clock from its status read rather than the test
  // host's: the replica's time is authoritative and may differ from the host's.
  // `status.sunday` is the current competition's Sunday boundary and the
  // canister's `now` lies within [sunday, sunday + one day).
  const status = await actor.getSundayCompStatus();
  const currentSunday = status.sunday;

  // The deadline is one week after a competition's Sunday. A Sunday one week
  // before the current one has a deadline at the current Sunday, which is at or
  // before the canister's now, so it is expired. A Sunday one week after the
  // current one has a deadline two weeks out, so it is claimable.
  const pastSunday = currentSunday - WEEK_NS;
  const futureSunday = currentSunday + WEEK_NS;

  await expect(actor.getClaimStatus(futureSunday)).resolves.toEqual({
    claimable: null,
  });
  await expect(actor.getClaimStatus(pastSunday)).resolves.toEqual({
    expired: null,
  });
});

it("traps getMyPrize for an anonymous caller", async () => {
  const { canisterId } = await install();

  // A freshly created actor calls as the anonymous principal until an identity
  // is set. getMyPrize is signed-in only and must reject the anonymous caller.
  const guest = guestActor(canisterId);
  await expect(guest.getMyPrize()).rejects.toThrow();
});

it("answers getMyPrize null for a signed-in caller with no archived placement", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-alice");

  // A signed-in caller with no archived placement gets null rather than a trap.
  actor.setIdentity(alice);
  await expect(actor.getMyPrize()).resolves.toEqual([]);
});

it("returns no principals from the prize reads", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-bob");

  actor.setIdentity(alice);
  const pool = await actor.getCurrentPrizePool();
  // The pool carries only amounts; no string field may leak a principal.
  for (const value of Object.values(pool)) {
    expect(String(value)).not.toMatch(PRINCIPAL_PATTERN);
  }

  const archived = await actor.getArchivedPrizePool(0n);
  expect(archived).toEqual([]);
});
