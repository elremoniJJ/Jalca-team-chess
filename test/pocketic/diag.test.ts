import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

let pic: PocketIc | undefined;
let actor: _SERVICE;

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
  ({ actor } = await pic.setupCanister<_SERVICE>({ idlFactory, wasm: BACKEND_WASM }));
});

afterAll(async () => {
  await pic?.tearDown();
});

it("seeds the PBPP_Information record with the live backend principal on a fresh install", async () => {
  // A fresh install runs the whole migration chain, which seeds the record
  // (000001), appends the fee-collection correction (000002), and appends the
  // live deployed backend principal entry (000003). This proves the migration
  // chain produces the principal entry on install, independent of any upgrade.
  const entries = await actor.getPbppInformation();
  expect(entries.length).toBeGreaterThanOrEqual(3);

  const principalEntry = entries.find((e) =>
    e.content.includes("hcfuw-caaaa-aaaaf-qgzaa-cai"),
  );
  expect(principalEntry).toBeDefined();
  expect(typeof principalEntry?.timestamp).toBe("bigint");
});
