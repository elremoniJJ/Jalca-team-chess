import { PocketIc } from "@dfinity/pic";
import { afterEach, beforeEach, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the `requestNewGame` public contract, taken BEFORE the
 * accepted presence change.
 *
 * The request intentionally changes the presence model: an inactive state at
 * ~90s, a ~30-minute delete cutoff, and `heartbeat` returning an error result
 * for an unknown principal. It also requires the client to show a "You were
 * removed, tap to rejoin" banner when `heartbeat` or `requestNewGame` reports
 * the player is unknown.
 *
 * This file deliberately does NOT assert the new inactive state, the new
 * delete cutoff, or the new `heartbeat` error result — those are the change.
 * What it protects is the behavior ADJACENT to the change that must survive
 * it: the existing `requestNewGame` result contract the client already relies
 * on to decide between "new game accepted" and "you are gone".
 *
 *   - `requestNewGame` returns `#ok` for a logged-in player and flips that
 *     player's `isFresh` to true (the "New game" button's success path);
 *   - `requestNewGame` returns `#err` with a non-empty message for a principal
 *     that is not a logged-in player (the "you were removed" path the banner
 *     will key on);
 *   - `requestNewGame` is idempotent: calling it on an already-fresh player is
 *     still `#ok`;
 *   - a `heartbeat` for a known player keeps the roster read callable and does
 *     not remove the player.
 *
 * The real canister is installed and called through the generated declarations
 * (no mock). The frontend suite mocks the actor, so it passes unchanged against
 * a canister whose methods are unimplemented stubs; this file drives the real
 * public API.
 *
 * What the replica CANNOT observe here: the exact inactive/delete thresholds
 * (the change's own concern) and the client banner (a frontend concern). See
 * episode.coverageLimits.
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

it("returns #ok for a logged-in player and flips isFresh to true", async () => {
  // Two players log in so the game starts; the conclusion path marks players
  // stale, but here we only need a logged-in player to call requestNewGame.
  await actor.login("rng-a", "Ada", [], { none: null });
  await actor.login("rng-b", "Bob", [], { none: null });

  const result = await actor.requestNewGame("rng-a");
  expect(result).toEqual({ ok: null });

  // The player remains on the roster and is fresh after the call.
  const state = await actor.getGameState("rng-a");
  const ada = state.players.find((p) => p.principal === "rng-a");
  expect(ada).toBeDefined();
  expect(ada?.isFresh).toBe(true);
});

it("returns #err with a message for a principal that is not a logged-in player", async () => {
  // No login: the principal is unknown to the roster.
  const result = await actor.requestNewGame("never-logged-in");

  expect("err" in result).toBe(true);
  if ("err" in result) {
    expect(typeof result.err).toBe("string");
    expect(result.err.length).toBeGreaterThan(0);
  }
});

it("is idempotent: a second requestNewGame on a fresh player is still #ok", async () => {
  await actor.login("rng-idem", "Cara", [], { none: null });

  const first = await actor.requestNewGame("rng-idem");
  expect(first).toEqual({ ok: null });

  const second = await actor.requestNewGame("rng-idem");
  expect(second).toEqual({ ok: null });

  const state = await actor.getGameState("rng-idem");
  const cara = state.players.find((p) => p.principal === "rng-idem");
  expect(cara?.isFresh).toBe(true);
});

it("keeps the roster read callable after a heartbeat for a known player", async () => {
  await actor.login("rng-hb-a", "Ada", [], { none: null });
  await actor.login("rng-hb-b", "Bob", [], { none: null });

  // heartbeat records the caller's last-seen time; the roster read must remain
  // callable and still report both players afterwards.
  await actor.heartbeat("rng-hb-a");

  const state = await actor.getGameState("rng-hb-a");
  expect(state.players.map((p) => p.principal).sort()).toEqual([
    "rng-hb-a",
    "rng-hb-b",
  ]);
});
