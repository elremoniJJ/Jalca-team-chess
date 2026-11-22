import { PocketIc } from "@dfinity/pic";
import { afterEach, beforeEach, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Cover for the accepted team-assignment and Move_Maker selection change,
 * exercised against the REAL canister through the generated declarations (no
 * mock).
 *
 * Accepted behavior:
 *   - a new player joins the team with FEWER teamCount players (inactive
 *     players still count), with a random choice on a tie;
 *   - a returning player keeps the team they already had;
 *   - `reassignTeams` uses the same fewer-players rule, so a rebalanced lobby
 *     is balanced;
 *   - the Move_Maker is always an active member of the team whose turn it is;
 *   - a legal move flips the turn and assigns a new maker on the new team;
 *   - a rejected second `attemptMove` leaves the turn and the maker unchanged
 *     (so no counter advances for a rejected move);
 *   - a new game resets the per-game counters, so selection stays fair.
 *
 * The per-game `turnsThisGame` counter is NOT exposed through `PlayerInfo` or
 * any public read, so its exact value cannot be asserted here. What IS
 * observable — and what these tests pin — is the selection behavior the counter
 * drives: the maker is always a real, active member of the turn's team, and a
 * legal move hands the turn to a valid new maker. See episode.coverageLimits.
 *
 * These tests call the real public API on a freshly installed canister, so a
 * backend whose methods are unimplemented stubs would trap here rather than
 * pass. The frontend suite mocks the actor and cannot see any of this.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

let pic: PocketIc | undefined;
let actor: _SERVICE;

beforeEach(async () => {
  pic = await PocketIc.create(PIC_URL);
  ({ actor } = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  }));
});

afterEach(async () => {
  await pic?.tearDown();
  pic = undefined;
});

/** The team of the player with the given principal, from a game-state read. */
function teamOf(
  state: Awaited<ReturnType<_SERVICE["getGameState"]>>,
  principal: string,
) {
  return state.players.find((p) => p.principal === principal)?.team;
}

/**
 * Count the players on each team from a game-state read, INCLUDING the single
 * reserved bot ("jalca-bot"). The bot is a roster member added by the accepted
 * bot change and the fewer-players rule counts it, so the rule's balance is a
 * property of the whole roster, not of the humans alone.
 */
function teamCounts(state: Awaited<ReturnType<_SERVICE["getGameState"]>>) {
  const white = state.players.filter((p) => "White" in p.team).length;
  const black = state.players.filter((p) => "Black" in p.team).length;
  return { white, black };
}

/**
 * Find a legal two-square pawn advance for the team to move, read from the
 * live board. The default opening is #Random, so the board is not the standard
 * starting position and a hard-coded e2 -> e4 is unreliable; the move is
 * computed from the board instead. Returns [from, to] square indices.
 */
async function legalPawnAdvance(
  actor: _SERVICE,
  principal: string,
): Promise<[bigint, bigint]> {
  const state = await actor.getGameState(principal);
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

it("places a new player on the team with fewer players", async () => {
  // The single bot is already on the roster and occupies one team. Four humans
  // then join. The fewer-players rule assigns each human to the team with fewer
  // players (the bot counts), so the TOTAL roster stays balanced to within one.
  await actor.login("fewer-a", "Ada", [], { none: null });
  await actor.login("fewer-b", "Bob", [], { none: null });
  await actor.login("fewer-c", "Cara", [], { none: null });
  await actor.login("fewer-d", "Dan", [], { none: null });

  const state = await actor.getGameState("fewer-a");
  const { white, black } = teamCounts(state);

  // The whole roster (bot + four humans) is balanced to within one: the
  // fewer-players rule keeps the lobby playable. With five players the split is
  // 3/2, so the third and fourth joiners may share a team — the invariant that
  // survives the bot is the balance, not the alternation.
  expect(Math.abs(white - black)).toBeLessThanOrEqual(1);
  expect(white + black).toBe(5);

  // Every joiner has a real team.
  for (const principal of ["fewer-a", "fewer-b", "fewer-c", "fewer-d"]) {
    expect(teamOf(state, principal)).toBeDefined();
  }
});

it("keeps a returning player on the team they already had", async () => {
  await actor.login("return-a", "Ada", [], { none: null });
  await actor.login("return-b", "Bob", [], { none: null });

  const before = await actor.getGameState("return-a");
  const teamBefore = teamOf(before, "return-a");
  expect(teamBefore).toBeDefined();

  // A returning principal must keep its team — the assignment rule runs only
  // for a brand-new player record.
  const relogin = await actor.login("return-a", "Ada", [], { none: null });
  expect(relogin.team).toEqual(teamBefore);

  const after = await actor.getGameState("return-a");
  expect(teamOf(after, "return-a")).toEqual(teamBefore);
});

it("balances the lobby across two logins and starts the game", async () => {
  await actor.login("balance-a", "Ada", [], { none: null });
  await actor.login("balance-b", "Bob", [], { none: null });

  const state = await actor.getGameState("balance-a");
  const { white, black } = teamCounts(state);

  // The roster (the bot plus the two humans) is balanced to within one, and
  // the game is under way.
  expect(Math.abs(white - black)).toBeLessThanOrEqual(1);
  expect(white + black).toBe(3);
  expect(state.phase).toEqual({ Playing: null });
});

it("assigns the Move_Maker from the active players of the turn's team", async () => {
  // Three humans join, so the roster (bot + three humans) is balanced 2/2 and
  // BOTH teams hold a human. That guarantees a human candidate exists on the
  // turn's team whatever the opening's turn is, so the maker assertion tests
  // the selection rule rather than the opening's parity.
  await actor.login("maker-a", "Ada", [], { none: null });
  await actor.login("maker-b", "Bob", [], { none: null });
  await actor.login("maker-c", "Cara", [], { none: null });

  const state = await actor.getGameState("maker-a");
  expect(state.moveMaker.length).toBe(1);
  const maker = state.moveMaker[0];

  // The maker is a real roster member, sits on the current turn's team, and is
  // active — the shared helper filters to active teammates.
  const makerPlayer = state.players.find((p) => p.principal === maker);
  expect(makerPlayer).toBeDefined();
  expect(makerPlayer?.team).toEqual(state.turn);
  expect(makerPlayer?.isInactive).toBe(false);
});

it("flips the turn and assigns a new maker on the new team after a legal move", async () => {
  // The default opening is #Random, so the board is not the standard starting
  // position; the legal move is computed from the live board rather than
  // hard-coded.
  await actor.login("flip-a", "Ada", [], { none: null });
  await actor.login("flip-b", "Bob", [], { none: null });

  const before = await actor.getGameState("flip-a");
  const turnBefore = before.turn;
  const makerBefore = before.moveMaker[0];

  const [from, to] = await legalPawnAdvance(actor, "flip-a");
  const result = await actor.attemptMove(makerBefore, from, to, []);
  expect(result).toHaveProperty("ok");

  const after = await actor.getGameState("flip-a");

  // The turn flipped to the opponent of the moving team.
  expect(after.turn).not.toEqual(turnBefore);

  // A new maker is assigned, on the new turn's team, and is not the old maker
  // (the two players are on opposite teams).
  expect(after.moveMaker.length).toBe(1);
  expect(after.moveMaker[0]).not.toBe(makerBefore);
  expect(teamOf(after, after.moveMaker[0])).toEqual(after.turn);
});

it("leaves the turn and maker unchanged when a second move is rejected", async () => {
  await actor.login("reject-a", "Ada", [], { none: null });
  await actor.castVote("reject-a", {
    startingPosition: { Standard: null },
    spellUse: { Off: null },
    turnDuration: { TwoMinutes: null },
  });
  await actor.login("reject-b", "Bob", [], { none: null });

  const before = await actor.getGameState("reject-a");
  const maker = before.moveMaker[0];
  const turnBefore = before.turn;

  // An illegal move returns early with #err and must not advance the game, so
  // no turnsThisGame counter is incremented for the rejected attempt.
  const rejected = await actor.attemptMove(maker, 12n, 36n, []);
  expect(rejected).toEqual({ err: "Illegal move" });

  const after = await actor.getGameState("reject-a");
  expect(after.turn).toEqual(turnBefore);
  expect(after.moveMaker).toEqual(before.moveMaker);
});

it("keeps the lobby balanced and playable with a third joiner", async () => {
  // Two players fill one team each; a third joins the already-balanced lobby.
  // Whatever the tie outcome, the result must be a real team and the lobby must
  // not collapse onto one side.
  await actor.login("third-a", "Ada", [], { none: null });
  await actor.login("third-b", "Bob", [], { none: null });
  await actor.login("third-c", "Cara", [], { none: null });

  const state = await actor.getGameState("third-a");
  const third = state.players.find((p) => p.principal === "third-c");
  expect(third).toBeDefined();
  expect(third?.team).toBeDefined();

  const { white, black } = teamCounts(state);
  // Three players split across two teams: neither team is empty and the
  // difference is at most one, so the lobby stays playable.
  expect(white).toBeGreaterThanOrEqual(1);
  expect(black).toBeGreaterThanOrEqual(1);
  expect(Math.abs(white - black)).toBeLessThanOrEqual(1);
});

it("resets the turn timer when a legal move flips the turn", async () => {
  await actor.login("timer-a", "Ada", [], { none: null });
  await actor.login("timer-b", "Bob", [], { none: null });

  const before = await actor.getGameState("timer-a");
  const maker = before.moveMaker[0];

  // A legal move computed from the live board; the atomic block resets the
  // clock.
  const [from, to] = await legalPawnAdvance(actor, "timer-a");
  const result = await actor.attemptMove(maker, from, to, []);
  expect(result).toHaveProperty("ok");

  const after = await actor.getGameState("timer-a");
  // The turn flipped and the timer was reset to the full turn limit, so the
  // remaining time is at least as large as it was before the move.
  expect(after.turn).not.toEqual(before.turn);
  expect(after.timerRemainingMs).toBeGreaterThanOrEqual(before.timerRemainingMs);
});

it("never stalls when each team has only one active player", async () => {
  // Three humans join, so the roster (bot + three humans) is balanced 2/2 and
  // BOTH teams hold a human. After every move the turn flips to the other team,
  // whose only active human is the one who just moved two turns ago. The shared
  // helper excludes the player who just moved ONLY when more than one candidate
  // remains, so a lone active teammate is still picked and the game never
  // stalls. Play a short legal sequence and assert the turn keeps flipping with
  // a valid, active maker on the turn's team each time.
  await actor.login("lone-a", "Ada", [], { none: null });
  await actor.login("lone-b", "Bob", [], { none: null });
  await actor.login("lone-c", "Cara", [], { none: null });

  // Four plies, each a legal pawn advance computed from the live board (the
  // default opening is #Random, so the board is not the standard position).
  let previousTurn = (await actor.getGameState("lone-a")).turn;
  for (let ply = 0; ply < 4; ply += 1) {
    const before = await actor.getGameState("lone-a");
    expect(before.moveMaker.length).toBe(1);
    const maker = before.moveMaker[0];
    const makerPlayer = before.players.find((p) => p.principal === maker);
    expect(makerPlayer?.team).toEqual(before.turn);
    expect(makerPlayer?.isInactive).toBe(false);

    const [from, to] = await legalPawnAdvance(actor, "lone-a");
    const result = await actor.attemptMove(maker, from, to, []);
    expect(result).toHaveProperty("ok");

    const after = await actor.getGameState("lone-a");
    // The turn flipped and a valid active maker was assigned on the new team,
    // so the lone-active-player rule kept the game moving.
    expect(after.turn).not.toEqual(previousTurn);
    expect(after.moveMaker.length).toBe(1);
    const nextMaker = after.players.find(
      (p) => p.principal === after.moveMaker[0],
    );
    expect(nextMaker?.team).toEqual(after.turn);
    expect(nextMaker?.isInactive).toBe(false);
    previousTurn = after.turn;
  }
});

it("keeps Move_Maker selection valid across a new game", async () => {
  // Three humans join, so the roster (bot + three humans) is balanced 2/2 and
  // BOTH teams hold a human, guaranteeing a maker exists whatever the opening's
  // turn is. A legal move advances the turn. Then all three press "New game"
  // (requestNewGame) and the game restarts; the per-game counters are reset at
  // new-game start, so selection must still hand the turn to a valid active
  // member of the turn's team.
  await actor.login("newgame-a", "Ada", [], { none: null });
  await actor.login("newgame-b", "Bob", [], { none: null });
  await actor.login("newgame-c", "Cara", [], { none: null });

  const started = await actor.getGameState("newgame-a");
  const maker = started.moveMaker[0];
  const [from, to] = await legalPawnAdvance(actor, "newgame-a");
  const moved = await actor.attemptMove(maker, from, to, []);
  expect(moved).toHaveProperty("ok");

  // All players signal readiness for the next game.
  await actor.requestNewGame("newgame-a");
  await actor.requestNewGame("newgame-b");
  await actor.requestNewGame("newgame-c");

  // The game restarts (or is already playing) with a valid maker on the turn's
  // team — the reset counters did not leave selection pointing at a stale or
  // absent principal.
  const after = await actor.getGameState("newgame-a");
  expect(after.phase).toEqual({ Playing: null });
  expect(after.moveMaker.length).toBe(1);
  const newMaker = after.players.find(
    (p) => p.principal === after.moveMaker[0],
  );
  expect(newMaker).toBeDefined();
  expect(newMaker?.team).toEqual(after.turn);
  expect(newMaker?.isInactive).toBe(false);
});
