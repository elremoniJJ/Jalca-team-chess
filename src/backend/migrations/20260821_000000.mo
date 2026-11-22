import Array "mo:core/Array";

module {
  // Twentieth migration — widens `ExerciseAssignment` and
  // `DrinkingAssignment` with a new required field `moveIndex : Nat`.
  //
  // This change drives the migration:
  //
  //   `ExerciseAssignment` and `DrinkingAssignment` are stored in the
  //   stable `exerciseStore.items : [var ExerciseAssignment]` and
  //   `drinkingStore.items : [var DrinkingAssignment]` arrays. Adding a
  //   required `moveIndex : Nat` field to each record changes the stored
  //   shape of every element, which is NOT a stable-compatible widening
  //   (mutable arrays do not subtype through record-field widening in a
  //   plain migration-body assignment). The migration rebuilds both
  //   arrays element-by-element, copying every existing field and adding
  //   `moveIndex = 0` for legacy assignments (pre-existing assignments
  //   predate the moveIndex field, so they default to 0 — the index of
  //   the first recorded move — which the frontend treats as "no
  //   specific move linked").
  //
  // `moveIndex` is the index of the RecordedMove that captured the piece
  // (the move log's 0-based index). The frontend uses it to surface the
  // challenge toast when the captured piece is clicked. New assignments
  // created after this migration carry the actual recorder.moves.size()
  // at capture time (threaded from chess-game-api.mo's attemptMove).
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260820_000000.mo) exactly — 7 actor fields, current
  // ExerciseAssignment / DrinkingAssignment shapes (NO `moveIndex`).
  // NewActor is identical except `exerciseStore.items` and
  // `drinkingStore.items` carry the widened assignment shapes (each
  // adds `moveIndex : Nat`). All other state (gameState, players, chat,
  // recorder, nftStore) copies through unchanged. mops.toml sets
  // check-limit = 1, so only this latest migration runs against
  // deployed state.

  type Team = { #White; #Black };
  type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };
  type Piece = { pieceType : PieceType; color : Team };
  type GamePhase = { #Playing; #Celebration; #Draw; #Paused };
  type PseudoPrincipal = Text;
  type Timestamp = Int;

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

  // GameState — 11 var fields, with `gameNumber`/`gameMode`. Matches the
  // NewActor of 20260820_000000.mo exactly. Unchanged in shape by this
  // migration.
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

  // OLD ExerciseAssignment — 7 fields, NO `moveIndex`. Matches the
  // ExerciseAssignment in 20260820_000000.mo exactly.
  type OldExerciseAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    reps : Nat;
    exercise : ExerciseKind;
    timestamp : Timestamp;
    trigger : ?TriggerType;
  };
  // NEW ExerciseAssignment — 8 fields, adds `moveIndex : Nat`. Matches
  // the widened ExerciseAssignment shape the exercise lib expects.
  type NewExerciseAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    reps : Nat;
    exercise : ExerciseKind;
    timestamp : Timestamp;
    trigger : ?TriggerType;
    moveIndex : Nat;
  };
  type OldExerciseStore = { var items : [var OldExerciseAssignment] };
  type NewExerciseStore = { var items : [var NewExerciseAssignment] };

  // OLD DrinkingAssignment — 6 fields, NO `moveIndex`. Matches the
  // DrinkingAssignment in 20260820_000000.mo exactly.
  type OldDrinkingAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    drinks : Nat;
    timestamp : Timestamp;
    trigger : ?TriggerType;
  };
  // NEW DrinkingAssignment — 7 fields, adds `moveIndex : Nat`. Matches
  // the widened DrinkingAssignment shape the drinking lib expects.
  type NewDrinkingAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    drinks : Nat;
    timestamp : Timestamp;
    trigger : ?TriggerType;
    moveIndex : Nat;
  };
  type OldDrinkingStore = { var items : [var OldDrinkingAssignment] };
  type NewDrinkingStore = { var items : [var NewDrinkingAssignment] };

  type RecipientRole = { #Winner; #Drawer };

  // MintMetadata — 11 fields, with `spellId`/`gameNumber`. Matches the
  // NewActor of 20260820_000000.mo exactly. Unchanged by this migration.
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
  // (20260820_000000.mo) exactly — 7 actor fields, current
  // ExerciseAssignment / DrinkingAssignment shapes (NO `moveIndex`).
  type OldActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : OldExerciseStore;
    drinkingStore : OldDrinkingStore;
    nftStore : NftStore;
  };

  // NewActor is identical except `exerciseStore` and `drinkingStore`
  // carry the widened assignment shapes (each adds `moveIndex : Nat`).
  type NewActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : NewExerciseStore;
    drinkingStore : NewDrinkingStore;
    nftStore : NftStore;
  };

  public func migration(old : OldActor) : NewActor {
    // Rebuild exerciseStore.items element-by-element, widening each
    // OldExerciseAssignment (7 fields, NO `moveIndex`) to
    // NewExerciseAssignment (8 fields, with `moveIndex : Nat`) by
    // copying every existing field and adding `moveIndex = 0` for legacy
    // assignments. The mutable array `[var ...]` does not subtype
    // through the record-field widening in a plain migration-body
    // assignment, so we rebuild via Array.fromVarArray + map +
    // toVarArray.
    let oldExerciseItems = Array.fromVarArray(old.exerciseStore.items);
    let newExerciseItems = oldExerciseItems.map(
      func(a : OldExerciseAssignment) : NewExerciseAssignment {
        {
          index = a.index;
          lostTeam = a.lostTeam;
          capturedPiece = a.capturedPiece;
          reps = a.reps;
          exercise = a.exercise;
          timestamp = a.timestamp;
          trigger = a.trigger;
          moveIndex = 0;
        } : NewExerciseAssignment;
      },
    );
    let newExerciseStore : NewExerciseStore = {
      var items = newExerciseItems.toVarArray();
    };

    // Rebuild drinkingStore.items element-by-element, widening each
    // OldDrinkingAssignment (6 fields, NO `moveIndex`) to
    // NewDrinkingAssignment (7 fields, with `moveIndex : Nat`) by
    // copying every existing field and adding `moveIndex = 0` for legacy
    // assignments. Same mutable-array rebuild pattern as above.
    let oldDrinkingItems = Array.fromVarArray(old.drinkingStore.items);
    let newDrinkingItems = oldDrinkingItems.map(
      func(a : OldDrinkingAssignment) : NewDrinkingAssignment {
        {
          index = a.index;
          lostTeam = a.lostTeam;
          capturedPiece = a.capturedPiece;
          drinks = a.drinks;
          timestamp = a.timestamp;
          trigger = a.trigger;
          moveIndex = 0;
        } : NewDrinkingAssignment;
      },
    );
    let newDrinkingStore : NewDrinkingStore = {
      var items = newDrinkingItems.toVarArray();
    };

    {
      var gameState = old.gameState;
      players = old.players;
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = newExerciseStore;
      drinkingStore = newDrinkingStore;
      nftStore = old.nftStore;
    };
  };
};
