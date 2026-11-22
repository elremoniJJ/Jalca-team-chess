import List "mo:core/List";
import Map "mo:core/Map";
import Text "mo:core/Text";

import Types "../types/chess-game";

// Guaranteed-tier domain logic.
//
// The guaranteed set is keyed on the post-'_copy' roster username and holds
// each entry's own NFT wallet address plus a verified-bet flag. Entries are
// self-contained: heartbeat cleanup removes the player row entirely, but a
// guaranteed entry survives and still carries the wallet address needed to
// mint. The set is cleared at the start of each new game alongside the vote
// clearing.
//
// This module is pure domain logic over the store cell — no game state, no
// recorder, no NFT store. The chess mixin and the real-bet mixin both receive
// the same store binding and call these helpers.
module {
  public type GuaranteedEntry = Types.GuaranteedEntry;
  public type GuaranteedStore = Types.GuaranteedStore;

  // Construct a fresh, empty guaranteed store cell. Used by the migration to
  // initialize the domain's stable state.
  public func newGuaranteedStore() : GuaranteedStore {
    { var items = Map.empty() };
  };

  // Mark the entry for `username` as bet-verified, creating the entry if it
  // does not exist yet. Called only after a prediction bet is successfully
  // placed; rejected/cancelled/failed bets never reach this call. An existing
  // wallet address on the entry is preserved.
  public func markBetVerified(store : GuaranteedStore, username : Text) {
    switch (store.items.get(username)) {
      case (?entry) {
        store.items.add(username, { entry with betVerified = true });
      };
      case null {
        store.items.add(username, {
          username;
          walletAddress = null;
          betVerified = true;
        });
      };
    };
  };

  // Record (or overwrite) the wallet address for `username`'s guaranteed
  // entry. Reconnecting with a new wallet overwrites the stored address so
  // mints never target a stale address; a disconnect (null) also overwrites an
  // existing entry so a stale address is not retained. The bet-verified flag
  // is preserved. When no entry exists yet, one is created only for a
  // non-null address — a null update with no prior entry writes nothing.
  public func recordWallet(store : GuaranteedStore, username : Text, walletAddress : ?Text) {
    switch (store.items.get(username)) {
      case (?entry) {
        store.items.add(username, { entry with walletAddress });
      };
      case null {
        switch (walletAddress) {
          case null {};
          case (?_) {
            store.items.add(username, {
              username;
              walletAddress;
              betVerified = false;
            });
          };
        };
      };
    };
  };

  // Clear the entire guaranteed set. Called at the start of each new game
  // alongside the vote clearing so guaranteed entries apply to exactly one
  // game.
  public func clearAll(store : GuaranteedStore) {
    store.items.clear();
  };

  // The guaranteed-tier mint candidates: every entry with a verified bet AND a
  // recorded, non-empty wallet address. Read from the guaranteed entry itself
  // (never the player row), so a departed bettor whose player row was
  // heartbeat-cleaned still qualifies. Returned in map iteration order.
  public func eligibleEntries(store : GuaranteedStore) : [GuaranteedEntry] {
    let out = List.empty<GuaranteedEntry>();
    for ((_, entry) in store.items.entries()) {
      if (entry.betVerified) {
        switch (entry.walletAddress) {
          case (?address) {
            if (not address.isEmpty()) {
              out.add(entry);
            };
          };
          case null {};
        };
      };
    };
    out.toArray();
  };

  // The set of usernames that are guaranteed-tier candidates (verified bet +
  // recorded wallet). Used to exclude them from the capped pool so a
  // guaranteed player is never minted twice and the 10-NFT cap applies only to
  // wallet-holding players not in the guaranteed set.
  public func eligibleUsernames(store : GuaranteedStore) : [Text] {
    eligibleEntries(store).map(func(entry) { entry.username });
  };
};
