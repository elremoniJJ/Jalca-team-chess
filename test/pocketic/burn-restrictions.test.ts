import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the burn restrictions the backend enforces through the
 * real canister, taken BEFORE the burn flow is repointed to a backend burn
 * method.
 *
 * The request intentionally changes HOW a burn is initiated (a backend method
 * that calls icrc7_burn instead of a frontend ICRC-7 transfer to a burn
 * account). It does NOT change the restriction set, which must survive:
 *   - only the current Move_Maker may record a burn;
 *   - only one burn may be recorded per turn;
 *   - an NFT must carry a non-empty spell name to be burned;
 *   - a successful burn is appended to the Move_Maker's team window in the
 *     correct section (SubaoVe vs Minor/Major) and flips the per-turn flag.
 *
 * These tests call the real public API on a freshly installed canister, so a
 * backend whose methods are unimplemented stubs would trap here rather than
 * pass. The frontend suite mocks the actor and cannot see any of this.
 *
 * The per-turn burn flag is global canister state, so every test that records
 * a successful burn installs its OWN canister rather than sharing one. That
 * keeps each test independent of the order the others run in.
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
 * Start a fresh game with two players (one per team) and return the assigned
 * Move_Maker principal. Two logins balance the teams and start the game.
 */
async function startGameWithMoveMaker(actor: _SERVICE): Promise<string> {
  await actor.login("burn-player-1", "Ada", [], { none: null });
  await actor.login("burn-player-2", "Bob", [], { none: null });
  const state = await actor.getGameState("burn-player-1");
  expect(state.moveMaker.length).toBe(1);
  return state.moveMaker[0];
}

it("answers an empty burn state on a fresh canister", async () => {
  const actor = await freshActor();
  // A fresh canister has no burn recorded and both team windows are empty.
  const burnState = await actor.getBurnState();
  expect(burnState.burnOccurredThisTurn).toBe(false);
  expect(burnState.burnedByTeam).toEqual([]);
  expect(burnState.whiteWindow.minorMajorSpells).toEqual([]);
  expect(burnState.whiteWindow.subaoVeSpells).toEqual([]);
  expect(burnState.blackWindow.minorMajorSpells).toEqual([]);
  expect(burnState.blackWindow.subaoVeSpells).toEqual([]);
});

it("rejects a burn from a player who is not the current Move_Maker", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);
  // Pick a principal that is definitely not the Move_Maker.
  const notMaker = maker === "burn-player-1" ? "burn-player-2" : "burn-player-1";

  const result = await actor.recordBurn(notMaker, {
    spellName: "Subao Ve",
    gameNumber: 1n,
    category: { SubaoVe: null },
  });

  expect(result).toEqual({
    err: "Only the current Move_Maker can burn an NFT spell",
  });
  // A rejected burn must not flip the per-turn flag.
  const burnState = await actor.getBurnState();
  expect(burnState.burnOccurredThisTurn).toBe(false);
});

it("rejects a burn with an empty spell name", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  const result = await actor.recordBurn(maker, {
    spellName: "",
    gameNumber: 1n,
    category: { SubaoVe: null },
  });

  expect(result).toEqual({
    err: "The NFT must carry a spell name to be burned",
  });
  const burnState = await actor.getBurnState();
  expect(burnState.burnOccurredThisTurn).toBe(false);
});

it("rejects a second burn in the same turn", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  // First burn succeeds and flips the one-burn-per-turn flag.
  const first = await actor.recordBurn(maker, {
    spellName: "Subao Ve",
    gameNumber: 1n,
    category: { SubaoVe: null },
  });
  expect(first).toHaveProperty("ok");

  // A second burn in the same turn is rejected regardless of the spell.
  const second = await actor.recordBurn(maker, {
    spellName: "Minor Spell",
    gameNumber: 2n,
    category: { Minor: null },
  });
  expect(second).toEqual({
    err: "A spell has already been burned this turn",
  });
});

it("records a Subao Ve burn in the maker's team window under subaoVeSpells", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);
  const state = await actor.getGameState("burn-player-1");
  const makerInfo = state.players.find((p) => p.principal === maker);
  expect(makerInfo).toBeDefined();
  // The declarations map Team as a variant ({ White: null } | { Black: null }).
  const makerTeam = makerInfo?.team;
  const isWhite = makerTeam !== undefined && "White" in makerTeam;

  const result = await actor.recordBurn(maker, {
    spellName: "Subao Ve",
    gameNumber: 7n,
    category: { SubaoVe: null },
  });
  expect(result).toHaveProperty("ok");

  const burnState = await actor.getBurnState();
  expect(burnState.burnOccurredThisTurn).toBe(true);
  expect(burnState.burnedByTeam).toEqual([makerTeam]);

  // The burned spell lands in the maker's team window under the Subao Ve
  // section, carrying the spell name, game number, team, category, and the
  // per-spell cast outcome. The plain recordBurn bookkeeping path performs no
  // shield resolution, so the recorded outcome is #noEffect.
  const window = isWhite ? burnState.whiteWindow : burnState.blackWindow;
  expect(window.subaoVeSpells).toContainEqual({
    spellName: "Subao Ve",
    gameNumber: 7n,
    team: makerTeam,
    category: { SubaoVe: null },
    outcome: { noEffect: null },
  });
  expect(window.minorMajorSpells).toEqual([]);
});

it("rejects an offensive burn from the opening Move_Maker", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  // No move has been made yet, so this is the opening Move_Maker. The opening
  // maker may only burn a Subao Ve; an offensive Minor/Major is rejected with
  // no fallback, and the per-turn flag stays clear.
  const result = await actor.recordBurn(maker, {
    spellName: "Minor Spell",
    gameNumber: 3n,
    category: { Minor: null },
  });
  expect(result).toEqual({
    err: "The first turn only allows burning a Subao Ve spell",
  });
  const burnState = await actor.getBurnState();
  expect(burnState.burnOccurredThisTurn).toBe(false);
});

it("answers the batched burn entrypoint with one outcome per requested token", async () => {
  const actor = await freshActor();

  // burnNfts is the batch entrypoint the frontend uses to destroy tokens
  // directly as the backend's own principal (the allowlisted-admin path). The
  // collection canister does not exist in this replica, so the inter-canister
  // burn rejects; the try/catch must map that to one #failed outcome per
  // requested token id, in the same order as the input, rather than trapping
  // JALCA's canister. A trap here would surface to the user as an unhandled
  // error instead of a per-token burn failure.
  const outcomes = await actor.burnNfts([1n, 2n, 3n]);
  expect(outcomes).toEqual([
    { failed: "burn canister call trapped" },
    { failed: "burn canister call trapped" },
    { failed: "burn canister call trapped" },
  ]);

  // An empty batch is a valid no-op that returns an empty response.
  await expect(actor.burnNfts([])).resolves.toEqual([]);
});

it("records a Minor burn in the maker's team window under minorMajorSpells", async () => {
  const actor = await freshActor();
  const openingMaker = await startGameWithMoveMaker(actor);

  // The opening Move_Maker may only burn a Subao Ve, so advance the game with
  // one legal White pawn move (e2 -> e4) before burning an offensive spell.
  // The move rotates the Move_Maker to the other team, so re-read the state to
  // find the current maker rather than reusing the opening one.
  const move = await actor.attemptMove(openingMaker, 12n, 28n, []);
  expect(move).toHaveProperty("ok");

  const state = await actor.getGameState("burn-player-1");
  expect(state.moveMaker.length).toBe(1);
  const maker = state.moveMaker[0];
  const makerInfo = state.players.find((p) => p.principal === maker);
  expect(makerInfo).toBeDefined();
  const makerTeam = makerInfo?.team;
  const isWhite = makerTeam !== undefined && "White" in makerTeam;

  const result = await actor.recordBurn(maker, {
    spellName: "Minor Spell",
    gameNumber: 3n,
    category: { Minor: null },
  });
  expect(result).toHaveProperty("ok");

  const burnState = await actor.getBurnState();
  const window = isWhite ? burnState.whiteWindow : burnState.blackWindow;
  expect(window.minorMajorSpells).toContainEqual({
    spellName: "Minor Spell",
    gameNumber: 3n,
    team: makerTeam,
    category: { Minor: null },
    outcome: { noEffect: null },
  });
  expect(window.subaoVeSpells).toEqual([]);
});

it("carries the per-spell cast outcome on every burned spell in the burn state", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  // The accepted request adds a required per-spell outcome to the burn state so
  // the team windows can show a tick / cross / question mark. The plain
  // recordBurn bookkeeping path performs no shield resolution, so the recorded
  // outcome is #noEffect. A backend that dropped the field would fail to decode
  // against the declarations' shape here.
  const result = await actor.recordBurn(maker, {
    spellName: "Subao Ve",
    gameNumber: 7n,
    category: { SubaoVe: null },
  });
  expect(result).toHaveProperty("ok");

  const burnState = await actor.getBurnState();
  const burned = [
    ...burnState.whiteWindow.subaoVeSpells,
    ...burnState.whiteWindow.minorMajorSpells,
    ...burnState.blackWindow.subaoVeSpells,
    ...burnState.blackWindow.minorMajorSpells,
  ];
  expect(burned).toHaveLength(1);
  expect(burned[0].outcome).toEqual({ noEffect: null });
});
