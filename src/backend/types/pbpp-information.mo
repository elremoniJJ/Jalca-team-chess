import Common "common";

module {
  // Re-export shared types for convenience.
  public type PseudoPrincipal = Common.PseudoPrincipal;
  public type Timestamp = Common.Timestamp;

  // A single time-stamped entry in the append-only PBPP_Information record.
  //
  // `timestamp` is the append time in nanoseconds (mo:core/Time).
  //
  // `content` is the verbatim text of the PBPP status/requirements update at
  // that point in time. Each append adds a NEW entry; prior entries are never
  // overwritten, so the record accumulates additional information over time.
  public type PbppInformationEntry = {
    timestamp : Timestamp;
    content : Text;
  };

  // Mutable record cell wrapping the append-only entries array. Mixin
  // parameters are immutable bindings, so reassigning the array reference
  // requires a mutable field on a shared record (records are passed by
  // reference). This mirrors the ExerciseStore / DrinkingStore
  // pattern so main.mo can declare `pbppInformationStore` as a stable field
  // and pass the same binding to the PbppInformationApi mixin.
  public type PbppInformationStore = {
    var entries : [var PbppInformationEntry];
  };
};
