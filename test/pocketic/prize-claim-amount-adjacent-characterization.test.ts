import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the prize-claim surface ADJACENT to the stored-amount
 * change, taken BEFORE the change.
 *
 * The request intentionally changes how a claim's amount is derived:
 *   - `storedAmount` currently recomputes the pool from the live archived wins
 *     and returns the first prize only for rank 1 (0 for every other rank);
 *   - after the fix it returns the stored per-rank prize for every rank, and the
 *     place record written at finalization gains a stored prize amount field.
 *
 * This file deliberately does NOT assert the current (buggy) amount behavior,
 * and it does not assert the new per-rank behavior either. It pins the adjacent
 * behavior that must keep working through the change:
 *
 *   - the ownership gate still rejects a signed-in caller who does not own the
 *     place, at EVERY rank 1..10, with a not-claimable result (amount 0, no
 *     block index) rather than a trap or a payment;
 *   - the claim result still carries no principal;
 *   - `getClaimStatus` still reports claimable within the deadline and expired
 *     after it (the deadline the amount surface is judged against);
 *   - `getFirstPrizeForSunday` still answers null for a Sunday with no
 *     allocation (the player view's only prize read);
 *   - `getMyPrize` still traps for the anonymous principal and answers null for
 *     a signed-in caller with no archived placement.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose claim methods are unimplemented stubs. This file installs the app's own
 * compiled wasm into the platform's PocketIC replica and drives the real public
 * API.
 *
 * What the replica CANNOT observe here: a real archived placement owned by the
 * caller, so the positive claim path (the stored amount actually paid, the
 * paid/rejected/unknown transitions, the retry matching) needs the canister
 * clock to land inside a competition window and a concluded game. See
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

/** The number of nanoseconds in one week. */
const WEEK_NS = 604_800_000_000_000n;

/* --- Ownership gate across every rank ----------------------------------- */

it("rejects a signed-in non-owner at every rank 1..10 with a not-claimable result", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-amount-non-owner");

  // A signed-in caller who owns no archived placement is rejected by the
  // ownership check at every rank, with a not-claimable result rather than a
  // trap or a payment. The rank-handling change must not open a rank that
  // bypasses the ownership gate.
  actor.setIdentity(alice);
  const recipient = createIdentity("prize-amount-non-owner-recipient").getPrincipal();

  for (let rank = 1n; rank <= 10n; rank += 1n) {
    const result = await actor.claimPrize(0n, rank, recipient);
    expect(result.state).toEqual({ claimable: null });
    expect(result.blockIndex).toEqual([]);
    expect(result.amountE8s).toBe(0n);
  }
});

it("returns no principal from a not-claimable claim result at any rank", async () => {
  const { actor } = await install();
  const alice = createIdentity("prize-amount-no-principal");

  actor.setIdentity(alice);
  const recipient = createIdentity("prize-amount-no-principal-recipient").getPrincipal();

  for (let rank = 1n; rank <= 10n; rank += 1n) {
    const result = await actor.claimPrize(0n, rank, recipient);
    // The claim result carries only the state, the amount, the optional block
    // index and the optional message; no string field may leak a principal.
    for (const value of Object.values(result)) {
      expect(String(value)).not.toMatch(PRINCIPAL_PATTERN);
    }
  }
});

/* --- Claim status: the deadline the amount is judged against ------------- */

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

/* --- Player-facing prize read ------------------------------------------- */

it("answers getFirstPrizeForSunday null for a Sunday with no allocation", async () => {
  const { actor } = await install();

  // The player view's only prize read: a Sunday with no allocation answers null
  // rather than trapping or inventing an amount.
  await expect(actor.getFirstPrizeForSunday(0n)).resolves.toEqual([]);
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
  const alice = createIdentity("prize-amount-my-prize");

  // A signed-in caller with no archived placement gets null rather than a trap.
  actor.setIdentity(alice);
  await expect(actor.getMyPrize()).resolves.toEqual([]);
});
