import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cover for the accepted BurnArg field rename in the backend's ICRC-7 burn
 * path: the record sent to the live collection canister's `icrc7_burn` must
 * carry the token-id vec under the field name `tokens`, not `token_ids`.
 *
 * Why this is a source contract and not a runtime assertion:
 *   - The frontend suite mocks the backend actor, so it never sees the
 *     inter-canister BurnArg at all.
 *   - The PocketIC lane installs the real wasm, but the external collection
 *     canister (23quc-cyaaa-aaaac-bfvia-cai) does not exist in the replica, so
 *     the `icrc7_burn` call rejects before the Candid field name can be
 *     observed. The lane's burn tests assert the per-token #failed mapping, not
 *     the wire field name.
 *   - `BurnArg` is internal to `lib/nft.mo` and is not part of the backend's
 *     own Candid service, so the generated declarations cannot expose it.
 *
 * The field name is therefore only observable in the backend source. This file
 * pins the two places the accepted requirement names — the `BurnArg` type
 * declaration and the call-site record construction — plus the preserved
 * single-implementation delegation (`burnNft` -> `burnNfts`). It reads the
 * source text only; it makes no network call and executes no backend code.
 */

/**
 * Absolute path to the backend NFT module under test. The frontend `test`
 * script runs Vitest with the frontend package as its working directory, so
 * the backend source sits at `../backend/lib/nft.mo` from there.
 */
const NFT_MODULE_PATH = resolve(process.cwd(), "../backend/lib/nft.mo");

const source = readFileSync(NFT_MODULE_PATH, "utf8");

/**
 * Extract the body of a `type <name> = { ... };` declaration by brace
 * matching, so the assertions do not depend on the surrounding comments or
 * whitespace.
 */
function typeBody(typeName: string): string {
  const header = new RegExp(`type\\s+${typeName}\\s*=\\s*\\{`, "u");
  const match = header.exec(source);
  if (match === null) {
    throw new Error(`type ${typeName} not found in ${NFT_MODULE_PATH}`);
  }
  let depth = 0;
  const start = match.index + match[0].length - 1;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, i);
    }
  }
  throw new Error(`unterminated type ${typeName} in ${NFT_MODULE_PATH}`);
}

describe("backend BurnArg field contract", () => {
  it("declares the token-id vec as `tokens`, not `token_ids`", () => {
    const body = typeBody("BurnArg");

    // The accepted field name is `tokens : [Nat]`.
    expect(body).toMatch(/tokens\s*:\s*\[Nat\]/u);
    // The old, mismatched field name must not survive anywhere in the record.
    expect(body).not.toMatch(/token_ids/u);
    // The optional memo is preserved alongside the token vec.
    expect(body).toMatch(/memo\s*:\s*\?Blob/u);
  });

  it("builds the icrc7_burn call-site record with the `tokens` field", () => {
    // The single BurnArg construction in the burn path. The call site is a
    // record *literal* (field assignments with `=`), distinct from the type
    // declaration (field annotations with `:`), so match the assignment form.
    const callSite = /:\s*BurnArg\s*=\s*\{[^}]*\}/u.exec(source);
    expect(callSite).not.toBeNull();
    const record = callSite?.[0] ?? "";

    expect(record).toMatch(/tokens\s*=\s*tokenIds/u);
    expect(record).not.toMatch(/token_ids/u);
    // The memo is explicitly None on the wire (encoded as null in Motoko).
    expect(record).toMatch(/memo\s*=\s*null/u);
  });

  it("keeps burnNft delegating to the single burnNfts implementation", () => {
    // The batch entrypoint is the one burn implementation; the single-token
    // entry point delegates to it rather than duplicating the burn call.
    const burnNftBody =
      /public\s+func\s+burnNft\s*\([^)]*\)\s*:\s*async\s+BurnOutcome\s*\{([\s\S]*?)\n\s*\};/u.exec(
        source,
      );
    expect(burnNftBody).not.toBeNull();
    expect(burnNftBody?.[1] ?? "").toMatch(/burnNfts\s*\(\s*\[tokenId\]\s*\)/u);
  });
});
