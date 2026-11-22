import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the prize-claim surface added to the prize domain.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose claim methods are unimplemented stubs. This file installs the app's own
 * compiled wasm into the platform's PocketIC replica and drives the real public
 * API.
 *
 * What the replica CAN observe without controlling the wall clock:
 *   - `claimPrize(competition, rank, recipient)` traps for the anonymous
 *     principal (the signed-in-only contract) and, for a signed-in caller who
 *     does not own the place, answers a not-claimable result rather than
 *     trapping. A caller who owns no archived placement cannot be paid, so the
 *     ownership check is exercised on its rejection half.
 *   - `getAdminPrizeClaims()` traps for the anonymous principal and for a
 *     signed-in non-admin principal (the security-boundary acceptance
 *     criterion: the admin-only claims overview is rejected for every caller
 *     other than the hardcoded admin principal).
 *   - `setPrizeCanisterPrincipal(principal)` traps for the anonymous principal
 *     and for a signed-in non-admin principal.
 *   - The claim result carries no principal, and the admin claims overview is
 *     never reachable by a non-admin caller.
 *
 * What the replica CANNOT observe here:
 *   - The POSITIVE claim path. A real claim needs an archived placement owned by
 *     the caller, which needs the canister clock to land inside a competition
 *     window and a concluded game; the replica starts at real wall-clock time.
 *     So the paid / rejected / unknown state transitions, the synchronous paying
 *     lock, the double-click and two-simultaneous-claims races, the retry
 *     matching, and the amount coming from the stored prize are asserted only by
 *     the frontend cover against a mocked actor, not here.
 *   - The POSITIVE admin path. The admin principal is a fixed compile-time
 *     literal, and the lane may not construct a `Principal` by hand (the package
 *     that exports that class is not importable from the lane directory), so no
 *     caller reachable through `createIdentity(seed)` can present that exact
 *     principal. Only the rejection half of the admin gate is asserted here.
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

/* --- claimPrize: signed-in-only contract -------------------------------- */

it("traps claimPrize for the anonymous principal", async () => {
  const { canisterId } = await install();

  // A freshly created actor calls as the anonymous principal until an identity
  // is set. claimPrize is signed-in only and must reject the anonymous caller
  // before any ownership check.
  const guest = guestActor(canisterId);
  const recipient = createIdentity("prize-claim-recipient").getPrincipal();
  await expect(guest.claimPrize(0n, 1n, recipient)).rejects.toThrow();
});

it("answers a not-claimable result for a signed-in caller who owns no place", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-claim-non-owner");

  // A signed-in caller who does not own the archived place is rejected by the
  // ownership check with a not-claimable result rather than a trap. The place
  // is not paid and the caller is not charged.
  actor.setIdentity(alice);
  const recipient = createIdentity("prize-claim-non-owner-recipient").getPrincipal();
  const result = await actor.claimPrize(0n, 1n, recipient);

  // The result is a claimable state with no block index: the place was not
  // paid. The message is the not-claimable copy.
  expect(result.state).toEqual({ claimable: null });
  expect(result.blockIndex).toEqual([]);
  expect(result.amountE8s).toBe(0n);
});

it("returns no principal from a claimPrize result", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-claim-no-principal");

  actor.setIdentity(alice);
  const recipient = createIdentity("prize-claim-no-principal-recipient").getPrincipal();
  const result = await actor.claimPrize(0n, 1n, recipient);

  // The claim result carries only the state, the amount, the optional block
  // index and the optional message; no string field may leak a principal.
  for (const value of Object.values(result)) {
    expect(String(value)).not.toMatch(PRINCIPAL_PATTERN);
  }
});

/* --- getAdminPrizeClaims: admin-only rejection -------------------------- */

it("rejects getAdminPrizeClaims for the anonymous principal", async () => {
  const { canisterId } = await install();

  // The admin-only claims overview must reject the anonymous principal.
  const guest = guestActor(canisterId);
  await expect(guest.getAdminPrizeClaims()).rejects.toThrow();
});

it("rejects getAdminPrizeClaims for a signed-in non-admin principal", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-claims-non-admin");

  // A signed-in caller who is not the hardcoded admin principal is rejected.
  actor.setIdentity(alice);
  await expect(actor.getAdminPrizeClaims()).rejects.toThrow();
});

/* --- setPrizeCanisterPrincipal: admin-only rejection -------------------- */

it("rejects setPrizeCanisterPrincipal for the anonymous principal", async () => {
  const { canisterId } = await install();

  // The configurable prize-canister setter is admin-only; the anonymous
  // principal is rejected.
  const guest = guestActor(canisterId);
  const target = createIdentity("prize-canister-target").getPrincipal();
  await expect(guest.setPrizeCanisterPrincipal(target)).rejects.toThrow();
});

it("rejects setPrizeCanisterPrincipal for a signed-in non-admin principal", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-canister-non-admin");

  // A signed-in caller who is not the hardcoded admin principal is rejected.
  actor.setIdentity(alice);
  const target = createIdentity("prize-canister-non-admin-target").getPrincipal();
  await expect(actor.setPrizeCanisterPrincipal(target)).rejects.toThrow();
});
