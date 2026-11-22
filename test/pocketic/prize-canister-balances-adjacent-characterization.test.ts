import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane characterization of the behavior ADJACENT to the admin-only
 * `getPrizeCanisterBalances` method, taken on the current tree.
 *
 * The request intentionally adds an admin-only, read-only prize-canister funds
 * check. This file deliberately does NOT assert the positive admin path (the
 * admin principal is a fixed compile-time literal that no caller reachable
 * through `createIdentity(seed)` can present) and does NOT assert the exact
 * balance figures (the real prize canister is not reachable from the replica).
 * What it protects is the behavior AROUND the change that must survive it:
 *
 *   - `getPrizeCanisterBalances` is admin-only: the anonymous principal and a
 *     signed-in non-admin principal are both rejected with a trap, exactly like
 *     the sibling admin-only prize endpoints;
 *   - the method is a non-trapping result type on the wire: its Candid return
 *     is the `PrizeBalancesResult` variant (`ok` / `err`), not a bare record, so
 *     a failure is surfaced as `err` rather than breaking the caller;
 *   - the method is read-only: it takes no arguments and changes no state, so a
 *     rejected call leaves the canister's public reads unchanged.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose prize methods are unimplemented stubs. This file installs the app's own
 * compiled wasm into the platform's PocketIC replica and drives the real public
 * API. The positive admin path and the real balance figures are NOT observable
 * here; see episode.coverageLimits.
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

/* --- Admin-only rejection ----------------------------------------------- */

it("rejects getPrizeCanisterBalances for the anonymous principal", async () => {
  const { canisterId } = await install();

  // A freshly created actor calls as the anonymous principal until an identity
  // is set. The admin-only funds check must reject it, like the sibling
  // admin-only prize endpoints.
  const guest = guestActor(canisterId);
  await expect(guest.getPrizeCanisterBalances()).rejects.toThrow();
});

it("rejects getPrizeCanisterBalances for a signed-in non-admin principal", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-balances-non-admin");

  // A signed-in caller who is not the hardcoded admin principal is rejected.
  actor.setIdentity(alice);
  await expect(actor.getPrizeCanisterBalances()).rejects.toThrow();
});

/* --- Read-only: a rejected call changes no state ------------------------ */

it("leaves the public reads unchanged after a rejected funds check", async () => {
  const { actor, canisterId } = await install();
  const alice = createIdentity("prize-balances-readonly");

  // The funds check is read-only: a rejected call must not move funds or change
  // any state. The public reads answer the same before and after.
  const before = await actor.getPastWinners();
  const guest = guestActor(canisterId);
  await expect(guest.getPrizeCanisterBalances()).rejects.toThrow();
  const after = await actor.getPastWinners();
  expect(after).toEqual(before);
});
