import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the EXISTING 2-place Sunday-comp archive, taken BEFORE a
 * parallel 10-place archive store is added alongside it.
 *
 * The request intentionally adds a NEW 10-place archive store and states that
 * the existing 2-place `compArchiveStore` keeps its shape and behavior and that
 * the Past winners table is unchanged. This file pins the adjacent invariant
 * most at risk from that addition: the public Past winners row still carries
 * exactly the 2-place shape — a Sunday date, a winner and a runner-up, each
 * with a name and a win count, and nothing else. A third placement, a
 * principal, or a renamed field would break the existing table contract.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose archive methods are unimplemented stubs. This file installs the app's
 * own compiled wasm into the platform's PocketIC replica and drives the real
 * public API.
 *
 * What the replica CAN observe without controlling the wall clock: the archive
 * read answers without trapping, finalizes the previous completed Sunday
 * lazily, and returns rows whose shape is exactly the 2-place PastWinnerRow.
 * What it CANNOT observe here: a real Sunday win populating a winner and
 * runner-up, which needs the canister clock to land inside a Sunday window.
 * See episode.coverageLimits.
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

/** Install a fresh canister and return its actor. */
async function install(): Promise<_SERVICE> {
  if (pic === undefined) throw new Error("PocketIC not initialized");
  const { actor } = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  });
  return actor;
}

/** A realistic principal-shaped token (five dash-separated base32 groups). */
const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

it("keeps the Past winners row to the 2-place shape with no third placement", async () => {
  const actor = await install();

  // The first read finalizes the previous completed Sunday (with no wins, so no
  // winner) and archives exactly one row.
  const rows = await actor.getPastWinners();
  expect(rows).toHaveLength(1);

  const row = rows[0]!;
  // The public row carries exactly the 2-place fields: a Sunday date, a winner
  // and a runner-up, each with a name and a win count. A parallel 10-place
  // store must not add a third placement or rename these fields.
  expect(Object.keys(row).sort()).toEqual([
    "runnerUpName",
    "runnerUpWins",
    "sunday",
    "winnerName",
    "winnerWins",
  ]);

  // The Sunday is a 00:00:00 UTC boundary.
  expect(row.sunday % 86_400_000_000_000n).toBe(0n);

  // A competition with no wins archives no winner and no runner-up.
  expect(row.winnerName).toEqual([]);
  expect(row.winnerWins).toEqual([]);
  expect(row.runnerUpName).toEqual([]);
  expect(row.runnerUpWins).toEqual([]);
});

it("keeps the Past winners row free of principals", async () => {
  const actor = await install();

  const rows = await actor.getPastWinners();
  for (const row of rows) {
    for (const value of [row.winnerName, row.runnerUpName]) {
      if (value.length > 0) {
        expect(value[0]).not.toMatch(PRINCIPAL_PATTERN);
      }
    }
  }
});
