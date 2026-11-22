import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the paid-place skip added to `getMyPrize`.
 *
 * The accepted change: `Prize.myPrize` takes a fourth `isPaid` predicate and
 * skips a place whose claim is `#paid`, while still returning `#paying` places
 * and unclaimed places. `getMyPrize` builds that predicate from
 * `PrizeClaim.findClaim` and passes it in. Nothing else changes: `claimPrize`,
 * `lib/prize-claim.mo`, the prize canister calls, `lib/sunday-comp.mo`,
 * `recordWins`, `recordCompWins`, `loginRanked` and every stored type are
 * untouched, with no candid change and no migration.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose prize methods are unimplemented stubs. This file installs the app's own
 * compiled wasm into the platform's PocketIC replica and drives the real public
 * API.
 *
 * What the replica CAN observe here:
 *   - `getMyPrize` still traps for the anonymous principal (the signed-in-only
 *     contract is unchanged by the new predicate).
 *   - `getMyPrize` still answers null for a signed-in caller with no archived
 *     placement: the walk finds no place, so the predicate is never consulted
 *     and the result is unchanged.
 *   - The claim surface still answers a not-claimable result for a signed-in
 *     caller who owns no place, at every rank 1..10, rather than trapping or
 *     paying: the change must not open a rank that bypasses the ownership gate.
 *   - The claim result still carries no principal.
 *
 * What the replica CANNOT observe here: the POSITIVE paid-skip branch. Reaching
 * it needs an archived placement owned by the caller AND a stored claim in the
 * `#paid` state for that exact (competition, rank). Seeding an archived
 * placement requires `adminBackfillCompetition`, which is gated to the fixed
 * compile-time admin principal, and the lane may not construct a `Principal` by
 * hand (the package that exports that class is not importable from the lane
 * directory), so no caller reachable through `createIdentity(seed)` can present
 * that exact principal. A real placement also needs the canister clock to land
 * inside a competition window and a concluded game; the replica starts at real
 * wall-clock time. The paid-skip branch is therefore asserted only at the
 * frontend consumer seam against a mocked actor, not here. See
 * episode.coverageLimits.
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

/* --- getMyPrize: the signed-in-only contract is unchanged --------------- */

it("traps getMyPrize for the anonymous principal", async () => {
  const { canisterId } = await install();

  // A freshly created actor calls as the anonymous principal until an identity
  // is set. getMyPrize is signed-in only and must reject the anonymous caller
  // before the walk (and therefore before the new isPaid predicate) runs.
  const guest = guestActor(canisterId);
  await expect(guest.getMyPrize()).rejects.toThrow();
});

it("answers getMyPrize null for a signed-in caller with no archived placement", async () => {
  const { actor } = await install();
  const alice = createIdentity("paid-skip-my-prize");

  // A signed-in caller with no archived placement gets null rather than a trap.
  // The walk finds no place, so the new isPaid predicate is never consulted and
  // the result is exactly what it was before the change.
  actor.setIdentity(alice);
  await expect(actor.getMyPrize()).resolves.toEqual([]);
});

it("returns no principal from the getMyPrize result", async () => {
  const { actor } = await install();
  const alice = createIdentity("paid-skip-no-principal");

  actor.setIdentity(alice);
  const prize = await actor.getMyPrize();
  // The prize carries only the date, rank, amount and deadline; no string field
  // may leak a principal.
  expect(prize).toEqual([]);
  for (const value of Object.values(prize)) {
    expect(String(value)).not.toMatch(PRINCIPAL_PATTERN);
  }
});

/* --- The claim surface the predicate reads is unchanged ----------------- */

it("answers a not-claimable result for a signed-in non-owner at every rank 1..10", async () => {
  const { actor } = await install();
  const alice = createIdentity("paid-skip-non-owner");

  // The change must not open a rank that bypasses the ownership gate: a
  // signed-in caller who owns no archived placement is rejected at every rank
  // with a not-claimable result rather than a trap or a payment.
  actor.setIdentity(alice);
  const recipient = createIdentity("paid-skip-non-owner-recipient").getPrincipal();

  for (let rank = 1n; rank <= 10n; rank += 1n) {
    const result = await actor.claimPrize(0n, rank, recipient);
    expect(result.state).toEqual({ claimable: null });
    expect(result.blockIndex).toEqual([]);
    expect(result.amountE8s).toBe(0n);
  }
});

it("returns no principal from a not-claimable claim result", async () => {
  const { actor } = await install();
  const alice = createIdentity("paid-skip-claim-no-principal");

  actor.setIdentity(alice);
  const recipient = createIdentity("paid-skip-claim-no-principal-recipient").getPrincipal();
  const result = await actor.claimPrize(0n, 1n, recipient);

  // The claim result carries only the state, the amount, the optional block
  // index and the optional message; no string field may leak a principal.
  for (const value of Object.values(result)) {
    expect(String(value)).not.toMatch(PRINCIPAL_PATTERN);
  }
});
