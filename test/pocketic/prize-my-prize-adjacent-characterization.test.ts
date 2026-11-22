import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the `getMyPrize` surface ADJACENT to the paid-place
 * change, taken BEFORE the change.
 *
 * The request intentionally changes `getMyPrize` so it stops returning a place
 * whose claim has reached the paid state. Today it still returns that paid
 * place while the claim window is open. This file deliberately does NOT assert
 * the current (buggy) behavior — that a paid place is still returned — and it
 * does not assert the new skip behavior either. It pins the adjacent behavior
 * that must keep working through the change:
 *
 *   - `getMyPrize` still traps for the anonymous principal (the signed-in-only
 *     contract);
 *   - it still answers null for a signed-in caller with no archived placement;
 *   - it is an update call that finalizes the archive lazily and idempotently,
 *     so repeated reads for the same caller answer the same result and do not
 *     disturb the archive-backed reads;
 *   - its result carries no principal;
 *   - the archive-backed reads it shares finalization with (`getPastWinners`,
 *     `getArchivedPrizePool`) still answer their public shapes.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose claim methods are unimplemented stubs. This file installs the app's own
 * compiled wasm into the platform's PocketIC replica and drives the real public
 * API.
 *
 * What the replica CANNOT observe here: a real archived placement owned by the
 * caller, so the positive selection path — the newest-first walk, the
 * claim-window gate, and the paid-place skip the change introduces — needs the
 * canister clock to land inside a competition window and a concluded game. The
 * replica starts at real wall-clock time. See episode.coverageLimits.
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

/* --- Signed-in-only contract -------------------------------------------- */

it("traps getMyPrize for the anonymous principal", async () => {
  const { canisterId } = await install();

  // A freshly created actor calls as the anonymous principal until an identity
  // is set. getMyPrize is signed-in only and must reject the anonymous caller
  // before any archive read.
  const guest = guestActor(canisterId);
  await expect(guest.getMyPrize()).rejects.toThrow();
});

it("answers getMyPrize null for a signed-in caller with no archived placement", async () => {
  const { actor } = await install();
  const alice = createIdentity("my-prize-adjacent-alice");

  // A signed-in caller with no archived placement gets null rather than a trap.
  actor.setIdentity(alice);
  await expect(actor.getMyPrize()).resolves.toEqual([]);
});

/* --- Lazy, idempotent finalization on read ------------------------------ */

it("answers the same getMyPrize result across repeated reads", async () => {
  const { actor } = await install();
  const alice = createIdentity("my-prize-adjacent-idempotent");

  // getMyPrize is an update call that finalizes the archive lazily and
  // idempotently before reading. Repeated reads for the same caller must answer
  // the same result and must not add or drop an archived placement.
  actor.setIdentity(alice);
  const first = await actor.getMyPrize();
  const second = await actor.getMyPrize();
  expect(second).toEqual(first);
});

it("does not disturb the archive-backed reads it shares finalization with", async () => {
  const { actor } = await install();
  const alice = createIdentity("my-prize-adjacent-archive");

  // The first Past winners read finalizes the previous completed Sunday (with
  // no wins, so no placements) into both archives. A getMyPrize read must not
  // add or drop a Past winners row, and the archived pool must stay readable.
  const before = await actor.getPastWinners();
  expect(before).toHaveLength(1);

  actor.setIdentity(alice);
  await actor.getMyPrize();

  const after = await actor.getPastWinners();
  expect(after.map((r) => r.sunday)).toEqual(before.map((r) => r.sunday));

  const sunday = before[0]!.sunday;
  const archived = await actor.getArchivedPrizePool(sunday);
  expect(archived).toHaveLength(1);
  expect(archived[0]!.sunday).toBe(sunday);
});

/* --- No principal in the result ----------------------------------------- */

it("returns no principal from a getMyPrize result", async () => {
  const { actor } = await install();
  const alice = createIdentity("my-prize-adjacent-no-principal");

  actor.setIdentity(alice);
  const result = await actor.getMyPrize();

  // The result is an optional MyPrize; when present it carries only the Sunday,
  // the rank, the amount and the deadline. No string field may leak a principal.
  for (const prize of result) {
    for (const value of Object.values(prize)) {
      expect(String(value)).not.toMatch(PRINCIPAL_PATTERN);
    }
  }
});
