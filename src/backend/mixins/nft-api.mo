import Debug "mo:core/Debug";
import Principal "mo:core/Principal";

import Types "../types/nft";
import RecorderTypes "../types/game-recorder";
import ChessTypes "../types/chess-game";
import Nft "../lib/nft";
import Guaranteed "../lib/guaranteed";

mixin (
  nftStore : Types.NftStore,
  recorder : RecorderTypes.RecorderStore,
  gameState : ChessTypes.GameState,
  guaranteedStore : ChessTypes.GuaranteedStore,
) {
  // The single reserved bot's roster key/username is the fixed literal
  // "jalca-bot" (see botRosterKey() in chess-game-api.mo) — it is the bot's
  // PseudoPrincipal in every PlayerListEntry it ever appears in, since the
  // bot is constructed with that literal as both principal and username and
  // never reassigned. This mixin is not given the live PlayerStore, so the
  // equivalent of looking up "does this entry's principal belong to the
  // live isBot player" is comparing the entry's principal against that same
  // reserved literal — the only principal the bot can ever carry.
  func isBotEntry(entry : RecorderTypes.PlayerListEntry) : Bool {
    entry.principal == "jalca-bot";
  };

  // Mint NFTs for ALL participating players at game conclusion. Every
  // player in the recorder's playerList snapshot is eligible for an NFT
  // regardless of win or lose. Each player gets a MintAttempt recorded
  // with one of three explicit outcomes: no wallet address supplied ->
  // #skipped, mint succeeded -> #succeeded, mint failed -> #failed.
  // There are NO silent skips. Mint failures for one player do not
  // block the game conclusion or other players' mints.
  //
  // This is the public entrypoint the backend canister calls at game
  // conclusion (after the recorder has snapshotted the playerList). It
  // reads the recorder's concluded result, endState, playerList, and
  // move count, plus the final board state from gameState and the
  // current game number from gameState, and delegates to
  // Nft.mintForEligiblePlayers. No manual trigger (the doNotBuild
  // contract excludes a manual re-mint trigger button); minting is
  // automatic at game conclusion.
  //
  // No-op if the recorder has not concluded a game (no result / endState
  // / playerList to mint for). This keeps the call safe to invoke from
  // any game-end path without the caller needing to check recorder state
  // first.
  public func mintGameNfts() : async () {
    // Only mint when the recorder has concluded a game.
    if (not recorder.concluded) {
      Debug.print("[nft] mintGameNfts: recorder not concluded, skipping");
      return;
    };
    let result = switch (recorder.result) {
      case null {
        Debug.print("[nft] mintGameNfts: no result, skipping");
        return;
      };
      case (?r) r;
    };
    let endState = switch (recorder.endState) {
      case null {
        Debug.print("[nft] mintGameNfts: no endState, skipping");
        return;
      };
      case (?e) e;
    };
    Debug.print("[nft] mintGameNfts: starting mint for concluded game");
    let finalBoardState = Nft.encodeFinalBoardState(gameState.board);
    let moveCount = recorder.moves.size();
    // Use the recorder's snapshot timestamp. The recorder does not store
    // a conclusion timestamp directly, but the moves array's last entry
    // (if any) carries a timestamp; fall back to 0 if there are no moves.
    let concludedAt : Types.Timestamp = if (moveCount == 0) {
      0;
    } else {
      recorder.moves[moveCount - 1].timestamp;
    };
    // Thread the current game number from gameState into the mint so
    // every NFT carries the game number it was minted for (alongside
    // the spell ID), enabling a future block-resolution comparison.
    let gameNumber = gameState.gameNumber;
    // Guaranteed tier: every guaranteed entry with a verified bet and a
    // recorded wallet receives an NFT, read from the guaranteed entry itself
    // rather than the player row. Additive and not part of the 10-NFT cap.
    let guaranteedEntries = Guaranteed.eligibleEntries(guaranteedStore);
    let guaranteedUsernames = Guaranteed.eligibleUsernames(guaranteedStore);
    await Nft.mintGuaranteedEntries(
      nftStore,
      result,
      endState,
      finalBoardState,
      guaranteedEntries,
      moveCount,
      concludedAt,
      gameNumber,
    );
    // Explicitly exclude the bot from the capped pool before delegating.
    // This is on top of (not a replacement for) any incidental exclusion
    // that already follows from the bot having no wallet address — the bot
    // must never receive an NFT even if that incidental condition changes.
    let eligiblePlayerList = recorder.playerList.filter(func entry = not isBotEntry(entry));
    // Guaranteed-tier players are excluded from the capped pool: they are
    // minted by the separate guaranteed tier, which is additive and does not
    // consume the 10-NFT cap.
    await Nft.mintForEligiblePlayers(
      nftStore,
      result,
      endState,
      finalBoardState,
      eligiblePlayerList,
      moveCount,
      concludedAt,
      gameNumber,
      guaranteedUsernames,
    );
    Debug.print("[nft] mintGameNfts: mint complete");
  };

  // Clear all mint-attempt records. Retained as an explicit endpoint, but
  // the new-game start path no longer calls it: mint attempts are retained
  // across games, capped at the 10 most recent distinct game numbers.
  // Diagnostic-only — never surfaced to the game UI. Does NOT clear minted
  // NFTs (they are permanent) or reset the nextTokenId counter.
  public func clearNftMintAttempts() : async () {
    Nft.clearMintAttempts(nftStore);
  };

  // Truly destroy one or more NFTs by calling the collection canister's
  // vec-shaped `icrc7_burn` directly as this backend's own principal. The
  // backend is authorized to burn through the allowlisted-admin path, so no
  // player signature, signer, or wallet mediation is involved and no
  // ICRC-37 spender approval is required. The burn is submitted as a single
  // batch — one `BurnArg{ memo; token_ids }` request carrying every token id.
  //
  // The spell name and game number are read from the ledger BEFORE the burn,
  // because the burn destroys the token; a legacy token with no usable
  // metadata still burns and is reported as #burnedLegacy(reason), where the
  // reason distinguishes a failed read from genuinely absent keys. Returns one
  // BurnOutcome per requested token id, in the same order as the input list.
  // This is an update call (it performs inter-canister calls), not a query.
  public func burnNfts(tokenIds : [Nat]) : async [Types.BurnOutcome] {
    await Nft.burnNfts(tokenIds);
  };

  // Truly destroy one NFT through the same direct, admin-authorized batch
  // path. Single-token convenience entry point; delegates to burnNfts.
  public func burnNft(tokenId : Nat) : async Types.BurnOutcome {
    await Nft.burnNft(tokenId);
  };

  // ---------- Query methods for the frontend ----------

  // Return the metadata for a given tokenId, or null if no such token
  // exists. Read-only query so the frontend can read NFT metadata for
  // display.
  public query func getNftMetadata(tokenId : Nat) : async ?Types.MintMetadata {
    Nft.getNftMetadata(nftStore, tokenId);
  };

  // Batched metadata fetch: return the metadata for every requested token
  // id in a single response, in the same order as the input list. Each
  // entry is null when the token id is not present in the local cache.
  //
  // This is a read-only query: the body delegates to the pure synchronous
  // helper Nft.getNftMetadataBatch, which reads the local nfts cache with
  // no await, no inter-canister call, and no state mutation. The token ids
  // are processed sequentially inside the canister and the full array is
  // returned in one response. The existing getNftMetadata stays for
  // compatibility.
  public query func getNftMetadataBatch(
    tokenIds : [Nat],
  ) : async [?Types.MintMetadata] {
    Nft.getNftMetadataBatch(nftStore, tokenIds);
  };

  // Return the list of token ids owned by the given owner. The owner is
  // the wallet address text (principal or account ID text form) the
  // frontend has for the current player. For principal textual form, an
  // ICRC-7 Account is constructed (owner=Principal.fromText, subaccount=
  // null) and the real canister's `icrc7_tokens_of` is queried, falling
  // back to the local nfts cache on canister error. For 64-char hex
  // Account IDs, the local fallback is returned directly (cannot
  // construct an Account from a hex account id without the original
  // principal). Returns an empty array if the address is invalid or the
  // owner has no NFTs. Note: this is now an `async` query (not a `query`
  // func) because the canister query is an inter-canister call — query
  // funcs cannot make inter-canister calls. The public Candid signature
  // `(text) -> (vec nat)` is preserved (only the query annotation is
  // dropped, which bindgen regenerates).
  public func getNftsForOwner(owner : Text) : async [Nat] {
    if (owner.isEmpty()) return [];
    try {
      let principal = Principal.fromText(owner);
      // The principal-textual path: query the real canister via the lib
      // helper, which already falls back to the local nfts cache on
      // canister error. Wrap in its own try/catch so an unexpected trap
      // (e.g. an unforeseen inter-canister edge case) returns [] rather
      // than propagating to the caller.
      try {
        await Nft.getNftsForOwner(nftStore, principal);
      } catch _ {
        [];
      };
    } catch _ {
      // owner is not a principal textual form (e.g. a 64-char hex Account
      // ID) — return []. We cannot construct an ICRC-7 Account from a hex
      // account id without the original principal, so the canister query is
      // not possible; the local cache is keyed by Principal and cannot match
      // a hex account ID either, so [] is the only correct answer.
      [];
    };
  };

  // Return the most recent mint outcome for a player identified by their
  // wallet address text, or null if no mint attempt has been recorded for
  // that address in the current/just-concluded game. Read-only query so
  // the frontend can poll mint status for the current player.
  public query func getMintStatusForPlayer(
    walletAddress : Text,
  ) : async ?Types.MintOutcome {
    let result = Nft.getMintStatusForPlayer(nftStore, walletAddress);
    switch (result) {
      case null Debug.print("[nft] getMintStatusForPlayer: walletAddress=" # walletAddress # " result=null");
      case (?o) Debug.print("[nft] getMintStatusForPlayer: walletAddress=" # walletAddress # " result=found");
    };
    result;
  };

  // Return ALL players' mint statuses for the current/just-concluded
  // game as a list of { username; walletAddress; team; outcome }. This
  // exists because getMintStatusForPlayer(walletAddress) cannot look up
  // players who had no wallet address (null wallet can't be a lookup
  // key). This query returns every player who has a MintAttempt
  // recorded, including those with null wallet addresses. Read-only
  // query so the frontend can render per-player mint status at game
  // conclusion.
  public query func getMintStatusesForGame() : async [Types.MintStatusEntry] {
    Nft.getMintStatusesForGame(nftStore);
  };

  // Return the retained mint attempts grouped by game, most recent game
  // first. Each group carries the game number and every retained attempt
  // recorded for that game, in append order. The log is retained across
  // games (capped at the 10 most recent distinct game numbers), so the
  // frontend can show the current game's attempts and confirm retention
  // across games. Read-only query so the frontend can poll it.
  public query func getMintAttemptsByGame() : async [Types.MintAttemptGroup] {
    Nft.getMintAttemptsByGame(nftStore);
  };

  // Return the stored spell name for a given game/wallet from the durable
  // NftRecord, or null if no NFT was minted for that game and wallet. The
  // spell name is captured at mint time and persisted in the NftRecord (which
  // survives new game starts — only mintAttempts are cleared), so the game
  // conclusion modal can read it directly instead of reconstructing it through a
  // fragile wallet-address lookup. Read-only query so the frontend modal can
  // display the spell name for the current player's just-concluded game.
  public query func getSpellNameForGame(
    gameNumber : Nat,
    walletAddress : Text,
  ) : async ?Text {
    Nft.getSpellNameForGame(nftStore, gameNumber, walletAddress);
  };
};
