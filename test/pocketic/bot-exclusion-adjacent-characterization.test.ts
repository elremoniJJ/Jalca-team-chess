import { PocketIc } from "@dfinity/pic";
import { afterEach, beforeEach, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization taken BEFORE the accepted bot-exclusion change.
 *
 * The request intentionally changes several things:
 *   - `castKickVote` will reject any vote whose target is the bot;
 *   - `uniqueUsername` will reserve "Jalca" (any capitalization) even when the
 *     bot is absent from the roster;
 *   - the bot's displayed username changes from "jalca-bot" to "Jalca" while
 *     its internal roster key stays "jalca-bot";
 *   - `recordWins` and the NFT mint path gain an explicit `isBot` skip.
 *
 * This file deliberately does NOT assert any of those four behaviors — they
 * are the change. What it protects is the behavior ADJACENT to each one that
 * must survive it:
 *
 *   1. The bot's own periodic refresh (`ensureBot`, re-run at every new game)
 *      never renames the bot and never creates a second bot entry, across
 *      repeated refresh cycles.
 *   2. A normal human-vs-human strict-majority kick still succeeds when the
 *      bot occupies a roster slot on the OTHER team (the new bot-target guard
 *      must not disturb human-only kick resolution).
 *   3. `uniqueUsername` does not treat an ordinary username that merely
 *      CONTAINS "jalca" as a collision with the reserved name — only new
 *      behavior intentionally targets an exact (case-insensitive) match.
 *
 * The real canister is installed and called through the generated
 * declarations (no mock). The frontend suite mocks the actor, so it passes
 * unchanged against a canister whose methods are unimplemented stubs; this
 * file drives the real public API instead. See episode.coverageLimits for
 * what the replica cannot observe.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

const BOT_KEY = "jalca-bot";
/** The backend's turn time limit is 300s; step in 60s heartbeat increments. */
const TURN_LIMIT_MS = 300_000;
const HEARTBEAT_STEP_MS = 60_000;
/** The backend's celebration/draw window is 10s. */
const CELEBRATION_WINDOW_MS = 10_000;

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

/** The team label ("White" or "Black") encoded in a Candid team variant. */
function teamLabel(team: { White?: null; Black?: null }): "White" | "Black" {
  return "White" in team ? "White" : "Black";
}

/** Advance the clock in heartbeat steps until the 300s turn timer elapses. */
async function runTurnTimerOut(first: string, second: string): Promise<void> {
  const steps = Math.ceil(
    (TURN_LIMIT_MS + HEARTBEAT_STEP_MS) / HEARTBEAT_STEP_MS,
  );
  for (let step = 0; step < steps; step += 1) {
    await pic?.advanceTime(HEARTBEAT_STEP_MS);
    await actor.heartbeat(first);
    await actor.heartbeat(second);
  }
  await pic?.tick(5);
}

it("keeps the bot's username and roster key stable across repeated new-game refresh cycles", async () => {
  await actor.login("botstable-a", "Ada", [], { none: null });
  await actor.login("botstable-b", "Bob", [], { none: null });

  const initialState = await actor.getGameState("botstable-a");
  const initialBot = initialState.players.find((p) => p.isBot);
  expect(initialBot).toBeDefined();
  expect(initialBot?.principal).toBe(BOT_KEY);
  const initialUsername = initialBot?.username;

  for (let cycle = 0; cycle < 2; cycle += 1) {
    // Conclude the current game by turn timeout.
    await runTurnTimerOut("botstable-a", "botstable-b");
    const concluded = await actor.getGameState("botstable-a");
    expect(concluded.phase).toEqual({ Celebration: null });

    // Both humans signal readiness, then the celebration window closes and
    // the next game starts, re-running ensureBot's refresh path.
    await actor.requestNewGame("botstable-a");
    await actor.requestNewGame("botstable-b");
    await pic?.advanceTime(CELEBRATION_WINDOW_MS + 1_000);
    await pic?.tick(5);

    const restarted = await actor.getGameState("botstable-a");
    expect(restarted.phase).toEqual({ Playing: null });

    const bots = restarted.players.filter((p) => p.isBot);
    // Exactly one bot — the refresh never creates a duplicate.
    expect(bots).toHaveLength(1);
    expect(bots[0]?.principal).toBe(BOT_KEY);
    // The refresh never renames the bot.
    expect(bots[0]?.username).toBe(initialUsername);
  }
});

it("still applies a human-only strict-majority kick when the bot occupies the other team's slot", async () => {
  await actor.login("botkick-a", "Ada", [], { none: null });
  await actor.login("botkick-b", "Bob", [], { none: null });
  await actor.login("botkick-c", "Cara", [], { none: null });
  await actor.login("botkick-d", "Dan", [], { none: null });
  await actor.login("botkick-e", "Eve", [], { none: null });
  await actor.login("botkick-f", "Finn", [], { none: null });

  const state = await actor.getGameState("botkick-a");
  const bot = state.players.find((p) => p.isBot);
  expect(bot).toBeDefined();
  const botTeamLabel = teamLabel(bot!.team as { White?: null; Black?: null });

  // The team that does NOT hold the bot is made up entirely of humans, so a
  // strict majority of (N-1) votes out of N teammates must still kick.
  const humanOnlyTeam = state.players.filter(
    (p) =>
      !p.isBot &&
      teamLabel(p.team as { White?: null; Black?: null }) !== botTeamLabel,
  );
  expect(humanOnlyTeam.length).toBeGreaterThanOrEqual(2);

  const target = humanOnlyTeam[0]!;
  const voters = humanOnlyTeam.slice(1);
  const targetTeamBefore = target.team;

  for (const voter of voters) {
    const cast = await actor.castKickVote(voter.principal, target.principal);
    expect(cast).toEqual({ ok: null });
  }

  const after = await actor.getGameState("botkick-a");
  const targetAfter = after.players.find(
    (p) => p.principal === target.principal,
  );
  expect(targetAfter?.team).not.toEqual(targetTeamBefore);

  // The bot itself is untouched by this all-human kick resolution.
  const botAfter = after.players.find((p) => p.isBot);
  expect(botAfter).toBeDefined();
  expect(botAfter?.team).toEqual(bot!.team);
});

it("does not treat an ordinary username merely containing \"jalca\" as a reserved-name collision", async () => {
  const result = await actor.login("human-substring", "MyJalcaFan", [], {
    none: null,
  });
  // Only the exact reserved key/name is special-cased; a username that just
  // contains the substring passes through unchanged.
  expect(result.username).toBe("MyJalcaFan");

  const state = await actor.getGameState("human-substring");
  const human = state.players.find((p) => p.principal === "human-substring");
  expect(human?.username).toBe("MyJalcaFan");
});
