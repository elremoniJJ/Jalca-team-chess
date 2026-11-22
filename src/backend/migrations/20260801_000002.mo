module {
  // Sixth migration — adds the isolated drinking-domain stable state
  // (`drinkingStore`) to the actor. The drinking domain computes and stores
  // drinking assignments on capture (the team that LOST the captured piece
  // drinks a piece-type-derived count: pawn 1, knight 2, bishop 2, rook 3,
  // queen 4; king is never captured). It is intentionally decoupled from
  // game/move/recorder/exercise logic: the only coupling is a single create
  // call in attemptMove on capture and a retrieve call for display.
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260801_000001.mo) exactly; NewActor adds `drinkingStore`. Existing
  // state is preserved unchanged; the new store initializes to empty.
  // mops.toml sets check-limit = 1, so only this latest migration runs
  // against deployed state.

  type Team = { #White; #Black };
  type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };
  type Piece = { pieceType : PieceType; color : Team };
  type GamePhase = { #Playing; #Celebration; #Draw; #Paused };
  type PseudoPrincipal = Text;
  type Timestamp = Int;
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
  };
  type GameState = {
    var board : [?Piece];
    var currentTurn : Team;
    var turnStartTime : Timestamp;
    var turnTimeLimitMs : Nat;
    var moveMakerPrincipal : ?PseudoPrincipal;
    var gamePhase : GamePhase;
    var celebrationEndTime : ?Timestamp;
    var winner : ?Team;
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
  type RecorderStore = {
    var moves : [var RecordedMove];
    var playerList : [PlayerListEntry];
    var rosters : [TeamRoster];
    var result : ?GameResult;
    var endState : ?EndState;
    var finalMovePlayerOnTimeout : ?Text;
    var active : Bool;
    var concluded : Bool;
  };

  // Exercise-domain types (inlined — migrations must be self-contained).
  type ExerciseKind = { #PushUps; #Squats; #Crunches };
  type ExerciseAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    reps : Nat;
    exercise : ExerciseKind;
    timestamp : Timestamp;
  };
  type ExerciseStore = { var items : [var ExerciseAssignment] };

  // Drinking-domain types (inlined — migrations must be self-contained).
  type DrinkingAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    drinks : Nat;
    timestamp : Timestamp;
  };
  type DrinkingStore = { var items : [var DrinkingAssignment] };

  // OldActor matches the NewActor of the preceding migration exactly.
  type OldActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
  };

  // NewActor adds drinkingStore.
  type NewActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
  };

  public func migration(old : OldActor) : NewActor {
    {
      var gameState = old.gameState;
      players = old.players;
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      // Initialize the drinking store to empty — no assignments yet.
      drinkingStore = { var items = [var] };
    };
  };
};
