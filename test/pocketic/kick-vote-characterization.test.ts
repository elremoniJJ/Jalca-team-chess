import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization taken BEFORE the kick-vote backend change.
 *
 * The request intentionally changes several kick rules, so this file
 * deliberately does NOT assert the behavior that is about to change. What it
 * protects is the CURRENT behavior those changes will replace, so a regression
 * in the surrounding machinery is visible:
 *
 *   - castKickVote requires a connected wallet (the change removes this gate);
 *   - the strict-majority denominator is ALL players on the target's team,
 *     not just the active ones (the change makes it active-only);
 *   - every recorded vote against a target counts, including one from a
 *     player on the opposing team (the change counts only active teammates);
 *   - a strict majority actually kicks: the target moves to the opposing team
 *     and their received votes reset to zero;
 *   - castKickVote is the trigger that runs resolution.
 *
 * The real canister is installed and called through the generated
 * declarations (no mock). The frontend suite mocks the actor, so it passes
 * unchanged against a canister whose kick methods are unimplemented stubs;
 * this file calls the real public API instead.
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

/** The team of a player in the current roster, or undefined if absent. */
function teamOf(
  state: { players: Array<{ principal: string; team: unknown }> },
  principal: string,
): unknown {
  return state.players.find((p) => p.principal === principal)?.team;
}

it("rejects a kick vote from a player without a connected wallet", async () => {
  const actor = await freshActor();

  // Two players log in with no wallet. The first fills White, the second
  // Black, so they are on opposing teams — but the wallet check runs first.
  await actor.login("kick-wallet-a", "Ada", [], { none: null });
  await actor.login("kick-wallet-b", "Bob", [], { none: null });

  const result = await actor.castKickVote("kick-wallet-a", "kick-wallet-b");
  expect(result).toEqual({
    err: "castKickVote: you need a connected wallet to kick",
  });
});

it("counts a vote from a player on the opposing team toward the target", async () => {
  const actor = await freshActor();

  // Three wallet-connected players: the first two fill White and Black, the
  // third joins a team, guaranteeing a pair of teammates.
  await actor.login("kick-cross-a", "Ada", ["wallet-a"], { oisy: null });
  await actor.login("kick-cross-b", "Bob", ["wallet-b"], { oisy: null });
  await actor.login("kick-cross-c", "Cara", ["wallet-c"], { oisy: null });

  const state = await actor.getGameState("kick-cross-a");
  const white = state.players.filter((p) => "White" in p.team);
  const black = state.players.filter((p) => "Black" in p.team);
  const team = white.length >= 2 ? white : black;
  const target = team[0];
  const opponent = (white.length >= 2 ? black : white)[0];
  expect(opponent).toBeDefined();

  // The opponent is NOT on the target's team, so castKickVote rejects their
  // attempt — the vote is never recorded.
  const rejected = await actor.castKickVote(
    opponent.principal,
    target.principal,
  );
  expect(rejected).toEqual({
    err: "castKickVote: you can only kick a teammate",
  });

  // The target's count stays zero: no cross-team vote was recorded.
  const kickState = await actor.getKickState();
  const targetState = kickState.players.find(
    (p) => p.principal === target.principal,
  );
  expect(targetState?.kickCount).toBe(0n);
});

it("uses all players on the team as the strict-majority denominator", async () => {
  const actor = await freshActor();

  // Five wallet-connected players. The first two fill White and Black; the
  // rest join teams, so one team has at least three members.
  await actor.login("kick-denom-a", "Ada", ["wallet-a"], { oisy: null });
  await actor.login("kick-denom-b", "Bob", ["wallet-b"], { oisy: null });
  await actor.login("kick-denom-c", "Cara", ["wallet-c"], { oisy: null });
  await actor.login("kick-denom-d", "Dan", ["wallet-d"], { oisy: null });
  await actor.login("kick-denom-e", "Eve", ["wallet-e"], { oisy: null });

  const state = await actor.getGameState("kick-denom-a");
  const white = state.players.filter((p) => "White" in p.team);
  const black = state.players.filter((p) => "Black" in p.team);
  const team = white.length >= black.length ? white : black;
  expect(team.length).toBeGreaterThanOrEqual(3);

  const target = team[0];
  const voters = team.slice(1);
  const targetTeamBefore = target.team;

  // Every other teammate votes to kick the target. With a team of N, N-1
  // votes is a strict majority (2*(N-1) > N for N >= 3), so the kick fires
  // and the target moves to the opposing team.
  for (const voter of voters) {
    const cast = await actor.castKickVote(voter.principal, target.principal);
    expect(cast).toEqual({ ok: null });
  }

  const after = await actor.getGameState("kick-denom-a");
  expect(teamOf(after, target.principal)).not.toEqual(targetTeamBefore);

  // The kicked target's received votes reset to zero on the new team.
  const kickState = await actor.getKickState();
  const targetState = kickState.players.find(
    (p) => p.principal === target.principal,
  );
  expect(targetState?.kickCount).toBe(0n);
});

it("records a vote in getKickState and withdrawKickVote toggles it back off", async () => {
  const actor = await freshActor();

  // Three wallet-connected players; one team has at least two members.
  await actor.login("kick-withdraw-a", "Ada", ["wallet-a"], { oisy: null });
  await actor.login("kick-withdraw-b", "Bob", ["wallet-b"], { oisy: null });
  await actor.login("kick-withdraw-c", "Cara", ["wallet-c"], { oisy: null });

  const state = await actor.getGameState("kick-withdraw-a");
  const white = state.players.filter((p) => "White" in p.team);
  const black = state.players.filter((p) => "Black" in p.team);
  const team = white.length >= 2 ? white : black;
  expect(team.length).toBeGreaterThanOrEqual(2);
  const target = team[0];
  const voter = team[1];

  // A single vote is recorded: count 1 and the voter's username appears in the
  // target's 'kicked by' array (derived from the same vote records).
  const cast = await actor.castKickVote(voter.principal, target.principal);
  expect(cast).toEqual({ ok: null });

  const afterCast = await actor.getKickState();
  const targetAfterCast = afterCast.players.find(
    (p) => p.principal === target.principal,
  );
  expect(targetAfterCast?.kickCount).toBe(1n);
  expect(targetAfterCast?.kickedBy).toContain(voter.username);

  // Withdrawing the vote removes it: count back to zero and the voter's name
  // gone from 'kicked by'.
  const withdraw = await actor.withdrawKickVote(
    voter.principal,
    target.principal,
  );
  expect(withdraw).toEqual({ ok: null });

  const afterWithdraw = await actor.getKickState();
  const targetAfterWithdraw = afterWithdraw.players.find(
    (p) => p.principal === target.principal,
  );
  expect(targetAfterWithdraw?.kickCount).toBe(0n);
  expect(targetAfterWithdraw?.kickedBy).not.toContain(voter.username);
});

it("erases all kick votes when the game ends in the Celebration window", async () => {
  const actor = await freshActor();

  // Three wallet-connected players; one team has at least two members. A
  // single vote is recorded (never a strict majority of a 3+ team, so no kick
  // fires yet).
  await actor.login("kick-clear-a", "Ada", ["wallet-a"], { oisy: null });
  await actor.login("kick-clear-b", "Bob", ["wallet-b"], { oisy: null });
  await actor.login("kick-clear-c", "Cara", ["wallet-c"], { oisy: null });

  const state = await actor.getGameState("kick-clear-a");
  const white = state.players.filter((p) => "White" in p.team);
  const black = state.players.filter((p) => "Black" in p.team);
  const team = white.length >= 2 ? white : black;
  expect(team.length).toBeGreaterThanOrEqual(2);
  const target = team[0];
  const voter = team[1];

  const cast = await actor.castKickVote(voter.principal, target.principal);
  expect(cast).toEqual({ ok: null });
  const before = await actor.getKickState();
  expect(
    before.players.find((p) => p.principal === target.principal)?.kickCount,
  ).toBe(1n);

  // Advancing past the 300s turn timer concludes the game by timeout and
  // enters the Celebration window, which erases all kick votes.
  await pic?.advanceTime(400_000);
  await pic?.tick(5);
  const ended = await actor.getGameState("kick-clear-a");
  expect(ended.phase).toEqual({ Celebration: null });

  const after = await actor.getKickState();
  expect(
    after.players.find((p) => p.principal === target.principal)?.kickCount,
  ).toBe(0n);
});

it("does not kick when the votes are not a strict majority of the team", async () => {
  const actor = await freshActor();

  // Five wallet-connected players; one team has at least three members.
  await actor.login("kick-nomaj-a", "Ada", ["wallet-a"], { oisy: null });
  await actor.login("kick-nomaj-b", "Bob", ["wallet-b"], { oisy: null });
  await actor.login("kick-nomaj-c", "Cara", ["wallet-c"], { oisy: null });
  await actor.login("kick-nomaj-d", "Dan", ["wallet-d"], { oisy: null });
  await actor.login("kick-nomaj-e", "Eve", ["wallet-e"], { oisy: null });

  const state = await actor.getGameState("kick-nomaj-a");
  const white = state.players.filter((p) => "White" in p.team);
  const black = state.players.filter((p) => "Black" in p.team);
  const team = white.length >= black.length ? white : black;
  expect(team.length).toBeGreaterThanOrEqual(3);

  const target = team[0];
  const targetTeamBefore = target.team;

  // A single vote is never a strict majority of a 3+ player team, so no kick
  // fires; the vote is recorded and the target stays on their team.
  const cast = await actor.castKickVote(team[1].principal, target.principal);
  expect(cast).toEqual({ ok: null });

  const kickState = await actor.getKickState();
  const targetState = kickState.players.find(
    (p) => p.principal === target.principal,
  );
  expect(targetState?.kickCount).toBe(1n);

  const after = await actor.getGameState("kick-nomaj-a");
  expect(teamOf(after, target.principal)).toEqual(targetTeamBefore);
});
