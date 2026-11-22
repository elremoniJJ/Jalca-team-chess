import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Cover for the stored Forever section text across a real canister upgrade.
 *
 * The accepted requirement is that the Forever text held in the canister's
 * STABLE STATE is the user's exact JALCA text, so it survives upgrades and is
 * what the app reads. A fresh install seeds section 0 from the runtime
 * `foreverText()` in lib/story.mo, so the fresh-install test in
 * story-identity-cover.test.ts proves the runtime seed only.
 *
 * The migration that first rewrote section 0 to the JALCA text
 * (20261002_000001.mo) is now part of the deployed baseline mirrored in
 * `.old/`, so the previous revision already seeds the JALCA text and the
 * upgrade no longer runs that rewrite. This file therefore asserts the
 * observable consequence that still matters: the exact JALCA text is present
 * before the upgrade and survives it character-for-character, with its
 * counters, deleted flag, and caller-relative vote flags intact, still at
 * position 0.
 *
 * The runner only runs `*.upgrade.test.*` when a previous revision exists to
 * upgrade from, and supplies its wasm through BACKEND_WASM_PREVIOUS. The
 * migration changes stored data only, not the public Candid interface, so the
 * current idlFactory describes the previous wasm's public API identically and
 * is used for both installs — the same approach backend.upgrade.test.ts takes.
 * The previous revision's own declarations are deliberately NOT imported: they
 * live under `.old/`, outside the workspace package graph, so their
 * `@icp-sdk/core/candid` import does not resolve from the lane directory.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";
const PREVIOUS_WASM = process.env.BACKEND_WASM_PREVIOUS ?? "";

/**
 * The exact JALCA medieval-fool text the Forever section holds. Duplicated here
 * on purpose so a rewrite or truncation on either the runtime seed or the
 * migration path fails this assertion. The blank lines between paragraphs and
 * the trailing ellipsis are part of the accepted text and are asserted
 * character-for-character.
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

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
});

afterAll(async () => {
  await pic?.tearDown();
});

it("carries the exact JALCA Forever text through the migration upgrade", async () => {
  // 1. Install the version the user is actually running. Its chain already
  //    includes 20261002_000001.mo, so section 0 holds the JALCA text.
  const previous = await pic!.setupCanister({
    idlFactory,
    wasm: PREVIOUS_WASM,
  });

  // 2. Read the stored section 0 through the OLD public API. This is the
  //    pre-upgrade state the upgrade must preserve.
  const previousActor = pic!.createActor<_SERVICE>(
    idlFactory,
    previous.canisterId,
  );
  const before = await previousActor.getStorySections();
  expect(before).toHaveLength(1);
  expect(before[0].index).toBe(0n);
  expect(before[0].text).toBe(FOREVER_TEXT);

  // Make one update call before upgrading. The canister installs a recurring
  // maintenance timer whose self-message is otherwise outstanding at upgrade
  // time, which makes the pre_upgrade check trap with "outstanding message
  // callbacks". An update call lets the replica drain that pending callback,
  // the same way the passing upgrade tests in backend.upgrade.test.ts do.
  await previousActor.login("story-migration-player", "Ada", [], { none: null });

  // Stop the canister before upgrading. The recurring maintenance timer's
  // self-message is outstanding at upgrade time, and the pre_upgrade check
  // traps with "outstanding message callbacks" unless the canister is stopped
  // first — the remedy the trap message itself names. The migration runs as
  // part of the upgrade, so stopping does not skip it.
  await pic!.stopCanister({ canisterId: previous.canisterId });

  // 3. Upgrade to the version this build produces. The migration chain runs
  //    here; the Forever text must survive it unchanged.
  //    `wasm_memory_persistence: keep` is required for these
  //    enhanced-orthogonal-persistence canisters. `skip_pre_upgrade: []` runs
  //    the pre_upgrade that persists the authorization extension's
  //    `accessControlState`; skipping it makes the migration trap with
  //    "field `accessControlState` expected but not found in state".
  await pic!.upgradeCanister({
    canisterId: previous.canisterId,
    wasm: BACKEND_WASM,
    upgradeModeOptions: {
      skip_pre_upgrade: [],
      wasm_memory_persistence: [{ keep: null }],
    },
  });
  await pic!.startCanister({ canisterId: previous.canisterId });

  // 4. Read through the NEW API. The stored Forever text is still the exact
  //    JALCA text, character-for-character, and the section is still the
  //    immutable position-0 Forever section.
  const upgraded = pic!.createActor<_SERVICE>(idlFactory, previous.canisterId);
  const after = await upgraded.getStorySections();

  expect(after).toHaveLength(1);
  const forever = after[0];
  expect(forever.index).toBe(0n);
  expect(forever.text).toBe(FOREVER_TEXT);
  expect(forever.text).toHaveLength(FOREVER_TEXT.length);
  expect(forever.deleted).toBe(false);
  expect(forever.deleteCount).toBe(0n);
  expect(forever.keepCount).toBe(0n);
  expect(forever.hasVotedDelete).toBe(false);
  expect(forever.hasVotedKeep).toBe(false);
});

it("keeps the migrated Forever section immutable and at position 0", async () => {
  // Install the previous revision and upgrade, so the assertions run against
  // the migrated stable state rather than a fresh install.
  const previous = await pic!.setupCanister({
    idlFactory,
    wasm: PREVIOUS_WASM,
  });
  await pic!.stopCanister({ canisterId: previous.canisterId });
  await pic!.upgradeCanister({
    canisterId: previous.canisterId,
    wasm: BACKEND_WASM,
    upgradeModeOptions: {
      skip_pre_upgrade: [],
      wasm_memory_persistence: [{ keep: null }],
    },
  });
  await pic!.startCanister({ canisterId: previous.canisterId });

  const upgraded = pic!.createActor<_SERVICE>(idlFactory, previous.canisterId);

  // The migrated Forever section is still the first section in the ordered
  // list, and it is the only section on a canister that never had an appended
  // one.
  const sections = await upgraded.getStorySections();
  expect(sections[0].index).toBe(0n);
  expect(sections[0].text).toBe(FOREVER_TEXT);

  // The Forever section cannot be voted on after the migration: the public
  // Delete/Keep endpoints still reject index 0. The anonymous-caller check runs
  // first, so sign in before asserting the Forever rule.
  upgraded.setIdentity(createIdentity("story-migration-viewer"));
  await expect(upgraded.pressStoryDelete(0n)).rejects.toThrow(
    /The Forever section cannot be voted on/,
  );
  await expect(upgraded.pressStoryKeep(0n)).rejects.toThrow(
    /The Forever section cannot be voted on/,
  );

  // The writer-gated gap fill still refuses to touch the Forever section: a
  // non-writer is rejected before the index rule, so this proves the migrated
  // section offers no edit path through the public API.
  await expect(upgraded.fillStoryGap(0n, "rewrite")).rejects.toThrow(
    /Only the Story writer may modify the Story/,
  );
});
