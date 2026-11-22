import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cover for the accepted batched capped-tier game-end mint.
 *
 * The request repoints the capped per-player tier (`mintForEligiblePlayers` in
 * src/backend/lib/nft.mo) from a sequential per-player `mint_auto` loop to the
 * collection canister's batched `mint_auto_batch` entrypoint:
 *
 *   1. The in-tree ICRC-7 collection actor declares `mint_auto_batch` with the
 *      signature `([Account], [[(Text, Metadata)]]) -> async [MintReceipt]`.
 *   2. The capped tier chunks its precomputed recipients at `mintBatchSize`
 *      (50) per call, so a large lobby is minted in bounded batches.
 *   3. Recipients and spell rolls are precomputed BEFORE any batch call: the
 *      owner principal is parsed, the spell reward is rolled, and the metadata
 *      is built up front.
 *   4. Each returned receipt is mapped back to its player by index; a
 *      per-receipt `#Err` is recorded for that player only, with no whole-batch
 *      rollback. A missing receipt is that player's own failure.
 *   5. A trapped chunk call fails every recipient in that chunk individually
 *      and leaves other chunks unaffected.
 *   6. The guaranteed tier remains additive and outside the 10-NFT cap; the
 *      capped tier stays bounded by `maxMintsPerGame = 10`.
 *
 * The unconditional fixed-recipient mint (`mintToFixedRecipient`) was removed
 * by the accepted request, so this file no longer asserts it.
 *
 * Why this is a source contract and not a runtime assertion:
 *   - The frontend suite mocks the backend actor, so it never executes the
 *     mint path.
 *   - The PocketIC lane installs the real wasm, but the external collection
 *     canister (23quc-cyaaa-aaaac-bfvia-cai) does not exist in the replica, so
 *     the inter-canister batch call rejects before any receipt is returned.
 *   - The mint path is internal to `lib/nft.mo`; the generated declarations
 *     expose only the composed actor surface, so there is no public Candid
 *     method to call `mint_auto_batch` through.
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

describe("in-tree ICRC-7 collection actor — mint_auto_batch signature", () => {
  it("declares mint_auto_batch as two index-aligned vec arguments returning receipts", () => {
    // The accepted Candid shape: a vec of recipient accounts and a vec of
    // per-recipient metadata vecs, returning one MintReceipt per input.
    expect(source).toContain(
      "mint_auto_batch : ([Account], [[(Text, Metadata)]]) -> async [MintReceipt]",
    );
  });

  it("keeps the single mint_auto entrypoint for the additive guaranteed tier", () => {
    // The guaranteed tier still uses mint_auto.
    expect(source).toContain(
      "mint_auto : (Account, [(Text, Metadata)]) -> async MintReceipt",
    );
  });
});

describe("capped tier — chunking at mintBatchSize", () => {
  it("defines the batch size as 50", () => {
    expect(source).toContain("let mintBatchSize : Nat = 50");
  });

  it("walks the recipients in chunks of at most mintBatchSize", () => {
    const body = functionBody("mintForEligiblePlayers");
    // The chunk loop advances an offset and clamps the chunk size to the
    // remaining recipients, so no call exceeds mintBatchSize.
    expect(body).toContain("while (offset < recipients.size())");
    expect(body).toContain("let remaining = recipients.size() - offset");
    expect(body).toContain(
      "let chunkSize = if (remaining < mintBatchSize) remaining else mintBatchSize",
    );
    expect(body).toContain("offset += chunkSize");
  });

  it("calls mint_auto_batch once per chunk with the chunk-sized vecs", () => {
    const body = functionBody("mintForEligiblePlayers");
    expect(body).toContain(
      "await icrc7Collection.mint_auto_batch(accounts, metadataVecs)",
    );
    // The two vecs are built with Array.tabulate over chunkSize, so they are
    // index-aligned and bounded by the chunk.
    expect(body).toContain("let accounts : [Account] = Array.tabulate(");
    expect(body).toContain(
      "let metadataVecs : [[(Text, Metadata)]] = Array.tabulate(",
    );
  });
});

describe("capped tier — recipients and spell rolls are precomputed before the call", () => {
  const body = functionBody("mintForEligiblePlayers");

  it("rolls the spell reward and builds metadata before the batch call", () => {
    // The spell roll and metadata construction happen in the precompute loop,
    // which precedes the chunked batch call.
    const rollIndex = body.indexOf("await rollSpellId()");
    const metadataIndex = body.indexOf("buildMintMetadata(");
    const batchIndex = body.indexOf("await icrc7Collection.mint_auto_batch(");
    expect(rollIndex).toBeGreaterThanOrEqual(0);
    expect(metadataIndex).toBeGreaterThan(rollIndex);
    expect(batchIndex).toBeGreaterThan(metadataIndex);
  });

  it("parses the owner principal before the batch call", () => {
    const parseIndex = body.indexOf("Principal.fromText(address)");
    const batchIndex = body.indexOf("await icrc7Collection.mint_auto_batch(");
    expect(parseIndex).toBeGreaterThanOrEqual(0);
    expect(batchIndex).toBeGreaterThan(parseIndex);
  });

  it("records a parse failure as that player's own attempt, not a batch failure", () => {
    // A bad address is excluded from the batch and recorded individually, so
    // one bad address cannot trap a whole chunk.
    expect(body).toContain('#failed("wallet address parse failed")');
    expect(body).toContain("recordAttempt(");
  });
});

describe("capped tier — per-receipt handling with no whole-batch rollback", () => {
  const body = functionBody("mintForEligiblePlayers");

  it("maps each receipt back to its player by index", () => {
    // The receipt loop indexes the recipients array with the same index as the
    // receipt, so receipt j belongs to recipients[offset + j].
    expect(body).toContain("let r = recipients[offset + j]");
    expect(body).toContain("receipts[j]");
  });

  it("treats a missing receipt as that player's own failure", () => {
    // The canister returning fewer receipts than requested must not be a
    // whole-batch failure; the missing index gets its own #Err.
    expect(body).toContain("if (j < receipts.size())");
    expect(body).toContain(
      '"mint_auto_batch returned no receipt for this index"',
    );
  });

  it("records a per-receipt #Err for that player only", () => {
    // The #Err arm records a #failed attempt for the single recipient; it does
    // not abort the loop or roll back the other receipts.
    expect(body).toContain("case (#Err(err))");
    expect(body).toContain("#failed(message)");
    // The loop continues to the next index after recording the failure.
    expect(body).toContain("j += 1");
  });

  it("records a #succeeded attempt with the canister-returned token id", () => {
    expect(body).toContain("case (#Ok(tokenId))");
    expect(body).toContain("#succeeded({ tokenId })");
    expect(body).toContain("appendNft(store, record)");
  });

  it("fails every recipient in a trapped chunk individually, leaving other chunks alone", () => {
    // A trapped chunk call is caught, every recipient in that chunk gets its
    // own #failed attempt, and the outer chunk loop continues.
    expect(body).toContain("let maybeReceipts : ?[MintReceipt] = try {");
    expect(body).toContain('"mint canister call trapped: "');
    expect(body).toContain("while (k < chunkSize)");
    expect(body).toContain("#failed(reason)");
  });
});

describe("capped tier — cap and additive tiers are unchanged", () => {
  it("keeps the capped tier bounded by maxMintsPerGame = 10", () => {
    expect(source).toContain("let maxMintsPerGame : Nat = 10");
    const body = functionBody("mintForEligiblePlayers");
    expect(body).toContain("selectMintRecipientIndices(eligible, gameNumber)");
  });

  it("keeps the guaranteed tier additive and outside the batched path", () => {
    const body = functionBody("mintGuaranteedEntries");
    expect(body).not.toContain("mint_auto_batch");
    expect(body).not.toContain("maxMintsPerGame");
    expect(body).toContain("await mintForPlayer(");
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
