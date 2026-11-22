import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterEach, beforeEach, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Cover for the accepted single-bot change, exercised against the REAL canister
 * through the generated declarations (no mock).
 *
 * Accepted behavior:
 *   - the Player record and the Candid PlayerInfo projection carry `isBot`,
 *     false for every human and true only for the single bot;
 *   - the key "jalca-bot" is reserved: a human cannot log in with it (guest
 *     `login` and Internet-Identity `loginRanked` both reject it);
 *   - exactly one bot exists after lobby creation and after a new game;
 *   - the bot takes its team through the existing fewer-players rule, so a
 *     human joining later lands on the other team;
 *   - the bot is exempt from heartbeat, from cleanupStalePlayers and from the
 *     inactive state, and is always fresh;
 *   - the bot is never selected as Move_Maker.
 *
 * The internal `uniqueUsername`, `reassignTeams` and `cleanupStalePlayers`
 * helpers are not public methods, so they are observed only through the public
 * API: `login`/`loginRanked` for the reserved key, `getGameState` for the
 * roster and `runMaintenance` for the presence lifecycle. See
 * episode.coverageLimits for what the replica cannot observe.
 *
 * These tests call the real public API on a freshly installed canister, so a
 * backend whose methods are unimplemented stubs would trap here rather than
 * pass. The frontend suite mocks the actor and cannot see any of this.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

const BOT_KEY = "jalca-bot";

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

/** The single bot roster entry, or undefined when absent. */
async function botOf() {
  const state = await actor.getGameState(BOT_KEY);
  return state.players.find((p) => p.principal === BOT_KEY);
}

it("marks every human isBot false and the bot the only isBot true", async () => {
  await actor.login("bot-human-a", "Ada", [], { none: null });
  await actor.login("bot-human-b", "Bob", [], { none: null });

  const state = await actor.getGameState("bot-human-a");

  // Every human carries isBot false.
  const humans = state.players.filter((p) => p.principal !== BOT_KEY);
  expect(humans.length).toBeGreaterThanOrEqual(2);
  for (const human of humans) {
    expect(human.isBot).toBe(false);
  }

  // The bot is present and is the only player with isBot true.
  const bots = state.players.filter((p) => p.isBot);
  expect(bots).toHaveLength(1);
  expect(bots[0]?.principal).toBe(BOT_KEY);
});

it("rejects a guest login with the reserved bot key", async () => {
  await expect(
    actor.login(BOT_KEY, "Impostor", [], { none: null }),
  ).rejects.toThrow();

  // The rejected attempt did not create a human roster entry under the key.
  const state = await actor.getGameState("bot-human-probe");
  const impostors = state.players.filter(
    (p) => p.principal === BOT_KEY && !p.isBot,
  );
  expect(impostors).toHaveLength(0);
});

it("rejects a ranked login with the reserved bot key", async () => {
  const alice = createIdentity("bot-ranked-impostor");
  actor.setIdentity(alice);

  await expect(
    actor.loginRanked(BOT_KEY, "Impostor", [], { none: null }),
  ).rejects.toThrow();
});

it("creates exactly one bot at lobby creation", async () => {
  await actor.login("bot-lobby-a", "Ada", [], { none: null });

  const state = await actor.getGameState("bot-lobby-a");
  const bots = state.players.filter((p) => p.isBot);
  expect(bots).toHaveLength(1);
  expect(bots[0]?.principal).toBe(BOT_KEY);
});

it("keeps exactly one bot after a new game", async () => {
  await actor.login("bot-newgame-a", "Ada", [], { none: null });
  await actor.login("bot-newgame-b", "Bob", [], { none: null });

  // Both humans signal readiness for the next game.
  await actor.requestNewGame("bot-newgame-a");
  await actor.requestNewGame("bot-newgame-b");

  const state = await actor.getGameState("bot-newgame-a");
  const bots = state.players.filter((p) => p.isBot);
  expect(bots).toHaveLength(1);
  expect(bots[0]?.principal).toBe(BOT_KEY);
});

it("assigns the bot a team by the fewer-players rule so a later human lands on the other team", async () => {
  // The bot is created at lobby creation and takes a team. A human joining
  // afterwards must land on the OTHER team, because the bot's team now has
  // more players.
  await actor.login("bot-team-a", "Ada", [], { none: null });

  const bot = await botOf();
  expect(bot).toBeDefined();
  const botTeam = bot?.team;
  expect(botTeam).toBeDefined();

  const ada = await playerOf("bot-team-a");
  expect(ada?.team).toBeDefined();
  expect(ada?.team).not.toEqual(botTeam);
});

it("keeps the bot fresh and active and never selects it as Move_Maker", async () => {
  // Three humans join, so the roster (bot + three humans) is balanced 2/2 and
  // BOTH teams hold a human. The bot must never appear in the Move_Maker slot,
  // whatever the opening's turn is.
  await actor.login("bot-maker-a", "Ada", [], { none: null });
  await actor.login("bot-maker-b", "Bob", [], { none: null });
  await actor.login("bot-maker-c", "Cara", [], { none: null });

  const state = await actor.getGameState("bot-maker-a");

  // The bot is always fresh and never inactive.
  const bot = state.players.find((p) => p.principal === BOT_KEY);
  expect(bot).toBeDefined();
  expect(bot?.isFresh).toBe(true);
  expect(bot?.isInactive).toBe(false);

  // The bot is never the Move_Maker. (The maker slot may be empty when the
  // bot is the only player on the turn's team — a separate finding — but the
  // bot itself must never occupy it.)
  expect(state.moveMaker).not.toContain(BOT_KEY);
});

it("exempts the bot from heartbeat and cleanupStalePlayers", async () => {
  await actor.login("bot-cleanup-a", "Ada", [], { none: null });

  // A heartbeat for the bot is a no-op that still reports #ok.
  await expect(actor.heartbeat(BOT_KEY)).resolves.toEqual({ ok: null });

  // Run maintenance far past the deletion cutoff. The bot must survive the
  // presence lifecycle: it is never marked inactive and never deleted, even
  // though it never pings. (A game conclusion may flip isFresh on every
  // player, so freshness is asserted only before any conclusion, in the
  // Move_Maker test above.)
  const farFuture = BigInt(Date.now()) * 1_000_000n + 3_600_000_000_000_000n;
  await actor.runMaintenance(farFuture);

  const state = await actor.getGameState("bot-cleanup-a");
  const bot = state.players.find((p) => p.principal === BOT_KEY);
  expect(bot).toBeDefined();
  expect(bot?.isBot).toBe(true);
  expect(bot?.isInactive).toBe(false);
});
