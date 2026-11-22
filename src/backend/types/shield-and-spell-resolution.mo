import Common "common";
import NftTypes "nft";
import SpellState "spell-state";
import BurnTypes "burn";

module {
  // Re-export shared types for convenience.
  public type PseudoPrincipal = Common.PseudoPrincipal;
  public type Timestamp = Common.Timestamp;
  public type Team = Common.Team;
  public type BallsColourFamily = SpellState.BallsColourFamily;
  public type OpponentBoardImage = SpellState.OpponentBoardImage;
  public type LegacyReason = NftTypes.LegacyReason;
  // The per-spell cast outcome recorded on the burn state, re-exported so the
  // resolution domain can map a resolution onto it without a second variant.
  public type SpellCastOutcome = BurnTypes.SpellCastOutcome;

  // The spell kind of a played NFT spell, as it participates in shield
  // resolution. Subao Ve is the defensive BLOCK (a shield contribution);
  // Minor and Major are the attacking tiers that reduce the defending team's
  // shield; Balls is the legacy offensive Balls tier, which resolves against
  // the defending team's shield exactly like Minor/Major. Mirrors
  // BurnedSpellCategory in types/burn.mo (1:1 variant mapping).
  public type SpellKind = {
    #SubaoVe;
    #Minor;
    #Major;
    #Balls;
  };

  // One team's per-game shield total. The shield is a single additive Nat
  // that resets to 0 at the start of every new game (no carry-over between
  // games). Burning a Subao Ve adds its value (current game number minus the
  // NFT's game number) to this total; playing an offensive spell reduces it.
  // The shield floors at zero and never goes negative.
  public type TeamShield = {
    team : Team;
    // The team's current shield total for this game.
    shield : Nat;
  };

  // The per-game shield totals for both teams, exposed so the frontend's two
  // embedded team windows (White and Black) can render each team's current
  // shield total and the space beneath it for the defensive number.
  public type ShieldState = {
    whiteShield : Nat;
    blackShield : Nat;
  };

  // The outcome of resolving one played offensive spell against the defending
  // team's shield. This is the authoritative branch the frontend renders:
  //   - #fired: the spell value strictly exceeded the shield, or was at least
  //     double the shield, so the shield dropped to zero and the spell takes
  //     effect on the chessboard.
  //   - #cancelled: the spell value was less than the shield and less than
  //     double the shield, so the shield was reduced by the spell value
  //     (floored at zero) and the spell does NOT take effect on the
  //     chessboard.
  //   - #legacy: the NFT carried no game number, so it is excluded from shield
  //     math entirely and burns inert without affecting any shield or board
  //     state.
  public type SpellResolutionOutcome = {
    #fired;
    #cancelled;
    #legacy;
  };

  // The full result of resolving one played offensive spell. Carries the
  // attacking team, the defending team, the spell's computed value, the
  // defending team's shield before and after resolution, the resulting
  // outcome branch, and whether the spell takes effect on the board. The
  // frontend uses this to render the resolution and to drive the distinct
  // burn-and-play toast.
  public type SpellResolution = {
    // The team that played the offensive spell.
    attacker : Team;
    // The team whose shield was targeted.
    defender : Team;
    // The spell's value: current game number minus the NFT's game number.
    spellValue : Nat;
    // The defending team's shield total before resolution.
    shieldBefore : Nat;
    // The defending team's shield total after resolution (floored at zero).
    shieldAfter : Nat;
    // The resolution branch.
    outcome : SpellResolutionOutcome;
    // Whether the spell takes effect on the chessboard. True only for
    // #fired; false for #cancelled and #legacy.
    firesOnBoard : Bool;
  };

  // The payload the distinct burn-and-play toast needs: which NFT was burned
  // and which spell was played. Carries the token id, the spell name, the
  // NFT's game number, the burning team, the spell kind, the resolution
  // (null when the burn was a defensive Subao Ve shield contribution or a
  // legacy inert burn, neither of which resolves against a shield), the
  // Balls colour family applied to the caster's board (null unless a Balls
  // spell fired on the board), and the opponent-board image applied to the
  // DEFENDER's board (null unless one of the three offensive image spells
  // fired on the board).
  public type BurnAndPlayResult = {
    // The token id of the NFT that was burned.
    tokenId : Nat;
    // The spell name carried by the burned NFT.
    spellName : Text;
    // The NFT's game number (the game it was acquired in). Null for a legacy
    // NFT with no game number.
    gameNumber : ?Nat;
    // The team that burned and played the NFT.
    team : Team;
    // The spell kind of the burned NFT.
    kind : SpellKind;
    // The resolution of the played spell against the defending team's shield.
    // Null for a defensive Subao Ve burn (a shield contribution, not an
    // attack) and for a legacy inert burn.
    resolution : ?SpellResolution;
    // The Balls colour family applied to the caster's board by this burn, or
    // null when the burn was not a Balls spell that fired on the board. A
    // Balls spell that was cancelled or was a legacy inert burn applies no
    // colour, so this is null.
    appliedColour : ?BallsColourFamily;
    // The opponent-board image applied to the DEFENDER's board by this burn,
    // or null when the burn was not one of the three offensive image spells
    // that fired on the board. A cancelled or legacy burn applies no image,
    // so this is null.
    appliedOpponentImage : ?OpponentBoardImage;
    // Why this burn was classified legacy, or null when the burn was not a
    // legacy burn. Set only for a legacy inert burn (resolution = null and
    // gameNumber = null); null for every burn that carried a usable spell.
    // Distinguishes a transient metadata read failure (#readFailed) from
    // genuinely absent keys (#keysAbsent), a wrong-typed key value
    // (#wrongType), and the two keys disagreeing (#keysDisagree).
    legacyReason : ?LegacyReason;
    // The casting team when this spell's board effect left the defending
    // team's king in check, so the game concludes as a win for the caster.
    // Null when the spell did not end the game. Display-only: it never
    // reaches the escrow or the stored EndState.
    spellCheckWin : ?Team;
    // The per-spell cast outcome recorded on the burn state for this cast:
    // #succeeded (fired on the board), #prevented (Subao Ve absorbed it), or
    // #noEffect (burned but affected neither Subao Ve nor the board). Null
    // only for a defensive Subao Ve burn, which is a shield contribution and
    // never appears in the per-spell outcome list.
    castOutcome : ?SpellCastOutcome;
    // The board square index (0..63, a1=0 ... h8=63) of every piece this
    // burn's removal spell removed, in removal order. Uses the same plain
    // square-index convention as SpellBoardState.blockedSquares. Empty for
    // every non-removal spell and for a removal that removed nothing, so the
    // frontend's per-square death-square marker overlay renders nothing.
    removedSquares : [Nat];
    // The board square index (0..63, a1=0 ... h8=63) of every enemy queen
    // this burn's Newkai Dodan spell transformed into an enemy knight on the
    // same square, in transformation order. Uses the same plain square-index
    // convention as removedSquares. Empty for every other spell and for a
    // Newkai Dodan cast that transformed nothing, so the frontend's
    // summoned-piece glow overlay renders nothing. A queen that would have
    // become a knight attacking the caster's king is destroyed instead and
    // appears in removedSquares, never here.
    transformedSquares : [Nat];
    // The outcome of the post-spell insufficient-material check run on the
    // board after this burn's board effect was applied. True when the new
    // board has insufficient material for either side to deliver checkmate,
    // so the spell concluded the game as a draw (#InsufficientMaterial) the
    // same way the normal move path does. False for every burn that did not
    // leave insufficient material, including every burn with no board effect.
    // The frontend and the game state agree on the draw through this field.
    insufficientMaterial : Bool;
  };

  // The result of a burn-and-play action. #ok carries the burn-and-play
  // payload the toast renders plus the updated shield state; #err carries a
  // human-readable rejection reason (not the Move_Maker, burn already
  // recorded this turn, opening Move_Maker without a Subao Ve, or missing
  // spell name).
  public type BurnAndPlayResult2 = {
    #ok : {
      burn : BurnAndPlayResult;
      shieldState : ShieldState;
    };
    #err : Text;
  };

  // The per-game shield state held in the shield-and-spell-resolution domain.
  // The shield is scoped to a single game: it resets to zero for both teams
  // at the start of every new game and never carries over. The burn-and-play
  // result for the current turn is held so the frontend's toast poll can read
  // it; it is cleared when a new turn begins.
  public type ShieldResolutionState = {
    var whiteShield : Nat;
    var blackShield : Nat;
    var lastBurnAndPlay : ?BurnAndPlayResult;
  };

  // Mutable record cell wrapping the shield-and-spell-resolution domain's
  // stable state. Mixin parameters are immutable bindings, so reassigning the
  // state requires a mutable field on a shared record (records are passed by
  // reference) — same rationale as BurnStore/PlayerStore.
  public type ShieldResolutionStore = { var state : ShieldResolutionState };

  // Shared (immutable) projection of the shield state returned to clients.
  // ShieldResolutionState carries mutable `var` fields (non-shared), so the
  // query returns this shared snapshot instead.
  public type ShieldResolutionSnapshot = {
    whiteShield : Nat;
    blackShield : Nat;
    lastBurnAndPlay : ?BurnAndPlayResult;
  };

  // The request the Move_Maker submits to burn and play an NFT spell. Carries
  // the token id (for the toast), the spell name and game number (both
  // required for eligibility and shield math), and the spell kind.
  public type BurnAndPlayRequest = {
    tokenId : Nat;
    spellName : Text;
    gameNumber : ?Nat;
    kind : SpellKind;
  };
};
