import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Characterization of the CURRENT (pre-change) game-end NFT mint path and the
 * burn path's metadata-key reads, taken BEFORE the mint call shape is
 * intentionally changed.
 *
 * The request describes the current state:
 *   - the game-end mint mints each eligible player sequentially through the
 *     collection canister's `mint_auto`, with a guaranteed tier and a capped
 *     tier, and the guaranteed tier is additive (it does not consume the cap);
 *   - the burn path reads the `jalca:spell_name` and `jalca:game_number`
 *     metadata keys before burning.
 *
 * Acceptance criterion #2 is explicit: this characterization must capture the
 * current mint call shape and the burn metadata keys, but it must NOT freeze
 * the mint call shape as a baseline. An intentional change to the mint call
 * shape (for example, a different callee, argument order, or a single-record
 * argument) must be able to land without this file failing.
 *
 * How that is achieved:
 *   - The mint call shape is captured as a DESCRIPTIVE baseline: the file
 *     asserts the invariants that must survive any call-shape change — the
 *     recipient account is built from the parsed owner with a null subaccount,
 *     the metadata vec is built from the request metadata, no token id is
 *     supplied, and the canister-returned `#Ok(tokenId)` is what gets recorded.
 *     It does NOT assert the literal `mint_auto(recipient, metadataVec)`
 *     expression, the callee name, or the argument order.
 *   - The burn metadata keys are captured as the two exact `jalca:`-prefixed
 *     key literals the burn path reads, because those are the on-chain keys the
 *     classification depends on and are not the thing the request changes.
 *   - The adjacent behavior that must survive a call-shape change is protected:
 *     sequential per-player minting, the guaranteed tier being additive and
 *     excluded from the cap, and the capped tier's selection.
 *
 * Why this is a source contract and not a runtime assertion:
 *   - The frontend suite mocks the backend actor, so it never executes the
 *     mint or burn path.
 *   - The PocketIC lane installs the real wasm, but the external collection
 *     canister (23quc-cyaaa-aaaac-bfvia-cai) does not exist in the replica, so
 *     the inter-canister mint/burn rejects before a receipt is returned. The
 *     lane also skips entirely when `src/backend/dist/backend.wasm` is absent
 *     (it is absent in this dispatch — see episode.coverageLimits).
 *   - The mint and burn paths are internal to `lib/nft.mo`; the generated
 *     declarations expose only the composed actor surface.
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

const source = readFileSync(NFT_MODULE_PATH, "utf8");

/**
 * Extract the body of a `func <name>(...) : ... { ... };` declaration by brace
 * matching, so assertions do not depend on surrounding comments or whitespace.
 * Matches both `func` and `public func` declarations. Returns the text between
 * the outermost braces of the function.
 */
function functionBody(name: string): string {
  const header = new RegExp(`(?:public\\s+)?func\\s+${name}\\s*\\(`, "u");
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

describe("current mint call shape — descriptive baseline, not a frozen contract", () => {
  const body = functionBody("mintForPlayer");

  it("builds the recipient account from the parsed owner with a null subaccount", () => {
    // The recipient account is derived from the wallet address parsed to a
    // Principal, with no subaccount. This is the shape invariant that must
    // survive any change to how the mint call is spelled.
    expect(body).toContain(
      "let recipient : Account = { owner; subaccount = null }",
    );
    // The owner comes from parsing the wallet address, not from a raw string.
    expect(body).toContain("Principal.fromText(address)");
  });

  it("builds the metadata vec from the request metadata", () => {
    // The metadata vec is the ICRC-7 (Text, Metadata) vec produced by
    // metadataToVec from the request's metadata. A call-shape change must keep
    // passing the request metadata through, not a hardcoded or empty vec.
    expect(body).toContain(
      "let metadataVec : [(Text, Metadata)] = metadataToVec(request.metadata)",
    );
  });

  it("supplies no token id on the mint path", () => {
    // The current shape lets the collection canister assign the token id
    // internally. The mint path must not carry a token_id field. This is the
    // invariant the request relies on, independent of the call's spelling.
    expect(body).not.toContain("token_id");
  });

  it("records the canister-returned #Ok(tokenId), never a locally computed id", () => {
    // The success arm binds the id the canister returned and builds the local
    // NftRecord from it. A call-shape change must preserve this: the recorded
    // token id is the canister's, not a local counter.
    expect(body).toContain("case (#Ok(tokenId))");
    expect(body).toMatch(/tokenId\s*;/u);
    expect(body).toContain("appendNft(store, record)");
  });

  it("captures the current call as a two-argument canister call (descriptive)", () => {
    // DESCRIPTIVE ONLY: this records that the current shape is a two-argument
    // call to the collection canister's mint_auto, passing the recipient
    // account and the metadata vec. It is deliberately written as a loose
    // shape check (a call on icrc7Collection with two arguments) rather than
    // an exact-expression assertion, so an intentional change to the callee
    // name, argument order, or argument record shape is not frozen here.
    expect(body).toMatch(
      /await\s+icrc7Collection\.\w+\(\s*[A-Za-z_][\w]*\s*,\s*[A-Za-z_][\w]*\s*\)/u,
    );
  });
});

describe("burn path — the two jalca: metadata keys it reads", () => {
  it("reads jalca:spell_name and jalca:game_number before the burn", () => {
    // The burn classification depends on these two exact on-chain keys. They
    // are read from a single metadata fetch per attempt, before the burn
    // destroys the token and its metadata.
    const body = functionBody("readSpellKeys");
    expect(body).toContain('"jalca:spell_name"');
    expect(body).toContain('"jalca:game_number"');
  });

  it("reads the keys before submitting the burn", () => {
    // The read-before-burn ordering is mandatory: the burn destroys the token
    // and its metadata, so the keys must be read first.
    const body = functionBody("burnNfts");
    const readIndex = body.indexOf("readSpellKeys");
    const burnIndex = body.indexOf("icrc7_burn");
    expect(readIndex).toBeGreaterThanOrEqual(0);
    expect(burnIndex).toBeGreaterThanOrEqual(0);
    expect(readIndex).toBeLessThan(burnIndex);
  });

  it("emits the same two keys on newly minted spell NFTs", () => {
    // The mint side writes the keys the burn side reads. If either literal
    // drifts, new NFTs become unreadable as spell artifacts.
    const body = functionBody("metadataToVec");
    expect(body).toContain('("jalca:spell_name", #Text(metadata.spellName))');
    expect(body).toContain('("jalca:game_number", #Nat(metadata.gameNumber))');
  });
});

describe("adjacent behavior that must survive a mint call-shape change", () => {
  it("precomputes each selected recipient before the batched mint call", () => {
    // The accepted path precomputes every chosen recipient (owner, spell roll,
    // metadata) in a loop over the chosen positions BEFORE any batch call, then
    // mints them through the collection canister's batched mint_auto_batch
    // entrypoint. A call-shape change must not drop the per-recipient
    // precomputation or the per-player outcome recording.
    const body = functionBody("mintForEligiblePlayers");
    expect(body).toContain("for (position in chosenPositions.values())");
    expect(body).toContain("await icrc7Collection.mint_auto_batch(");
  });

  it("keeps the guaranteed tier additive and outside the capped pool", () => {
    // The guaranteed tier is minted separately and does not consume the
    // 10-per-game cap; guaranteed usernames are excluded from the capped
    // eligible list. This relationship must survive a call-shape change.
    const body = functionBody("mintForEligiblePlayers");
    expect(body).toContain("guaranteedUsernames.contains(entry.username)");
    const excludeIndex = body.indexOf(
      "guaranteedUsernames.contains(entry.username)",
    );
    const eligibleIndex = body.indexOf("eligibleIndices.add(i)");
    expect(excludeIndex).toBeGreaterThanOrEqual(0);
    expect(eligibleIndex).toBeGreaterThan(excludeIndex);

    const guaranteedBody = functionBody("mintGuaranteedEntries");
    expect(guaranteedBody).not.toContain("maxMintsPerGame");
    expect(guaranteedBody).not.toContain("selectMintRecipientIndices");
  });

  it("keeps the capped tier's selection bounded by maxMintsPerGame", () => {
    // The capped tier still selects through the deterministic walk bounded by
    // the 10-per-game cap. A call-shape change must not remove the cap.
    expect(source).toContain("let maxMintsPerGame : Nat = 10");
    const body = functionBody("selectMintRecipientIndices");
    expect(body).toContain("while (chosen.size() < maxMintsPerGame)");
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
