import Array "mo:core/Array";

module {
  // Fourteenth migration — adds an `effect : BurnEffect` field to
  // MintMetadata.
  //
  // MintMetadata is embedded in NftRecord (NftRecord.metadata : MintMetadata),
  // and NftRecord is stored in the stable nfts array (NftStore.nfts :
  // [var NftRecord]). Adding a required field to MintMetadata changes the
  // stored shape of every NftRecord, so this is NOT a stable-compatible
  // widening — an explicit migration is required to rebuild each stored
  // NftRecord with the new metadata shape (adding `effect = #none` to each
  // existing record's metadata).
  //
  // The actual burn-effect gameplay design is deferred (doNotBuild contract);
  // `#none` is the safe default for all pre-existing NFTs (they predate the
  // effect field and carry no burn effect). New mints select a placeholder
  // tier via the weighted randomizer in lib/nft.mo.
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260808_000000.mo) exactly — MintMetadata is the OLD 10-field shape
  // (no `effect` field). NewActor is identical except MintMetadata is the
  // NEW 11-field shape (adds `effect : BurnEffect`), and the inlined
  // BurnEffect type is added. All other state (gameState, players, chat,
  // recorder, exerciseStore, drinkingStore) copies through unchanged; only
  // nftStore.nfts is rebuilt element-by-element to add `effect = #none` to
  // each record's metadata. mops.toml sets check-limit = 1, so only this
  // latest migration runs against deployed state.

  type Team = { #White; #Black };
  type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };
  type Piece = { pieceType : PieceType; color : Team };
  type GamePhase = { #Playing; #Celebration; #Draw; #Paused };
  type PseudoPrincipal = Text;
  type Timestamp = Int;

  // TriggerType matches the NewTriggerType in 20260808_000000.mo (4 variants,
  // including #Check). Unchanged by this migration.
  type TriggerType = { #Capture; #EnPassant; #Castling; #Check };

  type ChatMessage = {
    sender : PseudoPrincipal;
    username : Text;
    text : Text;
    timestamp : Timestamp;
  };
  // Player matches the Player type in 20260808_000000.mo exactly (7 fields,
  // including isFresh). Unchanged by this migration.
  type Player = {
    principal : PseudoPrincipal;
    var username : Text;
    var team : Team;
    var lastPing : Timestamp;
    var isMoveMaker : Bool;
    var walletAddress : ?Text;
    var isFresh : Bool;
  };
  // GameState matches the NewGameState in 20260808_000000.mo exactly (9 var
  // fields, including openingName : ?Text). Unchanged by this migration.
  type GameState = {
    var board : [?Piece];
    var currentTurn : Team;
    var turnStartTime : Timestamp;
    var turnTimeLimitMs : Nat;
    var moveMakerPrincipal : ?PseudoPrincipal;
    var gamePhase : GamePhase;
    var celebrationEndTime : ?Timestamp;
    var winner : ?Team;
    var openingName : ?Text;
  };
  type PlayerStore = { var items : [var Player] };
  type ChatStore = { var items : [var ChatMessage] };

  type GameResult = { #WhiteWin; #BlackWin; #Draw };
  type EndState = { #Checkmate; #Stalemate; #Draw; #Timeout };
  type RecordedMove = {
    index : Nat;
    username : Text;
    team : Team;
    fromSquare : Nat;
    toSquare : Nat;
    notation : Text;
    gaveCheck : Bool;
    capturedPiece : ?PieceType;
    isCastling : Bool;
    promotion : ?PieceType;
    isEnPassant : Bool;
    timestamp : Timestamp;
  };
  type PlayerListEntry = {
    listPosition : Nat;
    principal : PseudoPrincipal;
    username : Text;
    team : Team;
    walletAddress : ?Text;
  };
  type TeamRoster = {
    team : Team;
    members : [PlayerListEntry];
    count : Nat;
  };
  // RecorderStore matches the NewRecorderStore in 20260808_000000.mo exactly
  // (10 var fields, including finalBoard). Unchanged by this migration.
  type FinalBoardState = [?Text];
  type RecorderStore = {
    var moves : [var RecordedMove];
    var playerList : [PlayerListEntry];
    var rosters : [TeamRoster];
    var result : ?GameResult;
    var endState : ?EndState;
    var finalMovePlayerOnTimeout : ?Text;
    var active : Bool;
    var concluded : Bool;
    var openingName : Text;
    var finalBoard : FinalBoardState;
  };

  // Exercise-domain types (inlined — migrations must be self-contained).
  // Matches the NewExerciseAssignment in 20260808_000000.mo (with the 4-variant
  // TriggerType). Unchanged by this migration.
  type ExerciseKind = {
    #PushUps;
    #Squats;
    #Crunches;
    #NinjaRoll;
    #Cartwheel;
  };
  type ExerciseAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    reps : Nat;
    exercise : ExerciseKind;
    timestamp : Timestamp;
    trigger : ?TriggerType;
  };
  type ExerciseStore = { var items : [var ExerciseAssignment] };

  // Drinking-domain types (inlined — migrations must be self-contained).
  // Matches the NewDrinkingAssignment in 20260808_000000.mo (with the 4-variant
  // TriggerType). Unchanged by this migration.
  type DrinkingAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    drinks : Nat;
    timestamp : Timestamp;
    trigger : ?TriggerType;
  };
  type DrinkingStore = { var items : [var DrinkingAssignment] };

  // NFT-domain types (inlined — migrations must be self-contained).
  type RecipientRole = { #Winner; #Drawer };

  // BurnEffect — the new placeholder burn-effect tier type. Inlined here
  // because migrations must be self-contained. Matches types/nft.mo.
  type BurnEffect = {
    #none;
    #minor;
    #major;
  };

  // OLD MintMetadata — 10 fields, NO `effect` field. Matches the MintMetadata
  // in 20260808_000000.mo exactly.
  type OldMintMetadata = {
    gameResult : GameResult;
    endState : EndState;
    finalBoardState : FinalBoardState;
    recipientRole : RecipientRole;
    recipientTeam : Team;
    recipientUsername : Text;
    recipientWalletAddress : Text;
    moveCount : Nat;
    concludedAt : Timestamp;
  };
  // NEW MintMetadata — 11 fields, adds `effect : BurnEffect`. Matches
  // types/nft.mo.
  type NewMintMetadata = {
    gameResult : GameResult;
    endState : EndState;
    finalBoardState : FinalBoardState;
    recipientRole : RecipientRole;
    recipientTeam : Team;
    recipientUsername : Text;
    recipientWalletAddress : Text;
    moveCount : Nat;
    concludedAt : Timestamp;
    effect : BurnEffect;
  };
  type OldNftRecord = {
    tokenId : Nat;
    owner : Principal;
    metadata : OldMintMetadata;
    mintedAt : Timestamp;
  };
  type NewNftRecord = {
    tokenId : Nat;
    owner : Principal;
    metadata : NewMintMetadata;
    mintedAt : Timestamp;
  };
  type MintOutcome = {
    #succeeded : { tokenId : Nat };
    #skipped : Text;
    #failed : Text;
  };
  type MintAttempt = {
    id : Nat;
    recipientWalletAddress : Text;
    recipientUsername : Text;
    recipientTeam : Team;
    recipientRole : RecipientRole;
    outcome : MintOutcome;
    attemptedAt : Timestamp;
  };
  type OldNftStore = {
    var nextTokenId : Nat;
    var nfts : [var OldNftRecord];
    var nextMintAttemptId : Nat;
    var mintAttempts : [var MintAttempt];
  };
  type NewNftStore = {
    var nextTokenId : Nat;
    var nfts : [var NewNftRecord];
    var nextMintAttemptId : Nat;
    var mintAttempts : [var MintAttempt];
  };

  // OldActor matches the NewActor of the preceding migration
  // (20260808_000000.mo) exactly — MintMetadata is the OLD 10-field shape
  // (no `effect` field), so nftStore.nfts carries the old (narrower)
  // MintMetadata shape.
  type OldActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : OldNftStore;
  };

  // NewActor is identical except MintMetadata is the NEW 11-field shape
  // (adds `effect : BurnEffect`), so nftStore.nfts carries the new (wider)
  // MintMetadata shape.
  type NewActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NewNftStore;
  };

  public func migration(old : OldActor) : NewActor {
    // Rebuild nftStore.nfts element-by-element, widening each record's
    // metadata from OldMintMetadata (10 fields) to NewMintMetadata (11
    // fields) by adding `effect = #none`. The mutable array `[var ...]`
    // does not subtype through the record-field widening in a plain
    // migration-body assignment, so we rebuild via Array.fromVarArray +
    // map + toVarArray. All other NftStore state (nextTokenId,
    // nextMintAttemptId, mintAttempts) copies through unchanged. All other
    // actor state (gameState, players, chat, recorder, exerciseStore,
    // drinkingStore) copies through unchanged.
    let oldNfts = Array.fromVarArray(old.nftStore.nfts);
    let newNfts = oldNfts.map(
      func(r) {
        {
          tokenId = r.tokenId;
          owner = r.owner;
          metadata = {
            gameResult = r.metadata.gameResult;
            endState = r.metadata.endState;
            finalBoardState = r.metadata.finalBoardState;
            recipientRole = r.metadata.recipientRole;
            recipientTeam = r.metadata.recipientTeam;
            recipientUsername = r.metadata.recipientUsername;
            recipientWalletAddress = r.metadata.recipientWalletAddress;
            moveCount = r.metadata.moveCount;
            concludedAt = r.metadata.concludedAt;
            effect = #none;
          } : NewMintMetadata;
          mintedAt = r.mintedAt;
        } : NewNftRecord;
      }
    );
    let newNftStore : NewNftStore = {
      var nextTokenId = old.nftStore.nextTokenId;
      var nfts = newNfts.toVarArray();
      var nextMintAttemptId = old.nftStore.nextMintAttemptId;
      var mintAttempts = old.nftStore.mintAttempts;
    };

    {
      var gameState = old.gameState;
      players = old.players;
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      nftStore = newNftStore;
    };
  };
};
