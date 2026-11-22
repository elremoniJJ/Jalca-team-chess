import Array "mo:core/Array";
import Debug "mo:core/Debug";
import Error "mo:core/Error";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Random "mo:core/Random";

import Types "../types/nft";
import ChessTypes "../types/chess-game";
import RecorderTypes "../types/game-recorder";
import Spells "../lib/spells";

// ---------- ICRC-7 collection canister (inter-canister actor reference) ----------
//
// The NFT domain mints through the external ICRC-7 collection canister at
// principal 23quc-cyaaa-aaaac-bfvia-cai on IC Mainnet (the project's target
// collection, per AGENTS.md). The canister allocates the token id on mint
// and is the source of truth for ownership; the local NftStore is kept
// only as a cache for getMintStatusForPlayer and as a fallback for
// getNftsForOwner when the canister query fails.
//
// Only the `mint` and `icrc7_tokens_of` methods are wired (the doNotBuild
// contract excludes transfer/approve flows). The actor type is defined
// in-tree (no external mops package) per the dispatch requirements.
//
// The ICRC-7 types, the actor reference, and the canister binding all live
// inside the module block below — they are internal to this file and not
// referenced via `Nft.<Name>` from any other module. `transient` is only
// valid inside an actor/mixin/module-with-state context, so the canister
// binding must be inside the module block, not at the file top level.

module {
  // ---------- ICRC-7 in-tree types (internal to this module) ----------

  type Account = {
    owner : Principal;
    subaccount : ?[Nat8];
  };

  type Metadata = {
    #Int : Int;
    #Nat : Nat;
    #Text : Text;
    #Blob : [Nat8];
  };

  type MintError = {
    #GenericError : { error_code : Nat; message : Text };
    #Unauthorized;
    #InvalidRecipient;
    #SupplyCapOverflow;
    #AlreadyExistTokenId;
  };

  type MintReceipt = {
    #Ok : Nat;
    #Err : MintError;
  };

  type CallError = {
    #GenericError;
    #Unauthorized;
    #InvalidRecipient;
    #SupplyCapOverflow;
    #InvalidTokenId;
    #AlreadyExistTokenId;
  };

  type TokensOfResult = {
    #Ok : [Nat];
    #Err : CallError;
  };

  type MintArgs = {
    to : Account;
    token_id : Nat;
    metadata : [(Text, Metadata)];
  };

  // ICRC-7 burn argument/result shapes, coded against the LIVE collection
  // canister signatures (not the stale local copy):
  //   - `icrc7_burn` takes a `BurnArg` record of an optional memo plus a vec
  //     of token ids, and returns a vec of `BurnResult`.
  //   - the `BurnResult` error arm is plain text.
  type BurnArg = {
    memo : ?Blob;
    tokens : [Nat];
  };

  type BurnResult = {
    #Ok : Nat;
    #Err : Text;
  };

  type Icrc7Collection = actor {
    mint : MintArgs -> async MintReceipt;
    // The collection canister's auto-id mint entrypoint takes two separate
    // Candid arguments: the recipient account and the metadata vec. No token
    // id is supplied — the canister assigns the next id internally from a
    // counter that only increases and is never affected by burns, so there is
    // no collision risk and no retry logic is needed. The returned
    // MintReceipt's #Ok(tokenId) is the assigned id.
    mint_auto : (Account, [(Text, Metadata)]) -> async MintReceipt;
    // Batched auto-id mint: two index-aligned Candid vec arguments — the
    // recipient accounts and the per-recipient metadata vecs. The canister
    // assigns each token id internally and returns one MintReceipt per input,
    // in the same order. There is no whole-call rollback on partial failure:
    // each receipt must be checked individually. Used by the capped per-player
    // tier (mintForEligiblePlayers) to replace the sequential per-player
    // mint_auto loop with chunked batch calls.
    mint_auto_batch : ([Account], [[(Text, Metadata)]]) -> async [MintReceipt];
    icrc7_tokens_of : Account -> async TokensOfResult;
    icrc7_total_supply : () -> async Nat;
    icrc7_burn : BurnArg -> async [BurnResult];
    icrc7_token_metadata : [Nat] -> async [?[(Text, Metadata)]];
  };

  // The target ICRC-7 collection canister on IC Mainnet. Hardcoded per the
  // dispatch requirement (no existing canister-id config surface for
  // external canisters; env.json only carries the backend canister id).
  // A `Principal.fromText(...)` call is non-static and the binding is
  // rebuilt on every (re)start — it carries no durable state. Note: the
  // `transient` keyword is not permitted at module scope (M0132), so the
  // binding is a plain module-scope `let`.
  let icrc7Collection : Icrc7Collection = actor "23quc-cyaaa-aaaac-bfvia-cai";

  public type MintRequest = Types.MintRequest;
  public type MintResult = Types.MintResult;
  public type MintMetadata = Types.MintMetadata;
  public type MintAttempt = Types.MintAttempt;
  public type MintOutcome = Types.MintOutcome;
  public type MintStatusEntry = Types.MintStatusEntry;
  public type MintAttemptGroup = Types.MintAttemptGroup;
  public type NftStore = Types.NftStore;
  public type NftRecord = Types.NftRecord;
  public type RecipientRole = Types.RecipientRole;
  public type FinalBoardState = Types.FinalBoardState;
  public type Team = Types.Team;
  public type GameResult = Types.GameResult;
  public type EndState = Types.EndState;
  public type Timestamp = Types.Timestamp;
  public type BurnOutcome = Types.BurnOutcome;
  public type LegacyReason = Types.LegacyReason;
  public type GuaranteedEntry = ChessTypes.GuaranteedEntry;

  // Construct a fresh, empty NFT-domain store cell. Used by the migration
  // to initialize the NFT domain's stable state. The NFT domain mints
  // through the external ICRC-7 canister (the canister allocates the
  // token id); the local nextTokenId counter is kept only for local
  // caching/ordering and is NOT the source of truth for tokenId.
  public func newNftStore() : NftStore {
    {
      var nextTokenId = 0;
      var nfts = [var];
      var nextMintAttemptId = 0;
      var mintAttempts = [var];
    };
  };

  // Derive the recipient's role from the game result and the recipient's
  // team. Winners (the team that won) get #Winner; drawers (a draw result)
  // get #Drawer. A player on the losing team is not eligible for a mint
  // (the caller filters them out before invoking mintForEligiblePlayers).
  public func recipientRole(
    result : GameResult,
    recipientTeam : Team,
  ) : ?RecipientRole {
    switch (result) {
      case (#WhiteWin) {
        if (recipientTeam == #White) ?#Winner else null;
      };
      case (#BlackWin) {
        if (recipientTeam == #Black) ?#Winner else null;
      };
      case (#Draw) ?#Drawer;
    };
  };

  // Encode a single board square (a chess piece with color) into a short
  // text token for the NFT metadata. White pieces use a "w" prefix, black
  // pieces use a "b" prefix, followed by the piece-type letter
  // (P/N/B/R/Q/K). Empty squares are null.
  public func encodeSquare(piece : ?ChessTypes.Piece) : ?Text {
    switch (piece) {
      case null null;
      case (?p) {
        let colorPrefix = switch (p.color) {
          case (#White) "w";
          case (#Black) "b";
        };
        let pieceLetter = switch (p.pieceType) {
          case (#Pawn) "P";
          case (#Knight) "N";
          case (#Bishop) "B";
          case (#Rook) "R";
          case (#Queen) "Q";
          case (#King) "K";
        };
        ?(colorPrefix # pieceLetter);
      };
    };
  };

  // Encode the full final board state (64 squares, a1=0..h8=63) into the
  // FinalBoardState form for the NFT metadata.
  public func encodeFinalBoardState(board : [?ChessTypes.Piece]) : FinalBoardState {
    Array.tabulate(
      board.size(),
      func(i) { encodeSquare(board[i]) },
    );
  };

  // Resolve the name of a spell from its id by looking it up in the full
  // spell table. Falls back to an empty string if the id is not found (e.g.
  // the roll fell back to 0 with no matching entry). The name is captured at
  // mint time and persisted in the durable NftRecord so the game conclusion
  // modal can read it directly.
  public func spellNameById(spellId : Nat) : Text {
    let all = Spells.allSpells();
    var i = 0;
    label find while (i < all.size()) {
      if (all[i].id == spellId) return all[i].name;
      i += 1;
    };
    "";
  };

  // Build a MintMetadata from the concluded game's recorder data, the
  // recipient's player-list entry, and the game number. The metadata
  // encodes the game result, final board state, and the recipient's role
  // (winner/drawer) so each NFT is a verifiable game artifact. The
  // `gameNumber` field carries the sequential game number the NFT was
  // minted for. The `spellId` field carries the id of the spell reward
  // rolled for this player at game end (the single uniform draw's outcome
  // bucket determines which spell the player receives). The `spellName`
  // field carries the name of
  // that spell, resolved from the spell table at mint time and persisted in
  // the durable NftRecord so the game conclusion modal can read it directly.
  // The full spell text is looked up from the spell table, never stored in
  // the NFT metadata.
  public func buildMintMetadata(
    result : GameResult,
    endState : EndState,
    finalBoardState : FinalBoardState,
    recipientEntry : RecorderTypes.PlayerListEntry,
    recipientRole : RecipientRole,
    moveCount : Nat,
    concludedAt : Timestamp,
    gameNumber : Nat,
    spellId : Nat,
    spellName : Text,
  ) : MintMetadata {
    {
      gameResult = result;
      endState;
      finalBoardState;
      recipientRole;
      recipientTeam = recipientEntry.team;
      recipientUsername = recipientEntry.username;
      recipientWalletAddress = switch (recipientEntry.walletAddress) {
        case null "";
        case (?a) a;
      };
      moveCount;
      concludedAt;
      gameNumber;
      spellId;
      spellName;
    };
  };

  // Build the ICRC-7 metadata vec (the Candid `vec record { text;
  // Metadata }` shape required by MintArgs) from a MintMetadata. Each
  // field is encoded as a (key, Metadata) pair. The `gameNumber` field
  // is encoded as #Nat.
  //
  // Two jalca:-prefixed custom keys are emitted alongside the existing
  // plain keys so new spell NFTs carry the spell name and game number
  // on-chain at mint time:
  //   - "jalca:spell_name" -> #Text(metadata.spellName)
  //   - "jalca:game_number" -> #Nat(metadata.gameNumber)
  // The plain "spellName" key is also emitted (it was previously omitted
  // entirely). Legacy NFTs are unaffected — there is no backfill.
  public func metadataToVec(metadata : MintMetadata) : [(Text, Metadata)] {
    let gameResultText = switch (metadata.gameResult) {
      case (#WhiteWin) "WhiteWin";
      case (#BlackWin) "BlackWin";
      case (#Draw) "Draw";
    };
    let endStateText = switch (metadata.endState) {
      case (#Checkmate) "Checkmate";
      case (#Stalemate) "Stalemate";
      case (#Draw) "Draw";
      case (#Timeout) "Timeout";
      case (#InsufficientMaterial) "InsufficientMaterial";
    };
    let recipientRoleText = switch (metadata.recipientRole) {
      case (#Winner) "Winner";
      case (#Drawer) "Drawer";
    };
    let recipientTeamText = switch (metadata.recipientTeam) {
      case (#White) "White";
      case (#Black) "Black";
    };
    let finalBoardText = metadata.finalBoardState.foldLeft(
      "",
      func(acc : Text, sq : ?Text) : Text {
        let token = switch (sq) {
          case null "-";
          case (?t) t;
        };
        if (acc.isEmpty()) token else acc # "," # token;
      },
    );
    [
      ("gameResult", #Text(gameResultText)),
      ("endState", #Text(endStateText)),
      ("finalBoardState", #Text(finalBoardText)),
      ("recipientRole", #Text(recipientRoleText)),
      ("recipientTeam", #Text(recipientTeamText)),
      ("recipientUsername", #Text(metadata.recipientUsername)),
      ("recipientWalletAddress", #Text(metadata.recipientWalletAddress)),
      ("moveCount", #Nat(metadata.moveCount)),
      ("concludedAt", #Int(metadata.concludedAt)),
      ("gameNumber", #Nat(metadata.gameNumber)),
      ("spellId", #Nat(metadata.spellId)),
      ("spellName", #Text(metadata.spellName)),
      ("jalca:spell_name", #Text(metadata.spellName)),
      ("jalca:game_number", #Nat(metadata.gameNumber)),
    ];
  };

  // ---------- Wallet address validation ----------
  //
  // The frontend's isValidOisyAddress accepts three input shapes: empty
  // (optional), principal textual form, and 64-char hex Account IDs. The
  // backend mirrors that acceptance set for input-shape validation, but
  // only principal textual form is actually mintable: a 64-char hex
  // Account ID is a hash of (principal, subaccount) and CANNOT be
  // reversed back to a principal, so the backend cannot construct an
  // ICRC-7 Account.owner from it. The split is:
  //
  //   - isValidWalletAddress(address): true for empty + principal textual
  //     form + 64-char hex. Mirrors the frontend's input-shape acceptance
  //     set so the backend's input validation matches what the frontend
  //     already permits.
  //   - isPrincipalText(address): true only for non-empty principal
  //     textual form. Used to distinguish the mintable shape.
  //   - isMintableAddress(address): true only for non-empty principal
  //     textual form. mintForPlayer uses this: empty → #skipped (silent
  //     skip, no canister call), 64-char hex → #failed with a clear reason
  //     (cannot construct an Account from a hex account id without the
  //     original principal), principal textual → proceed to mint.
  //
  // This closes the gap: the frontend accepts hex for input, but the
  // backend now gives a clear failure reason instead of silently failing
  // the Principal.fromText conversion.

  // Returns true if `address` is a non-empty 64-char hex string (an IC
  // account identifier). Pure shape check — does not validate the hex
  // content beyond length and charset.
  func isHexAccountId(address : Text) : Bool {
    if (address.size() != 64) return false;
    address.chars().all(
      func(c : Char) : Bool {
        (c >= '0' and c <= '9')
          or (c >= 'a' and c <= 'f')
          or (c >= 'A' and c <= 'F');
      },
    );
  };

  // Returns true if `address` parses as a Principal textual form. Async
  // because Principal.fromText traps on invalid input and the trap must
  // be caught here. Pure shape check — does not guarantee the principal is
  // a valid canister/account, only that the text is a principal textual
  // form.
  public func isPrincipalText(address : Text) : async Bool {
    if (address.isEmpty()) return false;
    try {
      ignore Principal.fromText(address);
      true;
    } catch _ {
      false;
    };
  };

  // Validate a wallet address text for input-shape acceptance. Returns
  // true for empty (optional), principal textual form, and 64-char hex
  // Account IDs — mirroring the frontend's isValidOisyAddress acceptance
  // set. Used for input-shape validation only; mintability is decided by
  // isMintableAddress.
  //
  // Async because Motoko only permits try/catch inside async contexts —
  // Principal.fromText traps on invalid input and the trap must be caught
  // here so the gate never propagates an error. The single caller
  // (mintForPlayer) is already async.
  public func isValidWalletAddress(address : Text) : async Bool {
    if (address.isEmpty()) return true;
    if (isHexAccountId(address)) return true;
    await isPrincipalText(address);
  };

  // Returns true only for non-empty principal textual form — the only
  // shape the backend can actually mint to (it needs an Account.owner
  // Principal). 64-char hex Account IDs are NOT mintable (cannot reverse
  // a hex account id back to a principal). Async for the same reason as
  // isPrincipalText.
  public func isMintableAddress(address : Text) : async Bool {
    if (address.isEmpty()) return false;
    if (isHexAccountId(address)) return false;
    await isPrincipalText(address);
  };

  // The maximum number of distinct game numbers whose mint attempts are
  // retained. Attempts belonging to older games are pruned automatically
  // after each append, so the log is bounded and deterministic.
  let maxRetainedGames : Nat = 10;

  // Append a MintAttempt record to the store's mintAttempts array (grows
  // by one) and then prune attempts belonging to games older than the 10
  // most recent distinct game numbers present in the log. Reassigns
  // `store.mintAttempts`. Parallel to the recorder's appendMove.
  //
  // Pruning is deterministic and bounded: the distinct game numbers present
  // are collected, sorted ascending, and every attempt whose gameNumber is
  // strictly below the 10th-most-recent distinct game number is dropped.
  // When 10 or fewer distinct games are present, nothing is pruned.
  public func appendMintAttempt(store : NftStore, attempt : MintAttempt) {
    let n = store.mintAttempts.size();
    let grown = Array.tabulate(
      n + 1,
      func(i) {
        if (i < n) store.mintAttempts[i] else attempt;
      },
    );
    store.mintAttempts := grown.toVarArray();
    pruneMintAttempts(store);
  };

  // Prune mint attempts whose gameNumber is older than the 10 most recent
  // distinct game numbers present in the log. Deterministic and bounded:
  // the distinct game numbers are collected, sorted ascending, and the
  // cutoff is the 10th-from-the-end distinct number. Every attempt with a
  // gameNumber below the cutoff is dropped. When 10 or fewer distinct games
  // are present, the log is left unchanged.
  func pruneMintAttempts(store : NftStore) {
    let count = store.mintAttempts.size();
    if (count == 0) return;
    // Collect the distinct game numbers present, in ascending order.
    let distinct = List.empty<Nat>();
    var i = 0;
    while (i < count) {
      let g = store.mintAttempts[i].gameNumber;
      if (not distinct.contains(g)) {
        distinct.add(g);
      };
      i += 1;
    };
    let sorted = distinct.toArray().sort();
    if (sorted.size() <= maxRetainedGames) return;
    // The cutoff is the oldest game number still retained: the 10th from
    // the end of the ascending distinct list.
    let cutoff = sorted[sorted.size() - maxRetainedGames];
    // Rebuild the array keeping only attempts at or above the cutoff.
    let kept = List.empty<MintAttempt>();
    var j = 0;
    while (j < count) {
      let a = store.mintAttempts[j];
      if (a.gameNumber >= cutoff) {
        kept.add(a);
      };
      j += 1;
    };
    store.mintAttempts := kept.toArray().toVarArray();
  };

  // Allocate the next monotonic mint-attempt id and advance the counter.
  public func nextMintAttemptId(store : NftStore) : Nat {
    let id = store.nextMintAttemptId;
    store.nextMintAttemptId := id + 1;
    id;
  };

  // Clear all mint-attempt records. Retained for the explicit
  // clearNftMintAttempts endpoint; the new-game start path no longer calls
  // this (attempts are retained across games, capped at the 10 most recent
  // distinct game numbers). Does NOT reset the nextTokenId counter or the
  // minted NFTs — minted NFTs are permanent and accumulate across games.
  public func clearMintAttempts(store : NftStore) {
    store.mintAttempts := [var];
  };

  // Append a minted NftRecord to the store's nfts array (grows by one) and
  // advance the nextTokenId counter. Reassigns `store.nfts`. The tokenId
  // is the canister-returned token id (the source of truth), NOT the local
  // nextTokenId counter — the counter is kept only for local
  // caching/ordering.
  public func appendNft(store : NftStore, record : NftRecord) {
    let n = store.nfts.size();
    let grown = Array.tabulate(
      n + 1,
      func(i) {
        if (i < n) store.nfts[i] else record;
      },
    );
    store.nfts := grown.toVarArray();
  };

  // Allocate the next monotonic token id and advance the counter. Kept for
  // local caching/ordering only — the collection canister is the source of
  // truth for tokenId on mint (mint_auto assigns it internally). This counter
  // is NEVER used as a requested token id.
  public func nextTokenId(store : NftStore) : Nat {
    let id = store.nextTokenId;
    store.nextTokenId := id + 1;
    id;
  };

  // Reconcile the local nextTokenId cache from the collection canister's
  // authoritative state. The counter is cache-only and is never used as the
  // requested token id, but it is kept in sync with the canister's actual
  // supply so local ordering/caching stays meaningful. Called on startup
  // (main.mo's post-upgrade hook) and from the migration. Best-effort: a
  // failed query leaves the counter unchanged.
  public func reconcileNextTokenId(store : NftStore) : async () {
    try {
      let supply = await icrc7Collection.icrc7_total_supply();
      if (supply > store.nextTokenId) {
        store.nextTokenId := supply;
      };
    } catch _ {
      // Leave the counter unchanged when the canister cannot be reached.
    };
  };

  // Mint a single NFT for one eligible player through the external ICRC-7
  // collection canister and record the outcome. This is the single-mint path
  // used by the additive tier (mintGuaranteedEntries); the capped per-player
  // tier (mintForEligiblePlayers)
  // uses the batched mint_auto_batch path instead. The recipientWalletAddress
  // must be a principal textual form (the only mintable shape); the
  // canister allocates the token id and is the source of truth for
  // ownership. The local NftStore is updated only as a cache (for
  // getMintStatusForPlayer and as a fallback for getNftsForOwner).
  //
  // Silent-skip semantics: an empty wallet address returns #skipped
  // without trapping and WITHOUT calling the canister (preserves the
  // existing silent-skip semantics for players without a wallet). A 64-char
  // hex Account ID returns #failed with a clear reason (cannot construct
  // an Account from a hex account id without the original principal)
  // without calling the canister. The mint calls the collection canister's
  // mint_auto entrypoint, passing only the recipient account and metadata;
  // the canister assigns the token id internally from a counter that only
  // increases and is never affected by burns, so there is no token-id
  // computation, no supply query, and no collision retry loop. The returned
  // #Ok(tokenId) is the assigned id and is used to update the local
  // NftRecord. mint_auto guarantees collision-free ids internally, so there
  // is no per-mint safety gate. Any canister error is terminal and
  // returns #failed with a clear reason, without trapping, so a mint failure
  // for one player does not block the game conclusion or other players'
  // mints. The app canister bears the minting cost (cycles) — the backend
  // never sends cycles outward; the inter-canister mint call attaches no
  // cycles.
  // The optional `callingPrincipal` parameter, when present, is appended to
  // the #failed reason text for any canister-returned #Err so the caller
  // (the composed actor) can read its own principal alongside the ICRC-7
  // canister's debug echo. The additive game-end tiers pass null to preserve
  // the existing failure-text shape; the debug test-mint path passes
  // ?(Principal.fromActor(this)) so the debug principal info is surfaced on
  // rejection.
  public func mintForPlayer(
    store : NftStore,
    request : MintRequest,
    recipientUsername : Text,
    recipientTeam : Team,
    recipientRole : RecipientRole,
    attemptedAt : Timestamp,
    gameNumber : Nat,
    callingPrincipal : ?Principal,
  ) : async MintOutcome {
    let address = request.recipientWalletAddress;
    // Silent-skip gate: an empty wallet address returns #skipped without
    // trapping and WITHOUT calling the canister (preserves the existing
    // silent-skip semantics for players without a wallet).
    if (address.isEmpty()) {
      let skipOutcome : MintOutcome = #skipped("invalid wallet address");
      let skipAttempt : MintAttempt = {
        id = nextMintAttemptId(store);
        gameNumber;
        recipientWalletAddress = address;
        recipientUsername;
        recipientTeam;
        recipientRole;
        outcome = skipOutcome;
        attemptedAt;
      };
      appendMintAttempt(store, skipAttempt);
      Debug.print("[nft] mintForPlayer skipped: username=" # recipientUsername # " reason=invalid wallet address");
      return skipOutcome;
    };
    // 64-char hex Account ID gate: recognized as a valid input shape but
    // NOT mintable (cannot reverse a hex account id back to a principal
    // to construct an ICRC-7 Account.owner). Return #failed with a clear
    // reason WITHOUT calling the canister.
    if (isHexAccountId(address)) {
      let failOutcome : MintOutcome = #failed(
        "hex account IDs are not supported for minting; please use your principal textual address",
      );
      let failAttempt : MintAttempt = {
        id = nextMintAttemptId(store);
        gameNumber;
        recipientWalletAddress = address;
        recipientUsername;
        recipientTeam;
        recipientRole;
        outcome = failOutcome;
        attemptedAt;
      };
      appendMintAttempt(store, failAttempt);
      Debug.print("[nft] mintForPlayer failed: username=" # recipientUsername # " reason=hex account id not supported");
      return failOutcome;
    };
    // Parse the wallet address to a Principal for the ICRC-7 Account.owner.
    // isMintableAddress already verified parseability, but we re-parse
    // here under try/catch to be defensive against any race.
    let owner : Principal = try {
      Principal.fromText(address);
    } catch _ {
      let failOutcome : MintOutcome = #failed("wallet address parse failed");
      let failAttempt : MintAttempt = {
        id = nextMintAttemptId(store);
        gameNumber;
        recipientWalletAddress = address;
        recipientUsername;
        recipientTeam;
        recipientRole;
        outcome = failOutcome;
        attemptedAt;
      };
      appendMintAttempt(store, failAttempt);
      Debug.print("[nft] mintForPlayer failed: username=" # recipientUsername # " reason=wallet address parse failed");
      return failOutcome;
    };
    // Mint through the collection canister's mint_auto entrypoint, passing
    // the recipient account and metadata as two separate Candid arguments.
    // The canister assigns the token id internally from a counter that only
    // increases and is never affected by burns, so there is no token-id
    // computation, no supply query, and no collision retry loop. The returned
    // #Ok(tokenId) is the assigned id.
    let recipient : Account = { owner; subaccount = null };
    let metadataVec : [(Text, Metadata)] = metadataToVec(request.metadata);
    let result : MintReceipt = try {
      await icrc7Collection.mint_auto(recipient, metadataVec);
    } catch e {
      let reason = "mint canister call trapped: " # e.message();
      let failOutcome : MintOutcome = #failed(reason);
      let failAttempt : MintAttempt = {
        id = nextMintAttemptId(store);
        gameNumber;
        recipientWalletAddress = address;
        recipientUsername;
        recipientTeam;
        recipientRole;
        outcome = failOutcome;
        attemptedAt;
      };
      appendMintAttempt(store, failAttempt);
      Debug.print("[nft] mintForPlayer failed: username=" # recipientUsername # " reason=" # reason);
      return failOutcome;
    };
    switch (result) {
      case (#Ok(tokenId)) {
        // Success: append a local NftRecord (for caching/
        // getMintStatusForPlayer) with the canister-assigned tokenId. The
        // recorded token id is ALWAYS the id the canister returned.
        let record : NftRecord = {
          tokenId;
          owner;
          metadata = request.metadata;
          mintedAt = attemptedAt;
        };
        appendNft(store, record);
        // Update the cache-only counter from the confirmed canister
        // result so it never lags behind the canister's actual supply.
        if (tokenId + 1 > store.nextTokenId) {
          store.nextTokenId := tokenId + 1;
        };
        let okOutcome : MintOutcome = #succeeded({ tokenId });
        let okAttempt : MintAttempt = {
          id = nextMintAttemptId(store);
          gameNumber;
          recipientWalletAddress = address;
          recipientUsername;
          recipientTeam;
          recipientRole;
          outcome = okOutcome;
          attemptedAt;
        };
        appendMintAttempt(store, okAttempt);
        Debug.print("[nft] mintForPlayer succeeded: username=" # recipientUsername # " tokenId=" # tokenId.toText());
        okOutcome;
      };
      case (#Err(err)) {
        // A canister error is terminal — mint_auto assigns the id itself, so
        // there is no candidate id to advance and no retry that can help.
        let baseMessage = switch (err) {
          case (#GenericError(e)) e.message;
          case (#Unauthorized) "unauthorized";
          case (#InvalidRecipient) "invalid recipient";
          case (#SupplyCapOverflow) "supply cap overflow";
          case (#AlreadyExistTokenId) "token id already exists";
        };
        let message = switch (callingPrincipal) {
          case null baseMessage;
          case (?p) baseMessage # " calling principal: " # p.toText();
        };
        let failOutcome : MintOutcome = #failed(message);
        let failAttempt : MintAttempt = {
          id = nextMintAttemptId(store);
          gameNumber;
          recipientWalletAddress = address;
          recipientUsername;
          recipientTeam;
          recipientRole;
          outcome = failOutcome;
          attemptedAt;
        };
        appendMintAttempt(store, failAttempt);
        Debug.print("[nft] mintForPlayer failed: username=" # recipientUsername # " reason=" # message);
        failOutcome;
      };
    };
  };

  // Roll the game-end spell reward for a single player. Draws ONE uniform
  // value over a large range and derives the whole award from it via
  // Spells.rollSpellReward: the outcome bucket, the magic category, and the
  // specific spell all come from that single draw. Returns null when the
  // draw lands on Nothing (the caller mints nothing and records a skip).
  // Async because the random draw is an inter-canister call.
  //
  // The roll draws ONLY from the nftEligible spell set that also has a level
  // assignment: moderate and complex spells remain fully playable in the
  // game but are excluded from the game-end NFT minting pool, so they are
  // never selected for minting.
  public func rollSpellId() : async ?Nat {
    let r = await Random.natRange(0, 1_000_000_000);
    let reward = Spells.rollSpellReward(Spells.eligibleSpellTable(), r);
    switch (reward) {
      case (?rw) ?rw.entry.id;
      case null null;
    };
  };

  // Roll the game-end spell reward for a guaranteed bettor. Uses the same
  // single draw as rollSpellId but with Nothing removed, so a guaranteed
  // bettor never gets Nothing and the other outcomes keep their
  // proportions. Returns null only when the drawn level has no eligible
  // spell. Async because the random draw is an inter-canister call.
  public func rollGuaranteedSpellId() : async ?Nat {
    let r = await Random.natRange(0, 1_000_000_000);
    let reward = Spells.rollGuaranteedSpellReward(Spells.eligibleSpellTable(), r);
    switch (reward) {
      case (?rw) ?rw.entry.id;
      case null null;
    };
  };

  // The maximum number of NFTs minted per game by the per-player mint
  // loop. When more than this many players are eligible, exactly this many
  // distinct recipients are selected by the deterministic walk below.
  let maxMintsPerGame : Nat = 10;

  // Deterministically select which eligible players receive an NFT when
  // more than `maxMintsPerGame` players are eligible. `eligibleIndices` is
  // the list of player-list indices whose wallet address is non-null and
  // non-empty, in player-list order. `gameNumber` is the just-completed
  // game's number.
  //
  // The walk is driven by d, the last digit of the game number (0 treated
  // as 10):
  //   - the first recipient is the eligible player at index (d - 1);
  //   - then step forward by d positions, wrapping modulo N, skipping
  //     already-picked players, until `maxMintsPerGame` distinct recipients
  //     have been chosen.
  //
  // Pure and side-effect free so the walk can be unit-tested without the
  // canister. Returns the chosen positions in `eligibleIndices` (not the
  // original player-list indices), in selection order.
  public func selectMintRecipientIndices(
    eligibleIndices : [Nat],
    gameNumber : Nat,
  ) : [Nat] {
    let n = eligibleIndices.size();
    if (n <= maxMintsPerGame) {
      // 10 or fewer eligible players: mint to every eligible player.
      return Array.tabulate(n, func(i) { i });
    };
    // d is the last digit of the game number, with 0 treated as 10.
    let lastDigit = gameNumber % 10;
    let d = if (lastDigit == 0) 10 else lastDigit;
    let chosen = List.empty<Nat>();
    // The first recipient is the eligible player at index (d - 1). Compute
    // the start without an unchecked Nat subtraction: d is in 1..10, so
    // `d - 1` is safe, but the compiler cannot prove it from the `if` above.
    // `(d + n - 1) % n` is the same value and provably non-negative.
    var cursor = (d + n - 1) % n;
    while (chosen.size() < maxMintsPerGame) {
      // Step forward by d, wrapping modulo N, until an unchosen position is
      // found. The loop is bounded by N steps: if the step-by-d orbit is
      // exhausted (gcd(d, N) > 1 makes it a proper subset) we fall through
      // and resume from the next unchosen position below.
      var steps = 0;
      while (chosen.contains(cursor) and steps < n) {
        cursor := (cursor + d) % n;
        steps += 1;
      };
      if (chosen.contains(cursor)) {
        // The step-by-d orbit is exhausted without finding an unchosen
        // position. Advance the cursor by one position (wrapping) until an
        // unchosen position is found, then resume stepping by d from there.
        // This guarantees 10 distinct recipients whenever N > 10.
        var probe = 0;
        while (probe < n and chosen.contains(cursor)) {
          cursor := (cursor + 1) % n;
          probe += 1;
        };
        if (chosen.contains(cursor)) {
          // Every position has been picked — the list is exhausted.
          break;
        };
      };
      chosen.add(cursor);
      // Advance to the next candidate position.
      cursor := (cursor + d) % n;
    };
    chosen.toArray();
  };

  // The maximum number of recipients per mint_auto_batch call. The capped
  // per-player tier chunks its recipient list at this size so a large lobby
  // is minted in bounded batches rather than one unbounded call.
  let mintBatchSize : Nat = 50;

  // A fully precomputed recipient for the batched capped-tier mint: the
  // parsed owner principal, the raw wallet address text (for bookkeeping),
  // the player's identity fields, and the metadata built before the batch
  // call. Spell rolls and metadata construction happen once, up front, so
  // the batch call itself carries no per-player computation.
  type BatchRecipient = {
    owner : Principal;
    address : Text;
    username : Text;
    team : Team;
    role : RecipientRole;
    metadata : MintMetadata;
  };

  // Append one MintAttempt for a player with the given outcome. Shared by the
  // batched capped-tier mint so every recipient — succeeded, failed, or
  // parse-rejected — gets exactly one attempt recorded, preserving the
  // per-player bookkeeping the frontend's mint-status poll reads.
  func recordAttempt(
    store : NftStore,
    gameNumber : Nat,
    address : Text,
    username : Text,
    team : Team,
    role : RecipientRole,
    outcome : MintOutcome,
    attemptedAt : Timestamp,
  ) {
    let attempt : MintAttempt = {
      id = nextMintAttemptId(store);
      gameNumber;
      recipientWalletAddress = address;
      recipientUsername = username;
      recipientTeam = team;
      recipientRole = role;
      outcome;
      attemptedAt;
    };
    appendMintAttempt(store, attempt);
  };

  // Mint NFTs for participating players at game conclusion. Every player in
  // the recorder's playerList snapshot is eligible for an NFT regardless of
  // win or lose — no filtering by recipientRole or team outcome. Players
  // with a null wallet address are never eligible and always get an explicit
  // #skipped("no wallet address supplied") MintAttempt recorded.
  //
  // The per-game mint is capped at `maxMintsPerGame` (10) NFTs:
  //   - when 10 or fewer players are eligible, every eligible player is
  //     minted to (one NFT each);
  //   - when more than 10 are eligible, exactly 10 distinct recipients are
  //     chosen by the deterministic walk in selectMintRecipientIndices.
  //
  // Each selected recipient gets a MintAttempt recorded with one of three
  // explicit outcomes:
  //   - no wallet address supplied -> #skipped("no wallet address supplied")
  //   - mint succeeded              -> #succeeded { tokenId }
  //   - mint attempted but failed   -> #failed("<reason>")
  // There are NO silent skips — every player gets a MintAttempt so the
  // frontend can render per-player mint status at game conclusion. Mint
  // failures for one player do not block other players' mints — each
  // player's mint is independent and any failure is captured as a
  // #skipped or #failed MintOutcome without trapping. This is the
  // entrypoint the backend canister calls at game conclusion.
  //
  // The mint is purely additive: if the NFT feature breaks, removing the
  // call to this function from the concludeGame flow leaves chess logic,
  // game recording, login, and the existing working code untouched.
  public func mintForEligiblePlayers(
    store : NftStore,
    result : GameResult,
    endState : EndState,
    finalBoardState : FinalBoardState,
    playerList : [RecorderTypes.PlayerListEntry],
    moveCount : Nat,
    concludedAt : Timestamp,
    gameNumber : Nat,
    guaranteedUsernames : [Text],
  ) : async () {
    Debug.print("[nft] mintForEligiblePlayers starting: playerListSize=" # playerList.size().toText() # " gameNumber=" # gameNumber.toText());
    // First pass: record an explicit #skipped MintAttempt for every player
    // with a null wallet address (no silent skip), and collect the indices
    // of the eligible players (non-null, non-empty wallet address). The
    // eligibility test is the same non-null/non-empty check the mint loop
    // has always used, so the definition of "eligible" does not drift.
    //
    // Players in the guaranteed set are excluded from the capped pool: they
    // are minted by the separate guaranteed tier (mintGuaranteedEntries),
    // which is additive and does not consume the 10-NFT cap. Excluding them
    // here preserves max one NFT per wallet globally.
    let eligibleIndices = List.empty<Nat>();
    var i = 0;
    while (i < playerList.size()) {
      let entry = playerList[i];
      let role : RecipientRole = switch (recipientRole(result, entry.team)) {
        case (?r) r;
        case null #Drawer;
      };
      if (guaranteedUsernames.contains(entry.username)) {
        // Guaranteed-tier player: handled by the guaranteed mint, not the
        // capped pool. No attempt is recorded here — the guaranteed mint
        // records its own outcome.
        i += 1;
        continue;
      };
      switch (entry.walletAddress) {
        case null {
          // No wallet address supplied: record an explicit #skipped
          // MintAttempt so the frontend can render status (1). The
          // player is NOT skipped silently — their username, team, and
          // the skipped outcome are recorded.
          let skipOutcome : MintOutcome = #skipped("no wallet address supplied");
          let skipAttempt : MintAttempt = {
            id = nextMintAttemptId(store);
            gameNumber;
            recipientWalletAddress = "";
            recipientUsername = entry.username;
            recipientTeam = entry.team;
            recipientRole = role;
            outcome = skipOutcome;
            attemptedAt = concludedAt;
          };
          appendMintAttempt(store, skipAttempt);
          Debug.print("[nft] mintForEligiblePlayers skipped: username=" # entry.username # " reason=no wallet address supplied");
        };
        case (?address) {
          if (address.isEmpty()) {
            // Empty wallet address: same explicit #skipped recording as a
            // null wallet, and never eligible for selection.
            let skipOutcome : MintOutcome = #skipped("no wallet address supplied");
            let skipAttempt : MintAttempt = {
              id = nextMintAttemptId(store);
              gameNumber;
              recipientWalletAddress = "";
              recipientUsername = entry.username;
              recipientTeam = entry.team;
              recipientRole = role;
              outcome = skipOutcome;
              attemptedAt = concludedAt;
            };
            appendMintAttempt(store, skipAttempt);
            Debug.print("[nft] mintForEligiblePlayers skipped: username=" # entry.username # " reason=no wallet address supplied");
          } else {
            eligibleIndices.add(i);
          };
        };
      };
      i += 1;
    };
    // Second pass: choose the recipients. With 10 or fewer eligible players
    // every eligible player is chosen; with more than 10, the deterministic
    // walk selects exactly 10 distinct recipients.
    let eligible = eligibleIndices.toArray();
    let chosenPositions = selectMintRecipientIndices(eligible, gameNumber);
    Debug.print(
      "[nft] mintForEligiblePlayers selection: eligible=" # eligible.size().toText()
      # " chosen=" # chosenPositions.size().toText()
      # " gameNumber=" # gameNumber.toText(),
    );
    // Second pass: precompute every chosen recipient — parse the owner
    // principal, roll the spell reward, and build the metadata — BEFORE any
    // batch call. An address that fails to parse is recorded as an individual
    // #failed attempt and excluded from the batch, so one bad address cannot
    // trap a whole chunk. Spell rolls are drawn here, once per recipient,
    // rather than inside a per-player mint loop.
    let batch = List.empty<BatchRecipient>();
    for (position in chosenPositions.values()) {
      let entry = playerList[eligible[position]];
      let address = switch (entry.walletAddress) {
        case null "";
        case (?a) a;
      };
      let role : RecipientRole = switch (recipientRole(result, entry.team)) {
        case (?r) r;
        case null #Drawer;
      };
      // Roll the game-end spell reward for this player. The single draw
      // determines the outcome bucket, the magic category, and the specific
      // spell; the chosen spell's id is threaded into the NFT metadata so
      // the game-end spell reward is a verifiable part of the minted
      // artifact. A null roll means the player drew Nothing: mint nothing
      // and record an explicit #skipped("nothing rolled") attempt so the
      // end-of-game list still shows a row for them.
      let rolled = await rollSpellId();
      let spellId = switch (rolled) {
        case (?id) id;
        case null {
          recordAttempt(
            store,
            gameNumber,
            address,
            entry.username,
            entry.team,
            role,
            #skipped("nothing rolled"),
            concludedAt,
          );
          Debug.print("[nft] mintForEligiblePlayers skipped: username=" # entry.username # " reason=nothing rolled");
          continue;
        };
      };
      let spellName = spellNameById(spellId);
      let metadata = buildMintMetadata(
        result,
        endState,
        finalBoardState,
        entry,
        role,
        moveCount,
        concludedAt,
        gameNumber,
        spellId,
        spellName,
      );
      // Parse the wallet address up front. The eligibility gate already
      // guarantees a non-empty, non-hex address, but parsing is re-verified
      // defensively so an unforeseen edge case is captured as this player's
      // own #failed attempt instead of trapping the whole batch.
      let owner : ?Principal = try {
        ?Principal.fromText(address);
      } catch _ {
        null;
      };
      switch (owner) {
        case null {
          recordAttempt(
            store,
            gameNumber,
            address,
            entry.username,
            entry.team,
            role,
            #failed("wallet address parse failed"),
            concludedAt,
          );
          Debug.print("[nft] mintForEligiblePlayers failed: username=" # entry.username # " reason=wallet address parse failed");
        };
        case (?o) {
          batch.add({
            owner = o;
            address;
            username = entry.username;
            team = entry.team;
            role;
            metadata;
          });
        };
      };
    };
    // Third pass: mint the precomputed recipients in chunks of at most
    // mintBatchSize via the collection canister's batched mint_auto_batch
    // entrypoint. Each returned receipt is mapped back to its player by
    // index; a per-receipt #Err is recorded for that player only and never
    // treated as a whole-batch failure. A trapped chunk call fails every
    // recipient in that chunk individually.
    let recipients = batch.toArray();
    var offset = 0;
    while (offset < recipients.size()) {
      let remaining = recipients.size() - offset;
      let chunkSize = if (remaining < mintBatchSize) remaining else mintBatchSize;
      let accounts : [Account] = Array.tabulate(
        chunkSize,
        func(i) {
          { owner = recipients[offset + i].owner; subaccount = null };
        },
      );
      let metadataVecs : [[(Text, Metadata)]] = Array.tabulate(
        chunkSize,
        func(i) { metadataToVec(recipients[offset + i].metadata) },
      );
      let maybeReceipts : ?[MintReceipt] = try {
        ?(await icrc7Collection.mint_auto_batch(accounts, metadataVecs));
      } catch e {
        // The whole chunk call trapped: record an individual #failed attempt
        // for every recipient in the chunk. Other chunks are unaffected.
        let reason = "mint canister call trapped: " # e.message();
        var k = 0;
        while (k < chunkSize) {
          let r = recipients[offset + k];
          recordAttempt(store, gameNumber, r.address, r.username, r.team, r.role, #failed(reason), concludedAt);
          Debug.print("[nft] mintForEligiblePlayers failed: username=" # r.username # " reason=" # reason);
          k += 1;
        };
        null;
      };
      switch (maybeReceipts) {
        case null {};
        case (?receipts) {
          var j = 0;
          while (j < chunkSize) {
            let r = recipients[offset + j];
            // Map the receipt back to its player by index. A missing receipt
            // (the canister returned fewer than requested) is treated as that
            // player's own failure, never as a whole-batch failure.
            let receipt : MintReceipt = if (j < receipts.size()) {
              receipts[j];
            } else {
              #Err(#GenericError({ error_code = 0; message = "mint_auto_batch returned no receipt for this index" }));
            };
            switch (receipt) {
              case (#Ok(tokenId)) {
                // Success: append a local NftRecord (for caching/
                // getMintStatusForPlayer) with the canister-assigned tokenId.
                // The recorded token id is ALWAYS the id the canister
                // returned.
                let record : NftRecord = {
                  tokenId;
                  owner = r.owner;
                  metadata = r.metadata;
                  mintedAt = concludedAt;
                };
                appendNft(store, record);
                // Update the cache-only counter from the confirmed canister
                // result so it never lags behind the canister's actual supply.
                if (tokenId + 1 > store.nextTokenId) {
                  store.nextTokenId := tokenId + 1;
                };
                recordAttempt(store, gameNumber, r.address, r.username, r.team, r.role, #succeeded({ tokenId }), concludedAt);
                Debug.print("[nft] mintForEligiblePlayers succeeded: username=" # r.username # " tokenId=" # tokenId.toText());
              };
              case (#Err(err)) {
                // A per-receipt canister error is terminal for this player
                // only — mint_auto_batch assigns ids itself, so there is no
                // candidate id to advance and no retry that can help.
                let message = switch (err) {
                  case (#GenericError(e)) e.message;
                  case (#Unauthorized) "unauthorized";
                  case (#InvalidRecipient) "invalid recipient";
                  case (#SupplyCapOverflow) "supply cap overflow";
                  case (#AlreadyExistTokenId) "token id already exists";
                };
                recordAttempt(store, gameNumber, r.address, r.username, r.team, r.role, #failed(message), concludedAt);
                Debug.print("[nft] mintForEligiblePlayers failed: username=" # r.username # " reason=" # message);
              };
            };
            j += 1;
          };
        };
      };
      offset += chunkSize;
    };
  };

  // Mint the guaranteed tier: every guaranteed entry with a verified bet and
  // a recorded wallet address receives an NFT, read from the guaranteed entry
  // itself rather than the player row. This is additive and does NOT consume
  // the 10-NFT cap applied to the capped pool in mintForEligiblePlayers.
  //
  // A departed bettor whose player row was heartbeat-cleaned still receives
  // their guaranteed NFT because the entry is self-contained (it carries its
  // own wallet address). The recipient's team/role for the metadata is
  // resolved from the live player row when present; a departed bettor falls
  // back to #White/#Drawer (the neutral placeholder used by the fixed
  // recipient mint) since their team is no longer known.
  //
  // Each entry's mint goes through the single-mint mintForPlayer flow, so
  // outcomes are recorded as MintAttempts and a failure for one entry never
  // blocks the others. This tier is additive and stays outside the capped
  // pool's batched mint_auto_batch path.
  public func mintGuaranteedEntries(
    store : NftStore,
    result : GameResult,
    endState : EndState,
    finalBoardState : FinalBoardState,
    entries : [GuaranteedEntry],
    moveCount : Nat,
    concludedAt : Timestamp,
    gameNumber : Nat,
  ) : async () {
    for (entry in entries.values()) {
      let address = switch (entry.walletAddress) {
        case null "";
        case (?a) a;
      };
      // The guaranteed entry is self-contained; the team/role are resolved
      // from the entry's own recorded team when available. The entry type
      // does not carry a team, so the neutral placeholder is used — the
      // guaranteed tier is keyed on username and wallet, not team.
      let role : RecipientRole = #Drawer;
      // Guaranteed bettors use the same single draw with Nothing removed,
      // so they never get Nothing and the other outcomes keep their
      // proportions. A null roll here means the drawn level had no eligible
      // spell; record a skip and move on.
      let rolled = await rollGuaranteedSpellId();
      let spellId = switch (rolled) {
        case (?id) id;
        case null {
          let skipOutcome : MintOutcome = #skipped("nothing rolled");
          let skipAttempt : MintAttempt = {
            id = nextMintAttemptId(store);
            gameNumber;
            recipientWalletAddress = address;
            recipientUsername = entry.username;
            recipientTeam = #White;
            recipientRole = role;
            outcome = skipOutcome;
            attemptedAt = concludedAt;
          };
          appendMintAttempt(store, skipAttempt);
          Debug.print("[nft] mintGuaranteedEntries skipped: username=" # entry.username # " reason=nothing rolled");
          continue;
        };
      };
      let spellName = spellNameById(spellId);
      let syntheticEntry : RecorderTypes.PlayerListEntry = {
        listPosition = 0;
        principal = entry.username;
        username = entry.username;
        team = #White;
        walletAddress = entry.walletAddress;
      };
      let metadata = buildMintMetadata(
        result,
        endState,
        finalBoardState,
        syntheticEntry,
        role,
        moveCount,
        concludedAt,
        gameNumber,
        spellId,
        spellName,
      );
      let request : MintRequest = {
        recipientWalletAddress = address;
        metadata;
      };
      try {
        ignore await mintForPlayer(
          store,
          request,
          entry.username,
          #White,
          role,
          concludedAt,
          gameNumber,
          null,
        );
      } catch _ {
        let failOutcome : MintOutcome = #failed("guaranteed mint trapped");
        let failAttempt : MintAttempt = {
          id = nextMintAttemptId(store);
          gameNumber;
          recipientWalletAddress = address;
          recipientUsername = entry.username;
          recipientTeam = #White;
          recipientRole = role;
          outcome = failOutcome;
          attemptedAt = concludedAt;
        };
        appendMintAttempt(store, failAttempt);
        Debug.print("[nft] mintGuaranteedEntries failed: username=" # entry.username # " reason=guaranteed mint trapped");
      };
    };
  };

  // Record a #skipped MintAttempt for each player whose heartbeat was stale
  // at game conclusion. The recorder's presence gate filters stale players
  // out of the snapshot before the mint loop runs, so without this they
  // would never reach the mint loop and nothing would be recorded. This
  // records a distinct stale-heartbeat skip for each such player so the
  // user can see why they got no NFT. The game/betting/wallet logic is
  // untouched — this only adds the recording.
  //
  // `stalePlayers` is the set of players excluded by the presence gate
  // (present in the live player list but with a stale heartbeat at
  // conclusion). Each gets one attempt tagged with the concluded game's
  // number.
  public func recordStaleHeartbeatSkips(
    store : NftStore,
    stalePlayers : [RecorderTypes.PlayerListEntry],
    result : GameResult,
    gameNumber : Nat,
    concludedAt : Timestamp,
  ) {
    for (entry in stalePlayers.values()) {
      let role : RecipientRole = switch (recipientRole(result, entry.team)) {
        case (?r) r;
        case null #Drawer;
      };
      let skipOutcome : MintOutcome = #skipped("stale heartbeat at game conclusion");
      let skipAttempt : MintAttempt = {
        id = nextMintAttemptId(store);
        gameNumber;
        recipientWalletAddress = switch (entry.walletAddress) {
          case null "";
          case (?a) a;
        };
        recipientUsername = entry.username;
        recipientTeam = entry.team;
        recipientRole = role;
        outcome = skipOutcome;
        attemptedAt = concludedAt;
      };
      appendMintAttempt(store, skipAttempt);
      Debug.print("[nft] recordStaleHeartbeatSkips: username=" # entry.username # " reason=stale heartbeat at game conclusion");
    };
  };

  // Record a whole-pass mint failure as a MintAttempt so the failure is
  // visible instead of silently swallowed by the outer catch in the chess
  // mixin's mintGameNftsSafe. The attempt carries a distinct reason string
  // and the concluded game's number. `reason` is the failure text.
  public func recordMintPassFailure(
    store : NftStore,
    reason : Text,
    gameNumber : Nat,
    concludedAt : Timestamp,
  ) {
    let failOutcome : MintOutcome = #failed(reason);
    let failAttempt : MintAttempt = {
      id = nextMintAttemptId(store);
      gameNumber;
      recipientWalletAddress = "";
      recipientUsername = "";
      recipientTeam = #White;
      recipientRole = #Drawer;
      outcome = failOutcome;
      attemptedAt = concludedAt;
    };
    appendMintAttempt(store, failAttempt);
    Debug.print("[nft] recordMintPassFailure: reason=" # reason);
  };

  // ---------- True ICRC-7 burn ----------

  // Find the raw metadata value for a key, or null when the key is absent.
  // The caller inspects the value's variant to distinguish "key absent" from
  // "key present with the wrong type". Read-only helper.
  func findMetadataValue(metadata : [(Text, Metadata)], key : Text) : ?Metadata {
    var found : ?Metadata = null;
    for ((k, v) in metadata.values()) {
      if (k == key) {
        found := ?v;
      };
    };
    found;
  };

  // The classification of one token's pre-burn spell metadata read. #ok
  // carries the usable spell; #legacy carries the specific reason no usable
  // spell was found.
  type ReadSpellKeysResult = {
    #ok : (Text, Nat);
    #legacy : LegacyReason;
  };

  // How many times a failed metadata read is retried before it is classified
  // #readFailed. A transient inter-canister failure is retried; a successful
  // read that lacks the keys is not (the metadata is authoritative).
  let maxReadAttempts : Nat = 3;

  // Truly destroy one or more NFTs by calling the collection canister's
  // vec-shaped `icrc7_burn` directly as this backend's own principal.
  //
  // Authorization uses the allowlisted-admin path: this backend's principal
  // is authorized to burn, so no per-token ICRC-37 approval, signer, or
  // wallet mediation is involved. The burn is submitted as a single batch —
  // one `BurnArg{ memo; token_ids }` request carrying every token id — so a
  // multi-token burn is one inter-canister call.
  //
  // Read-before-burn ordering is mandatory: the burn destroys the tokens, so
  // each token's spell name and game number are read from the ledger via
  // icrc7_token_metadata BEFORE the burn call. A failed or empty metadata
  // read does NOT abort the burn — the token is burned anyway and reported
  // as #burnedLegacy (legacy tokens have nothing to read and burn inert).
  // There is deliberately no hard-refuse guard: any NFT the player owns is
  // burnable, keys or no keys.
  //
  // The inter-canister awaits are wrapped in try/catch and the #Ok/#Err
  // receipt variant is switched on, so no trap escapes as an unhandled
  // error. The backend never sends cycles outward — the burn call attaches
  // no cycles.

  // Read one token's ICRC-7 metadata from the collection canister. Returns
  // the canister's per-token metadata vec (positionally aligned with the
  // request vec; the entry is null when the canister has no metadata for the
  // token). Kept as its own async helper so the burn path can wrap the call
  // in try/catch without the optional-returning await collapsing into a
  // nested optional.
  func readTokenMetadata(tokenId : Nat) : async [?[(Text, Metadata)]] {
    await icrc7Collection.icrc7_token_metadata([tokenId]);
  };

  // Read the spell name and game number for one token from the ledger before
  // it is burned, retrying a failed read before giving up. Returns a
  // classification of what the metadata carried:
  //   - #ok(name, number): both keys were present and correctly typed.
  //   - #legacy(reason): no usable spell, with the specific reason.
  // A transient read failure (a trapped call or a missing entry) is retried up
  // to `maxReadAttempts` times before it is classified #readFailed, so a
  // one-off failure on a token that does carry keys does not produce a false
  // legacy result. A successful read that simply lacks the keys is not
  // retried — the metadata is authoritative and retrying cannot change it.
  //
  // The two keys are read from a single metadata fetch per attempt (the
  // canister returns the whole per-token metadata vec), so the pair is always
  // read from the same snapshot and cannot disagree because of two separate
  // reads.
  func readSpellKeys(tokenId : Nat) : async ReadSpellKeysResult {
    var attempt = 0;
    while (attempt < maxReadAttempts) {
      attempt += 1;
      let metadata : ?[(Text, Metadata)] = try {
        let fetched = await readTokenMetadata(tokenId);
        fetched[0];
      } catch _ {
        null;
      };
      switch (metadata) {
        case null {
          // The read failed, trapped, or returned no entry for the token.
          // Retry — this may be transient.
        };
        case (?tokenMetadata) {
          let nameValue = findMetadataValue(tokenMetadata, "jalca:spell_name");
          let numberValue = findMetadataValue(tokenMetadata, "jalca:game_number");
          switch (nameValue, numberValue) {
            case (null, null) {
              // The metadata was read successfully and carries neither key —
              // a genuinely legacy token. Retrying cannot change this.
              return #legacy(#keysAbsent);
            };
            case (?v, ?w) {
              switch (v, w) {
                case (#Text(name), #Nat(number)) return #ok(name, number);
                case _ return #legacy(#wrongType);
              };
            };
            case _ {
              // Exactly one key is present: the pair disagrees.
              return #legacy(#keysDisagree);
            };
          };
        };
      };
    };
    // Every attempt failed to read the metadata.
    #legacy(#readFailed);
  };

  // Burn a batch of token ids in a single `icrc7_burn` request, submitted
  // directly by this backend's own principal (the allowlisted-admin path).
  // Returns one BurnOutcome per requested token id, in the same order as the
  // input list. The batch is one inter-canister call; the per-token spell
  // metadata is read before the burn so each outcome can report the spell it
  // carried.
  //
  // A trapped or empty burn call fails every token in the batch (the burn
  // did not happen for any of them). A per-token #Err from the canister is
  // surfaced verbatim for that token only.
  public func burnNfts(tokenIds : [Nat]) : async [BurnOutcome] {
    let count = tokenIds.size();
    if (count == 0) return [];
    // Read every token's spell keys BEFORE the burn, because the burn
    // destroys the tokens and their metadata with them. The reads are
    // sequential (Motoko awaits are sequential) and collected into a list.
    let readKeys = List.empty<(Nat, ReadSpellKeysResult)>();
    var i = 0;
    while (i < count) {
      let keys = await readSpellKeys(tokenIds[i]);
      readKeys.add((tokenIds[i], keys));
      i += 1;
    };
    let readKeysArray = readKeys.toArray();
    // Submit the whole batch as one BurnArg request.
    let arg : BurnArg = { memo = null; tokens = tokenIds };
    let results : [BurnResult] = try {
      await icrc7Collection.icrc7_burn(arg);
    } catch _ {
      return Array.tabulate(
        count,
        func(_) { #failed("burn canister call trapped") },
      );
    };
    if (results.size() == 0) {
      return Array.tabulate(
        count,
        func(_) { #failed("burn returned no result") },
      );
    };
    Array.tabulate(
      count,
      func(i) {
        let (_, keys) = readKeysArray[i];
        let burnResult : BurnResult = if (i < results.size()) {
          results[i];
        } else {
          #Err("burn returned no result for this token");
        };
        switch (burnResult) {
          case (#Ok(_)) {
            // The token was destroyed. Report the spell when the pre-burn
            // metadata read produced both keys; otherwise the token was a
            // legacy token and burns inert, carrying the specific reason.
            switch (keys) {
              case (#ok(name, number)) #burnedWithSpell({ spellName = name; gameNumber = number });
              case (#legacy(reason)) #burnedLegacy(reason);
            };
          };
          case (#Err(message)) {
            // The BurnResult error arm is plain text — surface it verbatim.
            #failed(message);
          };
        };
      },
    );
  };

  // Burn a single NFT through the same direct, admin-authorized batch path.
  // Kept as the single-token entry point; it delegates to burnNfts so there
  // is exactly one burn implementation.
  public func burnNft(tokenId : Nat) : async BurnOutcome {
    let outcomes = await burnNfts([tokenId]);
    if (outcomes.size() == 0) {
      return #failed("burn returned no result");
    };
    outcomes[0];
  };

  // ---------- Query helpers (for the nft-api mixin) ----------

  // Return the NftRecord for a given tokenId, or null if no such token
  // exists in the local cache. Read-only. Note: the local cache is a
  // subset of the canister's full token set (only tokens minted through
  // this backend); for the authoritative owner list, query the canister
  // via getNftsForOwner.
  public func getNft(store : NftStore, tokenId : Nat) : ?NftRecord {
    var i = 0;
    label search while (i < store.nfts.size()) {
      let record = store.nfts[i];
      if (record.tokenId == tokenId) return ?record;
      i += 1;
    };
    null;
  };

  // Return the metadata for a given tokenId from the local cache, or null
  // if no such token exists. Read-only.
  public func getNftMetadata(store : NftStore, tokenId : Nat) : ?MintMetadata {
    switch (getNft(store, tokenId)) {
      case null null;
      case (?record) ?record.metadata;
    };
  };

  // Batched metadata fetch: return the metadata for every requested token
  // id in a single response, in the same order as the input list. Each
  // entry is null when the token id is not present in the local cache.
  //
  // This is a pure synchronous helper: it reads the local nfts cache with
  // no await, no inter-canister call, and no state mutation, so a query
  // caller can invoke it directly. The token ids are processed
  // sequentially and the full array is returned in one response. The
  // existing getNftMetadata stays for compatibility.
  public func getNftMetadataBatch(
    store : NftStore,
    tokenIds : [Nat],
  ) : [?MintMetadata] {
    let results = Array.tabulate(
      tokenIds.size(),
      func(i) { getNftMetadata(store, tokenIds[i]) },
    );
    results;
  };

  // Return the list of token ids owned by the given owner Principal.
  // Queries the real canister's `icrc7_tokens_of` for the given owner
  // Account (constructed from the parsed principal, no subaccount) and
  // returns the canister's token id list (TokensOfResult.Ok). Falls back
  // to the local nfts cache on canister error (so a transient canister
  // failure does not break the frontend's NFT display). Async because the
  // canister query is an inter-canister call.
  public func getNftsForOwner(store : NftStore, owner : Principal) : async [Nat] {
    let account : Account = { owner; subaccount = null };
    let result : TokensOfResult = try {
      await icrc7Collection.icrc7_tokens_of(account);
    } catch _ {
      // Canister call trapped — fall back to the local cache.
      return localNftsForOwner(store, owner);
    };
    switch (result) {
      case (#Ok(tokenIds)) tokenIds;
      case (#Err(_)) {
        // Canister returned an error — fall back to the local cache.
        localNftsForOwner(store, owner);
      };
    };
  };

  // Local-cache fallback for getNftsForOwner: returns the token ids owned
  // by the given owner Principal from the local nfts array. Read-only.
  // The owner is matched by Principal equality.
  func localNftsForOwner(store : NftStore, owner : Principal) : [Nat] {
    let owned = Array.tabulate(
      store.nfts.size(),
      func(i) {
        let record = store.nfts[i];
        if (Principal.equal(record.owner, owner)) ?record.tokenId else null;
      },
    );
    owned.filterMap(
      func(x : ?Nat) : ?Nat { x },
    );
  };

  // Return the most recent mint outcome for a player identified by their
  // wallet address text, or null if no mint attempt has been recorded for
  // that address in the current/just-concluded game. Read-only. Used by
  // the frontend's mint-status poll. The outcome reflects real canister
  // data (the canister-returned tokenId on success, or the canister's
  // MintError message on failure) because mintForPlayer populates the
  // attempt from the canister result.
  public func getMintStatusForPlayer(
    store : NftStore,
    walletAddress : Text,
  ) : ?MintOutcome {
    var found : ?MintOutcome = null;
    var i = 0;
    label scan while (i < store.mintAttempts.size()) {
      let attempt = store.mintAttempts[i];
      if (attempt.recipientWalletAddress == walletAddress) {
        found := ?attempt.outcome;
      };
      i += 1;
    };
    switch (found) {
      case null Debug.print("[nft] getMintStatusForPlayer: walletAddress=" # walletAddress # " result=null");
      case (?o) Debug.print("[nft] getMintStatusForPlayer: walletAddress=" # walletAddress # " result=found");
    };
    found;
  };

  // Return ALL players' mint statuses for the current/just-concluded
  // game as a list of { username; walletAddress; team; outcome }. This
  // exists because getMintStatusForPlayer(walletAddress) cannot look up
  // players who had no wallet address (null wallet can't be a lookup
  // key). This query returns every player who has a MintAttempt
  // recorded, including those with null wallet addresses (their
  // walletAddress field is null in the returned entry). Read-only.
  public func getMintStatusesForGame(
    store : NftStore,
  ) : [MintStatusEntry] {
    let n = store.mintAttempts.size();
    Array.tabulate(
      n,
      func(i) {
        let attempt = store.mintAttempts[i];
        {
          username = attempt.recipientUsername;
          walletAddress = if (attempt.recipientWalletAddress.isEmpty()) null else ?attempt.recipientWalletAddress;
          team = attempt.recipientTeam;
          outcome = ?attempt.outcome;
        };
      },
    );
  };

  // Return the retained mint attempts grouped by game, most recent game
  // first. Each group carries the game number and every retained attempt
  // recorded for that game, in append order. The log is retained across
  // games (capped at the 10 most recent distinct game numbers), so the
  // frontend can show the current game's attempts and confirm retention
  // across games. Read-only.
  public func getMintAttemptsByGame(store : NftStore) : [MintAttemptGroup] {
    let count = store.mintAttempts.size();
    if (count == 0) return [];
    // Collect the distinct game numbers present, in ascending order.
    let distinct = List.empty<Nat>();
    var i = 0;
    while (i < count) {
      let g = store.mintAttempts[i].gameNumber;
      if (not distinct.contains(g)) {
        distinct.add(g);
      };
      i += 1;
    };
    // Most recent game first.
    let sorted = distinct.toArray().sort();
    let descending = sorted.reverse();
    Array.tabulate(
      descending.size(),
      func(gi) {
        let gameNumber = descending[gi];
        let attempts = List.empty<MintAttempt>();
        var j = 0;
        while (j < count) {
          let a = store.mintAttempts[j];
          if (a.gameNumber == gameNumber) {
            attempts.add(a);
          };
          j += 1;
        };
        {
          gameNumber;
          attempts = attempts.toArray();
        };
      },
    );
  };

  // Return the stored spell name for a given game/wallet from the durable
  // NftRecord, or null if no NFT was minted for that game and wallet. The
  // spell name is captured at mint time and persisted in the NftRecord (which
  // survives new game starts — only mintAttempts are cleared), so the game
  // conclusion modal can read it directly instead of reconstructing it through a
  // fragile wallet-address lookup. Read-only.
  public func getSpellNameForGame(
    store : NftStore,
    gameNumber : Nat,
    walletAddress : Text,
  ) : ?Text {
    var i = 0;
    label find while (i < store.nfts.size()) {
      let record = store.nfts[i];
      if (
        record.metadata.gameNumber == gameNumber
        and record.metadata.recipientWalletAddress == walletAddress
      ) {
        return ?record.metadata.spellName;
      };
      i += 1;
    };
    null;
  };
};
