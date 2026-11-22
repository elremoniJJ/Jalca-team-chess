import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cover for the accepted guaranteed-tier wiring that the PocketIC lane cannot
 * reach.
 *
 * The request adds a persistent guaranteed set keyed on the post-'_copy' roster
 * username, holding each entry's own NFT wallet address and a verified-bet
 * flag. The observable writes, the per-game clearing, and the migration are
 * covered by the PocketIC lane (`test/pocketic/guaranteed-tier-cover.test.ts`
 * and `guaranteed-tier-migration.upgrade.test.ts`), which installs the real
 * wasm and reads the real `guaranteedEntry` OQL entity.
 *
 * What the replica CANNOT reach is the game-end mint wiring:
 *   - An entry only becomes eligible when a prediction bet is successfully
 *     placed, and `placeBet` relays to the external escrow canister
 *     (oqybv-uyaaa-aaaac-bf5oq-cai), absent from the replica, so the relay
 *     always returns `#err` and no entry can become bet-verified there.
 *   - The game-end mint calls the external ICRC-7 collection canister
 *     (23quc-cyaaa-aaaac-bfvia-cai), likewise absent.
 *   - There is no public method to conclude a game, and a timeout conclusion
 *     cannot be driven without time control (the stale-heartbeat cleanup would
 *     remove the players first).
 *
 * This file therefore pins the accepted wiring as a source contract. It reads
 * the backend source text only; it makes no network call and executes no
 * backend code. It deliberately does NOT assert the old behavior the request
 * intentionally changes (guaranteed players were not excluded from the capped
 * pool, and there was no guaranteed mint).
 */

const GUARANTEED_PATH = resolve(process.cwd(), "../backend/lib/guaranteed.mo");
const NFT_PATH = resolve(process.cwd(), "../backend/lib/nft.mo");
const CHESS_API_PATH = resolve(
  process.cwd(),
  "../backend/mixins/chess-game-api.mo",
);
const REAL_BET_API_PATH = resolve(
  process.cwd(),
  "../backend/mixins/real-bet-api.mo",
);
const NFT_API_PATH = resolve(process.cwd(), "../backend/mixins/nft-api.mo");
const MAIN_PATH = resolve(process.cwd(), "../backend/main.mo");
const MIGRATION_PATH = resolve(
  process.cwd(),
  "../backend/migrations/20261004_000000.mo",
);

const guaranteedSource = readFileSync(GUARANTEED_PATH, "utf8");
const nftSource = readFileSync(NFT_PATH, "utf8");
const chessApiSource = readFileSync(CHESS_API_PATH, "utf8");
const realBetApiSource = readFileSync(REAL_BET_API_PATH, "utf8");
const nftApiSource = readFileSync(NFT_API_PATH, "utf8");
const mainSource = readFileSync(MAIN_PATH, "utf8");
const migrationSource = readFileSync(MIGRATION_PATH, "utf8");

/**
 * Extract the body of a `func <name>(...) : ... { ... };` declaration by brace
 * matching, so assertions do not depend on surrounding comments or whitespace.
 * Matches both `func` and `public func` declarations.
 */
function functionBody(source: string, name: string): string {
  const header = new RegExp(`(?:public\\s+)?func\\s+${name}\\s*\\(`, "u");
  const match = header.exec(source);
  if (match === null) {
    throw new Error(`func ${name} not found`);
  }
  const open = source.indexOf("{", match.index + match[0].length);
  if (open === -1) {
    throw new Error(`no body brace for func ${name}`);
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
  throw new Error(`unterminated body for func ${name}`);
}

describe("guaranteed store — self-contained entries", () => {
  it("keys the store on the username and carries the entry's own wallet + flag", () => {
    // The entry is self-contained: it holds its own wallet address and
    // verified-bet flag, so heartbeat cleanup of the player row cannot strip
    // the wallet address. The store is a Map keyed on the username Text.
    expect(guaranteedSource).toContain(
      "public type GuaranteedStore = Types.GuaranteedStore",
    );
    expect(guaranteedSource).toContain("{ var items = Map.empty() }");
    expect(guaranteedSource).toContain("walletAddress = null");
    expect(guaranteedSource).toContain("betVerified = true");
  });

  it("marks an entry bet-verified, creating it when absent", () => {
    const body = functionBody(guaranteedSource, "markBetVerified");
    expect(body).toContain("store.items.get(username)");
    expect(body).toContain("betVerified = true");
    // The create branch initializes a fresh entry with no wallet yet.
    expect(body).toContain("walletAddress = null");
  });

  it("records the wallet address, preserving the bet-verified flag", () => {
    const body = functionBody(guaranteedSource, "recordWallet");
    // An existing entry is updated with the new address and its flag preserved.
    expect(body).toContain("{ entry with walletAddress }");
    // A null update with no prior entry writes nothing.
    expect(body).toContain("case null {}");
  });

  it("clears the whole set", () => {
    const body = functionBody(guaranteedSource, "clearAll");
    expect(body).toContain("store.items.clear()");
  });

  it("selects only entries with a verified bet and a non-empty wallet", () => {
    const body = functionBody(guaranteedSource, "eligibleEntries");
    expect(body).toContain("if (entry.betVerified)");
    expect(body).toContain("if (not address.isEmpty())");
    // The wallet is read from the entry itself, never the player row.
    expect(body).toContain("entry.walletAddress");
  });

  it("derives the eligible usernames from the eligible entries", () => {
    const body = functionBody(guaranteedSource, "eligibleUsernames");
    expect(body).toContain("eligibleEntries(store)");
    expect(body).toContain("entry.username");
  });
});

describe("bet placement marks the guaranteed entry only on success", () => {
  const body = functionBody(realBetApiSource, "placeBet");

  it("marks the username bet-verified on the #ok arm", () => {
    expect(body).toContain(
      "Guaranteed.markBetVerified(guaranteedStore, args.username)",
    );
    // The mark is inside the #ok arm, after the local record.
    const okIndex = body.indexOf("case (#ok(blockIndex))");
    const markIndex = body.indexOf("Guaranteed.markBetVerified");
    const errIndex = body.indexOf("case (#err(_)) {}");
    expect(okIndex).toBeGreaterThanOrEqual(0);
    expect(markIndex).toBeGreaterThan(okIndex);
    expect(errIndex).toBeGreaterThan(markIndex);
  });

  it("writes nothing to the guaranteed set on the #err arm", () => {
    // The #err arm is empty: a rejected/cancelled/failed bet writes nothing.
    expect(body).toContain("case (#err(_)) {}");
  });
});

describe("wallet connect/update records the guaranteed entry", () => {
  const body = functionBody(chessApiSource, "updateWalletAddress");

  it("records the wallet on the guaranteed entry from the same player row", () => {
    // The username is the post-'_copy' roster username on the found player row.
    expect(body).toContain(
      "Guaranteed.recordWallet(guaranteedStore, existing.username, walletAddress)",
    );
  });
});

describe("new game clears the guaranteed set alongside the votes", () => {
  const body = functionBody(chessApiSource, "startNewGame");

  it("clears the guaranteed set", () => {
    expect(body).toContain("Guaranteed.clearAll(guaranteedStore)");
  });

  it("clears it alongside the vote clearing", () => {
    const voteClear = body.indexOf("ChessGame.clearVotes(voteStore)");
    const guaranteedClear = body.indexOf(
      "Guaranteed.clearAll(guaranteedStore)",
    );
    expect(voteClear).toBeGreaterThanOrEqual(0);
    expect(guaranteedClear).toBeGreaterThan(voteClear);
  });
});

describe("game-end mint — guaranteed tier is additive and excluded from the cap", () => {
  it("mints the guaranteed entries before the capped pool", () => {
    const body = functionBody(nftApiSource, "mintGameNfts");
    const guaranteedMint = body.indexOf("Nft.mintGuaranteedEntries(");
    const cappedMint = body.indexOf("Nft.mintForEligiblePlayers(");
    expect(guaranteedMint).toBeGreaterThanOrEqual(0);
    expect(cappedMint).toBeGreaterThan(guaranteedMint);
  });

  it("passes the eligible guaranteed usernames to the capped pool", () => {
    const body = functionBody(nftApiSource, "mintGameNfts");
    expect(body).toContain("Guaranteed.eligibleEntries(guaranteedStore)");
    expect(body).toContain("Guaranteed.eligibleUsernames(guaranteedStore)");
    expect(body).toContain("guaranteedUsernames");
  });

  it("excludes guaranteed usernames from the capped pool", () => {
    const body = functionBody(nftSource, "mintForEligiblePlayers");
    expect(body).toContain("guaranteedUsernames.contains(entry.username)");
    // The exclusion happens before the wallet eligibility test, so a guaranteed
    // player is never added to the capped eligible list.
    const excludeIndex = body.indexOf(
      "guaranteedUsernames.contains(entry.username)",
    );
    const eligibleIndex = body.indexOf("eligibleIndices.add(i)");
    expect(excludeIndex).toBeGreaterThanOrEqual(0);
    expect(eligibleIndex).toBeGreaterThan(excludeIndex);
  });

  it("mints each guaranteed entry through the shared mintForPlayer flow", () => {
    const body = functionBody(nftSource, "mintGuaranteedEntries");
    // The recipient address is read from the guaranteed entry itself.
    expect(body).toContain("entry.walletAddress");
    expect(body).toContain("await mintForPlayer(");
    // The guaranteed mint does not consult the cap or the selection walk.
    expect(body).not.toContain("maxMintsPerGame");
    expect(body).not.toContain("selectMintRecipientIndices");
  });
});

describe("persistent actor field and migration", () => {
  it("declares the guaranteed store as a persistent actor field", () => {
    expect(mainSource).toContain("guaranteedStore : Types.GuaranteedStore");
  });

  it("adds the guaranteed store to the migration's NewActor and initializes it empty", () => {
    expect(migrationSource).toContain("guaranteedStore : GuaranteedStore");
    expect(migrationSource).toContain(
      "guaranteedStore = { var items = Map.empty() }",
    );
  });
});
