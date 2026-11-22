import Map "mo:core/Map";

module {
  // Twenty-sixth migration — re-introduces the player-voting feature for the
  // next game's settings AND adds the live spell board state to the game
  // state so the frontend can wire spell-aware legal-move highlighting.
  //
  // This single pending migration consolidates the changes that were
  // previously split across two pending files (20260822_000005.mo and
  // 20260823_000000.mo) into one, satisfying the check-limit=1 constraint.
  //
  // OldActor matches the NewActor of the preceding APPLIED migration
  // (20260822_000004.mo) exactly — the TRUE prior-deployment state: 8 actor
  // fields, `gameState` WITHOUT `spellUseEnabled` and WITHOUT
  // `spellBoardState`, and `nftStore`'s `MintMetadata` WITH `spellId`.
  // NewActor folds in:
  //   - a 9th actor field `voteStore : { var items : Map.Map<PseudoPrincipal, Vote> }`
  //     (one vote per player for the next game's starting position + spell use),
  //     initialized to an empty map,
  //   - `spellUseEnabled : Bool` on `GameState`, defaulting to false (NFT
  //     spells are disabled for the current game until a vote tally flips it),
  //     and
  //   - `spellBoardState : SpellBoardState` on `GameState`, initialized to an
  //     empty board ({ blockedSquares = []; explosiveSquares = [] }).
  // All other state copies through unchanged.

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

  // A single explosive square from the Conu Bungno spell: the square index
  // and the team that played the spell (owns the trap).
  type ExplosiveSquare = {
    square : Nat;
    owner : Team;
  };

  // The active spell board state for the current game: squares blocked by
  // Bouvet Hondao and squares holding Conu Bungno explosive traps.
  type SpellBoardState = {
    blockedSquares : [Nat];
    explosiveSquares : [ExplosiveSquare];
  };

  // Old GameState — WITHOUT `spellUseEnabled` and WITHOUT `spellBoardState`
  // (matches the NewActor of the preceding applied migration
  // 20260822_000004.mo).
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

  // New GameState — WITH `spellUseEnabled : Bool` (default false) and
  // `spellBoardState : SpellBoardState` (default empty).
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
    var gameNumber : Nat;
    var spellUseEnabled : Bool;
    var spellBoardState : SpellBoardState;
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
    gameNumber : Nat;
    spellId : Nat;
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

  // Advice-domain types — the stable field's value type (copies through).
  type Advice = {
    targetSquare : Nat;
    sender : PseudoPrincipal;
    team : Team;
    caption : Text;
    timestamp : Timestamp;
  };
  type AdviceStore = { var items : [var Advice] };

  // Voting-domain types — the new 9th actor field's value type.
  type StartingPosition = { #Standard; #Random };
  type SpellUse = { #On; #Off };
  type Vote = {
    startingPosition : StartingPosition;
    spellUse : SpellUse;
  };
  type VoteStore = { var items : Map.Map<PseudoPrincipal, Vote> };

  // OldActor matches the NewActor of the preceding APPLIED migration
  // (20260822_000004.mo) exactly — the TRUE prior-deployment state: 8 actor
  // fields, with `gameState` WITHOUT `spellUseEnabled` and WITHOUT
  // `spellBoardState`.
  type OldActor = {
    var gameState : OldGameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
    adviceStore : AdviceStore;
  };

  // NewActor adds the 9th `voteStore` field (empty map), `spellUseEnabled`
  // on `GameState` (default false), and `spellBoardState` on `GameState`
  // (default empty). Matches the current actor (main.mo).
  type NewActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
    adviceStore : AdviceStore;
    voteStore : VoteStore;
  };

  public func migration(old : OldActor) : NewActor {
    {
      var gameState = {
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
        // NFT spells are disabled by default for the current game. The
        // vote-derived setting (resolved at game end / next-game start) may
        // flip this to true.
        var spellUseEnabled = false;
        // The spell board starts empty for the current game. It is reset to
        // empty at new-game start alongside the other per-game resets.
        var spellBoardState = {
          blockedSquares = [];
          explosiveSquares = [];
        };
      };
      players = old.players;
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      nftStore = old.nftStore;
      adviceStore = old.adviceStore;
      voteStore = { var items = Map.empty() };
    };
  };
};
