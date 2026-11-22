module {
  // Fifth migration — one-time wipe of ALL existing exercise records.
  //
  // The exercise domain was previously append-only: every capture appended a
  // new ExerciseAssignment to `exerciseStore.items` and nothing ever cleared
  // it, so records accumulated indefinitely. The capture handler and
  // startNewGame now enforce clear-then-write / clear-on-new-game semantics
  // (the backend holds exactly ONE exercise computation at a time), but the
  // already-accumulated pile of records must be wiped once on upgrade.
  //
  // This migration sets `exerciseStore.items` to an empty var-array, discarding
  // every previously stored assignment. OldActor matches the NewActor of the
  // preceding migration (20260801_000000.mo) exactly; NewActor is identical in
  // shape — only the value of `exerciseStore.items` is reset. mops.toml sets
  // check-limit = 1, so only this latest migration runs against deployed
  // state, making it the correct place for the one-time wipe.

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

  // OldActor matches the NewActor of the preceding migration exactly.
  type OldActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
  };

  // NewActor is identical in shape to OldActor; only the value of
  // exerciseStore.items is reset to empty.
  type NewActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
  };

  public func migration(old : OldActor) : NewActor {
    {
      var gameState = old.gameState;
      players = old.players;
      chat = old.chat;
      recorder = old.recorder;
      // One-time wipe: discard every accumulated exercise assignment by
      // resetting the items array to empty. The exercise domain now holds
      // exactly ONE computation at a time (clear-then-write on capture,
      // clear on new-game start), so the store starts fresh from here on.
      exerciseStore = { var items = [var] };
    };
  };
};
