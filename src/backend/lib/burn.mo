import BurnTypes "../types/burn";
import ChessGameTypes "../types/chess-game";
import RecorderTypes "../types/game-recorder";

module {
  // Record a burn of an NFT spell by the current Move_Maker. Enforces the
  // burn restrictions server-side: the caller must be the current Move_Maker,
  // no burn may already be recorded this turn, the first turn only allows a
  // defensive Subao Ve (Block) spell, and the NFT must carry a spell name and
  // a Game number. On success the burned spell is appended to the burning
  // team's window (White if the Move_Maker is on White, Black if on Black)
  // under the correct Minor/Major or Subao Ve section, carrying its per-spell
  // cast outcome. The burn does NOT modify the chessboard or pieces.
  //
  // This is the plain bookkeeping path: it records the cast spell but does not
  // resolve it against a shield, so the recorded outcome is #noEffect (the
  // spell was cast and burned but had no effect on Subao Ve and did not land
  // on the board). The burn-and-play path resolves the spell and records the
  // real #succeeded / #prevented / #noEffect outcome through the same
  // appendBurnedSpell helper.
  public func recordBurn(
    state : BurnTypes.BurnStore,
    gameState : ChessGameTypes.GameState,
    players : ChessGameTypes.PlayerStore,
    recorder : RecorderTypes.RecorderStore,
    principal : ChessGameTypes.PseudoPrincipal,
    request : BurnTypes.BurnRequest,
  ) : BurnTypes.BurnResult {
    // Restriction 1: only the current Move_Maker may record a burn.
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
    if (state.state.burnOccurredThisTurn) {
      return #err("A spell has already been burned this turn");
    };
    // Restriction 3: the NFT must carry a spell name to be burned.
    if (request.spellName.isEmpty()) {
      return #err("The NFT must carry a spell name to be burned");
    };
    // Resolve the burning team from the Move_Maker's player record.
    let team : BurnTypes.Team = switch (findPlayerTeam(players, principal)) {
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
    if (isOpeningTurn and request.category != #SubaoVe) {
      return #err("The first turn only allows burning a Subao Ve spell");
    };
    // All restrictions passed: append the burned spell to the burning team's
    // window under the correct section and flip the per-turn flag. The plain
    // bookkeeping path records #noEffect (no shield resolution happened here).
    appendBurnedSpell(state, team, request.spellName, request.gameNumber, request.category, #noEffect);
    state.state.burnOccurredThisTurn := true;
    state.state.burnedByTeam := ?team;
    #ok(toSnapshot(state.state));
  };

  // Append a burned spell entry to the burning team's window under the correct
  // section (subaoVeSpells for Subao Ve, minorMajorSpells for Minor/Major/
  // Balls), carrying the per-spell cast outcome. Shared by the burn and
  // burn-and-play paths so a cast spell is recorded exactly once with its
  // outcome.
  public func appendBurnedSpell(
    state : BurnTypes.BurnStore,
    team : BurnTypes.Team,
    spellName : Text,
    gameNumber : Nat,
    category : BurnTypes.BurnedSpellCategory,
    outcome : BurnTypes.SpellCastOutcome,
  ) : () {
    let entry : BurnTypes.BurnedSpell = {
      spellName;
      gameNumber;
      team;
      category;
      outcome;
    };
    let window = switch (team) {
      case (#White) state.state.whiteWindow;
      case (#Black) state.state.blackWindow;
    };
    let updated : BurnTypes.TeamWindow = switch (category) {
      case (#SubaoVe) {
        { window with subaoVeSpells = window.subaoVeSpells.concat([entry]) };
      };
      case (_) {
        { window with minorMajorSpells = window.minorMajorSpells.concat([entry]) };
      };
    };
    switch (team) {
      case (#White) state.state.whiteWindow := updated;
      case (#Black) state.state.blackWindow := updated;
    };
  };

  // Read the current burned-spell team-window state (White and Black
  // windows, each with their Minor/Major spells list and Subao Ve
  // shield+power section). The windows accumulate for the whole game.
  public func getBurnState(state : BurnTypes.BurnStore) : BurnTypes.BurnStateSnapshot {
    toSnapshot(state.state);
  };

  // Reset the per-turn burn flags when a new turn begins, so burn buttons
  // re-enable for the new Move_Maker. Called by the chess mixin when a move
  // completes and the turn advances. The team spell windows are NOT cleared
  // here: the 'Spells cast' list accumulates every cast spell for the whole
  // game and is cleared only at game start and game end
  // (resetBurnForNewGame).
  public func resetBurnForNewTurn(state : BurnTypes.BurnStore) : () {
    state.state.burnOccurredThisTurn := false;
    state.state.burnedByTeam := null;
  };

  // Reset the whole burn state at a game boundary (game start and game end):
  // clear the per-turn flags AND both teams' spell windows, so the 'Spells
  // cast' list starts empty for the new game and does not carry over from the
  // previous one. Called by the chess mixin's new-game path and by every
  // game-conclusion path (checkmate, draw, timeout).
  public func resetBurnForNewGame(state : BurnTypes.BurnStore) : () {
    state.state.burnOccurredThisTurn := false;
    state.state.burnedByTeam := null;
    state.state.whiteWindow := { minorMajorSpells = []; subaoVeSpells = [] };
    state.state.blackWindow := { minorMajorSpells = []; subaoVeSpells = [] };
  };

  // Project the mutable burn state into the shared (immutable) snapshot the
  // query returns. BurnState carries mutable `var` fields (non-shared), so the
  // query returns this snapshot instead of the mutable record.
  func toSnapshot(state : BurnTypes.BurnState) : BurnTypes.BurnStateSnapshot {
    {
      burnOccurredThisTurn = state.burnOccurredThisTurn;
      burnedByTeam = state.burnedByTeam;
      whiteWindow = state.whiteWindow;
      blackWindow = state.blackWindow;
    };
  };

  // Find the team of the player with the given principal, or null when no
  // player record matches. The Move_Maker's team decides which team window the
  // burned spell is appended to.
  func findPlayerTeam(
    players : ChessGameTypes.PlayerStore,
    principal : ChessGameTypes.PseudoPrincipal,
  ) : ?BurnTypes.Team {
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
