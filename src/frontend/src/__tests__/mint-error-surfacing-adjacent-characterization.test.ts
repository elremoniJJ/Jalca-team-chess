import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { MintOutcome } from "@/backend";
import { describeMintOutcome } from "@/components/mint-status-helpers";

/**
 * Characterization taken BEFORE the mint path stops swallowing the real
 * inter-canister trap text.
 *
 * The request changes TWO things in `mintForPlayer` (src/backend/lib/nft.mo):
 *   1. the `mint_auto` call shape (single record -> two Candid arguments); and
 *   2. the `catch` arm, which currently discards the caught error and reports
 *      the hardcoded `#failed("mint canister call trapped")` instead of the
 *      real trap text.
 *
 * This file deliberately does NOT assert either changed behavior. It protects
 * the behavior ADJACENT to the change that must survive it:
 *
 *   A. The sibling `#Err` arm of the `MintReceipt` switch already surfaces the
 *      REAL collection-canister error text: `#GenericError(e)` reports
 *      `e.message`, and each other variant reports its own distinct literal.
 *      The catch-arm change must not collapse this arm into a generic message,
 *      and must not reorder the variants.
 *
 *   B. The frontend consumer seam that renders the error box: an arbitrary
 *      backend failure reason (including a real trap string) is surfaced
 *      verbatim by `describeMintOutcome`, never replaced by a generic message.
 *      The acceptance criterion is that the error box shows the actual trap
 *      text; that depends on this pass-through, which the backend change must
 *      feed rather than bypass.
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

describe("backend mint path — the #Err arm surfaces the real collection error", () => {
  const body = functionBody("mintForPlayer");

  it("reports the #GenericError message text rather than a generic literal", () => {
    // The collection canister's #GenericError carries a real message; the
    // #Err arm must keep surfacing it. The catch-arm change must not replace
    // this with a fixed string.
    expect(body).toContain("case (#GenericError(e)) e.message");
  });

  it("keeps a distinct literal for every other MintError variant", () => {
    // Each variant maps to its own reason; collapsing them would lose the
    // distinction the modal renders.
    expect(body).toContain('case (#Unauthorized) "unauthorized"');
    expect(body).toContain('case (#InvalidRecipient) "invalid recipient"');
    expect(body).toContain('case (#SupplyCapOverflow) "supply cap overflow"');
    expect(body).toContain(
      'case (#AlreadyExistTokenId) "token id already exists"',
    );
  });

  it("records the #Err reason as a #failed MintAttempt", () => {
    // The real error text is recorded on the attempt the modal reads, not
    // only logged.
    expect(body).toContain("let failOutcome : MintOutcome = #failed(message)");
    expect(body).toContain("appendMintAttempt(store, failAttempt)");
  });
});

describe("frontend error box — real failure text is surfaced verbatim", () => {
  function failed(reason: string): MintOutcome {
    return { __kind__: "failed", failed: reason };
  }

  it("surfaces an arbitrary trap string instead of a generic message", () => {
    // A real inter-canister trap (e.g. IC0503) is not one of the known
    // substrings, so the helper must pass it through verbatim. This is the
    // consumer contract behind the acceptance criterion "the error box shows
    // the actual trap text rather than a generic message".
    const trap =
      "IC0503: Canister 23quc-cyaaa-aaaac-bfvia-cai trapped explicitly: no such method";
    const { reason, tone } = describeMintOutcome(failed(trap));
    expect(reason).toBe(`Failed — ${trap}`);
    expect(tone).toBe("failure");
  });

  it("still maps the known mint-call failure to its plain-language text", () => {
    // The known generic reason keeps its friendly mapping; the change adds
    // real text for the unknown case without disturbing this one.
    const { reason, tone } = describeMintOutcome(
      failed("mint canister call trapped"),
    );
    expect(reason).toBe("Failed — the mint call errored");
    expect(tone).toBe("failure");
  });

  it("surfaces a real #GenericError message verbatim", () => {
    // The #Err arm's real message text flows through the same helper and must
    // not be swallowed.
    const { reason } = describeMintOutcome(
      failed("collection rejected mint: supply cap reached"),
    );
    expect(reason).toBe(
      "Failed — collection rejected mint: supply cap reached",
    );
  });
});
