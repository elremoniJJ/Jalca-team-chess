import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the Sunday-competition feature.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose Sunday-comp methods are unimplemented stubs. This file installs the
 * app's own compiled wasm into the platform's PocketIC replica and drives the
 * real public API.
 *
 * What the replica CAN observe without controlling the wall clock:
 *   - `getSundayCompStatus` answers with the correct shape (live, sunday,
 *     secondsRemaining) instead of trapping, and its `sunday` is a Sunday
 *     00:00:00 UTC boundary at or before now.
 *   - `getSundayCompStandings` answers empty on a fresh canister, caps the
 *     limit at 50, returns no principals, and reports `isMe` false for an
 *     anonymous caller.
 *   - `getPastWinners` answers without trapping, returns no principals, and
 *     finalizes lazily and idempotently: the first read archives the previous
 *     completed Sunday exactly once, and repeated reads do not add rows.
 *   - A competition with no wins archives no winner (the archived row carries
 *     no winner name).
 *
 * What the replica CANNOT observe here: the Sunday-window boundary rules
 * (00:00:00 / 23:59:59 / Saturday / Monday conclusions), the tie-break order,
 * the reset-on-new-Sunday, and a real Sunday win. Those need the canister clock
 * to land inside a Sunday window; the replica starts at real wall-clock time
 * and advancing to the next Sunday is impractical. The pure `SundayComp` lib
 * takes `now` as a parameter, but no public canister method injects it, so the
 * lane cannot drive those cases. See episode.coverageLimits.
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

it("answers the Sunday comp status with the correct shape instead of trapping", async () => {
  const { actor } = await install();

  const status = await actor.getSundayCompStatus();
  expect(typeof status.live).toBe("boolean");
  expect(typeof status.sunday).toBe("bigint");
  expect(typeof status.secondsRemaining).toBe("bigint");

  // The reported Sunday is a 00:00:00 UTC boundary at or before now, and the
  // remaining seconds are non-negative.
  expect(status.sunday % 86_400_000_000_000n).toBe(0n);
  expect(status.secondsRemaining).toBeGreaterThanOrEqual(0n);
});

it("answers the Sunday standings empty on a fresh canister", async () => {
  const { actor } = await install();

  await expect(actor.getSundayCompStandings(50n)).resolves.toEqual([]);
});

it("caps the Sunday standings limit at 50 server-side", async () => {
  const { actor } = await install();

  // Requesting more than 50 rows must not trap; the server caps the response.
  const rows = await actor.getSundayCompStandings(1000n);
  expect(rows.length).toBeLessThanOrEqual(50);
});

it("reports isMe false for an anonymous caller on the Sunday standings", async () => {
  const { actor, canisterId } = await install();

  // The anonymous caller sees the standings but is never "me".
  const guest = guestActor(canisterId);
  const rows = await guest.getSundayCompStandings(50n);
  for (const row of rows) {
    expect(row.isMe).toBe(false);
  }
  // The call itself must not trap for an anonymous caller.
  await expect(actor.getSundayCompStandings(50n)).resolves.toEqual([]);
});

it("answers the Past winners read without trapping and returns no principals", async () => {
  const { actor } = await install();

  const rows = await actor.getPastWinners();
  expect(Array.isArray(rows)).toBe(true);
  for (const row of rows) {
    // The public row carries no principal field at all; no string field may
    // leak a principal-shaped token.
    for (const value of [
      row.winnerName,
      row.runnerUpName,
    ]) {
      if (value.length > 0) {
        expect(value[0]).not.toMatch(PRINCIPAL_PATTERN);
      }
    }
  }
});

it("finalizes the previous competition lazily and idempotently on the first read", async () => {
  const { actor } = await install();

  // The first read finalizes the previous completed Sunday (with no wins, so
  // no winner) and archives it exactly once.
  const first = await actor.getPastWinners();
  expect(first.length).toBe(1);
  // A competition with no wins archives no winner.
  expect(first[0]?.winnerName).toEqual([]);
  expect(first[0]?.runnerUpName).toEqual([]);

  // Repeated reads do not archive it again: the marker makes finalization
  // exactly-once.
  const second = await actor.getPastWinners();
  expect(second.length).toBe(1);
  const third = await actor.getPastWinners();
  expect(third.length).toBe(1);

  // The standings read also finalizes lazily; it must not add a second archive
  // row for the same competition.
  await actor.getSundayCompStandings(50n);
  const afterStandings = await actor.getPastWinners();
  expect(afterStandings.length).toBe(1);
});

it("keeps the Sunday standings and Past winners free of principals for a signed-in caller", async () => {
  const { actor } = await install();
  const alice = createIdentity("sunday-alice");

  // A signed-in caller reads both public surfaces; neither may leak a
  // principal-shaped token.
  actor.setIdentity(alice);
  const standings = await actor.getSundayCompStandings(50n);
  const past = await actor.getPastWinners();

  for (const row of standings) {
    expect(row.displayName).not.toMatch(PRINCIPAL_PATTERN);
  }
  for (const row of past) {
    for (const value of [row.winnerName, row.runnerUpName]) {
      if (value.length > 0) {
        expect(value[0]).not.toMatch(PRINCIPAL_PATTERN);
      }
    }
  }
});
