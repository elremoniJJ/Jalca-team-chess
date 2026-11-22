import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the accepted change that shortens the Subao Ve
 * description in the spell table.
 *
 * The request replaces the long shield description with the shortened wording
 * "Protection against incoming enemy spells. A spell can only affect the game
 * if it has at least double the power of the Subao Ve. Otherwise it only
 * reduces the Subao Ve's remaining power."
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `getSpellTable` is an unimplemented stub. This file calls the real
 * public query on a freshly installed canister, so a stubbed backend traps here
 * instead of passing.
 *
 * What the replica CAN observe: `getSpellTable` returns the real
 * module-constant table, so the shortened Subao Ve Function text is visible
 * verbatim, the old long wording is gone, and the entry keeps its id, name,
 * meaning, Block category, Easy complexity and nftEligible=true.
 *
 * What the replica CANNOT observe: the shield arithmetic the description
 * narrates. That runs inside `burnAndPlay` only after a successful burn through
 * the external ICRC-7 collection canister, which does not exist in this
 * replica. See episode.coverageLimits.
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
async function freshActor(): Promise<_SERVICE> {
  if (pic === undefined) throw new Error("PocketIC not initialized");
  const { actor } = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  });
  return actor;
}

/**
 * The accepted shortened Subao Ve Function text, verbatim.
 */
const SUBAO_VE_SHORTENED =
  "Protection against incoming enemy spells. A spell can only affect the game if it has at least double the power of the Subao Ve. Otherwise it only reduces the Subao Ve's remaining power.";

it("exposes the shortened Subao Ve description from the real spell table", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();

  // The sole BLOCK spell is Subao Ve (id 0).
  expect(table.block.length).toBe(1);
  const subaoVe = table.block[0];

  // The shortened Function text is the accepted contract, verbatim.
  expect(subaoVe.spell).toBe(SUBAO_VE_SHORTENED);

  // The old long shield wording is gone.
  expect(subaoVe.spell).not.toContain(
    "Preemptively sets up a shield to block incoming enemy Major or Minor spells.",
  );
  expect(subaoVe.spell).not.toContain(
    "it not only depletes Subao Ve but also takes effect on the chessboard.",
  );

  // The accepted clauses survive.
  expect(subaoVe.spell).toContain(
    "A spell can only affect the game if it has at least double the power of the Subao Ve.",
  );
  expect(subaoVe.spell).toContain(
    "Otherwise it only reduces the Subao Ve's remaining power.",
  );

  // The identity fields the request does not change.
  expect(subaoVe.id).toBe(0n);
  expect(subaoVe.name).toBe("Subao Ve");
  expect(subaoVe.meaning).toBe("Protection");
  expect(subaoVe.category).toEqual({ Block: null });
  expect(subaoVe.complexity).toEqual({ Easy: null });
  expect(subaoVe.nftEligible).toBe(true);
});
