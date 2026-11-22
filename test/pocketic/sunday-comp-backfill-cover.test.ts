import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the accepted change that backfills already-finished
 * competitions into the archive from an explicit winner, so the Past winners
 * table shows winner data where it previously showed dashes (the 22 Oct
 * competition with winner Ohmyohmy, and the 4/11/15/18 Oct entries where data
 * exists).
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose backfill method is an unimplemented stub. This file installs the app's
 * own compiled wasm into the platform's PocketIC replica and drives the real
 * public API.
 *
 * What the replica CAN observe without the admin principal:
 *   - `adminBackfillCompetition` traps for the anonymous principal and for a
 *     signed-in non-admin principal — the same security boundary the accepted
 *     change states for the admin-only manual finalize action, and the gate that
 *     protects the backfill write;
 *   - the public Past winners read still answers without trapping and keeps its
 *     2-place shape with no principal, so the backfill path cannot have changed
 *     the read contract;
 *   - a rejected backfill leaves the archive untouched: the Past winners rows
 *     are identical before and after the rejected call, so a non-admin cannot
 *     write an archive row.
 *
 * What the replica CANNOT observe here:
 *   - the POSITIVE backfill path: the admin principal is a fixed compile-time
 *     literal no `createIdentity(seed)` caller can present, so the backfill
 *     cannot be driven through the public API. The idempotency (a repeated
 *     backfill is a no-op) and the winner/runner-up/prize values it writes are
 *     therefore not exercised here;
 *   - the 22 Oct and 4/11/15/18 Oct rows themselves: those are seeded against
 *     live data, not reproducible from a fresh install.
 * See episode.coverageLimits.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

/** One competition day in nanoseconds. */
const DAY_NS = 86_400_000_000_000n;

/** Sunday 22 Oct 2026 00:00:00 UTC, in nanoseconds. */
const SUNDAY_22_OCT = 1_792_627_200_000_000_000n;

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

/** The 22 Oct backfill entry the accepted change describes. */
function backfillEntry() {
  return {
    sunday: SUNDAY_22_OCT,
    winnerName: "Ohmyohmy",
    winnerWins: 4n,
    runnerUpName: [] as [] | [string],
    runnerUpWins: [] as [] | [bigint],
  };
}

/* --- Admin-only backfill gate ------------------------------------------- */

it("rejects adminBackfillCompetition for the anonymous principal", async () => {
  const { canisterId } = await install();

  // A freshly created actor calls as the anonymous principal until an identity
  // is set. The admin-only backfill must reject it.
  const guest = guestActor(canisterId);
  const winner = createIdentity("backfill-anon-winner").getPrincipal();
  await expect(
    guest.adminBackfillCompetition(backfillEntry(), winner),
  ).rejects.toThrow();
});

it("rejects adminBackfillCompetition for a signed-in non-admin principal", async () => {
  const { actor } = await install();
  const alice = createIdentity("backfill-non-admin");
  const winner = createIdentity("backfill-non-admin-winner").getPrincipal();

  // A signed-in caller who is not the hardcoded admin principal is rejected.
  actor.setIdentity(alice);
  await expect(
    actor.adminBackfillCompetition(backfillEntry(), winner),
  ).rejects.toThrow();
});

it("leaves the archive untouched when a non-admin backfill is rejected", async () => {
  const { actor } = await install();
  const alice = createIdentity("backfill-untouched-non-admin");
  const winner = createIdentity("backfill-untouched-winner").getPrincipal();

  // The archive before the rejected write: the first read finalizes the
  // previous completed competition exactly once.
  const before = await actor.getPastWinners();
  expect(before).toHaveLength(1);

  // The rejected backfill must not write a row for the 22 Oct date.
  actor.setIdentity(alice);
  await expect(
    actor.adminBackfillCompetition(backfillEntry(), winner),
  ).rejects.toThrow();

  const after = await actor.getPastWinners();
  expect(after.map((r) => r.sunday)).toEqual(before.map((r) => r.sunday));
  expect(after.map((r) => r.sunday)).not.toContain(SUNDAY_22_OCT);
});

/* --- Public archive read contract --------------------------------------- */

it("keeps the Past winners row to the 2-place shape with no principal", async () => {
  const { actor } = await install();

  const rows = await actor.getPastWinners();
  expect(rows).toHaveLength(1);

  const row = rows[0]!;
  // The public row carries exactly the 2-place fields: a Sunday date, a winner
  // and a runner-up, each with a name and a win count. The backfill path must
  // not add, drop or rename a field.
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

  // Every archived date is a 00:00:00 UTC boundary.
  for (const r of rows) {
    expect(r.sunday % DAY_NS).toBe(0n);
  }
});
