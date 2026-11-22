import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { MintOutcome } from "@/backend";
import { describeMintOutcome } from "@/components/mint-status-helpers";

/**
 * Cover for the two accepted requirements of the NFT mint Candid fix:
 *
 *   1. The mint path calls the collection canister's `mint_auto` with the
 *      two-argument Candid shape `(Account, [(Text, Metadata)])` instead of a
 *      single `MintAutoArgs` record.
 *   2. A failed mint surfaces the REAL caught error text instead of the
 *      hardcoded generic `"mint canister call trapped"` message.
 *
 * The acceptance criterion is: playing a game to resolution either mints
 * successfully with a returned token id, or the error box shows the actual
 * trap text rather than a generic message.
 *
 * Why this is a source contract plus a pure-helper assertion and not a runtime
 * backend assertion:
 *   - The frontend suite mocks the backend actor, so it never executes the
 *     mint path.
 *   - The PocketIC lane installs the real wasm, but the external collection
 *     canister (23quc-cyaaa-aaaac-bfvia-cai) does not exist in the replica, so
 *     the inter-canister mint rejects before any receipt is returned.
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

describe("backend mint path — two-argument mint_auto Candid shape", () => {
  it("declares mint_auto as (Account, [(Text, Metadata)]) -> async MintReceipt", () => {
    // The actor interface must declare the two-argument Candid shape.
    expect(source).toContain(
      "mint_auto : (Account, [(Text, Metadata)]) -> async MintReceipt",
    );
  });

  it("removed the single-record MintAutoArgs type", () => {
    // The old single-record argument type is gone.
    expect(source).not.toContain("type MintAutoArgs");
  });

  it("calls mint_auto with the recipient account and metadata vec as two arguments", () => {
    const body = functionBody("mintForPlayer");
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
});

describe("backend mint path — the catch arm surfaces the real caught error", () => {
  it("appends the caught error message to the trapped-mint reason", () => {
    const body = functionBody("mintForPlayer");
    // The catch arm binds the caught error and appends its real message text
    // after the stable prefix, instead of a hardcoded generic string.
    expect(body).toContain("} catch e {");
    expect(body).toContain('"mint canister call trapped: " # e.message()');
  });

  it("records the real caught error text as a #failed MintAttempt", () => {
    const body = functionBody("mintForPlayer");
    // The real reason is recorded on the attempt the modal reads, not only
    // logged.
    expect(body).toContain("let failOutcome : MintOutcome = #failed(reason)");
    expect(body).toContain("appendMintAttempt(store, failAttempt)");
  });

  it("no longer hardcodes the generic trapped-mint reason", () => {
    const body = functionBody("mintForPlayer");
    expect(body).not.toContain('#failed("mint canister call trapped")');
  });
});

describe("frontend error box — the real trap text reaches the user", () => {
  function failed(reason: string): MintOutcome {
    return { __kind__: "failed", failed: reason };
  }

  it("shows the actual trap text rather than a generic message", () => {
    // The acceptance criterion: the error box shows the actual trap text. The
    // backend now emits "mint canister call trapped: <real message>"; the
    // helper's known-prefix mapping must not swallow the real message.
    const trap =
      "mint canister call trapped: IC0503: Canister 23quc-cyaaa-aaaac-bfvia-cai trapped explicitly: no such method";
    const { reason, tone } = describeMintOutcome(failed(trap));
    expect(reason).toBe(
      "Failed — the mint call errored: IC0503: Canister 23quc-cyaaa-aaaac-bfvia-cai trapped explicitly: no such method",
    );
    expect(tone).toBe("failure");
  });

  it("surfaces an arbitrary trap string verbatim", () => {
    const trap =
      "IC0503: Canister 23quc-cyaaa-aaaac-bfvia-cai trapped explicitly: no such method";
    const { reason, tone } = describeMintOutcome(failed(trap));
    expect(reason).toBe(`Failed — ${trap}`);
    expect(tone).toBe("failure");
  });
});
