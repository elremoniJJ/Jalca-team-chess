// =============================================================================
// NFT Spell Combat Logic — Blocking Subao Ve (authoritative reference)
// =============================================================================
//
// THIS FILE IS REFERENCE DOCUMENTATION ONLY.
//
// It captures the complete power-comparison engine that governs how a Blocking
// Subao Ve NFT counters enemy Major/Minor spell NFTs when those NFTs are burned
// during live chess play. It is intentionally NOT wired into live gameplay or
// minting: no spell burning, no chess-state alteration, and no change to any
// existing spell effect lives here. The functions below are pure, self-contained
// reference logic that document the mechanic so a future implementer can build
// the burn flow against an authoritative spec.
//
// -----------------------------------------------------------------------------
// The mechanic in one paragraph
// -----------------------------------------------------------------------------
// Every spell NFT is minted with a `gameNumber` (the sequential game number it
// was acquired in). When a spell is played during a later game, its "Power" is
// the difference between the CURRENT game number and the NFT's own game number
// — older spells are more powerful. A Blocking Subao Ve NFT sits in the
// Move_Maker's team Defense (White or Black) and, when present, attempts to
// absorb an enemy Minor/Major spell that is played AFTER the Block was played.
// The two powers are compared and one of four branches resolves (see
// `resolveCombat`). Minor/Major spells are ALWAYS consumed on play regardless
// of the outcome; a Block only ever counters spells played after it was played.
//
// -----------------------------------------------------------------------------
// Power definitions
// -----------------------------------------------------------------------------
//   Block power      = currentGameNumber - blockNftGameNumber
//   Minor/Major power = currentGameNumber - minorMajorNftGameNumber
//
// The Block sits in the Move_Maker's team Defense (White or Black). It only
// counters spells played by the OPPOSING team, and only spells played AFTER the
// Block was itself played.
// =============================================================================

module {

  // The two teams/sides in a chess game. Mirrored here so this reference module
  // is fully self-contained and never depends on live game state.
  public type Team = {
    #White;
    #Black;
  };

  // The spell kind of the incoming (attacking) spell NFT. Only Minor and Major
  // spells are ever countered by a Block; a Block is never itself "attacked".
  public type SpellKind = {
    #Minor;
    #Major;
  };

  // The four outcome branches of a Block-vs-Minor/Major power comparison.
  //
  // #noBlockPresent        — No Block sits in the Move_Maker's team Defense, so
  //                          the Minor/Major spell takes effect normally (e.g.
  //                          removes 2 pawns). The Minor/Major NFT is consumed.
  //
  // #minorMajorWins        — Minor/Major power is HIGHER than Block power. The
  //                          Block is removed AND the Minor/Major spell takes
  //                          effect. Both NFTs are consumed.
  //
  // #blockWins             — Block power is HIGHER than Minor/Major power. The
  //                          Minor/Major spell has NO board effect but is still
  //                          burned (consumed). The Block survives, and its
  //                          remaining power is reduced by the difference
  //                          (Block power - Minor/Major power).
  //
  // #powersEqual           — Powers are equal. BOTH the Block and the
  //                          Minor/Major NFT are removed, with NO board effect.
  //                          The team may play a new Block.
  public type CombatOutcome = {
    #noBlockPresent;
    #minorMajorWins;
    #blockWins : { remainingBlockPower : Nat };
    #powersEqual;
  };

  // The inputs needed to resolve a single Block-vs-Minor/Major confrontation.
  // All values are plain Nats so the reference logic stays pure and testable.
  public type CombatInput = {
    // Whether a Block currently sits in the Move_Maker's team Defense.
    blockPresent : Bool;
    // The Block NFT's game number (the game it was acquired in).
    blockNftGameNumber : Nat;
    // The Minor/Major NFT's game number (the game it was acquired in).
    minorMajorNftGameNumber : Nat;
    // The current game number (the game the spell is being played in).
    currentGameNumber : Nat;
  };

  // Block power = current game number - Block NFT's game number.
  // Older Blocks (lower acquisition game number) are more powerful.
  //
  // NOTE: this reference uses saturating subtraction (never below 0) so the
  // spec is well-defined even for a Block acquired in the current game. A live
  // implementation must decide whether a Block acquired in the current game
  // (power 0) is eligible to counter at all — see the "played AFTER" rule.
  public func blockPower(input : CombatInput) : Nat {
    if (input.currentGameNumber >= input.blockNftGameNumber) {
      input.currentGameNumber - input.blockNftGameNumber
    } else {
      0
    }
  };

  // Minor/Major power = current game number - Minor/Major NFT's game number.
  // Older Minor/Major spells are more powerful.
  public func minorMajorPower(input : CombatInput) : Nat {
    if (input.currentGameNumber >= input.minorMajorNftGameNumber) {
      input.currentGameNumber - input.minorMajorNftGameNumber
    } else {
      0
    }
  };

  // Resolve a single Block-vs-Minor/Major confrontation into its outcome
  // branch. This is the authoritative power-comparison engine.
  //
  // Branch rules (in order):
  //   1. No Block present  -> Minor/Major takes effect (e.g. 2 pawns removed).
  //   2. Minor/Major power HIGHER -> Block removed AND spell takes effect.
  //   3. Block power HIGHER -> Minor/Major has no board effect but is still
  //      burned; Block power reduced by (Block power - Minor/Major power).
  //   4. Powers EQUAL -> both removed, no board effect; team may play a new
  //      Block.
  //
  // Invariants enforced by the spec (documented, not enforced here):
  //   - A Minor/Major spell is ALWAYS consumed on play regardless of outcome.
  //   - A Block only counters spells played AFTER it was played.
  public func resolveCombat(input : CombatInput) : CombatOutcome {
    if (not input.blockPresent) {
      #noBlockPresent
    } else {
      let bp = blockPower(input);
      let mp = minorMajorPower(input);
      if (mp > bp) {
        #minorMajorWins
      } else if (bp > mp) {
        // Block survives; its remaining power is reduced by the difference.
        #blockWins({ remainingBlockPower = bp - mp })
      } else {
        // bp == mp
        #powersEqual
      }
    }
  };

  // A human-readable summary of a resolved outcome, for documentation and
  // diagnostics. Not used by any live gameplay path.
  public func describeOutcome(outcome : CombatOutcome) : Text {
    switch (outcome) {
      case (#noBlockPresent) {
        "No Block present: Minor/Major spell takes effect (e.g. 2 pawns removed). Minor/Major NFT consumed."
      };
      case (#minorMajorWins) {
        "Minor/Major power higher: Block removed AND spell takes effect. Both NFTs consumed."
      };
      case (#blockWins({ remainingBlockPower })) {
        "Block power higher: Minor/Major has no board effect but is still burned; Block survives with remaining power " # Nat.toText(remainingBlockPower) # "."
      };
      case (#powersEqual) {
        "Powers equal: both removed, no board effect; team may play a new Block."
      };
    }
  };
};
