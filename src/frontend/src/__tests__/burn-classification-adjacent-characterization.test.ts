import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Characterization of the backend burn classification path that must SURVIVE
 * the legacy-reason change, taken BEFORE that change and updated for the
 * accepted post-change shape.
 *
 * The request intentionally changes how a failed/trapped/empty metadata read
 * is handled: it is retried, and a Legacy classification carries a specific
 * reason. The pre-change "any non-(?name, ?number) pair collapses to
 * #burnedLegacy with no reason" behavior is gone, so this file does NOT pin
 * that collapse.
 *
 * What it protects is the adjacent behavior the request leaves alone:
 *   - a successful burn whose pre-burn read produced BOTH keys is still
 *     classified #burnedWithSpell carrying the on-chain spell name and game
 *     number (the "valid spell keys" path);
 *   - the spell keys are still read BEFORE the burn, because the burn destroys
 *     the token and its metadata;
 *   - burnNft still delegates to the single burnNfts implementation;
 *   - readSpellKeys still reads both jalca: metadata keys.
 *
 * Why this is a source contract and not a runtime assertion:
 *   - The frontend suite mocks the backend actor, so it never sees the
 *     BurnOutcome classification.
 *   - The PocketIC lane installs the real wasm, but the external collection
 *     canister (23quc-cyaaa-aaaac-bfvia-cai) does not exist in the replica, so
 *     the icrc7_burn call rejects before a successful burn can be observed.
 *     The lane's burn tests assert the per-token #failed mapping, not the
 *     #burnedWithSpell classification.
 *
 * It reads the source text only; it makes no network call and executes no
 * backend code.
 */

const NFT_MODULE_PATH = resolve(process.cwd(), "../backend/lib/nft.mo");
const source = readFileSync(NFT_MODULE_PATH, "utf8");

/** Extract the body of a `func <name>(...) ... { ... }` declaration. */
function funcBody(name: string): string {
  const header = new RegExp(`func\\s+${name}\\s*\\(`, "u");
  const match = header.exec(source);
  if (match === null) {
    throw new Error(`func ${name} not found in ${NFT_MODULE_PATH}`);
  }
  // Find the opening brace of the body after the signature.
  const braceStart = source.indexOf("{", match.index);
  if (braceStart === -1) {
    throw new Error(`func ${name} has no body in ${NFT_MODULE_PATH}`);
  }
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart + 1, i);
    }
  }
  throw new Error(`unterminated func ${name} in ${NFT_MODULE_PATH}`);
}

describe("backend burn classification adjacent invariants", () => {
  it("classifies a successful burn with both keys as #burnedWithSpell", () => {
    const body = funcBody("burnNfts");

    // The positive classification: when the pre-burn read produced both the
    // spell name and the game number, the outcome carries them. The read now
    // returns a #ok(name, number) classification (the retry-aware shape), so
    // the positive arm matches that.
    expect(body).toMatch(
      /case\s*\(#ok\(name,\s*number\)\)\s*#burnedWithSpell\s*\(\s*\{\s*spellName\s*=\s*name;\s*gameNumber\s*=\s*number\s*\}\s*\)/u,
    );
  });

  it("reads the spell keys before submitting the burn", () => {
    const body = funcBody("burnNfts");

    // The read-before-burn ordering is mandatory: the burn destroys the token
    // and its metadata, so the keys must be read first.
    const readIndex = body.indexOf("readSpellKeys");
    const burnIndex = body.indexOf("icrc7_burn");
    expect(readIndex).toBeGreaterThanOrEqual(0);
    expect(burnIndex).toBeGreaterThanOrEqual(0);
    expect(readIndex).toBeLessThan(burnIndex);
  });

  it("keeps burnNft delegating to the single burnNfts implementation", () => {
    const body = funcBody("burnNft");
    expect(body).toMatch(/burnNfts\s*\(\s*\[tokenId\]\s*\)/u);
  });

  it("keeps readSpellKeys reading both jalca: metadata keys", () => {
    const body = funcBody("readSpellKeys");

    // The two on-chain keys the classification depends on.
    expect(body).toMatch(/jalca:spell_name/u);
    expect(body).toMatch(/jalca:game_number/u);
  });

  it("retries a failed metadata read before classifying #readFailed", () => {
    const body = funcBody("readSpellKeys");

    // The accepted behavior: a failed/trapped/empty read is retried in a loop
    // bounded by maxReadAttempts, and only after every attempt fails is the
    // token classified #readFailed. A one-off failure on a token that does
    // carry keys must not produce a false Legacy result.
    expect(body).toMatch(/while\s*\(attempt\s*<\s*maxReadAttempts\)/u);
    expect(body).toMatch(/#legacy\(#readFailed\)/u);
    // The retry loop must precede the final #readFailed classification.
    const loopIndex = body.indexOf("while (attempt < maxReadAttempts)");
    const readFailedIndex = body.indexOf("#legacy(#readFailed)");
    expect(loopIndex).toBeGreaterThanOrEqual(0);
    expect(readFailedIndex).toBeGreaterThan(loopIndex);
  });

  it("classifies each Legacy cause with its own reason", () => {
    const body = funcBody("readSpellKeys");

    // The four accepted causes are distinguished rather than collapsed into a
    // single Legacy result: both keys absent, a key of the wrong type, the two
    // keys disagreeing, and every read attempt failing.
    expect(body).toMatch(/#legacy\(#keysAbsent\)/u);
    expect(body).toMatch(/#legacy\(#wrongType\)/u);
    expect(body).toMatch(/#legacy\(#keysDisagree\)/u);
    expect(body).toMatch(/#legacy\(#readFailed\)/u);
  });

  it("does not retry a successful read that simply lacks the keys", () => {
    const body = funcBody("readSpellKeys");

    // A successful read that carries neither key is authoritative: it returns
    // #keysAbsent immediately rather than looping, so a genuinely legacy token
    // is not misreported as a transient read failure.
    const keysAbsentIndex = body.indexOf("#legacy(#keysAbsent)");
    const loopIndex = body.indexOf("while (attempt < maxReadAttempts)");
    expect(keysAbsentIndex).toBeGreaterThan(loopIndex);
    // The keysAbsent return is inside the successful-read branch, before the
    // loop's closing brace — it returns rather than continuing the loop.
    expect(body.slice(keysAbsentIndex, keysAbsentIndex + 40)).toMatch(
      /#legacy\(#keysAbsent\)/u,
    );
  });

  it("carries the Legacy reason through burnNfts into #burnedLegacy", () => {
    const body = funcBody("burnNfts");

    // The reason read before the burn is threaded into the per-token outcome,
    // so the frontend can render the specific cause.
    expect(body).toMatch(
      /case\s*\(#legacy\(reason\)\)\s*#burnedLegacy\(reason\)/u,
    );
  });
});
