import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the accepted "Spells cast" accumulation change.
 *
 * The accepted request: the 'Spells cast' list in each team's NFT Spell
 * burning panel accumulates every cast spell for the duration of the game and
 * clears only at game start and game end — NOT on move completion. The list
 * stays split between White and Black, and each entry carries the team that
 * cast it and its per-spell outcome.
 *
 * What the replica CAN observe through the real public API:
 *   - a spell recorded by the Move_Maker lands in that team's window under the
 *     correct section (SubaoVe vs Minor/Major) with its team and outcome;
 *   - the recorded spell SURVIVES a turn advance (`attemptMove` calls
 *     `resetBurnForNewTurn`, which clears only the per-turn flags, not the
 *     windows) — the accumulation the request asks for;
 *   - the per-turn flag is cleared by the turn advance while the window keeps
 *     its entry, so a second burn is allowed on the new turn and appends to
 *     the same window;
 *   - the two teams' windows stay separate.
 *
 * What the replica CANNOT observe: the game-END clear. The only public paths
 * that conclude a game (checkmate / draw / timeout) require a full game to be
 * played out, and the game-end mint path calls the external ICRC-7 collection
 * canister (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica.
 * The game-start clear is likewise not reachable without a concluded game to
 * advance from. Both are pinned by the frontend source-contract tests and the
 * backend source; see episode.coverageLimits.
 *
 * The per-turn burn flag is global canister state, so every test installs its
 * OWN canister rather than sharing one, keeping each test independent of the
 * order the others run in.
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
  await actor.login("spells-cast-player-1", "Ada", [], { none: null });
  await actor.login("spells-cast-player-2", "Bob", [], { none: null });
  const state = await actor.getGameState("spells-cast-player-1");
  expect(state.moveMaker.length).toBe(1);
  return state.moveMaker[0];
}

/**
 * The opening maker's team, read from the game state's player list. The
 * declarations map Team as a variant ({ White: null } | { Black: null }).
 */
async function makerIsWhite(
  actor: _SERVICE,
  maker: string,
): Promise<boolean> {
  const state = await actor.getGameState("spells-cast-player-1");
  const info = state.players.find((p) => p.principal === maker);
  expect(info).toBeDefined();
  return info?.team !== undefined && "White" in info.team;
}

/**
 * Find a legal two-square pawn advance for the team to move, read from the
 * live board. The starting position is standard (White moves first), but the
 * opening maker's team is read from state rather than assumed, so the test is
 * robust to the team assignment. Returns [from, to] square indices.
 */
async function legalPawnAdvance(
  actor: _SERVICE,
): Promise<[bigint, bigint]> {
  const state = await actor.getGameState("spells-cast-player-1");
  const isWhiteTurn = "White" in state.turn;
  // White pawns start on rank 1 (indices 8..15), Black on rank 6 (48..55).
  const startRank = isWhiteTurn ? 1 : 6;
  const pawnColor = isWhiteTurn ? "White" : "Black";
  for (let file = 0; file < 8; file += 1) {
    const from = startRank * 8 + file;
    const cell = state.board[from];
    if (cell === undefined || cell.length === 0) continue;
    const piece = cell[0];
    if (piece === undefined) continue;
    if (!("Pawn" in piece.pieceType)) continue;
    if (!(pawnColor in piece.color)) continue;
    const to = isWhiteTurn ? from + 16 : from - 16;
    return [BigInt(from), BigInt(to)];
  }
  throw new Error("no legal opening pawn advance found");
}

it("keeps a cast spell in its team window after the turn advances", async () => {
  const actor = await freshActor();
  const openingMaker = await startGameWithMoveMaker(actor);
  const isWhite = await makerIsWhite(actor, openingMaker);

  // The opening Move_Maker may only burn a Subao Ve, so record one first.
  const openingBurn = await actor.recordBurn(openingMaker, {
    spellName: "Subao Ve",
    gameNumber: 1n,
    category: { SubaoVe: null },
  });
  expect(openingBurn).toHaveProperty("ok");

  const beforeMove = await actor.getBurnState();
  const openingWindow = isWhite
    ? beforeMove.whiteWindow
    : beforeMove.blackWindow;
  expect(openingWindow.subaoVeSpells).toHaveLength(1);

  // Advance the game with one legal pawn move by the opening maker's own team.
  // This rotates the Move_Maker and calls resetBurnForNewTurn, which must clear
  // only the per-turn flags — the team windows accumulate for the whole game.
  const [from, to] = await legalPawnAdvance(actor);
  const move = await actor.attemptMove(openingMaker, from, to, []);
  expect(move).toHaveProperty("ok");

  const afterMove = await actor.getBurnState();
  // The per-turn flag is cleared by the turn advance...
  expect(afterMove.burnOccurredThisTurn).toBe(false);
  expect(afterMove.burnedByTeam).toEqual([]);
  // ...but the cast spell is still listed in its team's window.
  const windowAfterMove = isWhite
    ? afterMove.whiteWindow
    : afterMove.blackWindow;
  expect(windowAfterMove.subaoVeSpells).toHaveLength(1);
  expect(windowAfterMove.subaoVeSpells[0]).toMatchObject({
    spellName: "Subao Ve",
    gameNumber: 1n,
    category: { SubaoVe: null },
  });
});

it("appends a second cast spell to the same window on the next turn", async () => {
  const actor = await freshActor();
  const openingMaker = await startGameWithMoveMaker(actor);
  const openingIsWhite = await makerIsWhite(actor, openingMaker);

  // Opening burn: a Subao Ve by the opening Move_Maker.
  const openingBurn = await actor.recordBurn(openingMaker, {
    spellName: "Subao Ve",
    gameNumber: 1n,
    category: { SubaoVe: null },
  });
  expect(openingBurn).toHaveProperty("ok");

  // Advance the turn so the per-turn flag clears and the other team moves.
  const [from, to] = await legalPawnAdvance(actor);
  const move = await actor.attemptMove(openingMaker, from, to, []);
  expect(move).toHaveProperty("ok");

  const state = await actor.getGameState("spells-cast-player-1");
  expect(state.moveMaker.length).toBe(1);
  const nextMaker = state.moveMaker[0];
  const nextInfo = state.players.find((p) => p.principal === nextMaker);
  expect(nextInfo).toBeDefined();
  const nextTeam = nextInfo?.team;
  const nextIsWhite = nextTeam !== undefined && "White" in nextTeam;

  // The new Move_Maker casts an offensive Minor spell. It must append to that
  // team's window rather than replacing the earlier entry.
  const secondBurn = await actor.recordBurn(nextMaker, {
    spellName: "Minor Spell",
    gameNumber: 1n,
    category: { Minor: null },
  });
  expect(secondBurn).toHaveProperty("ok");

  const burnState = await actor.getBurnState();
  const nextWindow = nextIsWhite
    ? burnState.whiteWindow
    : burnState.blackWindow;
  expect(nextWindow.minorMajorSpells).toContainEqual({
    spellName: "Minor Spell",
    gameNumber: 1n,
    team: nextTeam,
    category: { Minor: null },
    outcome: { noEffect: null },
  });

  // The two teams' windows stay separate: the opening Subao Ve is in the
  // opening team's window, and the Minor spell is in the next team's window.
  const openingWindow = nextIsWhite
    ? burnState.blackWindow
    : burnState.whiteWindow;
  expect(openingWindow.subaoVeSpells).toHaveLength(1);
  expect(openingWindow.subaoVeSpells[0].spellName).toBe("Subao Ve");
  expect(openingWindow.minorMajorSpells).toEqual([]);
});

it("keeps the White and Black windows split across a turn advance", async () => {
  const actor = await freshActor();
  const openingMaker = await startGameWithMoveMaker(actor);
  const openingIsWhite = await makerIsWhite(actor, openingMaker);

  const openingBurn = await actor.recordBurn(openingMaker, {
    spellName: "Subao Ve",
    gameNumber: 1n,
    category: { SubaoVe: null },
  });
  expect(openingBurn).toHaveProperty("ok");

  const [from, to] = await legalPawnAdvance(actor);
  const move = await actor.attemptMove(openingMaker, from, to, []);
  expect(move).toHaveProperty("ok");

  const afterMove = await actor.getBurnState();
  // Exactly one window holds the cast spell; the other stays empty.
  const populated = openingIsWhite
    ? afterMove.whiteWindow
    : afterMove.blackWindow;
  const empty = openingIsWhite ? afterMove.blackWindow : afterMove.whiteWindow;
  expect(populated.subaoVeSpells).toHaveLength(1);
  expect(empty.subaoVeSpells).toEqual([]);
  expect(empty.minorMajorSpells).toEqual([]);
});
