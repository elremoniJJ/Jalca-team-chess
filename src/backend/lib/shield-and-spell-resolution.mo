import Array "mo:core/Array";

import BurnTypes "../types/burn";
import ChessGameTypes "../types/chess-game";
import RecorderTypes "../types/game-recorder";
import Types "../types/shield-and-spell-resolution";
import Nft "../lib/nft";
import ChessGame "../lib/chess-game";
import SpellState "../lib/spell-state";
import Spells "../lib/spells";
import Burn "../lib/burn";

module {
  public type Team = Types.Team;
  public type SpellKind = Types.SpellKind;
  public type BallsColourFamily = Types.BallsColourFamily;
  public type OpponentBoardImage = Types.OpponentBoardImage;
  public type TeamShield = Types.TeamShield;
  public type ShieldState = Types.ShieldState;
  public type SpellResolutionOutcome = Types.SpellResolutionOutcome;
  public type SpellResolution = Types.SpellResolution;
  public type BurnAndPlayResult = Types.BurnAndPlayResult;
  public type BurnAndPlayResult2 = Types.BurnAndPlayResult2;
  public type ShieldResolutionState = Types.ShieldResolutionState;
  public type ShieldResolutionStore = Types.ShieldResolutionStore;
  public type ShieldResolutionSnapshot = Types.ShieldResolutionSnapshot;
  public type BurnAndPlayRequest = Types.BurnAndPlayRequest;
  public type SpellCastOutcome = Types.SpellCastOutcome;

  // Construct a fresh, empty shield-and-spell-resolution state cell. Used by
  // the migration to initialize the domain's stable state. Both shields start
  // at zero and no burn-and-play result is pending.
  public func newShieldResolutionStore() : ShieldResolutionStore {
    {
      var state = {
        var whiteShield = 0;
        var blackShield = 0;
        var lastBurnAndPlay = null;
      };
    };
  };

  // Compute a spell's value: the current game number minus the NFT's game
  // number, saturating at zero. Older NFTs (lower acquisition game number)
  // are more powerful. Returns null when the NFT carries no game number (a
  // legacy NFT), which excludes it from shield math entirely.
  public func spellValue(currentGameNumber : Nat, nftGameNumber : ?Nat) : ?Nat {
    switch (nftGameNumber) {
      case null null;
      case (?nft) {
        if (currentGameNumber > nft) {
          ?(currentGameNumber - nft);
        } else {
          ?0;
        };
      };
    };
  };

  // Resolve one played offensive spell against the defending team's shield.
  // The spell fires on the board when its value strictly exceeds the shield,
  // OR when its value is at least double the shield (which depletes the shield
  // to zero and still takes effect on the board). Otherwise the spell is
  // cancelled: it reduces the shield by the spell value (floored at zero) with
  // no board effect. A legacy NFT (no game number) resolves as #legacy and
  // affects nothing.
  public func resolveSpell(
    currentGameNumber : Nat,
    attacker : Team,
    defender : Team,
    shieldBefore : Nat,
    nftGameNumber : ?Nat,
  ) : SpellResolution {
    switch (spellValue(currentGameNumber, nftGameNumber)) {
      case null {
        // Legacy NFT: excluded from shield math entirely.
        {
          attacker;
          defender;
          spellValue = 0;
          shieldBefore;
          shieldAfter = shieldBefore;
          outcome = #legacy;
          firesOnBoard = false;
        };
      };
      case (?value) {
        // Fires when the value strictly exceeds the shield, or is at least
        // double the shield. Both branches deplete the shield to zero.
        let fires = value > shieldBefore or value >= 2 * shieldBefore;
        if (fires) {
          {
            attacker;
            defender;
            spellValue = value;
            shieldBefore;
            shieldAfter = 0;
            outcome = #fired;
            firesOnBoard = true;
          };
        } else {
          // Cancelled: reduce the shield by the spell value, floored at zero.
          let after = if (value >= shieldBefore) 0 else shieldBefore - value;
          {
            attacker;
            defender;
            spellValue = value;
            shieldBefore;
            shieldAfter = after;
            outcome = #cancelled;
            firesOnBoard = false;
          };
        };
      };
    };
  };

  // Map a spell resolution onto the per-spell cast outcome recorded on the
  // burn state: a resolution that fired on the board is #succeeded, a
  // cancelled resolution is #prevented, and a legacy resolution is #noEffect.
  public func castOutcomeForResolution(resolution : SpellResolution) : SpellCastOutcome {
    switch (resolution.outcome) {
      case (#fired) #succeeded;
      case (#cancelled) #prevented;
      case (#legacy) #noEffect;
    };
  };

  // Add a Subao Ve's value to the burning team's shield, stacking additively
  // with any existing shield. Returns the updated shield state. A legacy NFT
  // (no game number) adds nothing.
  public func addShield(
    state : ShieldResolutionStore,
    team : Team,
    currentGameNumber : Nat,
    nftGameNumber : ?Nat,
  ) : ShieldState {
    switch (spellValue(currentGameNumber, nftGameNumber)) {
      case null {
        // Legacy NFT: adds nothing.
      };
      case (?value) {
        switch (team) {
          case (#White) state.state.whiteShield := state.state.whiteShield + value;
          case (#Black) state.state.blackShield := state.state.blackShield + value;
        };
      };
    };
    getShieldState(state);
  };

  // Read the current per-game shield totals for both teams.
  public func getShieldState(state : ShieldResolutionStore) : ShieldState {
    {
      whiteShield = state.state.whiteShield;
      blackShield = state.state.blackShield;
    };
  };

  // Read the current shield-and-spell-resolution snapshot (both shields plus
  // the pending burn-and-play result for the toast poll).
  public func getShieldResolutionSnapshot(state : ShieldResolutionStore) : ShieldResolutionSnapshot {
    {
      whiteShield = state.state.whiteShield;
      blackShield = state.state.blackShield;
      lastBurnAndPlay = state.state.lastBurnAndPlay;
    };
  };

  // Map a Balls spell name to its fixed colour family. The spell name alone
  // determines the family — there is no per-NFT colour variation. Returns
  // null for any name that is not one of the five Balls spells.
  public func ballsColourFor(spellName : Text) : ?BallsColourFamily {
    switch (spellName) {
      case ("Sandy Balls") ?#Sandy;
      case ("Cloudy Balls") ?#Cloudy;
      case ("Grassy Balls") ?#Grassy;
      case ("Fiery Balls") ?#Fiery;
      case ("Wooden Balls") ?#Wooden;
      case (_) null;
    };
  };

  // Map one of the three offensive image-spell names to its opponent-board
  // image slug. The spell name alone determines the slug — there is no per-NFT
  // variation. Returns null for any name that is not one of the three image
  // spells (including the five existing Balls colour spells, which paint the
  // caster's own board instead). Pure and unit-testable.
  public func opponentImageFor(spellName : Text) : ?OpponentBoardImage {
    Spells.opponentImageFor(spellName);
  };

  // Whether a knight standing on `square` would attack the king of `kingTeam`
  // on `board`. Tests only the eight L-shaped knight offsets from `square`
  // against the king's square — not a full isInCheck evaluation. Pure.
  func knightAttacksKing(board : [?ChessGameTypes.Piece], square : Nat, kingTeam : Team) : Bool {
    let f = ChessGame.file(square);
    let r = ChessGame.rank(square);
    let offsets : [(Int, Int)] = [
      (1, 2), (2, 1), (2, -1), (1, -2),
      (-1, -2), (-2, -1), (-2, 1), (-1, 2),
    ];
    for ((df, dr) in offsets.values()) {
      let cf = f + df;
      let cr = r + dr;
      if (cf >= 0 and cf < 8 and cr >= 0 and cr < 8) {
        let target = ChessGame.square(Int.abs(cf), Int.abs(cr));
        switch (board[target]) {
          case (?p) {
            if (p.color == kingTeam and p.pieceType == #King) return true;
          };
          case null {};
        };
      };
    };
    false;
  };

  // Apply the Newkai Dodan board effect: every enemy queen is handled
  // independently. A queen is replaced by an enemy knight on the same square,
  // unless that knight would attack the caster's king (the eight L-shaped
  // offsets from the queen's square), in which case the queen is destroyed
  // instead. Returns the new board, the squares of destroyed queens (for the
  // skull marker) and the squares of transformed queens (for the summoned
  // glow). Pure board read/write.
  func newkaiDodanEffect(
    board : [?ChessGameTypes.Piece],
    team : Team,
  ) : { board : [?ChessGameTypes.Piece]; removedSquares : [Nat]; transformedSquares : [Nat] } {
    let enemy = ChessGame.opponent(team);
    var current = board;
    var removedSquares : [Nat] = [];
    var transformedSquares : [Nat] = [];
    var i = 0;
    while (i < 64) {
      switch (current[i]) {
        case (?p) {
          if (p.color == enemy and p.pieceType == #Queen) {
            if (knightAttacksKing(current, i, team)) {
              // The knight would check the caster's king: destroy the queen.
              current := Array.tabulate(
                64,
                func(j) { if (j == i) null else current[j] },
              );
              removedSquares := removedSquares.concat([i]);
            } else {
              // Replace the queen with an enemy knight on the same square.
              current := Array.tabulate(
                64,
                func(j) {
                  if (j == i) ?{ pieceType = #Knight; color = enemy; summoned = false }
                  else current[j];
                },
              );
              transformedSquares := transformedSquares.concat([i]);
            };
          };
        };
        case null {};
      };
      i += 1;
    };
    { board = current; removedSquares; transformedSquares };
  };

  // Burn and play an NFT spell for the current Move_Maker. Enforces the burn
  // restrictions server-side (Move_Maker-only, one burn per turn, opening
  // Move_Maker restricted to Subao Ve, spell-name eligibility), applies the
  // shield math (Subao Ve adds to the burning team's shield; an offensive
  // spell resolves against the defending team's shield), records the
  // burn-and-play result for the toast, and records the cast spell with its
  // per-spell outcome on the burn state so the team windows can show a tick,
  // a cross or a question mark. The burn does NOT modify the chessboard or
  // pieces.
  public func burnAndPlay(
    state : ShieldResolutionStore,
    burnStore : BurnTypes.BurnStore,
    gameState : ChessGameTypes.GameState,
    players : ChessGameTypes.PlayerStore,
    recorder : RecorderTypes.RecorderStore,
    principal : ChessGameTypes.PseudoPrincipal,
    request : Types.BurnAndPlayRequest,
  ) : async Types.BurnAndPlayResult2 {
    // Restriction 1: only the current Move_Maker may burn and play.
    switch (gameState.moveMakerPrincipal) {
      case (?maker) {
        if (maker != principal) {
          return #err("Only the current Move_Maker can burn an NFT spell");
        };
      };
      case null {
        return #err("Only the current Move_Maker can burn an NFT spell");
      };
    };
    // Restriction 2: only one burn may be recorded per turn.
    if (burnStore.state.burnOccurredThisTurn) {
      return #err("A spell has already been burned this turn");
    };
    // Restriction 3: the NFT must carry a spell name to be burned.
    if (request.spellName.isEmpty()) {
      return #err("The NFT must carry a spell name to be burned");
    };
    // Resolve the burning team from the Move_Maker's player record.
    let team : Team = switch (findPlayerTeam(players, principal)) {
      case (?t) t;
      case null {
        return #err("Only the current Move_Maker can burn an NFT spell");
      };
    };
    // Restriction 4: the opening Move_Maker may only burn a defensive Subao Ve.
    // The opening turn is the first turn of the game, before any REAL move has
    // been made since the opening finished. A Random opening pre-fills the
    // recorder with its replay moves, so the check compares the recorder's move
    // count against the number of moves the opening seeded (zero for the
    // Standard Starting Position) rather than against zero.
    let isOpeningTurn = recorder.moves.size() == recorder.openingMoveCount;
    if (isOpeningTurn and request.kind != #SubaoVe) {
      return #err("The first turn only allows burning a Subao Ve spell");
    };
    // Perform the real burn through the existing burn path. The external
    // collection canister is the source of truth; a failed burn maps to a
    // per-token #err and never traps. The burn must succeed before any shield
    // or board state is mutated.
    let outcome = await Nft.burnNft(request.tokenId);
    switch (outcome) {
      case (#failed(reason)) {
        return #err(reason);
      };
      case (#burnedLegacy(_reason)) {
        // The token was destroyed but carried no usable spell metadata. It
        // burns inert: no shield math, no board effect. Record the cast spell
        // as #noEffect (cast and burned but affected neither Subao Ve nor the
        // board) and the pending result with a null resolution.
        let result : BurnAndPlayResult = {
          tokenId = request.tokenId;
          spellName = request.spellName;
          gameNumber = request.gameNumber;
          team;
          kind = request.kind;
          resolution = null;
          appliedColour = null;
          appliedOpponentImage = null;
          legacyReason = ?_reason;
          spellCheckWin = null;
          castOutcome = ?#noEffect;
          removedSquares = [];
          transformedSquares = [];
          insufficientMaterial = false;
        };
        state.state.lastBurnAndPlay := ?result;
        let legacyGameNumber = switch (request.gameNumber) {
          case null 0;
          case (?n) n;
        };
        Burn.appendBurnedSpell(burnStore, team, request.spellName, legacyGameNumber, categoryForKind(request.kind), #noEffect);
        burnStore.state.burnOccurredThisTurn := true;
        burnStore.state.burnedByTeam := ?team;
        return #ok({ burn = result; shieldState = getShieldState(state) });
      };
      case (#burnedWithSpell({ spellName; gameNumber })) {
        // The token was destroyed and carried a usable spell. Apply the shield
        // math and board effects, then record the result.
        let currentGameNumber = gameState.gameNumber;
        let defender : Team = switch (team) {
          case (#White) #Black;
          case (#Black) #White;
        };
        // A defensive Subao Ve adds to the burning team's shield; an offensive
        // spell resolves against the defending team's shield.
        let resolution : ?SpellResolution = switch (request.kind) {
          case (#SubaoVe) {
            ignore addShield(state, team, currentGameNumber, ?gameNumber);
            null;
          };
          case (_) {
            let shieldBefore = switch (defender) {
              case (#White) state.state.whiteShield;
              case (#Black) state.state.blackShield;
            };
            let res = resolveSpell(currentGameNumber, team, defender, shieldBefore, ?gameNumber);
            // Write the resolved shield back to the defending team.
            switch (defender) {
              case (#White) state.state.whiteShield := res.shieldAfter;
              case (#Black) state.state.blackShield := res.shieldAfter;
            };
            ?res;
          };
        };
        // Apply the board effect when the spell fired on the board.
        let firesOnBoard = switch (resolution) {
          case null false;
          case (?res) res.firesOnBoard;
        };
        var appliedColour : ?BallsColourFamily = null;
        var appliedOpponentImage : ?OpponentBoardImage = null;
        var removedSquares : [Nat] = [];
        var transformedSquares : [Nat] = [];
        // Whether the Newkai Dodan spell actually changed the board (at least
        // one enemy queen destroyed or transformed). When it did not, the
        // post-spell insufficient-material check does not run for that cast.
        var newkaiDodanApplied = false;
        if (firesOnBoard) {
          // Balls colour spells paint the CASTER's board.
          switch (ballsColourFor(spellName)) {
            case (?family) {
              gameState.spellBoardState := SpellState.applyBallsColour(gameState.spellBoardState, team, family);
              appliedColour := ?family;
            };
            case null {};
          };
          // Offensive image spells paint the DEFENDER's board.
          switch (opponentImageFor(spellName)) {
            case (?image) {
              gameState.spellBoardState := SpellState.applyOpponentImage(gameState.spellBoardState, team, image);
              appliedOpponentImage := ?image;
            };
            case null {};
          };
          // Bouvet Hondao blocks one empty square.
          if (spellName == "Bouvet Hondao") {
            gameState.spellBoardState := SpellState.blockBouvetHondao(
              gameState.spellBoardState,
              gameState.board,
              team,
              0,
            );
          };
          // Conu Bungno places a single-use explosive trap on one empty square.
          if (spellName == "Conu Bungno") {
            switch (ChessGame.findFirstEmptyFromCentre(gameState.board, gameState.spellBoardState.blockedSquares, team)) {
              case (?square) {
                let trap : SpellState.ExplosiveSquare = { square; owner = team };
                gameState.spellBoardState := {
                  blockedSquares = gameState.spellBoardState.blockedSquares;
                  blockedSquareOwners = gameState.spellBoardState.blockedSquareOwners;
                  explosiveSquares = gameState.spellBoardState.explosiveSquares.concat([trap]);
                  whiteBallsColour = gameState.spellBoardState.whiteBallsColour;
                  blackBallsColour = gameState.spellBoardState.blackBallsColour;
                  whiteOpponentImage = gameState.spellBoardState.whiteOpponentImage;
                  blackOpponentImage = gameState.spellBoardState.blackOpponentImage;
                };
              };
              case null {};
            };
          };
          // Enemy-removal spells mutate the board. Each removal returns the
          // square indices it emptied alongside the new board, so the frontend
          // can render the per-square death-square marker overlay.
          switch (Spells.removalTargetForName(spellName)) {
            case (?target) {
              switch (target) {
                case (#Both) {
                  let removal = SpellState.removeAllPieces(gameState.board, team, #Pawn, true);
                  gameState.board := removal.board;
                  removedSquares := removedSquares.concat(removal.removedSquares);
                };
                case (#Pawn) {
                  let removal = SpellState.removeAllPieces(gameState.board, team, #Pawn, false);
                  gameState.board := removal.board;
                  removedSquares := removedSquares.concat(removal.removedSquares);
                };
                case (#Rook) {
                  // Mayban Dadoy Tron removes ALL enemy Rooks; Bamburgh removes
                  // one. Distinguish by name.
                  let removal = if (spellName == "Mayban Dadoy Tron") {
                    SpellState.removeAllPieces(gameState.board, team, #Rook, false);
                  } else {
                    SpellState.removeEnemyPieces(gameState.board, team, #Rook, 1);
                  };
                  gameState.board := removal.board;
                  removedSquares := removedSquares.concat(removal.removedSquares);
                };
                case (#Knight) {
                  let removal = SpellState.removeEnemyPieces(gameState.board, team, #Knight, 1);
                  gameState.board := removal.board;
                  removedSquares := removedSquares.concat(removal.removedSquares);
                };
                case (#Bishop) {
                  let removal = SpellState.removeEnemyPieces(gameState.board, team, #Bishop, 1);
                  gameState.board := removal.board;
                  removedSquares := removedSquares.concat(removal.removedSquares);
                };
                case (#Queen) {
                  let removal = SpellState.removeEnemyPieces(gameState.board, team, #Queen, 1);
                  gameState.board := removal.board;
                  removedSquares := removedSquares.concat(removal.removedSquares);
                };
                case (#King) {
                  let removal = SpellState.removeEnemyPieces(gameState.board, team, #King, 1);
                  gameState.board := removal.board;
                  removedSquares := removedSquares.concat(removal.removedSquares);
                };
              };
            };
            case null {
              // The five Minor fire spells remove up to N enemy Pawns.
              switch (Spells.removalPawnCountForName(spellName)) {
                case (?count) {
                  let removal = SpellState.removeEnemyPieces(gameState.board, team, #Pawn, count);
                  gameState.board := removal.board;
                  removedSquares := removedSquares.concat(removal.removedSquares);
                };
                case null {};
              };
            };
          };
          // The five resurrection spells summon one brand-new friendly piece
          // of their type on the closest safe square to the centre, whether or
          // not that piece type was ever captured. When no safe square exists
          // the spell has no board effect.
          switch (summonPieceTypeForName(spellName)) {
            case (?pieceType) {
              switch (ChessGame.summonPiece(gameState.board, team, pieceType)) {
                case (?summoned) {
                  gameState.board := summoned.board;
                };
                case null {};
              };
            };
            case null {};
          };
          // Newkai Dodan turns every enemy queen into an enemy knight on the
          // same square, destroying any queen whose knight would attack the
          // caster's king. Destroyed queens go in removedSquares (skull
          // marker); transformed queens go in transformedSquares (summoned
          // glow). With no enemy queen the spell has no board effect and the
          // post-spell insufficient-material check does not run.
          if (spellName == "Newkai Dodan") {
            let effect = newkaiDodanEffect(gameState.board, team);
            gameState.board := effect.board;
            removedSquares := removedSquares.concat(effect.removedSquares);
            transformedSquares := transformedSquares.concat(effect.transformedSquares);
            if (effect.removedSquares.size() > 0 or effect.transformedSquares.size() > 0) {
              newkaiDodanApplied := true;
            };
          };
        };
        // Run the insufficient-material check on the board after the spell's
        // board effect, so a spell that leaves insufficient material triggers
        // the same draw the normal move path does. A Newkai Dodan cast with no
        // enemy queen has no board effect, so the check does not run for it.
        let insufficientMaterial =
          if (spellName == "Newkai Dodan" and not newkaiDodanApplied) {
            false;
          } else {
            ChessGame.isInsufficientMaterial(gameState.board);
          };
        // A spell win fires when the board effect left the defending king in
        // check. Only offensive spells can fire on the board, so a defensive
        // Subao Ve never triggers this.
        let spellCheckWin : ?Team =
          if (firesOnBoard and ChessGame.isInCheck(gameState.board, defender)) { ?team }
          else { null };
        // The per-spell cast outcome recorded on the burn state.
        let castOutcome : SpellCastOutcome = switch (resolution) {
          case null #noEffect;
          case (?res) castOutcomeForResolution(res);
        };
        let result : BurnAndPlayResult = {
          tokenId = request.tokenId;
          spellName;
          gameNumber = ?gameNumber;
          team;
          kind = request.kind;
          resolution;
          appliedColour;
          appliedOpponentImage;
          legacyReason = null;
          spellCheckWin;
          castOutcome = ?castOutcome;
          removedSquares;
          transformedSquares;
          insufficientMaterial;
        };
        state.state.lastBurnAndPlay := ?result;
        Burn.appendBurnedSpell(burnStore, team, spellName, gameNumber, categoryForKind(request.kind), castOutcome);
        burnStore.state.burnOccurredThisTurn := true;
        burnStore.state.burnedByTeam := ?team;
        return #ok({ burn = result; shieldState = getShieldState(state) });
      };
    };
  };

  // Reset the per-game shield state at the start of a new game: both shields
  // return to zero and the pending burn-and-play result is cleared. Called by
  // the chess mixin's new-game path.
  public func resetShieldForNewGame(state : ShieldResolutionStore) : () {
    state.state.whiteShield := 0;
    state.state.blackShield := 0;
    state.state.lastBurnAndPlay := null;
  };

  // Clear the pending burn-and-play result when a new turn begins, so the
  // toast does not re-fire for the previous turn. The shields are NOT reset
  // here — they persist for the whole game.
  public func clearBurnAndPlayForNewTurn(state : ShieldResolutionStore) : () {
    state.state.lastBurnAndPlay := null;
  };

  // Map a spell kind to the burn-state category section it is listed under.
  // The two variants are 1:1 (SubaoVe -> SubaoVe, Minor/Major/Balls -> the
  // matching section).
  func categoryForKind(kind : SpellKind) : BurnTypes.BurnedSpellCategory {
    switch (kind) {
      case (#SubaoVe) #SubaoVe;
      case (#Minor) #Minor;
      case (#Major) #Major;
      case (#Balls) #Balls;
    };
  };

  // Map one of the five resurrection spell names to the piece type it
  // summons. The burn path carries the on-chain spell name, so this is the
  // lookup it uses. Returns null for every other spell name.
  func summonPieceTypeForName(spellName : Text) : ?ChessGameTypes.PieceType {
    switch (spellName) {
      case ("Thayma") ?#Pawn;
      case ("Hipsy Titam") ?#Knight;
      case ("Lazarus") ?#Bishop;
      case ("Cuoclot Sac Wonmuc Rook") ?#Rook;
      case ("Anne Boleyn") ?#Queen;
      case (_) null;
    };
  };

  // Find the team of the player with the given principal, or null when no
  // player record matches.
  func findPlayerTeam(
    players : ChessGameTypes.PlayerStore,
    principal : ChessGameTypes.PseudoPrincipal,
  ) : ?Team {
    var i = 0;
    let items = players.items;
    while (i < items.size()) {
      if (items[i].principal == principal) {
        return ?items[i].team;
      };
      i += 1;
    };
    null;
  };
};
