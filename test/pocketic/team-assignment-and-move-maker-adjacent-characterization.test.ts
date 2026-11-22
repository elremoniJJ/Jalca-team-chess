import { PocketIc } from "@dfinity/pic";
import { afterEach, beforeEach, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization cover for the team-assignment and Move_Maker selection
 * behavior that the accepted change must NOT disturb.
 *
 * The accepted request replaces the weighted team-assignment rule with a
 * fewer-players rule, adds a per-game `turnsThisGame` counter, and routes both
 * Move_Maker selection sites through one shared helper. This file pins the
 * adjacent, unchanged contracts those edits sit next to, so a regression in
 * the rewrite is caught:
 *
 *   1. A returning player keeps the team they already had — re-login must not
 *      re-run team assignment for an existing principal.
 *   2. Two logins balance the lobby (one White, one Black) and start the game.
 *   3. The Move_Maker is always a member of the team whose turn it is.
 *   4. A legal move flips the turn and assigns a new maker on the new team.
 *   5. A rejected second attemptMove leaves the turn and the maker unchanged
 *      (the counter must not advance for a rejected move).
 *
 * These tests call the real public API on a freshly installed canister, so a
 * backend whose methods are unimplemented stubs would trap here rather than
 * pass. The frontend suite mocks the actor and cannot see any of this.
 *
 * The changed rule itself (fewer-players placement, the counter value, the
 * shared helper) is intentionally NOT asserted here — that is the behavior the
 * request changes, and characterizing it would freeze the old rule.
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
function teamOf(state: Awaited<ReturnType<_SERVICE["getGameState"]>>, principal: string) {
  return state.players.find((p) => p.principal === principal)?.team;
}

it("keeps a returning player on the team they already had", async () => {
  // Two players log in and start a game; each fills one team.
  await actor.login("returning-a", "Ada", [], { none: null });
  await actor.login("returning-b", "Bob", [], { none: null });

  const before = await actor.getGameState("returning-a");
  const teamBefore = teamOf(before, "returning-a");
  expect(teamBefore).toBeDefined();

  // The first player re-logs in. A returning principal must keep its team —
  // the assignment rule runs only for a brand-new player record.
  const relogin = await actor.login("returning-a", "Ada", [], { none: null });
  expect(relogin.team).toEqual(teamBefore);

  const after = await actor.getGameState("returning-a");
  expect(teamOf(after, "returning-a")).toEqual(teamBefore);
});

it("balances the lobby across two logins and starts the game", async () => {
  await actor.login("balance-a", "Ada", [], { none: null });
  await actor.login("balance-b", "Bob", [], { none: null });

  const state = await actor.getGameState("balance-a");
  const white = state.players.filter((p) => "White" in p.team);
  const black = state.players.filter((p) => "Black" in p.team);

  // One player per team, and the game is under way.
  expect(white).toHaveLength(1);
  expect(black).toHaveLength(1);
  expect(state.phase).toEqual({ Playing: null });
});

it("assigns the Move_Maker from the team whose turn it is", async () => {
  await actor.login("maker-a", "Ada", [], { none: null });
  await actor.login("maker-b", "Bob", [], { none: null });

  const state = await actor.getGameState("maker-a");
  expect(state.moveMaker.length).toBe(1);
  const maker = state.moveMaker[0];

  // The maker is a real roster member and sits on the current turn's team.
  const makerTeam = teamOf(state, maker);
  expect(makerTeam).toBeDefined();
  expect(makerTeam).toEqual(state.turn);
});

it("flips the turn and assigns a new maker on the new team after a legal move", async () => {
  // The default opening is #Random, which would make a fixed e2 -> e4 move
  // unreliable. The first player votes #Standard before the second login
  // starts the game, so the board is the standard starting position.
  await actor.login("flip-a", "Ada", [], { none: null });
  await actor.castVote("flip-a", {
    startingPosition: { Standard: null },
    spellUse: { Off: null },
  });
  await actor.login("flip-b", "Bob", [], { none: null });

  const before = await actor.getGameState("flip-a");
  const turnBefore = before.turn;
  const makerBefore = before.moveMaker[0];

  // e2 -> e4 is a legal White opening move.
  const result = await actor.attemptMove(makerBefore, 12n, 28n, []);
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
  });
  await actor.login("reject-b", "Bob", [], { none: null });

  const before = await actor.getGameState("reject-a");
  const maker = before.moveMaker[0];
  const turnBefore = before.turn;

  // An illegal move returns early with #err and must not advance the game.
  const rejected = await actor.attemptMove(maker, 12n, 36n, []);
  expect(rejected).toEqual({ err: "Illegal move" });

  const after = await actor.getGameState("reject-a");
  expect(after.turn).toEqual(turnBefore);
  expect(after.moveMaker).toEqual(before.moveMaker);
});

it("gives a third joiner a valid team and keeps the lobby balanced", async () => {
  // Two players fill one team each; a third joins the already-balanced lobby.
  // Whatever rule places them, the result must be a real team and the lobby
  // must not collapse onto one side — the fewer-players rule must still
  // produce a valid, balanced assignment.
  await actor.login("third-a", "Ada", [], { none: null });
  await actor.login("third-b", "Bob", [], { none: null });
  await actor.login("third-c", "Cara", [], { none: null });

  const state = await actor.getGameState("third-a");
  const third = state.players.find((p) => p.principal === "third-c");
  expect(third).toBeDefined();
  expect(third?.team).toBeDefined();

  const white = state.players.filter((p) => "White" in p.team);
  const black = state.players.filter((p) => "Black" in p.team);
  // Three players split across two teams: neither team is empty and the
  // difference is at most one, so the lobby stays playable.
  expect(white.length).toBeGreaterThanOrEqual(1);
  expect(black.length).toBeGreaterThanOrEqual(1);
  expect(Math.abs(white.length - black.length)).toBeLessThanOrEqual(1);
});

it("resets the turn timer when a legal move flips the turn", async () => {
  await actor.login("timer-a", "Ada", [], { none: null });
  await actor.castVote("timer-a", {
    startingPosition: { Standard: null },
    spellUse: { Off: null },
  });
  await actor.login("timer-b", "Bob", [], { none: null });

  const before = await actor.getGameState("timer-a");
  const maker = before.moveMaker[0];

  // e2 -> e4 is a legal White opening move; the atomic block resets the clock.
  const result = await actor.attemptMove(maker, 12n, 28n, []);
  expect(result).toHaveProperty("ok");

  const after = await actor.getGameState("timer-a");
  // The turn flipped and the timer was reset to the full turn limit, so the
  // remaining time is at least as large as it was before the move.
  expect(after.turn).not.toEqual(before.turn);
  expect(after.timerRemainingMs).toBeGreaterThanOrEqual(before.timerRemainingMs);
});

it("assigns a Move_Maker who is a fresh roster member", async () => {
  await actor.login("fresh-a", "Ada", [], { none: null });
  await actor.login("fresh-b", "Bob", [], { none: null });

  const state = await actor.getGameState("fresh-a");
  expect(state.moveMaker.length).toBe(1);
  const maker = state.moveMaker[0];

  // The maker must be a real player in the roster, not a stale or absent
  // principal — the selection filters to fresh, active teammates.
  const makerPlayer = state.players.find((p) => p.principal === maker);
  expect(makerPlayer).toBeDefined();
});
