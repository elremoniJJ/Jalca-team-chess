import Int "mo:core/Int";
import List "mo:core/List";
import Principal "mo:core/Principal";
import Types "../types/prize";
import ClaimTypes "../types/prize-claim";
import SundayComp "../lib/sunday-comp";

module {
  // Prize-claim domain logic. All functions are pure or operate on the injected
  // stores; the clock is passed in as `now` so tests can control time.
  //
  // The claim state machine is claimable -> paying -> paid, with a manual-check
  // flag for outcomes the prize canister reports as needing a human. The
  // recipient principal and the exact amount are locked at the first attempt so
  // a retry always sends the same payment.

  // The prize canister's per-payment ceiling: 10 ICP in e8s. A stored prize
  // above this cannot be paid and is flagged for the admin instead of being
  // sent.
  public let maxPaymentE8s : Nat = 1_000_000_000;

  // The prize canister's per-competition cap: 20 ICP in e8s. The sum of the
  // stored prizes for one competition must not exceed this.
  public let maxCompetitionE8s : Nat = 2_000_000_000;

  // The player-facing message shown when the prize canister reports an outcome
  // that needs a human. The place is flagged for the admin and is not retried.
  public let manualCheckMessage : Text =
    "Your prize needs a manual check. The team has been notified and will resolve it; please do not retry.";

  // The player-facing message shown when the prize canister rejects the caller
  // as unauthorized. The place is flagged for the admin and is not retried.
  public let unauthorizedMessage : Text =
    "Your prize could not be paid automatically. The team has been notified and will resolve it; please do not retry.";

  // The player-facing message shown when the stored prize exceeds the prize
  // canister's per-payment ceiling. The place is flagged for the admin and is
  // not retried.
  public let overCeilingMessage : Text =
    "Your prize is above the automatic payment limit. The team has been notified and will resolve it; please do not retry.";

  // The player-facing message shown when the stored prizes for the competition
  // exceed the prize canister's per-competition cap. The place is flagged for
  // the admin and is not retried.
  public let overCapMessage : Text =
    "Your prize is above the competition payment cap. The team has been notified and will resolve it; please do not retry.";

  // The player-facing message shown when the prize canister is busy. The place
  // stays paying and the player may retry.
  public let busyMessage : Text =
    "The prize service is busy. Please try again in a moment.";

  // The player-facing message shown when the ledger is temporarily unavailable.
  // The place stays paying and the player may retry.
  public let ledgerUnavailableMessage : Text =
    "The payment service is temporarily unavailable. Please try again in a moment.";

  // The player-facing message shown when the ledger call outcome is unknown.
  // The place stays paying and the player may retry the same payment.
  public let unknownOutcomeMessage : Text =
    "The payment outcome is unknown. Please try again; the same payment will be retried and never sent twice.";

  // The player-facing message shown when a retry's parameters do not match the
  // original payment. The place stays paying and is flagged for the admin.
  public let retryMismatchMessage : Text =
    "This prize is already being paid with different details. The team has been notified and will resolve it; please do not retry.";

  // ---------------------------------------------------------------------------
  // Claim lookup and store helpers
  // ---------------------------------------------------------------------------

  // Find the stored claim for one placement, or none.
  public func findClaim(
    store : ClaimTypes.PrizeClaimStore,
    competition : Types.Timestamp,
    rank : Nat,
  ) : ?ClaimTypes.PrizeClaim {
    var found : ?ClaimTypes.PrizeClaim = null;
    var i = 0;
    let n = store.items.size();
    while (i < n and found == null) {
      let (c, r, claim) = store.items[i];
      if (c == competition and r == rank) {
        found := ?claim;
      };
      i += 1;
    };
    found;
  };

  // Replace the stored claim for one placement, or append it when absent.
  func putClaim(
    store : ClaimTypes.PrizeClaimStore,
    claim : ClaimTypes.PrizeClaim,
  ) : () {
    var replaced = false;
    let updated = store.items.map(
      func((c, r, existing)) {
        if (c == claim.competition and r == claim.rank) {
          replaced := true;
          (c, r, claim);
        } else {
          (c, r, existing);
        };
      }
    );
    store.items := if (replaced) {
      updated;
    } else {
      updated.concat([(claim.competition, claim.rank, claim)]);
    };
  };

  // Whether `caller` owns the archived placement at `rank` in `competition`.
  // The ownership check is the archived placement's stored principal.
  public func ownsPlace(
    archive : Types.CompArchive10Store,
    competition : Types.Timestamp,
    rank : Nat,
    caller : Principal,
  ) : Bool {
    switch (findArchived(archive, competition)) {
      case null { false };
      case (?comp) {
        switch (findPlacement(comp.placements, rank)) {
          case null { false };
          case (?placement) { Principal.equal(placement.principal, caller) };
        };
      };
    };
  };

  // The stored prize amount for one archived placement, or none when the
  // competition or the placement is absent. The amount is the prize captured
  // in the place record at finalization for that exact rank, never a value
  // recomputed from the live allocation or from the archived wins.
  public func storedAmount(
    archive : Types.CompArchive10Store,
    competition : Types.Timestamp,
    rank : Nat,
  ) : ?Nat {
    switch (findArchived(archive, competition)) {
      case null { null };
      case (?comp) {
        switch (findPlacement(comp.placements, rank)) {
          case null { null };
          case (?placement) { ?placement.prizeE8s };
        };
      };
    };
  };

  // The sum of the stored prizes for one archived competition, or none when the
  // competition is absent. Each placement contributes the prize captured in its
  // place record at finalization, so the total is the sum of the stored per-rank
  // prizes and never a value recomputed from the live allocation.
  public func competitionTotal(
    archive : Types.CompArchive10Store,
    competition : Types.Timestamp,
  ) : ?Nat {
    switch (findArchived(archive, competition)) {
      case null { null };
      case (?comp) {
        var total = 0;
        for (placement in comp.placements.values()) {
          total += placement.prizeE8s;
        };
        ?total;
      };
    };
  };

  // Find an archived competition by its start timestamp.
  func findArchived(
    archive : Types.CompArchive10Store,
    competition : Types.Timestamp,
  ) : ?Types.ArchivedCompetition10 {
    var found : ?Types.ArchivedCompetition10 = null;
    var i = 0;
    let n = archive.items.size();
    while (i < n and found == null) {
      if (archive.items[i].sunday == competition) {
        found := ?archive.items[i];
      };
      i += 1;
    };
    found;
  };

  // Find a placement by its 1-based rank.
  func findPlacement(
    placements : [Types.ArchivedPlacement10],
    rank : Nat,
  ) : ?Types.ArchivedPlacement10 {
    placements.find(func(p) = p.rank == rank);
  };

  // ---------------------------------------------------------------------------
  // Claim flow
  // ---------------------------------------------------------------------------

  // The outcome of one `pay` attempt, classified for the claim state machine.
  public type PayOutcome = {
    // The prize canister returned `ok` with the ledger block index.
    #paid : Nat;
    // A definite rejection: the place returns to claimable and may be retried.
    #rejected;
    // The prize canister is busy; the place stays paying and may be retried.
    #busy;
    // The ledger is temporarily unavailable; the place stays paying and may be
    // retried.
    #ledgerUnavailable;
    // The ledger call outcome is unknown; the place stays paying and may be
    // retried with the same payment.
    #unknown;
    // The prize canister reported an outcome that needs a human; the place is
    // flagged for the admin and is not retried.
    #manualCheck;
    // The prize canister rejected the caller as unauthorized; the place is
    // flagged for the admin and is not retried.
    #unauthorized;
    // The retry's parameters do not match the original payment; the place is
    // flagged for the admin and is not retried.
    #retryMismatch;
  };

  // Classify the prize canister's `pay` result text into a PayOutcome. The
  // error texts are the prize canister's published set; an unrecognized text is
  // treated as an unknown outcome so the place stays paying and is retried.
  public func classifyPayResult(result : Types.PayResult) : PayOutcome {
    switch (result) {
      case (#ok(blockIndex)) { #paid(blockIndex) };
      case (#err(text)) {
        if (text == "bad recipient") { #rejected }
        else if (text == "ledger rejected the transfer; prize remains claimable") { #rejected }
        else if (text == "amount outside limits") { #rejected }
        else if (text == "competition cap exceeded") { #rejected }
        else if (text == "insufficient balance") { #rejected }
        else if (text == "bad rank") { #rejected }
        else if (text == "busy, retry") { #busy }
        else if (text == "ledger temporarily unavailable; retry") { #ledgerUnavailable }
        else if (text == "ledger call failed, outcome unknown; retry the same payment") { #unknown }
        else if (text == "needs manual check") { #manualCheck }
        else if (text == "unauthorized") { #unauthorized }
        else if (text == "retry must match the original payment") { #retryMismatch }
        else { #unknown };
      };
    };
  };

  // The player-facing message for a non-paid outcome, or none when the outcome
  // is paid or a definite rejection (which returns to claimable).
  public func outcomeMessage(outcome : PayOutcome) : ?Text {
    switch (outcome) {
      case (#paid(_)) { null };
      case (#rejected) { null };
      case (#busy) { ?busyMessage };
      case (#ledgerUnavailable) { ?ledgerUnavailableMessage };
      case (#unknown) { ?unknownOutcomeMessage };
      case (#manualCheck) { ?manualCheckMessage };
      case (#unauthorized) { ?unauthorizedMessage };
      case (#retryMismatch) { ?retryMismatchMessage };
    };
  };

  // Whether an outcome flags the place for the admin and blocks a retry.
  public func isFlagged(outcome : PayOutcome) : Bool {
    switch (outcome) {
      case (#manualCheck) { true };
      case (#unauthorized) { true };
      case (#retryMismatch) { true };
      case (_) { false };
    };
  };

  // The claim result returned to the frontend for a stored claim.
  public func toResult(claim : ClaimTypes.PrizeClaim, message : ?Text) : ClaimTypes.ClaimResult {
    {
      state = claim.state;
      amountE8s = claim.amountE8s;
      blockIndex = claim.blockIndex;
      message;
    };
  };

  // The claim result for a place that is not claimable (no stored claim, or a
  // claim that is not in the claimable state).
  public func notClaimableResult() : ClaimTypes.ClaimResult {
    {
      state = #claimable;
      amountE8s = 0;
      blockIndex = null;
      message = ?"This prize is not claimable.";
    };
  };

  // The claim result for a place whose stored prize is zero (a non-first-place
  // placement, or a competition with no prize pool).
  public func zeroPrizeResult() : ClaimTypes.ClaimResult {
    {
      state = #claimable;
      amountE8s = 0;
      blockIndex = null;
      message = ?"This place has no prize to claim.";
    };
  };

  // The claim result for a place whose stored prize exceeds the prize
  // canister's per-payment ceiling. The place is flagged for the admin and is
  // not retried.
  public func overCeilingResult(amountE8s : Nat) : ClaimTypes.ClaimResult {
    {
      state = #claimable;
      amountE8s;
      blockIndex = null;
      message = ?overCeilingMessage;
    };
  };

  // The claim result for a place whose competition's stored prizes exceed the
  // prize canister's per-competition cap. The place is flagged for the admin
  // and is not retried.
  public func overCapResult(amountE8s : Nat) : ClaimTypes.ClaimResult {
    {
      state = #claimable;
      amountE8s;
      blockIndex = null;
      message = ?overCapMessage;
    };
  };

  // The claim result for a place that is already paid.
  public func paidResult(claim : ClaimTypes.PrizeClaim) : ClaimTypes.ClaimResult {
    {
      state = #paid;
      amountE8s = claim.amountE8s;
      blockIndex = claim.blockIndex;
      message = null;
    };
  };

  // The claim result for a place that is paying and flagged for the admin.
  public func flaggedResult(claim : ClaimTypes.PrizeClaim) : ClaimTypes.ClaimResult {
    {
      state = #paying;
      amountE8s = claim.amountE8s;
      blockIndex = null;
      message = ?manualCheckMessage;
    };
  };

  // The claim result for a place that is paying and may be retried.
  public func payingResult(claim : ClaimTypes.PrizeClaim, message : ?Text) : ClaimTypes.ClaimResult {
    {
      state = #paying;
      amountE8s = claim.amountE8s;
      blockIndex = null;
      message;
    };
  };

  // ---------------------------------------------------------------------------
  // Store mutations
  // ---------------------------------------------------------------------------

  // Set a place to paying, recording the recipient and the exact stored amount.
  // Called synchronously before the first await, together with the ownership
  // check, so only one claim per place can run at once.
  public func beginPaying(
    store : ClaimTypes.PrizeClaimStore,
    competition : Types.Timestamp,
    rank : Nat,
    recipient : Principal,
    amountE8s : Nat,
  ) : ClaimTypes.PrizeClaim {
    let claim : ClaimTypes.PrizeClaim = {
      competition;
      rank;
      state = #paying;
      recipient = ?recipient;
      amountE8s;
      blockIndex = null;
      manualCheck = false;
    };
    putClaim(store, claim);
    claim;
  };

  // Mark a place paid with the returned ledger block index.
  public func markPaid(
    store : ClaimTypes.PrizeClaimStore,
    claim : ClaimTypes.PrizeClaim,
    blockIndex : Nat,
  ) : ClaimTypes.PrizeClaim {
    let updated : ClaimTypes.PrizeClaim = {
      competition = claim.competition;
      rank = claim.rank;
      state = #paid;
      recipient = claim.recipient;
      amountE8s = claim.amountE8s;
      blockIndex = ?blockIndex;
      manualCheck = claim.manualCheck;
    };
    putClaim(store, updated);
    updated;
  };

  // Return a place to claimable after a definite rejection.
  public func markClaimable(
    store : ClaimTypes.PrizeClaimStore,
    claim : ClaimTypes.PrizeClaim,
  ) : ClaimTypes.PrizeClaim {
    let updated : ClaimTypes.PrizeClaim = {
      competition = claim.competition;
      rank = claim.rank;
      state = #claimable;
      recipient = claim.recipient;
      amountE8s = claim.amountE8s;
      blockIndex = null;
      manualCheck = claim.manualCheck;
    };
    putClaim(store, updated);
    updated;
  };

  // Flag a place for the admin. The place stays paying and is not retried.
  public func markFlagged(
    store : ClaimTypes.PrizeClaimStore,
    claim : ClaimTypes.PrizeClaim,
  ) : ClaimTypes.PrizeClaim {
    let updated : ClaimTypes.PrizeClaim = {
      competition = claim.competition;
      rank = claim.rank;
      state = claim.state;
      recipient = claim.recipient;
      amountE8s = claim.amountE8s;
      blockIndex = claim.blockIndex;
      manualCheck = true;
    };
    putClaim(store, updated);
    updated;
  };

  // ---------------------------------------------------------------------------
  // Admin overview
  // ---------------------------------------------------------------------------

  // Build the admin-only prize overview: one row per archived competition,
  // with its unclaimed, paying and paid prizes. The recipient principal is
  // included for paid entries only. Returned only to the admin.
  public func adminOverview(
    archive : Types.CompArchive10Store,
    store : ClaimTypes.PrizeClaimStore,
  ) : ClaimTypes.AdminPrizeOverview {
    let competitions = List.empty<Types.Timestamp>();
    for (comp in archive.items.values()) {
      if (not competitions.contains(comp.sunday)) {
        competitions.add(comp.sunday);
      };
    };
    // Include any competition that has a claim record but is not in the
    // archive (defensive: a claim can only exist for an archived place).
    for ((competition, _, _) in store.items.values()) {
      if (not competitions.contains(competition)) {
        competitions.add(competition);
      };
    };
    let rows = List.empty<ClaimTypes.AdminPrizeRow>();
    for (competition in competitions.values()) {
      rows.add(adminRowFor(store, competition));
    };
    { rows = rows.toArray() };
  };

  // Build one competition's admin prize row: its unclaimed, paying and paid
  // prizes, with the recipient principal included for paid entries only.
  // Returned only to the admin.
  public func adminRowFor(
    store : ClaimTypes.PrizeClaimStore,
    competition : Types.Timestamp,
  ) : ClaimTypes.AdminPrizeRow {
    let unclaimed = List.empty<ClaimTypes.AdminPrizeEntry>();
    let paying = List.empty<ClaimTypes.AdminPrizeEntry>();
    let paid = List.empty<ClaimTypes.AdminPrizeEntry>();
    for ((c, rank, claim) in store.items.values()) {
      if (c == competition) {
        switch (claim.state) {
          case (#claimable) {
            unclaimed.add({
              rank;
              amountE8s = claim.amountE8s;
              recipient = null;
              blockIndex = null;
            });
          };
          case (#paying) {
            paying.add({
              rank;
              amountE8s = claim.amountE8s;
              recipient = null;
              blockIndex = null;
            });
          };
          case (#paid) {
            paid.add({
              rank;
              amountE8s = claim.amountE8s;
              recipient = claim.recipient;
              blockIndex = claim.blockIndex;
            });
          };
        };
      };
    };
    {
      competition;
      unclaimed = unclaimed.toArray();
      paying = paying.toArray();
      paid = paid.toArray();
    };
  };

  // ---------------------------------------------------------------------------
  // Prize canister call
  // ---------------------------------------------------------------------------

  // Call the prize canister's `pay` from JALCA's own backend principal. The
  // competition is the exact archive key timestamp, the rank is 1 to 10, the
  // recipient is the locked principal, and the amount is the stored prize in
  // e8s. A trap on the call is treated as an unknown outcome so the place stays
  // paying and is retried with the same payment.
  public func callPay(
    canister : Principal,
    competition : Types.Timestamp,
    rank : Nat,
    recipient : Principal,
    amountE8s : Nat,
  ) : async Types.PayResult {
    let prizeCanister : Types.PrizeCanisterActor = actor (canister.toText());
    // The prize canister's `pay` takes the competition as a `Nat`, while the
    // archive key is a nanosecond `Timestamp` (`Int`). The archive key is always
    // a non-negative nanosecond value, so the conversion is exact; a negative
    // value would be a broken invariant, not a payable competition.
    let competitionNat = competition.toNat();
    try {
      await prizeCanister.pay(competitionNat, rank, recipient, amountE8s);
    } catch (_) {
      #err("ledger call failed, outcome unknown; retry the same payment");
    };
  };

  // Read the prize canister's ICP (e8s) and cycle balances from JALCA's own
  // backend principal, using the same actor-reference style and the same stored
  // prize canister principal that `callPay` uses. The prize canister's
  // `balances` is an update call (it makes an inter-canister call to the
  // ledger). A trap or rejection on the call is caught and returned as
  // `#err Text` so the admin UI can show the failure cleanly instead of
  // breaking — for example before the prize canister is upgraded to expose
  // `balances`. Read-only: it never moves funds and changes no state.
  public func callBalances(canister : Principal) : async Types.PrizeBalancesResult {
    let prizeCanister : Types.PrizeCanisterActor = actor (canister.toText());
    try {
      #ok(await prizeCanister.balances());
    } catch (_) {
      #err("Prize canister did not answer. It may not be upgraded yet");
    };
  };

  // The claim deadline for a competition: the next competition start. Judged by
  // the canister's clock when the place becomes paying.
  public func deadline(competition : Types.Timestamp) : Types.Timestamp {
    SundayComp.nextStart(competition);
  };

  // Whether a claim may be accepted at `now`: strictly before the deadline. A
  // claim accepted before the deadline still pays if it completes after it.
  public func withinDeadline(competition : Types.Timestamp, now : Types.Timestamp) : Bool {
    now < deadline(competition);
  };

  // The claim result for a claim attempted after the deadline.
  public func expiredResult() : ClaimTypes.ClaimResult {
    {
      state = #claimable;
      amountE8s = 0;
      blockIndex = null;
      message = ?"The claim deadline for this prize has passed.";
    };
  };
};
