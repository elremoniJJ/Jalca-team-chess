import Array "mo:core/Array";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";

import Types "../types/story";

module {
  // The anonymous principal. A caller equal to this principal is not a
  // signed-in Internet Identity user and must never be recorded as the Story
  // author or as a voter. Computed per call because a module top-level binding
  // must be a static expression.
  func isAnonymous(caller : Principal) : Bool {
    Principal.equal(caller, Principal.fromText("2vxsx-fae"));
  };

  // The sole Story writer/editor, hardcoded at compile time. Computed inside a
  // function because a module top-level `let` must be a static expression and
  // `Principal.fromText(...)` is a call (M0014).
  func soleWriter() : Principal {
    Principal.fromText("bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae");
  };

  // The JALCA medieval fool story text that seeds the permanent "Forever"
  // section. Kept as a function so the migration file (which cannot import
  // project modules) can inline the same literal independently.
  public func foreverText() : Text {
    "Can you think of a short story about a medieval fool named JALCA who dressed up like a wizard, played chess against the king and blatantly cheated by knocking the king's horses off the board. The king was outraged, and asked \"Why did you do that you stupid fool?\"\n\n" #
    "The fool answered, \"Tis magic m'lord. I wield the magic of surprise.\"\n\n" #
    "The king, even more enraged, pulled out a sword and chopped off JALCA's head. \"Surprise, JALCA, you fool\", the king exclaimed.\n\n" #
    "As JALCA's body slumped to the floor, and his head rolled to a stop, the king added, \"It's not a terrible idea though.\"\n\n" #
    "The real surprise then occurred as JALCA's head, motionless, somehow sputtered, \"Probably better if we just played online\".\n\n" #
    "\"What sorcery is this? Damn you head, riddled with the dark arts!\" The king shouted, and kicked the head across the court.\n\n" #
    "The head flew, losing its wizard hat, and struck the stone wall, cracking the skull. As it hit the floor, the king walked to it and kneeled down. \"What do you have to say now, my bloody funny friend?\"\n\n" #
    "Once again to his surprise, the lips moved, \"...";
  };

  // True when `voters` already records `caller`.
  func hasVoted(voters : [var Principal], caller : Principal) : Bool {
    var found = false;
    for (v in voters.values()) {
      if (Principal.equal(v, caller)) {
        found := true;
      };
    };
    found;
  };

  // Return a new voters array with `caller` appended, growing the backing
  // array by one. A [var T] array cannot be grown in place, so the caller must
  // reassign the section's deleteVoters/keepVoters field to the returned array.
  func recordVoter(voters : [var Principal], caller : Principal) : [var Principal] {
    Array.tabulate(
      voters.size() + 1,
      func(i) {
        if (i < voters.size()) { voters[i] } else { caller };
      },
    ).toVarArray();
  };

  // Record `caller` as the sole Story author on first call. Retained for the
  // legacy claimStoryAuthorship / getStoryAuthor compatibility endpoints; it is
  // NOT the write gate (the writer is hardcoded). The author is thereafter
  // immutable: a second call from a different principal is rejected. A call
  // from the anonymous principal is always rejected.
  public func claimAuthorship(store : Types.StoryStore, caller : Principal) : Principal {
    if (isAnonymous(caller)) {
      Runtime.trap("Story authorship requires a signed-in Internet Identity principal");
    };
    switch (store.author) {
      case (?existing) {
        if (Principal.equal(existing, caller)) {
          existing;
        } else {
          Runtime.trap("Story authorship is already claimed by another principal");
        };
      };
      case null {
        store.author := ?caller;
        caller;
      };
    };
  };

  // Return the recorded Story author principal, or null when unset.
  public func getAuthor(store : Types.StoryStore) : ?Principal {
    store.author;
  };

  // Append a new live section at the end of the order. Writer-gated.
  public func appendSection(store : Types.StoryStore, caller : Principal, text : Text) : () {
    if (not Principal.equal(caller, soleWriter())) {
      Runtime.trap("Only the Story writer may modify the Story");
    };
    let old = store.sections;
    let grown = Array.tabulate<Types.StorySection>(
      old.size() + 1,
      func(i) {
        if (i < old.size()) {
          old[i];
        } else {
          {
            var text = text;
            var deleteCount = 0;
            var keepCount = 0;
            var deleted = false;
            var deleteVoters = [var];
            var keepVoters = [var];
          };
        };
      },
    ).toVarArray<Types.StorySection>();
    store.sections := grown;
  };

  // One-off restore of earlier story pieces: appends each text as its own
  // section (so each can be voted on). Only the deployer identity may call it,
  // and it is refused once any piece has been appended, so it cannot run twice.
  public func seedSections(store : Types.StoryStore, caller : Principal, texts : [Text]) : Nat {
    if (not Principal.equal(caller, Principal.fromText("sr3nc-5xctx-bluv6-26pwn-o5lh5-czjad-xrxwh-uz4a2-v3nhl-umojs-tqe"))) {
      Runtime.trap("Only the deployer may seed the Story");
    };
    let old = store.sections;
    if (old.size() > 1) {
      Runtime.trap("The Story already has appended pieces; seeding refused");
    };
    let n = texts.size();
    let grown = Array.tabulate<Types.StorySection>(
      old.size() + n,
      func(i) {
        if (i < old.size()) {
          old[i];
        } else {
          {
            var text = texts[i - old.size()];
            var deleteCount = 0;
            var keepCount = 0;
            var deleted = false;
            var deleteVoters = [var];
            var keepVoters = [var];
          };
        };
      },
    ).toVarArray<Types.StorySection>();
    store.sections := grown;
    n;
  };

  // Fill a deleted section's gap: writing new text into a deleted slot restores
  // it as a live section at that position, resets its counters to zero, and
  // clears its recorded per-principal votes. Writer-gated. The Forever section
  // (index 0) can never be filled.
  public func fillGap(store : Types.StoryStore, caller : Principal, index : Nat, text : Text) : () {
    if (not Principal.equal(caller, soleWriter())) {
      Runtime.trap("Only the Story writer may modify the Story");
    };
    if (index == 0) {
      Runtime.trap("The Forever section cannot be modified");
    };
    if (index >= store.sections.size()) {
      Runtime.trap("No Story section exists at that position");
    };
    let section = store.sections[index];
    if (not section.deleted) {
      Runtime.trap("That Story section is not a gap");
    };
    section.text := text;
    section.deleteCount := 0;
    section.keepCount := 0;
    section.deleted := false;
    section.deleteVoters := [var];
    section.keepVoters := [var];
  };

  // Press Delete on an appended section. Only a signed-in (non-anonymous)
  // caller may vote, and at most once per section: a repeat press from the
  // same principal is rejected and the counter does not change. The Forever
  // section (index 0) and already-deleted gaps cannot be voted on. The section
  // is removed only when its Delete count is >= 10 AND >= 3x its Keep count;
  // removal resets both counters and clears the recorded votes.
  public func pressDelete(store : Types.StoryStore, caller : Principal, index : Nat) : () {
    if (isAnonymous(caller)) {
      Runtime.trap("Only a signed-in Internet Identity principal may vote on the Story");
    };
    if (index == 0) {
      Runtime.trap("The Forever section cannot be voted on");
    };
    if (index >= store.sections.size()) {
      Runtime.trap("No Story section exists at that position");
    };
    let section = store.sections[index];
    if (section.deleted) {
      Runtime.trap("A deleted Story section cannot be voted on");
    };
    if (hasVoted(section.deleteVoters, caller)) {
      Runtime.trap("This principal has already voted Delete on this Story section");
    };
    section.deleteVoters := recordVoter(section.deleteVoters, caller);
    section.deleteCount := section.deleteCount + 1;
    if (section.deleteCount >= 10 and section.deleteCount >= 3 * section.keepCount) {
      section.deleted := true;
      section.deleteCount := 0;
      section.keepCount := 0;
      section.deleteVoters := [var];
      section.keepVoters := [var];
    };
  };

  // Press Keep on an appended section. Only a signed-in (non-anonymous) caller
  // may vote, and at most once per section: a repeat press from the same
  // principal is rejected and the counter does not change. The Forever section
  // (index 0) and already-deleted gaps cannot be voted on.
  public func pressKeep(store : Types.StoryStore, caller : Principal, index : Nat) : () {
    if (isAnonymous(caller)) {
      Runtime.trap("Only a signed-in Internet Identity principal may vote on the Story");
    };
    if (index == 0) {
      Runtime.trap("The Forever section cannot be voted on");
    };
    if (index >= store.sections.size()) {
      Runtime.trap("No Story section exists at that position");
    };
    let section = store.sections[index];
    if (section.deleted) {
      Runtime.trap("A deleted Story section cannot be voted on");
    };
    if (hasVoted(section.keepVoters, caller)) {
      Runtime.trap("This principal has already voted Keep on this Story section");
    };
    section.keepVoters := recordVoter(section.keepVoters, caller);
    section.keepCount := section.keepCount + 1;
  };

  // Read the ordered sections with their text, deleted/gap state, counters,
  // and whether `caller` has already voted Delete / Keep on each section.
  // Public and side-effect free.
  public func getSections(store : Types.StoryStore, caller : Principal) : [Types.StoryRow] {
    let sections = store.sections;
    Array.tabulate(
      sections.size(),
      func(i) {
        let section = sections[i];
        {
          index = i;
          text = section.text;
          deleteCount = section.deleteCount;
          keepCount = section.keepCount;
          deleted = section.deleted;
          hasVotedDelete = hasVoted(section.deleteVoters, caller);
          hasVotedKeep = hasVoted(section.keepVoters, caller);
        };
      },
    );
  };
};
