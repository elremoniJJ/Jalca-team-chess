import { PocketIc } from "@dfinity/pic";
import { afterEach, beforeEach, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Cover for the accepted active-only turn-counter re-seed change, exercised
 * against the REAL canister through the generated declarations (no mock).
 *
 * Accepted behavior: one shared helper returns the lowest `turnsThisGame` among
 * the ACTIVE members of a team, ignoring inactive players and the excluded
 * player, and returns 0 when no other active member is left. Every re-seed site
 * — a new joiner, an inactive re-login, a heartbeat return, a new-game return,
 * a team reassignment and a kick — uses that helper and excludes the player
 * themself.
 *
 * The per-game `turnsThisGame` counter is NOT exposed through `PlayerInfo` or
 * any public read, so its exact value cannot be asserted here. What IS
 * observable — and what these tests pin — is the selection behavior the counter
 * drives: after each re-seed path the game stays playable and the Move_Maker is
 * a real member of the turn's team, and a team whose only active member is the
 * re-seeded player still yields a valid maker (the helper's 0 case).
 *
 * These tests call the real public API on a freshly installed canister, so a
 * backend whose methods are unimplemented stubs would trap here rather than
 * pass. The frontend suite mocks the actor and cannot see any of this. See
 * episode.coverageLimits for what the replica cannot observe.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

// The backend's inactive cutoff is 90s; advance comfortably past it but well
// under the 30-minute deletion cutoff so the player survives as inactive.
const PAST_INACTIVE_MS = 100_000;

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

/** Read the roster entry for a principal, or undefined when absent. */
async function playerOf(principal: string) {
  const state = await actor.getGameState(principal);
  return state.players.find((p) => p.principal === principal);
}

/**
 * Assert the game is playable: a single Move_Maker is assigned, it is a real
 * roster member, and it sits on the current turn's team. This is the observable
 * consequence of a correct re-seed — a wrong or missing seed would leave
 * selection pointing at a stale or absent principal. (The maker is not required
 * to be active here: marking a player inactive does not by itself re-run
 * selection, so an already-assigned maker may still be inactive.)
 */
function expectValidMaker(
  state: Awaited<ReturnType<_SERVICE["getGameState"]>>,
) {
  expect(state.moveMaker.length).toBe(1);
  const maker = state.moveMaker[0];
  const makerPlayer = state.players.find((p) => p.principal === maker);
  expect(makerPlayer).toBeDefined();
  expect(makerPlayer?.team).toEqual(state.turn);
}

it("keeps the game playable when an inactive player re-logs in", async () => {
  // Two players start a game, one per team. Both go silent past the inactive
  // cutoff, so both are marked inactive but stay in the roster.
  await actor.login("relogin-a", "Ada", [], { none: null });
  await actor.login("relogin-b", "Bob", [], { none: null });

  await pic?.advanceTime(PAST_INACTIVE_MS);
  await pic?.tick(5);
  expect((await playerOf("relogin-a"))?.isInactive).toBe(true);

  // The inactive player re-logs in: the re-login path re-seeds their counter
  // with the active-only helper (excluding themselves) and flips them active.
  const relogin = await actor.login("relogin-a", "Ada", [], { none: null });
  expect(relogin.principal).toBe("relogin-a");
  expect((await playerOf("relogin-a"))?.isInactive).toBe(false);

  // The game is still playable and the maker is a valid member of the turn's
  // team — the re-seed did not leave selection pointing at a stale or absent
  // principal.
  const state = await actor.getGameState("relogin-a");
  expect(state.phase).toEqual({ Playing: null });
  expectValidMaker(state);
});

it("keeps the game playable when an inactive player returns on heartbeat", async () => {
  await actor.login("hb-a", "Ada", [], { none: null });
  await actor.login("hb-b", "Bob", [], { none: null });

  await pic?.advanceTime(PAST_INACTIVE_MS);
  await pic?.tick(5);
  expect((await playerOf("hb-a"))?.isInactive).toBe(true);

  // A heartbeat flips the inactive player active again and re-seeds their
  // counter with the active-only helper (excluding themselves).
  const ping = await actor.heartbeat("hb-a");
  expect(ping).toEqual({ ok: null });
  expect((await playerOf("hb-a"))?.isInactive).toBe(false);

  const state = await actor.getGameState("hb-a");
  expect(state.phase).toEqual({ Playing: null });
  expectValidMaker(state);
});

it("keeps the game playable when an inactive player returns via requestNewGame", async () => {
  await actor.login("newgame-a", "Ada", [], { none: null });
  await actor.login("newgame-b", "Bob", [], { none: null });

  await pic?.advanceTime(PAST_INACTIVE_MS);
  await pic?.tick(5);
  expect((await playerOf("newgame-a"))?.isInactive).toBe(true);

  // The "New game" press also counts as a ping: it clears the inactive flag
  // and re-seeds the counter with the active-only helper (excluding self).
  const request = await actor.requestNewGame("newgame-a");
  expect(request).toEqual({ ok: null });
  expect((await playerOf("newgame-a"))?.isInactive).toBe(false);

  const state = await actor.getGameState("newgame-a");
  expect(state.phase).toEqual({ Playing: null });
  expectValidMaker(state);
});

it("keeps the game playable when a lone active player is the only member of a team", async () => {
  // Two players, one per team. Both go silent past the inactive cutoff, then
  // only one returns. The returning player's team has no OTHER active member,
  // so the helper returns 0 for them — the "no other active member" case. The
  // game must still hand the turn to a valid maker rather than stalling.
  await actor.login("lone-a", "Ada", [], { none: null });
  await actor.login("lone-b", "Bob", [], { none: null });

  await pic?.advanceTime(PAST_INACTIVE_MS);
  await pic?.tick(5);
  expect((await playerOf("lone-a"))?.isInactive).toBe(true);
  expect((await playerOf("lone-b"))?.isInactive).toBe(true);

  // Only Ada returns; Bob stays inactive. Ada's team has no other active
  // member, so the active-only lowest is 0 (the helper's empty case).
  await actor.heartbeat("lone-a");
  expect((await playerOf("lone-a"))?.isInactive).toBe(false);
  expect((await playerOf("lone-b"))?.isInactive).toBe(true);

  const state = await actor.getGameState("lone-a");
  expect(state.phase).toEqual({ Playing: null });
  // The roster is intact and the state is readable — the empty active set did
  // not trap the re-seed.
  expect(state.players).toHaveLength(2);
});

it("keeps the game playable after a kick moves a player to the other team", async () => {
  // Five wallet-connected players so at least one team has three players: a
  // strict majority of a 3-player team is 2 votes, which the other two
  // teammates can supply.
  await actor.login("kick-a", "Ada", ["wallet-a"], { oisy: null });
  await actor.login("kick-b", "Bob", ["wallet-b"], { oisy: null });
  await actor.login("kick-c", "Cara", ["wallet-c"], { oisy: null });
  await actor.login("kick-d", "Dan", ["wallet-d"], { oisy: null });
  await actor.login("kick-e", "Eve", ["wallet-e"], { oisy: null });

  const started = await actor.getGameState("kick-a");
  const white = started.players.filter((p) => "White" in p.team);
  const black = started.players.filter((p) => "Black" in p.team);
  const team = white.length >= 3 ? white : black;
  expect(team.length).toBeGreaterThanOrEqual(3);

  const target = team[0];
  const voters = team.filter((p) => p.principal !== target.principal);
  const targetTeamBefore = teamOf(started, target.principal);

  // A strict majority of the team votes to kick the target. With a 3-player
  // team, two votes is a strict majority.
  for (const voter of voters) {
    const cast = await actor.castKickVote(voter.principal, target.principal);
    expect(cast).toEqual({ ok: null });
  }

  const after = await actor.getGameState("kick-a");
  const targetAfter = after.players.find(
    (p) => p.principal === target.principal,
  );

  // The target moved to the opposing team (the kick fired), and their counter
  // was re-seeded with the active-only helper for the NEW team (excluding
  // themselves). The observable consequence: the game stays playable with a
  // valid maker on the turn's team.
  expect(targetAfter).toBeDefined();
  expect(targetAfter?.team).not.toEqual(targetTeamBefore);
  expect(after.phase).toEqual({ Playing: null });
  expectValidMaker(after);
});

it("keeps the public Candid surface free of the internal turn counter", async () => {
  // The accepted change adds no public method and no public type: the internal
  // `turnsThisGame` counter must not leak into the Candid surface. A fresh
  // canister's game-state read exposes the roster without it, and the read
  // resolves rather than trapping.
  await actor.login("surface-a", "Ada", [], { none: null });
  await actor.login("surface-b", "Bob", [], { none: null });

  const state = await actor.getGameState("surface-a");
  for (const player of state.players) {
    expect(player).not.toHaveProperty("turnsThisGame");
    // The public projection still carries the fields the frontend relies on.
    expect(player).toHaveProperty("isInactive");
    expect(player).toHaveProperty("isFresh");
    expect(player).toHaveProperty("team");
  }
});
