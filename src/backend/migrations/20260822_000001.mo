import Map "mo:core/Map";

module {
  // Twenty-second migration — adds `spellUseEnabled : Bool` to `GameState`.
  //
  // The player-voting system resolves whether NFT spell use is On/Off for the
  // next game from the vote tally (spellUseEnabledFromVotes). Previously that
  // resolved value was computed but never consumed. This migration adds a
  // `spellUseEnabled` field to `GameState` so startNewGame can store the
  // resolved setting and the snapshot can surface it to the frontend.
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260822_000000.mo) exactly — 8 actor fields, `GameState` carries
  // `gameNumber` but NOT `spellUseEnabled`, and `voteStore` is present.
  // NewActor is the same 8-field shape with `spellUseEnabled : Bool` added to
  // `GameState`, initialized to `false` (the default is NFT spells OFF). All
  // other state copies through unchanged.

  type Team = { #White; #Black };
  type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };
  type Piece = { pieceType : PieceType; color : Team };
  type GamePhase = { #Playing; #Celebration; #Draw; #Paused };
  type PseudoPrincipal = Text;
  type Timestamp = Int;

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

  // OLD GameState — 10 var fields, WITHOUT `spellUseEnabled`. Matches the
  // NewActor of 20260822_000000.mo exactly.
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
  };

  // NEW GameState — 11 var fields, `spellUseEnabled` ADDED. Matches the
  // current GameState in types/chess-game.mo.
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
    var spellUseEnabled : Bool;
    var gameNumber : Nat;
  };

  // Player-voting types — the vote store's key/value types.
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
  // (20260822_000000.mo) exactly — 8 actor fields, `GameState` carries
  // `gameNumber` but NOT `spellUseEnabled`.
  type OldActor = {
    var gameState : OldGameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
    voteStore : VoteStore;
  };

  // NewActor is the same 8-field shape with `spellUseEnabled : Bool` added to
  // `GameState` (initialized to false — NFT spells OFF by default).
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
    // Rebuild GameState with the new `spellUseEnabled` field added. Defaults
    // to false (NFT spells OFF). The resolved value from the vote tally is
    // applied at startNewGame before the vote store is cleared.
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
      var spellUseEnabled = false;
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
      voteStore = old.voteStore;
    };
  };
};
