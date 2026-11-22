import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the stored-prize change to the prize-claim surface.
 *
 * The accepted change: a claim's amount is the prize stored for that exact rank
 * in the place record written at finalization (first prize divided by
 * 2^(rank-1), rounded down), never a value recomputed from the live allocation.
 * The archived place record gained a stored `prizeE8s` field, and the retry
 * branch re-verifies after the await that the place is still paying with the
 * same recipient and amount.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose claim methods are unimplemented stubs. This file installs the app's own
 * compiled wasm into the platform's PocketIC replica and drives the real public
 * API.
 *
 * What the replica CAN observe here:
 *   - The claim surface answers a not-claimable result (amount 0, no block
 *     index) for a signed-in caller who owns no archived placement, at EVERY
 *     rank 1..10, rather than trapping or paying. The rank-handling change must
 *     not open a rank that bypasses the ownership gate.
 *   - The claim result carries no principal at any rank.
 *   - `getMyPrize` traps for the anonymous principal and answers null for a
 *     signed-in caller with no archived placement.
 *   - `getClaimStatus` reports claimable within the deadline and expired after
 *     it, the deadline the stored amount is judged against.
 *
 * What the replica CANNOT observe here: a real archived placement owned by the
 * caller, so the positive claim path (the stored per-rank amount actually paid,
 * the paid/rejected/unknown transitions, the retry re-verification) needs the
 * canister clock to land inside a competition window and a concluded game, and
 * finalization to cross a competition boundary. See episode.coverageLimits.
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

/* --- Ownership gate across every rank ----------------------------------- */

it("answers a not-claimable result for a signed-in non-owner at every rank 1..10", async () => {
  const { actor } = await install();
  const alice = createIdentity("stored-amount-non-owner");

  // A signed-in caller who owns no archived placement is rejected by the
  // ownership check at every rank, with a not-claimable result rather than a
  // trap or a payment. The stored-amount change must not open a rank that
  // bypasses the ownership gate.
  actor.setIdentity(alice);
  const recipient = createIdentity("stored-amount-non-owner-recipient").getPrincipal();

  for (let rank = 1n; rank <= 10n; rank += 1n) {
    const result = await actor.claimPrize(0n, rank, recipient);
    expect(result.state).toEqual({ claimable: null });
    expect(result.blockIndex).toEqual([]);
    expect(result.amountE8s).toBe(0n);
  }
});

it("returns no principal from a not-claimable claim result at any rank", async () => {
  const { actor } = await install();
  const alice = createIdentity("stored-amount-no-principal");

  actor.setIdentity(alice);
  const recipient = createIdentity("stored-amount-no-principal-recipient").getPrincipal();

  for (let rank = 1n; rank <= 10n; rank += 1n) {
    const result = await actor.claimPrize(0n, rank, recipient);
    // The claim result carries only the state, the amount, the optional block
    // index and the optional message; no string field may leak a principal.
    for (const value of Object.values(result)) {
      expect(String(value)).not.toMatch(PRINCIPAL_PATTERN);
    }
  }
});

/* --- The caller's own prize --------------------------------------------- */

it("traps getMyPrize for the anonymous principal", async () => {
  const { canisterId } = await install();

  // getMyPrize is signed-in only; the anonymous principal is rejected.
  const guest = guestActor(canisterId);
  await expect(guest.getMyPrize()).rejects.toThrow();
});

it("answers getMyPrize null for a signed-in caller with no archived placement", async () => {
  const { actor } = await install();
  const alice = createIdentity("stored-amount-my-prize");

  // A signed-in caller with no archived placement gets null rather than a trap.
  actor.setIdentity(alice);
  await expect(actor.getMyPrize()).resolves.toEqual([]);
});

/* --- Claim status: the deadline the stored amount is judged against ------ */

it("reports a claimable status within the deadline and expired after it", async () => {
  const { actor } = await install();

  // Derive the canister's own clock from its status read rather than the test
  // host's: the replica's time is authoritative and may differ from the host's.
  const status = await actor.getSundayCompStatus();
  const currentSunday = status.sunday;

  // The deadline is the next competition start. A Sunday one week before the
  // current one has a deadline at or before the canister's now, so it is
  // expired; a Sunday one week after the current one has a deadline two weeks
  // out, so it is claimable.
  const pastSunday = currentSunday - WEEK_NS;
  const futureSunday = currentSunday + WEEK_NS;

  await expect(actor.getClaimStatus(futureSunday)).resolves.toEqual({
    claimable: null,
  });
  await expect(actor.getClaimStatus(pastSunday)).resolves.toEqual({
    expired: null,
  });
});
