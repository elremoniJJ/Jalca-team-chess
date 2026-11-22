import Time "mo:core/Time";

import Types "../types/pbpp-information";
import PbppInformation "../lib/pbpp-information";

// PbppInformationApi — the public surface of the PBPP_Information domain.
//
// This mixin is intentionally isolated from the rest of the backend. It
// receives only its own PbppInformationStore as a parameter — no game state,
// no bet logic, no settlement. The PBPP_Information record is a single
// informational, time-stamped, appendable record storing the verbatim PBPP
// status/requirements update. It is a reference point, not active logic.
//
// The store is seeded with the initial PBPP status/requirements update as the
// first time-stamped entry (see the migration). Each subsequent append adds a
// NEW entry; prior entries are never overwritten.
mixin (
  pbppInformationStore : Types.PbppInformationStore,
) {
  // Append-computation entry point. Appends a new time-stamped entry with the
  // given `content` to the PBPP_Information record. Prior entries are never
  // overwritten. Returns the newly appended entry.
  public func appendPbppInformation(content : Text) : async Types.PbppInformationEntry {
    PbppInformation.appendEntry(pbppInformationStore, content, Time.now());
  };

  // Retrieve-computation entry point. Returns all PBPP_Information entries in
  // append order. Read-only query — does not mutate the store.
  public func getPbppInformation() : async [Types.PbppInformationEntry] {
    PbppInformation.getEntries(pbppInformationStore);
  };
};
