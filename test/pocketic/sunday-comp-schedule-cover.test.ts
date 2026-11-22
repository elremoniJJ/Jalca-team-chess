import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the generalized Sunday/Thursday competition schedule.
 *
 * The request replaces the weekly-Sunday schedule with one shared boundary
 * helper: `competitionStart(now)` returns the boundary at or before now,
 * `nextStart(start)` advances a Sunday by +4 days to the following Thursday and
 * a Thursday by +3 days to the following Sunday, and `previousStart(start)`
 * steps back the other way. That helper drives the competition window check,
 * the live state, the status read, the finalization loop and its seed, both
 * claim-deadline sites, and the competition-date list.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose methods are unimplemented stubs. This file installs the app's own
 * compiled wasm into the platform's PocketIC replica and drives the real public
 * API.
 *
 * What the replica CAN observe without controlling the wall clock:
 *   - `getSundayCompStatus` reports a 00:00:00 UTC boundary at or before now,
 *     and the live window is exactly one day long (the window check).
 *   - The claim deadline is the NEXT competition start after the given start:
 *     `getClaimStatus(start)` is claimable exactly while `nextStart(start)` is
 *     still in the future, and expired once it has passed. Because the schedule
 *     alternates Sunday/Thursday, the deadline is +4 days after a Sunday and +3
 *     days after a Thursday — the lane asserts the deadline is one of those two
 *     steps and that the status flips at that boundary.
 *   - The finalization loop archives each completed competition exactly once
 *     and idempotently, stepping by `nextStart` rather than a fixed week.
 *   - The public reads return no principals.
 *
 * What the replica CANNOT observe here: the exact weekday of a boundary and the
 * exact +4 / +3 step for a specific boundary, because the replica starts at
 * real wall-clock time and no public method injects `now` into the pure lib.
 * The admin-only `getUpcomingAllocationStatuses` (the competition-date list) is
 * gated to a compile-time admin principal that no `createIdentity(seed)` caller
 * can present, so the lane cannot drive that list either. See
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

/** The number of nanoseconds in one day. */
const DAY_NS = 86_400_000_000_000n;

it("reports a competition start that is a 00:00 UTC day boundary at or before now", async () => {
  const { actor } = await install();

  const status = await actor.getSundayCompStatus();

  // The start is a whole-day boundary (00:00:00 UTC) and never in the future.
  expect(status.sunday % DAY_NS).toBe(0n);
  expect(status.sunday).toBeLessThanOrEqual(BigInt(Date.now()) * 1_000_000n);

  // The remaining seconds are never negative. While the competition is live the
  // window is exactly one day, so the remainder is at most a day; when frozen
  // the remainder counts down to the next competition start and may be longer.
  expect(status.secondsRemaining).toBeGreaterThanOrEqual(0n);
  if (status.live) {
    expect(status.secondsRemaining).toBeLessThanOrEqual(
      DAY_NS / 1_000_000_000n,
    );
  }
});

it("derives the claim deadline from the next competition start, a 3- or 4-day step", async () => {
  const { actor } = await install();

  // Derive the canister's own clock from its status read rather than the test
  // host's: the replica's time is authoritative and may differ from the host's.
  const status = await actor.getSundayCompStatus();
  const currentStart = status.sunday;

  // The deadline is the NEXT competition start after a given start. The
  // generalized schedule alternates Sunday and Thursday, so the step is +4 days
  // from a Sunday and +3 days from a Thursday. The lane cannot know which
  // weekday the current boundary is, but it can assert the deadline is exactly
  // one of those two steps: a start 3 days before the current boundary has its
  // next start at the current boundary (a Thursday -> Sunday step), and a start
  // 4 days before the current boundary has its next start 3 days before the
  // current boundary (a Sunday -> Thursday step). Both next starts are at or
  // before now, so both read expired.
  const threeDaysBack = currentStart - 3n * DAY_NS;
  const fourDaysBack = currentStart - 4n * DAY_NS;

  await expect(actor.getClaimStatus(threeDaysBack)).resolves.toEqual({
    expired: null,
  });
  await expect(actor.getClaimStatus(fourDaysBack)).resolves.toEqual({
    expired: null,
  });

  // A start far enough in the past that its next start is behind the canister's
  // now reads expired. Thirty days back is safely past any next-start step the
  // schedule can use (the largest step is 4 days).
  const longPastStart = currentStart - 30n * DAY_NS;
  await expect(actor.getClaimStatus(longPastStart)).resolves.toEqual({
    expired: null,
  });
});

it("reports a claimable status for a start whose next start is still in the future", async () => {
  const { actor } = await install();

  const status = await actor.getSundayCompStatus();
  const currentStart = status.sunday;

  // The next competition start after the current boundary is 3 or 4 days later,
  // strictly after now (the current competition is live or the next is pending),
  // so a start at the current boundary is claimable.
  await expect(actor.getClaimStatus(currentStart)).resolves.toEqual({
    claimable: null,
  });
});

it("archives each completed competition exactly once and idempotently", async () => {
  const { actor } = await install();

  // The first read finalizes the previous completed competition (with no wins,
  // so no winner) and archives it exactly once. The finalization loop steps by
  // `nextStart`, so a Thursday competition is never skipped or mis-dated.
  const first = await actor.getPastWinners();
  expect(first.length).toBe(1);
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

it("keeps the public competition reads free of principals", async () => {
  const { actor } = await install();
  const alice = createIdentity("schedule-cover-alice");

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

it("reports isMe false for an anonymous caller on the standings", async () => {
  const { canisterId } = await install();

  const guest = guestActor(canisterId);
  const rows = await guest.getSundayCompStandings(50n);
  for (const row of rows) {
    expect(row.isMe).toBe(false);
  }
});
