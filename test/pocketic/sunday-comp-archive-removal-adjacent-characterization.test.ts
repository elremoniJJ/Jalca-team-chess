import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the backend competition archive, taken BEFORE four
 * archived competitions (4, 11, 15 and 18 October 2026) are removed from it.
 *
 * The request intentionally removes those four dates from the archive so no
 * archive-backed read returns them. This file deliberately does NOT assert that
 * any specific date is present or absent — that is the intentional change.
 *
 * What it protects is the behavior ADJACENT to the removal that must survive
 * it: the archive read contract the Past winners table and the other
 * archive-backed reads depend on.
 *
 *   - `getPastWinners` answers without trapping and returns rows whose shape is
 *     exactly the 2-place PastWinnerRow (a Sunday date, a winner and a
 *     runner-up, each with a name and a win count, and nothing else);
 *   - the rows are ordered newest first;
 *   - the read is idempotent: repeated reads do not add or drop rows, and a
 *     later read after another archive-backed read returns the same set;
 *   - no public row leaks a principal;
 *   - the other archive-backed reads (`getArchivedPrizePool`, `getMyPrize`)
 *     still answer for a finalized Sunday and still carry no principals.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose archive methods are unimplemented stubs. This file installs the app's
 * own compiled wasm into the platform's PocketIC replica and drives the real
 * public API.
 *
 * What the replica CANNOT observe without controlling the wall clock: a real
 * Sunday win populating a winner and runner-up, and the exact set of archived
 * dates a production canister holds. The replica starts at real wall-clock time
 * and archives only the previous completed competition. See
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

it("keeps the Past winners row to the 2-place shape after the removal", async () => {
  const actor = await install();

  // The first read finalizes the previous completed Sunday (with no wins, so no
  // winner) and archives exactly one row.
  const rows = await actor.getPastWinners();
  expect(rows).toHaveLength(1);

  const row = rows[0]!;
  // The public row carries exactly the 2-place fields: a Sunday date, a winner
  // and a runner-up, each with a name and a win count. Removing archived
  // competitions must not add, drop or rename a field.
  expect(Object.keys(row).sort()).toEqual([
    "runnerUpName",
    "runnerUpWins",
    "sunday",
    "winnerName",
    "winnerWins",
  ]);

  // The Sunday is a 00:00:00 UTC boundary.
  expect(row.sunday % 86_400_000_000_000n).toBe(0n);
});

it("orders the Past winners rows newest first", async () => {
  const actor = await install();

  const rows = await actor.getPastWinners();
  // Newest first: each row's Sunday is strictly earlier than the one before it.
  for (let i = 1; i < rows.length; i += 1) {
    expect(rows[i]!.sunday).toBeLessThan(rows[i - 1]!.sunday);
  }
});

it("keeps the Past winners read idempotent across repeated and interleaved reads", async () => {
  const actor = await install();

  // The first read finalizes the previous completed Sunday exactly once.
  const first = await actor.getPastWinners();
  const second = await actor.getPastWinners();
  expect(second.map((r) => r.sunday)).toEqual(first.map((r) => r.sunday));

  // Another archive-backed read must not add or drop a Past winners row.
  await actor.getSundayCompStandings(50n);
  const afterStandings = await actor.getPastWinners();
  expect(afterStandings.map((r) => r.sunday)).toEqual(
    first.map((r) => r.sunday),
  );
});

it("keeps the Past winners rows free of principals after the removal", async () => {
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

it("keeps the archived prize pool readable for a finalized Sunday with no principals", async () => {
  const actor = await install();

  // The first Past winners read finalizes the previous completed Sunday into
  // both archives. Its archived pool is then readable by that Sunday's date.
  const past = await actor.getPastWinners();
  expect(past).toHaveLength(1);
  const sunday = past[0]!.sunday;

  const archived = await actor.getArchivedPrizePool(sunday);
  expect(archived).toHaveLength(1);
  const pool = archived[0]!;
  // The archived pool carries exactly the three public fields: the Sunday date
  // and the two amounts. No principal field exists.
  expect(Object.keys(pool).sort()).toEqual([
    "firstPrizeE8s",
    "poolE8s",
    "sunday",
  ]);
  expect(pool.sunday).toBe(sunday);
});
