import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Cover for the accepted upgrade-path change: `main.mo` gained an explicit
 * `system func postupgrade()` that re-arms the recurring maintenance timer.
 *
 * The previous revision installed the timer ONLY from the actor-body
 * initialization expression, on the (incorrect) assumption that the expression
 * re-runs on upgrade. In Motoko it does not: on upgrade only stable state is
 * preserved and `system func postupgrade` runs. The timer handle is a runtime
 * capability, not durable state, so it is NOT preserved across an upgrade.
 * Without a postupgrade hook the maintenance pass (stale-player cleanup,
 * turn-timeout expiry, celebration expiry) silently stops firing after the
 * first upgrade. This file exercises the REAL canister through the generated
 * declarations (no mock) and pins the observable consequence:
 *
 *   1. Install the previous revision (the version the user is actually running)
 *      and log a player in through its public API.
 *   2. Upgrade to the version this build produces. This runs the new
 *      `system func postupgrade`, which must re-arm the timer.
 *   3. Advance past the stale cutoff and produce rounds. The stale player must
 *      be removed by the timer's maintenance pass alone, with no client update
 *      call. Without the postupgrade hook the timer is dead after the upgrade
 *      and the player survives — which is the regression this test catches.
 *
 * The upgrade is previous-wasm -> current-wasm, the real deployment path, so
 * the runner builds the previous revision and supplies BACKEND_WASM_PREVIOUS.
 * The file is named `*.upgrade.test.ts` so the runner recognizes it as an
 * upgrade test and excludes it cleanly when no previous revision exists.
 *
 * PocketIC runs with manual progress (no auto-progress), so the timer only
 * fires when this test produces rounds with `tick()`.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";
const PREVIOUS_WASM = process.env.BACKEND_WASM_PREVIOUS ?? "";

/**
 * The backend's stale cutoff is 180s (widened from 15s so a non-move-maker
 * heartbeating every 120s is never treated as stale); advance past it with
 * margin.
 */
const PAST_STALE_CUTOFF_MS = 181_000;

let pic: PocketIc | undefined;

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
});

afterAll(async () => {
  await pic?.tearDown();
});

it("re-arms the maintenance timer after an upgrade so stale cleanup still fires", async () => {
  // 1. Install the version the user is actually running (the previous
  //    revision). Its Candid interface is compatible with the current
  //    idlFactory (the fix changes no public endpoint or response shape).
  const previous = await pic!.setupCanister<_SERVICE>({
    idlFactory,
    wasm: PREVIOUS_WASM,
  });
  const previousActor = pic!.createActor<_SERVICE>(idlFactory, previous.canisterId);

  // A player logs in through the OLD public API. No further client update call
  // is made until after the upgrade and the timer round below.
  await previousActor.login("upgraded-player", "Bob", [], { none: null });
  const before = await previousActor.getGameState("upgraded-player");
  expect(before.players.map((p) => p.principal)).toContain("upgraded-player");

  // 2. Upgrade to the version this build produces. This runs the new
  //    `system func postupgrade`, which must re-arm the recurring maintenance
  //    timer. `wasm_memory_persistence: keep` is required for these
  //    enhanced-orthogonal-persistence canisters. Stop the canister first: the
  //    recurring maintenance timer's self-message is outstanding at upgrade
  //    time and the pre_upgrade check traps with "outstanding message
  //    callbacks" otherwise.
  await pic!.stopCanister({ canisterId: previous.canisterId });
  await pic!.upgradeCanister({
    canisterId: previous.canisterId,
    wasm: BACKEND_WASM,
    upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] },
  });
  await pic!.startCanister({ canisterId: previous.canisterId });

  // 3. Read through the NEW API. The player written by the previous revision
  //    survived the upgrade (stable state is preserved).
  const upgraded = pic!.createActor<_SERVICE>(idlFactory, previous.canisterId);
  const afterUpgrade = await upgraded.getGameState("upgraded-player");
  expect(afterUpgrade.players.map((p) => p.principal)).toContain("upgraded-player");

  // 4. Advance past the stale cutoff and produce rounds. If the postupgrade
  //    hook re-armed the timer, the stale player is removed by the timer's
  //    maintenance pass alone. If it did not, the timer is dead after the
  //    upgrade and the player survives.
  await pic!.advanceTime(PAST_STALE_CUTOFF_MS);
  await pic!.tick(5);

  const after = await upgraded.getGameState("upgraded-player");
  expect(after.players.map((p) => p.principal)).not.toContain("upgraded-player");
});
