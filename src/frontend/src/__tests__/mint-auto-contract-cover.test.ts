import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cover for the accepted mint_auto token-id contract in the backend mint path.
 *
 * The request repoints the game-end mint from a supply-derived requested token
 * id (with a 16-attempt collision retry) to the collection canister's
 * `mint_auto` entrypoint:
 *
 *   1. `mintForPlayer` calls `icrc7Collection.mint_auto(...)` and passes only
 *      the recipient account and metadata — no token id is supplied.
 *   2. The returned `#Ok(tokenId)` is used to build the local NftRecord.
 *   3. All token-id computation, the `icrc7_total_supply` query on the mint
 *      path, and the 16-attempt collision retry loop are removed.
 *   4. The per-player `mintForEligiblePlayers` tier routes through the
 *      collection canister's batched `mint_auto_batch` entrypoint.
 *
 * The unconditional fixed-recipient mint (`mintToFixedRecipient`) was removed
 * by the accepted request, so this file no longer asserts it.
 *
 * The per-mint floor-safety check (`isMintAutoSafe` / `highestRecordedTokenId`
 * / `mintAutoCounterStart`) has been removed from the mint_auto call path, so
 * this file no longer asserts it. The mint proceeds without a safety gate.
 *
 * Why this is a source contract and not a runtime assertion:
 *   - The frontend suite mocks the backend actor, so it never executes the
 *     mint path.
 *   - The PocketIC lane installs the real wasm, but the external collection
 *     canister (23quc-cyaaa-aaaac-bfvia-cai) does not exist in the replica, so
 *     the inter-canister mint rejects before any token id is returned. The
 *     lane also skips entirely when `src/backend/dist/backend.wasm` is absent.
 *   - The mint path is internal to `lib/nft.mo`; the generated declarations
 *     expose only the composed actor surface.
 *
 * This file reads the backend source text only. It makes no network call and
 * executes no backend code. It deliberately does NOT assert the removed
 * supply-derived requested-id derivation, the `icrc7_total_supply` call on the
 * mint path, or the 16-attempt retry loop — those are the behavior the request
 * intentionally removes.
 */

/**
 * Absolute path to the backend NFT module under test. The frontend `test`
 * script runs Vitest with the frontend package as its working directory, so
 * the backend source sits at `../backend/lib/nft.mo` from there.
 */
const NFT_MODULE_PATH = resolve(process.cwd(), "../backend/lib/nft.mo");

const source = readFileSync(NFT_MODULE_PATH, "utf8");

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

describe("backend mint path — mint_auto entrypoint", () => {
  const body = functionBody("mintForPlayer");

  it("calls the collection canister's mint_auto entrypoint with two arguments", () => {
    // The accepted Candid shape is two separate arguments: the recipient
    // account and the metadata vec. The single-record MintAutoArgs shape was
    // removed.
    expect(body).toContain(
      "await icrc7Collection.mint_auto(recipient, metadataVec)",
    );
  });

  it("passes only the recipient account and metadata, with no token id", () => {
    // The recipient account is built from the parsed owner with a null
    // subaccount, and the metadata vec is built from the request metadata.
    expect(body).toContain(
      "let recipient : Account = { owner; subaccount = null }",
    );
    expect(body).toContain(
      "let metadataVec : [(Text, Metadata)] = metadataToVec(request.metadata)",
    );
    // No token_id field is set on the mint args.
    expect(body).not.toContain("token_id");
  });

  it("records the #Ok(tokenId) returned by the collection canister", () => {
    // The success arm binds the canister-returned token id...
    expect(body).toContain("case (#Ok(tokenId))");
    // ...and the NftRecord is built from that bound id.
    expect(body).toContain("tokenId;");
    expect(body).toContain("appendNft(store, record)");
  });

  it("removes the supply query and the collision retry loop from the mint path", () => {
    // No icrc7_total_supply call on the mint path.
    expect(body).not.toContain("icrc7_total_supply");
    // No 16-attempt retry loop.
    expect(body).not.toContain("maxMintAttempts");
    expect(body).not.toContain("while (attempt");
    // No local candidate-id computation: the mint path never allocates a
    // requested id from the local counter.
    expect(body).not.toContain("nextTokenId(store)");
  });
});

describe("backend mint path — entrypoints use the collection canister", () => {
  it("routes the capped per-player tier through the batched mint_auto_batch", () => {
    // The capped tier was repointed from a sequential per-player mint_auto
    // loop to the collection canister's batched mint_auto_batch entrypoint.
    const body = functionBody("mintForEligiblePlayers");
    expect(body).toContain("await icrc7Collection.mint_auto_batch(");
  });

  it("no longer defines the removed fixed-recipient mint", () => {
    // The accepted request removes the unconditional fixed-recipient mint, so
    // the function and its hardcoded principal literal are gone.
    expect(source).not.toContain("func mintToFixedRecipient");
    expect(source).not.toContain(
      '"g2pdm-hmunr-5miqy-43zdt-fxmqu-yrqli-kqsjh-pusdw-gctym-kzi5w-4qe"',
    );
  });
});

describe("backend mint path — the per-mint safety gate is removed", () => {
  it("no longer defines the safety-check helpers or constant", () => {
    // The accepted requirement removes the now-unused safety-check helpers and
    // constant entirely, with no remaining backend source references.
    expect(source).not.toContain("isMintAutoSafe");
    expect(source).not.toContain("highestRecordedTokenId");
    expect(source).not.toContain("mintAutoCounterStart");
  });

  it("no longer refuses a mint with the mint_auto unsafe reason", () => {
    // The mint call path must not fail with the removed safety reason.
    const body = functionBody("mintForPlayer");
    expect(body).not.toContain("mint_auto unsafe");
    expect(body).not.toContain("is at or above the collection counter start");
  });
});
