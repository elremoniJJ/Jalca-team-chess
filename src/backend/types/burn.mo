import Common "common";

module {
  // Re-export shared types for convenience.
  public type PseudoPrincipal = Common.PseudoPrincipal;
  public type Timestamp = Common.Timestamp;
  public type Team = Common.Team;

  // The section of a team's spell-burning window a burned spell is listed
  // under. Subao Ve is the single defensive BLOCK spell (a shield); Minor and
  // Major are the attacking spell tiers; Balls is the legacy offensive Balls
  // tier (Sandy/Cloudy/Grassy/Fiery/Wooden Balls). The first turn of a game
  // only allows burning a defensive Subao Ve NFT.
  public type BurnedSpellCategory = {
    #SubaoVe;
    #Minor;
    #Major;
    #Balls;
  };

  // The per-spell cast outcome recorded when a spell is cast and resolved, so
  // the team windows can show a tick, a cross or a question mark next to each
  // cast spell:
  //   - #succeeded: the spell was cast and Subao Ve did not prevent it (it
  //     fired on the board).
  //   - #prevented: the spell was cast but Subao Ve prevented it (the shield
  //     absorbed it and it did not land on the board).
  //   - #noEffect: the spell was cast and burned but had no effect on Subao Ve
  //     and did not land on the board (e.g. a legacy inert burn or a bug).
  public type SpellCastOutcome = {
    #succeeded;
    #prevented;
    #noEffect;
  };

  // A single burned spell entry recorded in a team's window. Carries the
  // spell name and Game number (both required for eligibility — NFTs without
  // a spell name or Game number are ignored and cannot be burned) plus the
  // team that burned it, the category section it is listed under, and the
  // per-spell cast outcome (tick / cross / question mark).
  public type BurnedSpell = {
    spellName : Text;
    gameNumber : Nat;
    team : Team;
    category : BurnedSpellCategory;
    outcome : SpellCastOutcome;
  };

  // One team's spell-burning window for the current turn. The Minor/Major
  // attacking spells and the Subao Ve defensive shield+power spells are kept
  // in separate lists so the frontend renders them in the correct section of
  // the team window.
  public type TeamWindow = {
    minorMajorSpells : [BurnedSpell];
    subaoVeSpells : [BurnedSpell];
  };

  // The burn state. The per-turn flags (burnOccurredThisTurn, burnedByTeam)
  // are reset when a new turn begins (resetBurnForNewTurn). The team spell
  // windows accumulate every cast spell for the whole game and are cleared
  // only at game start and game end (resetBurnForNewGame). The burn does NOT
  // modify the chessboard or pieces.
  public type BurnState = {
    var burnOccurredThisTurn : Bool;
    var burnedByTeam : ?Team;
    var whiteWindow : TeamWindow;
    var blackWindow : TeamWindow;
  };

  // Mutable record cell wrapping the burn-domain stable state. Mixin
  // parameters are immutable bindings, so reassigning the state requires a
  // mutable field on a shared record (records are passed by reference) —
  // same rationale as PlayerStore.
  public type BurnStore = { var state : BurnState };

  // Shared (immutable) projection of the burn state returned to clients.
  // BurnState carries mutable `var` fields (non-shared), so the query returns
  // this shared snapshot instead of the mutable record.
  public type BurnStateSnapshot = {
    burnOccurredThisTurn : Bool;
    burnedByTeam : ?Team;
    whiteWindow : TeamWindow;
    blackWindow : TeamWindow;
  };

  // The burn request the Move_Maker submits after their Oisy ICRC-7 transfer
  // succeeds. Carries the spell name and Game number (both required for
  // eligibility) and the category section the burned spell is listed under.
  public type BurnRequest = {
    spellName : Text;
    gameNumber : Nat;
    category : BurnedSpellCategory;
  };

  // The result of a burn action. #ok carries the updated burn-state snapshot;
  // #err carries a human-readable rejection reason (not the Move_Maker, burn
  // already recorded this turn, first-turn attacking spell, or missing spell
  // name / Game number).
  public type BurnResult = {
    #ok : BurnStateSnapshot;
    #err : Text;
  };
};
