import { PocketIc } from "@dfinity/pic";
import { afterEach, beforeEach, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Cover for the accepted kick-vote change, exercised against the REAL canister
 * through the generated declarations (no mock).
 *
 * Accepted behavior:
 *   - `castKickVote` no longer requires a connected wallet: a caller with no
 *     wallet address can vote, and a self-vote is rejected with the exact text
 *     "castKickVote: you cannot vote to kick yourself";
 *   - the strict-majority denominator is the ACTIVE (non-inactive) team size,
 *     not all players on the team;
 *   - only votes from currently active teammates other than the target count;
 *     votes from inactive players or from the opposing team are kept but
 *     ignored, and count again once the voter is active;
 *   - the synchronous core applies every kick it decides in one pass, including
 *     a chain where one kick tips a second target over;
 *   - no kick is applied while the phase is Celebration or Draw;
 *   - a player who leaves (logout) has both their outgoing votes and the votes
 *     against them removed.
 *
 * The maintenance pass and the inactive flag are driven by the backend's own
 * recurring timer: the IC clock is advanced with `advanceTime` and rounds are
 * produced with `tick`, so the cutoffs are exercised through the real timer
 * path. The frontend suite mocks the actor and cannot see any of this.
 *
 * What the replica CANNOT observe here: the async Move_Maker redraw tail's
 * random choice (only that a maker is present and active), and the exact
 * "about 90s" wording — the tests use the backend's own cutoff with margin.
 * See episode.coverageLimits.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

// The backend's inactive cutoff is 90s; stay comfortably past it but well
// under the 30-minute deletion cutoff.
const PAST_INACTIVE_MS = 100_000;
// The backend's deletion cutoff is 30 minutes; stay comfortably past it.
const PAST_DELETION_MS = 1_860_000;

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

/** Read the roster entry for a principal, or undefined when absent. */
async function playerOf(principal: string) {
  const state = await actor.getGameState(principal);
  return state.players.find((p) => p.principal === principal);
}

/** The team of a player in the current roster, or undefined if absent. */
async function teamOf(principal: string): Promise<unknown> {
  return (await playerOf(principal))?.team;
}

/** The kick count recorded against a principal in getKickState. */
async function kickCountOf(principal: string): Promise<bigint | undefined> {
  const state = await actor.getKickState();
  return state.players.find((p) => p.principal === principal)?.kickCount;
}

/**
 * Log in `count` wallet-less players and return the roster split by team. The
 * first two fill White and Black; the rest join the team with fewer players.
 */
async function seedPlayers(
  prefix: string,
  count: number,
): Promise<{ white: string[]; black: string[] }> {
  for (let i = 0; i < count; i += 1) {
    await actor.login(`${prefix}-${i}`, `${prefix}${i}`, [], { none: null });
  }
  const state = await actor.getGameState(`${prefix}-0`);
  const white = state.players
    .filter((p) => "White" in p.team)
    .map((p) => p.principal);
  const black = state.players
    .filter((p) => "Black" in p.team)
    .map((p) => p.principal);
  return { white, black };
}

it("accepts a kick vote from a caller with no wallet address", async () => {
  // Two wallet-less players on opposing teams. The vote is rejected for the
  // team reason, never for a missing wallet — proving the wallet gate is gone.
  const { white, black } = await seedPlayers("nowallet", 2);
  const target = white[0];
  const opponent = black[0];

  const result = await actor.castKickVote(opponent, target);
  expect(result).toEqual({ err: "castKickVote: you can only kick a teammate" });
});

it("rejects a self-vote with the exact error text", async () => {
  const { white } = await seedPlayers("selfvote", 2);
  const caller = white[0];

  const result = await actor.castKickVote(caller, caller);
  expect(result).toEqual({
    err: "castKickVote: you cannot vote to kick yourself",
  });
});

it("kicks only when active teammates other than the target are a strict majority", async () => {
  // Four players: two per team. The target's team has 2 active members, so a
  // single teammate vote is a strict majority (1*2 > 2 is false; 2*2 > 2 is
  // true) — one vote is NOT enough, two are. With only one other teammate, the
  // target can never be kicked by a single vote.
  const { white, black } = await seedPlayers("majority", 4);
  const team = white.length >= 2 ? white : black;
  const target = team[0];
  const voter = team[1];
  const targetTeamBefore = await teamOf(target);

  const cast = await actor.castKickVote(voter, target);
  expect(cast).toEqual({ ok: null });

  // One vote against a 2-active team is not a strict majority: no kick.
  expect(await teamOf(target)).toEqual(targetTeamBefore);
  expect(await kickCountOf(target)).toBe(1n);
});

it("uses the active team size as the denominator, not all players on the team", async () => {
  // Ten players: five per team. The target's team has 5 members. Make one
  // non-target teammate inactive; the active team size drops to 4, so three
  // active teammates' votes become a strict majority of the smaller active
  // team (3*2 > 4) even though they are NOT a majority of all 5 players
  // (3*2 > 5 is false). This distinguishes the active-only denominator from
  // the old all-players one.
  const { white, black } = await seedPlayers("denom", 10);
  const team = white.length >= black.length ? white : black;
  expect(team.length).toBeGreaterThanOrEqual(5);
  const target = team[0];
  const voters = team.slice(1);
  const targetTeamBefore = await teamOf(target);

  // Let every player go silent past the inactive cutoff, then reactivate the
  // target and all but one voter. The one still-inactive voter is excluded
  // from both the denominator and the vote count. No votes are cast yet, so
  // the reactivations cannot trigger a kick.
  await pic?.advanceTime(PAST_INACTIVE_MS);
  await pic?.tick(5);
  const inactiveVoter = voters[voters.length - 1];
  const activeVoters = voters.slice(0, voters.length - 1);
  await actor.heartbeat(target);
  for (const voter of activeVoters) {
    await actor.heartbeat(voter);
  }
  expect((await playerOf(inactiveVoter))?.isInactive).toBe(true);

  // Active team size is now 1 (target) + activeVoters.length = 4. Two active
  // voters vote: 2*2 > 4 is false, so no kick yet.
  expect(await actor.castKickVote(activeVoters[0], target)).toEqual({
    ok: null,
  });
  expect(await actor.castKickVote(activeVoters[1], target)).toEqual({
    ok: null,
  });
  expect(await teamOf(target)).toEqual(targetTeamBefore);

  // A third active voter tips it over: 3*2 > 4 is true, so the target is
  // kicked. The inactive voter never voted and is not counted.
  expect(await actor.castKickVote(activeVoters[2], target)).toEqual({
    ok: null,
  });
  expect(await teamOf(target)).not.toEqual(targetTeamBefore);
});

it("ignores an inactive voter's vote but counts it again once they return", async () => {
  // Five players: three on the target's team. A single teammate vote is never
  // a strict majority of a 3-active team, so reactivating the voter cannot
  // itself tip a kick. We make the voter inactive and confirm their vote is
  // ignored, then reactivate them and confirm it counts again.
  const { white, black } = await seedPlayers("idlevoter", 5);
  const team = white.length >= black.length ? white : black;
  expect(team.length).toBeGreaterThanOrEqual(3);
  const target = team[0];
  const voter = team[1];
  const other = team[2];
  const targetTeamBefore = await teamOf(target);

  // The voter casts while active, then everyone goes silent.
  const cast = await actor.castKickVote(voter, target);
  expect(cast).toEqual({ ok: null });
  await pic?.advanceTime(PAST_INACTIVE_MS);
  await pic?.tick(5);
  expect((await playerOf(voter))?.isInactive).toBe(true);

  // Reactivate the target and the other teammate, leaving the voter inactive.
  // Active team size is 2, the voter's vote is ignored, so the count is zero
  // and the target is not kicked.
  await actor.heartbeat(target);
  await actor.heartbeat(other);
  expect((await playerOf(voter))?.isInactive).toBe(true);
  expect(await kickCountOf(target)).toBe(0n);
  expect(await teamOf(target)).toEqual(targetTeamBefore);

  // The voter returns: their kept vote counts again (1 of 3 active, still not
  // a majority, so no kick).
  await actor.heartbeat(voter);
  expect((await playerOf(voter))?.isInactive).toBe(false);
  expect(await kickCountOf(target)).toBe(1n);
  expect(await teamOf(target)).toEqual(targetTeamBefore);
});

it("applies a chain of kicks in one pass when one kick tips a second target over", async () => {
  // Eight players: four per team. The target's team is [A, B, v1, v2]. Two
  // votes are recorded against B (from v1 and v2) and three against A (from
  // v1, v2 and B). Kicking A needs 3 votes of 4 (3*2 > 4); once A is kicked
  // the team shrinks to 3, so B's 2 votes become a strict majority (2*2 > 3)
  // and B is kicked in the SAME synchronous pass.
  const { white, black } = await seedPlayers("chain", 8);
  const team = white.length >= black.length ? white : black;
  expect(team.length).toBeGreaterThanOrEqual(4);
  const [targetA, targetB, voter1, voter2] = team;
  const teamBefore = await teamOf(targetA);

  // Two votes against B: not a majority of 4 yet.
  expect(await actor.castKickVote(voter1, targetB)).toEqual({ ok: null });
  expect(await actor.castKickVote(voter2, targetB)).toEqual({ ok: null });
  // Two votes against A: still not a majority of 4.
  expect(await actor.castKickVote(voter1, targetA)).toEqual({ ok: null });
  expect(await actor.castKickVote(voter2, targetA)).toEqual({ ok: null });
  expect(await teamOf(targetA)).toEqual(teamBefore);
  expect(await teamOf(targetB)).toEqual(teamBefore);

  // The third vote against A tips it over. The synchronous core kicks A,
  // re-snapshots, and the shrunken active team now makes B's two votes a
  // strict majority too — both are kicked in the same pass.
  expect(await actor.castKickVote(targetB, targetA)).toEqual({ ok: null });

  expect(await teamOf(targetA)).not.toEqual(teamBefore);
  expect(await teamOf(targetB)).not.toEqual(teamBefore);
});

it("applies no kick while the phase is Celebration", async () => {
  // Two players start a game. Advancing past the 300s turn timer concludes it
  // by timeout and enters the Celebration window, which clears all votes.
  const { white, black } = await seedPlayers("celeb", 4);
  const team = white.length >= 2 ? white : black;
  const target = team[0];
  const voter = team[1];
  const targetTeamBefore = await teamOf(target);

  // Record a vote before the game ends.
  expect(await actor.castKickVote(voter, target)).toEqual({ ok: null });

  await pic?.advanceTime(400_000);
  await pic?.tick(5);
  const ended = await actor.getGameState(target);
  expect(ended.phase).toEqual({ Celebration: null });

  // The Celebration window clears all votes, so no kick is applied and the
  // target stays on their team.
  expect(await kickCountOf(target)).toBe(0n);
  expect(await teamOf(target)).toEqual(targetTeamBefore);
});

it("applies no kick while the phase is Draw", async () => {
  // Two players start a game. `concludeByInsufficientMaterial` moves the game
  // to the Draw phase (the same conclusion the burn-and-play path delegates
  // to). A vote recorded before the draw must not kick anyone: the synchronous
  // core is phase-gated on Draw.
  const { white, black } = await seedPlayers("draw", 4);
  const team = white.length >= 2 ? white : black;
  const target = team[0];
  const voter = team[1];
  const targetTeamBefore = await teamOf(target);

  // Record a vote before the game ends. With a 2-active team a single vote is
  // not a strict majority, so no kick fires yet.
  expect(await actor.castKickVote(voter, target)).toEqual({ ok: null });

  await actor.concludeByInsufficientMaterial(1_700_000_000_000_000_000n);
  const ended = await actor.getGameState(target);
  expect(ended.phase).toEqual({ Draw: null });

  // The Draw window clears all votes, so no kick is applied and the target
  // stays on their team.
  expect(await kickCountOf(target)).toBe(0n);
  expect(await teamOf(target)).toEqual(targetTeamBefore);
});

it("removes both outgoing and incoming votes when a player is deleted as stale", async () => {
  // Four players: two per team. The stale player has voted against a teammate
  // and been voted against by another teammate. After the deletion cutoff the
  // maintenance pass removes them and both directions of their votes.
  const { white, black } = await seedPlayers("stale", 4);
  const team = white.length >= 2 ? white : black;
  const leaver = team[0];
  const teammate = team[1];

  // The leaver votes against a teammate; a teammate votes against the leaver.
  expect(await actor.castKickVote(leaver, teammate)).toEqual({ ok: null });
  expect(await actor.castKickVote(teammate, leaver)).toEqual({ ok: null });
  expect(await kickCountOf(teammate)).toBe(1n);
  expect(await kickCountOf(leaver)).toBe(1n);

  // Advance past the deletion cutoff, then ping the teammate so their lastPing
  // is current when the recurring maintenance timer runs on the next tick. The
  // leaver stays silent and is deleted; the teammate survives.
  await pic?.advanceTime(PAST_DELETION_MS);
  await actor.heartbeat(teammate);
  await pic?.tick(5);

  // The leaver is gone; their outgoing vote against the teammate is removed
  // and the votes against them are gone with them.
  expect(await playerOf(leaver)).toBeUndefined();
  expect(await kickCountOf(teammate)).toBe(0n);
  expect(await kickCountOf(leaver)).toBeUndefined();
});

it("redraws the Move_Maker for a kicked Move_Maker", async () => {
  // Six players: three per team. The game starts and a Move_Maker is assigned.
  // We kick the maker (a strict majority of their active team) and assert the
  // Move_Maker role is redrawn to a remaining active player on the old team,
  // never left pointing at the kicked principal.
  const { white, black } = await seedPlayers("kickmm", 6);
  const started = await actor.getGameState(white[0]);
  expect(started.phase).toEqual({ Playing: null });
  expect(started.moveMaker.length).toBe(1);
  const maker = started.moveMaker[0];
  const makerTeam = started.players.find((p) => p.principal === maker)?.team;
  expect(makerTeam).toBeDefined();

  // The maker's teammates (the voters). With six players each team has three
  // members, so the maker's team has two teammates. Team is a variant object,
  // so compare structurally rather than by reference.
  const teammates = started.players
    .filter(
      (p) => p.principal !== maker && JSON.stringify(p.team) === JSON.stringify(makerTeam),
    )
    .map((p) => p.principal);
  expect(teammates.length).toBeGreaterThanOrEqual(2);

  // Every teammate votes to kick the maker. With an active team of 3, two
  // votes are a strict majority (2*2 > 3), so the maker is kicked.
  for (const voter of teammates) {
    expect(await actor.castKickVote(voter, maker)).toEqual({ ok: null });
  }

  const after = await actor.getGameState(white[0]);
  // The maker was kicked off their team.
  expect(await teamOf(maker)).not.toEqual(makerTeam);
  // The Move_Maker role is redrawn: it never points at the kicked principal,
  // and any new maker is an active player on the old team.
  expect(after.moveMaker[0]).not.toBe(maker);
  if (after.moveMaker.length === 1) {
    const newMaker = after.players.find(
      (p) => p.principal === after.moveMaker[0],
    );
    expect(newMaker?.team).toEqual(makerTeam);
    expect(newMaker?.isInactive).toBe(false);
  }
});

it("removes both outgoing and incoming votes when a player logs out", async () => {
  // Four players: two per team. The leaver has voted against a teammate and
  // been voted against by another teammate. On logout both directions are
  // removed.
  const { white, black } = await seedPlayers("logout", 4);
  const team = white.length >= 2 ? white : black;
  const leaver = team[0];
  const teammate = team[1];
  const otherTeam = white.length >= 2 ? black : white;
  const opponent = otherTeam[0];

  // The leaver votes against a teammate; a teammate votes against the leaver.
  expect(await actor.castKickVote(leaver, teammate)).toEqual({ ok: null });
  expect(await actor.castKickVote(teammate, leaver)).toEqual({ ok: null });
  expect(await kickCountOf(teammate)).toBe(1n);
  expect(await kickCountOf(leaver)).toBe(1n);

  await actor.logout(leaver);

  // The leaver is gone; their outgoing vote against the teammate is removed
  // and the votes against them are gone with them (the leaver no longer
  // appears in the kick state at all).
  expect(await playerOf(leaver)).toBeUndefined();
  expect(await kickCountOf(teammate)).toBe(0n);
  expect(await kickCountOf(leaver)).toBeUndefined();
  // The opponent is untouched by the leaver's departure.
  expect(await playerOf(opponent)).toBeDefined();
});
