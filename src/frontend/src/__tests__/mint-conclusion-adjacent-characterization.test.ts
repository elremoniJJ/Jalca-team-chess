import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Characterization of the STABLE parts of the game-conclusion NFT mint path,
 * taken BEFORE the request removes the unconditional fixed-recipient mint and
 * fixes the game-number off-by-one.
 *
 * The request intentionally:
 *   1. REMOVES the unconditional mint to the fixed principal
 *      g2pdm-hmunr-5miqy-43zdt-fxmqu-yrqli-kqsjh-pusdw-gctym-kzi5w-4qe;
 *   2. changes the game number stamped on the end-of-game NFT from N+1 to N.
 *
 * Those two things are intentional, so this file deliberately does NOT assert
 * the fixed-recipient mint and does NOT assert the incremented stamp. What it
 * protects is the behavior ADJACENT to the change that must survive it:
 *
 *   - the per-player mint (`mintForEligiblePlayers`) still runs on game
 *     conclusion and still mints through the shared `mintForPlayer` flow;
 *   - the guaranteed-entry mint (`mintGuaranteedEntries`) still runs and is
 *     still additive (outside the capped pool);
 *   - the game number is still threaded into the mint metadata as the
 *     `jalca:game_number` custom key, so the end-of-game NFT remains a
 *     verifiable game artifact;
 *   - the conclusion hook (`mintGameNftsSafe`) still calls both the
 *     guaranteed-entry mint and the per-player mint.
 *
 * Why this is a source contract and not a runtime assertion:
 *   - The frontend suite mocks the backend actor, so it never executes the
 *     mint path.
 *   - The PocketIC lane installs the real wasm, but `src/backend/dist/backend.wasm`
 *     is absent in this dispatch, so the lane skips entirely (see
 *     episode.coverageLimits).
 *   - The mint path is internal to `lib/nft.mo`; the generated declarations
 *     expose only the composed actor surface.
 *
 * This file reads the backend source text only. It makes no network call and
 * executes no backend code.
 */

/**
 * Absolute path to the backend NFT module under test. The frontend `test`
 * script runs Vitest with the frontend package as its working directory, so
 * the backend source sits at `../backend/lib/nft.mo` from there.
 */
const NFT_MODULE_PATH = resolve(process.cwd(), "../backend/lib/nft.mo");
const CHESS_API_PATH = resolve(
  process.cwd(),
  "../backend/mixins/chess-game-api.mo",
);

const source = readFileSync(NFT_MODULE_PATH, "utf8");
const chessApiSource = readFileSync(CHESS_API_PATH, "utf8");

/**
 * Extract the body of a `public func <name>(...) : ... { ... };` declaration
 * by brace matching, so assertions do not depend on surrounding comments or
 * whitespace. Returns the text between the outermost braces of the function.
 */
function functionBody(name: string): string {
  const header = new RegExp(`public\\s+func\\s+${name}\\s*\\(`, "u");
  const match = header.exec(source);
  if (match === null) {
    throw new Error(`public func ${name} not found in ${NFT_MODULE_PATH}`);
  }
  const open = source.indexOf("{", match.index + match[0].length);
  if (open === -1) {
    throw new Error(`no body brace for public func ${name}`);
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
  throw new Error(`unterminated body for public func ${name}`);
}

describe("game-conclusion mint — per-player mint still runs", () => {
  const body = functionBody("mintForEligiblePlayers");

  it("still mints eligible players through the shared mintForPlayer flow", () => {
    // The per-player mint is the primary game-conclusion mint and must survive
    // the removal of the fixed-recipient mint.
    expect(body).toContain("await icrc7Collection.mint_auto_batch(");
  });

  it("still records an explicit no-wallet skip for walletless players", () => {
    // Walletless players are never silently dropped: the skip reason literal
    // the frontend maps is unchanged.
    expect(body).toContain('#skipped("no wallet address supplied")');
  });

  it("still threads the game number into the mint metadata", () => {
    // The game number is passed to buildMintMetadata, so the minted artifact
    // still carries the game it belongs to.
    expect(body).toContain("buildMintMetadata(");
    expect(body).toContain("gameNumber,");
  });
});

describe("game-conclusion mint — guaranteed-entry mint still runs", () => {
  const body = functionBody("mintGuaranteedEntries");

  it("still mints each guaranteed entry through the shared mintForPlayer flow", () => {
    expect(body).toContain("await mintForPlayer(");
  });

  it("still records a failed attempt when a guaranteed mint traps", () => {
    // A trapped guaranteed mint is recorded, not swallowed, so the failure is
    // visible to the frontend.
    expect(body).toContain('#failed("guaranteed mint trapped")');
    expect(body).toContain("appendMintAttempt(store, failAttempt)");
  });

  it("still threads the game number into the guaranteed mint metadata", () => {
    expect(body).toContain("buildMintMetadata(");
    expect(body).toContain("gameNumber,");
  });
});

describe("game-conclusion mint — metadata still carries the game number", () => {
  it("still emits the jalca:game_number custom key", () => {
    // The on-chain key the burn path reads back. The VALUE changes with the
    // off-by-one fix, but the key itself must survive.
    const body = functionBody("metadataToVec");
    expect(body).toContain('("jalca:game_number", #Nat(metadata.gameNumber))');
  });

  it("still emits the plain gameNumber metadata key", () => {
    const body = functionBody("metadataToVec");
    expect(body).toContain('("gameNumber"');
  });
});

describe("game-conclusion mint — the conclusion hook still calls both mints", () => {
  it("still calls the guaranteed-entry mint and the per-player mint", () => {
    // mintGameNftsSafe is the single mint-hook entry point every concludeGame
    // path funnels through. Both additive mints must still be invoked.
    expect(chessApiSource).toContain("Nft.mintGuaranteedEntries(");
    expect(chessApiSource).toContain("Nft.mintForEligiblePlayers(");
  });

  it("still records stale-heartbeat skips at conclusion", () => {
    expect(chessApiSource).toContain("Nft.recordStaleHeartbeatSkips(");
  });
});
