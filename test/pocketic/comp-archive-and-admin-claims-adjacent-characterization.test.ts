import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane characterization of the archive and admin-claims behavior
 * ADJACENT to the accepted change, taken BEFORE the archive/claims rework.
 *
 * The request intentionally changes:
 *   - which competitions are archived (only those with a confirmed prize pool);
 *   - which dates appear in the archives, allocations and claims (nothing
 *     before Sunday 1 Nov 2026);
 *   - the admin prize-claims area (a date dropdown with a per-date detail).
 *
 * This file deliberately does NOT assert any of those intentional changes. It
 * protects the behavior that must SURVIVE them:
 *
 *   - `getPastWinners` still answers without trapping, still orders rows newest
 *     first, still returns no principal, and is idempotent across repeated and
 *     interleaved reads;
 *   - `getAdminPrizeClaims` still rejects the anonymous principal and a
 *     signed-in non-admin principal (the admin-only security boundary).
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose archive methods are unimplemented stubs. This file installs the app's
 * own compiled wasm into the platform's PocketIC replica and drives the real
 * public API.
 *
 * What the replica CANNOT observe here: a real Sunday win populating a winner
 * and runner-up, and the POSITIVE admin path (the admin principal is a fixed
 * compile-time literal that no `createIdentity(seed)` caller can present). See
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

/* --- getPastWinners: ordering, principal-free, idempotent ---------------- */

it("answers the Past winners read without trapping", async () => {
  const { actor } = await install();

  // The first read finalizes the previous completed competition lazily. The
  // archive read must answer rather than trap.
  const rows = await actor.getPastWinners();
  expect(Array.isArray(rows)).toBe(true);
});

it("orders Past winners newest first", async () => {
  const { actor } = await install();

  const rows = await actor.getPastWinners();
  // Each row's Sunday is strictly earlier than the one before it.
  for (let i = 1; i < rows.length; i += 1) {
    expect(rows[i]!.sunday).toBeLessThan(rows[i - 1]!.sunday);
  }
});

it("returns no principal from the Past winners read", async () => {
  const { actor } = await install();

  const rows = await actor.getPastWinners();
  for (const row of rows) {
    for (const value of [row.winnerName, row.runnerUpName]) {
      if (value.length > 0) {
        expect(value[0]).not.toMatch(PRINCIPAL_PATTERN);
      }
    }
  }
});

it("keeps the Past winners read idempotent across repeated and interleaved reads", async () => {
  const { actor } = await install();

  const first = await actor.getPastWinners();
  const second = await actor.getPastWinners();
  expect(second.map((r) => r.sunday)).toEqual(first.map((r) => r.sunday));

  // Another archive-backed read must not change the archive contents.
  await actor.getSundayCompStandings(50n);
  const afterStandings = await actor.getPastWinners();
  expect(afterStandings.map((r) => r.sunday)).toEqual(first.map((r) => r.sunday));
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
  const alice = createIdentity("comp-archive-claims-non-admin");

  // A signed-in caller who is not the hardcoded admin principal is rejected.
  actor.setIdentity(alice);
  await expect(actor.getAdminPrizeClaims()).rejects.toThrow();
});
