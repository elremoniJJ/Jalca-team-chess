import Array "mo:core/Array";

import Types "../types/pbpp-information";

module {
  public type PbppInformationEntry = Types.PbppInformationEntry;
  public type PbppInformationStore = Types.PbppInformationStore;
  public type Timestamp = Types.Timestamp;

  // Construct a fresh, empty PBPP_Information store cell. Used by the
  // migration to initialize the PBPP_Information domain's stable state.
  public func newPbppInformationStore() : PbppInformationStore {
    { var entries = [var] };
  };

  // Append a new time-stamped entry to the store's entries array (grows by
  // one). Reassigns `store.entries`. Maintains append order; prior entries
  // are never overwritten, so the record accumulates additional information
  // over time. Returns the newly appended entry.
  public func appendEntry(
    store : PbppInformationStore,
    content : Text,
    timestamp : Timestamp,
  ) : PbppInformationEntry {
    let entry : PbppInformationEntry = { timestamp; content };
    let n = store.entries.size();
    let grown = Array.tabulate(n + 1, func(j) {
      if (j < n) store.entries[j] else entry;
    });
    store.entries := grown.toVarArray();
    entry;
  };

  // Return the stored entries in append order as an immutable array.
  public func getEntries(store : PbppInformationStore) : [PbppInformationEntry] {
    Array.fromVarArray(store.entries);
  };
};
