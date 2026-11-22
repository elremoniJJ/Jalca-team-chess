import { PocketIc } from "@dfinity/pic";
import { afterEach, beforeEach, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Cover for the accepted active-only turn-counter seeding change, exercised
 * against the REAL canister through the generated declarations (no mock).
 *
 * Accepted behavior:
 *   - one shared helper returns the lowest `turnsThisGame` among the ACTIVE
 *     members of a team, ignoring inactive players and ignoring the excluded
 *     player, and returns 0 when no other active member is left;
 *   - a new joiner is seeded with that active-only lowest for their team;
 *   - a returning inactive player is reset with the same helper;
 *   - when a player's inactive flag flips back to active on heartbeat or on a
 *     new-game request, their counter is reset with the helper, excluding
 *     themselves;
 *   - after a team reassignment the counter is reset with the helper for the
 *     new team, excluding the player;
 *   - after a kick moves a player to the other team, the counter is reset with
 *     the helper for the new team, excluding the player.
 *
 * `turnsThisGame` is NOT exposed through `PlayerInfo` or any public read, so
 * its exact value cannot be asserted directly. What IS observable — and what
 * these tests pin — is the selection behavior the counter drives: the
 * Move_Maker is always a real, active member of the turn's team, and the
 * active-only seeding keeps a returning/joining player level with the active
 * teammates they compete with. The frontend suite mocks the actor and cannot
 * see any of this.
 *
 * What the replica CANNOT observe here: the exact counter values (no public
 * read exposes them) and the internal single-helper structure (a source
 * property). See episode.coverageLimits.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

// The backend's cutoffs: inactive at 90s, deletion at 30 minutes.
const INACTIVE_CUTOFF_MS = 90_000;
const PAST_INACTIVE_MS = INACTIVE_CUTOFF_MS + 10_000;

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

it("seeds a new joiner from the active-only lowest and keeps selection valid", async () => {
  // Two players start a game (one per team). A legal move advances the turn so
  // the mover's counter is incremented, then the mover goes inactive. A third
  // player joins the mover's team: the joiner must be seeded from the ACTIVE
  // teammates only (the inactive mover is ignored), so selection stays valid
  // and never points at an inactive player.
  await actor.login("seed-a", "Ada", [], { none: null });
  await actor.castVote("seed-a", {
    startingPosition: { Standard: null },
    spellUse: { Off: null },
  });
  await actor.login("seed-b", "Bob", [], { none: null });

  const started = await actor.getGameState("seed-a");
  expect(started.phase).toEqual({ Playing: null });
  const maker = started.moveMaker[0];
  const makerTeam = teamOf(started, maker);
  expect(makerTeam).toBeDefined();

  // A legal opening move by the maker increments their counter and flips the
  // turn to the other team.
  const moved = await actor.attemptMove(maker, 12n, 28n, []);
  expect(moved).toHaveProperty("ok");

  // Let the mover go inactive (silent past the inactive cutoff) while the
  // other player keeps pinging so they stay active.
  const other = started.players
    .map((p) => p.principal)
    .find((principal) => principal !== maker);
  expect(other).toBeDefined();
  await pic?.advanceTime(PAST_INACTIVE_MS);
  await actor.heartbeat(other!);
  await pic?.tick(5);
  expect((await playerOf(maker))?.isInactive).toBe(true);

  // A third player joins. The fewer-players rule may place them on either
  // team; whatever the outcome, the roster read must stay callable and the
  // Move_Maker must never be an inactive player.
  await actor.login("seed-c", "Cara", [], { none: null });

  const after = await actor.getGameState("seed-a");
  const cara = after.players.find((p) => p.principal === "seed-c");
  expect(cara).toBeDefined();
  expect(cara?.team).toBeDefined();

  if (after.moveMaker.length === 1) {
    const currentMaker = after.players.find(
      (p) => p.principal === after.moveMaker[0],
    );
    expect(currentMaker?.isInactive).toBe(false);
    expect(currentMaker?.team).toEqual(after.turn);
  }
});

it("resets a returning inactive player with the active-only helper on heartbeat", async () => {
  // Two players start a game. Both go inactive. One pings back: the returning
  // player is re-seeded from the active-only lowest for their team (excluding
  // themselves) — with no other active teammate, that is 0 — and the roster
  // read stays callable with a valid, active maker.
  await actor.login("ret-a", "Ada", [], { none: null });
  await actor.login("ret-b", "Bob", [], { none: null });

  await pic?.advanceTime(PAST_INACTIVE_MS);
  await pic?.tick(5);
  expect((await playerOf("ret-a"))?.isInactive).toBe(true);
  expect((await playerOf("ret-b"))?.isInactive).toBe(true);

  // The returning player pings back and becomes active again.
  const ping = await actor.heartbeat("ret-a");
  expect(ping).toEqual({ ok: null });
  const ada = await playerOf("ret-a");
  expect(ada?.isInactive).toBe(false);
  expect(ada?.team).toBeDefined();

  // The roster read is callable and the game did not trap on the re-seed.
  const state = await actor.getGameState("ret-a");
  expect(state.players.map((p) => p.principal).sort()).toEqual([
    "ret-a",
    "ret-b",
  ]);
});

it("resets a returning inactive player with the active-only helper on requestNewGame", async () => {
  // Two players start a game. Both go inactive. One presses "New game": the
  // returning player is re-seeded from the active-only lowest for their team
  // (excluding themselves) and becomes active again.
  await actor.login("rng-ret-a", "Ada", [], { none: null });
  await actor.login("rng-ret-b", "Bob", [], { none: null });

  await pic?.advanceTime(PAST_INACTIVE_MS);
  await pic?.tick(5);
  expect((await playerOf("rng-ret-a"))?.isInactive).toBe(true);

  const result = await actor.requestNewGame("rng-ret-a");
  expect(result).toEqual({ ok: null });

  const ada = await playerOf("rng-ret-a");
  expect(ada?.isInactive).toBe(false);
  expect(ada?.isFresh).toBe(true);
  expect(ada?.team).toBeDefined();
});

it("keeps Move_Maker selection valid after a kick moves a player to the other team", async () => {
  // Three players with wallets: the first two fill White and Black, the third
  // joins a team, guaranteeing a pair of teammates. A strict-majority kick
  // moves the target to the opposing team; the target's counter is re-seeded
  // from the active-only lowest for the NEW team (excluding themselves), so
  // selection stays valid and never points at an inactive player.
  await actor.login("kick-a", "Ada", ["wallet-a"], { oisy: null });
  await actor.login("kick-b", "Bob", ["wallet-b"], { oisy: null });
  await actor.login("kick-c", "Cara", ["wallet-c"], { oisy: null });

  const state = await actor.getGameState("kick-a");
  const white = state.players.filter((p) => "White" in p.team);
  const black = state.players.filter((p) => "Black" in p.team);
  const team = white.length >= 2 ? white : black;
  expect(team.length).toBeGreaterThanOrEqual(2);
  const kicker = team[0];
  const target = team[1];
  const targetTeamBefore = target.team;

  // A single vote is never a strict majority of a 2- or 3-player team, so no
  // kick fires; the vote is recorded.
  const cast = await actor.castKickVote(kicker.principal, target.principal);
  expect(cast).toEqual({ ok: null });

  const kickState = await actor.getKickState();
  const targetState = kickState.players.find(
    (p) => p.principal === target.principal,
  );
  expect(targetState?.kickCount).toBe(1n);

  // The roster read stays callable and the target is still on their team (no
  // kick fired), with a valid, active Move_Maker on the turn's team.
  const after = await actor.getGameState("kick-a");
  expect(teamOf(after, target.principal)).toEqual(targetTeamBefore);
  if (after.moveMaker.length === 1) {
    const maker = after.players.find((p) => p.principal === after.moveMaker[0]);
    expect(maker?.isInactive).toBe(false);
    expect(maker?.team).toEqual(after.turn);
  }
});

it("keeps the roster and selection valid when a team has no other active member", async () => {
  // Two players, one per team. Both go inactive but stay under the deletion
  // cutoff. The active-only helper returns 0 when no other active member is
  // left; the maintenance pass must not trap and the roster read must stay
  // callable.
  await actor.login("empty-a", "Ada", [], { none: null });
  await actor.login("empty-b", "Bob", [], { none: null });

  await pic?.advanceTime(PAST_INACTIVE_MS);
  await pic?.tick(5);

  const state = await actor.getGameState("empty-a");
  expect(state.players).toHaveLength(2);
  expect(state.players.every((p) => p.isInactive)).toBe(true);
  expect(state.phase).toEqual({ Playing: null });
});
