import { PocketIc } from "@dfinity/pic";
import { afterEach, beforeEach, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization taken BEFORE the accepted recordStaleHeartbeatSkips
 * bot-exclusion change (src/backend/lib/nft.mo).
 *
 * The request intentionally changes recordStaleHeartbeatSkips to exclude the
 * bot before it is appended to the skipped-mint list, so the bot never
 * appears in NFT mint results or the attempts/skipped counts. This file
 * deliberately does NOT assert anything about the bot's presence or absence
 * in that list — that is the change under test elsewhere.
 *
 * What this file protects is the adjacent behavior that must survive the
 * fix: recordStaleHeartbeatSkips' per-HUMAN recording. A human player whose
 * heartbeat is stale (> the 180s presence-gate cutoff) at game conclusion
 * must still get exactly one recorded #skipped("stale heartbeat at game
 * conclusion") mint attempt, carrying their own username and team, visible
 * through both getMintStatusesForGame and getMintAttemptsByGame — and a
 * still-fresh human with no wallet address must still get its own, distinct
 * #skipped("no wallet address supplied") attempt. A bot-only filter must not
 * disturb either of these per-human outcomes or their reasons.
 *
 * The real canister is installed and called through the generated
 * declarations (no mock). See episode.coverageLimits for what the replica
 * cannot observe.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

/**
 * The backend's turn limit resolves to the #TwoMinutes default (120s) with
 * no votes cast, well under the 180s presence-gate cutoff. To make a human
 * genuinely stale (lastPing age > 180s) at the moment the turn timeout
 * concludes the game, the silent human logs in well before the second
 * (still-heartbeating) human's login starts the turn clock, so the silent
 * human's fixed login-time lastPing is already old by the time the turn
 * timeout fires ~120s later.
 */
const PRE_GAME_DELAY_MS = 170_000;
const TURN_LIMIT_MS = 120_000;
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

it("records a distinct stale-heartbeat skip for a silent human, keeping the still-heartbeating human's own skip reason separate", async () => {
  // The silent human logs in first; its lastPing is fixed at this moment and
  // never refreshed again.
  await actor.login("stale-skip-silent", "Bob", [], { none: null });

  // A long gap passes with no ticks produced, before the second human logs
  // in. This does not delete or demote the silent human (deletion only
  // happens after ~30 minutes of silence), but it means the silent human's
  // lastPing is already ~170s old by the time the second login starts the
  // turn clock.
  await pic?.advanceTime(PRE_GAME_DELAY_MS);

  // The second, still-heartbeating human's login starts the game and the
  // turn clock.
  await actor.login("stale-skip-alive", "Ada", [], { none: null });

  const started = await actor.getGameState("stale-skip-alive");
  expect(started.phase).toEqual({ Playing: null });
  const alive = started.players.find((p) => p.principal === "stale-skip-alive");
  const silent = started.players.find((p) => p.principal === "stale-skip-silent");
  expect(alive).toBeDefined();
  expect(silent).toBeDefined();

  // Drive the 120s turn timer out. "stale-skip-alive" heartbeats every step
  // so its lastPing stays within the 180s presence-gate cutoff at the
  // conclusion moment; "stale-skip-silent" never heartbeats again after its
  // earlier login, so by conclusion (~170s + ~120s after its login) its
  // lastPing is well past the cutoff.
  const steps = Math.ceil(
    (TURN_LIMIT_MS + HEARTBEAT_STEP_MS) / HEARTBEAT_STEP_MS,
  );
  for (let step = 0; step < steps; step += 1) {
    await pic?.advanceTime(HEARTBEAT_STEP_MS);
    await actor.heartbeat("stale-skip-alive");
  }
  await pic?.tick(5);

  const concluded = await actor.getGameState("stale-skip-alive");
  expect(concluded.phase).toEqual({ Celebration: null });

  const statuses = await actor.getMintStatusesForGame();
  const aliveStatus = statuses.find((s) => s.username === "Ada");
  const silentStatus = statuses.find((s) => s.username === "Bob");
  expect(aliveStatus).toBeDefined();
  expect(silentStatus).toBeDefined();

  // The still-present, no-wallet human gets its own distinct skip reason.
  expect(aliveStatus!.outcome).toEqual([{ skipped: "no wallet address supplied" }]);
  expect(aliveStatus!.team).toEqual(alive!.team);

  // The silent human — excluded by the presence gate — gets the
  // stale-heartbeat skip reason, with its own username and team.
  expect(silentStatus!.outcome).toEqual([{ skipped: "stale heartbeat at game conclusion" }]);
  expect(silentStatus!.team).toEqual(silent!.team);

  // The same two outcomes, with the same reasons, are visible through the
  // grouped-by-game query.
  const groups = await actor.getMintAttemptsByGame();
  const allAttempts = groups.flatMap((g) => g.attempts);
  const aliveAttempt = allAttempts.find((a) => a.recipientUsername === "Ada");
  const silentAttempt = allAttempts.find((a) => a.recipientUsername === "Bob");
  expect(aliveAttempt?.outcome).toEqual({ skipped: "no wallet address supplied" });
  expect(silentAttempt?.outcome).toEqual({ skipped: "stale heartbeat at game conclusion" });
});
