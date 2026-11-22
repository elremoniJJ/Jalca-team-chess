import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Characterization taken BEFORE the game-end mint cap / deterministic-walk
 * change.
 *
 * The request intentionally changes `Nft.mintForEligiblePlayers`
 * (src/backend/lib/nft.mo): the number of recipients per game becomes capped
 * at 10, and when more than 10 players are eligible the recipients are chosen
 * by a deterministic walk driven by the last digit of the game number instead
 * of minting to every eligible player.
 *
 * This file deliberately does NOT freeze the behavior the request changes:
 *   - it does NOT assert that every eligible player is minted to;
 *   - it does NOT assert the absence of a cap;
 *   - it does NOT assert the iteration order or the selection rule.
 *
 * What it protects is the behavior ADJACENT to the change that must survive
 * it, because the game conclusion modal and the acceptance criteria depend on
 * it:
 *
 *   1. A player with a null wallet address is recorded as an explicit
 *      `#skipped("no wallet address supplied")` MintAttempt and is NEVER
 *      minted to. The acceptance criteria require walletless players to be
 *      skipped and never receive an NFT; the modal renders this skip reason.
 *   2. A player with a wallet address is minted through the shared
 *      `mintForPlayer` flow (the single mint path that records the
 *      canister-returned token id).
 *   3. Every player in the snapshot gets a MintAttempt recorded (no silent
 *      skips), so the modal can render per-player status.
 *   4. The recipient role is derived from the game result and the player's
 *      team via `recipientRole`, and the spell reward is rolled and threaded
 *      into the metadata for recipients.
 *
 * Why this is a source contract and not a runtime assertion:
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

describe("mintForEligiblePlayers — walletless players are skipped, never minted", () => {
  const body = functionBody("mintForEligiblePlayers");

  it("records the no-wallet skip reason the modal renders", () => {
    // The exact literal the frontend's mint-status-helpers maps to
    // "Skipped — no wallet address". A reworded reason silently degrades the
    // modal's plain-language status.
    expect(body).toContain('#skipped("no wallet address supplied")');
  });

  it("records the skip as a MintAttempt rather than skipping silently", () => {
    // The walletless player's username/team/role are captured so the modal
    // can render why that player got no NFT.
    expect(body).toContain("appendMintAttempt(store, skipAttempt)");
  });

  it("does not mint to a walletless player", () => {
    // The only mint call in the function is the batched mint_auto_batch call,
    // which is reached from the precomputed batch built from the eligible
    // (non-empty wallet) list. The walletless branch records a skip and never
    // enters the batch. Assert the skip is recorded before the mint call so a
    // rewrite cannot route a walletless player into the mint path.
    const skipIndex = body.indexOf('#skipped("no wallet address supplied")');
    const mintIndex = body.indexOf("await icrc7Collection.mint_auto_batch(");
    expect(skipIndex).toBeGreaterThanOrEqual(0);
    expect(mintIndex).toBeGreaterThan(skipIndex);
  });
});

describe("mintForEligiblePlayers — wallet-bearing players use the shared mint path", () => {
  const body = functionBody("mintForEligiblePlayers");

  it("mints selected recipients through the batched mint_auto_batch call", () => {
    // The capped tier mints its precomputed recipients through the collection
    // canister's batched mint_auto_batch entrypoint, which returns one receipt
    // per input. The cap/walk change must keep routing selected recipients
    // through it.
    expect(body).toContain("await icrc7Collection.mint_auto_batch(");
  });

  it("captures an unexpected mint trap as a recorded failure attempt", () => {
    // A trap in the batch call must not block other recipients or the game
    // conclusion; every recipient in the trapped chunk is recorded as a
    // #failed attempt the modal can show.
    expect(body).toContain('"mint canister call trapped: "');
    expect(body).toContain("#failed(reason)");
    expect(body).toContain("recordAttempt(");
  });

  it("derives the recipient role from the result and the player's team", () => {
    // Winners get #Winner, everyone else #Drawer; the recipientTeam field
    // still records the actual team. This mapping is independent of the
    // recipient cap and must survive it.
    expect(body).toContain("recipientRole(result, entry.team)");
  });

  it("rolls the spell reward and threads it into the mint metadata", () => {
    // The game-end spell reward is a verifiable part of the minted artifact;
    // the cap/walk change must not drop it for selected recipients.
    expect(body).toContain("await rollSpellId()");
    expect(body).toContain("buildMintMetadata(");
  });
});

describe("mintForEligiblePlayers — every player gets an attempt recorded", () => {
  const body = functionBody("mintForEligiblePlayers");

  it("records attempts through appendMintAttempt on both branches", () => {
    // Both the walletless skip and the wallet-bearing failure path record an
    // attempt. The success path records through mintForPlayer. No player in
    // the snapshot is silently dropped.
    const appendCount = body.split("appendMintAttempt(store,").length - 1;
    expect(appendCount).toBeGreaterThanOrEqual(2);
  });

  it("iterates the recorder's player-list snapshot", () => {
    // The function consumes the snapshot passed by the caller; the cap/walk
    // change selects from this same list. The accepted implementation walks
    // the snapshot by index in the eligibility pass (`playerList.size()` /
    // `playerList[i]`) and indexes it again for each selected recipient
    // (`playerList[eligible[position]]`), rather than iterating
    // `playerList.vals()` directly. Assert the snapshot is consumed by index
    // so the invariant survives the restructure without freezing the old
    // iteration style.
    expect(body).toContain("playerList.size()");
    expect(body).toContain("playerList[i]");
    expect(body).toContain("playerList[eligible[position]]");
  });
});
