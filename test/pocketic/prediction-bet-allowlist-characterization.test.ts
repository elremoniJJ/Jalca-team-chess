import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the Prediction Bet ALLOWLIST-GATED WRITE path, taken
 * BEFORE the backend gains the Internet Identity sign-in method family and the
 * Story-authoring surface.
 *
 * The request adds a new allowlist-gated write family: Story writes are gated
 * to the signed-in Internet Identity principal. It must NOT disturb the
 * existing allowlist-gated writes the acceptance criteria name ("prediction
 * bet ... features continue to work").
 *
 * The existing backend.test.ts and read-shape-characterization.test.ts cover
 * the prediction bet READS (getBets/getResults empty shape). This file closes
 * the remaining gap: the WRITE path's allowlist enforcement, which is the
 * behavior the new Story gating mirrors. On a fresh install the migration
 * chain seeds `betStore.jalcaPrincipal` to the live JALCA canister principal
 * (py4x3-piaaa-aaaai-ax2ya-cai), so submitBet and recordGameResult trap for
 * any other caller — including the lane's default anonymous caller.
 *
 * The real canister is installed and called through the generated
 * declarations (no mock). The trap is the observable allowlist behavior: a
 * non-allowlisted caller is rejected rather than silently recorded.
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

it("rejects a non-allowlisted submitBet caller instead of recording the bet", async () => {
  // The lane actor calls as the anonymous principal, which is not the
  // configured JALCA canister principal. The allowlist must reject the write.
  await expect(
    actor.submitBet({ One: null }, { White: null }, "player-1", "Ada", false),
  ).rejects.toThrow(/JALCA canister principal/);

  // The rejected write must not have been recorded.
  await expect(actor.getBets()).resolves.toEqual([]);
});

it("rejects a non-allowlisted recordGameResult caller instead of recording the result", async () => {
  // Same allowlist rule for the result-recording write.
  await expect(actor.recordGameResult({ White: null })).rejects.toThrow(
    /JALCA canister principal/,
  );

  // The rejected write must not have been recorded.
  await expect(actor.getResults()).resolves.toEqual([]);
});

it("keeps the prediction bet reads callable after a rejected write", async () => {
  // A rejected allowlisted write must leave the read paths working: both
  // resolve to empty arrays rather than trapping on a half-written store.
  await expect(actor.getBets()).resolves.toEqual([]);
  await expect(actor.getResults()).resolves.toEqual([]);
});
