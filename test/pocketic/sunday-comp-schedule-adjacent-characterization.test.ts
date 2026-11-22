import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the EXISTING Sunday-only competition schedule, taken
 * BEFORE the schedule is generalized to alternating Sundays and Thursdays.
 *
 * The request intentionally changes the schedule: one shared boundary helper
 * will return the competition start at or before now, the next start after a
 * given start, and the previous start, with Sunday giving Thursday (+4 days)
 * and Thursday giving Sunday (+3 days). That helper will drive the competition
 * window check, the live state, the status read, the finalization loop and its
 * seed, both claim-deadline sites, and the competition-date list.
 *
 * This file deliberately does NOT pin the Sunday-only cadence (a fixed
 * seven-day step, a Sunday weekday, or a one-week claim deadline) as correct —
 * those are exactly what the request changes. What it protects is the
 * schedule-INDEPENDENT contract that must survive the generalization:
 *
 *   - the reported competition start is a 00:00:00 UTC day boundary at or
 *     before the canister's now, and the live window is exactly one day long;
 *   - the status read answers the correct shape (live, sunday,
 *     secondsRemaining) instead of trapping, with a non-negative remainder;
 *   - the claim deadline is the NEXT competition start after the given start,
 *     so a start whose deadline is in the future reads claimable and one whose
 *     deadline has passed reads expired;
 *   - the finalization loop archives each completed competition exactly once
 *     and is idempotent across repeated reads;
 *   - the public reads return no principals.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose methods are unimplemented stubs. This file installs the app's own
 * compiled wasm into the platform's PocketIC replica and drives the real public
 * API.
 *
 * What the replica CANNOT observe here: the exact Sunday/Thursday weekday of a
 * boundary, the +4 / +3 day step, and a real win inside a competition window.
 * Those need the canister clock to land on a specific weekday; the replica
 * starts at real wall-clock time and the pure lib's `now` is not injectable
 * through any public method. See episode.coverageLimits.
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

it("answers the status read with the correct shape instead of trapping", async () => {
  const { actor } = await install();

  const status = await actor.getSundayCompStatus();
  expect(typeof status.live).toBe("boolean");
  expect(typeof status.sunday).toBe("bigint");
  expect(typeof status.secondsRemaining).toBe("bigint");
});

it("derives the claim deadline from the next competition start after the given start", async () => {
  const { actor } = await install();

  // Derive the canister's own clock from its status read rather than the test
  // host's: the replica's time is authoritative and may differ from the host's.
  const status = await actor.getSundayCompStatus();
  const currentStart = status.sunday;

  // The deadline is the NEXT competition start after a given start. A start
  // whose next start is still in the future reads claimable; a start whose next
  // start has already passed reads expired. The exact step (7 days today, 4 or
  // 3 after the generalization) is intentionally not pinned.
  const claimable = await actor.getClaimStatus(currentStart);
  expect(claimable).toEqual({ claimable: null });

  // A start far enough in the past that its next start is behind the canister's
  // now reads expired. Thirty days back is safely past any next-start step the
  // schedule can use (the largest step is 7 days).
  const longPastStart = currentStart - 30n * DAY_NS;
  const expired = await actor.getClaimStatus(longPastStart);
  expect(expired).toEqual({ expired: null });
});

it("archives each completed competition exactly once and idempotently", async () => {
  const { actor } = await install();

  // The first read finalizes the previous completed competition (with no wins,
  // so no winner) and archives it exactly once.
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
  const alice = createIdentity("schedule-adjacent-alice");

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
