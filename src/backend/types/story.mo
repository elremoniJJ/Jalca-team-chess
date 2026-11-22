import Common "common";

module {
  // Re-export shared types for convenience.
  public type Timestamp = Common.Timestamp;

  // Story-domain stable state.
  //
  // The Story is an ordered list of sections. Section 0 is the permanent
  // "Forever" section: it is seeded once by the migration chain and is
  // immutable — no endpoint may edit, delete, or vote on it, and it carries no
  // counters.
  //
  // Every section after Forever is an appended section with its own text, a
  // Delete counter, a Keep counter, and a deleted/gap state. A section is
  // removed only when its Delete count is >= 10 AND >= 3x its Keep count; a
  // removed section leaves a permanent visible gap at its position until the
  // sole writer fills it.
  //
  // Per-principal voting: each signed-in Internet Identity principal may cast
  // at most one Delete vote and at most one Keep vote per section. The
  // recorded voters are held in `deleteVoters` / `keepVoters` so a repeat
  // press from the same principal is rejected server-side and the counters do
  // not change. Anonymous callers may not vote at all. When a section is
  // deleted (or a gap is filled fresh), both voter sets are cleared and the
  // counters reset to zero.
  //
  // The sole writer is hardcoded at compile time (see lib/story.mo); the
  // `author` field is retained only for the legacy claimStoryAuthorship /
  // getStoryAuthor compatibility endpoints and is NOT the write gate.
  public type StorySection = {
    var text : Text;
    var deleteCount : Nat;
    var keepCount : Nat;
    var deleted : Bool;
    var deleteVoters : [var Principal];
    var keepVoters : [var Principal];
  };

  public type StoryStore = {
    var author : ?Principal;
    var sections : [var StorySection];
  };

  // Shared projection of a Story section for the OQL `story` entity and the
  // public read path. The store itself carries `var` fields and is
  // non-shared, so the OQL row source and `.sample` seed use this immutable
  // projection instead. `hasVotedDelete` / `hasVotedKeep` report whether the
  // requesting principal has already voted on this section, so the frontend
  // can render the controls in an already-voted state.
  public type StoryRow = {
    index : Nat;
    text : Text;
    deleteCount : Nat;
    keepCount : Nat;
    deleted : Bool;
    hasVotedDelete : Bool;
    hasVotedKeep : Bool;
  };
};
