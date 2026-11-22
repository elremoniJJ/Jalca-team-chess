import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { MintOutcome } from "@/backend";
import { describeMintOutcome } from "@/components/mint-status-helpers";

/**
 * Characterization taken BEFORE the per-mint floor-safety check is removed
 * from the `mint_auto` call path in `mintForPlayer` (src/backend/lib/nft.mo).
 *
 * The request removes the gate that refuses to rely on `mint_auto` when the
 * highest token id ever recorded in the local NftRecord cache is at or above
 * the collection counter start (200), so future mints are not permanently
 * rejected with the `"mint_auto unsafe: highest recorded token id ... is at or
 * above the collection counter start ..."` reason.
 *
 * This file deliberately does NOT assert the safety gate, its helper
 * functions, the `getMintAutoSafety` query, or the published safety-check
 * documentation — those are the behavior the request intentionally changes.
 *
 * What it protects is the behavior ADJACENT to the gate that must survive its
 * removal, because the game conclusion modal and the acceptance criteria
 * depend on it:
 *
 *   1. The three pre-canister gates in `mintForPlayer` still run, in order,
 *      BEFORE the `mint_auto` call:
 *        - an empty wallet address returns `#skipped("invalid wallet
 *          address")` without calling the canister;
 *        - a 64-char hex account id returns `#failed(...)` with the exact
 *          reason the frontend maps, without calling the canister;
 *        - an unparseable address returns `#failed("wallet address parse
 *          failed")`.
 *      Removing the safety gate must not remove or reorder these.
 *   2. The `mint_auto` call itself survives: it is still called with the two
 *      Candid arguments (recipient account, metadata vec), and the returned
 *      `#Ok(tokenId)` is still recorded as the local NftRecord's token id.
 *      The whole point of removing the gate is that the mint proceeds, so the
 *      call and its success recording must remain.
 *   3. The sibling `#Err` arm still surfaces the REAL collection-canister
 *      error text (`#GenericError(e) e.message` and each distinct variant
 *      literal), so a rejected mint is still diagnosable.
 *   4. `mintForEligiblePlayers` still records the no-wallet skip and routes
 *      selected recipients through the shared `mintForPlayer` flow.
 *   5. The frontend consumer seam (`describeMintOutcome`) still maps the
 *      trapped-mint reason and passes an unknown failure reason through
 *      verbatim, so the modal keeps showing real error text.
 *
 * Why this is a source contract plus a pure-helper assertion and not a runtime
 * backend assertion:
 *   - The frontend suite mocks the backend actor, so it never executes the
 *     mint path.
 *   - The PocketIC lane installs the real wasm, but the external collection
 *     canister (23quc-cyaaa-aaaac-bfvia-cai) does not exist in the replica, so
 *     the inter-canister mint rejects before any token id is returned. The
 *     lane also skips entirely when `src/backend/dist/backend.wasm` is absent
 *     (it is absent in this dispatch — see episode.coverageLimits).
 *   - The mint path is internal to `lib/nft.mo`; the generated declarations
 *     expose only the composed actor surface.
 *
 * This file reads the backend source text and calls a pure frontend helper. It
 * makes no network call and executes no backend code.
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

describe("mintForPlayer — pre-canister gates survive the safety-gate removal", () => {
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

  it("runs every pre-canister gate before the mint_auto call", () => {
    // The gates must precede the canister call so a non-mintable address never
    // reaches the collection canister. Removing the safety gate must not
    // reorder or drop them.
    const emptySkip = body.indexOf('#skipped("invalid wallet address")');
    const hexFail = body.indexOf("hex account IDs are not supported");
    const parseFail = body.indexOf('#failed("wallet address parse failed")');
    const mintCall = body.indexOf("await icrc7Collection.mint_auto(");
    expect(emptySkip).toBeGreaterThanOrEqual(0);
    expect(hexFail).toBeGreaterThan(emptySkip);
    expect(parseFail).toBeGreaterThan(hexFail);
    expect(mintCall).toBeGreaterThan(parseFail);
  });
});

describe("mintForPlayer — the mint_auto call and its success recording survive", () => {
  const body = functionBody("mintForPlayer");

  it("still calls mint_auto with the recipient account and metadata vec", () => {
    // The accepted Candid shape is two separate arguments: the recipient
    // account and the metadata vec. Removing the safety gate must not remove
    // the call it guarded.
    expect(body).toContain(
      "await icrc7Collection.mint_auto(recipient, metadataVec)",
    );
    expect(body).toContain(
      "let recipient : Account = { owner; subaccount = null }",
    );
    expect(body).toContain(
      "let metadataVec : [(Text, Metadata)] = metadataToVec(request.metadata)",
    );
  });

  it("still records the #Ok(tokenId) returned by the collection canister", () => {
    // The success arm binds the canister-returned token id and builds the
    // local NftRecord from it, never from a locally computed id.
    expect(body).toContain("case (#Ok(tokenId))");
    expect(body).toMatch(/tokenId\s*;/u);
    expect(body).toContain("appendNft(store, record)");
  });

  it("still records a #succeeded outcome for the modal", () => {
    // The success outcome the game conclusion modal renders must remain.
    expect(body).toContain("#succeeded({ tokenId })");
    expect(body).toContain("appendMintAttempt(store, okAttempt)");
  });
});

describe("mintForPlayer — the #Err arm still surfaces the real collection error", () => {
  const body = functionBody("mintForPlayer");

  it("reports the #GenericError message text rather than a generic literal", () => {
    expect(body).toContain("case (#GenericError(e)) e.message");
  });

  it("keeps a distinct literal for every other MintError variant", () => {
    expect(body).toContain('case (#Unauthorized) "unauthorized"');
    expect(body).toContain('case (#InvalidRecipient) "invalid recipient"');
    expect(body).toContain('case (#SupplyCapOverflow) "supply cap overflow"');
    expect(body).toContain(
      'case (#AlreadyExistTokenId) "token id already exists"',
    );
  });

  it("records the #Err reason as a #failed MintAttempt", () => {
    expect(body).toContain("let failOutcome : MintOutcome = #failed(message)");
    expect(body).toContain("appendMintAttempt(store, failAttempt)");
  });
});

describe("mintForEligiblePlayers — walletless skip and shared mint flow survive", () => {
  const body = functionBody("mintForEligiblePlayers");

  it("records the no-wallet skip reason the modal renders", () => {
    expect(body).toContain('#skipped("no wallet address supplied")');
    expect(body).toContain("appendMintAttempt(store, skipAttempt)");
  });

  it("routes selected recipients through the batched mint_auto_batch call", () => {
    // The capped tier was repointed from the shared per-player mintForPlayer
    // flow to the collection canister's batched mint_auto_batch entrypoint.
    expect(body).toContain("await icrc7Collection.mint_auto_batch(");
  });
});

describe("frontend error box — real failure text still reaches the user", () => {
  function failed(reason: string): MintOutcome {
    return { __kind__: "failed", failed: reason };
  }

  it("still maps the known trapped-mint reason to its plain-language text", () => {
    // The known generic reason keeps its friendly mapping; removing the
    // backend safety gate must not disturb this consumer mapping.
    const { reason, tone } = describeMintOutcome(
      failed("mint canister call trapped"),
    );
    expect(reason).toBe("Failed — the mint call errored");
    expect(tone).toBe("failure");
  });

  it("still surfaces an arbitrary failure reason verbatim", () => {
    // A real inter-canister trap (e.g. IC0503) is not one of the known
    // substrings, so the helper must pass it through verbatim.
    const trap =
      "IC0503: Canister 23quc-cyaaa-aaaac-bfvia-cai trapped explicitly: no such method";
    const { reason, tone } = describeMintOutcome(failed(trap));
    expect(reason).toBe(`Failed — ${trap}`);
    expect(tone).toBe("failure");
  });
});
