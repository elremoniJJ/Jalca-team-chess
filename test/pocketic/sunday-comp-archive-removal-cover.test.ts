import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the accepted change that permanently removes four
 * archived competitions — 4, 11, 15 and 18 October 2026 (UTC) — from the
 * backend competition archive.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose archive methods are unimplemented stubs. This file installs the app's
 * own compiled wasm into the platform's PocketIC replica and drives the real
 * public API.
 *
 * What the replica CAN observe without controlling the wall clock:
 *   - no archive-backed read returns one of the four removed dates;
 *   - the removal is idempotent across repeated and interleaved reads;
 *   - the other archived competitions are unaffected: the Past winners read
 *     still answers, still orders newest first, and still carries no principal.
 *
 * What the replica CANNOT observe here: a production canister that already
 * holds the four removed dates in its archive, and a later finalization or
 * canister upgrade re-archiving them. The replica starts at real wall-clock
 * time and archives only the previous completed competition, so the four
 * removed dates are never present to begin with. See episode.coverageLimits.
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

/**
 * The four permanently removed competition dates, as their 00:00:00 UTC
 * nanosecond boundaries: 4, 11, 15 and 18 October 2026. 1970-01-01 was a
 * Thursday, so day mod 7 == 3 is a Sunday and day mod 7 == 0 is a Thursday:
 * 20730 (Sun 4 Oct), 20737 (Sun 11 Oct), 20741 (Thu 15 Oct) and 20744
 * (Sun 18 Oct).
 */
const REMOVED_DATES: bigint[] = [
  20_730n * 86_400_000_000_000n,
  20_737n * 86_400_000_000_000n,
  20_741n * 86_400_000_000_000n,
  20_744n * 86_400_000_000_000n,
];

/** A realistic principal-shaped token (five dash-separated base32 groups). */
const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

it("returns none of the four removed dates from the Past winners read", async () => {
  const actor = await install();

  // The first read finalizes the previous completed Sunday and archives it.
  const rows = await actor.getPastWinners();
  const sundays = rows.map((row) => row.sunday);
  for (const removed of REMOVED_DATES) {
    expect(sundays).not.toContain(removed);
  }
});

it("returns none of the four removed dates from the archived prize pool read", async () => {
  const actor = await install();

  // Finalize the archive, then probe each removed date's archived pool. A
  // removed competition must not be readable by its date.
  await actor.getPastWinners();
  for (const removed of REMOVED_DATES) {
    const archived = await actor.getArchivedPrizePool(removed);
    expect(archived).toEqual([]);
  }
});

it("keeps the removal idempotent across repeated and interleaved reads", async () => {
  const actor = await install();

  const first = await actor.getPastWinners();
  const second = await actor.getPastWinners();
  expect(second.map((r) => r.sunday)).toEqual(first.map((r) => r.sunday));

  // Another archive-backed read must not re-introduce a removed date.
  await actor.getSundayCompStandings(50n);
  const afterStandings = await actor.getPastWinners();
  for (const removed of REMOVED_DATES) {
    expect(afterStandings.map((r) => r.sunday)).not.toContain(removed);
  }
});

it("leaves the other archived competitions intact, newest first and principal-free", async () => {
  const actor = await install();

  const rows = await actor.getPastWinners();
  // The removal must not empty the archive: the previous completed Sunday is
  // still archived.
  expect(rows.length).toBeGreaterThanOrEqual(1);

  // Newest first: each row's Sunday is strictly earlier than the one before it.
  for (let i = 1; i < rows.length; i += 1) {
    expect(rows[i]!.sunday).toBeLessThan(rows[i - 1]!.sunday);
  }

  // No public row leaks a principal.
  for (const row of rows) {
    for (const value of [row.winnerName, row.runnerUpName]) {
      if (value.length > 0) {
        expect(value[0]).not.toMatch(PRINCIPAL_PATTERN);
      }
    }
  }
});
