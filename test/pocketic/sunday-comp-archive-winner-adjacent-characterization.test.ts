import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the backend competition archive, taken BEFORE the fix
 * that makes a finished competition with recorded wins archive its winner and
 * runner-up instead of an empty result.
 *
 * The request intentionally changes what a finished competition archives when
 * it had wins. This file deliberately does NOT assert that a specific winner is
 * recorded — that is the intentional change, and the replica cannot drive a
 * real win inside a competition window anyway.
 *
 * What it protects is the archive read contract ADJACENT to that fix, which the
 * Past winners table and the other archive-backed reads depend on:
 *
 *   - `getPastWinners` answers without trapping and returns rows whose shape is
 *     exactly the 2-place PastWinnerRow (a Sunday date, a winner and a
 *     runner-up, each with a name and a win count, and nothing else);
 *   - a competition with no wins archives no winner and no runner-up;
 *   - the read is idempotent: repeated reads do not add or drop rows, and a
 *     later read after another archive-backed read returns the same set;
 *   - the rows are ordered newest first;
 *   - no public row leaks a principal.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose archive methods are unimplemented stubs. This file installs the app's
 * own compiled wasm into the platform's PocketIC replica and drives the real
 * public API.
 *
 * What the replica CANNOT observe without controlling the wall clock: a real
 * win inside a competition window populating a winner and runner-up. The
 * replica starts at real wall-clock time and archives only the previous
 * completed competition, which has no wins. See episode.coverageLimits.
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

it("keeps the Past winners row to the 2-place shape", async () => {
  const actor = await install();

  // The first read finalizes the previous completed competition (with no wins,
  // so no winner) and archives exactly one row.
  const rows = await actor.getPastWinners();
  expect(rows).toHaveLength(1);

  const row = rows[0]!;
  // The public row carries exactly the 2-place fields: a Sunday date, a winner
  // and a runner-up, each with a name and a win count. The archive fix must not
  // add, drop or rename a field.
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

it("archives no winner and no runner-up for a competition with no wins", async () => {
  const actor = await install();

  // A fresh canister has no recorded wins, so the previous completed
  // competition archives with no winner and no runner-up. The fix must not
  // invent a winner for an empty competition.
  const rows = await actor.getPastWinners();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.winnerName).toEqual([]);
  expect(rows[0]?.winnerWins).toEqual([]);
  expect(rows[0]?.runnerUpName).toEqual([]);
  expect(rows[0]?.runnerUpWins).toEqual([]);
});

it("keeps the Past winners read idempotent across repeated and interleaved reads", async () => {
  const actor = await install();

  // The first read finalizes the previous completed competition exactly once.
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

it("orders the Past winners rows newest first", async () => {
  const actor = await install();

  const rows = await actor.getPastWinners();
  // Newest first: each row's Sunday is strictly earlier than the one before it.
  for (let i = 1; i < rows.length; i += 1) {
    expect(rows[i]!.sunday).toBeLessThan(rows[i - 1]!.sunday);
  }
});

it("keeps the Past winners rows free of principals", async () => {
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
