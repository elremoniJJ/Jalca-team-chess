import Types "../types/story";
import Story "../lib/story";

mixin (storyStore : Types.StoryStore) {
  // Record the caller's Internet Identity principal as the sole Story author
  // on first call. Retained for compatibility; the write gate is the
  // hardcoded sole writer, not this recorded author. Returns the recorded
  // author principal.
  public shared ({ caller }) func claimStoryAuthorship() : async Principal {
    Story.claimAuthorship(storyStore, caller);
  };

  // Return the recorded Story author principal, or null when unset.
  public query func getStoryAuthor() : async ?Principal {
    Story.getAuthor(storyStore);
  };

  // Legacy single-text write. Retained for compatibility; it appends a new
  // section as the hardcoded sole writer.
  public shared ({ caller }) func writeStory(text : Text) : async () {
    Story.appendSection(storyStore, caller, text);
  };

  // Read the ordered Story sections (text, deleted/gap state, counters, and
  // whether the caller has already voted on each). Public query so the
  // frontend can fetch it on demand without joining the game poll.
  public query ({ caller }) func getStorySections() : async [Types.StoryRow] {
    Story.getSections(storyStore, caller);
  };

  // Append a new live section at the end of the order. Writer-gated.
  public shared ({ caller }) func appendStorySection(text : Text) : async () {
    Story.appendSection(storyStore, caller, text);
  };

  // Fill a deleted section's gap, restoring it as a live section at that
  // position with counters reset to zero and recorded votes cleared.
  // Writer-gated.
  public shared ({ caller }) func fillStoryGap(index : Nat, text : Text) : async () {
    Story.fillGap(storyStore, caller, index, text);
  };

  // Press Delete on an appended section. Only a signed-in caller may vote, and
  // at most once per section; a repeat press is rejected and the counter does
  // not change.
  public shared ({ caller }) func pressStoryDelete(index : Nat) : async () {
    Story.pressDelete(storyStore, caller, index);
  };

  // Press Keep on an appended section. Only a signed-in caller may vote, and
  // at most once per section; a repeat press is rejected and the counter does
  // not change.
  public shared ({ caller }) func pressStoryKeep(index : Nat) : async () {
    Story.pressKeep(storyStore, caller, index);
  };
};
