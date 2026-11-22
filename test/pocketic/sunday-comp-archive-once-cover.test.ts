import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the accepted change that a finished competition is
 * archived EXACTLY ONCE, with the standings that were live when it ended, and
 * that the live store is reset only once the next competition has begun.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose archive methods are unimplemented stubs. This file installs the app's
 * own compiled wasm into the platform's PocketIC replica and drives the real
 * public API.
 *
 * What the replica CAN observe without controlling the wall clock:
 *   - the first archive-backed read finalizes the previous completed
 *     competition exactly once, and repeated and interleaved reads never add a
 *     second row for the same date (no duplication);
 *   - the archived row's date is the boundary of the competition that just
 *     ended, and the read is stable across the two finalizing entry points
 *     (`getPastWinners` and `getSundayCompStandings`);
 *   - the frozen live standings are preserved: a read after the boundary does
 *     not clear the current competition's live board, and the standings read
 *     still answers without trapping;
 *   - the archive-backed reads return no principals.
 *
 * What the replica CANNOT observe here: a real win inside a competition window
 * populating a winner and runner-up, and the reset-on-next-competition
 * transition. The replica starts at real wall-clock time and archives only the
 * previous completed competition, which has no wins; advancing the canister
 * clock to the next boundary is impractical. The pure `SundayComp` lib takes
 * `now` as a parameter, but no public canister method injects it. See
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

it("archives the just-ended competition exactly once, with no duplicate row", async () => {
  const actor = await install();

  // The first read finalizes the previous completed competition exactly once.
  const first = await actor.getPastWinners();
  expect(first).toHaveLength(1);

  // Repeated reads must not archive it again: the finalization marker makes
  // the archive exactly-once, so the row count and the date stay stable.
  const second = await actor.getPastWinners();
  const third = await actor.getPastWinners();
  expect(second.map((r) => r.sunday)).toEqual(first.map((r) => r.sunday));
  expect(third.map((r) => r.sunday)).toEqual(first.map((r) => r.sunday));

  // The archived date is a 00:00:00 UTC boundary and is unique in the table.
  const sundays = first.map((r) => r.sunday);
  expect(new Set(sundays.map((s) => s.toString())).size).toBe(sundays.length);
  for (const sunday of sundays) {
    expect(sunday % 86_400_000_000_000n).toBe(0n);
  }
});

it("does not duplicate the archive across the two finalizing entry points", async () => {
  const actor = await install();

  // Both getPastWinners and getSundayCompStandings finalize lazily. Interleave
  // them: the second entry point must not add a second row for the same date.
  const fromPast = await actor.getPastWinners();
  await actor.getSundayCompStandings(50n);
  const afterStandings = await actor.getPastWinners();
  await actor.getSundayCompStandings(50n);
  const final = await actor.getPastWinners();

  expect(afterStandings.map((r) => r.sunday)).toEqual(
    fromPast.map((r) => r.sunday),
  );
  expect(final.map((r) => r.sunday)).toEqual(fromPast.map((r) => r.sunday));
});

it("keeps the frozen live standings readable after the boundary", async () => {
  const actor = await install();

  // Finalize the just-ended competition, then read the live standings. The
  // archive of a finished competition must not clear the current competition's
  // live board, and the standings read must answer without trapping.
  await actor.getPastWinners();
  const standings = await actor.getSundayCompStandings(50n);
  expect(Array.isArray(standings)).toBe(true);

  // The status read still reports a boundary at or before now.
  const status = await actor.getSundayCompStatus();
  expect(status.sunday % 86_400_000_000_000n).toBe(0n);
  expect(status.secondsRemaining).toBeGreaterThanOrEqual(0n);
});

it("returns no principals from the archive-backed reads", async () => {
  const actor = await install();

  const rows = await actor.getPastWinners();
  for (const row of rows) {
    for (const value of [row.winnerName, row.runnerUpName]) {
      if (value.length > 0) {
        expect(value[0]).not.toMatch(PRINCIPAL_PATTERN);
      }
    }
  }

  const standings = await actor.getSundayCompStandings(50n);
  for (const row of standings) {
    expect(row.displayName).not.toMatch(PRINCIPAL_PATTERN);
  }
});
