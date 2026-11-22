import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cover for the accepted game-end mint cap and deterministic recipient walk.
 *
 * The request changes `Nft.mintForEligiblePlayers` (src/backend/lib/nft.mo):
 * the number of recipients per game is capped at 10, and when more than 10
 * players are eligible the recipients are chosen by a deterministic walk
 * driven by the last digit of the game number instead of minting to every
 * eligible player. The `api-doc.mo` mixin is a changed file that publishes
 * that contract to API consumers.
 *
 * Accepted behavior this file pins:
 *   1. `maxMintsPerGame` is 10.
 *   2. `selectMintRecipientIndices` returns every eligible position when
 *      N <= 10, and exactly 10 distinct positions when N > 10.
 *   3. The walk is driven by `d = gameNumber % 10`, with 0 treated as 10.
 *   4. The first recipient is index `d - 1` in the eligible list.
 *   5. From there the walk steps forward by `d`, wrapping modulo N, skipping
 *      already-picked players, until 10 distinct recipients are chosen.
 *   6. When the step-by-`d` orbit is exhausted (gcd(d, N) > 1), the walk
 *      advances by one position to the next unchosen player and resumes.
 *   7. `mintForEligiblePlayers` records an explicit
 *      `#skipped("no wallet address supplied")` attempt for every null/empty
 *      wallet player and never routes them into the mint path, then mints only
 *      to the selected recipients through the batched `mint_auto_batch` call.
 *   8. The published `getApiDoc()` text states the cap and the walk.
 *
 * The unconditional fixed-recipient mint (`mintToFixedRecipient`) was removed
 * by the accepted request, so this file no longer asserts it. The per-player
 * cap and walk are unchanged and remain covered.
 *
 * Why this is a source contract and not a runtime assertion:
 *   - The frontend suite mocks the backend actor, so it never executes the
 *     mint path.
 *   - `selectMintRecipientIndices` is a pure function internal to
 *     `lib/nft.mo`; the generated declarations expose only the composed actor
 *     surface, so there is no public Candid method to call it through.
 *   - The PocketIC lane installs the real wasm, but the external collection
 *     canister (23quc-cyaaa-aaaac-bfvia-cai) does not exist in the replica, so
 *     the inter-canister mint rejects before any recipient is recorded. The
 *     lane also skips entirely when `src/backend/dist/backend.wasm` is absent
 *     (it is absent in this dispatch — see episode.coverageLimits).
 *
 * This file reads the backend source text only. It makes no network call and
 * executes no backend code. It deliberately does NOT assert the old uncapped
 * behavior (minting to every eligible player when N > 10) — that is the
 * behavior the request intentionally removes.
 */

/**
 * Absolute path to the backend NFT module under test. The frontend `test`
 * script runs Vitest with the frontend package as its working directory, so
 * the backend source sits at `../backend/lib/nft.mo` from there.
 */
const NFT_MODULE_PATH = resolve(process.cwd(), "../backend/lib/nft.mo");
const API_DOC_PATH = resolve(process.cwd(), "../backend/mixins/api-doc.mo");

const source = readFileSync(NFT_MODULE_PATH, "utf8");
const apiDocSource = readFileSync(API_DOC_PATH, "utf8");

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

describe("game-end mint cap — maxMintsPerGame constant", () => {
  it("caps the per-game mint at 10", () => {
    // The single source of truth for the cap. Both the <=10 short-circuit and
    // the >10 walk loop are bounded by it.
    expect(source).toContain("let maxMintsPerGame : Nat = 10");
  });
});

describe("selectMintRecipientIndices — 10 or fewer eligible players", () => {
  const body = functionBody("selectMintRecipientIndices");

  it("returns every eligible position when N <= maxMintsPerGame", () => {
    // The short-circuit: with 10 or fewer eligible players, every eligible
    // player is selected (one NFT each). The returned positions are the
    // eligible-list positions 0..N-1, in order.
    expect(body).toContain("if (n <= maxMintsPerGame)");
    expect(body).toContain("return Array.tabulate(n, func(i) { i })");
  });
});

describe("selectMintRecipientIndices — more than 10 eligible players", () => {
  const body = functionBody("selectMintRecipientIndices");

  it("derives d from the last digit of the game number, treating 0 as 10", () => {
    // d is the last digit of the game number, with 0 treated as 10 so d is
    // always in 1..10.
    expect(body).toContain("let lastDigit = gameNumber % 10");
    expect(body).toContain("let d = if (lastDigit == 0) 10 else lastDigit");
  });

  it("starts the walk at index d - 1 in the eligible list", () => {
    // The first recipient is the eligible player at index (d - 1). The
    // implementation computes it as `(d + n - 1) % n` to avoid an unchecked
    // Nat subtraction; that is the same value for d in 1..10.
    expect(body).toContain("var cursor = (d + n - 1) % n");
  });

  it("steps forward by d, wrapping modulo N, skipping already-picked players", () => {
    // The inner loop advances the cursor by d (mod N) while the position is
    // already chosen, bounded by N steps.
    expect(body).toContain("while (chosen.contains(cursor) and steps < n)");
    expect(body).toContain("cursor := (cursor + d) % n");
    expect(body).toContain("steps += 1");
  });

  it("advances one position when the step-by-d orbit is exhausted", () => {
    // When gcd(d, N) > 1 the step-by-d orbit is a proper subset; the walk
    // advances by one position (wrapping) to the next unchosen player and
    // resumes stepping by d from there. This guarantees 10 distinct
    // recipients whenever N > 10.
    expect(body).toContain("var probe = 0");
    expect(body).toContain("while (probe < n and chosen.contains(cursor))");
    expect(body).toContain("cursor := (cursor + 1) % n");
    expect(body).toContain("probe += 1");
  });

  it("stops after exactly maxMintsPerGame distinct recipients", () => {
    // The outer loop is bounded by the cap, so it can never select more than
    // 10 recipients.
    expect(body).toContain("while (chosen.size() < maxMintsPerGame)");
    expect(body).toContain("chosen.add(cursor)");
    expect(body).toContain("chosen.toArray()");
  });

  it("returns positions in the eligible list, not original player-list indices", () => {
    // The function is pure and side-effect free: it takes the eligible
    // positions and returns chosen positions into that same list, so the
    // caller maps them back through `eligible[position]`. The signature
    // declares `eligibleIndices : [Nat]` and the body returns `chosen.toArray()`.
    expect(source).toContain("eligibleIndices : [Nat]");
    expect(body).toContain("chosen.toArray()");
  });
});

describe("mintForEligiblePlayers — two-pass eligibility and selection", () => {
  const body = functionBody("mintForEligiblePlayers");

  it("records an explicit no-wallet skip for every null/empty wallet player", () => {
    // Pass 1 records `#skipped("no wallet address supplied")` for both the
    // null and the empty wallet branches, so walletless players are never
    // silently dropped and never eligible for selection.
    const skipCount =
      body.split('#skipped("no wallet address supplied")').length - 1;
    expect(skipCount).toBeGreaterThanOrEqual(2);
    expect(body).toContain("appendMintAttempt(store, skipAttempt)");
  });

  it("collects eligible indices only for non-empty wallet addresses", () => {
    // The eligibility test is the same non-null/non-empty check the mint loop
    // has always used, so the definition of "eligible" does not drift.
    expect(body).toContain("eligibleIndices.add(i)");
    expect(body).toContain("if (address.isEmpty())");
  });

  it("selects recipients through selectMintRecipientIndices", () => {
    // Pass 2 delegates the cap/walk decision to the pure selection function.
    expect(body).toContain("selectMintRecipientIndices(eligible, gameNumber)");
  });

  it("mints only to the selected recipients through the batched mint_auto_batch call", () => {
    // The precompute loop iterates the chosen positions (not every eligible
    // player) and builds the batch that is minted through the collection
    // canister's batched mint_auto_batch entrypoint.
    expect(body).toContain("for (position in chosenPositions.values())");
    expect(body).toContain("playerList[eligible[position]]");
    expect(body).toContain("await icrc7Collection.mint_auto_batch(");
  });

  it("does not mint to a walletless player", () => {
    // The only mint call is reached from the precomputed batch, which is built
    // from the eligible (non-empty wallet) list. Assert the skip is recorded
    // before the mint call so a rewrite cannot route a walletless player into
    // the mint path.
    const skipIndex = body.indexOf('#skipped("no wallet address supplied")');
    const mintIndex = body.indexOf("await icrc7Collection.mint_auto_batch(");
    expect(skipIndex).toBeGreaterThanOrEqual(0);
    expect(mintIndex).toBeGreaterThan(skipIndex);
  });
});

describe("fixed-recipient mint is removed from the per-game cap", () => {
  it("no longer defines the unconditional fixed-recipient mint", () => {
    // The accepted request removes the unconditional mint to the fixed
    // principal g2pdm-...-4qe at game conclusion. The function and its
    // hardcoded principal literal must be gone from the NFT module.
    expect(source).not.toContain("func mintToFixedRecipient");
    expect(source).not.toContain(
      '"g2pdm-hmunr-5miqy-43zdt-fxmqu-yrqli-kqsjh-pusdw-gctym-kzi5w-4qe"',
    );
  });
});

describe("published API doc states the cap and the deterministic walk", () => {
  it("documents the 10-per-game maximum and the <=10 / >10 split", () => {
    expect(apiDocSource).toContain("Maximum of 10 NFTs per game");
    expect(apiDocSource).toContain("maxMintsPerGame = 10");
    expect(apiDocSource).toContain("10 or fewer");
    expect(apiDocSource).toContain("every");
    expect(apiDocSource).toContain("exactly");
    expect(apiDocSource).toContain("10 distinct recipients");
  });

  it("documents the last-digit-driven walk and the orbit-exhaustion fallback", () => {
    expect(apiDocSource).toContain("last digit of the");
    expect(apiDocSource).toContain("0` treated as `10");
    expect(apiDocSource).toContain("index `d - 1`");
    expect(apiDocSource).toContain("step forward by `d` positions");
    expect(apiDocSource).toContain("skipping already-picked players");
    expect(apiDocSource).toContain("gcd(d, N) > 1");
    expect(apiDocSource).toContain("advances by one position");
  });

  it("documents the fixed-recipient mint as outside the cap", () => {
    expect(apiDocSource).toContain("Separate fixed-recipient mint");
    expect(apiDocSource).toContain("not** part of the 10-per-game cap");
  });
});
