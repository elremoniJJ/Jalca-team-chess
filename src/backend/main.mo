import Array "mo:core/Array";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Timer "mo:core/Timer";
import Debug "mo:core/Debug";
import Error "mo:core/Error";
import AccessControl "mo:caffeineai-authorization/access-control";
import MixinAuthorization "mo:caffeineai-authorization/MixinAuthorization";
import OQL "mo:caffeineai-oql";
import Expose "mo:caffeineai-oql/Expose";
import Entity "mo:caffeineai-oql/Entity";
import VarArrayEntity "mo:caffeineai-oql/VarArrayEntity";
import ArrayEntity "mo:caffeineai-oql/ArrayEntity";
import NatValue "mo:caffeineai-oql/NatValue";
import IntValue "mo:caffeineai-oql/IntValue";
import TextValue "mo:caffeineai-oql/TextValue";
import BoolValue "mo:caffeineai-oql/BoolValue";

import Types "types/chess-game";
import RecorderTypes "types/game-recorder";
import ExerciseTypes "types/exercise";
import DrinkingTypes "types/drinking";
import NftTypes "types/nft";
import PbppInformationTypes "types/pbpp-information";
import PredictionBetTypes "types/prediction-bet";
import RealBetTypes "types/real-bet";
import ChessGameApi "mixins/chess-game-api";
import ChessGame "lib/chess-game";
import GameRecorderApi "mixins/game-recorder-api";
import ExerciseApi "mixins/exercise-api";
import DrinkingApi "mixins/drinking-api";
import NftApi "mixins/nft-api";
import Nft "lib/nft";
import SpellsApi "mixins/spells-api";
import SpellStateApi "mixins/spell-state-api";
import PbppInformationApi "mixins/pbpp-information-api";
import PredictionBetApi "mixins/prediction-bet-api";
import RealBetApi "mixins/real-bet-api";
import ApiDocMixin "mixins/api-doc";
import BurnTypes "types/burn";
import BurnApi "mixins/burn-api";
import Spells "lib/spells";
import KickTypes "types/kick";
import KickApi "mixins/kick-api";
import ApprovalTypes "types/approval";
import ApprovalApi "mixins/approval-api";
import ShieldResolutionTypes "types/shield-and-spell-resolution";
import ShieldResolutionApi "mixins/shield-and-spell-resolution-api";
import SpellStateTypes "types/spell-state";
import StoryTypes "types/story";
import StoryApi "mixins/story-api";
import SundayCompTypes "types/sunday-comp";
import SundayComp "lib/sunday-comp";
import SundayCompApi "mixins/sunday-comp-api";
import PrizeTypes "types/prize";
import PrizeClaimTypes "types/prize-claim";
import PrizeApi "mixins/prize-api";

actor {
  // Flatten the parallel 10-place Sunday-competition archive into one row per
  // archived placement, for the OQL `prizePlacement` entity. The principal is
  // stored internally and is exposed only to the platform controller.
  func prizePlacements(
    archive : PrizeTypes.CompArchive10Store,
  ) : Iter.Iter<PrizeTypes.ArchivedPlacement10> {
    let rows = List.empty<PrizeTypes.ArchivedPlacement10>();
    for (comp in archive.items.values()) {
      for (placement in comp.placements.values()) {
        rows.add(placement);
      };
    };
    rows.values();
  };

  // Internet Identity / authorization stable state. The frontend Internet
  // Identity client calls the app canister's `_internet_identity_sign_in_start`
  // / `_internet_identity_sign_in_verify` method family, which is provided by
  // the `caffeineai-authorization` package's `MixinAuthorization`. This field
  // holds the role-based access-control state; the first authenticated caller
  // to sign in becomes admin. Initialized by the migration chain.
  let accessControlState : AccessControl.AccessControlState;

  // Internet Identity / authorization public API — exposes the
  // `_internet_identity_*` sign-in method family the frontend II client calls,
  // plus the role-based access-control endpoints. Must be included here in the
  // composition root, not in a domain mixin.
  include MixinAuthorization(accessControlState, null);

  // Chess game stable state. Initial values come from the migration chain.
  // `players` is wrapped in a mutable record cell because mixin parameters are
  // immutable bindings — the `.items` field is mutable so the mixin can
  // reassign the array reference with `:=`.
  var gameState : Types.GameState;
  let players : Types.PlayerStore;

  // Per-game Backend_Recorder stable state. Same mutable-record-cell pattern
  // as players. Initialized by the migration chain to an empty, inactive
  // recorder. The recorder accumulates move metadata during a game, snapshots
  // the Logged_In_List and team rosters at game conclusion, and resets to
  // empty AFTER the 10-second modal window elapses.
  let recorder : RecorderTypes.RecorderStore;

  // Exercise-domain stable state. Isolated from the rest of the backend: the
  // ExerciseApi mixin receives only this store as a parameter — no game state,
  // players, or recorder. The broader backend interacts with the
  // exercise domain through exactly two call sites (the create call on capture
  // in chess-game-api.mo's attemptMove, and the retrieve call for display).
  // Initialized by the migration chain to an empty store.
  let exerciseStore : ExerciseTypes.ExerciseStore;

  // Drinking-domain stable state. Fully isolated from the exercise domain
  // and the rest of the backend: the DrinkingApi mixin receives only this
  // store as a parameter — no game state, players, recorder, or
  // exercise store. The broader backend interacts with the drinking domain
  // through exactly two call sites (the create call on capture in
  // chess-game-api.mo, parallel to the exercise create call, and the
  // retrieve call for display). Initialized by the migration chain
  // to an empty store.
  let drinkingStore : DrinkingTypes.DrinkingStore;

  // NFT-domain stable state. Fully isolated from chess logic, game
  // recording, login, exercise, and drinking: the NftApi mixin receives
  // only this store (plus the recorder and gameState for read-only
  // snapshots at mint time) as parameters. The broader backend interacts
  // with the NFT domain through exactly one call site (the automatic mint
  // hook in chess-game-api.mo's concludeGame flow, which delegates to the
  // isolated Nft lib). The NFT domain mints locally (no inter-canister
  // call) and records outcomes in its own stable store, so a bug in
  // minting cannot corrupt any other domain because they share no
  // mutable state. Initialized by the migration chain to an empty store.
  let nftStore : NftTypes.NftStore;

  // Voting-domain stable state. Holds one vote per player for the next game's
  // settings (starting position + spell use). Votes are captured at game end
  // and applied to the next game's setup at startNewGame, then cleared so they
  // apply to exactly one game. Initialized by the migration chain to an empty
  // store.
  let voteStore : Types.VoteStore;

  // Voting-domain stable state: the FIXED vote snapshot that decided the
  // CURRENT game's settings. Captured once at the START of the current game
  // (startNewGame) from the live vote store and held unchanged for the whole
  // current game, so it does not change as players cast votes for the next
  // game. It carries the winning options plus the counts that produced them,
  // so the frontend can show the winning option with its real tally.
  // Initialized by the migration chain to the zero-vote snapshot (defaults
  // #Random / #On, all counts 0).
  let voteSnapshotStore : Types.VoteSnapshotStore;

  // PBPP_Information-domain stable state. Fully isolated from the rest of the
  // backend: the PbppInformationApi mixin receives only this store as a
  // parameter — no game state, players, or any other domain store. The
  // record is a single informational, time-stamped, appendable record storing
  // the verbatim PBPP status/requirements update. It is a reference point, not
  // active logic. Each append adds a NEW time-stamped entry; prior entries are
  // never overwritten. Initialized by the migration chain to a store seeded
  // with the initial PBPP status/requirements update.
  let pbppInformationStore : PbppInformationTypes.PbppInformationStore;

  // Prediction Bet-domain stable state. Fully isolated from the rest of the
  // backend: the PredictionBetApi mixin receives only this store as a
  // parameter — no game state, players, or any other domain store. The
  // domain accepts bet submissions (pot, prediction, player principal, display
  // username, anonymity preference) and records authoritative game results for
  // settlement. The PBPP and JALCA canister principals are configurable
  // (admin-set), not hard-coded, because the PBPP canister address is not yet
  // known. Initialized by the migration chain to an empty store.
  let betStore : PredictionBetTypes.BetStore;

  // Real Bet-domain stable state. Fully isolated from the rest of the backend:
  // the RealBetApi mixin receives only this store as a parameter — no game
  // state, players, or any other domain store. The domain relays a
  // player's real bet to JEL's place_bet, checks the player's ledger allowance
  // via icrc2_allowance, and reports a game outcome to JEL's report_outcome,
  // recording successful real bets and settlements locally alongside the JEL
  // bet_id / round_id. The cross-canister calls to JEL originate from JALCA's
  // own backend principal. Initialized by the migration chain to an empty
  // store.
  let realBetStore : RealBetTypes.RealBetStore;

  // Burn-domain stable state. Holds the burned-spell team windows (White and
  // Black) plus the per-turn burn flags. The per-turn flags are reset when a
  // new turn begins (resetBurnForNewTurn, called from the chess mixin's
  // move-completion path). The team spell windows accumulate every cast spell
  // for the whole game and are cleared only at game start and game end
  // (resetBurnForNewGame). The burn does NOT modify the chessboard or pieces.
  // Initialized by the migration chain to an empty state.
  let burnStore : BurnTypes.BurnStore;

  // Kick-domain stable state. Holds the kick votes keyed by (target, kicker)
  // pair so votes are unique per kicker-target pair and a kicker's votes can
  // be cleanly removed when they leave. Per-player kick counts and 'kicked by'
  // arrays are derived from these vote records (never stored separately), so
  // the count always equals the array length. Kicks are tied to player
  // identity/wallet, never team color, so a kick never affects a player's
  // prediction bet placed before the game started. All kicks are erased at the
  // end of every game. Initialized by the migration chain to an empty store.
  let kickStore : KickTypes.KickStore;

  // Approval-domain stable state. Holds one spender-approval state per
  // player, keyed by the player's PseudoPrincipal. The ICRC-37 spender
  // approval is DISABLED: the burn no longer requires it — the backend burns
  // directly as itself through the allowlisted-admin path (see lib/nft.mo).
  // The store is retained only as a local mirror so the frontend toggle can
  // reflect recorded state. Initialized by the migration chain to an empty
  // state list.
  let approvalStore : ApprovalTypes.ApprovalStore;

  // Shield-and-spell-resolution-domain stable state. Holds the per-game
  // shield totals for both teams plus the pending burn-and-play result for
  // the distinct toast. The shield is scoped to a single game: it resets to
  // zero for both teams at the start of every new game and never carries
  // over. The pending burn-and-play result is cleared when a new turn
  // begins. This is transient per-game state, NOT a history log.
  // Initialized by the migration chain to an empty state.
  let shieldResolutionStore : ShieldResolutionTypes.ShieldResolutionStore;

  // Guaranteed-tier stable state. Holds the guaranteed set keyed on the
  // post-'_copy' roster username, each entry carrying its own NFT wallet
  // address and a verified-bet flag. Entries are self-contained so heartbeat
  // cleanup of the player row cannot strip the wallet address. The set is
  // cleared at the start of each new game alongside the vote clearing.
  // Initialized by the migration chain to an empty store.
  let guaranteedStore : Types.GuaranteedStore;

  // Ranked-play stable state: the roster bindings claimed at ranked login,
  // keyed by the roster key (the pseudo-principal the player supplied). Each
  // binding holds the bound Internet Identity principal plus the sanitized
  // username the player typed at that login, so a win credits the typed name
  // rather than the '_copy'-adjusted roster username. NOT exposed through any
  // OQL entity. Initialized by the migration chain to an empty store.
  let rosterBindings : Types.RosterBindingStore;

  // Ranked-play stable state: the per-principal win records, keyed by the
  // bound Internet Identity principal. Each entry carries the display name
  // (refreshed from the binding on each ranked login), the win count, and the
  // game number of the most recent win (0 before any win). NOT exposed through
  // any OQL entity. Initialized by the migration chain to an empty store.
  let winnerStore : Types.WinnerStore;

  // Sunday-competition stable state: the current competition's per-principal
  // win records, keyed by the bound Internet Identity principal. Each entry
  // carries the most recent display name, the competition win count, and the
  // order in which the player reached that count (ascending tie-break). The
  // store is reset to empty when a new competition begins. NOT exposed through
  // any OQL entity. Initialized by the migration chain to an empty store.
  let compWinStore : SundayCompTypes.CompWinStore;

  // Sunday-competition stable state: the append-only winners archive, one entry
  // per finalized Sunday (date, winner, runner-up, each with the principal
  // stored internally plus the username and win count at that moment). Newest
  // last. NOT exposed through any OQL entity. Initialized by the migration
  // chain to an empty archive.
  let compArchiveStore : SundayCompTypes.CompArchiveStore;

  // Sunday-competition stable state: the marker recording the last finalized
  // competition so finalization is exactly-once. `lastFinalizedSunday` is the
  // Sunday date of the most recently archived competition (0 before any
  // finalization). Initialized by the migration chain to 0.
  let compFinalizeMarker : SundayCompTypes.CompFinalizeMarker;

  // Prize-domain stable state: the parallel 10-place Sunday-competition
  // archive, one entry per finalized Sunday carrying the top-ten placements
  // (rank, principal, display name, win count). It is finalized lazily and
  // idempotently alongside the existing 2-place compArchiveStore, which is left
  // completely untouched in shape and behavior. Newest last. NOT exposed
  // through any OQL entity. Initialized by the migration chain to an empty
  // archive.
  let compArchive10Store : PrizeTypes.CompArchive10Store;

  // Prize-domain stable state: the marker recording the last Sunday finalized
  // into the 10-place archive, so that finalization is exactly-once.
  // `lastFinalizedSunday` is the Sunday date of the most recently archived
  // competition (0 before any finalization). Initialized by the migration chain
  // to 0.
  let compFinalize10Marker : PrizeTypes.CompFinalize10Marker;

  // Prize-domain stable state: the per-Sunday admin allocations, keyed by the
  // Sunday date (UTC, nanoseconds at 00:00:00). Each entry stores the total
  // pool the admin loaded (fees included) plus the first and ten rank prizes
  // derived from it. The player view reads only the first prize for an
  // allocated Sunday; the pool is never returned to players. NOT exposed
  // through any OQL entity. Initialized by the migration chain to an empty
  // store.
  let prizeAllocationStore : PrizeTypes.PrizeAllocationStore;

  // Prize-claim-domain stable state: the per-placement claim records, keyed by
  // the competition start timestamp (the archive key) and the 1-based rank.
  // Each record carries the claim state machine value (claimable / paying /
  // paid), the recipient principal locked at the first attempt, the exact prize
  // amount in e8s, the ledger block index when paid, and the manual-check flag.
  // NOT exposed through any OQL entity. Initialized by the migration chain to
  // an empty store.
  let prizeClaimStore : PrizeClaimTypes.PrizeClaimStore;

  // Prize-claim-domain stable state: the configurable prize canister principal,
  // written by the admin-only setter. Defaults to the live prize canister
  // hqxm3-eaaaa-aaaam-ajppa-cai. Initialized by the migration chain.
  let prizeCanisterConfig : PrizeTypes.PrizeCanisterConfig;

  // Story-domain stable state. Holds the ordered Story sections: section 0 is
  // the permanent, immutable "Forever" section seeded by the migration chain;
  // every later section carries its own text, Delete/Keep counters, and
  // deleted/gap state. The `author` field is retained only for the legacy
  // claimStoryAuthorship / getStoryAuthor compatibility endpoints and is NOT
  // the write gate (the writer is hardcoded in lib/story.mo). Initialized by
  // the migration chain to the Forever section.
  let storyStore : StoryTypes.StoryStore;

  // Chess game public API. Receives the exercise and drinking stores so the
  // move path can make the single isolated create call on capture for each
  // domain (compute + append via the respective lib). Receives the nftStore
  // so the concludeGame flow can make the single isolated automatic-mint
  // call (delegating to the isolated NFT lib). Receives the burnStore so the
  // move-completion path can reset the per-turn burn flags when the turn
  // advances. No other exercise, drinking, NFT, or burn coupling exists in
  // the chess mixin.
  include ChessGameApi(gameState, players, recorder, exerciseStore, drinkingStore, nftStore, voteStore, voteSnapshotStore, burnStore, kickStore, shieldResolutionStore, guaranteedStore, rosterBindings, winnerStore, compWinStore, compArchiveStore, compFinalizeMarker, compArchive10Store, compFinalize10Marker, prizeAllocationStore, prizeClaimStore);

  // Install the recurring maintenance timer on the install path. In Motoko,
  // top-level actor-body initialization expressions run once on install; on
  // upgrade only stable state is preserved and `system func postupgrade` runs,
  // so this statement does NOT re-execute on upgrade. The timer handle is a
  // runtime capability, not durable state, so it is not persisted across
  // upgrades — the `postupgrade` hook below re-arms it. Exactly one timer is
  // armed per (re)start: this install runs on install, postupgrade runs on
  // upgrade. The install is a direct statement in the actor body because the
  // `system` capability that Timer.recurringTimer requires is available in the
  // actor initializer and in postupgrade, but not in a mixin body or in a
  // function called from either. The callback runs the mixin's public
  // runMaintenance.
  ignore Timer.recurringTimer<system>(
    #seconds(ChessGame.maintenanceIntervalSeconds),
    func() : async () {
      try {
        await runMaintenance(Time.now());
      } catch e {
        Debug.print("[tick] error: " # Error.message(e));
        // Swallow: a transient trap affects only this tick; the next tick retries.
      };
      // Archive any competition whose day has fully passed, so a competition
      // finalizes automatically when it ends even with no reader. Idempotent
      // and exactly-once via the two finalize markers; a no-op when nothing is
      // due. Wrapped in its own try/catch so a finalize failure never blocks
      // the maintenance pass (and vice versa).
      try {
        ignore SundayComp.finalizeNow(
          compWinStore,
          compArchiveStore,
          compFinalizeMarker,
          compArchive10Store,
          compFinalize10Marker,
          prizeAllocationStore,
          prizeClaimStore,
          Time.now(),
        );
      } catch _ {
        // Swallow: a transient trap affects only this tick; the next tick retries.
      };
    },
  );

  // Re-arm the recurring maintenance timer after an upgrade. The timer handle
  // is runtime-only and is NOT preserved across upgrades, so without this hook
  // the maintenance pass (stale-player cleanup, turn-timeout expiry,
  // celebration expiry) and the automatic competition finalize would silently
  // stop firing after the first upgrade. Same cadence and same callback as the
  // install path above, so exactly one timer is armed per (re)start.
  system func postupgrade() {
    ignore Timer.recurringTimer<system>(
      #seconds(ChessGame.maintenanceIntervalSeconds),
      func() : async () {
        try {
          await runMaintenance(Time.now());
        } catch e {
          Debug.print("[tick] error: " # Error.message(e));
          // Swallow: a transient trap affects only this tick; the next tick retries.
        };
        try {
          ignore SundayComp.finalizeNow(
            compWinStore,
            compArchiveStore,
            compFinalizeMarker,
            compArchive10Store,
            compFinalize10Marker,
            prizeAllocationStore,
            prizeClaimStore,
            Time.now(),
          );
        } catch _ {
          // Swallow: a transient trap affects only this tick; the next tick retries.
        };
      },
    );
  };

  // Game recorder public API — exposes getGameRecord for the frontend modal.
  include GameRecorderApi(recorder, gameState, players);

  // Exercise public API — isolated create/retrieve entry points for the
  // exercise domain. Receives only its own ExerciseStore.
  include ExerciseApi(exerciseStore);

  // Drinking public API — isolated create/retrieve entry points for the
  // drinking domain. Receives only its own DrinkingStore.
  include DrinkingApi(drinkingStore);

  // NFT public API — isolated mint and query entry points for the NFT
  // domain. Receives its own NftStore plus the recorder and gameState for
  // read-only snapshots at mint time. Exposes mintGameNfts (the public
  // entrypoint invoked at game conclusion), clearNftMintAttempts (called
  // on new-game start), and the query methods the frontend polls for mint
  // status and NFT metadata. No manual re-mint trigger (the doNotBuild
  // contract excludes a manual re-mint trigger button); minting is
  // automatic at game conclusion via the chess mixin's concludeGame flow.
  // The debug-only mintTestNft endpoint passes null for callingPrincipal
  // and relies on the ICRC-7 canister's #GenericError debug echo to
  // surface the calling principal + authorized principals on rejection
  // (Principal.fromActor(this) is not usable in this toolchain — `this`
  // is unbound both at actor `include` sites and inside mixin/actor
  // method bodies in moc 1.11.2 / core 2.6.1).
  include NftApi(nftStore, recorder, gameState, guaranteedStore);

  // Spells public API — exposes the spell table query. The spell table is a
  // module constant (static data, not stable state), so this mixin takes no
  // state parameter and reads the table directly from the Spells lib.
  include SpellsApi();

  // Spell board state public API — exposes the active spell board state for
  // the current game (spell-use gate + blocked/explosive squares) so the
  // frontend can wire spell-aware legal-move highlighting. Receives the
  // gameState for read-only access to spellUseEnabled and spellBoardState.
  include SpellStateApi(gameState);

  // PBPP_Information public API — append/retrieve entry points for the
  // PBPP_Information domain. Receives only its own PbppInformationStore.
  include PbppInformationApi(pbppInformationStore);

  // Prediction Bet public API — bet submission, result recording, and
  // configurable PBPP/JALCA principal entry points for the Prediction Bet
  // domain. Receives only its own BetStore.
  include PredictionBetApi(betStore);

  // Real Bet public API — relay a real bet to JEL, check the player's ledger
  // allowance, report a game outcome to JEL, and read locally recorded real
  // bets and settlements. Receives its own RealBetStore plus the guaranteed
  // store so a successfully placed bet marks that username's guaranteed entry
  // as bet-verified.
  include RealBetApi(realBetStore, guaranteedStore);

  // Behavioral API documentation — exposes getApiDoc, a static Markdown
  // description of the public API. Takes no state and reads nothing.
  include ApiDocMixin();

  // Burn public API — record a Move_Maker's NFT spell burn and read the
  // current burned-spell team-window state. Receives the burnStore
  // plus the gameState, players, and recorder for read-only access when
  // enforcing the burn restrictions (Move_Maker-only, one burn per turn,
  // first-turn defensive-only, and spell-name/Game-number eligibility).
  include BurnApi(burnStore, gameState, players, recorder);

  // Kick public API — cast/withdraw kick votes and query the live kick state.
  // Receives its own kickStore plus the players store and game state so kick
  // resolution can move a kicked player to the opposing team and reuse the
  // disconnect / Move_Maker reassignment mechanism.
  include KickApi(kickStore, players, gameState);

  // Approval public API — read the local spender-approval mirror and
  // record/clear it locally. The ICRC-37 spender-approval inter-canister
  // attempt is disabled (fireApproval performs no inter-canister call and
  // returns #err); the burn burns directly as itself through the
  // allowlisted-admin path. Receives only its own ApprovalStore.
  include ApprovalApi(approvalStore);

  // Shield-and-spell-resolution public API — burn and play an NFT spell for
  // the current Move_Maker (enforcing the burn restrictions, performing the
  // burn through the existing burn path, applying the shield math, and
  // recording the burn-and-play result for the distinct toast) plus the
  // shield-state and snapshot queries. Receives its own store plus the
  // burnStore, gameState, players, and recorder for the shared restriction
  // logic.
  // `concludeBySpellCheck` is brought into scope by the earlier
  // `include ChessGameApi(...)` as a shared function, which cannot be passed
  // where a plain async function is expected. Wrap it locally to adapt the
  // function modifier without changing the public API.
  func concludeBySpellCheckLocal(
    winner : Types.Team,
    spellName : Text,
    now : Types.Timestamp,
  ) : async () {
    await concludeBySpellCheck(winner, spellName, now);
  };
  // `concludeByInsufficientMaterial` is likewise brought into scope by the
  // earlier `include ChessGameApi(...)` as a shared function; wrap it locally
  // to adapt the function modifier without changing the public API.
  func concludeByInsufficientMaterialLocal(
    now : Types.Timestamp,
  ) : async () {
    await concludeByInsufficientMaterial(now);
  };
  include ShieldResolutionApi(shieldResolutionStore, burnStore, gameState, players, recorder, concludeBySpellCheckLocal, concludeByInsufficientMaterialLocal);

  // Story public API — claim the sole Story authorship (keyed on the real
  // caller Internet Identity principal), read the recorded author, and write
  // the Story text (gated to the recorded sole author). Receives only its own
  // StoryStore.
  include StoryApi(storyStore);

  // Sunday-competition public API — the Sunday comp standings (top 50, no
  // principals, own row marked), the Past winners table (newest first, no
  // principals), and the competition status (live or frozen, the current
  // Sunday date, seconds remaining). Receives its own three stores; the
  // Sunday stores are internal and are NOT exposed through OQL.
  include SundayCompApi(compWinStore, compArchiveStore, compFinalizeMarker, compArchive10Store, compFinalize10Marker, prizeAllocationStore, prizeClaimStore);

  // Prize public API — the current and archived competition prize pools, the
  // caller's own claimable prize (signed-in Internet Identity callers only),
  // the claim status, the player-facing first prize for a Sunday, and the
  // admin-only allocation controls (upcoming-Sunday statuses, preview, save,
  // clear). Receives the live competition store plus the 10-place archive and
  // its finalization marker; the prize endpoints finalize the 10-place archive
  // lazily and idempotently before reading. Also receives the per-Sunday
  // allocation store the admin controls read and write.
  include PrizeApi(compWinStore, compArchiveStore, compFinalizeMarker, compArchive10Store, compFinalize10Marker, prizeAllocationStore, prizeClaimStore, prizeCanisterConfig);

  // Startup reconciliation: sync the cache-only nextTokenId counter from the
  // collection canister's authoritative supply. The counter is never used as
  // a requested token id (mintForPlayer calls mint_auto, which assigns the id
  // internally), but keeping it in sync makes local caching/ordering
  // meaningful after an upgrade. Best-effort: a failed query leaves the
  // counter unchanged. Runs once per (re)start.
  ignore Timer.setTimer<system>(
    #seconds(0),
    func() : async () {
      await Nft.reconcileNextTokenId(nftStore);
    },
  );

  // OQL — expose stored collections for natural-language querying.
  // Players use manual mode because their row type carries mutable `var`
  // fields / non-primitive shapes; we project the public-facing fields.
  include Expose({
    entities = [
      // Players entity — controller only (private game state, agent-readable).
      // The row type is the shared PlayerOql projection (Player itself carries
      // mutable `var` fields and is non-shared, so the OQL `.sample` seed and
      // row source must use the shared projection). The source reads the live
      // players array and projects each row. `lastPing` is projected to a Text
      // column (the raw nanosecond timestamp as text) and `isMoveMaker` to a
      // Text column ("true"/"false"), because the OQL payload extractor must
      // return a `Value`-compatible primitive and the shared projection's
      // `lastPing` is a `Timestamp` (Int) while `isMoveMaker` is a Bool.
      Entity.manual<Types.PlayerOql>(
        "player",
        func () = players.items.values().map(func p = {
          principal = p.principal;
          username = p.username;
          team = p.team;
          lastPing = p.lastPing;
          isMoveMaker = p.isMoveMaker;
          walletAddress = p.walletAddress;
          walletSource = p.walletSource;
          isFresh = p.isFresh;
          isInactive = p.isInactive;
          isBot = p.isBot;
          turnsThisGame = p.turnsThisGame;
        } : Types.PlayerOql),
        "Player",
        "principal",
      )
        .sample({
          principal = "";
          username = "";
          team = #White;
          lastPing = 0;
          isMoveMaker = false;
          walletAddress = null;
          walletSource = #none;
          isFresh = false;
          isInactive = false;
          isBot = false;
          turnsThisGame = 0;
        })
        .payload("principal", func(p : Types.PlayerOql) : Text { p.principal })
        .payload("username", func(p : Types.PlayerOql) : Text { p.username })
        .payload("team", func(p : Types.PlayerOql) : Text {
          switch (p.team) {
            case (#White) "White";
            case (#Black) "Black";
          }
        })
        .payload("lastPing", func(p : Types.PlayerOql) : Text { p.lastPing.toText() })
        .payload("isMoveMaker", func(p : Types.PlayerOql) : Text {
          if (p.isMoveMaker) "true" else "false"
        })
        .payload("walletAddress", func(p : Types.PlayerOql) : Text {
          switch (p.walletAddress) {
            case null "";
            case (?a) a;
          }
        })
        .payload("walletSource", func(p : Types.PlayerOql) : Text {
          switch (p.walletSource) {
            case (#none) "none";
            case (#typed) "typed";
            case (#oisy) "oisy";
          }
        })
        .payload("isFresh", func(p : Types.PlayerOql) : Bool { p.isFresh })
        .payload("isInactive", func(p : Types.PlayerOql) : Bool { p.isInactive })
        .payload("isBot", func(p : Types.PlayerOql) : Bool { p.isBot })
        .payload("turnsThisGame", func(p : Types.PlayerOql) : Nat { p.turnsThisGame })
        .controllerOnly()
        .build(),

      // Recorded-move entity — controller only. Exposes the per-game move
      // metadata accumulated by the Backend_Recorder.
      recorder.moves.toEntityManual("recordedMove", "RecordedMove", "index")
        .sample({
          index = 0;
          username = "";
          team = #White;
          fromSquare = 0;
          toSquare = 0;
          notation = "";
          gaveCheck = false;
          capturedPiece = null;
          isCastling = false;
          promotion = null;
          isEnPassant = false;
          timestamp = 0;
        } : RecorderTypes.RecordedMove)
        .payload("index", func(m : RecorderTypes.RecordedMove) : Nat { m.index })
        .payload("username", func(m : RecorderTypes.RecordedMove) : Text { m.username })
        .payload("team", func(m : RecorderTypes.RecordedMove) : Text {
          switch (m.team) {
            case (#White) "White";
            case (#Black) "Black";
          }
        })
        .payload("fromSquare", func(m : RecorderTypes.RecordedMove) : Nat { m.fromSquare })
        .payload("toSquare", func(m : RecorderTypes.RecordedMove) : Nat { m.toSquare })
        .payload("notation", func(m : RecorderTypes.RecordedMove) : Text { m.notation })
        .payload("gaveCheck", func(m : RecorderTypes.RecordedMove) : Bool { m.gaveCheck })
        .payload("capturedPiece", func(m : RecorderTypes.RecordedMove) : Text {
          switch (m.capturedPiece) {
            case null "";
            case (?t)
              switch (t) {
                case (#Pawn) "Pawn";
                case (#Rook) "Rook";
                case (#Knight) "Knight";
                case (#Bishop) "Bishop";
                case (#Queen) "Queen";
                case (#King) "King";
              };
          }
        })
        .payload("isCastling", func(m : RecorderTypes.RecordedMove) : Bool { m.isCastling })
        .payload("promotion", func(m : RecorderTypes.RecordedMove) : Text {
          switch (m.promotion) {
            case null "";
            case (?t)
              switch (t) {
                case (#Pawn) "Pawn";
                case (#Rook) "Rook";
                case (#Knight) "Knight";
                case (#Bishop) "Bishop";
                case (#Queen) "Queen";
                case (#King) "King";
              };
          }
        })
        .payload("isEnPassant", func(m : RecorderTypes.RecordedMove) : Bool { m.isEnPassant })
        .payload("timestamp", func(m : RecorderTypes.RecordedMove) : RecorderTypes.Timestamp { m.timestamp })
        .controllerOnly()
        .build(),

      // Player-list entity — controller only. Snapshot of the Logged_In_List
      // at game conclusion (1-based listPosition). Only present (non-stale
      // heartbeat) players are snapshotted; walletAddress carries each present
      // player's optional Oisy wallet address for NFT-popup eligibility.
      recorder.playerList.toEntityManual<RecorderTypes.PlayerListEntry>("playerListEntry", "PlayerListEntry", "listPosition")
        .sample({
          listPosition = 0;
          principal = "";
          username = "";
          team = #White;
          walletAddress = null;
        } : RecorderTypes.PlayerListEntry)
        .payload("listPosition", func(e : RecorderTypes.PlayerListEntry) : Nat { e.listPosition })
        .payload("principal", func(e : RecorderTypes.PlayerListEntry) : Text { e.principal })
        .payload("username", func(e : RecorderTypes.PlayerListEntry) : Text { e.username })
        .payload("team", func(e : RecorderTypes.PlayerListEntry) : Text {
          switch (e.team) {
            case (#White) "White";
            case (#Black) "Black";
          }
        })
        .payload("walletAddress", func(e : RecorderTypes.PlayerListEntry) : Text {
          switch (e.walletAddress) {
            case null "";
            case (?a) a;
          }
        })
        .controllerOnly()
        .build(),

      // Team-roster entity — controller only. One row per team at game
      // conclusion, with member count.
      recorder.rosters.toEntityManual<RecorderTypes.TeamRoster>("teamRoster", "TeamRoster", "team")
        .sample({
          team = #White;
          members = [];
          count = 0;
        } : RecorderTypes.TeamRoster)
        .payload("team", func(r : RecorderTypes.TeamRoster) : Text {
          switch (r.team) {
            case (#White) "White";
            case (#Black) "Black";
          }
        })
        .payload("count", func(r : RecorderTypes.TeamRoster) : Nat { r.count })
        .controllerOnly()
        .build(),

      // Exercise-assignment entity — controller only. One row per capture,
      // in capture sequence. The team that LOST the captured piece performs
      // the chosen exercise for the computed rep count.
      exerciseStore.items.toEntityManual("exerciseAssignment", "ExerciseAssignment", "index")
        .sample({
          index = 0;
          lostTeam = #White;
          capturedPiece = #Pawn;
          reps = 0;
          exercise = #PushUps;
          timestamp = 0;
          trigger = null;
          moveIndex = 0;
        } : ExerciseTypes.ExerciseAssignment)
        .payload("index", func(a : ExerciseTypes.ExerciseAssignment) : Nat { a.index })
        .payload("lostTeam", func(a : ExerciseTypes.ExerciseAssignment) : Text {
          switch (a.lostTeam) {
            case (#White) "White";
            case (#Black) "Black";
          }
        })
        .payload("capturedPiece", func(a : ExerciseTypes.ExerciseAssignment) : Text {
          switch (a.capturedPiece) {
            case (#Pawn) "Pawn";
            case (#Rook) "Rook";
            case (#Knight) "Knight";
            case (#Bishop) "Bishop";
            case (#Queen) "Queen";
            case (#King) "King";
          }
        })
        .payload("reps", func(a : ExerciseTypes.ExerciseAssignment) : Nat { a.reps })
        .payload("exercise", func(a : ExerciseTypes.ExerciseAssignment) : Text {
          switch (a.exercise) {
            case (#PushUps) "PushUps";
            case (#Squats) "Squats";
            case (#Crunches) "Crunches";
            case (#NinjaRoll) "NinjaRoll";
            case (#Cartwheel) "Cartwheel";
          }
        })
        .payload("timestamp", func(a : ExerciseTypes.ExerciseAssignment) : ExerciseTypes.Timestamp { a.timestamp })
        .payload("moveIndex", func(a : ExerciseTypes.ExerciseAssignment) : Nat { a.moveIndex })
        .controllerOnly()
        .build(),

      // Drinking-assignment entity — controller only. One row per capture,
      // in capture sequence. The team that LOST the captured piece drinks
      // the piece-type-derived drink count (pawn 1, knight 2, bishop 2,
      // rook 3, queen 4; king is never captured). No randomizer.
      drinkingStore.items.toEntityManual("drinkingAssignment", "DrinkingAssignment", "index")
        .sample({
          index = 0;
          lostTeam = #White;
          capturedPiece = #Pawn;
          drinks = 0;
          timestamp = 0;
          trigger = null;
          moveIndex = 0;
        } : DrinkingTypes.DrinkingAssignment)
        .payload("index", func(a : DrinkingTypes.DrinkingAssignment) : Nat { a.index })
        .payload("lostTeam", func(a : DrinkingTypes.DrinkingAssignment) : Text {
          switch (a.lostTeam) {
            case (#White) "White";
            case (#Black) "Black";
          }
        })
        .payload("capturedPiece", func(a : DrinkingTypes.DrinkingAssignment) : Text {
          switch (a.capturedPiece) {
            case (#Pawn) "Pawn";
            case (#Rook) "Rook";
            case (#Knight) "Knight";
            case (#Bishop) "Bishop";
            case (#Queen) "Queen";
            case (#King) "King";
          }
        })
        .payload("drinks", func(a : DrinkingTypes.DrinkingAssignment) : Nat { a.drinks })
        .payload("timestamp", func(a : DrinkingTypes.DrinkingAssignment) : DrinkingTypes.Timestamp { a.timestamp })
        .payload("moveIndex", func(a : DrinkingTypes.DrinkingAssignment) : Nat { a.moveIndex })
        .controllerOnly()
        .build(),

      // Minted-NFT entity — controller only. One row per minted NFT, in
      // mint order (tokenId == row index). Each NFT is a verifiable game
      // artifact: the metadata encodes the game result, end state, final
      // board state, recipient role/team/username/wallet address, move
      // count, and conclusion timestamp. The owner is the Principal
      // parsed from the recipient's wallet address at mint time.
      nftStore.nfts.toEntityManual("nftRecord", "NftRecord", "tokenId")
        .sample({
          tokenId = 0;
          owner = Principal.fromText("aaaaa-aa");
          metadata = {
            gameResult = #WhiteWin;
            endState = #Checkmate;
            finalBoardState = [];
            recipientRole = #Winner;
            recipientTeam = #White;
            recipientUsername = "";
            recipientWalletAddress = "";
            moveCount = 0;
            concludedAt = 0;
            gameNumber = 0;
            spellId = 0;
            spellName = "";
          } : NftTypes.MintMetadata;
          mintedAt = 0;
        } : NftTypes.NftRecord)
        .payload("tokenId", func(r : NftTypes.NftRecord) : Nat { r.tokenId })
        .payload("owner", func(r : NftTypes.NftRecord) : Text { r.owner.toText() })
        .payload("gameResult", func(r : NftTypes.NftRecord) : Text {
          switch (r.metadata.gameResult) {
            case (#WhiteWin) "WhiteWin";
            case (#BlackWin) "BlackWin";
            case (#Draw) "Draw";
          }
        })
        .payload("endState", func(r : NftTypes.NftRecord) : Text {
          switch (r.metadata.endState) {
            case (#Checkmate) "Checkmate";
            case (#Stalemate) "Stalemate";
            case (#Draw) "Draw";
            case (#Timeout) "Timeout";
            case (#InsufficientMaterial) "InsufficientMaterial";
          }
        })
        .payload("recipientRole", func(r : NftTypes.NftRecord) : Text {
          switch (r.metadata.recipientRole) {
            case (#Winner) "Winner";
            case (#Drawer) "Drawer";
          }
        })
        .payload("recipientTeam", func(r : NftTypes.NftRecord) : Text {
          switch (r.metadata.recipientTeam) {
            case (#White) "White";
            case (#Black) "Black";
          }
        })
        .payload("recipientUsername", func(r : NftTypes.NftRecord) : Text { r.metadata.recipientUsername })
        .payload("recipientWalletAddress", func(r : NftTypes.NftRecord) : Text { r.metadata.recipientWalletAddress })
        .payload("moveCount", func(r : NftTypes.NftRecord) : Nat { r.metadata.moveCount })
        .payload("concludedAt", func(r : NftTypes.NftRecord) : NftTypes.Timestamp { r.metadata.concludedAt })
        .payload("gameNumber", func(r : NftTypes.NftRecord) : Nat { r.metadata.gameNumber })
        .payload("spellId", func(r : NftTypes.NftRecord) : Nat { r.metadata.spellId })
        .payload("spellName", func(r : NftTypes.NftRecord) : Text { r.metadata.spellName })
        .payload("mintedAt", func(r : NftTypes.NftRecord) : NftTypes.Timestamp { r.mintedAt })
        .controllerOnly()
        .build(),

      // Mint-attempt entity — controller only. One row per mint attempt,
      // retained across games and capped at the 10 most recent distinct game
      // numbers. Tracks the outcome of each player's mint so the frontend's
      // mint-status poll can read it. The `gameNumber` column is the
      // grouping key for retention.
      nftStore.mintAttempts.toEntityManual("mintAttempt", "MintAttempt", "id")
        .sample({
          id = 0;
          gameNumber = 0;
          recipientWalletAddress = "";
          recipientUsername = "";
          recipientTeam = #White;
          recipientRole = #Winner;
          outcome = #succeeded({ tokenId = 0 });
          attemptedAt = 0;
        } : NftTypes.MintAttempt)
        .payload("id", func(a : NftTypes.MintAttempt) : Nat { a.id })
        .payload("gameNumber", func(a : NftTypes.MintAttempt) : Nat { a.gameNumber })
        .payload("recipientWalletAddress", func(a : NftTypes.MintAttempt) : Text { a.recipientWalletAddress })
        .payload("recipientUsername", func(a : NftTypes.MintAttempt) : Text { a.recipientUsername })
        .payload("recipientTeam", func(a : NftTypes.MintAttempt) : Text {
          switch (a.recipientTeam) {
            case (#White) "White";
            case (#Black) "Black";
          }
        })
        .payload("recipientRole", func(a : NftTypes.MintAttempt) : Text {
          switch (a.recipientRole) {
            case (#Winner) "Winner";
            case (#Drawer) "Drawer";
          }
        })
        .payload("outcome", func(a : NftTypes.MintAttempt) : Text {
          switch (a.outcome) {
            case (#succeeded(_)) "succeeded";
            case (#skipped(_)) "skipped";
            case (#failed(_)) "failed";
          }
        })
        .payload("attemptedAt", func(a : NftTypes.MintAttempt) : NftTypes.Timestamp { a.attemptedAt })
        .controllerOnly()
        .build(),

      // Spell-table entity — controller only. One row per spell in the table
      // (BLOCK + MAJOR + MINOR), each carrying its drop percentage. The table
      // is a module constant (static data, not stable state), so the row
      // source reads directly from the Spells lib rather than an actor field.
      // The category variant is projected to a Text column via manual mode.
      Entity.manual<Spells.SpellEntry>(
        "spell",
        func () = Spells.allSpells().values(),
        "Spell",
        "id",
      )
        .sample({
          id = 0;
          name = "";
          meaning = "";
          spell = "";
          category = #Minor;
          dropChance = 0;
          complexity = #Easy;
          nftEligible = false;
          magicCategory = null;
          level = null;
        } : Spells.SpellEntry)
        .payload("id", func(s : Spells.SpellEntry) : Nat { s.id })
        .payload("name", func(s : Spells.SpellEntry) : Text { s.name })
        .payload("meaning", func(s : Spells.SpellEntry) : Text { s.meaning })
        .payload("spell", func(s : Spells.SpellEntry) : Text { s.spell })
        .payload("category", func(s : Spells.SpellEntry) : Text {
          switch (s.category) {
            case (#Block) "Block";
            case (#Major) "Major";
            case (#Minor) "Minor";
            case (#Balls) "Balls";
          }
        })
        .payload("dropChance", func(s : Spells.SpellEntry) : Nat { s.dropChance })
        .payload("complexity", func(s : Spells.SpellEntry) : Text {
          switch (s.complexity) {
            case (#Easy) "Easy";
            case (#Moderate) "Moderate";
            case (#Complex) "Complex";
          }
        })
        .payload("nftEligible", func(s : Spells.SpellEntry) : Bool { s.nftEligible })
        .payload("magicCategory", func(s : Spells.SpellEntry) : Text {
          switch (s.magicCategory) {
            case null "";
            case (?category)
              switch (category) {
                case (#Necromancy) "Necromancy";
                case (#Conjuring) "Conjuring";
                case (#Elemental) "Elemental";
                case (#Hex) "Hex";
              };
          }
        })
        .payload("level", func(s : Spells.SpellEntry) : Text {
          switch (s.level) {
            case null "";
            case (?level)
              switch (level) {
                case (#Basic) "Basic";
                case (#Skilled) "Skilled";
                case (#Advanced) "Advanced";
                case (#Mastery) "Mastery";
                case (#OP) "OP";
              };
          }
        })
        .controllerOnly()
        .build(),

      // Vote entity — controller only. One row per player's vote for the next
      // game's settings, keyed by PseudoPrincipal (the voteStore map key).
      // The startingPosition and spellUse variants are projected to Text
      // columns via manual mode. Votes are captured at game end and cleared
      // at startNewGame, so rows reflect the current pending vote set.
      Entity.manual<Types.VoteOql>(
        "vote",
        func () = voteStore.items.entries().map(func (principal, vote) = {
          principal = principal;
          startingPosition = vote.startingPosition;
          spellUse = vote.spellUse;
          turnDuration = vote.turnDuration;
        } : Types.VoteOql),
        "Vote",
        "principal",
      )
        .sample({
          principal = "";
          startingPosition = #Random;
          spellUse = #On;
          turnDuration = #TwoMinutes;
        } : Types.VoteOql)
        .payload("principal", func(v : Types.VoteOql) : Text { v.principal })
        .payload("startingPosition", func(v : Types.VoteOql) : Text {
          switch (v.startingPosition) {
            case (#Standard) "Standard";
            case (#Random) "Random";
          }
        })
        .payload("spellUse", func(v : Types.VoteOql) : Text {
          switch (v.spellUse) {
            case (#On) "On";
            case (#Off) "Off";
          }
        })
        .payload("turnDuration", func(v : Types.VoteOql) : Text {
          switch (v.turnDuration) {
            case (#TwoMinutes) "TwoMinutes";
            case (#NinetySeconds) "NinetySeconds";
            case (#OneMinute) "OneMinute";
          }
        })
        .controllerOnly()
        .build(),

      // PBPP_Information entity — controller only. One row per time-stamped
      // entry in the append-only PBPP_Information record, keyed by timestamp.
      // Each append adds a NEW entry; prior entries are never overwritten, so
      // rows accumulate the verbatim PBPP status/requirements updates over time.
      pbppInformationStore.entries.toEntityManual("pbppInformation", "PbppInformation", "timestamp")
        .sample({
          timestamp = 0;
          content = "";
        } : PbppInformationTypes.PbppInformationEntry)
        .payload("timestamp", func(e : PbppInformationTypes.PbppInformationEntry) : PbppInformationTypes.Timestamp { e.timestamp })
        .payload("content", func(e : PbppInformationTypes.PbppInformationEntry) : Text { e.content })
        .controllerOnly()
        .build(),

      // Bet entity — controller only. One row per recorded bet submission,
      // keyed by id. The pot and prediction variants are projected to Text
      // columns via manual mode.
      betStore.bets.toEntityManual("bet", "Bet", "id")
        .sample({
          id = 0;
          bet = {
            pot = #One;
            prediction = #White;
            playerPrincipal = "";
            displayUsername = "";
            anonymous = false;
          } : PredictionBetTypes.BetSubmission;
          timestamp = 0;
        } : PredictionBetTypes.BetRecord)
        .payload("id", func(b : PredictionBetTypes.BetRecord) : Nat { b.id })
        .payload("pot", func(b : PredictionBetTypes.BetRecord) : Text {
          switch (b.bet.pot) {
            case (#One) "One";
            case (#Ten) "Ten";
            case (#Hundred) "Hundred";
            case (#Thousand) "Thousand";
          }
        })
        .payload("prediction", func(b : PredictionBetTypes.BetRecord) : Text {
          switch (b.bet.prediction) {
            case (#White) "White";
            case (#Black) "Black";
            case (#Draw) "Draw";
          }
        })
        .payload("playerPrincipal", func(b : PredictionBetTypes.BetRecord) : Text { b.bet.playerPrincipal })
        .payload("displayUsername", func(b : PredictionBetTypes.BetRecord) : Text { b.bet.displayUsername })
        .payload("anonymous", func(b : PredictionBetTypes.BetRecord) : Bool { b.bet.anonymous })
        .payload("timestamp", func(b : PredictionBetTypes.BetRecord) : PredictionBetTypes.Timestamp { b.timestamp })
        .controllerOnly()
        .build(),

      // Game-result entity — controller only. One row per authoritative game
      // result recorded for settlement, keyed by id. The result variant is
      // projected to a Text column via manual mode.
      betStore.results.toEntityManual("gameResult", "GameResult", "id")
        .sample({
          id = 0;
          result = #White;
          timestamp = 0;
        } : PredictionBetTypes.ResultRecord)
        .payload("id", func(r : PredictionBetTypes.ResultRecord) : Nat { r.id })
        .payload("result", func(r : PredictionBetTypes.ResultRecord) : Text {
          switch (r.result) {
            case (#White) "White";
            case (#Black) "Black";
            case (#Draw) "Draw";
          }
        })
        .payload("timestamp", func(r : PredictionBetTypes.ResultRecord) : PredictionBetTypes.Timestamp { r.timestamp })
        .controllerOnly()
        .build(),

      // Real-bet entity — controller only. One row per locally recorded real
      // bet, keyed by the monotonic local id. Each row carries the full RealBet
      // (including the ICRC Ledger block index returned by the escrow and the
      // JALCA-generated game_id) plus the local recording timestamp. The
      // outcome variant and the nested RealBet fields are projected to flat
      // columns via manual mode.
      realBetStore.bets.toEntityManual("realBet", "RealBetRecord", "id")
        .sample({
          id = 0;
          bet = {
            amount_e8s = 0;
            anonymous = false;
            block_index = 0;
            game_id = "";
            outcome = #white;
            placed_at = 0;
            player = Principal.fromText("aaaaa-aa");
            pot_tier = 0;
            username = "";
            wallet_address = "";
          } : RealBetTypes.RealBet;
          timestamp = 0;
        } : RealBetTypes.RealBetRecord)
        .payload("id", func(r : RealBetTypes.RealBetRecord) : Nat { r.id })
        .payload("block_index", func(r : RealBetTypes.RealBetRecord) : Nat { r.bet.block_index })
        .payload("game_id", func(r : RealBetTypes.RealBetRecord) : Text { r.bet.game_id })
        .payload("player", func(r : RealBetTypes.RealBetRecord) : Text { r.bet.player.toText() })
        .payload("username", func(r : RealBetTypes.RealBetRecord) : Text { r.bet.username })
        .payload("anonymous", func(r : RealBetTypes.RealBetRecord) : Bool { r.bet.anonymous })
        .payload("pot_tier", func(r : RealBetTypes.RealBetRecord) : Nat { r.bet.pot_tier })
        .payload("amount_e8s", func(r : RealBetTypes.RealBetRecord) : Nat { r.bet.amount_e8s })
        .payload("outcome", func(r : RealBetTypes.RealBetRecord) : Text {
          switch (r.bet.outcome) {
            case (#white) "white";
            case (#black) "black";
            case (#draw) "draw";
          }
        })
        .payload("wallet_address", func(r : RealBetTypes.RealBetRecord) : Text { r.bet.wallet_address })
        .payload("placed_at", func(r : RealBetTypes.RealBetRecord) : Nat { r.bet.placed_at })
        .payload("timestamp", func(r : RealBetTypes.RealBetRecord) : RealBetTypes.Timestamp { r.timestamp })
        .controllerOnly()
        .build(),

      // Settlement entity — controller only. One row per locally recorded
      // settlement, keyed by the monotonic local id. Each row carries the
      // SettlementResult (the JALCA-generated game_id that was resolved, the
      // reported outcome, and the settlement time) plus the local recording
      // timestamp. The outcome variant is projected to a Text column via
      // manual mode.
      realBetStore.settlements.toEntityManual("settlement", "SettlementRecord", "id")
        .sample({
          id = 0;
          settlement = {
            game_id = "";
            outcome = #white;
            settled_at = 0;
          } : RealBetTypes.SettlementResult;
          timestamp = 0;
        } : RealBetTypes.SettlementRecord)
        .payload("id", func(r : RealBetTypes.SettlementRecord) : Nat { r.id })
        .payload("game_id", func(r : RealBetTypes.SettlementRecord) : Text { r.settlement.game_id })
        .payload("outcome", func(r : RealBetTypes.SettlementRecord) : Text {
          switch (r.settlement.outcome) {
            case (#white) "white";
            case (#black) "black";
            case (#draw) "draw";
          }
        })
        .payload("settled_at", func(r : RealBetTypes.SettlementRecord) : Nat { r.settlement.settled_at })
        .payload("timestamp", func(r : RealBetTypes.SettlementRecord) : RealBetTypes.Timestamp { r.timestamp })
        .controllerOnly()
        .build(),

      // Burned-spell entity — controller only. One row per burned spell in
      // the team windows (White and Black, each with its
      // Minor/Major and Subao Ve sections). The team spell windows accumulate
      // every cast spell for the whole game and are cleared only at game start
      // and game end. The team and category variants are
      // projected to Text columns via manual mode.
      Entity.manual<BurnTypes.BurnedSpell>(
        "burnedSpell",
        func () = burnStore.state.whiteWindow.minorMajorSpells.values()
          .concat(burnStore.state.whiteWindow.subaoVeSpells.values())
          .concat(burnStore.state.blackWindow.minorMajorSpells.values())
          .concat(burnStore.state.blackWindow.subaoVeSpells.values()),
        "BurnedSpell",
        "spellName",
      )
        .sample({
          spellName = "";
          gameNumber = 0;
          team = #White;
          category = #Minor;
          outcome = #noEffect;
        } : BurnTypes.BurnedSpell)
        .payload("spellName", func(s : BurnTypes.BurnedSpell) : Text { s.spellName })
        .payload("gameNumber", func(s : BurnTypes.BurnedSpell) : Nat { s.gameNumber })
        .payload("team", func(s : BurnTypes.BurnedSpell) : Text {
          switch (s.team) {
            case (#White) "White";
            case (#Black) "Black";
          }
        })
        .payload("category", func(s : BurnTypes.BurnedSpell) : Text {
          switch (s.category) {
            case (#SubaoVe) "SubaoVe";
            case (#Minor) "Minor";
            case (#Major) "Major";
            case (#Balls) "Balls";
          }
        })
        .payload("outcome", func(s : BurnTypes.BurnedSpell) : Text {
          switch (s.outcome) {
            case (#succeeded) "succeeded";
            case (#prevented) "prevented";
            case (#noEffect) "noEffect";
          }
        })
        .controllerOnly()
        .build(),

      // Kick-vote entity — controller only. One row per kick vote, keyed by
      // the (target, kicker) pair. The target and kicker are PseudoPrincipal
      // (Text) values. Votes are erased at the end of every game, so rows
      // reflect the current game's live kick votes.
      Entity.manual<KickTypes.KickVote>(
        "kickVote",
        func () = kickStore.votes.values(),
        "KickVote",
        "target",
      )
        .sample({
          target = "";
          kicker = "";
        } : KickTypes.KickVote)
        .payload("target", func(v : KickTypes.KickVote) : Text { v.target })
        .payload("kicker", func(v : KickTypes.KickVote) : Text { v.kicker })
        .controllerOnly()
        .build(),

      // Approval-state entity — controller only. One row per player's
      // ICRC-37 spender-approval state, keyed by the player's
      // PseudoPrincipal. `granted` mirrors the on-chain approval; the
      // collection and spender columns carry the collection canister and the
      // approved spender principal; `lastConsentError` carries the exact
      // error/trap text from the most recent icrc21 consent call, or "" when
      // the last attempt produced no consent error.
      Entity.manual<ApprovalTypes.ApprovalState>(
        "approvalState",
        func () = approvalStore.states.values().map(func ((_, state)) = state),
        "ApprovalState",
        "player",
      )
        .sample({
          player = "";
          collection = "";
          spender = "";
          granted = false;
          grantedAt = 0;
          lastConsentError = null;
        } : ApprovalTypes.ApprovalState)
        .payload("player", func(s : ApprovalTypes.ApprovalState) : Text { s.player })
        .payload("collection", func(s : ApprovalTypes.ApprovalState) : Text { s.collection })
        .payload("spender", func(s : ApprovalTypes.ApprovalState) : Text { s.spender })
        .payload("granted", func(s : ApprovalTypes.ApprovalState) : Bool { s.granted })
        .payload("grantedAt", func(s : ApprovalTypes.ApprovalState) : ApprovalTypes.Timestamp { s.grantedAt })
        .payload("lastConsentError", func(s : ApprovalTypes.ApprovalState) : Text {
          switch (s.lastConsentError) {
            case null "";
            case (?e) e;
          }
        })
        .controllerOnly()
        .build(),

      // Team-shield entity — controller only. One row per team's per-game
      // shield total (White and Black). The shield is scoped to a single game:
      // it resets to zero for both teams at the start of every new game and
      // never carries over. The team variant is projected to a Text column via
      // manual mode.
      Entity.manual<ShieldResolutionTypes.TeamShield>(
        "teamShield",
        func () = [
          { team = #White; shield = shieldResolutionStore.state.whiteShield },
          { team = #Black; shield = shieldResolutionStore.state.blackShield },
        ].values(),
        "TeamShield",
        "team",
      )
        .sample({
          team = #White;
          shield = 0;
        } : ShieldResolutionTypes.TeamShield)
        .payload("team", func(s : ShieldResolutionTypes.TeamShield) : Text {
          switch (s.team) {
            case (#White) "White";
            case (#Black) "Black";
          }
        })
        .payload("shield", func(s : ShieldResolutionTypes.TeamShield) : Nat { s.shield })
        .controllerOnly()
        .build(),

      // Burn-and-play-result entity — controller only. Zero or one row: the
      // pending burn-and-play result for the current turn, held so the
      // frontend's distinct toast poll can read which NFT was burned and which
      // spell was played. The row is cleared when a new turn begins, so it
      // never carries into the next turn. The team, kind, and resolution
      // variants are projected to Text columns via manual mode; the resolution
      // columns are "" when the burn was a defensive Subao Ve shield
      // contribution or a legacy inert burn (neither resolves against a
      // shield). `spellCheckWin` carries the casting team when the spell's
      // board effect left the defending king in check so the game concluded as
      // a win for the caster, or "" otherwise; it is display-only and never
      // reaches the escrow or the stored end state.
      Entity.manual<ShieldResolutionTypes.BurnAndPlayResult>(
        "burnAndPlayResult",
        func () = switch (shieldResolutionStore.state.lastBurnAndPlay) {
          case null { ([ ] : [ShieldResolutionTypes.BurnAndPlayResult]).values() };
          case (?r) { [r].values() };
        },
        "BurnAndPlayResult",
        "tokenId",
      )
        .sample({
          tokenId = 0;
          spellName = "";
          gameNumber = null;
          team = #White;
          kind = #Minor;
          resolution = null;
          appliedColour = null;
          appliedOpponentImage = null;
          legacyReason = null;
          spellCheckWin = null;
          castOutcome = null;
          removedSquares = [];
          transformedSquares = [];
          insufficientMaterial = false;
        } : ShieldResolutionTypes.BurnAndPlayResult)
        .payload("tokenId", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Nat { r.tokenId })
        .payload("spellName", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Text { r.spellName })
        .payload("gameNumber", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Text {
          switch (r.gameNumber) {
            case null "";
            case (?n) n.toText();
          }
        })
        .payload("team", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Text {
          switch (r.team) {
            case (#White) "White";
            case (#Black) "Black";
          }
        })
        .payload("kind", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Text {
          switch (r.kind) {
            case (#SubaoVe) "SubaoVe";
            case (#Minor) "Minor";
            case (#Major) "Major";
            case (#Balls) "Balls";
          }
        })
        .payload("attacker", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Text {
          switch (r.resolution) {
            case null "";
            case (?res)
              switch (res.attacker) {
                case (#White) "White";
                case (#Black) "Black";
              };
          }
        })
        .payload("defender", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Text {
          switch (r.resolution) {
            case null "";
            case (?res)
              switch (res.defender) {
                case (#White) "White";
                case (#Black) "Black";
              };
          }
        })
        .payload("spellValue", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Nat {
          switch (r.resolution) {
            case null 0;
            case (?res) res.spellValue;
          }
        })
        .payload("shieldBefore", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Nat {
          switch (r.resolution) {
            case null 0;
            case (?res) res.shieldBefore;
          }
        })
        .payload("shieldAfter", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Nat {
          switch (r.resolution) {
            case null 0;
            case (?res) res.shieldAfter;
          }
        })
        .payload("outcome", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Text {
          switch (r.resolution) {
            case null "";
            case (?res)
              switch (res.outcome) {
                case (#fired) "fired";
                case (#cancelled) "cancelled";
                case (#legacy) "legacy";
              };
          }
        })
        .payload("firesOnBoard", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Bool {
          switch (r.resolution) {
            case null false;
            case (?res) res.firesOnBoard;
          }
        })
        .payload("appliedColour", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Text {
          switch (r.appliedColour) {
            case null "";
            case (?family)
              switch (family) {
                case (#Sandy) "Sandy";
                case (#Cloudy) "Cloudy";
                case (#Grassy) "Grassy";
                case (#Fiery) "Fiery";
                case (#Wooden) "Wooden";
              };
          }
        })
        .payload("appliedOpponentImage", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Text {
          switch (r.appliedOpponentImage) {
            case null "";
            case (?image)
              switch (image) {
                case (#Hairy) "Hairy";
                case (#Veiny) "Veiny";
                case (#Shiny) "Shiny";
              };
          }
        })
        .payload("legacyReason", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Text {
          switch (r.legacyReason) {
            case null "";
            case (?reason)
              switch (reason) {
                case (#readFailed) "readFailed";
                case (#keysAbsent) "keysAbsent";
                case (#wrongType) "wrongType";
                case (#keysDisagree) "keysDisagree";
              };
          }
        })
        .payload("spellCheckWin", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Text {
          switch (r.spellCheckWin) {
            case null "";
            case (?t)
              switch (t) {
                case (#White) "White";
                case (#Black) "Black";
              };
          }
        })
        .payload("castOutcome", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Text {
          switch (r.castOutcome) {
            case null "";
            case (?o)
              switch (o) {
                case (#succeeded) "succeeded";
                case (#prevented) "prevented";
                case (#noEffect) "noEffect";
              };
          }
        })
        .payload("removedSquares", func(r : ShieldResolutionTypes.BurnAndPlayResult) : Text {
          r.removedSquares.values().map(func(square) = square.toText()).join(",")
        })
        .controllerOnly()
        .build(),

      // Spell-board-state entity — controller only. One row per team's board
      // (White and Black), keyed by `team`. Exposes the active Balls colour
      // family for each team's board (`ballsColour`, "" when no Balls spell
      // has fired on that team's board) plus the counts of squares blocked by
      // Bouvet Hondao and squares holding Conu Bungno explosive traps. The
      // board state is scoped to the current game: it resets at new-game start
      // and never carries over. The team variant and the optional colour
      // family are projected to Text columns via manual mode.
      Entity.manual<SpellStateTypes.SpellBoardRow>(
        "spellBoardState",
        func () = [
          {
            team = #White;
            ballsColour = gameState.spellBoardState.whiteBallsColour;
            opponentImage = gameState.spellBoardState.whiteOpponentImage;
            blockedSquareCount = gameState.spellBoardState.blockedSquares.size();
            explosiveSquareCount = gameState.spellBoardState.explosiveSquares.size();
          },
          {
            team = #Black;
            ballsColour = gameState.spellBoardState.blackBallsColour;
            opponentImage = gameState.spellBoardState.blackOpponentImage;
            blockedSquareCount = gameState.spellBoardState.blockedSquares.size();
            explosiveSquareCount = gameState.spellBoardState.explosiveSquares.size();
          },
        ].values(),
        "SpellBoardState",
        "team",
      )
        .sample({
          team = #White;
          ballsColour = null;
          opponentImage = null;
          blockedSquareCount = 0;
          explosiveSquareCount = 0;
        } : SpellStateTypes.SpellBoardRow)
        .payload("team", func(r : SpellStateTypes.SpellBoardRow) : Text {
          switch (r.team) {
            case (#White) "White";
            case (#Black) "Black";
          }
        })
        .payload("ballsColour", func(r : SpellStateTypes.SpellBoardRow) : Text {
          switch (r.ballsColour) {
            case null "";
            case (?family)
              switch (family) {
                case (#Sandy) "Sandy";
                case (#Cloudy) "Cloudy";
                case (#Grassy) "Grassy";
                case (#Fiery) "Fiery";
                case (#Wooden) "Wooden";
              };
          }
        })
        .payload("opponentImage", func(r : SpellStateTypes.SpellBoardRow) : Text {
          switch (r.opponentImage) {
            case null "";
            case (?image)
              switch (image) {
                case (#Hairy) "Hairy";
                case (#Veiny) "Veiny";
                case (#Shiny) "Shiny";
              };
          }
        })
        .payload("blockedSquareCount", func(r : SpellStateTypes.SpellBoardRow) : Nat { r.blockedSquareCount })
        .payload("explosiveSquareCount", func(r : SpellStateTypes.SpellBoardRow) : Nat { r.explosiveSquareCount })
        .controllerOnly()
        .build(),

      // Game-settings-snapshot entity — controller only. Zero or one row: the
      // FIXED vote snapshot that decided the CURRENT game's settings, captured
      // once at the start of the current game and held unchanged for the whole
      // current game. Exposes the winning starting position and spell use plus
      // the counts that produced them. Before the first game starts it is
      // the zero-vote snapshot (defaults #Random / #On, all counts 0). The
      // startingPosition and spellUse variants are projected to Text columns
      // via manual mode.
      Entity.manual<Types.GameSettingsSnapshot>(
        "gameSettingsSnapshot",
        func () = [voteSnapshotStore.snapshot].values(),
        "GameSettingsSnapshot",
        "startingPosition",
      )
        .sample({
          startingPosition = #Random;
          spellUse = #On;
          turnDuration = #TwoMinutes;
          standardCount = 0;
          randomCount = 0;
          spellOnCount = 0;
          spellOffCount = 0;
          twoMinuteCount = 0;
          ninetySecondCount = 0;
          oneMinuteCount = 0;
        } : Types.GameSettingsSnapshot)
        .payload("startingPosition", func(s : Types.GameSettingsSnapshot) : Text {
          switch (s.startingPosition) {
            case (#Standard) "Standard";
            case (#Random) "Random";
          }
        })
        .payload("spellUse", func(s : Types.GameSettingsSnapshot) : Text {
          switch (s.spellUse) {
            case (#On) "On";
            case (#Off) "Off";
          }
        })
        .payload("turnDuration", func(s : Types.GameSettingsSnapshot) : Text {
          switch (s.turnDuration) {
            case (#TwoMinutes) "TwoMinutes";
            case (#NinetySeconds) "NinetySeconds";
            case (#OneMinute) "OneMinute";
          }
        })
        .payload("standardCount", func(s : Types.GameSettingsSnapshot) : Nat { s.standardCount })
        .payload("randomCount", func(s : Types.GameSettingsSnapshot) : Nat { s.randomCount })
        .payload("spellOnCount", func(s : Types.GameSettingsSnapshot) : Nat { s.spellOnCount })
        .payload("spellOffCount", func(s : Types.GameSettingsSnapshot) : Nat { s.spellOffCount })
        .payload("twoMinuteCount", func(s : Types.GameSettingsSnapshot) : Nat { s.twoMinuteCount })
        .payload("ninetySecondCount", func(s : Types.GameSettingsSnapshot) : Nat { s.ninetySecondCount })
        .payload("oneMinuteCount", func(s : Types.GameSettingsSnapshot) : Nat { s.oneMinuteCount })
        .controllerOnly()
        .build(),

      // Game-state entity — controller only. Zero or one row: the live
      // current-game state, keyed by `gameNumber`. Exposes the sequential
      // game number, phase, side to move, winner, opening name, the
      // vote-derived spell-use gate, the current Move_Maker, the turn
      // timer fields, and the display-only spell-win name (the cast spell's
      // name when the game concluded by a spell-induced check win). The
      // phase, currentTurn, and winner variants are
      // projected to Text columns via manual mode; the optional winner,
      // openingName, moveMakerPrincipal, celebrationEndTime, and spellWinName
      // are "" when absent. The row source projects the live mutable GameState
      // into the shared GameStateOql shape (GameState carries mutable `var`
      // fields and is non-shared, so the OQL `.sample` seed and row source must
      // use the shared projection).
      Entity.manual<Types.GameStateOql>(
        "gameState",
        func () = [{
          gameNumber = gameState.gameNumber;
          phase = gameState.gamePhase;
          currentTurn = gameState.currentTurn;
          winner = gameState.winner;
          openingName = gameState.openingName;
          spellUseEnabled = gameState.spellUseEnabled;
          moveMakerPrincipal = gameState.moveMakerPrincipal;
          turnStartTime = gameState.turnStartTime;
          turnTimeLimitMs = gameState.turnTimeLimitMs;
          turnDuration = gameState.turnDuration;
          celebrationEndTime = gameState.celebrationEndTime;
          spellWinName = gameState.spellWinName;
        }].values(),
        "GameState",
        "gameNumber",
      )
        .sample({
          gameNumber = 0;
          phase = #Paused;
          currentTurn = #White;
          winner = null;
          openingName = null;
          spellUseEnabled = false;
          moveMakerPrincipal = null;
          turnStartTime = 0;
          turnTimeLimitMs = 0;
          turnDuration = #TwoMinutes;
          celebrationEndTime = null;
          spellWinName = null;
        } : Types.GameStateOql)
        .payload("gameNumber", func(s : Types.GameStateOql) : Nat { s.gameNumber })
        .payload("phase", func(s : Types.GameStateOql) : Text {
          switch (s.phase) {
            case (#Playing) "Playing";
            case (#Celebration) "Celebration";
            case (#Draw) "Draw";
            case (#Paused) "Paused";
          }
        })
        .payload("currentTurn", func(s : Types.GameStateOql) : Text {
          switch (s.currentTurn) {
            case (#White) "White";
            case (#Black) "Black";
          }
        })
        .payload("winner", func(s : Types.GameStateOql) : Text {
          switch (s.winner) {
            case null "";
            case (?t)
              switch (t) {
                case (#White) "White";
                case (#Black) "Black";
              };
          }
        })
        .payload("openingName", func(s : Types.GameStateOql) : Text {
          switch (s.openingName) {
            case null "";
            case (?n) n;
          }
        })
        .payload("spellUseEnabled", func(s : Types.GameStateOql) : Bool { s.spellUseEnabled })
        .payload("moveMakerPrincipal", func(s : Types.GameStateOql) : Text {
          switch (s.moveMakerPrincipal) {
            case null "";
            case (?p) p;
          }
        })
        .payload("turnStartTime", func(s : Types.GameStateOql) : Types.Timestamp { s.turnStartTime })
        .payload("turnTimeLimitMs", func(s : Types.GameStateOql) : Nat { s.turnTimeLimitMs })
        .payload("turnDuration", func(s : Types.GameStateOql) : Text {
          switch (s.turnDuration) {
            case (#TwoMinutes) "TwoMinutes";
            case (#NinetySeconds) "NinetySeconds";
            case (#OneMinute) "OneMinute";
          }
        })
        .payload("celebrationEndTime", func(s : Types.GameStateOql) : Text {
          switch (s.celebrationEndTime) {
            case null "";
            case (?t) t.toText();
          }
        })
        .payload("spellWinName", func(s : Types.GameStateOql) : Text {
          switch (s.spellWinName) {
            case null "";
            case (?n) n;
          }
        })
        .controllerOnly()
        .build(),

      // Story-section entity — controller only. One row per Story section, in
      // order. Section 0 is the permanent "Forever" section (immutable, no
      // counters); every later row is an appended section carrying its own
      // text, Delete counter, Keep counter, and deleted/gap state. The row
      // source projects the live section array into the shared StoryRow shape.
      Entity.manual<StoryTypes.StoryRow>(
        "story",
        func () = Array.tabulate(
          storyStore.sections.size(),
          func (i) {
            let s = storyStore.sections[i];
            {
              index = i;
              text = s.text;
              deleteCount = s.deleteCount;
              keepCount = s.keepCount;
              deleted = s.deleted;
              hasVotedDelete = false;
              hasVotedKeep = false;
            };
          },
        ).values(),
        "Story",
        "index",
      )
        .sample({
          index = 0;
          text = "";
          deleteCount = 0;
          keepCount = 0;
          deleted = false;
          hasVotedDelete = false;
          hasVotedKeep = false;
        } : StoryTypes.StoryRow)
        .payload("index", func(s : StoryTypes.StoryRow) : Nat { s.index })
        .payload("text", func(s : StoryTypes.StoryRow) : Text { s.text })
        .payload("deleteCount", func(s : StoryTypes.StoryRow) : Nat { s.deleteCount })
        .payload("keepCount", func(s : StoryTypes.StoryRow) : Nat { s.keepCount })
        .payload("deleted", func(s : StoryTypes.StoryRow) : Bool { s.deleted })
        .payload("hasVotedDelete", func(s : StoryTypes.StoryRow) : Bool { s.hasVotedDelete })
        .payload("hasVotedKeep", func(s : StoryTypes.StoryRow) : Bool { s.hasVotedKeep })
        .controllerOnly()
        .build(),

      // Guaranteed-tier entity — controller only. One row per guaranteed
      // entry, keyed by the post-'_copy' roster username. Each row carries
      // the entry's own NFT wallet address ("" when none recorded) and the
      // bet-verified flag. Entries are self-contained, so a departed bettor
      // whose player row was heartbeat-cleaned still appears here. The set is
      // cleared at the start of each new game alongside the vote clearing, so
      // rows reflect the current game's guaranteed set. The optional wallet
      // address is projected to a Text column via manual mode.
      Entity.manual<Types.GuaranteedEntry>(
        "guaranteedEntry",
        func () = guaranteedStore.items.values(),
        "GuaranteedEntry",
        "username",
      )
        .sample({
          username = "";
          walletAddress = null;
          betVerified = false;
        } : Types.GuaranteedEntry)
        .payload("username", func(e : Types.GuaranteedEntry) : Text { e.username })
        .payload("walletAddress", func(e : Types.GuaranteedEntry) : Text {
          switch (e.walletAddress) {
            case null "";
            case (?a) a;
          }
        })
        .payload("betVerified", func(e : Types.GuaranteedEntry) : Bool { e.betVerified })
        .controllerOnly()
        .build(),

      // Sunday-competition standings entity — controller only. One row per
      // player in the CURRENT competition, keyed by the bound Internet Identity
      // principal (the map key, promoted to a `principal` column via manual
      // mode). `order` is the monotonic win sequence used as the ascending
      // tie-break. The store is reset to empty when a new competition begins,
      // so rows reflect the live competition only.
      Entity.manual<(Principal, SundayCompTypes.CompWinEntry)>(
        "sundayCompStanding",
        func () = compWinStore.items.entries(),
        "SundayCompStanding",
        "principal",
      )
        .sample((
          Principal.fromText("aaaaa-aa"),
          { displayName = ""; wins = 0; order = 0 } : SundayCompTypes.CompWinEntry,
        ))
        .payload("principal", func ((p, _)) : Text { p.toText() })
        .payload("displayName", func ((_, e)) : Text { e.displayName })
        .payload("wins", func ((_, e)) : Nat { e.wins })
        .payload("order", func ((_, e)) : Nat { e.order })
        .controllerOnly()
        .build(),

      // Sunday-competition archive entity — controller only. One row per
      // finalized Sunday, keyed by the Sunday date (nanoseconds at 00:00:00
      // UTC). Each row carries the winner's and runner-up's principal (stored
      // internally for future rewards), display name, and win count at the
      // moment the competition ended; the optional placements are "" / 0 when
      // absent. Newest last.
      Entity.manual<SundayCompTypes.ArchivedCompetition>(
        "sundayCompArchive",
        func () = compArchiveStore.items.values(),
        "SundayCompArchive",
        "sunday",
      )
        .sample({
          sunday = 0;
          winner = null;
          runnerUp = null;
        } : SundayCompTypes.ArchivedCompetition)
        .payload("sunday", func(c : SundayCompTypes.ArchivedCompetition) : SundayCompTypes.Timestamp { c.sunday })
        .payload("winnerPrincipal", func(c : SundayCompTypes.ArchivedCompetition) : Text {
          switch (c.winner) {
            case null "";
            case (?w) w.principal.toText();
          }
        })
        .payload("winnerName", func(c : SundayCompTypes.ArchivedCompetition) : Text {
          switch (c.winner) {
            case null "";
            case (?w) w.displayName;
          }
        })
        .payload("winnerWins", func(c : SundayCompTypes.ArchivedCompetition) : Nat {
          switch (c.winner) {
            case null 0;
            case (?w) w.wins;
          }
        })
        .payload("runnerUpPrincipal", func(c : SundayCompTypes.ArchivedCompetition) : Text {
          switch (c.runnerUp) {
            case null "";
            case (?r) r.principal.toText();
          }
        })
        .payload("runnerUpName", func(c : SundayCompTypes.ArchivedCompetition) : Text {
          switch (c.runnerUp) {
            case null "";
            case (?r) r.displayName;
          }
        })
        .payload("runnerUpWins", func(c : SundayCompTypes.ArchivedCompetition) : Nat {
          switch (c.runnerUp) {
            case null 0;
            case (?r) r.wins;
          }
        })
        .controllerOnly()
        .build(),

      // Prize 10-place-archive entity — controller only. One row per archived
      // placement in the parallel 10-place Sunday-competition archive, keyed by
      // the composite `sunday` + `rank` text. Each row carries the Sunday date
      // (nanoseconds at 00:00:00 UTC), the 1-based rank, the player's principal
      // (stored internally for future rewards), the display name at the moment
      // the competition ended, and the win count. Newest last.
      Entity.manual<PrizeTypes.ArchivedPlacement10>(
        "prizePlacement",
        func () = prizePlacements(compArchive10Store),
        "PrizePlacement",
        "placementKey",
      )
        .sample({
          rank = 0;
          principal = Principal.fromText("aaaaa-aa");
          displayName = "";
          wins = 0;
          prizeE8s = 0;
        } : PrizeTypes.ArchivedPlacement10)
        .payload("placementKey", func(p : PrizeTypes.ArchivedPlacement10) : Text {
          p.rank.toText() # ":" # p.principal.toText()
        })
        .payload("rank", func(p : PrizeTypes.ArchivedPlacement10) : Nat { p.rank })
        .payload("principal", func(p : PrizeTypes.ArchivedPlacement10) : Text { p.principal.toText() })
        .payload("displayName", func(p : PrizeTypes.ArchivedPlacement10) : Text { p.displayName })
        .payload("wins", func(p : PrizeTypes.ArchivedPlacement10) : Nat { p.wins })
        .payload("prizeE8s", func(p : PrizeTypes.ArchivedPlacement10) : Nat { p.prizeE8s })
        .controllerOnly()
        .build(),

      // Prize-allocation entity — controller only. One row per admin-allocated
      // Sunday, keyed by the Sunday date (nanoseconds at 00:00:00 UTC). Each
      // row carries the total pool the admin loaded (fees included) plus the
      // first prize and the ten rank prizes derived from it. The player view
      // never reads this entity; it reads only the first prize through the
      // player-facing `getFirstPrizeForSunday` query.
      Entity.manual<(PrizeTypes.Timestamp, PrizeTypes.PrizeAllocation)>(
        "prizeAllocation",
        func () = prizeAllocationStore.items.values(),
        "PrizeAllocation",
        "sunday",
      )
        .sample((0, {
          sunday = 0;
          poolE8s = 0;
          firstPrizeE8s = 0;
          rankPrizesE8s = [];
        } : PrizeTypes.PrizeAllocation))
        .payload("sunday", func((sunday, _) : (PrizeTypes.Timestamp, PrizeTypes.PrizeAllocation)) : PrizeTypes.Timestamp { sunday })
        .payload("poolE8s", func((_, a) : (PrizeTypes.Timestamp, PrizeTypes.PrizeAllocation)) : Nat { a.poolE8s })
        .payload("firstPrizeE8s", func((_, a) : (PrizeTypes.Timestamp, PrizeTypes.PrizeAllocation)) : Nat { a.firstPrizeE8s })
        .payload("rankPrizesE8s", func((_, a) : (PrizeTypes.Timestamp, PrizeTypes.PrizeAllocation)) : Text {
          a.rankPrizesE8s.values().map(func(prize) = prize.toText()).join(",")
        })
        .controllerOnly()
        .build(),

      // Prize-claim entity — controller only. One row per archived placement's
      // claim record, keyed by the composite `claimKey` (`competition:rank`).
      // Each row carries the claim state machine value (claimable / paying /
      // paid), the recipient principal locked at the first attempt (stored
      // internally and exposed only to the platform controller), the exact
      // prize amount in e8s, the ledger block index when paid, and the
      // manual-check flag. The recipient principal is never returned to the
      // frontend; the player-facing claim path returns only the caller's own
      // claim through `claimPrize` / `getMyPrize`.
      Entity.manual<(PrizeTypes.Timestamp, Nat, PrizeClaimTypes.PrizeClaim)>(
        "prizeClaim",
        func () = prizeClaimStore.items.values(),
        "PrizeClaim",
        "claimKey",
      )
        .sample((
          0,
          0,
          {
            competition = 0;
            rank = 0;
            state = #claimable;
            recipient = null;
            amountE8s = 0;
            blockIndex = null;
            manualCheck = false;
          } : PrizeClaimTypes.PrizeClaim,
        ))
        .payload("claimKey", func((competition, rank, _) : (PrizeTypes.Timestamp, Nat, PrizeClaimTypes.PrizeClaim)) : Text {
          competition.toText() # ":" # rank.toText()
        })
        .payload("competition", func((competition, _, _) : (PrizeTypes.Timestamp, Nat, PrizeClaimTypes.PrizeClaim)) : PrizeTypes.Timestamp { competition })
        .payload("rank", func((_, rank, _) : (PrizeTypes.Timestamp, Nat, PrizeClaimTypes.PrizeClaim)) : Nat { rank })
        .payload("state", func((_, _, claim) : (PrizeTypes.Timestamp, Nat, PrizeClaimTypes.PrizeClaim)) : Text {
          switch (claim.state) {
            case (#claimable) "claimable";
            case (#paying) "paying";
            case (#paid) "paid";
          }
        })
        .payload("recipient", func((_, _, claim) : (PrizeTypes.Timestamp, Nat, PrizeClaimTypes.PrizeClaim)) : Text {
          switch (claim.recipient) {
            case null "";
            case (?p) p.toText();
          }
        })
        .payload("amountE8s", func((_, _, claim) : (PrizeTypes.Timestamp, Nat, PrizeClaimTypes.PrizeClaim)) : Nat { claim.amountE8s })
        .payload("blockIndex", func((_, _, claim) : (PrizeTypes.Timestamp, Nat, PrizeClaimTypes.PrizeClaim)) : Text {
          switch (claim.blockIndex) {
            case null "";
            case (?b) b.toText();
          }
        })
        .payload("manualCheck", func((_, _, claim) : (PrizeTypes.Timestamp, Nat, PrizeClaimTypes.PrizeClaim)) : Bool { claim.manualCheck })
        .controllerOnly()
        .build(),

    ];
  });
};
