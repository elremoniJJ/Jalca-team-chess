import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the corrected API documentation in
 * `src/backend/mixins/api-doc.mo`.
 *
 * The request rewrites the stale documentation text: the
 * "Sunday competition (weekly leaderboard)" section and the Prize domain
 * claim-window wording must describe the alternating Sunday/Thursday
 * competition schedule and the claim deadline as the next competition start
 * (four days after a Sunday, three days after a Thursday). No endpoint, type,
 * business logic or stable state changes — only the published Markdown string
 * returned by `getApiDoc()`.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose methods are unimplemented stubs. This file installs the app's own
 * compiled wasm into the platform's PocketIC replica and reads the real
 * `getApiDoc()` query, so it fails if the published documentation regresses to
 * the weekly-Sunday wording or drops the next-competition-start deadline.
 *
 * What the replica CAN observe: `getApiDoc()` resolves to the published
 * documentation string, and that string states the alternating Sunday/Thursday
 * schedule and the next-competition-start claim deadline, and no longer states
 * the stale weekly Sunday-only competition or one-week claim window.
 *
 * What the replica CANNOT observe: the exact weekday of a boundary or the
 * exact +4 / +3 day step for a specific boundary, because the replica starts at
 * real wall-clock time and no public method injects `now` into the pure lib.
 * The schedule's runtime behavior is covered by
 * `sunday-comp-schedule-cover.test.ts`. See episode.coverageLimits.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

let pic: PocketIc | undefined;
let actor: _SERVICE;

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
  ({ actor } = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  }));
});

afterAll(async () => {
  await pic?.tearDown();
});

it("describes the alternating Sunday/Thursday competition schedule", async () => {
  const doc = await actor.getApiDoc();

  // The section heading names the alternating schedule rather than a weekly
  // Sunday-only competition.
  expect(doc).toContain("### Competition (alternating Sunday/Thursday leaderboard)");

  // The schedule alternates between Sunday and Thursday boundaries, each
  // competition runs a single day, and the next competition starts four days
  // after a Sunday or three days after a Thursday.
  expect(doc).toContain("Competitions alternate");
  expect(doc).toContain("between **Sunday** and **Thursday** boundaries");
  expect(doc).toContain("each competition runs for a single day");
  expect(doc).toContain("**00:00:00 to 23:59:59 UTC** of its boundary day");
  expect(doc).toContain("the next competition starts four days");
  expect(doc).toContain("after a Sunday (on Thursday) or three days after a Thursday (on Sunday)");
});

it("describes the claim deadline as the next competition start", async () => {
  const doc = await actor.getApiDoc();

  // The getClaimStatus entry states the deadline is the next competition start,
  // four days after a Sunday and three days after a Thursday.
  expect(doc).toContain("The deadline is the next competition");
  expect(doc).toContain("start — four days after a Sunday, three days after a Thursday");

  // The Prize domain "Claim window" paragraph carries the same deadline.
  expect(doc).toContain("**Claim window.**");
  expect(doc).toContain("until the next");
  expect(doc).toContain("competition starts — four days after a Sunday, three days after a Thursday");
});

it("no longer describes a weekly Sunday-only competition or a one-week claim window", async () => {
  const doc = await actor.getApiDoc();

  // The stale heading and the stale one-week claim-window wording must be gone.
  expect(doc).not.toContain("### Sunday competition (weekly leaderboard)");
  expect(doc).not.toContain("weekly leaderboard");
  expect(doc).not.toContain("one week");
  expect(doc).not.toContain("one-week");
});
