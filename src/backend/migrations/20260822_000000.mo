import Array "mo:core/Array";
import Map "mo:core/Map";

module {
  // Twenty-first migration — replaces the four-mode game cycle with the
  // player-voting system.
  //
  // This change drives the migration:
  //
  //   1. `gameMode : GameMode` is REMOVED from `GameState`. The four-mode
  //      cycle (#Normal / #RandomOpening / #Merlin / #MerlinRematch) is
  //      replaced by a player-voting system: each player casts a vote on two
  //      toggle positions (starting position Standard/Random, NFT spell use
  //      On/Off) that configure the NEXT game's setup. The old `gameMode`
  //      field is consumed from `OldActor` and omitted from `NewActor`
  //      (explicit discard — the mode cycle no longer exists).
  //
  //   2. A new stable actor field `voteStore : Map.Map<PseudoPrincipal, Vote>`
  //      is ADDED as the 8th actor field. It holds each logged-in player's
  //      current vote on the two toggle positions. Votes can change midgame,
  //      are captured at game-end (they persist in the store through the
  //      celebration window), applied to the next game's setup at
  //      startNewGame, and cleared when the next game starts. Initialized to
  //      an empty map (no votes yet).
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260821_000000.mo) exactly — 7 actor fields, `GameState` still carries
  // `gameMode : GameMode`, and the exercise/drinking stores carry the
  // widened `moveIndex` shapes. NewActor is the new 8-field shape: `gameMode`
  // removed from `GameState`, `voteStore` added. All other state (players,
  // chat, recorder, exerciseStore, drinkingStore, nftStore) copies through
  // unchanged. mops.toml sets check-limit = 1, so only this latest migration
  // runs against deployed state.

  type Team = { #White; #Black };
  type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };
  type Piece = { pieceType : PieceType; color : Team };
  type GamePhase = { #Playing; #Celebration; #Draw; #Paused };
  type PseudoPrincipal = Text;
  type Timestamp = Int;

  // The old four-mode cycle — present in OldActor's GameState, removed in
  // NewActor's GameState.
  type GameMode = {
    #Normal;
    #RandomOpening;
    #Merlin;
    #MerlinRematch;
  };

  type TriggerType = { #Capture; #EnPassant; #Castling; #Check };
  type WalletSource = { #none; #typed; #oisy };

  type ChatMessage = {
    sender : PseudoPrincipal;
    username : Text;
    text : Text;
    timestamp : Timestamp;
  };

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

  // OLD GameState — 11 var fields, WITH `gameMode`. Matches the NewActor of
  // 20260821_000000.mo exactly.
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
    var gameNumber : Nat;
    var gameMode : GameMode;
  };

  // NEW GameState — 10 var fields, `gameMode` REMOVED. Matches the current
  // GameState in types/chess-game.mo.
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
  };

  // Player-voting types — the new vote store's key/value types.
  type StartingPosition = { #Standard; #Random };
  type SpellUse = { #On; #Off };
  type Vote = {
    startingPosition : StartingPosition;
    spellUse : SpellUse;
  };
  type VoteStore = Map.Map<PseudoPrincipal, Vote>;

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

  type ExerciseKind = {
    #PushUps;
    #Squats;
    #Crunches;
    #NinjaRoll;
    #Cartwheel;
  };

  // ExerciseAssignment — 8 fields, WITH `moveIndex`. Matches the widened
  // shape from 20260821_000000.mo. Unchanged by this migration.
  type ExerciseAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    reps : Nat;
    exercise : ExerciseKind;
    timestamp : Timestamp;
    trigger : ?TriggerType;
    moveIndex : Nat;
  };
  type ExerciseStore = { var items : [var ExerciseAssignment] };

  // DrinkingAssignment — 7 fields, WITH `moveIndex`. Matches the widened
  // shape from 20260821_000000.mo. Unchanged by this migration.
  type DrinkingAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    drinks : Nat;
    timestamp : Timestamp;
    trigger : ?TriggerType;
    moveIndex : Nat;
  };
  type DrinkingStore = { var items : [var DrinkingAssignment] };

  type RecipientRole = { #Winner; #Drawer };

  // MintMetadata — 11 fields, with `spellId`/`gameNumber`. Matches the
  // NewActor of 20260821_000000.mo exactly. Unchanged by this migration.
  type MintMetadata = {
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
  type NftRecord = {
    tokenId : Nat;
    owner : Principal;
    metadata : MintMetadata;
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
  type NftStore = {
    var nextTokenId : Nat;
    var nfts : [var NftRecord];
    var nextMintAttemptId : Nat;
    var mintAttempts : [var MintAttempt];
  };

  // OldActor matches the NewActor of the preceding migration
  // (20260821_000000.mo) exactly — 7 actor fields, `GameState` still carries
  // `gameMode : GameMode`.
  type OldActor = {
    var gameState : OldGameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
  };

  // NewActor is the new 8-field shape: `gameMode` removed from `GameState`,
  // `voteStore` added (initialized to an empty map).
  type NewActor = {
    var gameState : NewGameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
    voteStore : VoteStore;
  };

  public func migration(old : OldActor) : NewActor {
    // Rebuild GameState without the `gameMode` field. The old gameMode is
    // consumed here and intentionally discarded — the four-mode cycle no
    // longer exists, replaced by the player-voting system.
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
      var gameNumber = old.gameState.gameNumber;
    };

    {
      var gameState = newGameState;
      players = old.players;
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      nftStore = old.nftStore;
      // New vote store — initialized empty (no votes cast yet). Votes are
      // cast midgame via castVote, captured at game-end, applied to the next
      // game's setup at startNewGame, and cleared when the next game starts.
      voteStore = Map.empty();
    };
  };
};
