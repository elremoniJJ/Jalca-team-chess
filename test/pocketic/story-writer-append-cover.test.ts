import { PocketIc, createIdentity } from "@dfinity/pic";
import type { Actor } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Cover for the Story array-growth fix, exercised against the REAL canister
 * installed in PocketIC (no mock).
 *
 * The regression: `appendSection` grew `store.sections` with
 * `Array.tabulate(old.size() + 1, ...)` but then copied the grown array
 * element-by-element back into the ORIGINAL size-N array, so the write at the
 * new last index trapped with "Array index out of bounds". The same
 * element-by-element copy pattern was present in the per-principal voter
 * growth (`recordVoter`), so the first Delete/Keep press on a section trapped
 * the same way. The fix reassigns the grown array instead of copying into the
 * un-grown one.
 *
 * The existing `story-identity-cover.test.ts` records that the hardcoded
 * sole-writer principal "cannot be produced from a seed" and therefore never
 * exercises the positive writer path. That is true of `createIdentity`, but
 * PocketIC's actor exposes `setPrincipal(principal)`, which sets the sender
 * principal directly with no signature check. This file uses that to call the
 * writer-gated methods AS the hardcoded sole writer, so the append path that
 * trapped is now covered against the real backend.
 *
 * What this file proves against the real backend:
 *   - `appendStorySection` as the sole writer resolves (no "Array index out of
 *     bounds" trap) and the grown list contains the new section at the end;
 *   - a second append grows the list again, so the fix is not a one-off;
 *   - `pressStoryDelete` / `pressStoryKeep` as a signed-in non-writer resolve
 *     on the appended section (the `recordVoter` growth path), increment the
 *     counters, and reject a repeat press from the same principal;
 *   - the Forever section (index 0) stays untouchable: no vote, no gap fill;
 *   - a non-writer append is still rejected.
 *
 * The `Principal` class is not importable from the lane directory (the skill's
 * constraint), so the writer principal is built from the constructor of a
 * `Principal` instance obtained through `createIdentity(...).getPrincipal()`.
 * That keeps every runtime import in this file to `@dfinity/pic`, `vitest`,
 * and the app's own declarations.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

/** The hardcoded sole Story writer/editor from lib/story.mo. */
const WRITER_PRINCIPAL_TEXT =
  "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae";

/**
 * Build a `Principal` for the writer without importing `@icp-sdk/core/principal`
 * (which does not resolve from the lane directory). Any `Principal` instance
 * exposes its class through `constructor`, and `Principal.fromText` is static.
 */
function writerPrincipal(): ReturnType<
  ReturnType<typeof createIdentity>["getPrincipal"]
> {
  const sample = createIdentity("story-writer-principal-probe").getPrincipal();
  const PrincipalClass = sample.constructor as {
    fromText(text: string): typeof sample;
  };
  return PrincipalClass.fromText(WRITER_PRINCIPAL_TEXT);
}

let pic: PocketIc | undefined;

const alice = createIdentity("story-writer-cover-alice");
const bob = createIdentity("story-writer-cover-bob");

/** Install a fresh canister and return its actor (calling as anonymous). */
async function install(): Promise<Actor<_SERVICE>> {
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

it("appends a new section as the sole writer without trapping", async () => {
  const actor = await install();
  actor.setPrincipal(writerPrincipal());

  // The regression: this trapped with "Array index out of bounds" because the
  // grown array was copied back into the original size-1 array.
  await expect(
    actor.appendStorySection("Wilkin met a travelling juggler."),
  ).resolves.toBeNull();

  const sections = await actor.getStorySections();
  expect(sections).toHaveLength(2);
  const appended = sections[1];
  expect(appended.index).toBe(1n);
  expect(appended.text).toBe("Wilkin met a travelling juggler.");
  expect(appended.deleted).toBe(false);
  expect(appended.deleteCount).toBe(0n);
  expect(appended.keepCount).toBe(0n);
  expect(appended.hasVotedDelete).toBe(false);
  expect(appended.hasVotedKeep).toBe(false);
});

it("grows the section list again on a second writer append", async () => {
  const actor = await install();
  actor.setPrincipal(writerPrincipal());

  await actor.appendStorySection("First appended section.");
  await actor.appendStorySection("Second appended section.");

  const sections = await actor.getStorySections();
  expect(sections).toHaveLength(3);
  expect(sections[1].text).toBe("First appended section.");
  expect(sections[2].text).toBe("Second appended section.");
  expect(sections[2].index).toBe(2n);
});

it("records the first Delete and Keep press on an appended section without trapping", async () => {
  const actor = await install();
  actor.setPrincipal(writerPrincipal());
  await actor.appendStorySection("A section to vote on.");

  // The first press grows the section's deleteVoters/keepVoters array — the
  // same element-by-element copy pattern that trapped before the fix.
  actor.setIdentity(alice);
  await expect(actor.pressStoryDelete(1n)).resolves.toBeNull();
  await expect(actor.pressStoryKeep(1n)).resolves.toBeNull();

  const sections = await actor.getStorySections();
  const section = sections[1];
  expect(section.deleteCount).toBe(1n);
  expect(section.keepCount).toBe(1n);
  expect(section.hasVotedDelete).toBe(true);
  expect(section.hasVotedKeep).toBe(true);
});

it("rejects a repeat Delete/Keep press from the same principal", async () => {
  const actor = await install();
  actor.setPrincipal(writerPrincipal());
  await actor.appendStorySection("One vote per principal.");

  actor.setIdentity(alice);
  await actor.pressStoryDelete(1n);
  await actor.pressStoryKeep(1n);

  // The one-vote-per-principal rule is unchanged: a repeat press is rejected
  // server-side and the counters do not move.
  await expect(actor.pressStoryDelete(1n)).rejects.toThrow(
    /already voted Delete/,
  );
  await expect(actor.pressStoryKeep(1n)).rejects.toThrow(
    /already voted Keep/,
  );

  const sections = await actor.getStorySections();
  expect(sections[1].deleteCount).toBe(1n);
  expect(sections[1].keepCount).toBe(1n);
});

it("keeps the Forever section untouchable after an append", async () => {
  const actor = await install();
  actor.setPrincipal(writerPrincipal());
  await actor.appendStorySection("A live section.");

  // The Forever section (index 0) still cannot be voted on or filled, even by
  // the sole writer.
  actor.setIdentity(alice);
  await expect(actor.pressStoryDelete(0n)).rejects.toThrow(
    /The Forever section cannot be voted on/,
  );
  await expect(actor.pressStoryKeep(0n)).rejects.toThrow(
    /The Forever section cannot be voted on/,
  );

  actor.setPrincipal(writerPrincipal());
  await expect(actor.fillStoryGap(0n, "rewrite")).rejects.toThrow(
    /The Forever section cannot be modified/,
  );
});

it("still rejects an append from a caller that is not the sole writer", async () => {
  const actor = await install();
  actor.setIdentity(bob);

  await expect(actor.appendStorySection("Bob was here.")).rejects.toThrow(
    /Only the Story writer may modify the Story/,
  );

  // The rejected append left the list unchanged.
  const sections = await actor.getStorySections();
  expect(sections).toHaveLength(1);
});
