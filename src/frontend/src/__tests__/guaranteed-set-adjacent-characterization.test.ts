import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Characterization taken BEFORE the backend gains the persistent guaranteed
 * NFT set keyed on the post-'_copy' roster username.
 *
 * The request adds a new persistent set that holds, per guaranteed username,
 * that entry's own NFT wallet address and a verified-bet flag. A successfully
 * placed prediction bet marks the username's guaranteed entry bet-verified; a
 * wallet connect/update records the wallet address on the guaranteed entry;
 * and at game end every guaranteed entry with a verified bet and a recorded
 * wallet receives an NFT read from the guaranteed entry rather than the player
 * row. The existing 10-NFT cap and deterministic selection then apply only to
 * wallet-holding players NOT in the guaranteed set.
 *
 * This file deliberately does NOT assert the new guaranteed-set behavior (it
 * does not exist yet) and does NOT assert the bug/behavior the request
 * intentionally changes. What it protects is the behavior ADJACENT to the
 * change that must survive it, because the new set is keyed on the same
 * username and wallet values the existing paths produce:
 *
 *   1. `uniqueUsername` appends "_copy" repeatedly until the name is unique
 *      among logged-in players. The guaranteed set is keyed on the POST-'_copy'
 *      roster username, so this dedup behavior is load-bearing: if it changed,
 *      the key the guaranteed set is written under would no longer match the
 *      key the mint path reads.
 *   2. `updateWalletAddress` still writes the wallet address and source onto
 *      the player row. The request adds a guaranteed-entry write alongside it;
 *      the existing player-row write must remain (the capped tier and the
 *      kick/roster reads still consume it).
 *   3. `login`'s re-login branch still updates the player row's wallet address
 *      and source, so a player who logs back in with a different wallet is
 *      reflected on the row.
 *   4. `placeBet` still relays to `RealBet.placeBet` and records the local
 *      RealBet only on the `#ok` arm. The request adds a bet-verified mark on
 *      success; the existing relay-and-record-on-ok behavior must remain.
 *   5. The existing 10-per-game cap and deterministic selection remain defined
 *      for the non-guaranteed tier (the request narrows their scope, it does
 *      not remove them).
 *   6. The `mint_auto` call shape and types are unchanged: `MintAutoArgs`
 *      carries only `to` and `metadata`, and `mintForPlayer` calls
 *      `icrc7Collection.mint_auto(mintArgs)`.
 *
 * Why this is a source contract and not a runtime assertion:
 *   - The frontend suite mocks the backend actor, so it never executes the
 *     backend paths.
 *   - The PocketIC lane installs the real wasm, but it skips entirely when
 *     `src/backend/dist/backend.wasm` is absent (it is absent in this dispatch
 *     — see episode.coverageLimits), and the external collection canister does
 *     not exist in the replica.
 *   - `uniqueUsername` is a private helper inside the ChessGameApi mixin; the
 *     generated declarations expose only the composed actor surface.
 *
 * This file reads the backend source text only. It makes no network call and
 * executes no backend code.
 */

/**
 * Absolute paths to the backend sources under test. The frontend `test` script
 * runs Vitest with the frontend package as its working directory, so the
 * backend sources sit under `../backend/` from there.
 */
const CHESS_API_PATH = resolve(
  process.cwd(),
  "../backend/mixins/chess-game-api.mo",
);
const REAL_BET_API_PATH = resolve(
  process.cwd(),
  "../backend/mixins/real-bet-api.mo",
);
const NFT_MODULE_PATH = resolve(process.cwd(), "../backend/lib/nft.mo");

const chessApiSource = readFileSync(CHESS_API_PATH, "utf8");
const realBetApiSource = readFileSync(REAL_BET_API_PATH, "utf8");
const nftSource = readFileSync(NFT_MODULE_PATH, "utf8");

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

describe("uniqueUsername — the post-'_copy' key the guaranteed set is keyed on", () => {
  const body = functionBody(chessApiSource, "uniqueUsername");

  it("appends '_copy' repeatedly until the name is unique", () => {
    // The guaranteed set is keyed on the post-'_copy' roster username. The
    // dedup suffix literal and the collision loop are the behavior that
    // produces that key; a reworded suffix would silently desynchronize the
    // guaranteed-set key from the roster username.
    expect(body).toContain('name := name # "_copy"');
  });

  it("checks for a collision against every logged-in player's username", () => {
    // The uniqueness test scans the players array by username, so the key is
    // unique across the whole roster (not just one team).
    expect(body).toContain("for (p in players.items.vals())");
    expect(body).toContain("if (p.username == name) collision := true");
  });

  it("returns the first non-colliding name", () => {
    expect(body).toContain("if (not collision) return name");
  });
});

describe("updateWalletAddress — the player-row wallet write must remain", () => {
  const body = functionBody(chessApiSource, "updateWalletAddress");

  it("writes the wallet address and source onto the found player row", () => {
    // The request adds a guaranteed-entry write alongside this; the existing
    // player-row write is still consumed by the capped tier and the roster.
    expect(body).toContain("existing.walletAddress := walletAddress");
    expect(body).toContain("existing.walletSource := walletSource");
  });

  it("looks the player up by principal and is a no-op for an unknown player", () => {
    expect(body).toContain("findPlayer(principal)");
    expect(body).toContain("case null {}");
  });
});

describe("login — the re-login branch still updates the player-row wallet", () => {
  // The accepted request extracts the shared login body into loginInternal and
  // makes login a thin wrapper (trap guard + await loginInternal). The re-login
  // wallet/username writes now live in loginInternal, which both login (guest)
  // and loginRanked run, so the behavior is asserted there.
  const body = functionBody(chessApiSource, "loginInternal");

  it("updates the existing player's wallet address and source on re-login", () => {
    // A player who logs out and back in with a different address must still
    // get the new one on the player row.
    expect(body).toContain("existing.walletAddress := walletAddress");
    expect(body).toContain("existing.walletSource := walletSource");
  });

  it("re-unique-ifies the username on re-login", () => {
    // The re-login path also runs the username through uniqueUsername, so the
    // post-'_copy' key stays consistent across re-logins.
    expect(body).toContain("existing.username := uniqueUsername(username)");
  });
});

describe("placeBet — relay and record-on-ok must remain", () => {
  const body = functionBody(realBetApiSource, "placeBet");

  it("relays the bet to RealBet.placeBet", () => {
    expect(body).toContain("await RealBet.placeBet(args)");
  });

  it("records the local RealBet only on the #ok arm", () => {
    // The request adds a bet-verified mark on success; the existing local
    // record-on-ok behavior must remain, and the #err arm must not record.
    expect(body).toContain("case (#ok(blockIndex))");
    expect(body).toContain("RealBet.recordBet(realBetStore, bet,");
    expect(body).toContain("case (#err(_)) {}");
  });

  it("returns the escrow result unchanged", () => {
    // The relay result is surfaced verbatim so the frontend can read the
    // block index / error.
    expect(body).toContain("result;");
  });
});

describe("existing cap and deterministic selection remain defined", () => {
  it("keeps the 10-per-game cap constant", () => {
    // The request narrows the cap's scope to non-guaranteed wallet-holding
    // players; it does not remove the cap.
    expect(nftSource).toContain("let maxMintsPerGame : Nat = 10");
  });

  it("keeps the deterministic selection function", () => {
    expect(nftSource).toContain("public func selectMintRecipientIndices(");
    const body = functionBody(nftSource, "selectMintRecipientIndices");
    expect(body).toContain("if (n <= maxMintsPerGame)");
    expect(body).toContain("while (chosen.size() < maxMintsPerGame)");
  });
});

describe("mint_auto call shape and types", () => {
  it("keeps the mint_auto call two-argument and token-id-free", () => {
    // The accepted Candid shape is two separate arguments — the recipient
    // account and the metadata vec — with no token id supplied. The
    // single-record MintAutoArgs shape was removed by the accepted request.
    const body = functionBody(nftSource, "mintForPlayer");
    expect(body).toContain(
      "await icrc7Collection.mint_auto(recipient, metadataVec)",
    );
    expect(body).toContain(
      "let recipient : Account = { owner; subaccount = null }",
    );
    expect(body).toContain(
      "let metadataVec : [(Text, Metadata)] = metadataToVec(request.metadata)",
    );
    // No token id is supplied on the mint path.
    expect(body).not.toContain("token_id");
  });

  it("declares the mint_auto actor method with two separate arguments", () => {
    // The actor interface must declare the two-argument Candid shape, not a
    // single MintAutoArgs record.
    expect(nftSource).toContain(
      "mint_auto : (Account, [(Text, Metadata)]) -> async MintReceipt",
    );
    expect(nftSource).not.toContain("type MintAutoArgs");
  });
});
