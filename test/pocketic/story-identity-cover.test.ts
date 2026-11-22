import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Cover for the sectioned Story backend and the Internet Identity sign-in
 * method family, exercised against the REAL canister installed in PocketIC
 * (no mock).
 *
 * The request replaces the single-text Story store with an ordered sectioned
 * model whose section 0 is the permanent "Forever" section, and gates every
 * Story write on a hardcoded sole-writer principal (NOT the recorded author).
 *
 * What this file proves against the real backend:
 *   - the `_internet_identity_sign_in_start` / `_internet_identity_sign_in_finish`
 *     method family exists and is callable (a missing method would reject with
 *     IC0536, which is the exact regression);
 *   - a fresh canister seeds the Forever section at index 0 with the JALCA
 *     story text and zero counters;
 *   - `getStorySections` is a public read that resolves;
 *   - `appendStorySection` / `fillStoryGap` / `writeStory` reject any caller
 *     that is not the hardcoded sole writer — including the principal recorded
 *     by the legacy `claimStoryAuthorship` endpoint;
 *   - `pressStoryDelete` / `pressStoryKeep` are public and reject the Forever
 *     section (index 0) and out-of-range indices;
 *   - the legacy `claimStoryAuthorship` / `getStoryAuthor` endpoints still work;
 *   - the existing game / prediction-bet reads still resolve.
 *
 * The hardcoded sole-writer principal cannot be produced from a seed (the
 * `Principal` class is not importable from the lane directory, and the writer's
 * key is not available), so the positive writer path is NOT exercised here.
 * That is a coverage limit, not a passing assertion.
 *
 * Each Story test installs its own canister so it seeds its own state
 * explicitly and does not depend on the order tests run in. Caller isolation
 * uses deterministic identities from `@dfinity/pic`; a `Principal` is never
 * constructed by hand.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

/**
 * The exact JALCA medieval fool story text. It is duplicated here on purpose:
 * the runtime source (lib/story.mo `foreverText`) and the migration chain
 * (20261002_000001.mo) each inline the same literal, and this assertion pins
 * the observable result to that exact string so a rewrite or truncation on
 * either path fails here.
 *
 * The blank lines between paragraphs and the trailing ellipsis are part of the
 * accepted text and are asserted character-for-character.
 */
const FOREVER_TEXT =
  "Can you think of a short story about a medieval fool named JALCA who dressed up like a wizard, played chess against the king and blatantly cheated by knocking the king's horses off the board. The king was outraged, and asked \"Why did you do that you stupid fool?\"\n\n" +
  "The fool answered, \"Tis magic m'lord. I wield the magic of surprise.\"\n\n" +
  "The king, even more enraged, pulled out a sword and chopped off JALCA's head. \"Surprise, JALCA, you fool\", the king exclaimed.\n\n" +
  "As JALCA's body slumped to the floor, and his head rolled to a stop, the king added, \"It's not a terrible idea though.\"\n\n" +
  "The real surprise then occurred as JALCA's head, motionless, somehow sputtered, \"Probably better if we just played online\".\n\n" +
  "\"What sorcery is this? Damn you head, riddled with the dark arts!\" The king shouted, and kicked the head across the court.\n\n" +
  "The head flew, losing its wizard hat, and struck the stone wall, cracking the skull. As it hit the floor, the king walked to it and kneeled down. \"What do you have to say now, my bloody funny friend?\"\n\n" +
  "Once again to his surprise, the lips moved, \"...";

let pic: PocketIc | undefined;

const alice = createIdentity("story-alice");
const bob = createIdentity("story-bob");

/** Install a fresh canister and return its actor (calling as anonymous). */
async function install(): Promise<_SERVICE> {
  const { actor } = await pic!.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  });
  return actor;
}

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
});

afterAll(async () => {
  await pic?.tearDown();
});

it("exposes the Internet Identity sign-in method family instead of rejecting with IC0536", async () => {
  const actor = await install();

  // The regression: the frontend II client calls these methods on the app
  // canister. Before the fix the canister had no such update method and the
  // call rejected with IC0536 ("Canister has no update method
  // _internet_identity_sign_in_start"). The start method must now exist and
  // resolve to the delegation bytes.
  const start = await actor._internet_identity_sign_in_start();
  expect(start).toBeInstanceOf(Uint8Array);

  // The finish method must also exist. Its exact outcome depends on the
  // delegation supplied (none here), so assert the one thing the regression is
  // about: it is a real method, not an IC0536 "no update method" reject. If it
  // resolves, it is one of the two Result variants.
  let finish:
    | Awaited<ReturnType<typeof actor._internet_identity_sign_in_finish>>
    | undefined;
  try {
    finish = await actor._internet_identity_sign_in_finish();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toMatch(/IC0536|no update method/);
    return;
  }
  const isOk = Object.prototype.hasOwnProperty.call(finish, "ok");
  const isErr = Object.prototype.hasOwnProperty.call(finish, "err");
  expect(isOk || isErr).toBe(true);
});

it("seeds the permanent Forever section at index 0 on a fresh canister", async () => {
  const actor = await install();

  const sections = await actor.getStorySections();
  expect(sections).toHaveLength(1);
  const forever = sections[0];
  expect(forever.index).toBe(0n);
  expect(forever.deleted).toBe(false);
  expect(forever.deleteCount).toBe(0n);
  expect(forever.keepCount).toBe(0n);
  // The exact JALCA medieval fool story text, character-for-character, with no
  // AI rewriting or truncation. This is the same literal the migration seed
  // inlines, so a fresh install and an upgraded install show identical text.
  expect(forever.text).toBe(FOREVER_TEXT);
  // A fresh caller has not voted on the Forever section.
  expect(forever.hasVotedDelete).toBe(false);
  expect(forever.hasVotedKeep).toBe(false);
});

it("rejects a Story append from a caller that is not the hardcoded writer", async () => {
  const actor = await install();
  actor.setIdentity(alice);

  await expect(actor.appendStorySection("Alice was here.")).rejects.toThrow(
    /Only the Story writer may modify the Story/,
  );
});

it("rejects a Story write from the principal recorded by claimStoryAuthorship", async () => {
  const actor = await install();

  // The legacy endpoint still records the caller as the author...
  actor.setIdentity(alice);
  const recorded = await actor.claimStoryAuthorship();
  expect(recorded).toEqual(alice.getPrincipal());

  // ...but the recorded author is NOT the write gate: the hardcoded sole
  // writer is. Alice's write must still be rejected.
  await expect(actor.writeStory("Once upon a time in JALCA.")).rejects.toThrow(
    /Only the Story writer may modify the Story/,
  );
});

it("rejects a gap fill from a caller that is not the hardcoded writer", async () => {
  const actor = await install();
  actor.setIdentity(bob);

  await expect(actor.fillStoryGap(0n, "Bob rewrote Forever.")).rejects.toThrow(
    /Only the Story writer may modify the Story/,
  );
});

it("rejects voting on the Forever section and on out-of-range indices", async () => {
  const actor = await install();

  // The anonymous-caller check runs first, so sign in before asserting the
  // Forever / out-of-range rules — otherwise every press rejects with the
  // anonymous message and the rule under test is never reached.
  actor.setIdentity(alice);

  // The Forever section (index 0) can never be voted on.
  await expect(actor.pressStoryDelete(0n)).rejects.toThrow(
    /The Forever section cannot be voted on/,
  );
  await expect(actor.pressStoryKeep(0n)).rejects.toThrow(
    /The Forever section cannot be voted on/,
  );

  // An index past the end of the section list is rejected.
  await expect(actor.pressStoryDelete(99n)).rejects.toThrow(
    /No Story section exists at that position/,
  );
  await expect(actor.pressStoryKeep(99n)).rejects.toThrow(
    /No Story section exists at that position/,
  );
});

it("rejects an anonymous caller from voting on the Story", async () => {
  // A freshly installed actor calls as the anonymous principal until an
  // identity is set. Anonymous callers may not vote at all.
  const actor = await install();

  await expect(actor.pressStoryDelete(1n)).rejects.toThrow(
    /Only a signed-in Internet Identity principal may vote on the Story/,
  );
  await expect(actor.pressStoryKeep(1n)).rejects.toThrow(
    /Only a signed-in Internet Identity principal may vote on the Story/,
  );
});

it("records the signed-in caller as the sole Story author", async () => {
  const actor = await install();

  // A fresh canister has no author yet.
  await expect(actor.getStoryAuthor()).resolves.toEqual([]);

  actor.setIdentity(alice);
  const recorded = await actor.claimStoryAuthorship();
  expect(recorded).toEqual(alice.getPrincipal());

  // The recorded author is readable and is Alice's principal.
  const author = await actor.getStoryAuthor();
  expect(author).toHaveLength(1);
  expect(author[0]).toEqual(alice.getPrincipal());
});

it("rejects a second principal claiming Story authorship", async () => {
  const actor = await install();
  actor.setIdentity(alice);
  await actor.claimStoryAuthorship();

  actor.setIdentity(bob);
  await expect(actor.claimStoryAuthorship()).rejects.toThrow(
    /already claimed by another principal/,
  );
});

it("rejects the anonymous caller from claiming Story authorship", async () => {
  // A freshly installed actor calls as the anonymous principal until an
  // identity is set.
  const actor = await install();
  await expect(actor.claimStoryAuthorship()).rejects.toThrow(
    /requires a signed-in Internet Identity principal/,
  );
  await expect(actor.getStoryAuthor()).resolves.toEqual([]);
});

it("keeps the existing game and prediction-bet reads working", async () => {
  const actor = await install();

  // The Story addition must not disturb the adjacent working reads.
  const state = await actor.getGameState("player-1");
  expect(state.board).toHaveLength(64);
  await expect(actor.getBets()).resolves.toEqual([]);
  await expect(actor.getResults()).resolves.toEqual([]);
});
