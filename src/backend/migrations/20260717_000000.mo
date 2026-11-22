module {
  // First migration — introduces stable state for the chess game canister.
  // OldActor is empty (fresh install); NewActor lists every stable field
  // declared in main.mo with its initial value.

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
  // Mutable record cells wrapping the players/chat arrays. The actor declares
  // these as `let` bindings of record type; the `.items` field is mutable so
  // the mixin can reassign the array reference.
  type PlayerStore = { var items : [var Player] };
  type ChatStore = { var items : [var ChatMessage] };

  type OldActor = {};
  type NewActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
  };

  public func migration(_old : OldActor) : NewActor {
    {
      var gameState = {
        var board = initBoard();
        var currentTurn = #White;
        var turnStartTime = 0;
        var turnTimeLimitMs = 300_000; // 5 minutes
        var moveMakerPrincipal = null;
        var gamePhase = #Paused;
        var celebrationEndTime = null;
        var winner = null;
      };
      players = { var items = [var] };
      chat = { var items = [var] };
    };
  };

  // Standard chess starting position. Squares indexed 0..63 (a1=0 .. h8=63).
  // Back ranks: White on rows 0-1, Black on rows 6-7.
  func initBoard() : [?Piece] {
    [
      ?{ pieceType = #Rook; color = #White },
      ?{ pieceType = #Knight; color = #White },
      ?{ pieceType = #Bishop; color = #White },
      ?{ pieceType = #Queen; color = #White },
      ?{ pieceType = #King; color = #White },
      ?{ pieceType = #Bishop; color = #White },
      ?{ pieceType = #Knight; color = #White },
      ?{ pieceType = #Rook; color = #White },
      ?{ pieceType = #Pawn; color = #White },
      ?{ pieceType = #Pawn; color = #White },
      ?{ pieceType = #Pawn; color = #White },
      ?{ pieceType = #Pawn; color = #White },
      ?{ pieceType = #Pawn; color = #White },
      ?{ pieceType = #Pawn; color = #White },
      ?{ pieceType = #Pawn; color = #White },
      ?{ pieceType = #Pawn; color = #White },
      null, null, null, null, null, null, null, null,
      null, null, null, null, null, null, null, null,
      null, null, null, null, null, null, null, null,
      null, null, null, null, null, null, null, null,
      ?{ pieceType = #Pawn; color = #Black },
      ?{ pieceType = #Pawn; color = #Black },
      ?{ pieceType = #Pawn; color = #Black },
      ?{ pieceType = #Pawn; color = #Black },
      ?{ pieceType = #Pawn; color = #Black },
      ?{ pieceType = #Pawn; color = #Black },
      ?{ pieceType = #Pawn; color = #Black },
      ?{ pieceType = #Pawn; color = #Black },
      ?{ pieceType = #Rook; color = #Black },
      ?{ pieceType = #Knight; color = #Black },
      ?{ pieceType = #Bishop; color = #Black },
      ?{ pieceType = #Queen; color = #Black },
      ?{ pieceType = #King; color = #Black },
      ?{ pieceType = #Bishop; color = #Black },
      ?{ pieceType = #Knight; color = #Black },
      ?{ pieceType = #Rook; color = #Black },
    ];
  };
};
