import Array "mo:core/Array";
import Bool "mo:core/Bool";
import Debug "mo:core/Debug";
import List "mo:core/List";
import Int "mo:core/Int";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Option "mo:core/Option";
import Random "mo:core/Random";
import Text "mo:core/Text";
import Time "mo:core/Time";

import Types "../types/chess-game";
import SpellStateTypes "../types/spell-state";

module {
  public type Player = Types.Player;
  public type GameState = Types.GameState;
  public type Team = Types.Team;
  public type Piece = Types.Piece;
  public type PieceType = Types.PieceType;
  public type Move = Types.Move;
  public type GamePhase = Types.GamePhase;
  public type PseudoPrincipal = Types.PseudoPrincipal;
  public type Timestamp = Types.Timestamp;
  public type Vote = Types.Vote;
  public type StartingPosition = Types.StartingPosition;
  public type SpellUse = Types.SpellUse;
  public type TurnDuration = Types.TurnDuration;
  public type VoteStore = Types.VoteStore;
  public type GameSettingsSnapshot = Types.GameSettingsSnapshot;
  public type VoteSnapshotStore = Types.VoteSnapshotStore;

  // The default turn duration (2 minutes) in nanoseconds (Time.now() is in ns).
  // This is the value used when the vote tally resolves to the default
  // #TwoMinutes option (including ties and zero votes).
  public let turnTimeLimitNs : Int = 120_000_000_000;
  // The default turn duration (2 minutes) in milliseconds (for the snapshot
  // field).
  public let turnTimeLimitMs : Nat = 120_000;
  // The three selectable turn durations in nanoseconds.
  public let turnDurationTwoMinutesNs : Int = 120_000_000_000;
  public let turnDurationNinetySecondsNs : Int = 90_000_000_000;
  public let turnDurationOneMinuteNs : Int = 60_000_000_000;
  // The default turn duration: 2 minutes per turn. A module `let` with a
  // static variant-tag RHS, so it is never stable state.
  public let defaultTurnDuration : TurnDuration = #TwoMinutes;

  // The nanosecond turn limit for a resolved turn duration.
  public func turnDurationNs(d : TurnDuration) : Int {
    switch (d) {
      case (#TwoMinutes) turnDurationTwoMinutesNs;
      case (#NinetySeconds) turnDurationNinetySecondsNs;
      case (#OneMinute) turnDurationOneMinuteNs;
    };
  };

  // The millisecond turn limit for a resolved turn duration.
  public func turnDurationMs(d : TurnDuration) : Nat {
    Int.abs(turnDurationNs(d) / 1_000_000);
  };
  // Celebration / draw window in nanoseconds (10 seconds).
  public let celebrationWindowNs : Int = 10_000_000_000;
  // Inactive-player cutoff in nanoseconds (90 seconds). A player whose
  // lastPing is older than this is marked inactive: they STAY in the roster
  // with their team, username and wallet, but are excluded from Move_Maker
  // selection. Any ping (heartbeat) flips them back to active immediately.
  // This is a module constant (static, never stable state), so changing it
  // requires no migration.
  public let inactiveCutoffNs : Int = 90_000_000_000;
  // Deletion cutoff in nanoseconds (30 minutes). A player whose lastPing is
  // older than this is deleted from the lobby entirely by
  // cleanupStalePlayers — but never while the game is in the Celebration or
  // Draw window; a player past this cutoff is deleted on the next maintenance
  // pass after the window ends. This replaces the previous 180-second delete.
  // This is a module constant (static, never stable state), so changing it
  // requires no migration.
  public let deletionCutoffNs : Int = 1_800_000_000_000;
  // Legacy 180-second stale cutoff. Retained only so the pre-change
  // cleanupStalePlayers still compiles; the presence lifecycle now uses
  // inactiveCutoffNs (90s) for the inactive state and deletionCutoffNs
  // (30 min) for deletion. The develop pass removes this constant together
  // with its last usage.
  public let staleCutoffNs : Int = 180_000_000_000;
  // Maintenance timer cadence in seconds. The backend installs a recurring
  // timer at this interval that runs the maintenance pass (stale-player
  // cleanup, turn-timeout expiry, celebration expiry) with zero players
  // connected, independent of any client call. A module `let` with a literal
  // RHS is static and never becomes stable state.
  public let maintenanceIntervalSeconds : Nat = 5;

  // ---------- Coordinate helpers ----------
  // Squares indexed 0..63 with a1=0, b1=1, ..., h1=7, a2=8, ..., h8=63.
  // file = sq % 8, rank = sq / 8.

  public func file(sq : Nat) : Nat = sq % 8;
  public func rank(sq : Nat) : Nat = sq / 8;
  public func square(f : Nat, r : Nat) : Nat = r * 8 + f;

  public func opponent(team : Team) : Team {
    switch (team) { case (#White) #Black; case (#Black) #White };
  };

  public func pieceColor(p : ?Piece) : ?Team {
    switch (p) { case (?piece) ?piece.color; case null null };
  };

  // ---------- Spell placement helpers ----------
  // Both helpers walk the board in a caster-dependent order so the same spell
  // cast by White and by Black chooses from a mirrored scan order. They are
  // pure reads over the board and the spell board state.

  // The first empty, unblocked square walking the two middle ranks in a
  // caster-dependent snake order, or null when none qualifies.
  //   White: d4 -> h4, h5 -> a5, a4 -> c4
  //   Black: e5 -> a5, a4 -> h4, h5 -> d5
  // A square qualifies when it is empty and not already blocked by a Bouvet
  // Hondao spell. Explosive traps are NOT excluded here: the caller decides
  // whether a trapped square is eligible.
  public func findFirstEmptyFromCentre(
    board : [?Piece],
    blockedSquares : [Nat],
    team : Team,
  ) : ?Nat {
    // Build the scan order as (file, rank) pairs. Ranks are 0-based (rank 3 is
    // the 4th rank, rank 4 is the 5th rank).
    let order : [(Nat, Nat)] = switch (team) {
      case (#White) {
        // d4 -> h4 (files 3..7 on rank 3), h5 -> a5 (files 7..0 on rank 4),
        // a4 -> c4 (files 0..2 on rank 3).
        let first = List.empty<(Nat, Nat)>();
        var f = 3;
        while (f < 8) { first.add((f, 3)); f += 1 };
        var g = 7;
        label down while (true) {
          first.add((g, 4));
          if (g == 0) break down;
          g -= 1;
        };
        var h = 0;
        while (h < 3) { first.add((h, 3)); h += 1 };
        first.toArray();
      };
      case (#Black) {
        // e5 -> a5 (files 4..0 on rank 4), a4 -> h4 (files 0..7 on rank 3),
        // h5 -> d5 (files 7..3 on rank 4).
        let first = List.empty<(Nat, Nat)>();
        var f = 4;
        label down while (true) {
          first.add((f, 4));
          if (f == 0) break down;
          f -= 1;
        };
        var g = 0;
        while (g < 8) { first.add((g, 3)); g += 1 };
        var h = 7;
        while (h >= 3) { first.add((h, 4)); h -= 1 };
        first.toArray();
      };
    };

    for ((f, r) in order.values()) {
      let sq = square(f, r);
      if (board[sq] == null and not blockedSquares.contains(sq)) {
        return ?sq;
      };
    };
    null;
  };

  // The first enemy piece of `pieceType` walking all 64 squares in a
  // caster-dependent order, or null when no match exists.
  //   White: rank 1 a->h through rank 8 a->h (ascending square index)
  //   Black: rank 8 h->a through rank 1 h->a (descending square index)
  public func findFirstEnemyPiece(
    board : [?Piece],
    team : Team,
    pieceType : PieceType,
  ) : ?Nat {
    let enemy = opponent(team);
    switch (team) {
      case (#White) {
        var i = 0;
        while (i < 64) {
          switch (board[i]) {
            case (?p) {
              if (p.color == enemy and p.pieceType == pieceType) return ?i;
            };
            case null {};
          };
          i += 1;
        };
        null;
      };
      case (#Black) {
        var i = 63;
        label scan while (true) {
          switch (board[i]) {
            case (?p) {
              if (p.color == enemy and p.pieceType == pieceType) return ?i;
            };
            case null {};
          };
          if (i == 0) break scan;
          i -= 1;
        };
        null;
      };
    };
  };

  // ---------- Summon placement ----------
  // The fixed square order used by summonPiece: every square sorted by its
  // squared distance from the board centre (d4, e4, d5, e5 first, then
  // outward), with the square index ascending as the deterministic tie-break.
  // Held as a module constant so the same board always yields the same result.
  public let summonSquareOrder : [Nat] = [
    27, 28, 35, 36,
    19, 20, 26, 29, 34, 37, 43, 44,
    18, 21, 42, 45,
    11, 12, 25, 30, 33, 38, 51, 52,
    10, 13, 17, 22, 41, 46, 50, 53,
    3, 4, 9, 14, 24, 31, 32, 39, 49, 54, 59, 60,
    2, 5, 16, 23, 40, 47, 58, 61,
    1, 6, 8, 15, 48, 55, 57, 62,
    0, 7, 56, 63,
  ];

  // Summon a brand-new friendly piece of `pieceType` onto the closest safe
  // square to the centre. Candidate squares are walked in summonSquareOrder;
  // the first square that is empty, is not on rank 1 or 8 (pawns only), and
  // where placing the piece leaves the enemy king not in check receives the
  // piece. Returns the new board plus the placed square, or null when no
  // square qualifies. Pure board read/write: it never consults captured or
  // lost pieces.
  public func summonPiece(
    board : [?Piece],
    team : Team,
    pieceType : PieceType,
  ) : ?{ board : [?Piece]; placedSquare : Nat } {
    let enemy = opponent(team);
    for (sq in summonSquareOrder.values()) {
      if (board[sq] == null) {
        // Pawns may not be summoned onto rank 1 or 8.
        let onBackRank = rank(sq) == 0 or rank(sq) == 7;
        if (not (pieceType == #Pawn and onBackRank)) {
          let newBoard = Array.tabulate(
            64,
            func(i) {
              if (i == sq) return ?{ pieceType; color = team; summoned = true };
              board[i];
            },
          );
          if (not isInCheck(newBoard, enemy)) {
            return ?{ board = newBoard; placedSquare = sq };
          };
        };
      };
    };
    null;
  };

  // ---------- Player / state construction ----------

  public func newPlayer(
    principal : PseudoPrincipal,
    username : Text,
    team : Team,
    now : Timestamp,
    walletAddress : ?Text,
    walletSource : Types.WalletSource,
    turnsThisGame : Nat,
  ) : Player {
    {
      principal;
      var username;
      var team;
      var lastPing = now;
      var isMoveMaker = false;
      var walletAddress;
      var walletSource;
      // A player is fresh on initial login — they have signaled readiness
      // for the next game. Becomes stale at game conclusion; the "New game"
      // button flips them back to fresh via requestNewGame.
      var isFresh = true;
      // A player is active on initial login. Becomes inactive after about
      // 90 seconds without a ping; any ping flips them back to active.
      var isInactive = false;
      // Human players are never the bot. The single bot is created through the
      // internal bot path, which sets isBot := true after construction.
      var isBot = false;
      // A new joiner starts at their team's current lowest turnsThisGame, not
      // 0, so they are not immediately handed the turn ahead of teammates who
      // have already moved this game.
      var turnsThisGame;
    };
  };

  // Count the FRESH HUMAN (non-bot) players on a team. The single reserved bot
  // is excluded, so the new-game gate requires two humans — one per team —
  // before a game starts. The bot alone must never satisfy the gate: with only
  // the bot and one human present the game would otherwise start on the first
  // human login, before any vote, and stall when the opening's turn belongs to
  // the bot's team (the bot is never chosen as Move_Maker). Only players whose
  // isFresh flag is true are counted, so a concluded game stays concluded until
  // two fresh humans signal readiness — stale players do not count.
  public func humanTeamCount(players : [Player], team : Team) : Nat {
    var n = 0;
    for (p in players.values()) {
      if (p.team == team and not p.isBot and p.isFresh) n += 1;
    };
    n;
  };

  // The lowest turnsThisGame among the given team's players, or 0 when the
  // team has no players. Used to seed a new joiner's counter so they start at
  // the team's current lowest count rather than 0.
  public func lowestTurnsForTeam(players : [Player], team : Team) : Nat {
    var lowest : ?Nat = null;
    for (p in players.values()) {
      if (p.team == team) {
        switch (lowest) {
          case null lowest := ?p.turnsThisGame;
          case (?l) {
            if (p.turnsThisGame < l) lowest := ?p.turnsThisGame;
          };
        };
      };
    };
    lowest ?? 0;
  };

  // The lowest turnsThisGame among the ACTIVE members of the given team,
  // ignoring inactive players and ignoring the excluded principal, or 0 when
  // no other active member is left. This is the single shared rule for
  // re-seeding a player's counter whenever they ENTER or RE-ENTER the active
  // selection pool or CHANGE TEAM: a player who joins, returns, wakes up, or
  // is moved to a new team starts level with the active teammates they will
  // compete with for the turn, rather than ahead of or behind them.
  public func lowestActiveTurnsForTeam(
    players : [Player],
    team : Team,
    exclude : ?PseudoPrincipal,
  ) : Nat {
    var lowest : ?Nat = null;
    for (p in players.values()) {
      if (p.team == team and not p.isInactive) {
        let isExcluded = switch (exclude) {
          case (?ex) p.principal == ex;
          case null false;
        };
        if (not isExcluded) {
          switch (lowest) {
            case null lowest := ?p.turnsThisGame;
            case (?l) {
              if (p.turnsThisGame < l) lowest := ?p.turnsThisGame;
            };
          };
        };
      };
    };
    lowest ?? 0;
  };

  // Initialize a fresh game state with the standard chess starting position.
  // gameNumber starts at 1 so the FIRST game displays as "Game # 1"
  // immediately at start; the increment at game conclusion then moves it
  // to 2 for the second game's NFT, and so on.
  public func newGameState(now : Timestamp) : GameState {
    {
      var board = resetBoard();
      var currentTurn = #White;
      var turnStartTime = now;
      var turnTimeLimitMs = turnDurationMs(defaultTurnDuration);
      var moveMakerPrincipal = null;
      var gamePhase = #Playing;
      var celebrationEndTime = null;
      var winner = null;
      var openingName = null;
      var spellWinName = null;
      var gameNumber = 1;
      var spellUseEnabled = false;
      var spellBoardState = {
        blockedSquares = [];
        blockedSquareOwners = [];
        explosiveSquares = [];
        whiteBallsColour = null;
        blackBallsColour = null;
        whiteOpponentImage = null;
        blackOpponentImage = null;
      };
      var turnDuration = defaultTurnDuration;
    };
  };

  // Reset the board to the standard chess starting position.
  public func resetBoard() : [?Piece] {
    [
      ?{ pieceType = #Rook; color = #White; summoned = false },
      ?{ pieceType = #Knight; color = #White; summoned = false },
      ?{ pieceType = #Bishop; color = #White; summoned = false },
      ?{ pieceType = #Queen; color = #White; summoned = false },
      ?{ pieceType = #King; color = #White; summoned = false },
      ?{ pieceType = #Bishop; color = #White; summoned = false },
      ?{ pieceType = #Knight; color = #White; summoned = false },
      ?{ pieceType = #Rook; color = #White; summoned = false },
      ?{ pieceType = #Pawn; color = #White; summoned = false },
      ?{ pieceType = #Pawn; color = #White; summoned = false },
      ?{ pieceType = #Pawn; color = #White; summoned = false },
      ?{ pieceType = #Pawn; color = #White; summoned = false },
      ?{ pieceType = #Pawn; color = #White; summoned = false },
      ?{ pieceType = #Pawn; color = #White; summoned = false },
      ?{ pieceType = #Pawn; color = #White; summoned = false },
      ?{ pieceType = #Pawn; color = #White; summoned = false },
      null, null, null, null, null, null, null, null,
      null, null, null, null, null, null, null, null,
      null, null, null, null, null, null, null, null,
      null, null, null, null, null, null, null, null,
      ?{ pieceType = #Pawn; color = #Black; summoned = false },
      ?{ pieceType = #Pawn; color = #Black; summoned = false },
      ?{ pieceType = #Pawn; color = #Black; summoned = false },
      ?{ pieceType = #Pawn; color = #Black; summoned = false },
      ?{ pieceType = #Pawn; color = #Black; summoned = false },
      ?{ pieceType = #Pawn; color = #Black; summoned = false },
      ?{ pieceType = #Pawn; color = #Black; summoned = false },
      ?{ pieceType = #Pawn; color = #Black; summoned = false },
      ?{ pieceType = #Rook; color = #Black; summoned = false },
      ?{ pieceType = #Knight; color = #Black; summoned = false },
      ?{ pieceType = #Bishop; color = #Black; summoned = false },
      ?{ pieceType = #Queen; color = #Black; summoned = false },
      ?{ pieceType = #King; color = #Black; summoned = false },
      ?{ pieceType = #Bishop; color = #Black; summoned = false },
      ?{ pieceType = #Knight; color = #Black; summoned = false },
      ?{ pieceType = #Rook; color = #Black; summoned = false },
    ];
  };

  // ---------- Move generation ----------

  // Is (f, r) on the board?
  func onBoard(f : Int, r : Int) : Bool {
    f >= 0 and f < 8 and r >= 0 and r < 8;
  };

  // Pseudo-legal destination squares for the piece at `from` (ignores own-king
  // check safety). Returns a list of destination square indices.
  func pseudoMoves(board : [?Piece], from : Nat) : [Nat] {
    let piece = switch (board[from]) { case (?p) p; case null return [] };
    let f = file(from);
    let r = rank(from);
    let color = piece.color;
    let isWhite = color == #White;

    switch (piece.pieceType) {
      case (#Pawn) {
        let dir : Int = if isWhite { 1 } else { -1 };
        let startRank : Nat = if isWhite { 1 } else { 6 };
        let dests = List.empty<Nat>();
        // Forward one.
        let r1 = r + dir;
        if (onBoard(f, r1)) {
          let sq1 = square(Int.abs(f), Int.abs(r1));
          if (board[sq1] == null) {
            dests.add(sq1);
            // Forward two from starting rank.
            if (r == startRank) {
              let r2 = r + dir + dir;
              let sq2 = square(Int.abs(f), Int.abs(r2));
              if (board[sq2] == null) dests.add(sq2);
            };
          };
        };
        // Diagonal captures.
        for (df in [-1 : Int, 1].values()) {
          let cf = f + df;
          let cr = r + dir;
          if (onBoard(cf, cr)) {
            let sq = square(Int.abs(cf), Int.abs(cr));
            switch (board[sq]) {
              case (?target) {
                if (target.color != color) dests.add(sq);
              };
              case null {};
            };
          };
        };
        // En passant handled in isValidMove via move context; pseudoMoves
        // does not know en-passant target, so we add the diagonal empty
        // squares here only if a capture exists (above). En passant is
        // validated separately in isValidMove.
        dests.toArray();
      };
      case (#Knight) {
        let offsets = [
          (1, 2), (2, 1), (2, -1), (1, -2),
          (-1, -2), (-2, -1), (-2, 1), (-1, 2),
        ];
        let dests = List.empty<Nat>();
        for ((df, dr) in offsets.values()) {
          let cf = f + df;
          let cr = r + dr;
          if (onBoard(cf, cr)) {
            let sq = square(Int.abs(cf), Int.abs(cr));
            switch (board[sq]) {
              case (?target) {
                if (target.color != color) dests.add(sq);
              };
              case null dests.add(sq);
            };
          };
        };
        dests.toArray();
      };
      case (#Bishop) slideMoves(board, from, f, r, color, [(1, 1), (1, -1), (-1, 1), (-1, -1)]);
      case (#Rook) slideMoves(board, from, f, r, color, [(1, 0), (-1, 0), (0, 1), (0, -1)]);
      case (#Queen) slideMoves(board, from, f, r, color, [
        (1, 1), (1, -1), (-1, 1), (-1, -1),
        (1, 0), (-1, 0), (0, 1), (0, -1),
      ]);
      case (#King) {
        let dests = List.empty<Nat>();
        for (df in [-1 : Int, 0, 1].values()) {
          for (dr in [-1 : Int, 0, 1].values()) {
            if (not (df == 0 and dr == 0)) {
              let cf = f + df;
              let cr = r + dr;
              if (onBoard(cf, cr)) {
                let sq = square(Int.abs(cf), Int.abs(cr));
                switch (board[sq]) {
                  case (?target) {
                    if (target.color != color) dests.add(sq);
                  };
                  case null dests.add(sq);
                };
              };
            };
          };
        };
        // Castling is validated separately in isValidMove (needs check/attack
        // info); pseudoMoves for the king omits castling squares.
        dests.toArray();
      };
    };
  };

  // Sliding-piece helper. `dirs` are (df, dr) step directions.
  func slideMoves(board : [?Piece], from : Nat, f : Int, r : Int, color : Team, dirs : [(Int, Int)]) : [Nat] {
    let dests = List.empty<Nat>();
    for ((df, dr) in dirs.values()) {
      var cf = f + df;
      var cr = r + dr;
      label slide while (onBoard(cf, cr)) {
        let sq = square(Int.abs(cf), Int.abs(cr));
        switch (board[sq]) {
          case (?target) {
            if (target.color != color) dests.add(sq);
            break slide;
          };
          case null {
            dests.add(sq);
            cf += df;
            cr += dr;
          };
        };
      };
    };
    dests.toArray();
  };

  // ---------- Attack / check detection ----------

  // Is square `sq` attacked by `byColor`?
  public func isAttacked(board : [?Piece], sq : Nat, byColor : Team) : Bool {
    let f = file(sq);
    let r = rank(sq);

    // Pawn attacks: a pawn of byColor attacks diagonally forward.
    // White pawns attack upward (r-1 from the defender's perspective),
    // Black pawns attack downward.
    let pawnDir : Int = if (byColor == #White) { 1 } else { -1 };
    // A pawn of byColor on (cf, cr) attacks (f, r) if cr + pawnDir == r and |cf - f| == 1.
    // Equivalently, the attacker pawn sits at r - pawnDir.
    let pawnRank = r - pawnDir;
    for (df in [-1 : Int, 1].values()) {
      let cf = f + df;
      if (onBoard(cf, pawnRank)) {
        let psq = square(Int.abs(cf), Int.abs(pawnRank));
        switch (board[psq]) {
          case (?p) {
            if (p.color == byColor and p.pieceType == #Pawn) return true;
          };
          case null {};
        };
      };
    };

    // Knight attacks.
    let knightOffsets = [
      (1, 2), (2, 1), (2, -1), (1, -2),
      (-1, -2), (-2, -1), (-2, 1), (-1, 2),
    ];
    for ((df, dr) in knightOffsets.values()) {
      let cf = f + df;
      let cr = r + dr;
      if (onBoard(cf, cr)) {
        let ksq = square(Int.abs(cf), Int.abs(cr));
        switch (board[ksq]) {
          case (?p) {
            if (p.color == byColor and p.pieceType == #Knight) return true;
          };
          case null {};
        };
      };
    };

    // King attacks (adjacent).
    for (df in [-1 : Int, 0, 1].values()) {
      for (dr in [-1 : Int, 0, 1].values()) {
        if (not (df == 0 and dr == 0)) {
          let cf = f + df;
          let cr = r + dr;
          if (onBoard(cf, cr)) {
            let ksq = square(Int.abs(cf), Int.abs(cr));
            switch (board[ksq]) {
              case (?p) {
                if (p.color == byColor and p.pieceType == #King) return true;
              };
              case null {};
            };
          };
        };
      };
    };

    // Sliding: rook/queen (orthogonal), bishop/queen (diagonal).
    let ortho = [(1, 0), (-1, 0), (0, 1), (0, -1)];
    for ((df, dr) in ortho.values()) {
      var cf = f + df;
      var cr = r + dr;
      label ray while (onBoard(cf, cr)) {
        let rsq = square(Int.abs(cf), Int.abs(cr));
        switch (board[rsq]) {
          case (?p) {
            if (p.color == byColor and (p.pieceType == #Rook or p.pieceType == #Queen)) return true;
            break ray;
          };
          case null {
            cf += df;
            cr += dr;
          };
        };
      };
    };
    let diag = [(1, 1), (1, -1), (-1, 1), (-1, -1)];
    for ((df, dr) in diag.values()) {
      var cf = f + df;
      var cr = r + dr;
      label ray while (onBoard(cf, cr)) {
        let rsq = square(Int.abs(cf), Int.abs(cr));
        switch (board[rsq]) {
          case (?p) {
            if (p.color == byColor and (p.pieceType == #Bishop or p.pieceType == #Queen)) return true;
            break ray;
          };
          case null {
            cf += df;
            cr += dr;
          };
        };
      };
    };

    false;
  };

  // Find the king square of `team`, or null if missing.
  public func kingSquare(board : [?Piece], team : Team) : ?Nat {
    var i = 0;
    label find while (i < 64) {
      switch (board[i]) {
        case (?p) {
          if (p.color == team and p.pieceType == #King) return ?i;
        };
        case null {};
      };
      i += 1;
    };
    null;
  };

  public func isInCheck(board : [?Piece], team : Team) : Bool {
    switch (kingSquare(board, team)) {
      case (?k) isAttacked(board, k, opponent(team));
      case null false;
    };
  };

  // ---------- Move legality ----------

  // Validate a move for the given team and current board, including own-king
  // check safety, castling, and en passant. Returns true if legal.
  public func isValidMove(board : [?Piece], move : Move, team : Team) : Bool {
    if (move.fromSquare >= 64 or move.toSquare >= 64) return false;
    if (move.fromSquare == move.toSquare) return false;
    let piece = switch (board[move.fromSquare]) { case (?p) p; case null return false };
    if (piece.color != team) return false;

    // Castling: encoded as king moving two squares horizontally from e1/e8.
    let isCastling = piece.pieceType == #King and Int.abs(file(move.fromSquare) - file(move.toSquare)) == 2;
    if (isCastling) {
      return isValidCastling(board, move, team);
    };

    // En passant: pawn moving diagonally to an empty square.
    let isEnPassant = piece.pieceType == #Pawn
      and file(move.fromSquare) != file(move.toSquare)
      and board[move.toSquare] == null;
    if (isEnPassant) {
      // The captured pawn sits on the same file as `to`, same rank as `from`.
      let capSq = square(file(move.toSquare), rank(move.fromSquare));
      switch (board[capSq]) {
        case (?cap) {
          if (cap.color == team or cap.pieceType != #Pawn) return false;
        };
        case null return false;
      };
    };

    // Pseudo-legal destination check.
    let dests = pseudoMoves(board, move.fromSquare);
    let isPseudoLegal = dests.contains(move.toSquare);
    if (not isPseudoLegal) {
      // En passant target is an empty diagonal — pseudoMoves only adds it
      // when a capture exists. Allow it here if it is a valid en passant.
      if (not isEnPassant) return false;
    };

    // Promotion must be supplied for a pawn reaching the last rank.
    if (piece.pieceType == #Pawn) {
      let lastRank = if (team == #White) { 7 } else { 0 };
      if (rank(move.toSquare) == lastRank) {
        switch (move.promotion) {
          case null return false;
          case (?t) {
            switch (t) {
              case (#Pawn) return false;
              case (#King) return false;
              case (_) {};
            };
          };
        };
      } else {
        // No promotion allowed mid-board.
        if (move.promotion != null) return false;
      };
    } else {
      if (move.promotion != null) return false;
    };

    // Own-king safety: simulate the move and ensure the king is not in check.
    let next = applyMove(board, move);
    not isInCheck(next, team);
  };

  // ---------- Blocked-square-aware legality (Bouvet Hondao) ----------
  //
  // A square blocked by Bouvet Hondao is illegal to LAND ON or MOVE THROUGH
  // for both teams, for the rest of the game. The base isValidMove validates
  // against the board only, so the authoritative move path must consult the
  // spell board state's blockedSquares separately. These wrappers keep the
  // base validator (used by the opening parser, which runs before any spell
  // can fire) unchanged.

  // The squares strictly between `from` and `to` that a piece crosses on its
  // way, excluding both endpoints. For a sliding piece this is the ray between
  // them; for a pawn's two-square advance it is the single intermediate square;
  // for a knight or a one-step move it is empty. Castling is handled by the
  // caller's destination check plus the king's crossed square.
  func pathSquares(board : [?Piece], move : Move) : [Nat] {
    let from = move.fromSquare;
    let to = move.toSquare;
    let piece = switch (board[from]) { case (?p) p; case null return [] };
    let ff = file(from);
    let fr = rank(from);
    let tf = file(to);
    let tr = rank(to);
    let df : Int = if (tf > ff) { 1 } else if (tf < ff) { -1 } else { 0 };
    let dr : Int = if (tr > fr) { 1 } else if (tr < fr) { -1 } else { 0 };

    switch (piece.pieceType) {
      case (#Knight) { [] };
      case (#Pawn) {
        // A two-square advance crosses the square directly in front.
        if (ff == tf and Int.abs(tr - fr) == 2) {
          [square(ff, Int.abs(fr + dr))];
        } else {
          [];
        };
      };
      case (#King) {
        // Castling: the king crosses the square it passes over (f-file for
        // kingside, d-file for queenside). A normal king step crosses nothing.
        if (Int.abs(tf - ff) == 2) {
          [square(Int.abs(ff + df), fr)];
        } else {
          [];
        };
      };
      case (_) {
        // Sliding piece: walk from `from` toward `to` until reaching `to`.
        // A target that is not on a straight line or diagonal can never be
        // reached by the walk, so it has no path squares (the move itself is
        // rejected later by the normal validation).
        let adf = Int.abs(tf - ff);
        let adr = Int.abs(tr - fr);
        if (not (adf == 0 or adr == 0 or adf == adr)) { return [] };
        let crossed = List.empty<Nat>();
        var cf = ff + df;
        var cr = fr + dr;
        label walk while (cf != tf or cr != tr) {
          crossed.add(square(Int.abs(cf), Int.abs(cr)));
          cf += df;
          cr += dr;
        };
        crossed.toArray();
      };
    };
  };

  // Is `move` legal for `team` on `board` while honouring the Bouvet Hondao
  // blocked squares? A move is rejected when its destination is blocked or
  // when any square it crosses is blocked, in addition to the base legality
  // rules. `blockedSquares` is the spell board state's shared blocked list.
  public func isValidMoveWithBlocked(
    board : [?Piece],
    move : Move,
    team : Team,
    blockedSquares : [Nat],
  ) : Bool {
    if (move.fromSquare >= 64 or move.toSquare >= 64) return false;
    if (blockedSquares.contains(move.toSquare)) return false;
    for (sq in pathSquares(board, move).values()) {
      if (blockedSquares.contains(sq)) return false;
    };
    isValidMove(board, move, team);
  };

  // Castling validity. King moves two squares toward a rook.
  func isValidCastling(board : [?Piece], move : Move, team : Team) : Bool {
    let from = move.fromSquare;
    let to = move.toSquare;
    // King must be on its original square.
    let kingStart = if (team == #White) { 4 } else { 60 }; // e1 / e8
    if (from != kingStart) return false;
    // King must not be in check.
    if (isInCheck(board, team)) return false;
    let kingside = file(to) == 6; // g-file
    let queenside = file(to) == 2; // c-file
    if (not kingside and not queenside) return false;
    let rank8 = if (team == #White) { 0 } else { 7 };
    if (rank(from) != rank8) return false;

    if (kingside) {
      // Rook on h-file (file 7) must be present and unmoved (we infer unmoved
      // by it being a rook of the right color on its home square; full
      // castling-rights tracking is not stored, so we require the king also on
      // its home square, which together implies neither has moved).
      let rookSq = square(7, rank8);
      switch (board[rookSq]) {
        case (?p) {
          if (p.color != team or p.pieceType != #Rook) return false;
        };
        case null return false;
      };
      // Squares f, g must be empty.
      if (board[square(5, rank8)] != null) return false;
      if (board[square(6, rank8)] != null) return false;
      // King must not pass through or land on an attacked square.
      if (isAttacked(board, square(5, rank8), opponent(team))) return false;
      if (isAttacked(board, square(6, rank8), opponent(team))) return false;
      return true;
    } else {
      // Queenside.
      let rookSq = square(0, rank8);
      switch (board[rookSq]) {
        case (?p) {
          if (p.color != team or p.pieceType != #Rook) return false;
        };
        case null return false;
      };
      // Squares b, c, d must be empty.
      if (board[square(1, rank8)] != null) return false;
      if (board[square(2, rank8)] != null) return false;
      if (board[square(3, rank8)] != null) return false;
      // King passes through d and lands on c; b is not crossed by the king.
      if (isAttacked(board, square(3, rank8), opponent(team))) return false;
      if (isAttacked(board, square(2, rank8), opponent(team))) return false;
      return true;
    };
  };

  // ---------- Apply move ----------

  // Apply a move to the board, returning a NEW board array. Handles captures,
  // promotion, castling (rook movement), and en passant.
  public func applyMove(board : [?Piece], move : Move) : [?Piece] {
    let next = Array.tabulate(
      64,
      func(i) {
        if (i == move.fromSquare) return null;
        if (i == move.toSquare) {
          let piece = switch (board[move.fromSquare]) { case (?p) p; case null return null };
          // Promotion.
          switch (move.promotion) {
            case (?t) return ?{ pieceType = t; color = piece.color; summoned = piece.summoned };
            case null return ?piece;
          };
        };
        board[i];
      },
    );

    let piece = switch (board[move.fromSquare]) { case (?p) p; case null return next };

    // En passant capture: remove the captured pawn.
    if (piece.pieceType == #Pawn
      and file(move.fromSquare) != file(move.toSquare)
      and board[move.toSquare] == null) {
      let capSq = square(file(move.toSquare), rank(move.fromSquare));
      if (capSq != move.fromSquare and capSq != move.toSquare) {
        return Array.tabulate(
          64,
          func(i) {
            if (i == capSq) return null;
            next[i];
          },
        );
      };
    };

    // Castling: move the rook to the other side of the king.
    if (piece.pieceType == #King and Int.abs(file(move.fromSquare) - file(move.toSquare)) == 2) {
      let rank8 = rank(move.fromSquare);
      let kingside = file(move.toSquare) == 6;
      if (kingside) {
        // Rook from h (file 7) to f (file 5).
        let rookFrom = square(7, rank8);
        let rookTo = square(5, rank8);
        return Array.tabulate(
          64,
          func(i) {
            if (i == rookFrom) return null;
            if (i == rookTo) return board[rookFrom];
            next[i];
          },
        );
      } else {
        // Queenside: rook from a (file 0) to d (file 3).
        let rookFrom = square(0, rank8);
        let rookTo = square(3, rank8);
        return Array.tabulate(
          64,
          func(i) {
            if (i == rookFrom) return null;
            if (i == rookTo) return board[rookFrom];
            next[i];
          },
        );
      };
    };

    next;
  };

  // ---------- Checkmate / stalemate ----------

  // Does `team` have any legal move on this board?
  public func hasAnyLegalMove(board : [?Piece], team : Team) : Bool {
    var from = 0;
    label search while (from < 64) {
      switch (board[from]) {
        case (?p) {
          if (p.color == team) {
            let dests = pseudoMoves(board, from);
            for (to in dests.values()) {
              let promo : ?PieceType =
                if (p.pieceType == #Pawn and (rank(to) == 0 or rank(to) == 7)) { ?#Queen } else { null };
              let move = { fromSquare = from; toSquare = to; promotion = promo };
              if (isValidMove(board, move, team)) return true;
            };
            // Castling moves are not in pseudoMoves; check them explicitly.
            let kingStart = if (team == #White) { 4 } else { 60 };
            if (p.pieceType == #King and from == kingStart) {
              let kingside = { fromSquare = from; toSquare = square(6, rank(from)); promotion = null };
              let queenside = { fromSquare = from; toSquare = square(2, rank(from)); promotion = null };
              if (isValidMove(board, kingside, team)) return true;
              if (isValidMove(board, queenside, team)) return true;
            };
          };
        };
        case null {};
      };
      from += 1;
    };
    false;
  };

  // Determine if the given team is in checkmate.
  public func isCheckmate(board : [?Piece], team : Team) : Bool {
    isInCheck(board, team) and not hasAnyLegalMove(board, team);
  };

  // Determine if the given team is in stalemate.
  public func isStalemate(board : [?Piece], team : Team) : Bool {
    (not isInCheck(board, team)) and not hasAnyLegalMove(board, team);
  };

  // Blocked-square-aware variants of the move-existence and game-end checks.
  // A blocked square is not a legal destination or pass-through, so it must
  // not count as an escape from check or as a legal move for stalemate
  // detection. These mirror the base functions but validate each candidate
  // move with isValidMoveWithBlocked.

  // Does `team` have any legal move on this board while honouring the Bouvet
  // Hondao blocked squares?
  public func hasAnyLegalMoveWithBlocked(
    board : [?Piece],
    team : Team,
    blockedSquares : [Nat],
  ) : Bool {
    var from = 0;
    label search while (from < 64) {
      switch (board[from]) {
        case (?p) {
          if (p.color == team) {
            let dests = pseudoMoves(board, from);
            for (to in dests.values()) {
              let promo : ?PieceType =
                if (p.pieceType == #Pawn and (rank(to) == 0 or rank(to) == 7)) { ?#Queen } else { null };
              let move = { fromSquare = from; toSquare = to; promotion = promo };
              if (isValidMoveWithBlocked(board, move, team, blockedSquares)) return true;
            };
            // Castling moves are not in pseudoMoves; check them explicitly.
            let kingStart = if (team == #White) { 4 } else { 60 };
            if (p.pieceType == #King and from == kingStart) {
              let kingside = { fromSquare = from; toSquare = square(6, rank(from)); promotion = null };
              let queenside = { fromSquare = from; toSquare = square(2, rank(from)); promotion = null };
              if (isValidMoveWithBlocked(board, kingside, team, blockedSquares)) return true;
              if (isValidMoveWithBlocked(board, queenside, team, blockedSquares)) return true;
            };
          };
        };
        case null {};
      };
      from += 1;
    };
    false;
  };

  // Determine if the given team is in checkmate while honouring the Bouvet
  // Hondao blocked squares.
  public func isCheckmateWithBlocked(
    board : [?Piece],
    team : Team,
    blockedSquares : [Nat],
  ) : Bool {
    isInCheck(board, team) and not hasAnyLegalMoveWithBlocked(board, team, blockedSquares);
  };

  // Determine if the given team is in stalemate while honouring the Bouvet
  // Hondao blocked squares.
  public func isStalemateWithBlocked(
    board : [?Piece],
    team : Team,
    blockedSquares : [Nat],
  ) : Bool {
    (not isInCheck(board, team)) and not hasAnyLegalMoveWithBlocked(board, team, blockedSquares);
  };

  // List EVERY legal move for `team`, honouring the Bouvet Hondao blocked
  // squares. Used by the bot to pick a move. It tries every (from, to) pair
  // for the team's pieces and keeps the ones the game's own validator
  // (isValidMoveWithBlocked) accepts, so it can never disagree with the real
  // rules. Castling (king moves two squares) and en passant (pawn moves
  // diagonally to an empty square) are covered because the validator accepts
  // them. A pawn reaching the last rank produces four moves, one for each
  // promotion piece (Queen, Rook, Bishop, Knight).
  public func allLegalMovesWithBlocked(
    board : [?Piece],
    team : Team,
    blockedSquares : [Nat],
  ) : [Move] {
    let moves = List.empty<Move>();
    let promotionTypes : [PieceType] = [#Queen, #Rook, #Bishop, #Knight];
    let lastRank = if (team == #White) { 7 } else { 0 };
    var from = 0;
    while (from < 64) {
      switch (board[from]) {
        case (?p) {
          if (p.color == team) {
            // Candidate targets: only squares this piece can actually reach
            // (its pseudo-legal destinations), plus the two castling squares for
            // a king on its start square. Never every square on the board: the
            // blocked-square path helper assumes the move runs along a line, and
            // would loop forever on a target like a rook going a1 -> b3.
            // (En passant is not offered to the bot: the game does not track
            // the previous move.)
            let targets = List.empty<Nat>();
            for (to in pseudoMoves(board, from).values()) { targets.add(to) };
            let kingStart = if (team == #White) { 4 } else { 60 };
            if (p.pieceType == #King and from == kingStart) {
              targets.add(square(6, rank(from)));
              targets.add(square(2, rank(from)));
            };
            for (to in targets.values()) {
              if (p.pieceType == #Pawn and rank(to) == lastRank) {
                for (t in promotionTypes.values()) {
                  let m : Move = { fromSquare = from; toSquare = to; promotion = ?t };
                  if (isValidMoveWithBlocked(board, m, team, blockedSquares)) moves.add(m);
                };
              } else {
                let m : Move = { fromSquare = from; toSquare = to; promotion = null };
                if (isValidMoveWithBlocked(board, m, team, blockedSquares)) moves.add(m);
              };
            };
          };
        };
        case null {};
      };
      from += 1;
    };
    moves.toArray();
  };

  // ---------- Bot move choice ----------

  public func pieceValue(t : PieceType) : Nat {
    switch (t) {
      case (#Pawn) 1;
      case (#Knight) 3;
      case (#Bishop) 3;
      case (#Rook) 5;
      case (#Queen) 9;
      case (#King) 0;
    };
  };

  public func materialOf(board : [?Piece], team : Team) : Nat {
    var total = 0;
    for (sq in board.values()) {
      switch (sq) {
        case (?p) { if (p.color == team) { total += pieceValue(p.pieceType) } };
        case null {};
      };
    };
    total;
  };

  public let botSafetyPlies : Nat = 12;

  // Jalca gets bored once each team has made 35 moves (70 half-moves on the
  // record).
  // From then on he summons a queen (Anne Boleyn) every turn, whatever the
  // material, as long as spells are on for the game.
  public let botBoredomPlies : Nat = 70;

  public type BotStyle = { #Random; #Aggressive; #Ranked };

  func moveGivesMate(board : [?Piece], move : Move, team : Team, blocked : [Nat]) : Bool {
    let next = applyMove(board, move);
    let opp = opponent(team);
    isInCheck(next, opp) and allLegalMovesWithBlocked(next, opp, blocked).size() == 0;
  };

  func moveAllowsMateInOne(board : [?Piece], move : Move, team : Team, blocked : [Nat]) : Bool {
    let next = applyMove(board, move);
    let opp = opponent(team);
    for (reply in allLegalMovesWithBlocked(next, opp, blocked).values()) {
      if (moveGivesMate(next, reply, opp, blocked)) return true;
    };
    false;
  };

  func isCaptureMove(board : [?Piece], move : Move) : Bool {
    switch (board[move.toSquare]) { case null false; case _ true };
  };

  func movesWhere(moves : [Move], keep : Move -> Bool) : [Move] {
    let out = List.empty<Move>();
    for (m in moves.values()) { if (keep(m)) out.add(m) };
    out.toArray();
  };

  public func chooseBotMove(
    board : [?Piece],
    team : Team,
    blocked : [Nat],
    legal : [Move],
    style : BotStyle,
    safetyOn : Bool,
    r : Nat,
  ) : (Move, Text) {
    let opp = opponent(team);
    let mates = movesWhere(legal, func(m : Move) : Bool { moveGivesMate(board, m, team, blocked) });
    if (mates.size() > 0) return (mates[r % mates.size()], "checkmate");

    var pool = legal;
    var tag = "";
    if (safetyOn) {
      let safe = movesWhere(legal, func(m : Move) : Bool { not moveAllowsMateInOne(board, m, team, blocked) });
      if (safe.size() > 0 and safe.size() < legal.size()) { pool := safe; tag := "safe " };
    };

    func pick(arr : [Move], why : Text) : (Move, Text) { (arr[r % arr.size()], tag # why) };
    let caps = movesWhere(pool, func(m : Move) : Bool { isCaptureMove(board, m) });

    switch (style) {
      case (#Random) pick(pool, "random");
      case (#Aggressive) {
        if (caps.size() > 0) pick(caps, "capture") else pick(pool, "random")
      };
      case (#Ranked) {
        let checks = movesWhere(pool, func(m : Move) : Bool { isInCheck(applyMove(board, m), opp) });
        let capChecks = movesWhere(caps, func(m : Move) : Bool { isInCheck(applyMove(board, m), opp) });
        if (capChecks.size() > 0) pick(capChecks, "capture+check")
        else if (checks.size() > 0) pick(checks, "check")
        else if (caps.size() > 0) pick(caps, "capture")
        else pick(pool, "random")
      };
    };
  };

  // Determine whether the board has insufficient material for either side to
  // deliver checkmate — a draw by insufficient material. Kings are ignored.
  // Any pawn, rook, or queen on the board means mate is still possible, so
  // the position is NOT a draw. Otherwise the position is a draw only for:
  //   - K vs K (no non-king pieces),
  //   - K + B vs K (exactly one bishop),
  //   - K + N vs K (exactly one knight),
  //   - K + B vs K + B with both bishops on the same square colour.
  // K + N vs K + N and K + 2N vs K are NOT draws (mate is possible with help),
  // so they return false.
  public func isInsufficientMaterial(board : [?Piece]) : Bool {
    var nonKingCount = 0;
    var bishopCount = 0;
    var whiteBishopColour : ?Nat = null;
    var blackBishopColour : ?Nat = null;
    var i = 0;
    while (i < 64) {
      switch (board[i]) {
        case (?p) {
          switch (p.pieceType) {
            case (#King) {};
            case (#Pawn) return false;
            case (#Rook) return false;
            case (#Queen) return false;
            case (#Bishop) {
              nonKingCount += 1;
              bishopCount += 1;
              // Square colour: (file + rank) % 2. Same parity = same colour.
              let colour = (file(i) + rank(i)) % 2;
              switch (p.color) {
                case (#White) whiteBishopColour := ?colour;
                case (#Black) blackBishopColour := ?colour;
              };
            };
            case (#Knight) {
              nonKingCount += 1;
            };
          };
        };
        case null {};
      };
      i += 1;
    };
    // K vs K.
    if (nonKingCount == 0) return true;
    // K + B vs K or K + N vs K: exactly one minor piece.
    if (nonKingCount == 1) return true;
    // K + B vs K + B with both bishops on the same square colour. Exactly two
    // non-king pieces, both bishops, one per side, on the same colour.
    if (nonKingCount == 2 and bishopCount == 2) {
      switch (whiteBishopColour, blackBishopColour) {
        case (?w, ?b) return w == b;
        case (_, _) return false;
      };
    };
    false;
  };

  // ---------- Timer / celebration ----------

  // Compute the remaining turn time in milliseconds, from the turn duration
  // resolved for the CURRENT game (gameState.turnDuration) rather than a fixed
  // constant. The duration is re-applied at each turn flip and at game start
  // by the caller resetting turnStartTime.
  public func timerRemainingMs(gameState : GameState, now : Timestamp) : Nat {
    let limitMs = turnDurationMs(gameState.turnDuration);
    let elapsedMs = Int.abs(now - gameState.turnStartTime) / 1_000_000;
    if (elapsedMs >= limitMs) 0 else limitMs - elapsedMs;
  };

  // Compute the seconds left in a celebration/draw window, if active.
  public func celebrationSecondsLeft(gameState : GameState, now : Timestamp) : ?Nat {
    switch (gameState.celebrationEndTime) {
      case null null;
      case (?end) {
        let remaining = end - now;
        if (remaining <= 0) { ?0 } else {
          ?Int.abs(remaining / 1_000_000_000);
        };
      };
    };
  };

  // ---------- Snapshot ----------

  // Convert an internal Player to the public PlayerInfo type.
  public func toPlayerInfo(player : Player) : Types.PlayerInfo {
    {
      principal = player.principal;
      username = player.username;
      team = player.team;
      isMoveMaker = player.isMoveMaker;
      walletAddress = player.walletAddress;
      walletSource = player.walletSource;
      isFresh = player.isFresh;
      isInactive = player.isInactive;
      isBot = player.isBot;
    };
  };

  // Build a full GameStateSnapshot from internal state.
  public func toSnapshot(
    gameState : GameState,
    players : [Player],
    now : Timestamp,
  ) : Types.GameStateSnapshot {
    {
      board = gameState.board;
      turn = gameState.currentTurn;
      timerRemainingMs = timerRemainingMs(gameState, now);
      turnDuration = gameState.turnDuration;
      moveMaker = gameState.moveMakerPrincipal;
      phase = gameState.gamePhase;
      players = players.map(toPlayerInfo);
      winner = gameState.winner;
      celebrationSecondsLeft = celebrationSecondsLeft(gameState, now);
      openingName = gameState.openingName;
      openingMoveCount = 0;
      spellWinName = gameState.spellWinName;
      spellUseEnabled = gameState.spellUseEnabled;
      spellBoardState = gameState.spellBoardState;
    };
  };

  // ---------- Random helpers ----------

  // True-random boolean from the IC's raw_random source.
  public func randomBool() : async Bool {
    await Random.bool();
  };

  // True-random team assignment: returns #White or #Black.
  public func randomTeam() : async Team {
    if (await Random.bool()) #White else #Black;
  };

  // Shared team-assignment rule for a joining player, based on the CURRENT
  // teamCount on each team (inactive players still count) so it stays correct
  // when players leave and rejoin:
  //   - White slot empty (whiteCount == 0) -> #White.
  //   - Black slot empty (whiteCount > 0, blackCount == 0) -> #Black.
  //   - Both slots filled -> the team with FEWER teamCount players; on a tie
  //     the team is chosen randomly.
  //
  // Both login() and reassignTeams() call this so the rule is identical on
  // every path. Callers must pass the count snapshot taken immediately before
  // the assignment (reassignTeams updates counts between calls so each draw
  // sees the teams as filled by the previous draws).
  public func fewerPlayersTeam(whiteCount : Nat, blackCount : Nat) : async Team {
    if (whiteCount == 0) return #White;
    if (blackCount == 0) return #Black;
    if (whiteCount < blackCount) return #White;
    if (blackCount < whiteCount) return #Black;
    // Tie — choose randomly.
    if (await Random.bool()) #White else #Black;
  };

  // Shared Move_Maker selection helper used by BOTH assignMoveMakerForTeam and
  // the attemptMove inline pick. Filters to active teammates, excludes the
  // player who just moved when more than one candidate remains, then picks
  // randomly among the candidates with the lowest turnsThisGame and increments
  // the chosen player's counter. Returns the chosen principal, or null when no
  // candidate remains.
  public func pickMoveMaker(
    players : [Player],
    team : Team,
    excludePrincipal : ?PseudoPrincipal,
  ) : async ?PseudoPrincipal {
    // Active teammates only. The bot is a normal candidate: it takes its turn
    // as Move_Maker in the same fair rotation as the humans. Both pick sites
    // (assignMoveMakerForTeam and the attemptMove inline pick) delegate here.
    let candidates = List.empty<Player>();
    for (p in players.values()) {
      if (p.team == team and not p.isInactive) candidates.add(p);
    };
    // Exclude the player who just moved, but only when more than one candidate
    // remains — a lone active teammate is still picked so the game never stalls.
    var pool = candidates.toArray();
    if (pool.size() > 1) {
      switch (excludePrincipal) {
        case (?ex) {
          let filtered = pool.filter(func p = p.principal != ex);
          if (filtered.size() > 0) pool := filtered;
        };
        case null {};
      };
    };
    if (pool.size() == 0) return null;
    // Lowest turnsThisGame among the pool.
    var lowest : Nat = pool[0].turnsThisGame;
    for (p in pool.values()) {
      if (p.turnsThisGame < lowest) lowest := p.turnsThisGame;
    };
    let lowestPool = pool.filter(func p = p.turnsThisGame == lowest);
    // Pick randomly among the lowest-counter candidates.
    let idx = await Random.natRange(0, lowestPool.size());
    let chosen = lowestPool[idx];
    // Increment the chosen player's counter. The chosen record is the SAME
    // mutable record held in the caller's players array, so the increment is
    // visible to the caller.
    chosen.turnsThisGame := chosen.turnsThisGame + 1;
    ?chosen.principal;
  };

  // ---------- Player voting (next-game settings) ----------

  // Record a single player's vote for the next game's settings. One vote per
  // player: casting again overwrites the player's previous vote. The vote is
  // stored keyed by PseudoPrincipal in the voteStore and captured at game end.
  public func castVote(voteStore : VoteStore, principal : PseudoPrincipal, vote : Vote) : () {
    voteStore.items.add(principal, vote);
  };

  // Count the votes in the store and return the winning settings for the next
  // game. A strict majority wins; ties (including zero votes) resolve to the
  // default (#Random starting position, #On spell use, #TwoMinutes turn
  // duration). Returns the winning starting position, spell-use setting, and
  // turn duration.
  public func tallyVotes(voteStore : VoteStore) : { startingPosition : StartingPosition; spellUse : SpellUse; turnDuration : TurnDuration } {
    var standardCount = 0;
    var randomCount = 0;
    var spellOnCount = 0;
    var spellOffCount = 0;
    var twoMinuteCount = 0;
    var ninetySecondCount = 0;
    var oneMinuteCount = 0;
    var total = 0;
    for ((_, vote) in voteStore.items.entries()) {
      total += 1;
      switch (vote.startingPosition) {
        case (#Standard) standardCount += 1;
        case (#Random) randomCount += 1;
      };
      switch (vote.spellUse) {
        case (#On) spellOnCount += 1;
        case (#Off) spellOffCount += 1;
      };
      switch (vote.turnDuration) {
        case (#TwoMinutes) twoMinuteCount += 1;
        case (#NinetySeconds) ninetySecondCount += 1;
        case (#OneMinute) oneMinuteCount += 1;
      };
    };
    // A strict majority (> half of all votes) wins; ties and zero votes fall
    // back to the defaults (#Random, #On, #TwoMinutes).
    let majority = total / 2 + 1;
    let startingPosition : StartingPosition =
      if (standardCount >= majority) #Standard
      else if (randomCount >= majority) #Random
      else #Random;
    let spellUse : SpellUse =
      if (spellOnCount >= majority) #On
      else if (spellOffCount >= majority) #Off
      else #On;
    let turnDuration : TurnDuration =
      if (twoMinuteCount >= majority) #TwoMinutes
      else if (ninetySecondCount >= majority) #NinetySeconds
      else if (oneMinuteCount >= majority) #OneMinute
      else #TwoMinutes;
    { startingPosition; spellUse; turnDuration };
  };

  // Clear all votes from the store. Called at next-game start so votes apply
  // to exactly one game.
  public func clearVotes(voteStore : VoteStore) : () {
    voteStore.items := Map.empty();
  };

  // Build the fixed game-settings snapshot from the current vote store: the
  // winning options resolved by tallyVotes plus the counts that produced them.
  // Called once at next-game start (startNewGame) BEFORE the store is cleared,
  // so the snapshot reflects the tally that decided the new game's settings.
  // Zero votes yield the defaults (#Random, #On) with all counts 0.
  public func snapshotFromVotes(voteStore : VoteStore) : GameSettingsSnapshot {
    var standardCount = 0;
    var randomCount = 0;
    var spellOnCount = 0;
    var spellOffCount = 0;
    var twoMinuteCount = 0;
    var ninetySecondCount = 0;
    var oneMinuteCount = 0;
    for ((_, vote) in voteStore.items.entries()) {
      switch (vote.startingPosition) {
        case (#Standard) standardCount += 1;
        case (#Random) randomCount += 1;
      };
      switch (vote.spellUse) {
        case (#On) spellOnCount += 1;
        case (#Off) spellOffCount += 1;
      };
      switch (vote.turnDuration) {
        case (#TwoMinutes) twoMinuteCount += 1;
        case (#NinetySeconds) ninetySecondCount += 1;
        case (#OneMinute) oneMinuteCount += 1;
      };
    };
    let winning = tallyVotes(voteStore);
    {
      startingPosition = winning.startingPosition;
      spellUse = winning.spellUse;
      turnDuration = winning.turnDuration;
      standardCount;
      randomCount;
      spellOnCount;
      spellOffCount;
      twoMinuteCount;
      ninetySecondCount;
      oneMinuteCount;
    };
  };

  // Resolve the starting position for the next game from the vote tally.
  // #Standard keeps the already-reset standard board; #Random applies a random
  // opening via the Openings hook. Returns the resolved StartingPosition.
  public func resolveStartingPosition(voteStore : VoteStore) : StartingPosition {
    tallyVotes(voteStore).startingPosition;
  };

  // Resolve whether NFT spells are enabled for the next game from the vote
  // tally. Returns the winning SpellUse setting (#On/#Off).
  public func resolveSpellUse(voteStore : VoteStore) : SpellUse {
    tallyVotes(voteStore).spellUse;
  };

  // Resolve the turn duration for the next game from the vote tally. Returns
  // the winning TurnDuration (#TwoMinutes/#NinetySeconds/#OneMinute), with
  // ties resolving to the #TwoMinutes default.
  public func resolveTurnDuration(voteStore : VoteStore) : TurnDuration {
    tallyVotes(voteStore).turnDuration;
  };
};
