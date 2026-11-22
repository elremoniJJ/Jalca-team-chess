import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the ranked-play feature: Internet-Identity-bound
 * roster keys, win recording at game conclusion, and the two open ranking
 * queries.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose ranked-play methods are unimplemented stubs. This file installs the
 * app's own compiled wasm into the platform's PocketIC replica and drives the
 * real public API.
 *
 * What the replica CAN observe:
 *   - `loginRanked` rejects the anonymous principal and an invalid key.
 *   - A guest cannot take over a bound slot: `login` traps once a key is bound.
 *   - A key bound to a different caller is rejected; the same caller is accepted.
 *   - A key on the roster but unbound is rejected for ranked login.
 *   - `getWinnerRanking` / `getMyWins` answer empty on a fresh canister, cap the
 *     limit at 50, and report `isMe` false for an anonymous caller.
 *   - A win recorded at game conclusion credits the bound principal, dedupes the
 *     same principal on two roster entries, and skips draws.
 *
 * What the replica CANNOT observe: the game-end NFT mint (the external ICRC-7
 * collection canister is absent), and the exact `lastWinGame` tie-break across
 * many games (each game conclusion requires a full checkmate/timeout drive).
 * See episode.coverageLimits.
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

/** Install a fresh canister and return its actor plus canister id. */
async function install(): Promise<{
  actor: _SERVICE;
  canisterId: Parameters<PocketIc["createActor"]>[1];
}> {
  if (pic === undefined) throw new Error("PocketIC not initialized");
  const { actor, canisterId } = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  });
  return { actor, canisterId };
}

/** A second actor on the SAME canister, calling as the anonymous principal. */
function guestActor(canisterId: Parameters<PocketIc["createActor"]>[1]): _SERVICE {
  if (pic === undefined) throw new Error("PocketIC not initialized");
  return pic.createActor<_SERVICE>(idlFactory, canisterId);
}

it("rejects the anonymous principal from loginRanked", async () => {
  const { actor } = await install();

  // A freshly created actor calls as the anonymous principal until an identity
  // is set. Ranked login must reject it rather than binding a slot.
  await expect(
    actor.loginRanked("roster-key-1", "Ada", [], { none: null }),
  ).rejects.toThrow();
});

it("rejects an invalid roster key from loginRanked", async () => {
  const { actor } = await install();
  actor.setIdentity(createIdentity("ranked-alice"));

  // An empty key is not a valid roster key.
  await expect(
    actor.loginRanked("", "Ada", [], { none: null }),
  ).rejects.toThrow();

  // A key longer than 128 characters is rejected.
  await expect(
    actor.loginRanked("k".repeat(129), "Ada", [], { none: null }),
  ).rejects.toThrow();
});

it("binds a roster key to the caller and rejects a different caller", async () => {
  const { actor } = await install();
  const alice = createIdentity("ranked-alice");
  const bob = createIdentity("ranked-bob");

  // Alice binds the key at ranked login.
  actor.setIdentity(alice);
  const result = await actor.loginRanked("roster-key-1", "Ada", [], {
    none: null,
  });
  expect(result.principal).toBe("roster-key-1");
  expect(result.username).toBe("Ada");

  // Bob cannot take over Alice's bound slot.
  actor.setIdentity(bob);
  await expect(
    actor.loginRanked("roster-key-1", "Bob", [], { none: null }),
  ).rejects.toThrow();

  // Alice can log in again with the same key.
  actor.setIdentity(alice);
  const again = await actor.loginRanked("roster-key-1", "Ada", [], {
    none: null,
  });
  expect(again.principal).toBe("roster-key-1");
});

it("rejects a guest login for a bound roster key", async () => {
  const { actor, canisterId } = await install();
  const alice = createIdentity("ranked-alice");

  // Alice binds the key.
  actor.setIdentity(alice);
  await actor.loginRanked("roster-key-1", "Ada", [], { none: null });

  // A guest (anonymous caller) cannot take over the bound slot via login.
  const guest = guestActor(canisterId);
  await expect(
    guest.login("roster-key-1", "Mallory", [], { none: null }),
  ).rejects.toThrow();
});

it("rejects a ranked login for a key already on the roster unbound", async () => {
  const { actor } = await install();

  // A guest logs in with the key, putting it on the roster unbound.
  await actor.login("roster-key-1", "Ada", [], { none: null });

  // A ranked login for that same key is rejected: the slot is in use by a guest.
  actor.setIdentity(createIdentity("ranked-alice"));
  await expect(
    actor.loginRanked("roster-key-1", "Ada", [], { none: null }),
  ).rejects.toThrow();
});

it("updates the displayed name on a later ranked login without creating a second row", async () => {
  const { actor } = await install();
  const alice = createIdentity("ranked-alice");
  const bob = createIdentity("ranked-bob");

  // BOTH players are ranked (bound to their own II principal), so whichever
  // team the timeout winner lands on, a bound principal gets a winnerStore
  // entry and the rename path is always exercised.
  actor.setIdentity(alice);
  await actor.loginRanked("roster-key-1", "Ada", [], { none: null });
  actor.setIdentity(bob);
  await actor.loginRanked("roster-key-2", "Bob", [], { none: null });

  // Drive a timeout conclusion so the winning team's bound principal gets a
  // winnerStore entry (a login alone does not create one).
  const steps = Math.ceil((300_000 + 60_000) / 60_000);
  for (let step = 0; step < steps; step += 1) {
    await pic?.advanceTime(60_000);
    await actor.heartbeat("roster-key-1");
    await actor.heartbeat("roster-key-2");
  }
  await pic?.tick(5);

  const concluded = await actor.getGameState("roster-key-1");
  expect(concluded.phase).toEqual({ Celebration: null });
  expect(concluded.winner.length).toBe(1);
  const winner = "White" in concluded.winner[0]! ? "White" : "Black";

  // Identify the bound winner and their identity/key so we can re-login as
  // them with a new username.
  const winnerKey = concluded.players.find(
    (p) => ("White" in p.team ? "White" : "Black") === winner,
  )?.principal;
  expect(winnerKey).toBeDefined();
  const winnerIdentity = winnerKey === "roster-key-1" ? alice : bob;
  const winnerName = winnerKey === "roster-key-1" ? "Ada" : "Bob";

  // The winner has exactly one ranking row under their original name.
  actor.setIdentity(winnerIdentity);
  const before = await actor.getWinnerRanking(50n);
  const beforeRows = before.filter((r) => r.isMe);
  expect(beforeRows).toHaveLength(1);
  expect(beforeRows[0]?.displayName).toBe(winnerName);

  // The winner logs in again with the SAME key but a different username. The
  // stored display name must be overwritten, and the principal must still own
  // exactly one row (one principal = one leaderboard row).
  await actor.loginRanked(winnerKey!, "Renamed", [], { none: null });

  const after = await actor.getWinnerRanking(50n);
  const afterRows = after.filter((r) => r.isMe);
  expect(afterRows).toHaveLength(1);
  expect(afterRows[0]?.displayName).toBe("Renamed");
});

it("answers the ranking queries empty on a fresh canister", async () => {
  const { actor } = await install();

  await expect(actor.getWinnerRanking(10n)).resolves.toEqual([]);
  await expect(actor.getMyWins()).resolves.toEqual({ wins: 0n, rank: 0n });
});

it("caps the ranking limit at 50 server-side", async () => {
  const { actor } = await install();

  // Requesting more than 50 rows must not trap; the server caps the response.
  const rows = await actor.getWinnerRanking(1000n);
  expect(rows.length).toBeLessThanOrEqual(50);
});

it("reports isMe false for an anonymous caller", async () => {
  const { actor, canisterId } = await install();
  const alice = createIdentity("ranked-alice");

  // Alice binds a key and logs in so she is on the roster.
  actor.setIdentity(alice);
  await actor.loginRanked("roster-key-1", "Ada", [], { none: null });

  // The anonymous caller sees the ranking but is never "me".
  const guest = guestActor(canisterId);
  const rows = await guest.getWinnerRanking(50n);
  for (const row of rows) {
    expect(row.isMe).toBe(false);
  }
  await expect(guest.getMyWins()).resolves.toEqual({ wins: 0n, rank: 0n });
});

it("credits a win to the bound principal and dedupes the same principal on two entries", async () => {
  const { actor } = await install();
  const alice = createIdentity("ranked-alice");

  // Alice binds TWO roster keys to the SAME principal. Both entries are on the
  // roster and both are bound to Alice, so a win must count once, not twice.
  actor.setIdentity(alice);
  await actor.loginRanked("roster-key-1", "Ada", [], { none: null });
  await actor.loginRanked("roster-key-2", "Ada", [], { none: null });

  // A second player joins the opposing team so the game is balanced and starts.
  await actor.login("roster-key-3", "Bob", [], { none: null });

  // Read the roster BEFORE the conclusion so we know which team each of Alice's
  // two entries is on. The timeout winner is the opponent of the team whose
  // turn it is, so the winning team is observable after the conclusion.
  const before = await actor.getGameState("roster-key-1");
  const aliceTeams = before.players
    .filter((p) => p.principal === "roster-key-1" || p.principal === "roster-key-2")
    .map((p) => ("White" in p.team ? "White" : "Black"));
  expect(aliceTeams).toHaveLength(2);

  // Drive a timeout conclusion: advance the clock in heartbeat-sized steps
  // until the 300s turn timer elapses, refreshing every player each step so the
  // stale cleanup never removes them before the turn-timeout sub-pass records
  // the win. The recurring maintenance timer fires on the produced rounds.
  const steps = Math.ceil((300_000 + 60_000) / 60_000);
  for (let step = 0; step < steps; step += 1) {
    await pic?.advanceTime(60_000);
    await actor.heartbeat("roster-key-1");
    await actor.heartbeat("roster-key-2");
    await actor.heartbeat("roster-key-3");
  }
  await pic?.tick(5);

  // The game concluded (Celebration) with a winner.
  const concluded = await actor.getGameState("roster-key-1");
  expect(concluded.phase).toEqual({ Celebration: null });
  expect(concluded.winner.length).toBe(1);
  const winner = "White" in concluded.winner[0]! ? "White" : "Black";

  // Alice's win count is 1 when at least one of her two entries is on the
  // winning team, and 0 otherwise — never 2, even when BOTH entries are on the
  // winning team. That is the dedupe-by-bound-principal rule.
  const expectedWins = aliceTeams.includes(winner) ? 1n : 0n;
  actor.setIdentity(alice);
  const mine = await actor.getMyWins();
  expect(mine.wins).toBe(expectedWins);
  expect(mine.rank).toBe(expectedWins === 1n ? 1n : 0n);

  // The public ranking carries no principals and marks Alice's row isMe.
  const rows = await actor.getWinnerRanking(50n);
  if (expectedWins === 1n) {
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ wins: 1n, rank: 1n, isMe: true });
    expect(rows[0]?.displayName).toBe("Ada");
  } else {
    expect(rows).toEqual([]);
  }
});
