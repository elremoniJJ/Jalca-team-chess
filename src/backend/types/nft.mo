import Common "common";

module {
  // Re-export shared types for convenience.
  public type PseudoPrincipal = Common.PseudoPrincipal;
  public type Timestamp = Common.Timestamp;

  // The two teams/sides in a chess game (mirrored from chess-game for the
  // NFT domain's self-contained type surface).
  public type Team = {
    #White;
    #Black;
  };

  // The result of a concluded game (mirrored from game-recorder).
  public type GameResult = {
    #WhiteWin;
    #BlackWin;
    #Draw;
  };

  // The end state of a concluded game (mirrored from game-recorder).
  public type EndState = {
    #Checkmate;
    #Stalemate;
    #Draw;
    #Timeout;
    #InsufficientMaterial;
  };

  // The recipient's role in the concluded game, derived from the game
  // result and the recipient's team. Encoded into the NFT metadata so each
  // NFT is a verifiable game artifact distinguishing winners from drawers.
  public type RecipientRole = {
    #Winner;
    #Drawer;
  };

  // A snapshot of a player's position in the Logged_In_List at game
  // conclusion (mirrored from game-recorder). Carries the walletAddress
  // used to determine mint eligibility and the mint recipient.
  public type PlayerListEntry = {
    listPosition : Nat;
    principal : PseudoPrincipal;
    username : Text;
    team : Team;
    walletAddress : ?Text;
  };

  // The final board state of a concluded game, encoded square-by-square.
  // Each square is either null (empty) or a piece encoded as a short text
  // token (e.g. "wP" for white pawn, "bK" for black king). Stored in the
  // NFT metadata so the NFT is a verifiable game artifact.
  public type FinalBoardState = [?Text];

  // A single entry in the 11-spell lookup table mapping spell ID (1-11) to
  // its Name, Meaning, and Spell description. The full table is defined in
  // lib/nft.mo (a module constant — static data, not stable state) and is
  // exposed to the frontend via the getSpellTable query so the frontend can
  // verify its own copy of the table. The NFT metadata carries only the
  // spell ID (1-11) plus the game number — the full spell text is looked up
  // from this table, never stored in the NFT metadata (per the user
  // preference: NFT metadata stores spell ID + game number only).
  public type SpellEntry = {
    // The spell ID (1-11).
    id : Nat;
    // The spell's name (e.g. "Newkai Dodan").
    name : Text;
    // The spell's meaning (e.g. "Queen horse").
    meaning : Text;
    // The spell's full description (e.g. "Spell turns the opponent's queen
    // into a horse (knight)").
    spell : Text;
  };

  // The mint metadata encoded into each NFT. JSON-only for v1 (no image
  // generation). Encodes the game result, final board state, and the
  // recipient's role (winner/drawer) so each NFT is a verifiable game
  // artifact. The `gameNumber` field carries the sequential game number
  // the NFT was minted for.
  public type MintMetadata = {
    // The game result (which team won, or draw).
    gameResult : GameResult;
    // The end state (checkmate, stalemate, draw, timeout).
    endState : EndState;
    // The final board state, square-by-square (64 entries, a1=0..h8=63).
    finalBoardState : FinalBoardState;
    // The recipient's role in the concluded game.
    recipientRole : RecipientRole;
    // The recipient's team.
    recipientTeam : Team;
    // The recipient's username at game conclusion.
    recipientUsername : Text;
    // The recipient's Oisy wallet address (principal or account ID text
    // form) the NFT is minted and assigned to.
    recipientWalletAddress : Text;
    // The total number of moves in the concluded game.
    moveCount : Nat;
    // The timestamp at which the game concluded (ns, mo:core/Time).
    concludedAt : Timestamp;
    // The sequential game number (starting at #1) the NFT was minted for.
    gameNumber : Nat;
    // The id of the spell reward rolled for this player at game end. The
    // single uniform draw's outcome bucket (Nothing / Subao Ve / Basic /
    // Skilled / Advanced / Mastery / OP) determines which spell the player
    // receives; the chosen spell's id is threaded into the NFT metadata so
    // the game-end spell reward is a verifiable part of the minted artifact.
    // The full spell text is looked up from the spell table, never stored in
    // the NFT metadata.
    spellId : Nat;
    // The name of the spell reward rolled for this player at game end,
    // captured at mint time and persisted in the durable NftRecord so the game
    // conclusion modal can read the stored spell name directly instead of
    // reconstructing it through a fragile wallet-address lookup. The name is
    // resolved from the spell table at mint time (from the rolled spellId) and
    // stored alongside the game number and wallet address. Unlike the per-game
    // mintAttempts (cleared at new-game start), the NftRecord persists across
    // new game starts, so this field is the durable home for the spell name.
    spellName : Text;
  };

  // A minted NFT record stored in the backend canister's NFT stable store.
  // The NFT is minted locally (no inter-canister call): ownership is
  // assigned to the Principal parsed from the recipient's wallet address,
  // and the metadata is stored alongside it. This keeps the NFT domain
  // fully isolated from chess logic, game recording, and login — a bug in
  // minting cannot corrupt any other domain because they share no mutable
  // state.
  public type NftRecord = {
    // Monotonic token id (0, 1, 2, ...).
    tokenId : Nat;
    // The owner Principal parsed from the recipient's wallet address at
    // mint time.
    owner : Principal;
    // The mint metadata encoded into the NFT.
    metadata : MintMetadata;
    // The timestamp at which the NFT was minted (ns, mo:core/Time).
    mintedAt : Timestamp;
  };

  // The mint request passed to the local mint function. The backend
  // canister mints the NFT locally (no inter-canister call) and assigns
  // ownership to the recipientWalletAddress parsed into a Principal. The
  // app canister bears the minting cost (cycles) — the backend never sends
  // cycles outward.
  public type MintRequest = {
    // The recipient's Oisy wallet address (principal or account ID text
    // form). Parsed to a Principal for ownership assignment. Invalid/typo'd
    // addresses are silently skipped (the mint returns #skipped without
    // trapping).
    recipientWalletAddress : Text;
    // The mint metadata encoded into the NFT.
    metadata : MintMetadata;
  };

  // The result of a mint call. Silent-skip semantics: an invalid wallet
  // address or a mint failure for one player returns #skipped (or #failed)
  // without trapping, so a mint failure for one player does not block the
  // game conclusion or other players' mints.
  public type MintResult = {
    #ok : { tokenId : Nat };
    #skipped : Text;
    #failed : Text;
  };

  // Mutable record cell wrapping the NFT-domain stable state. The backend
  // tracks mint outcomes per concluded game AND stores the minted NFTs
  // themselves so a mint failure for one player is recorded without
  // blocking the game conclusion or other players' mints, and the frontend
  // can query mint status and NFT metadata for the current player.
  // Mirrors the PlayerStore/RecorderStore mutable-record-cell
  // pattern.
  //
  // The NFTs are stored in a mutable var-array of NftRecord (keyed by
  // tokenId, which is the array index). The nextTokenId counter allocates
  // monotonic token ids. The mintAttempts array tracks per-player mint
  // outcomes across games, retained (capped at the 10 most recent distinct
  // game numbers) so the frontend can show the current game's attempts and
  // confirm retention across games.
  public type NftStore = {
    // Monotonic counter for the next token id.
    var nextTokenId : Nat;
    // The minted NFT records, in mint order. tokenId == array index.
    var nfts : [var NftRecord];
    // Monotonic counter for the next mint-attempt record id.
    var nextMintAttemptId : Nat;
    // The accumulated mint-attempt records, retained across games and
    // capped at the 10 most recent distinct game numbers.
    var mintAttempts : [var MintAttempt];
  };

  // A single mint-attempt record, tracking the outcome of one player's
  // mint at game conclusion. Used for diagnostics and for the frontend's
  // mint-status poll (getMintStatusForPlayer). Never surfaced as an error
  // to the game UI (silent-skip semantics).
  //
  // Attempts are retained across games (capped at the 10 most recent
  // distinct game numbers) so the frontend can show the current game's
  // attempts and confirm retention across games. The `gameNumber` field is
  // the grouping key: it is the sequential game number the attempt belongs
  // to, populated at append time.
  public type MintAttempt = {
    // Monotonic id (0, 1, 2, ...).
    id : Nat;
    // The sequential game number this attempt belongs to. The grouping key
    // for retention (the 10 most recent distinct game numbers are kept).
    gameNumber : Nat;
    // The recipient's wallet address the mint was attempted for.
    recipientWalletAddress : Text;
    // The recipient's username at game conclusion.
    recipientUsername : Text;
    // The recipient's team at game conclusion.
    recipientTeam : Team;
    // The recipient's role in the concluded game.
    recipientRole : RecipientRole;
    // The outcome of the mint attempt.
    outcome : MintOutcome;
    // The timestamp at which the mint was attempted (ns, mo:core/Time).
    attemptedAt : Timestamp;
  };

  // The outcome of a single mint attempt.
  public type MintOutcome = {
    #succeeded : { tokenId : Nat };
    #skipped : Text;
    #failed : Text;
  };

  // Why a burned token was classified as legacy (no usable spell). Carried on
  // the #burnedLegacy outcome so the caller can distinguish a transient
  // metadata read failure from a genuinely keyless token, and can surface the
  // specific reason wherever the outcome is displayed. Serializable in Candid.
  //   - #readFailed: the pre-burn metadata read failed, trapped, or returned
  //     no entry for the token, so the keys could not be read. The token was
  //     still burned (the burn is never aborted by a read failure).
  //   - #keysAbsent: the metadata was read successfully but carried neither
  //     jalca:spell_name nor jalca:game_number — a genuinely legacy token.
  //   - #wrongType: a key was present but its value was not the expected type
  //     (jalca:spell_name must be Text, jalca:game_number must be Nat).
  //   - #keysDisagree: exactly one of the two keys was present, so the pair
  //     does not agree (both are required for a usable spell).
  public type LegacyReason = {
    #readFailed;
    #keysAbsent;
    #wrongType;
    #keysDisagree;
  };

  // The outcome of a true ICRC-7 burn of one NFT. Distinguishes the three
  // cases the caller must render differently:
  //   - #burnedWithSpell: the token was destroyed AND its on-chain metadata
  //     carried a usable spell (jalca:spell_name + jalca:game_number), which
  //     is returned so the caller can apply the spell.
  //   - #burnedLegacy: the token was destroyed but carried no usable spell
  //     metadata (a legacy token) — it burns inert. Carries the specific
  //     LegacyReason so the caller can distinguish a transient read failure
  //     from genuinely absent keys.
  //   - #failed: the burn did not happen; the reason is a short human-readable
  //     message (canister error or trapped call).
  public type BurnOutcome = {
    #burnedWithSpell : { spellName : Text; gameNumber : Nat };
    #burnedLegacy : LegacyReason;
    #failed : Text;
  };

  // A single player's mint status entry for the current/just-concluded
  // game, returned by getMintStatusesForGame. Carries the player's
  // username, optional wallet address, team, and the outcome of their
  // mint attempt (null if no attempt has been recorded for them yet).
  // This query exists because getMintStatusForPlayer(walletAddress)
  // cannot look up players who had no wallet address (null wallet can't
  // be a lookup key); getMintStatusesForGame returns every player who
  // has a MintAttempt recorded, including those with null wallets.
  public type MintStatusEntry = {
    username : Text;
    walletAddress : ?Text;
    team : Team;
    outcome : ?MintOutcome;
  };

  // The retained mint attempts for one game, returned by
  // getMintAttemptsByGame. Carries the game number (the grouping key) and
  // every retained attempt recorded for that game, in append order. The
  // frontend uses this to show the current game's attempts and to confirm
  // retention across games.
  public type MintAttemptGroup = {
    gameNumber : Nat;
    attempts : [MintAttempt];
  };
};
