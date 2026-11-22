import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization taken BEFORE the read-only polls become true queries.
 *
 * The request intentionally changes the backend's update-vs-query
 * classification for getGameState, getGameRecord, getExerciseAssignments,
 * getDrinkingAssignments, getAdvice, getBets, and getResults, and moves
 * maintenance onto a recurring timer. This file deliberately does NOT assert
 * the update/query classification (a Candid concern) nor any maintenance
 * side effect — those are the intentional changes.
 *
 * What it protects is the behavior ADJACENT to the change that must survive
 * it: the DATA SHAPE of the read methods the acceptance criteria name. The
 * existing backend.test.ts already covers the empty-state shape of
 * getGameState, getGameNumber, getExerciseAssignments, getDrinkingAssignments,
 * and getAdvice. This file closes the remaining three — getGameRecord,
 * getBets, getResults — so a conversion that accidentally changes a return
 * shape fails here rather than in front of a user.
 *
 * The real canister is installed and called through the generated
 * declarations (no mock).
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

it("answers the empty-state game record with the full GameRecord shape", async () => {
  // A fresh canister has no recorded game yet. getGameRecord must resolve
  // with the complete GameRecord record (every field present) rather than
  // trapping or dropping a field.
  const record = await actor.getGameRecord();

  expect(record.moves).toEqual([]);
  expect(record.playerList).toEqual([]);
  expect(record.rosters).toEqual([]);
  expect(record.active).toBe(false);
  expect(record.concluded).toBe(false);
  expect(record.openingName).toBe("");
  expect(record.finalBoard).toEqual([]);
  // Candid maps ?T to [] | [T]; an absent optional is the empty array.
  expect(record.result).toEqual([]);
  expect(record.endState).toEqual([]);
  expect(record.finalMovePlayerOnTimeout).toEqual([]);
});

it("answers the empty-state bet and result reads with empty arrays", async () => {
  // A fresh canister has no submitted prediction bets and no recorded
  // results. Both reads must resolve with an empty array rather than
  // trapping on uninitialized state.
  await expect(actor.getBets()).resolves.toEqual([]);
  await expect(actor.getResults()).resolves.toEqual([]);
});

it("keeps the read methods callable after a player logs in", async () => {
  // The reads must remain callable once the canister has state, not only on
  // a fresh one. A login populates the roster; the read shapes must still
  // hold (the game record stays a complete record, the bet/result lists stay
  // arrays).
  await actor.login("shape-player", "Ada", [], { none: null });

  const record = await actor.getGameRecord();
  expect(record).toHaveProperty("moves");
  expect(record).toHaveProperty("playerList");
  expect(record).toHaveProperty("rosters");
  expect(record).toHaveProperty("finalBoard");
  expect(Array.isArray(record.moves)).toBe(true);

  await expect(actor.getBets()).resolves.toEqual([]);
  await expect(actor.getResults()).resolves.toEqual([]);
});
