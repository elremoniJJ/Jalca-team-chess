import Bool "mo:core/Bool";
import Char "mo:core/Char";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat32 "mo:core/Nat32";
import Random "mo:core/Random";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";

import ChessTypes "../types/chess-game";
import ChessGame "../lib/chess-game";
import RecorderTypes "../types/game-recorder";
import GameRecorder "../lib/game-recorder";

// Openings domain — isolated, reversible feature module.
//
// Holds the 100 named chess openings (indices 0..99) and a single entry point
// that:
//   (a) selects one uniformly at random via Random.natRange(0, 100),
//   (b) replays its SAN move list through ChessGame.applyMove so the existing
//       recorder remains the single source of truth (NO FEN stamping, NO
//       parallel move history),
//   (c) returns the resulting board, the opening's display name, and the ply
//       count so the caller (startNewGame hook) can determine which team moves
//       next (even ply -> #White, odd ply -> #Black).
//
// Reversibility: this is the entirety of the new logic. It does NOT modify any
// existing file, does NOT add fields to GameState or any existing type, and is
// imported only by startNewGame (the hook task adds that import). Reverting the
// feature = deleting this file + removing the one-line hook.
//
// Fallback: the entire replay is wrapped in try/catch. On ANY exception (a move
// that fails to parse or is rejected by isValidMove), the module falls back to
// the Standard Starting Position (no moves applied) and returns
// { board = originalBoard; openingName = "Standard Starting Position"; plyCount = 0 }.
// The originalBoard passed in by the caller is never mutated before the try
// block — replay works on a local mutable copy.
module {
  public type Team = ChessTypes.Team;
  public type PieceType = ChessTypes.PieceType;
  public type Piece = ChessTypes.Piece;
  public type Move = ChessTypes.Move;
  public type Board = [?Piece];
  public type RecorderStore = RecorderTypes.RecorderStore;

  // The display name returned for any fallback (and used by the #Standard
  // voting path). The Standard Starting Position is NOT part of the openings
  // array below — it is offered separately as its own alternative.
  public let standardName : Text = "Standard Starting Position";

  // One opening entry: a display name plus its ordered SAN move list.
  public type Opening = {
    name : Text;
    moves : [Text];
  };

  // The 100 named openings with their SAN move lists parsed from the raw list
  // (move numbers stripped, split on whitespace). The Standard Starting
  // Position is intentionally excluded — it is represented separately via the
  // #Standard voting alternative and the standardName constant.
  public let openings : [Opening] = [
    { name = "Sicilian Defense - Najdorf Variation"; moves = ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"] },
    { name = "Sicilian Defense - Dragon Variation"; moves = ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "g6"] },
    { name = "Sicilian Defense - Classical Variation"; moves = ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "Nc6"] },
    { name = "Sicilian Defense - Scheveningen Variation"; moves = ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "e6"] },
    { name = "Sicilian Defense - Accelerated Dragon Variation"; moves = ["e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "g6"] },
    { name = "Sicilian Defense - Sveshnikov Variation"; moves = ["e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "e5"] },
    { name = "Sicilian Defense - Kalashnikov Variation"; moves = ["e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "e5"] },
    { name = "Sicilian Defense - Taimanov Variation"; moves = ["e4", "c5", "Nf3", "e6", "d4", "cxd4", "Nxd4", "Nc6"] },
    { name = "Sicilian Defense - Kan Variation"; moves = ["e4", "c5", "Nf3", "e6", "d4", "cxd4", "Nxd4", "a6"] },
    { name = "Sicilian Defense - O'Kelly Variation"; moves = ["e4", "c5", "Nf3", "a6"] },
    { name = "Italian Game - Giuoco Piano"; moves = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"] },
    { name = "Italian Game - Giuoco Pianissimo"; moves = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3"] },
    { name = "Italian Game - Evans Gambit"; moves = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "b4"] },
    { name = "Italian Game - Two Knights Defense"; moves = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"] },
    { name = "Italian Game - Hungarian Defense"; moves = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Be7"] },
    { name = "Italian Game - Ponziani"; moves = ["e4", "e5", "Nf3", "Nc6", "c3"] },
    { name = "Italian Game - Center Attack"; moves = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d4"] },
    { name = "Italian Game - Max Lange Attack"; moves = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "d4", "exd4", "O-O"] },
    { name = "Italian Game - Moeller Attack"; moves = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d4", "exd4", "cxd4", "Bb4+", "Bd2"] },
    { name = "Italian Game - Classical Italian"; moves = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d3"] },
    { name = "Queen's Gambit - QGD Orthodox"; moves = ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7", "e3", "O-O", "Nf3", "Nbd7"] },
    { name = "Queen's Gambit - QGD Lasker Variation"; moves = ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7", "e3", "O-O", "Nf3", "h6", "Bh4", "Ne4"] },
    { name = "Queen's Gambit - QGD Capablanca Variation"; moves = ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7", "e3", "O-O", "Nf3", "dxc4"] },
    { name = "Queen's Gambit - QGD Cambridge Springs"; moves = ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Nbd7", "e3", "c6", "Nf3", "Qa5"] },
    { name = "Queen's Gambit - Slav Defense"; moves = ["d4", "d5", "c4", "c6"] },
    { name = "Queen's Gambit - Semi-Slav Defense"; moves = ["d4", "d5", "c4", "c6", "Nc3", "Nf6", "Nf3", "e6"] },
    { name = "Queen's Gambit - Tarrasch Defense"; moves = ["d4", "d5", "c4", "e6", "Nc3", "c5"] },
    { name = "Queen's Gambit - Queen's Gambit Accepted"; moves = ["d4", "d5", "c4", "dxc4"] },
    { name = "Queen's Gambit - Albin Countergambit"; moves = ["d4", "d5", "c4", "e5"] },
    { name = "Queen's Gambit - Chigorin Defense"; moves = ["d4", "d5", "c4", "Nc6"] },
    { name = "Ruy Lopez - Berlin Defense"; moves = ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6"] },
    { name = "Ruy Lopez - Morphy Defense"; moves = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"] },
    { name = "Ruy Lopez - Closed Variation"; moves = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7"] },
    { name = "Ruy Lopez - Open Variation"; moves = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Nxe4"] },
    { name = "Ruy Lopez - Exchange Variation"; moves = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6"] },
    { name = "Ruy Lopez - Marshall Attack"; moves = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "O-O", "c3", "d5"] },
    { name = "Ruy Lopez - Chigorin Variation"; moves = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "d6", "c3", "O-O", "h3", "Na5", "Bc2", "c5", "d4", "Qc7"] },
    { name = "Ruy Lopez - Breyer Variation"; moves = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "d6", "c3", "O-O", "h3", "Nb8"] },
    { name = "Ruy Lopez - Zaitsev Variation"; moves = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1", "b5", "Bb3", "d6", "c3", "O-O", "h3", "Bb7"] },
    { name = "Ruy Lopez - Smyslov Variation"; moves = ["e4", "e5", "Nf3", "Nc6", "Bb5", "g6"] },
    { name = "French Defense - Winawer Variation"; moves = ["e4", "e6", "d4", "d5", "Nc3", "Bb4"] },
    { name = "French Defense - Tarrasch Variation"; moves = ["e4", "e6", "d4", "d5", "Nd2"] },
    { name = "French Defense - Advance Variation"; moves = ["e4", "e6", "d4", "d5", "e5"] },
    { name = "French Defense - Classical Variation"; moves = ["e4", "e6", "d4", "d5", "Nc3", "Nf6", "Bg5"] },
    { name = "French Defense - Exchange Variation"; moves = ["e4", "e6", "d4", "d5", "exd5", "exd5"] },
    { name = "French Defense - Rubinstein Variation"; moves = ["e4", "e6", "d4", "d5", "Nc3", "dxe4"] },
    { name = "French Defense - McCutcheon Variation"; moves = ["e4", "e6", "d4", "d5", "Nc3", "Nf6", "Bg5", "Bb4"] },
    { name = "French Defense - Steinitz Variation"; moves = ["e4", "e6", "d4", "d5", "Nc3", "Nf6", "e5", "Nfd7"] },
    { name = "French Defense - Chigorin Variation"; moves = ["e4", "e6", "d4", "d5", "Nc3", "Nf6", "Bg5", "Be7", "e5", "Nfd7", "h4"] },
    { name = "French Defense - King's Indian Attack"; moves = ["e4", "e6", "d3", "d5", "Nd2"] },
    { name = "Caro-Kann Defense - Classical Variation"; moves = ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Bf5"] },
    { name = "Caro-Kann Defense - Advance Variation"; moves = ["e4", "c6", "d4", "d5", "e5"] },
    { name = "Caro-Kann Defense - Exchange Variation"; moves = ["e4", "c6", "d4", "d5", "exd5", "cxd5"] },
    { name = "Caro-Kann Defense - Panov-Botvinnik Attack"; moves = ["e4", "c6", "d4", "d5", "exd5", "cxd5", "c4"] },
    { name = "Caro-Kann Defense - Two Knights Variation"; moves = ["e4", "c6", "Nc3", "d5", "Nf3"] },
    { name = "Caro-Kann Defense - Gurgenidze Variation"; moves = ["e4", "c6", "d4", "d5", "Nc3", "g6"] },
    { name = "Caro-Kann Defense - Tartakower Variation"; moves = ["e4", "c6", "d4", "d5", "Nf3", "dxe4", "Ne5"] },
    { name = "Caro-Kann Defense - Fantasy Variation"; moves = ["e4", "c6", "d4", "d5", "f3"] },
    { name = "Caro-Kann Defense - Breyer Variation"; moves = ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Nf6", "Nxf6+"] },
    { name = "Caro-Kann Defense - Karpov Variation"; moves = ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Nd7"] },
    { name = "London System - Main Line"; moves = ["d4", "d5", "Bf4", "Nf6", "e3", "c5"] },
    { name = "London System - vs King's Indian Setup"; moves = ["d4", "Nf6", "Bf4", "g6", "e3", "Bg7"] },
    { name = "London System - vs Dutch Setup"; moves = ["d4", "f5", "Bf4", "Nf6", "e3"] },
    { name = "London System - vs QGD Setup"; moves = ["d4", "d5", "Bf4", "e6", "e3", "Be7"] },
    { name = "London System - vs Slav Setup"; moves = ["d4", "d5", "Bf4", "c6", "e3"] },
    { name = "London System - vs Grünfeld Setup"; moves = ["d4", "Nf6", "Bf4", "g6", "e3", "d5"] },
    { name = "London System - Steinitz Variation"; moves = ["d4", "d5", "Bf4", "c5", "e3", "Nc6", "c3"] },
    { name = "London System - Jobava London"; moves = ["d4", "Nf6", "Nc3", "d5", "Bf4"] },
    { name = "London System - Accelerated London"; moves = ["d4", "d5", "Bf4", "c5", "e3", "Nc6", "Nf3"] },
    { name = "London System - Anti-Indian London"; moves = ["d4", "Nf6", "Bf4", "e6", "Nf3", "c5", "e3"] },
    { name = "Slav Defense - Main Line"; moves = ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "Nc3", "dxc4"] },
    { name = "Slav Defense - Semi-Slav"; moves = ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "Nc3", "e6"] },
    { name = "Slav Defense - Exchange Variation"; moves = ["d4", "d5", "c4", "c6", "cxd5", "cxd5"] },
    { name = "Slav Defense - Chebanenko Variation"; moves = ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "e3", "a6"] },
    { name = "Slav Defense - Schlechter Variation"; moves = ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "e3", "g6"] },
    { name = "Slav Defense - Classical Variation"; moves = ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "Nc3"] },
    { name = "Slav Defense - Slow Slav"; moves = ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "e3", "Bf5"] },
    { name = "Slav Defense - Winawer Variation"; moves = ["d4", "d5", "c4", "c6", "Nc3", "Nf6", "e3", "Bf5"] },
    { name = "Slav Defense - Krause Variation"; moves = ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "e3", "Bg4"] },
    { name = "Slav Defense - Alapin Variation"; moves = ["d4", "d5", "c4", "c6", "Nc3", "Nf6", "e3", "a6"] },
    { name = "King's Indian Defense - Classical Variation"; moves = ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Nf3", "O-O", "Be2", "e5"] },
    { name = "King's Indian Defense - Samisch Variation"; moves = ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "f3"] },
    { name = "King's Indian Defense - Fianchetto Variation"; moves = ["d4", "Nf6", "c4", "g6", "Nf3", "Bg7", "g3"] },
    { name = "King's Indian Defense - Averbakh Variation"; moves = ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Be2", "O-O", "Bg5"] },
    { name = "King's Indian Defense - Four Pawns Attack"; moves = ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "f4"] },
    { name = "King's Indian Defense - Bayonet Attack"; moves = ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Nf3", "O-O", "Be2", "e5", "O-O", "Nc6", "d5", "Ne7", "b4"] },
    { name = "King's Indian Defense - Petrosian Variation"; moves = ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Be2", "O-O", "Nf3", "e5", "d5"] },
    { name = "King's Indian Defense - Makogonov Variation"; moves = ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "h3"] },
    { name = "King's Indian Defense - Gligoric Variation"; moves = ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Nf3", "O-O", "Be2", "e5", "O-O", "Nc6", "d5", "Ne7", "Be3"] },
    { name = "King's Indian Defense - Saemisch with h3"; moves = ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "f3", "O-O", "Be3", "e5", "d5", "c6", "h3"] },
    { name = "English Opening - Symmetrical Variation"; moves = ["c4", "c5"] },
    { name = "English Opening - Reversed Sicilian"; moves = ["c4", "e5"] },
    { name = "English Opening - King's Indian Setup"; moves = ["c4", "Nf6", "Nc3", "g6"] },
    { name = "English Opening - Queen's Gambit Setup"; moves = ["c4", "e6", "Nc3", "d5"] },
    { name = "English Opening - Slav Setup"; moves = ["c4", "c6"] },
    { name = "English Opening - Nimzo-Indian Setup"; moves = ["c4", "Nf6", "Nc3", "e6"] },
    { name = "English Opening - Anglo-Dutch"; moves = ["c4", "f5"] },
    { name = "English Opening - Anglo-Grünfeld"; moves = ["c4", "Nf6", "Nc3", "d5"] },
    { name = "English Opening - Anglo-Caro"; moves = ["c4", "c6", "e4", "d5"] },
    { name = "English Opening - Botvinnik System"; moves = ["c4", "Nf6", "Nc3", "e6", "Nf3", "Bb4"] },
  ];

  // ---------- SAN parsing helpers ----------
  //
  // The chess engine does not expose a SAN-to-Move parser, so we parse SAN
  // strings directly into Move records here. The parser handles the subset of
  // SAN that appears in the openings list above:
  //   - Castling: "O-O" (kingside), "O-O-O" (queenside)
  //   - Pawn moves: "e4", "cxd4" (capture), "exd5" (en-passant capture, same
  //     shape as a normal pawn capture)
  //   - Piece moves: "Nf3", "Nbd7" (file disambiguation), "N1f2" (rank
  //     disambiguation), "Nxd4" (capture), "Qxf7" (capture), "Bxc6" (capture)
  //   - Promotion: "e8=Q" (promotion on a quiet pawn push), "exd8=Q"
  //     (promotion on a capture)
  //   - Check/mate suffixes ("+", "#") are stripped — they do not affect the
  //     move itself.
  //
  // The parser returns ?Move; on any parse failure it returns null and the
  // caller's try/catch falls back to the standard starting position. We also
  // validate each parsed move with ChessGame.isValidMove before applying it,
  // so a syntactically-valid-but-illegal move also triggers the fallback.

  // Convert a file character ('a'..'h') to a file index (0..7), or return null.
  func fileFromChar(c : Char) : ?Nat {
    let code = c.toNat32().toNat();
    if (code >= 0x61 and code <= 0x68) ?(code - 0x61) // 'a'..'h'
    else null;
  };

  // Convert a rank character ('1'..'8') to a rank index (0..7), or return null.
  func rankFromChar(c : Char) : ?Nat {
    let code = c.toNat32().toNat();
    if (code >= 0x31 and code <= 0x38) ?(code - 0x31) // '1'..'8'
    else null;
  };

  // Convert a piece letter ('K','Q','R','B','N') to its PieceType. Pawn is
  // implied (no letter in SAN). Returns null for unknown letters.
  func pieceTypeFromLetter(c : Char) : ?PieceType {
    switch (c) {
      case ('K') ?#King;
      case ('Q') ?#Queen;
      case ('R') ?#Rook;
      case ('B') ?#Bishop;
      case ('N') ?#Knight;
      case (_) null;
    };
  };

  // Parse a SAN string into a Move, given the current board and the team to
  // move. Returns null on any parse failure. The team is needed to resolve
  // castling (king/rook squares depend on color) and to disambiguate piece
  // moves by searching the board for a matching piece that can reach the
  // destination.
  func parseSan(board : Board, san : Text, team : Team) : ?Move {
    // Strip check/mate suffixes (they appear only at the end of SAN).
    var s = san;
    s := s.trimEnd(#char '+');
    s := s.trimEnd(#char '#');
    let arr = s.toArray();
    if (arr.size() == 0) return null;

    // Castling: "O-O" (kingside) or "O-O-O" (queenside). The king moves from
    // its home square (e1/e8) two files toward the rook.
    if (arr.size() >= 3 and arr[0] == 'O' and arr[1] == '-' and arr[2] == 'O') {
      let kingStart : Nat = if (team == #White) 4 else 60; // e1 / e8
      let rank8 : Nat = if (team == #White) 0 else 7;
      let kingside = arr.size() == 3; // "O-O"
      let queenside = arr.size() == 5 and arr[3] == '-' and arr[4] == 'O'; // "O-O-O"
      if (kingside) {
        let to = ChessGame.square(6, rank8); // g-file
        return ?{ fromSquare = kingStart; toSquare = to; promotion = null };
      } else if (queenside) {
        let to = ChessGame.square(2, rank8); // c-file
        return ?{ fromSquare = kingStart; toSquare = to; promotion = null };
      } else {
        return null;
      };
    };

    // Promotion suffix: "=Q" / "=R" / "=B" / "=N" at the end.
    var promotion : ?PieceType = null;
    var lastIdx = arr.size() - 1;
    if (lastIdx >= 2 and arr[lastIdx - 1] == '=') {
      promotion := pieceTypeFromLetter(arr[lastIdx]);
      if (promotion == null) return null;
      lastIdx -= 2; // drop the "=X" suffix
    };

    // The destination square is the last two chars (file, rank) of the
    // remaining move text.
    if (lastIdx < 1) return null;
    let destFileOpt = fileFromChar(arr[lastIdx - 1]);
    let destRankOpt = rankFromChar(arr[lastIdx]);
    let destFile = switch (destFileOpt) { case (?f) f; case null return null };
    let destRank = switch (destRankOpt) { case (?r) r; case null return null };
    let toSquare = ChessGame.square(destFile, destRank);

    // Determine the piece type and the disambiguation prefix.
    var idx = 0;
    var pieceType : PieceType = #Pawn;
    let first = arr[0];
    let firstIsPiece = switch (pieceTypeFromLetter(first)) {
      case (?_) true;
      case null false;
    };
    if (firstIsPiece) {
      pieceType := switch (pieceTypeFromLetter(first)) { case (?p) p; case null return null };
      idx := 1;
    };

    // Remaining chars between the piece letter (if any) and the destination
    // square: disambiguation (file and/or rank) and/or a capture 'x'.
    var disambigFile : ?Nat = null;
    var disambigRank : ?Nat = null;
    while (idx < lastIdx - 1) {
      let c = arr[idx];
      switch (fileFromChar(c)) {
        case (?f) disambigFile := ?f;
        case null {
          switch (rankFromChar(c)) {
            case (?r) disambigRank := ?r;
            case null {
              if (c != 'x') return null; // 'x' is allowed; anything else is invalid
            };
          };
        };
      };
      idx += 1;
    };

    // Find the source square: search the board for a piece of the right type
    // and color that can legally move to toSquare, filtered by the
    // disambiguation hints. We rely on ChessGame.isValidMove for legality so
    // the search is both a parse-resolution and a legality check.
    var fromSquare : ?Nat = null;
    var candidate = 0;
    label search while (candidate < 64) {
      let p = switch (board[candidate]) { case (?p) p; case null { candidate += 1; continue search } };
      if (p.color != team or p.pieceType != pieceType) { candidate += 1; continue search };
      // Apply disambiguation filters.
      switch (disambigFile) {
        case (?f) { if (ChessGame.file(candidate) != f) { candidate += 1; continue search } };
        case null {};
      };
      switch (disambigRank) {
        case (?r) { if (ChessGame.rank(candidate) != r) { candidate += 1; continue search } };
        case null {};
      };
      let move : Move = { fromSquare = candidate; toSquare; promotion };
      if (ChessGame.isValidMove(board, move, team)) {
        fromSquare := ?candidate;
        break search;
      };
      candidate += 1;
    };

    switch (fromSquare) {
      case (?f) ?{ fromSquare = f; toSquare; promotion };
      case null null;
    };
  };

  // ---------- Recorder metadata helpers ----------
  //
  // Mirror the recorder-metadata computation in attemptMove
  // (chess-game-api.mo lines 820-891) so each opening move is recorded with
  // the same shape as a real player move. The recorder stays the single source
  // of truth; the frontend MoveHistory derives moves by diffing polled board
  // snapshots, so recording the opening moves here makes them appear
  // automatically on the next poll.

  // Build a simple from/to/promotion notation like "e2e4" or "e7e8Q", matching
  // the notation format attemptMove uses (squareToAlgebraic + promotionSuffix).
  func squareToAlgebraic(sq : Nat) : Text {
    let f = ChessGame.file(sq);
    let r = ChessGame.rank(sq);
    let fileChar = switch (f) {
      case (0) "a"; case (1) "b"; case (2) "c"; case (3) "d";
      case (4) "e"; case (5) "f"; case (6) "g"; case (7) "h";
      case (_) "";
    };
    let rankChar = switch (r) {
      case (0) "1"; case (1) "2"; case (2) "3"; case (3) "4";
      case (4) "5"; case (5) "6"; case (6) "7"; case (7) "8";
      case (_) "";
    };
    fileChar # rankChar;
  };

  func promotionSuffix(promotion : ?PieceType) : Text {
    switch (promotion) {
      case null "";
      case (?t) {
        switch (t) {
          case (#Queen) "Q";
          case (#Rook) "R";
          case (#Bishop) "B";
          case (#Knight) "N";
          case (_) "";
        };
      };
    };
  };

  // ---------- Entry point ----------

  // Select an opening uniformly at random, replay its moves through the
  // existing ChessGame.applyMove path (so the recorder remains the single
  // source of truth), and return the resulting board, the opening's display
  // name, and the ply count.
  //
  // Signature (matches the startNewGame hook contract):
  //   public func applyRandomOpening(board : [?Piece], recorder : GameRecorder.RecorderStore)
  //     : async { board : [?Piece]; openingName : Text; plyCount : Nat }
  //
  // The hook passes the freshly-reset board and the active recorder. It uses
  // the returned board to set gameState.board, uses plyCount to determine
  // which team moves next (even -> #White, odd -> #Black), and uses
  // openingName for the notification.
  //
  // Fallback: on ANY exception during replay (a move that fails to parse or
  // is rejected by isValidMove), the module returns the original board
  // untouched with openingName = "Standard Starting Position" and plyCount = 0.
  // The originalBoard is never mutated before the try block — replay works on
  // a local mutable copy.
  public func applyRandomOpening(
    originalBoard : Board,
    recorder : RecorderStore,
  ) : async { board : Board; openingName : Text; plyCount : Nat } {
    // Select an opening uniformly at random: index 0..99 inclusive (100
    // total named openings). Random.natRange(fromInclusive, toExclusive) so
    // the upper bound is 100. The Standard Starting Position is NOT part of
    // this array — it is offered separately via the #Standard voting path.
    let idx = await Random.natRange(0, 100);
    let opening = openings[idx];

    // Work on a local mutable copy so the original board is never mutated
    // before the try block. On any failure we return the original untouched.
    var currentBoard : Board = originalBoard;
    var plyCount : Nat = 0;
    var replayedName : Text = opening.name;

    try {
      // Replay each SAN move in order, feeding the returned board into the
      // next applyMove call (fold/reduce over the move list).
      for (san in opening.moves.values()) {
        // The team to move alternates by ply: ply 0 -> #White, ply 1 -> #Black, ...
        let team : Team = if (plyCount % 2 == 0) #White else #Black;
        // Parse the SAN into a Move. parseSan also validates the move via
        // isValidMove, so an illegal move returns null and we trap below to
        // trigger the fallback.
        let move = switch (parseSan(currentBoard, san, team)) {
          case (?m) m;
          case null Runtime.trap("openings: failed to parse SAN: " # san);
        };
        // Compute recorder metadata from the pre-move board, mirroring
        // attemptMove (chess-game-api.mo lines 820-891).
        let preMoveBoard = currentBoard;
        let movingPiece = switch (preMoveBoard[move.fromSquare]) {
          case (?p) p;
          case null ({ pieceType = #Pawn; color = team; summoned = false });
        };
        let isEnPassant = movingPiece.pieceType == #Pawn
          and ChessGame.file(move.fromSquare) != ChessGame.file(move.toSquare)
          and preMoveBoard[move.toSquare] == null;
        let capturedPiece : ?PieceType = if (isEnPassant) {
          let capSq = ChessGame.square(
            ChessGame.file(move.toSquare),
            ChessGame.rank(move.fromSquare),
          );
          switch (preMoveBoard[capSq]) {
            case (?cap) ?cap.pieceType;
            case null null;
          };
        } else {
          switch (preMoveBoard[move.toSquare]) {
            case (?cap) ?cap.pieceType;
            case null null;
          };
        };
        let isCastling = movingPiece.pieceType == #King
          and Int.abs(ChessGame.file(move.fromSquare) - ChessGame.file(move.toSquare)) == 2;
        // Apply the move through the existing engine path — returns a NEW
        // board array; the recorder is NOT bypassed.
        let newBoard = ChessGame.applyMove(preMoveBoard, move);
        // gaveCheck: the opponent (next team to move) is in check on the new board.
        let nextTeamForCheck = ChessGame.opponent(team);
        let gaveCheck = ChessGame.isInCheck(newBoard, nextTeamForCheck);
        // Record the move through the existing game recorder so the
        // frontend MoveHistory (which derives moves by diffing polled board
        // snapshots) shows the opening moves automatically. The opening
        // moves are pre-game setup, not attributed to a real player, so we
        // use username = "Opening" and timestamp = 0 (pre-game). The team
        // alternates by ply so the recorder's per-move team field is
        // accurate.
        let notation = squareToAlgebraic(move.fromSquare)
          # squareToAlgebraic(move.toSquare)
          # promotionSuffix(move.promotion);
        let recorded = GameRecorder.recordMove(
          recorder.moves.size(),
          "Opening",
          team,
          move.fromSquare,
          move.toSquare,
          notation,
          gaveCheck,
          capturedPiece,
          isCastling,
          move.promotion,
          isEnPassant,
          0, // pre-game timestamp
        );
        GameRecorder.appendMove(recorder, recorded);
        // Advance to the next ply with the new board.
        currentBoard := newBoard;
        plyCount += 1;
      };
    } catch _ {
      // Fallback: any exception during replay (parse failure, illegal move,
      // unexpected trap) returns the Standard Starting Position. The
      // original board is untouched (we only mutated the local currentBoard
      // and the recorder). The recorder may have partial opening moves
      // appended before the failure; the hook task is responsible for the
      // recorder's lifecycle (it activates the recorder before calling this
      // entry point and may reset it on fallback if desired — but per the
      // contract, the fallback returns the original board and plyCount = 0,
      // and the hook treats plyCount = 0 as "no opening applied").
      return { board = originalBoard; openingName = standardName; plyCount = 0 };
    };

    { board = currentBoard; openingName = replayedName; plyCount };
  };
};
