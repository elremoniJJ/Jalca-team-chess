import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the schedule-INDEPENDENT contract around the API
 * documentation, taken BEFORE the stale Sunday-competition wording in
 * `src/backend/mixins/api-doc.mo` is corrected.
 *
 * The request intentionally rewrites the documentation text: the
 * "Sunday competition (weekly leaderboard)" section and the Prize domain
 * claim-window wording will describe the alternating Sunday/Thursday schedule
 * and the next-competition-start claim deadline. That text is exactly what the
 * request changes, so this file deliberately does NOT pin the stale wording
 * (a weekly Sunday-only competition, a one-week claim window) as correct.
 *
 * What it protects is the documentation-INDEPENDENT contract that must survive
 * the rewrite:
 *
 *   - `getApiDoc()` is still exported and still resolves to a non-empty
 *     Markdown document instead of trapping or returning an empty string;
 *   - the real schedule the doc describes still behaves as documented: the
 *     reported competition start is a 00:00:00 UTC day boundary at or before
 *     the canister's now, the live window is exactly one day long, and the
 *     claim deadline is the NEXT competition start after the given start (a
 *     start whose deadline is in the future reads claimable, one whose deadline
 *     has passed reads expired).
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose methods are unimplemented stubs. This file installs the app's own
 * compiled wasm into the platform's PocketIC replica and drives the real public
 * API.
 *
 * What the replica CANNOT observe here: the exact Sunday/Thursday weekday of a
 * boundary and the exact +4 / +3 day step, because the replica starts at real
 * wall-clock time and no public method injects `now` into the pure lib. The
 * documentation text itself is intentionally not asserted. See
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
async function install(): Promise<{ actor: _SERVICE }> {
  if (pic === undefined) throw new Error("PocketIC not initialized");
  const { actor } = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  });
  return { actor };
}

/** The number of nanoseconds in one day. */
const DAY_NS = 86_400_000_000_000n;

it("still publishes a non-empty API document through getApiDoc", async () => {
  const { actor } = await install();

  // The endpoint survives the documentation rewrite: it is still exported and
  // still answers with a non-empty Markdown document rather than trapping or
  // returning an empty string. The text itself is intentionally not pinned.
  const doc = await actor.getApiDoc();
  expect(typeof doc).toBe("string");
  expect(doc.length).toBeGreaterThan(0);
});

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

it("derives the claim deadline from the next competition start after the given start", async () => {
  const { actor } = await install();

  // Derive the canister's own clock from its status read rather than the test
  // host's: the replica's time is authoritative and may differ from the host's.
  const status = await actor.getSundayCompStatus();
  const currentStart = status.sunday;

  // The deadline is the NEXT competition start after a given start. A start
  // whose next start is still in the future reads claimable; a start whose next
  // start has already passed reads expired. The exact step (4 or 3 days after
  // the generalization) is intentionally not pinned.
  await expect(actor.getClaimStatus(currentStart)).resolves.toEqual({
    claimable: null,
  });

  // A start far enough in the past that its next start is behind the canister's
  // now reads expired. Thirty days back is safely past any next-start step the
  // schedule can use (the largest step is 4 days).
  const longPastStart = currentStart - 30n * DAY_NS;
  await expect(actor.getClaimStatus(longPastStart)).resolves.toEqual({
    expired: null,
  });
});
