import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cover for the accepted game-number off-by-one fix at game conclusion.
 *
 * The request changes the game number stamped on the end-of-game NFT from the
 * incremented next game number (N+1) to the game just played (N). The fix is
 * an ORDERING change inside `mintGameNftsSafe` in
 * `src/backend/mixins/chess-game-api.mo`: the concluded game's number is
 * captured into a local BEFORE `gameState.gameNumber` is incremented, and that
 * captured value is what is threaded into every mint call.
 *
 * Accepted behavior this file pins:
 *   1. `mintGameNftsSafe` reads `gameState.gameNumber` into a local binding
 *      before it mutates `gameState.gameNumber`.
 *   2. The increment still happens exactly once per concluded game, so the
 *      NEXT game's number is unchanged.
 *   3. The captured (pre-increment) value — not the mutated field — is passed
 *      to `recordStaleHeartbeatSkips`, `mintGuaranteedEntries` and
 *      `mintForEligiblePlayers`.
 *   4. The unconditional fixed-recipient mint to the fixed principal
 *      g2pdm-hmunr-5miqy-43zdt-fxmqu-yrqli-kqsjh-pusdw-gctym-kzi5w-4qe is gone
 *      from the conclusion hook.
 *
 * Why this is a source contract and not a runtime assertion:
 *   - The frontend suite mocks the backend actor, so it never executes the
 *     mint path.
 *   - The PocketIC lane installs the real wasm, but the external collection
 *     canister (23quc-cyaaa-aaaac-bfvia-cai) does not exist in the replica, so
 *     the inter-canister mint rejects before any token is minted, and there is
 *     no public method to conclude a game. The lane also skips entirely when
 *     `src/backend/dist/backend.wasm` is absent.
 *   - `mintGameNftsSafe` is internal to the mixin; the generated declarations
 *     expose only the composed actor surface.
 *
 * This file reads the backend source text only. It makes no network call and
 * executes no backend code. It deliberately does NOT assert the old
 * incremented stamp (N+1) — that is the behavior the request intentionally
 * removes.
 */

/**
 * Absolute path to the backend chess-game API mixin under test. The frontend
 * `test` script runs Vitest with the frontend package as its working
 * directory, so the backend source sits at `../backend/mixins/` from there.
 */
const CHESS_API_PATH = resolve(
  process.cwd(),
  "../backend/mixins/chess-game-api.mo",
);

const source = readFileSync(CHESS_API_PATH, "utf8");

/**
 * Extract the body of a `func <name>(...) : ... { ... };` declaration by brace
 * matching, so assertions do not depend on surrounding comments or whitespace.
 * Returns the text between the outermost braces of the function.
 */
function functionBody(name: string): string {
  const header = new RegExp(`func\\s+${name}\\s*\\(`, "u");
  const match = header.exec(source);
  if (match === null) {
    throw new Error(`func ${name} not found in ${CHESS_API_PATH}`);
  }
  const open = source.indexOf("{", match.index + match[0].length);
  if (open === -1) {
    throw new Error(`no body brace for func ${name}`);
  }
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated body for func ${name}`);
}

describe("game-conclusion mint — game number is captured before the increment", () => {
  const body = functionBody("mintGameNftsSafe");

  it("reads gameState.gameNumber into a local before mutating the field", () => {
    // The capture: `let gameNumber = gameState.gameNumber;`
    const captureIndex = body.indexOf("let gameNumber = gameState.gameNumber");
    // The mutation: `gameState.gameNumber := gameState.gameNumber + 1;`
    const incrementIndex = body.indexOf(
      "gameState.gameNumber := gameState.gameNumber + 1",
    );
    expect(captureIndex).toBeGreaterThanOrEqual(0);
    expect(incrementIndex).toBeGreaterThanOrEqual(0);
    // The capture must come strictly before the increment, so the value
    // threaded into the mint is the game just played (N), not N+1.
    expect(captureIndex).toBeLessThan(incrementIndex);
  });

  it("still advances the counter exactly once per concluded game", () => {
    // The increment survives the fix, so the NEXT game's number is unchanged.
    const incrementCount =
      body.split("gameState.gameNumber := gameState.gameNumber + 1").length - 1;
    expect(incrementCount).toBe(1);
  });

  it("threads the captured value into every mint call, not the mutated field", () => {
    // Each mint call receives the local `gameNumber` binding. If a call were
    // passed `gameState.gameNumber` directly it would read the incremented
    // value and reintroduce the off-by-one.
    for (const call of [
      "Nft.recordStaleHeartbeatSkips(",
      "Nft.mintGuaranteedEntries(",
      "Nft.mintForEligiblePlayers(",
    ]) {
      const callIndex = body.indexOf(call);
      expect(callIndex).toBeGreaterThanOrEqual(0);
      // The argument list of each call ends with the captured `gameNumber,`.
      const callSlice = body.slice(callIndex, callIndex + 400);
      expect(callSlice).toContain("gameNumber,");
      // The call is never handed the raw mutable field.
      expect(callSlice).not.toContain("gameState.gameNumber");
    }
  });
});

describe("game-conclusion mint — fixed-recipient mint is gone from the hook", () => {
  const body = functionBody("mintGameNftsSafe");

  it("no longer calls the unconditional fixed-recipient mint", () => {
    // The accepted request removes the unconditional mint to the fixed
    // principal g2pdm-...-4qe at game conclusion.
    expect(body).not.toContain("mintToFixedRecipient");
    expect(body).not.toContain(
      "g2pdm-hmunr-5miqy-43zdt-fxmqu-yrqli-kqsjh-pusdw-gctym-kzi5w-4qe",
    );
  });

  it("still runs the per-player and guaranteed-entry mints", () => {
    // The two accepted mints must survive the removal.
    expect(body).toContain("Nft.mintForEligiblePlayers(");
    expect(body).toContain("Nft.mintGuaranteedEntries(");
  });
});
