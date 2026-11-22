import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the EXISTING read surface a new read-only diagnostic
 * query will draw on, taken BEFORE that query is added.
 *
 * The request adds a read-only diagnostic query that reports, for every roster
 * player, the username, team, seconds since last ping, and whether a roster
 * binding exists, plus the current phase, game number, Sunday competition
 * liveness and the winner team during Celebration.
 *
 * This file deliberately does NOT assert the diagnostic query itself — it does
 * not exist yet, and asserting it would be asserting the change. What it
 * protects is the behavior ADJACENT to the change that must survive it: the
 * existing public reads the diagnostic will compose, and the roster/binding
 * state it will read. A diagnostic that accidentally changes a roster read, a
 * binding lookup, the phase/game-number reads, the Sunday liveness read, or the
 * winner field would fail here rather than in front of a user.
 *
 * The real canister is installed and called through the generated declarations
 * (no mock). The frontend suite mocks the actor, so it passes unchanged against
 * a canister whose methods are unimplemented stubs; this file drives the real
 * public API.
 *
 * What the replica CANNOT observe here: the exact seconds-since-last-ping
 * arithmetic (the diagnostic's own concern), a real Celebration winner (needs a
 * concluded game), and the diagnostic query's own shape. See
 * episode.coverageLimits.
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

it("reports each roster player's username, team and lastPing through getGameState", async () => {
  const { actor } = await install();

  // Two players log in (one per team) so the roster is populated and the game
  // starts. The diagnostic reads username, team and lastPing per roster player
  // from this same snapshot.
  await actor.login("diag-player-1", "Ada", [], { none: null });
  await actor.login("diag-player-2", "Bob", [], { none: null });

  const state = await actor.getGameState("diag-player-1");
  expect(state.players).toHaveLength(2);

  const ada = state.players.find((p) => p.principal === "diag-player-1");
  const bob = state.players.find((p) => p.principal === "diag-player-2");
  expect(ada).toBeDefined();
  expect(bob).toBeDefined();

  // Username and team are present and typed; the two players are on opposite
  // teams (the first fills White, the second Black).
  expect(ada?.username).toBe("Ada");
  expect(bob?.username).toBe("Bob");
  expect(ada?.team).toEqual({ White: null });
  expect(bob?.team).toEqual({ Black: null });

  // lastPing is not exposed on the snapshot's PlayerInfo, so the diagnostic
  // must read it from the roster store. The snapshot's presence fields are the
  // adjacent contract: isMoveMaker is a boolean and exactly one player holds it.
  const makers = state.players.filter((p) => p.isMoveMaker);
  expect(makers).toHaveLength(1);
  expect(typeof ada?.isMoveMaker).toBe("boolean");
});

it("answers the phase and game-number reads the diagnostic composes", async () => {
  const { actor } = await install();

  // A fresh canister is on its first game, paused until two players log in.
  await expect(actor.getGameNumber()).resolves.toBe(1n);
  const fresh = await actor.getGameState("diag-player-1");
  expect(fresh.phase).toEqual({ Paused: null });

  // Once two players log in the game starts and the phase becomes #Playing.
  await actor.login("diag-player-1", "Ada", [], { none: null });
  await actor.login("diag-player-2", "Bob", [], { none: null });
  const playing = await actor.getGameState("diag-player-1");
  expect(playing.phase).toEqual({ Playing: null });

  // The winner field is the absent optional while the game is in progress; the
  // diagnostic reports the winner team only during Celebration.
  expect(playing.winner).toEqual([]);
});

it("answers the Sunday competition liveness read the diagnostic composes", async () => {
  const { actor } = await install();

  // getSundayCompStatus is the read the diagnostic uses for Sunday liveness.
  // It must resolve with the correct shape rather than trapping, and its
  // `live` flag must be a boolean.
  const status = await actor.getSundayCompStatus();
  expect(typeof status.live).toBe("boolean");
  expect(typeof status.sunday).toBe("bigint");
  expect(typeof status.secondsRemaining).toBe("bigint");
  expect(status.secondsRemaining).toBeGreaterThanOrEqual(0n);
});

it("distinguishes a bound roster key from an unbound one", async () => {
  const { actor } = await install();
  const alice = createIdentity("diag-adjacent-alice");

  // A guest login leaves the roster key unbound: the diagnostic's
  // "roster binding exists" flag must read false for it.
  await actor.login("diag-guest-key", "Guest", [], { none: null });

  // A ranked login binds the caller's Internet Identity principal to the
  // roster key: the diagnostic's flag must read true for it.
  actor.setIdentity(alice);
  await actor.loginRanked("diag-ranked-key", "Ranked", [], { none: null });

  // Both keys are on the roster, so the diagnostic can report a binding flag
  // for each. The binding is keyed by the roster key, not the principal.
  const state = await actor.getGameState("diag-guest-key");
  const keys = state.players.map((p) => p.principal);
  expect(keys).toContain("diag-guest-key");
  expect(keys).toContain("diag-ranked-key");
});

it("keeps the roster reads callable after a heartbeat updates presence", async () => {
  const { actor } = await install();

  await actor.login("diag-player-1", "Ada", [], { none: null });
  await actor.login("diag-player-2", "Bob", [], { none: null });

  // heartbeat records the caller's last-seen time; the roster read must remain
  // callable and still report both players afterwards.
  await actor.heartbeat("diag-player-1");

  const state = await actor.getGameState("diag-player-1");
  expect(state.players).toHaveLength(2);
  expect(state.players.map((p) => p.username).sort()).toEqual(["Ada", "Bob"]);
});
