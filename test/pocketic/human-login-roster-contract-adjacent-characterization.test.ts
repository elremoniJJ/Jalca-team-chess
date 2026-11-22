import { PocketIc } from "@dfinity/pic";
import { afterEach, beforeEach, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the HUMAN login/roster contract, taken BEFORE the
 * accepted bot change.
 *
 * The request adds an `isBot` flag to the Player record, reserves the key
 * "jalca-bot" so no human can take it, and adds a single bot internally at
 * lobby creation and at every new game. It also exempts the bot from
 * heartbeat, cleanupStalePlayers and the inactive state, sets the bot's
 * isFresh automatically, and skips the bot in both Move_Maker pick sites.
 *
 * This file deliberately does NOT assert the bot itself, the `isBot` field, or
 * the reserved key — those are the change. What it protects is the behavior
 * ADJACENT to the change that must survive it: the existing HUMAN login and
 * roster contract the frontend already relies on.
 *
 *   - a human login creates exactly ONE roster entry for that principal, with
 *     `isFresh` true and `isInactive` false on arrival (the defaults the
 *     frontend's readiness and presence UI key on);
 *   - a human login returns a real team and a snapshot whose roster contains
 *     the human;
 *   - a human may take any username other than the reserved key — the
 *     reservation must not rename or reject ordinary usernames;
 *   - a re-login of the same human principal does not create a second roster
 *     entry;
 *   - the public Candid player projection still carries the fields the
 *     frontend reads (principal, username, team, isMoveMaker, walletAddress,
 *     walletSource, isFresh, isInactive).
 *
 * The real canister is installed and called through the generated declarations
 * (no mock). The frontend suite mocks the actor, so it passes unchanged against
 * a canister whose methods are unimplemented stubs; this file drives the real
 * public API. See episode.coverageLimits for what the replica cannot observe.
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

/** The roster entry for a principal, or undefined when absent. */
async function playerOf(principal: string) {
  const state = await actor.getGameState(principal);
  return state.players.find((p) => p.principal === principal);
}

it("creates exactly one fresh, active roster entry for a human login", async () => {
  const result = await actor.login("human-solo", "Ada", [], { none: null });

  // The login result carries the human's principal, username and a real team.
  expect(result.principal).toBe("human-solo");
  expect(result.username).toBe("Ada");
  expect(result.team).toBeDefined();

  const state = await actor.getGameState("human-solo");
  const humans = state.players.filter((p) => p.principal === "human-solo");
  expect(humans).toHaveLength(1);

  const ada = humans[0];
  expect(ada?.username).toBe("Ada");
  expect(ada?.team).toEqual(result.team);
  // A human is fresh and active on arrival — the defaults the readiness and
  // presence UI key on.
  expect(ada?.isFresh).toBe(true);
  expect(ada?.isInactive).toBe(false);
});

it("does not create a second roster entry when the same human re-logs in", async () => {
  await actor.login("human-relogin", "Ada", [], { none: null });
  await actor.login("human-relogin", "Ada", [], { none: null });

  const state = await actor.getGameState("human-relogin");
  const humans = state.players.filter((p) => p.principal === "human-relogin");
  expect(humans).toHaveLength(1);
  expect(humans[0]?.isFresh).toBe(true);
});

it("lets a human take an ordinary username without renaming it", async () => {
  // The reservation is for the single key "jalca-bot"; an ordinary username
  // must pass through unchanged and not be deduped or rejected.
  const result = await actor.login("human-name", "OrdinaryName", [], {
    none: null,
  });
  expect(result.username).toBe("OrdinaryName");

  const ada = await playerOf("human-name");
  expect(ada?.username).toBe("OrdinaryName");
});

it("keeps the public Candid player projection carrying the human fields", async () => {
  await actor.login("human-shape", "Ada", [], { none: null });

  const state = await actor.getGameState("human-shape");
  const ada = state.players.find((p) => p.principal === "human-shape");
  expect(ada).toBeDefined();

  // The projection the frontend reads still exposes every existing field.
  expect(ada).toHaveProperty("principal");
  expect(ada).toHaveProperty("username");
  expect(ada).toHaveProperty("team");
  expect(ada).toHaveProperty("isMoveMaker");
  expect(ada).toHaveProperty("walletAddress");
  expect(ada).toHaveProperty("walletSource");
  expect(ada).toHaveProperty("isFresh");
  expect(ada).toHaveProperty("isInactive");
});

it("keeps a human's wallet address on the roster entry after login", async () => {
  await actor.login("human-wallet", "Ada", ["0xabc"], { oisy: null });

  const ada = await playerOf("human-wallet");
  expect(ada?.walletAddress).toEqual(["0xabc"]);
});
