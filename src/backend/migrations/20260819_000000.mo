import Array "mo:core/Array";

module {
  // Eighteenth migration — widens `GameState` with two new fields
  // (`var gameNumber : Nat` and `var gameMode : GameMode`) and rebuilds
  // `nftStore.nfts` element-by-element replacing the old `effect : BurnEffect`
  // field on each `MintMetadata` with `spellId = 1` and `gameNumber = 0`
  // defaults.
  //
  // This change drives the migration:
  //
  //   (1) Widening `GameState` with `var gameNumber : Nat` and
  //   `var gameMode : GameMode` is NOT a stable-compatible widening —
  //   `GameState` is stored in the stable `gameState` actor field, and
  //   adding required fields to a record stored as a stable var changes
  //   its stored shape. The migration rebuilds `gameState` field-by-field
  //   copying each existing field and adding `var gameNumber = 0` and
  //   `var gameMode = #Normal`. Pre-existing games predate the
  //   numbering/mode cycle, so they default to game #0 (no game completed
  //   yet) and #Normal mode (the cycle starts at Normal).
  //
  //   (2) Replacing `effect : BurnEffect` with `spellId : Nat` and
  //   `gameNumber : Nat` on `MintMetadata` is NOT a stable-compatible
  //   change — `MintMetadata` is stored in the stable
  //   `nftStore.nfts : [var NftRecord]` array (each NftRecord carries a
  //   `metadata : MintMetadata`). Removing the `effect` field and adding
  //   two required fields changes the stored shape of every element. The
  //   migration rebuilds `nftStore.nfts` element-by-element, copying each
  //   existing NftRecord field and rebuilding `metadata` field-by-field
  //   replacing `effect` with `spellId = 1` (the default spell ID —
  //   pre-existing NFTs predate the spell-ID randomizer, so they default
  //   to spell ID 1) and `gameNumber = 0` (pre-existing NFTs predate the
  //   game-number tracking, so they default to game #0).
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260818_000000.mo) exactly — 7 actor fields, `Player` is the
  // 8-var-field shape (with `walletSource`), `GameState` is the 9-var-field
  // shape (NO `gameNumber`/`gameMode`), and `MintMetadata` is the
  // 10-field shape with `effect : BurnEffect` (NO `spellId`/`gameNumber`).
  // NewActor is identical except `gameState` carries the NEW 11-var-field
  // GameState shape (adds `var gameNumber : Nat` and `var gameMode :
  // GameMode`) and `nftStore.nfts` carries the NEW 11-field MintMetadata
  // shape (replaces `effect : BurnEffect` with `spellId : Nat` and
  // `gameNumber : Nat`). All other state (players, chat, recorder,
  // exerciseStore, drinkingStore) copies through unchanged. mops.toml
  // sets check-limit = 1, so only this latest migration runs against
  // deployed state.

  type Team = { #White; #Black };
  type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };
  type Piece = { pieceType : PieceType; color : Team };
  type GamePhase = { #Playing; #Celebration; #Draw; #Paused };
  type PseudoPrincipal = Text;
  type Timestamp = Int;

  // GameMode — the four game modes that cycle once per completed game in
  // the fixed order: Normal -> Random Opening -> Merlin -> Merlin Rematch
  // -> back to Normal. Game #1 is Normal. New type introduced by this
  // migration.
  type GameMode = {
    #Normal;
    #RandomOpening;
    #Merlin;
    #MerlinRematch;
  };

  // TriggerType matches the NewTriggerType in 20260812_000000.mo (4
  // variants, including #Check). Unchanged by this migration.
  type TriggerType = { #Capture; #EnPassant; #Castling; #Check };

  // WalletSource — matches 20260818_000000.mo. Unchanged by this migration.
  type WalletSource = { #none; #typed; #oisy };

  type ChatMessage = {
    sender : PseudoPrincipal;
    username : Text;
    text : Text;
    timestamp : Timestamp;
  };

  // Player — 8 var fields, with `walletSource`. Matches the NewPlayer in
  // 20260818_000000.mo exactly. Unchanged by this migration.
  type Player = {
    principal : PseudoPrincipal;
    var username : Text;
    var team : Team;
    var lastPing : Timestamp;
    var isMoveMaker : Bool;
    var walletAddress : ?Text;
    var walletSource : WalletSource;
    var isFresh : Bool;
  };
  type PlayerStore = { var items : [var Player] };
  type ChatStore = { var items : [var ChatMessage] };

  // OLD GameState — 9 var fields, NO `gameNumber`/`gameMode`. Matches the
  // GameState in 20260818_000000.mo exactly.
  type OldGameState = {
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
  // NEW GameState — 11 var fields, adds `var gameNumber : Nat` and
  // `var gameMode : GameMode`. Matches the widened GameState shape the
  // chess mixin expects.
  type NewGameState = {
    var board : [?Piece];
    var currentTurn : Team;
    var turnStartTime : Timestamp;
    var turnTimeLimitMs : Nat;
    var moveMakerPrincipal : ?PseudoPrincipal;
    var gamePhase : GamePhase;
    var celebrationEndTime : ?Timestamp;
    var winner : ?Team;
    var openingName : ?Text;
    var gameNumber : Nat;
    var gameMode : GameMode;
  };

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
  // RecorderStore matches the NewRecorderStore in 20260812_000000.mo
  // exactly (10 var fields, including finalBoard). Unchanged by this
  // migration.
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
  // Matches the NewExerciseAssignment in 20260812_000000.mo (with the
  // 4-variant TriggerType). Unchanged by this migration.
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
  // Matches the NewDrinkingAssignment in 20260812_000000.mo (with the
  // 4-variant TriggerType). Unchanged by this migration.
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
  // RecipientRole matches 20260818_000000.mo. Unchanged by this migration.
  type RecipientRole = { #Winner; #Drawer };

  // OLD BurnEffect — the retired variant. Matches the BurnEffect in
  // 20260818_000000.mo exactly. Consumed in OldMintMetadata below.
  type BurnEffect = {
    #none;
    #minor;
    #major;
  };

  // OLD MintMetadata — 10 fields, with `effect : BurnEffect` and NO
  // `spellId`/`gameNumber`. Matches the MintMetadata in 20260818_000000.mo
  // exactly.
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
    effect : BurnEffect;
  };
  // NEW MintMetadata — 11 fields, replaces `effect : BurnEffect` with
  // `spellId : Nat` and `gameNumber : Nat`. Matches the widened
  // MintMetadata shape the NFT lib expects.
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
    spellId : Nat;
    gameNumber : Nat;
  };
  // NftRecord — the metadata field widens from OldMintMetadata to
  // NewMintMetadata. The other three fields (tokenId, owner, mintedAt) are
  // unchanged.
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
  // OldNftStore / NewNftStore — the `nfts` field widens from
  // [var OldNftRecord] to [var NewNftRecord]. The other three fields are
  // unchanged.
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
  // (20260818_000000.mo) exactly — 7 actor fields, `gameState` carries
  // the OLD 9-var-field GameState shape (NO `gameNumber`/`gameMode`),
  // and `nftStore.nfts` carries the OLD 10-field MintMetadata shape
  // (with `effect : BurnEffect`).
  type OldActor = {
    var gameState : OldGameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : OldNftStore;
  };

  // NewActor is identical except `gameState` carries the NEW 11-var-field
  // GameState shape (adds `var gameNumber : Nat` and `var gameMode :
  // GameMode`) and `nftStore.nfts` carries the NEW 11-field MintMetadata
  // shape (replaces `effect : BurnEffect` with `spellId : Nat` and
  // `gameNumber : Nat`).
  type NewActor = {
    var gameState : NewGameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NewNftStore;
  };

  public func migration(old : OldActor) : NewActor {
    // Rebuild gameState field-by-field, widening OldGameState (9 var
    // fields) to NewGameState (11 var fields) by adding
    // `var gameNumber = 0` and `var gameMode = #Normal`. Pre-existing
    // games predate the numbering/mode cycle, so they default to game #0
    // (no game completed yet) and #Normal mode (the cycle starts at
    // Normal). Records with var fields cannot use record spread, so we
    // rebuild explicitly.
    let newGameState : NewGameState = {
      var board = old.gameState.board;
      var currentTurn = old.gameState.currentTurn;
      var turnStartTime = old.gameState.turnStartTime;
      var turnTimeLimitMs = old.gameState.turnTimeLimitMs;
      var moveMakerPrincipal = old.gameState.moveMakerPrincipal;
      var gamePhase = old.gameState.gamePhase;
      var celebrationEndTime = old.gameState.celebrationEndTime;
      var winner = old.gameState.winner;
      var openingName = old.gameState.openingName;
      var gameNumber = 0;
      var gameMode = #Normal;
    };

    // Rebuild nftStore.nfts element-by-element, widening each NftRecord's
    // metadata from OldMintMetadata (10 fields, with `effect : BurnEffect`)
    // to NewMintMetadata (11 fields, with `spellId : Nat` and
    // `gameNumber : Nat`) by replacing `effect` with `spellId = 1` (the
    // default spell ID — pre-existing NFTs predate the spell-ID
    // randomizer, so they default to spell ID 1) and `gameNumber = 0`
    // (pre-existing NFTs predate the game-number tracking, so they default
    // to game #0). The mutable array `[var ...]` does not subtype through
    // the record-field widening in a plain migration-body assignment, so
    // we rebuild via Array.fromVarArray + map + toVarArray.
    let oldNfts = Array.fromVarArray(old.nftStore.nfts);
    let newNfts = oldNfts.map(
      func(r : OldNftRecord) : NewNftRecord {
        let oldMeta = r.metadata;
        let newMeta : NewMintMetadata = {
          gameResult = oldMeta.gameResult;
          endState = oldMeta.endState;
          finalBoardState = oldMeta.finalBoardState;
          recipientRole = oldMeta.recipientRole;
          recipientTeam = oldMeta.recipientTeam;
          recipientUsername = oldMeta.recipientUsername;
          recipientWalletAddress = oldMeta.recipientWalletAddress;
          moveCount = oldMeta.moveCount;
          concludedAt = oldMeta.concludedAt;
          spellId = 1;
          gameNumber = 0;
        };
        {
          tokenId = r.tokenId;
          owner = r.owner;
          metadata = newMeta;
          mintedAt = r.mintedAt;
        } : NewNftRecord;
      },
    );
    let newNftStore : NewNftStore = {
      var nextTokenId = old.nftStore.nextTokenId;
      var nfts = newNfts.toVarArray();
      var nextMintAttemptId = old.nftStore.nextMintAttemptId;
      var mintAttempts = old.nftStore.mintAttempts;
    };

    {
      var gameState = newGameState;
      players = old.players;
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      nftStore = newNftStore;
    };
  };
};
