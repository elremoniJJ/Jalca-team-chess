import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterEach, beforeEach, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Cover for the accepted bot-exclusion change, exercised against the REAL
 * canister through the generated declarations (no mock).
 *
 * Accepted behavior:
 *   - `castKickVote` rejects any vote whose target is the bot, with the exact
 *     error "castKickVote: cannot kick the bot", leaving kick state and teams
 *     unaffected.
 *   - `uniqueUsername` reserves "Jalca" in any capitalization — even on a
 *     brand-new canister's very first login, before the bot has ever been
 *     created — turning it into "Jalca_copy".
 *   - The bot is displayed as "Jalca" (its internal roster key stays the
 *     literal "jalca-bot").
 *   - `recordWins` and the NFT mint path exclude the bot even when its team
 *     wins: the bot never gets a winnerStore credit and never appears in the
 *     per-game mint status/attempt queries, while its human teammate does.
 *
 * The companion characterization file (bot-exclusion-adjacent-characterization
 * .test.ts), taken before this change, protects the adjacent behavior that
 * must survive it (refresh stability, human-only kicks, substring usernames)
 * and deliberately does not assert any of the four behaviors above.
 *
 * What the replica CANNOT observe: the external ICRC-7 mint call itself (no
 * wallet address is supplied here, so every mint attempt is a local
 * #skipped("no wallet address supplied") outcome with no inter-canister
 * call) and the exact random draw that places a human on White vs Black.
 * See episode.coverageLimits.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

const BOT_KEY = "jalca-bot";
const BOT_DISPLAY_NAME = "Jalca";
/** The backend's turn time limit is 300s; step in 60s heartbeat increments. */
const TURN_LIMIT_MS = 300_000;
const HEARTBEAT_STEP_MS = 60_000;

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

it("rejects a kick vote targeting the bot with a clear error, leaving kick state and teams unaffected", async () => {
  await actor.login("botkickvote-a", "Ada", [], { none: null });
  await actor.login("botkickvote-b", "Bob", [], { none: null });

  const before = await actor.getGameState("botkickvote-a");
  const bot = before.players.find((p) => p.isBot);
  expect(bot).toBeDefined();
  const human = before.players.find((p) => !p.isBot);
  expect(human).toBeDefined();
  const botTeamBefore = bot!.team;

  // A human (regardless of team) votes to kick the bot. It must be rejected
  // with the exact bot-specific error, never reaching the team-match check.
  const result = await actor.castKickVote(human!.principal, BOT_KEY);
  expect(result).toEqual({ err: "castKickVote: cannot kick the bot" });

  // Kick state records no vote against the bot.
  const kickState = await actor.getKickState();
  const botKickEntry = kickState.players.find((p) => p.principal === BOT_KEY);
  expect(botKickEntry?.kickCount ?? 0n).toBe(0n);

  // The bot's team is unaffected.
  const after = await actor.getGameState("botkickvote-a");
  const botAfter = after.players.find((p) => p.isBot);
  expect(botAfter?.team).toEqual(botTeamBefore);
});

it("reserves \"Jalca\" in any capitalization on a human's very first login, before the bot exists", async () => {
  // This is the FIRST-EVER login on a fresh canister: uniqueUsername runs
  // before ensureBot ever creates the bot, so the roster has no "jalca-bot"
  // entry at the moment the reservation is checked. The exact-case name
  // "Jalca" becomes exactly "Jalca_copy" (the literal example in the
  // requirement); the reservation also fires for other capitalizations,
  // which dedupe to "<input>_copy" (uniqueUsername never re-cases the input,
  // only suffixes it).
  const result = await actor.login("botreserve-jalca", "Jalca", [], {
    none: null,
  });
  expect(result.username).toBe("Jalca_copy");

  const state = await actor.getGameState("botreserve-jalca");
  const human = state.players.find((p) => p.principal === "botreserve-jalca");
  expect(human?.username).toBe("Jalca_copy");

  // A second human requesting a DIFFERENT case-variant of the reserved name
  // is also reserved away from the bare name, even though the bot still
  // does not exist and the first "Jalca_copy" is a distinct string.
  const second = await actor.login("botreserve-jalca-2", "JALCA", [], {
    none: null,
  });
  expect(second.username).toBe("JALCA_copy");
  expect(second.username.toLowerCase()).not.toBe("jalca");
});

it("displays the bot as \"Jalca\" while its internal roster key stays \"jalca-bot\", stable across refreshes", async () => {
  const first = await actor.login("botdisplay-a", "Ada", [], { none: null });
  expect(first.username).toBe("Ada");

  const state = await actor.getGameState("botdisplay-a");
  const bot = state.players.find((p) => p.isBot);
  expect(bot).toBeDefined();
  expect(bot?.principal).toBe(BOT_KEY);
  expect(bot?.username).toBe(BOT_DISPLAY_NAME);

  // A second login re-runs ensureBot's existing-bot refresh branch (the
  // Paused-lobby block runs ensureBot on every login while still forming).
  // The refresh must not rename the bot or create a second entry, and the
  // display name stays "Jalca" even though the roster key never changes.
  await actor.login("botdisplay-b", "Bob", [], { none: null });
  const after = await actor.getGameState("botdisplay-a");
  const bots = after.players.filter((p) => p.isBot);
  expect(bots).toHaveLength(1);
  expect(bots[0]?.principal).toBe(BOT_KEY);
  expect(bots[0]?.username).toBe(BOT_DISPLAY_NAME);
});

it("excludes the bot from recordWins and the NFT mint path even though its team wins by timeout", async () => {
  // The bot is always created first and always lands on Black (deterministic
  // fewer-players tie-break order). Log in ranked humans one at a time until
  // the lobby balances and the game reaches Playing — the human placed
  // opposite White is random, so a few extra logins guarantee convergence.
  // Every logged-in human votes Standard starting position, so the game
  // starts with White to move first (deterministic), never a random opening
  // whose seeded ply count could hand Black the first move instead.
  const names = ["Ada", "Bob", "Cara", "Dan", "Eve"];
  const keys: string[] = [];
  let state: Awaited<ReturnType<typeof actor.getGameState>> | undefined;
  for (let i = 0; i < names.length; i += 1) {
    const key = `botexclude-key-${i}`;
    keys.push(key);
    actor.setIdentity(createIdentity(`botexclude-id-${i}`));
    await actor.loginRanked(key, names[i], [], { none: null });
    await actor.castVote(key, {
      startingPosition: { Standard: null },
      spellUse: { On: null },
      turnDuration: { TwoMinutes: null },
    });
    state = await actor.getGameState(key);
    if ("Playing" in state.phase) break;
  }
  expect(state).toBeDefined();
  expect(state!.phase).toEqual({ Playing: null });

  const bot = state!.players.find((p) => p.isBot);
  expect(bot).toBeDefined();
  // The bot is always created before any human and always lands on Black.
  expect(bot!.team).toEqual({ Black: null });
  const teammate = state!.players.find(
    (p) => !p.isBot && "Black" in p.team,
  );
  expect(teammate).toBeDefined();

  // Drive the turn timer out with no moves played: currentTurn stays White
  // (the side that moves first with the Standard starting position), so
  // White loses and Black — the bot's team — wins. This deterministically
  // puts the bot on the winning side.
  const steps = Math.ceil((TURN_LIMIT_MS + HEARTBEAT_STEP_MS) / HEARTBEAT_STEP_MS);
  for (let step = 0; step < steps; step += 1) {
    await pic?.advanceTime(HEARTBEAT_STEP_MS);
    for (const key of keys) {
      await actor.heartbeat(key);
    }
  }
  await pic?.tick(5);

  const concluded = await actor.getGameState(keys[0]!);
  expect(concluded.phase).toEqual({ Celebration: null });
  expect(concluded.winner).toEqual([{ Black: null }]);

  // recordWins: the human teammate on the winning team is credited, but the
  // bot — also on the winning team — never accumulates a counted win.
  const ranking = await actor.getWinnerRanking(50n);
  expect(ranking.some((r) => r.displayName === BOT_DISPLAY_NAME)).toBe(false);
  const teammateRow = ranking.find((r) => r.displayName === teammate!.username);
  expect(teammateRow).toBeDefined();
  expect(teammateRow!.wins).toBe(1n);

  // NFT mint path: every present player (including the bot, absent the
  // exclusion) gets a recorded mint attempt (no wallet -> #skipped), but the
  // bot must never appear in either per-game query.
  const statuses = await actor.getMintStatusesForGame();
  expect(statuses.some((s) => s.username === BOT_DISPLAY_NAME)).toBe(false);
  expect(statuses.some((s) => s.username === teammate!.username)).toBe(true);

  const groups = await actor.getMintAttemptsByGame();
  const allAttempts = groups.flatMap((g) => g.attempts);
  expect(allAttempts.some((a) => a.recipientUsername === BOT_DISPLAY_NAME)).toBe(
    false,
  );
  expect(
    allAttempts.some((a) => a.recipientUsername === teammate!.username),
  ).toBe(true);
});
