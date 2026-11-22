import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Characterization of the STABLE parts of the backend game-end mint path,
 * taken BEFORE the mint path is repointed from a supply-derived requested
 * token id (with a 16-attempt collision retry) to the collection canister's
 * `mint_auto` entrypoint.
 *
 * The request intentionally changes HOW the requested token id is chosen and
 * removes the retry loop. It does NOT change the surrounding mint-path
 * contract, which must survive the rewrite:
 *
 *   1. The three pre-canister gates in `mintForPlayer`:
 *        - an empty wallet address returns `#skipped("invalid wallet address")`
 *          WITHOUT calling the collection canister;
 *        - a 64-char hex account id returns `#failed(...)` with the exact
 *          reason the frontend maps, WITHOUT calling the canister;
 *        - an unparseable address returns `#failed("wallet address parse
 *          failed")`.
 *   2. The exact skip/failure reason literals the frontend's
 *      `mint-status-helpers.ts` matches on. The frontend maps these by
 *      substring, so a reworded backend reason silently degrades the
 *      EndGameModal's plain-language status.
 *   3. The ICRC-7 metadata vec contract: every plain key plus the two
 *      `jalca:`-prefixed custom keys (`jalca:spell_name`, `jalca:game_number`)
 *      that new spell NFTs carry on-chain.
 *   4. The recorded `NftRecord.tokenId` is the canister-returned id, never a
 *      locally computed one — the invariant the `mint_auto` change relies on.
 *
 * The unconditional fixed-recipient mint (`mintToFixedRecipient`) was removed
 * by the accepted request, so this file no longer asserts it.
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
 * executes no backend code. It deliberately does NOT assert the supply-derived
 * requested-id derivation, the `icrc7_total_supply` call, or the 16-attempt
 * retry loop — those are the behavior the request intentionally removes.
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
  // Find the opening brace of the function body (the first `{` after the
  // signature's closing paren).
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

describe("backend mint path — pre-canister gates (stable across mint_auto)", () => {
  const body = functionBody("mintForPlayer");

  it("keeps the empty-address silent skip with its exact reason", () => {
    // An empty wallet address is a silent skip: no canister call, and the
    // exact reason the frontend maps to "Skipped — no wallet address".
    expect(body).toContain('#skipped("invalid wallet address")');
  });

  it("keeps the hex-account-id failure with its exact reason", () => {
    // A 64-char hex account id is recognized but not mintable; the exact
    // reason text is what the frontend matches on (`includes("hex account")`).
    expect(body).toContain(
      '"hex account IDs are not supported for minting; please use your principal textual address"',
    );
  });

  it("keeps the wallet-parse failure with its exact reason", () => {
    // An address that fails Principal.fromText is reported with this exact
    // reason, which the frontend maps via `includes("parse failed")`.
    expect(body).toContain('#failed("wallet address parse failed")');
  });

  it("keeps the trapped-mint failure reason prefix the frontend maps", () => {
    // A trapped inter-canister mint call is captured with the
    // "mint canister call trapped: " prefix followed by the REAL caught error
    // message (the accepted request stops swallowing it). The frontend maps
    // this via `includes("mint canister call")`, so the prefix is the stable
    // part; the suffix is the real trap text.
    expect(body).toContain('"mint canister call trapped: " # e.message()');
  });
});

describe("backend mint path — skip/failure reason literals the frontend maps", () => {
  it("keeps the no-wallet skip reason emitted by mintForEligiblePlayers", () => {
    const body = functionBody("mintForEligiblePlayers");
    expect(body).toContain('#skipped("no wallet address supplied")');
  });

  it("keeps the stale-heartbeat skip reason emitted by recordStaleHeartbeatSkips", () => {
    const body = functionBody("recordStaleHeartbeatSkips");
    expect(body).toContain('#skipped("stale heartbeat at game conclusion")');
  });

  it("keeps the whole-pass failure reason emitted by recordMintPassFailure", () => {
    const body = functionBody("recordMintPassFailure");
    // The reason is threaded through from the caller; the outcome variant is
    // the stable part (a #failed attempt with the caller's reason text).
    expect(body).toContain("#failed(reason)");
  });
});

describe("backend mint path — ICRC-7 metadata vec contract", () => {
  const body = functionBody("metadataToVec");

  it("emits every plain metadata key", () => {
    for (const key of [
      "gameResult",
      "endState",
      "finalBoardState",
      "recipientRole",
      "recipientTeam",
      "recipientUsername",
      "recipientWalletAddress",
      "moveCount",
      "concludedAt",
      "gameNumber",
      "spellId",
      "spellName",
    ]) {
      expect(body).toContain(`("${key}"`);
    }
  });

  it("emits the two jalca:-prefixed custom keys new spell NFTs carry", () => {
    // These are the on-chain keys the burn path reads back via
    // icrc7_token_metadata; dropping them would make new NFTs unreadable as
    // spell artifacts.
    expect(body).toContain('("jalca:spell_name", #Text(metadata.spellName))');
    expect(body).toContain('("jalca:game_number", #Nat(metadata.gameNumber))');
  });
});

describe("backend mint path — fixed-recipient mint is removed", () => {
  it("no longer defines the unconditional fixed-recipient mint", () => {
    // The accepted request removes the unconditional mint to the fixed
    // principal g2pdm-...-4qe at game conclusion.
    expect(source).not.toContain("func mintToFixedRecipient");
    expect(source).not.toContain(
      '"g2pdm-hmunr-5miqy-43zdt-fxmqu-yrqli-kqsjh-pusdw-gctym-kzi5w-4qe"',
    );
  });
});

describe("backend mint path — recorded token id is the canister-returned id", () => {
  it("records the #Ok(tokenId) returned by the collection canister", () => {
    const body = functionBody("mintForPlayer");
    // The success arm binds the canister-returned token id...
    expect(body).toContain("case (#Ok(tokenId))");
    // ...and the NftRecord is built from that bound id, never a local counter.
    expect(body).toMatch(/tokenId\s*;/u);
    expect(body).toContain("appendNft(store, record)");
  });

  it("appends the record through appendNft, which grows the nfts cache", () => {
    const body = functionBody("appendNft");
    expect(body).toContain("store.nfts := grown.toVarArray()");
  });
});
