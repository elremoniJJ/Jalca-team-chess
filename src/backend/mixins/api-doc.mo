// ApiDocMixin — exposes the backend's behavioral API documentation.
//
// This mixin is documentation-only. It declares a single public query method,
// `getApiDoc`, that returns static Markdown describing the current public API.
// It reads no state and takes no parameters, so it is a bare `mixin () { ... }`
// block with no stable bindings.
mixin () {
  // Return the backend's behavioral API documentation as static Markdown.
  public query func getApiDoc() : async Text {
    "# Team Chess Online — Backend API\n" #
    "\n" #
    "This document describes the public interface of the Team Chess Online backend canister (JALCA). " #
    "It is authored from the current backend source and is accurate as of this build.\n" #
    "\n" #
    "## Purpose\n" #
    "\n" #
    "The backend is the composition root for the Team Chess Online game. It hosts the chess game, " #
    "game recorder, exercise and drinking assignments, NFT minting, spells, voting, burn " #
    "state, the shield-and-spell-resolution domain, the PBPP_Information reference record, the " #
    "Prediction Bet domain, and the Story domain. This document covers the public methods relevant " #
    "to the Prediction Bet, PBPP_Information, shield-and-spell-resolution, and Story domains, plus " #
    "the OQL query surface. The " #
    "Prediction Bet domain accepts bet submissions and records authoritative game results for " #
    "settlement; the shield-and-spell-resolution domain burns and plays an NFT spell for the current " #
    "Move_Maker and resolves it against the defending team's shield.\n" #
    "\n" #
    "## Public methods\n" #
    "\n" #
    "### Prediction Bet domain\n" #
    "\n" #
    "- `submitBet(pot : Pot, prediction : Prediction, playerPrincipal : Text, displayUsername : Text, anonymous : Bool) -> BetRecord`\n" #
    "  Records a bet carrying the committed stake, predicted outcome, player principal, display " #
    "username, and anonymity preference, time-stamped at submission. Returns the newly recorded bet.\n" #
    "- `recordGameResult(result : GameResult) -> ResultRecord`\n" #
    "  Records an authoritative game result (White/Black/Draw) for settlement, time-stamped at " #
    "recording. Returns the newly recorded result.\n" #
    "- `getBets() -> [BetRecord]`\n" #
    "  Returns all recorded bets in submission order. Read-only query; does not mutate state.\n" #
    "- `getResults() -> [ResultRecord]`\n" #
    "  Returns all recorded game results in recording order. Read-only query; does not mutate state.\n" #
    "- `setPbppCanisterPrincipal(principal : Principal) -> ()`\n" #
    "  Sets the configurable PBPP canister principal — the settlement target and allowlist reference.\n" #
    "- `setJalcaPrincipal(principal : Principal) -> ()`\n" #
    "  Sets the configured JALCA canister principal — the allowlist that may submit bets and record " #
    "results.\n" #
    "\n" #
    "### Real Bet domain\n" #
    "\n" #
    "- `placeBet(args : PlaceBetArgs) -> PlaceBetResult`\n" #
    "  Relays a player's real bet to the escrow canister's `place_bet` from JALCA's own backend " #
    "principal, passing the single record-shaped `PlaceBetArgs`. Returns `#ok Nat` — the ICRC Ledger " #
    "block index of the stake transfer — or `#err EscrowError`. On success the returned block index " #
    "is recorded locally alongside the submitted payload.\n" #
    "- `checkAllowance(player : Principal) -> Allowance`\n" #
    "  Queries the ICP ledger's `icrc2_allowance` with account = `{ owner = player; subaccount = null }` " #
    "and spender = the escrow canister principal (`oqybv-uyaaa-aaaac-bf5oq-cai`, subaccount = null). " #
    "Returns the current allowance so the frontend can show immediate feedback such as \"you haven't " #
    "approved the escrow yet\". This is a convenience check — the escrow remains the authoritative " #
    "gate at `icrc2_transfer_from`.\n" #
    "- `startGame(args : StartGameArgs) -> StartGameResult`\n" #
    "  Signals to the escrow that a new game has started by calling `start_game` with the single " #
    "record-shaped `StartGameArgs` (`game_id` + `start_time`) from JALCA's own backend principal. " #
    "The escrow locks the accumulated bets for that `game_id`. Returns `#ok` (unit) on success, or " #
    "`#err EscrowError`.\n" #
    "- `reportOutcome(args : ReportOutcomeArgs) -> ReportOutcomeResult`\n" #
    "  Reports a game outcome to the escrow's `report_outcome` with the single record-shaped " #
    "`ReportOutcomeArgs` (`game_id` + `result` + `end_time`) from JALCA's own backend principal. " #
    "The escrow uses the same `game_id` passed to `start_game` to trigger payout resolution. " #
    "Returns `#ok` (unit) on success, or `#err EscrowError`. On success the reported outcome and " #
    "`game_id` are recorded locally.\n" #
    "- `getRealBets() -> [RealBetRecord]`\n" #
    "  Returns all locally recorded real bets in relay order. Read-only query; does not mutate state.\n" #
    "- `getSettlements() -> [SettlementRecord]`\n" #
    "  Returns all locally recorded settlements in report order. Read-only query; does not mutate state.\n" #
    "\n" #
    "### Message contract with the escrow canister\n" #
    "\n" #
    "JALCA's backend communicates with the escrow canister at " #
    "`oqybv-uyaaa-aaaac-bf5oq-cai` over the Internet Computer. Every message below is " #
    "sent from JALCA's own backend principal (`py4x3-piaaa-aaaai-ax2ya-cai`) — an " #
    "outbound inter-canister call always carries the calling canister's principal as " #
    "the caller to the target, never the user's browser session principal. The escrow " #
    "authenticates that caller and is the authoritative gate at `icrc2_transfer_from`. " #
    "The exact Candid shapes (field names, types, and units) are listed so the escrow " #
    "can decode every message without error.\n" #
    "\n" #
    "#### 1. Incoming bet — `place_bet`\n" #
    "\n" #
    "Sent when a player places a real bet. The escrow receives a call to `place_bet` " #
    "with a single record-shaped argument, `PlaceBetArgs`:\n" #
    "\n" #
    "- `player : principal` — the player's Internet Computer principal.\n" #
    "- `username : text` — the player's username.\n" #
    "- `anonymous : bool` — the player's anonymity preference.\n" #
    "- `pot_tier : nat` — the pot tier (1 / 10 / 100 / 1000 ICP).\n" #
    "- `amount_e8s : nat` — the bet amount in e8s (1 ICP = 100_000_000 e8s). This is " #
    "the bet only — the 10_000 e8s fee is covered by the player's approval.\n" #
    "- `outcome : variant { #black; #draw; #white }` — the predicted game outcome " #
    "(lowercase tags).\n" #
    "- `wallet_address : text` — the player's connected wallet address.\n" #
    "\n" #
    "The escrow returns `variant { #ok : nat; #err : EscrowError }`. The `#ok` payload " #
    "is the ICRC Ledger block index of the stake transfer. On success the escrow pulls " #
    "the stake via `icrc2_transfer_from`.\n" #
    "\n" #
    "#### 2. Game start — `start_game`\n" #
    "\n" #
    "Sent when a new game starts. The escrow receives a call to `start_game` with a " #
    "single record-shaped argument, `StartGameArgs`:\n" #
    "\n" #
    "- `game_id : text` — the JALCA-generated match UUID. JALCA passes it in " #
    "`start_game` to lock the accumulated bets for that game.\n" #
    "- `start_time : nat` — the game start time in nanoseconds.\n" #
    "\n" #
    "The escrow returns `variant { #ok; #err : EscrowError }`.\n" #
    "\n" #
    "#### 3. Game conclusion — `report_outcome`\n" #
    "\n" #
    "Sent at every game conclusion (checkmate, stalemate, or timeout). The escrow " #
    "receives a call to `report_outcome` with a single record-shaped argument, " #
    "`ReportOutcomeArgs`:\n" #
    "\n" #
    "- `game_id : text` — the same JALCA-generated match UUID passed to `start_game`. " #
    "The escrow uses it to trigger payout resolution.\n" #
    "- `result : variant { #black; #draw; #white }` — the final game outcome " #
    "(lowercase tags).\n" #
    "- `end_time : nat` — the game end time in nanoseconds.\n" #
    "\n" #
    "The escrow returns `variant { #ok; #err : EscrowError }`.\n" #
    "\n" #
    "#### 5. Allowance / approval — `icrc2_allowance` (query)\n" #
    "\n" #
    "JALCA queries the ICP ledger (`ryjl3-tyaaa-aaaaa-aaaba-cai`) to check whether the " #
    "player has approved the escrow as spender. The query is `icrc2_allowance` with " #
    "`account = record { owner = player; subaccount = null }` and `spender = record { " #
    "owner = oqybv-uyaaa-aaaac-bf5oq-cai; subaccount = null }`. Returns `record { " #
    "allowance : nat; expires_at : opt nat64 }`. This is a convenience check only — " #
    "the escrow remains the authoritative gate at `icrc2_transfer_from`.\n" #
    "\n" #
    "### Kick domain\n" #
    "\n" #
    "- `castKickVote(principal : Text, target : Text) -> KickResult`\n" #
    "  Records a kick vote from `principal` against `target` (both PseudoPrincipal `Text` values). " #
    "  Votes are unique per (target, kicker) pair, so casting again for the same pair is a no-op. " #
    "  Only wallet-connected players on the same team as the target may vote. Returns `#ok` on " #
    "  success, or `#err` with a message when the caller is not a logged-in player, has no connected " #
    "  wallet, or is not on the target's team. After recording the vote, the strict-majority " #
    "  threshold is re-evaluated continuously: if the target now has more than 50% of the current " #
    "  team's votes, they are kicked to the opposing team, their received votes reset to zero, and " #
    "  their outgoing votes are removed in a single atomic pass.\n" #
    "- `withdrawKickVote(principal : Text, target : Text) -> KickResult`\n" #
    "  Withdraws `principal`'s kick vote against `target` before it succeeds, toggling the vote back " #
    "  off. Returns `#ok` on success, or `#err` when the caller is not a logged-in player or has no " #
    "  vote against the target.\n" #
    "- `getKickState() -> KickState`\n" #
    "  Returns the live kick state: for every player, their `kickCount` (a natural number) and their " #
    "  `kickedBy` array (the usernames of every kicker who voted to kick them). The count always " #
    "  equals the length of the `kickedBy` array — both are derived from the vote records, never " #
    "  stored separately. Read-only query; does not mutate state.\n" #
    "\n" #
    "Kick votes are keyed by the (target, kicker) pair, so a kicker can vote for a target at most " #
    "once. A kick succeeds only when more than 50% of the current team (a strict majority) has " #
    "voted for that target. The threshold is re-evaluated **continuously** as team size changes, so " #
    "a target can be kicked retroactively when the team shrinks even without new votes. When a kick " #
    "succeeds, the target moves to the opposing team, their received votes reset to zero, and their " #
    "outgoing votes are removed in a single atomic re-evaluation pass (the team move, received-vote " #
    "reset, and outgoing-vote removal happen synchronously; a Move_Maker reassignment follows " #
    "asynchronously, mirroring the disconnect path). All kicks are erased at the end of every game, " #
    "so no kick carries into the next game.\n" #
    "\n" #
    "### Start-game caller (automatic, not a public method)\n" #
    "\n" #
    "When a new game starts, JALCA's backend automatically calls the escrow's " #
    "`start_game` with the JALCA-generated `game_id` and the game start time, from " #
    "JALCA's own backend principal. This locks the accumulated bets for that `game_id`. " #
    "The call is wired into `startNewGame` — the single chokepoint for game start — so " #
    "every new game start signals the escrow. The call is wrapped in try/catch: if the " #
    "escrow rejects or traps, JALCA maps it to a safe local outcome and the game start " #
    "is never blocked. There is no public method to trigger this; it fires automatically " #
    "on game start.\n" #
    "\n" #
    "### Outcome reporter (automatic, not a public method)\n" #
    "\n" #
    "At every game conclusion — checkmate (`triggerCelebration`), stalemate or " #
    "insufficient material (`triggerDraw`), and timeout (`checkTimerExpiry`) — JALCA's backend " #
    "automatically calls the escrow's `report_outcome` with the same `game_id` passed " #
    "to `start_game`, from JALCA's own backend principal, at the exact point where the " #
    "game result is finalized (the same source the game conclusion modal reads via " #
    "`getGameRecord`). No player action is required. The recorder's `GameResult` " #
    "(`#WhiteWin` / `#BlackWin` / `#Draw`) is mapped to the escrow's `GameOutcome` " #
    "(`#white` / `#black` / `#draw`). The call reuses the Real Bet domain's existing " #
    "`reportOutcome` path (lib/real-bet.mo), which wraps the cross-canister call in " #
    "try/catch. The returned result is handled for accountability only and never blocks " #
    "or alters the game conclusion. Unlike the public `reportOutcome` method, the " #
    "automatic report does not record a local settlement. There is no public method to " #
    "trigger this; it fires automatically on every game conclusion.\n" #
    "\n" #
    "### NFT burn domain\n" #
    "\n" #
    "- `burnNfts(tokenIds : [Nat]) -> [BurnOutcome]`\n" #
    "  Truly destroys (burns) one or more NFT spell tokens on the collection canister " #
    "(`23quc-cyaaa-aaaac-bfvia-cai`) in a **single batch request** — one `icrc7_burn` call " #
    "carrying a `BurnArg` record of an optional memo plus a vec of token ids, returning a vec " #
    "of `BurnResult`. This is an update call (it performs inter-canister calls), not a query. " #
    "Returns one `BurnOutcome` per requested token id, in the same order as the input list. " #
    "An empty input list returns an empty list without calling the canister.\n" #
    "- `burnNft(tokenId : Nat) -> BurnOutcome`\n" #
    "  Single-token convenience entry point. It delegates to `burnNfts([tokenId])`, so there " #
    "is exactly one burn implementation. This is an update call, not a query.\n" #
    "\n" #
    "**Authorization — backend-authorized, not player-signed.** The burn is submitted " #
    "directly by this backend canister as itself, through the collection canister's " #
    "allowlisted-admin path: the backend's own principal is authorized to burn, so no " #
    "per-token ICRC-37 approval, no player signature, and no wallet/signer mediation is " #
    "involved. There is no approval or consent step required to burn. The backend never " #
    "sends cycles outward — the burn call attaches no cycles.\n" #
    "\n" #
    "The spell name and game number are read from the ledger (`icrc7_token_metadata`) " #
    "**before** the burn, because the burn destroys the token and its metadata with it. " #
    "Each outcome is one of:\n" #
    "  - `#burnedWithSpell({ spellName : Text; gameNumber : Nat })` — the token was " #
    "destroyed AND its on-chain metadata carried a usable spell (both the " #
    "`jalca:spell_name` and `jalca:game_number` keys were present). The returned spell name " #
    "and game number are the values read before the burn, so the caller can apply the spell.\n" #
    "  - `#burnedLegacy(reason : LegacyReason)` — the token was destroyed but carried no usable " #
    "spell metadata (a legacy token). It burns inert: the burn still succeeds and the token is " #
    "gone, but no spell is produced. The `reason` distinguishes why: `#readFailed` (the " #
    "pre-burn metadata read failed, trapped, or returned no entry — the read is retried before " #
    "this is reported), `#keysAbsent` (the metadata was read successfully but carries neither " #
    "`jalca:spell_name` nor `jalca:game_number`), `#wrongType` (a key was present but its value " #
    "was not the expected type), and `#keysDisagree` (exactly one of the two keys was present).\n" #
    "  - `#failed : Text` — the burn did not happen for that token. The payload is a short " #
    "human-readable reason (the collection canister's error message, or a trapped/empty " #
    "burn call).\n" #
    "\n" #
    "Non-obvious gotcha: **any NFT the player owns is burnable**, including legacy tokens " #
    "with no spell metadata. There is deliberately no hard-refuse guard — a legacy burn still " #
    "succeeds and destroys the token, it simply produces no usable spell and is reported as " #
    "`#burnedLegacy`. A failed or empty metadata read does not abort the burn either; the " #
    "token is burned anyway and reported as `#burnedLegacy(#readFailed)`. A failed read is " #
    "retried before it is classified, so a transient failure on a token that does carry keys " #
    "does not produce a false legacy result. If the batch burn call itself " #
    "traps or returns no results, every token in the batch is reported as `#failed` (the " #
    "burn did not happen for any of them).\n" #
    "\n" #
    "`burnNfts` / `burnNft` themselves do **not** record the burn. The game-side bookkeeping " #
    "is a separate call (`recordBurn`), so a caller that needs the burn reflected in game " #
    "state must invoke that separately.\n" #
    "\n" #
    "### Spender-approval domain (disabled)\n" #
    "\n" #
    "The ICRC-37 spender-approval inter-canister attempt has been **removed**. The burn no " #
    "longer requires a spender approval: the backend burns directly as itself through the " #
    "allowlisted-admin path (see the NFT burn domain above). No live code depends on an " #
    "approval path that is expected to fail.\n" #
    "\n" #
    "- `getApprovalState(player : Text) -> ApprovalStateResult`\n" #
    "  Reads the player's locally recorded approval state, so the frontend toggle can reflect " #
    "the recorded state rather than a local session flag. Read-only query. Returns " #
    "`#ok ApprovalState` when the player has a recorded state, or `#err Text` when the player " #
    "has no recorded state yet. `ApprovalState` carries `player`, `collection`, `spender`, " #
    "`granted`, `grantedAt`, and `lastConsentError`.\n" #
    "- `fireApproval(player : Text) -> ApprovalResult`\n" #
    "  **Disabled.** Performs no inter-canister call and always returns " #
    "`#err Text` with the message that ICRC-37 spender approval is disabled and burns are " #
    "backend-authorized. Retained only so the public method surface is unchanged.\n" #
    "- `setApprovalGranted(player : Text, granted : Bool) -> ApprovalStateResult`\n" #
    "  Records or clears the player's approval state locally, without a wallet call. Returns " #
    "`#ok ApprovalState` with the updated state, or `#err Text` when the player has no " #
    "recorded state.\n" #
    "- `recordConsentError(player : Text, error : Text) -> ()`\n" #
    "  Records the exact error/trap text from the most recent consent call for a player. " #
    "Retained for the local mirror; no live burn path depends on it.\n" #
    "\n" #
    "Non-obvious gotcha: `setApprovalGranted` only changes the local mirror. It does not " #
    "grant or revoke anything on-chain, and it has no effect on whether the backend can burn " #
    "— the backend's burn authority comes from the collection canister's allowlisted-admin " #
    "path, not from this state.\n" #
    "\n" #
    "### Shield-and-spell-resolution domain\n" #
    "\n" #
    "- `burnAndPlay(principal : Text, request : BurnAndPlayRequest) -> BurnAndPlayResult2`\n" #
    "  Burns and plays an NFT spell for the current Move_Maker. The Move_Maker calls this after " #
    "their NFT is burned. It enforces the burn restrictions server-side, performs the real burn " #
    "through the existing burn path, applies the shield math, and returns the burn-and-play " #
    "payload the distinct toast renders plus the updated shield state. This is an update call " #
    "(it performs inter-canister calls), not a query. `request` is a record of `tokenId : Nat`, " #
    "`spellName : Text`, `gameNumber : ?Nat`, and `kind : SpellKind` (`#SubaoVe` / `#Minor` / " #
    "`#Major` / `#Balls`). Returns `#ok { burn : BurnAndPlayResult; shieldState : ShieldState }` on success, " #
    "or `#err Text` with a human-readable rejection reason (not the Move_Maker, burn already " #
    "recorded this turn, opening Move_Maker without a Subao Ve, or missing spell name). When an " #
    "offensive spell's board effect leaves the defending king in check, the game concludes " #
    "immediately as a win for the caster (see `concludeBySpellCheck`); the caster's normal move " #
    "never happens. When the spell's board effect leaves the position with insufficient material " #
    "for either side to deliver checkmate, the game concludes as a draw for insufficient material " #
    "(see `concludeByInsufficientMaterial`); a spell-check win takes precedence over the draw.\n" #
    "- `concludeBySpellCheck(winner : Team, spellName : Text, now : Timestamp) -> ()`\n" #
    "  Concludes the game as a win for `winner` because a spell left the opposing king in check. " #
    "Records the cast spell's name for the display-only marker (`spellWinName` on the game state " #
    "and the recorder), then delegates to the existing end-game path, which stores `#Checkmate`, " #
    "reports the outcome to escrow as a normal checkmate, and mints NFTs. No-op unless the game " #
    "is still `#Playing`. This is an update call.\n" #
    "- `concludeByInsufficientMaterial(now : Timestamp) -> ()`\n" #
    "  Concludes the game as a draw for insufficient material because a spell's board effect left " #
    "the position with insufficient material for either side to deliver checkmate. Delegates to " #
    "the existing draw path, which stores `#InsufficientMaterial`, reports the outcome to escrow " #
    "as a draw, and mints NFTs — exactly the same conclusion the normal move path produces. " #
    "No-op unless the game is still `#Playing`. This is an update call.\n" #
    "- `getShieldState() -> ShieldState`\n" #
    "  Returns the current per-game shield totals for both teams (`whiteShield`, `blackShield`), " #
    "so the frontend's two embedded team windows (White and Black) can render each team's current " #
    "shield total and the space beneath it for the defensive number. Read-only query; does not " #
    "mutate state.\n" #
    "- `getShieldResolutionSnapshot() -> ShieldResolutionSnapshot`\n" #
    "  Returns the current shield-and-spell-resolution snapshot: both shields plus the pending " #
    "burn-and-play result (`lastBurnAndPlay`, null when no burn-and-play has occurred this turn). " #
    "Read-only query, safe to poll for the burn-and-play toast.\n" #
    "\n" #
    "**Shield and spell resolution semantics.** The shield is per-team and per-game: it resets to " #
    "zero for both teams at the start of every new game and never carries over. Burning a Subao Ve " #
    "adds its value (the current game number minus the NFT's game number) to that team's shield, " #
    "additively and stacking. Playing an offensive spell (Minor, Major, or Balls) computes its value the " #
    "same way (current game number minus the NFT's game number) and resolves against the defending " #
    "team's shield:\n" #
    "  - **Strictly exceeds fires.** If the spell value is strictly greater than the shield, the " #
    "shield drops to zero and the spell takes effect on the chessboard (`#fired`, " #
    "`firesOnBoard = true`).\n" #
    "  - **At least double fires and depletes.** If the spell value is at least double the shield, " #
    "the shield drops to zero and the spell still takes effect on the chessboard (`#fired`, " #
    "`firesOnBoard = true`). An offensive spell at least twice as powerful as the shield not only " #
    "depletes the shield but also takes effect on the chessboard. This is the same fire-and-deplete " #
    "outcome as a strictly-greater spell; it matters when the shield is zero, where any spell value " #
    "(including zero) fires.\n" #
    "  - **Otherwise cancels.** If the spell value is neither strictly greater than the shield nor " #
    "at least double it, the shield is reduced by the spell value (floored at zero) and the spell " #
    "does NOT take effect on the chessboard (`#cancelled`, `firesOnBoard = false`). Equal values " #
    "cancel out with no board effect.\n" #
    "  - **Shield floors at zero.** The shield never goes negative; a spell that exceeds the " #
    "shield sets it to zero, not below.\n" #
    "  - **Legacy NFTs are excluded.** An NFT minted before the `jalca:` metadata keys carries no " #
    "game number; it is excluded from shield math entirely and burns inert as `#burnedLegacy` " #
    "(`#legacy`, `firesOnBoard = false`). The burn result's `legacyReason` carries why " #
    "(`#readFailed` / `#keysAbsent` / `#wrongType` / `#keysDisagree`).\n" #
    "  - **Opening Move_Maker is Subao Ve-only.** The opening Move_Maker (whichever color opens, " #
    "including random Black openings) is restricted to Subao Ve only. There is no fallback: if the " #
    "opening Move_Maker holds no Subao Ve, they cannot burn/play any NFT spell that move (plain " #
    "chess move only). Later Move_Makers may burn any spell, including Subao Ve (stacking defense).\n" #
    "\n" #
    "**Worked example.** Black's shield is 6. White plays an offensive spell of 2: Black's shield " #
    "is reduced to 4 and the spell does not take effect on the board. If White then plays an " #
    "offensive spell of 5, Black's shield is reduced to 0 and the spell fires on the board, because " #
    "5 is greater than 4. However, if White plays an offensive spell of 4, Black's shield is also " #
    "reduced to 0, but the spell does not go into effect on the chessboard, because 4 and 4 cancel " #
    "each other out. If Black's shield is 0, any offensive spell fires on the board and leaves the " #
    "shield at 0, because every value is at least double a zero shield.\n" #
    "\n" #
    "**Burn-and-play result payload.** `BurnAndPlayResult` carries `tokenId` (the burned NFT), " #
    "`spellName`, `gameNumber` (null for a legacy NFT), `team` (the burning team), `kind` " #
    "(`#SubaoVe` / `#Minor` / `#Major` / `#Balls`), `resolution` (null for a defensive Subao Ve burn or a " #
    "legacy inert burn, neither of which resolves against a shield), `appliedColour` (the Balls " #
    "colour family applied to the caster's board, or null unless a Balls spell fired on the board), " #
    "and `appliedOpponentImage` (the opponent-board image applied to the DEFENDER's board, or null " #
    "unless one of the three offensive image spells fired on the board), and `legacyReason` (why " #
    "the burn was classified legacy — `#readFailed` / `#keysAbsent` / `#wrongType` / " #
    "`#keysDisagree` — or null when the burn carried a usable spell), and `spellCheckWin` (the " #
    "casting team when the spell's board effect left the defending king in check, so the game " #
    "concluded as a win for the caster; null otherwise), and `castOutcome` (the per-spell cast " #
    "outcome recorded on the burn state for this cast — `#succeeded` / `#prevented` / `#noEffect` " #
    "— or null for a defensive Subao Ve burn, which is a shield contribution and never appears " #
    "in the per-spell outcome list), and `removedSquares` (the board square index — 0..63, " #
    "a1=0 ... h8=63 — of every piece this burn's removal spell removed, in removal order, using " #
    "the same plain square-index convention as `SpellBoardState.blockedSquares`; empty for every " #
    "non-removal spell and for a removal that removed nothing, so the frontend's per-square " #
    "death-square skull marker overlay renders nothing), and `transformedSquares` (the board " #
    "square index — 0..63, a1=0 ... h8=63 — of every enemy queen the Newkai Dodan spell turned " #
    "into an enemy knight on the same square, in transformation order; empty for every other " #
    "spell and for a Newkai Dodan cast that transformed nothing, so the frontend's summoned-piece " #
    "glow overlay renders nothing; a queen whose replacement knight would have attacked the " #
    "caster's king is destroyed instead and appears in `removedSquares`, never here), and " #
    "`insufficientMaterial` (true when the board after the spell's board effect has insufficient " #
    "material for either side to deliver checkmate, so the spell concluded the game as a draw " #
    "`#InsufficientMaterial` the same way the normal move path does; false for every burn that " #
    "did not leave insufficient material). `spellCheckWin` is display-only: it " #
    "never reaches the escrow or the stored end state, which remain `#Checkmate`. " #
    "`SpellResolution` carries " #
    "`attacker`, `defender`, `spellValue`, `shieldBefore`, `shieldAfter`, `outcome` (`#fired` / " #
    "`#cancelled` / `#legacy`), and `firesOnBoard`.\n" #
    "\n" #
    "**Per-spell cast outcome.** Every spell that is cast is recorded exactly once in the " #
    "burning team's window with a `SpellCastOutcome`, so the team windows can show a tick, a " #
    "cross or a question mark next to each cast spell:\n" #
    "  - `#succeeded` (tick) — the spell was cast and Subao Ve did not prevent it; it fired on " #
    "the board.\n" #
    "  - `#prevented` (cross) — the spell was cast but Subao Ve prevented it; the shield absorbed " #
    "it and it did not land on the board.\n" #
    "  - `#noEffect` (question mark) — the spell was cast and burned but had no effect on Subao Ve " #
    "and did not land on the board (a legacy inert burn, or a cast recorded through the plain " #
    "bookkeeping path with no shield resolution).\n" #
    "Subao Ve itself never appears in the per-spell outcome list; it is a defensive shield " #
    "contribution and is reflected only in the shield total. The outcome is recorded at the " #
    "single shared recording point (`appendBurnedSpell`), so a spell is recorded exactly once " #
    "whether it was cast through `recordBurn` or `burnAndPlay`.\n" #
    "\n" #
    "**Balls spells and the per-team board palette.** The Balls category holds five legacy " #
    "offensive spells — Sandy Balls, Cloudy Balls, Grassy Balls, Fiery Balls, and Wooden Balls — " #
    "each carrying a fixed colour family (`#Sandy` / `#Cloudy` / `#Grassy` / `#Fiery` / `#Wooden`). " #
    "The spell name alone determines the family; there is no per-NFT colour variation. A Balls " #
    "spell resolves against the defending team's shield exactly like a Minor/Major spell (the " #
    "Subao Ve rule above): it fires when its value strictly exceeds the shield or is at least " #
    "double the shield, zeroing the shield; otherwise it cancels with no board effect. When a " #
    "Balls spell fires, the " #
    "caster's own board takes that spell's colour family, replacing any previous family for that " #
    "team (last-spell-wins globally), and the family persists for the rest of the game. Each " #
    "team's board is a function only of what has been cast on that team's board, never of the " #
    "opponent's. A legacy Balls NFT (no game number) burns inert with no palette effect and no " #
    "shield math. The palette is a pure visual layer: it never changes board state, piece " #
    "positions, or legal moves, and it is cleared for both teams at new-game start. The active " #
    "family per team is exposed through `getSpellBoardState` as `whiteBallsColour` and " #
    "`blackBallsColour` (each null when no Balls spell has fired on that team's board).\n" #
    "\n" #
    "**Offensive image spells and the opponent-board image.** The Balls category also holds three " #
    "offensive image spells — Hairy Balls, Veiny Balls, and Shiny Balls — each carrying a fixed " #
    "image slug (`#Hairy` / `#Veiny` / `#Shiny`). The spell name alone determines the slug; there " #
    "is no per-NFT variation. These spells resolve against the defending team's shield exactly " #
    "like the other Balls spells (the Subao Ve rule above): they fire when their value strictly " #
    "exceeds the shield or is at least double the shield, zeroing the shield; otherwise they " #
    "cancel with no board effect. When one fires, the OPPONENT's board (the defender's board) shows that spell's " #
    "image on every square, replacing any previous image for that team (last-spell-wins globally), " #
    "and the image persists for the rest of the game. The caster's own board is completely " #
    "unaffected — no image, no recolour, no change. A legacy NFT (no game number) burns inert with " #
    "no image effect and no shield math. The image is a pure visual layer: it never changes board " #
    "state, piece positions, or legal moves, and it is cleared for both teams at new-game start. " #
    "The active image per team is exposed through `getSpellBoardState` as `whiteOpponentImage` and " #
    "`blackOpponentImage` (each null when no image spell has fired on that team's board).\n" #
    "\n" #
    "### Story domain\n" #
    "\n" #
    "The Story is an ordered list of sections. Section 0 is the permanent \"Forever\" section, " #
    "seeded once by the migration chain with the JALCA medieval fool story text. It is immutable: " #
    "no endpoint may edit, delete, or vote on it, and it carries no counters. Every section after " #
    "Forever is an appended section with its own text, a Delete counter, a Keep counter, and a " #
    "deleted/gap state.\n" #
    "\n" #
    "**Sole-writer gate.** The writer is hardcoded at compile time to a single principal. Only " #
    "that principal may append a new section or fill a deleted gap; every other caller is " #
    "read-only. The gate is enforced server-side against the caller principal (`msg.caller`), " #
    "never against a client-supplied value. The legacy `claimStoryAuthorship` / `getStoryAuthor` " #
    "endpoints are retained for compatibility and record a separate author principal; they are " #
    "NOT the write gate.\n" #
    "\n" #
    "**Per-principal voting.** Delete and Keep votes are recorded against the caller's Internet " #
    "Identity principal. Each signed-in principal may cast at most one Delete vote and at most " #
    "one Keep vote per section: a repeat press from the same principal is rejected server-side " #
    "and the section's counters do not change. Anonymous (not signed-in) callers cannot vote at " #
    "all. The read path reports `hasVotedDelete` / `hasVotedKeep` per section so the frontend can " #
    "render the controls in an already-voted state.\n" #
    "\n" #
    "- `getStorySections() -> [StoryRow]`\n" #
    "  Returns the ordered sections. Each row carries `index`, `text`, `deleteCount`, " #
    "`keepCount`, `deleted`, and the caller-relative `hasVotedDelete` / `hasVotedKeep` flags. " #
    "Read-only query; does not mutate state. This is the read path the frontend uses when the " #
    "Story panel opens.\n" #
    "- `appendStorySection(text : Text) -> ()`\n" #
    "  Appends a new live section at the end of the order. Gated to the hardcoded sole writer; " #
    "any other caller **traps** with \"Only the Story writer may modify the Story\". Update call.\n" #
    "- `fillStoryGap(index : Nat, text : Text) -> ()`\n" #
    "  Writes new text into a deleted section's slot, restoring it as a live section at that " #
    "position with its counters reset to zero and its recorded per-principal votes cleared. " #
    "Gated to the hardcoded sole writer. **Traps** if " #
    "`index` is 0 (the Forever section cannot be modified), if no section exists at that " #
    "position, or if that section is not a gap. Update call.\n" #
    "- `pressStoryDelete(index : Nat) -> ()`\n" #
    "  Records a Delete vote on an appended section against the caller's principal. Only a " #
    "signed-in (non-anonymous) caller may vote, and at most once per section: a repeat press " #
    "from the same principal is rejected and the counter does not change. The section is removed " #
    "only when its Delete count is >= 10 AND >= 3x its Keep count; removal resets both counters " #
    "and clears the recorded votes. **Traps** on index 0, an already-deleted gap, or an " #
    "anonymous caller. Update call.\n" #
    "- `pressStoryKeep(index : Nat) -> ()`\n" #
    "  Records a Keep vote on an appended section against the caller's principal. Only a " #
    "signed-in (non-anonymous) caller may vote, and at most once per section: a repeat press " #
    "from the same principal is rejected and the counter does not change. **Traps** on index 0, " #
    "an already-deleted gap, or an anonymous caller. Update call.\n" #
    "- `claimStoryAuthorship() -> Principal`\n" #
    "  Legacy compatibility endpoint. Records the caller's Internet Identity principal as the " #
    "Story author on first call; thereafter immutable. A call from a different principal " #
    "**traps** with \"Story authorship is already claimed by another principal\"; a call from " #
    "the anonymous principal **traps** with \"Story authorship requires a signed-in Internet " #
    "Identity principal\". Update call.\n" #
    "- `getStoryAuthor() -> ?Principal`\n" #
    "  Returns the recorded legacy Story author principal, or null when unclaimed. Read-only " #
    "query; does not mutate state.\n" #
    "- `writeStory(text : Text) -> ()`\n" #
    "  Legacy compatibility endpoint. Appends a new section as the hardcoded sole writer; any " #
    "other caller **traps** with \"Only the Story writer may modify the Story\". Update call.\n" #
    "\n" #
    "### PBPP_Information domain\n" #
    "\n" #
    "- `appendPbppInformation(content : Text) -> PbppInformationEntry`\n" #
    "  Appends a new time-stamped entry with the given content to the append-only PBPP_Information " #
    "record. Prior entries are never overwritten. Returns the newly appended entry.\n" #
    "- `getPbppInformation() -> [PbppInformationEntry]`\n" #
    "  Returns all PBPP_Information entries in append order. Read-only query; does not mutate state.\n" #
    "\n" #
    "### Spells domain\n" #
    "\n" #
    "- `getSpellTable() -> SpellTable`\n" #
    "  Returns the full spell table: the single BLOCK spell (`block`, an optional entry), the " #
    "MAJOR spells (`major`), the MINOR spells (`minor`), and the BALLS spells (`balls`). The " #
    "table is a module constant (static data, not stable state), so this is a pure read. " #
    "Read-only query; does not mutate state. Each `SpellEntry` carries `id`, `name`, `meaning`, " #
    "`spell` (the full description), `category` (`Block`/`Major`/`Minor`/`Balls`), `dropChance` " #
    "(a legacy display-only numerator out of 20), `complexity` (`Easy`/`Moderate`/`Complex`), " #
    "`nftEligible`, and the two display fields `magicCategory` (`Necromancy`/`Conjuring`/" #
    "`Elemental`/`Hex`) and `level` (`Basic`/`Skilled`/`Advanced`/`Mastery`/`OP`). Both display " #
    "fields are optional and are `null` when the spell has no assignment (Subao Ve, and any id " #
    "absent from the lookup). The frontend renders them beside the spell name, for example " #
    "\"Necromancy · Skilled\".\n" #
    "\n" #
    "Non-obvious gotcha: `dropChance` no longer drives the game-end award — the award is a single " #
    "uniform draw over the level buckets (Nothing / Subao Ve / Basic / Skilled / Advanced / " #
    "Mastery / OP). `dropChance` is retained for display only. A spell is drawable at game end " #
    "only when `nftEligible` is true AND it carries a `level`; a spell with a level but " #
    "`nftEligible = false` (for example Thayma and Hipsy Titam) is never drawn.\n" #
    "\n" #
    "### Game state and maintenance\n" #
    "\n" #
    "- `getGameState(principal : Text) -> GameStateSnapshot`\n" #
    "  Returns the current game state snapshot (board, turn, timer, players). Read-only " #
    "**query** — it runs with no consensus round and has no maintenance side effect. The " #
    "`principal` argument is accepted for interface compatibility and is not used. The snapshot " #
    "carries `turnDuration` (the turn duration resolved for the current game from the vote " #
    "tally captured at game start) and `timerRemainingMs` (the live countdown computed from " #
    "that duration, not a fixed constant). It also carries `spellWinName`: the cast spell's name " #
    "when the game concluded by a spell-induced " #
    "check win, or null otherwise (display-only). Each occupied square of `board` is a `Piece` " #
    "record `{ pieceType; color; summoned }`; `summoned` is true only on a piece placed by a " #
    "summon spell (Thayma, Hipsy Titam, Lazarus, Cuoclot Sac Wonmuc Rook, Anne Boleyn) and false " #
    "on every other piece path (the initial board, a normal move, and a promotion). The marker " #
    "travels with the piece when it moves and is gone when the piece is captured or the board is " #
    "reset for a new game; the frontend uses it to render the permanent yellow drop-shadow glow " #
    "on summoned pieces only (promoted pieces are never summoned and never glow).\n" #
    "- `getGameRecord() -> GameRecord`\n" #
    "  Returns the current per-game Backend_Recorder summary (moves so far, player list / rosters, " #
    "result, end state, and the final-move player on timeout). Read-only **query**. The `endState` " #
    "is a variant: `#Checkmate`, `#Stalemate`, `#Draw`, `#Timeout`, or `#InsufficientMaterial` " #
    "(a draw by insufficient material — K vs K, K+B vs K, K+N vs K, or K+B vs K+B with both " #
    "bishops on the same square colour). The record carries `spellWinName`: the cast spell's name " #
    "when the game concluded by a spell-induced check win, or null otherwise (display-only).\n" #
    "- `getExerciseAssignments() -> [ExerciseAssignment]`\n" #
    "  Returns the stored exercise assignments in capture sequence. Read-only **query**.\n" #
    "- `getDrinkingAssignments() -> [DrinkingAssignment]`\n" #
    "  Returns the stored drinking assignments in capture sequence. Read-only **query**.\n" #
    "- `getBets() -> [BetRecord]` and `getResults() -> [ResultRecord]`\n" #
    "  Return the recorded prediction bets and game results in order. Read-only **queries**.\n" #
    "\n" #
    "**Maintenance is timer-driven, not client-driven.** The backend installs a recurring " #
    "maintenance timer that fires every **5 seconds** (`maintenanceIntervalSeconds`). Each tick " #
    "runs the maintenance pass — stale-player cleanup, turn-timeout expiry, and celebration/draw " #
    "expiry — with zero players connected and independent of any client call. The timer callback " #
    "wraps the pass in try/catch, so a trap in one tick does not cancel the timer; the IC " #
    "re-schedules the next tick. `heartbeat` only records the caller's last-seen time and no " #
    "longer triggers maintenance, and the read-only methods above no longer trigger it either. " #
    "The maintenance cadence is therefore a fixed 5s rather than the previous per-client-call " #
    "cadence, so stale cleanup and expiry lag by up to 5s.\n" #
    "\n" #
    "**Empty-lobby short-circuit.** When the lobby has zero players, each tick performs no work " #
    "and returns immediately; the recurring timer itself keeps firing on its 5-second cadence, " #
    "only the work inside the tick is skipped. The pass resumes its normal work on the next tick " #
    "once at least one player is present. The guard is the raw roster size, so a lobby holding " #
    "only stale players still runs the pass — stale cleanup prunes them and pauses the emptied " #
    "lobby exactly as before.\n" #
    "\n" #
    "**Presence heartbeat cadence.** The frontend sends `heartbeat(principal)` on a " #
    "role-dependent cadence: every **15 seconds** for the current Move_Maker and every " #
    "**60 seconds** for every other player. The frontend also pings immediately on tab focus, " #
    "on `visibilitychange`, and when the player presses \"New game\". When the Move_Maker changes " #
    "(a move is played, the maker leaves, or a new maker is assigned), the new maker switches " #
    "to the 15s cadence and the previous one to the 60s cadence. The turn timer is " #
    "a separate concern and is unaffected by the presence cutoff; its length is the " #
    "turn duration voted for the current game (see the Voting domain below).\n" #
    "\n" #
    "**Presence lifecycle: active, inactive, deleted.** A player's presence is tracked in two " #
    "stages by the recurring maintenance timer:\n" #
    "  - **Inactive** — after about **90 seconds** without a ping (`inactiveCutoffNs`), the " #
    "player is marked `isInactive = true`. They STAY in the roster with their team, username " #
    "and wallet, but are excluded from Move_Maker selection. Any ping (`heartbeat`, or a " #
    "\"New game\" press) flips them back to active immediately.\n" #
    "  - **Deleted** — after about **30 minutes** without a ping (`deletionCutoffNs`), the " #
    "player is removed from the lobby entirely. Deletion is **skipped entirely while the game " #
    "phase is `#Celebration` or `#Draw`**; a player past the 30-minute silence is deleted on " #
    "the next maintenance pass after the window ends. Deleting a player also removes their " #
    "ranked binding and their kick votes. When a deleted player was the Move_Maker, a new " #
    "maker is chosen from the remaining ACTIVE players on that team, inheriting the remaining " #
    "turn time (the clock is not reset); when no active player remains on the team, the " #
    "Move_Maker is cleared. The lobby pauses only when no players remain at all.\n" #
    "\n" #
    "**Team assignment (fewer-players rule).** A joining player is placed on the team with " #
    "fewer `teamCount` players, counting inactive players; on a tie the team is chosen randomly. " #
    "The same rule is used by `login`/`loginRanked` (a new joiner) and by `reassignTeams` (the " #
    "fresh-keyed reassignment at game start), so the two paths are consistent. A returning player " #
    "keeps their existing team. The counts are read immediately before each assignment, so " #
    "`reassignTeams` sees the teams as filled by the previous draws in the same pass.\n" #
    "\n" #
    "**Reserved bot player.** The lobby holds exactly one bot player, keyed by the reserved " #
    "roster key `jalca-bot`. The bot is added through an internal path only — at lobby creation " #
    "and at every new game, including after `reassignTeams` — and is never created through " #
    "`login` or `loginRanked`: both reject the reserved key, and `uniqueUsername` never hands it " #
    "to a human. The bot takes its team through the same fewer-players rule as a human joiner, so " #
    "a human joining later goes to the other team. It is exempt from `heartbeat`, from " #
    "`cleanupStalePlayers` and from the inactive state, and is always fresh, so it always counts " #
    "as present. It is skipped in both Move_Maker pick sites, so it is never chosen as " #
    "Move_Maker. Each `PlayerInfo` carries `isBot` (true only for the bot).\n" #
    "\n" #
    "**Move_Maker selection (fair turn rotation).** Each player carries a per-game " #
    "`turnsThisGame` counter, reset to 0 for every player at new-game start. Both Move_Maker " #
    "selection sites — `assignMoveMakerForTeam` and the inline pick inside `attemptMove` — " #
    "delegate to one shared helper. The helper filters to ACTIVE teammates (inactive players are " #
    "excluded, and the bot is skipped), excludes the player who just moved when more than one " #
    "candidate remains, then " #
    "picks randomly among the candidates with the lowest `turnsThisGame` and increments the " #
    "chosen player's counter. A player joining mid-game (or a returning player who was inactive) " #
    "starts at their team's current lowest `turnsThisGame`, not 0. When a team has only one " #
    "active player, that player is still picked even though they just moved, so the game never " #
    "stalls. The counter increments only once per real turn: a rejected second `attemptMove` " #
    "does not bump any counter, and a player removed during the selection await is not credited " #
    "a turn they never took. The random pick's await stays before the turn flip, and the pick " #
    "plus the counter update stay inside the same guarded block as the turn flip, so the " #
    "double-move guard is unaffected.\n" #
    "\n" #
    "**Heartbeat and requestNewGame error result.** Both `heartbeat(principal)` and " #
    "`requestNewGame(principal)` return `{ #ok; #err : Text }`. They return `#err` when the " #
    "principal is not a logged-in player — for example a player already removed by the " #
    "deletion cutoff — so the client can show a \"You were removed, tap to rejoin\" banner " #
    "instead of silently no-op'ing. `heartbeat` refreshes `lastPing` and clears the inactive " #
    "flag on success; `requestNewGame` flips `isFresh` to true and also counts as a ping.\n" #
    "\n" #
    "The `player` OQL entity " #
    "exposes `lastPing` as the raw nanosecond timestamp rendered as text, `isMoveMaker` as " #
    "the text `\"true\"` / `\"false\"`, `isInactive` as a boolean, `isBot` as a boolean, and " #
    "`turnsThisGame` as a natural number, so a query can identify " #
    "the current Move_Maker and reason about presence against the 90-second inactive cutoff " #
    "and the 30-minute deletion cutoff.\n" #
    "\n" #
    "**Timer failure and cycles visibility.** A trap inside a tick aborts only that tick; the " #
    "next tick retries. A deterministic trap (the same corrupt state every tick) silently stops " #
    "maintenance progress — there is no dedicated maintenance-health endpoint, and the observable " #
    "proxy is the game state itself (stale players never removed, timers never expiring, " #
    "celebration windows never closing). If the canister runs out of cycles, all messages " #
    "including timer ticks stop and the canister freezes; this is observable externally through " #
    "the standard IC management-canister `canister_status` cycle balance, which is the signal for " #
    "low-cycles maintenance stoppage. The backend does not expose its own cycles query.\n" #
    "\n" #
    "### Voting domain (next-game settings)\n" #
    "\n" #
    "- `castVote(principal : Text, vote : Vote) -> { #ok; #err : Text }`\n" #
    "  Records `principal`'s vote for the next game's settings. `Vote` carries `startingPosition` " #
    "  (`#Standard` / `#Random`), `spellUse` (`#On` / `#Off`), and `turnDuration` " #
    "  (`#TwoMinutes` / `#NinetySeconds` / `#OneMinute`). One vote per player: casting again " #
    "  overwrites the player's previous vote. Returns `#ok` on success, or `#err` if `principal` is " #
    "  not a logged-in player (it does not trap).\n" #
    "- `getVoteTally() -> VoteTally`\n" #
    "  Returns the **live** vote counts for the next game (`standardCount`, `randomCount`, " #
    "  `spellOnCount`, `spellOffCount`, `twoMinuteCount`, `ninetySecondCount`, `oneMinuteCount`) " #
    "  plus the winning settings resolved from the tally. Read-only " #
    "  query; recomputed from the vote store on every call, so it changes as players cast votes.\n" #
    "- `getNextGameSettings() -> NextGameSettings`\n" #
    "  Returns the winning settings (`startingPosition`, `spellUse`, `turnDuration`) resolved from " #
    "  the **current** vote tally — the value `startNewGame` applies when it starts the next game. " #
    "  Read-only query.\n" #
    "- `getGameSettingsSnapshot() -> GameSettingsSnapshot`\n" #
    "  Returns the **fixed** vote snapshot that decided the **current** game's settings: the winning " #
    "  `startingPosition`, `spellUse` and `turnDuration` plus the counts that produced them " #
    "  (`standardCount`, `randomCount`, `spellOnCount`, `spellOffCount`, `twoMinuteCount`, " #
    "  `ninetySecondCount`, `oneMinuteCount`). It is captured once at the **start** of the " #
    "  current game, from the live vote store, and held unchanged for the whole current game, so it " #
    "  does **not** change as players cast votes for the next game. Before the first game starts it " #
    "  is the zero-vote snapshot (defaults `#Random` / `#On` / `#TwoMinutes`, all counts 0). " #
    "  Read-only query.\n" #
    "\n" #
    "Votes are cast by each player during the previous game (and, in practice, at the moment that " #
    "game ends, when the frontend observes the game-end phase change). They persist through the " #
    "celebration/draw window and are tallied at new-game start, where the winning settings are " #
    "applied and the fixed snapshot is captured; the store is then cleared so votes apply to " #
    "exactly one game. A strict majority wins; ties (including zero votes) resolve to the defaults " #
    "(`#Random` starting position, `#On` spell use, `#TwoMinutes` turn duration). The winning turn " #
    "duration is applied to the current game's live countdown and re-applied at each turn flip.\n" #
    "\n" #
    "### Ranked play (Internet-Identity-bound wins)\n" #
    "\n" #
    "Ranked play lets a player bind a roster slot to their Internet Identity principal and " #
    "accumulate wins across games. The two ranked-play stores (`rosterBindings` and " #
    "`winnerStore`) are **not** exposed through any OQL entity.\n" #
    "\n" #
    "- `loginRanked(rosterKey : Text, username : Text, walletAddress : ?Text, walletSource : " #
    "WalletSource) -> LoginResult`\n" #
    "  Binds the caller's Internet Identity principal to `rosterKey`, then runs the normal login " #
    "path. This is a `shared ({ caller })` update call. It **traps** when the caller is the " #
    "anonymous principal, when `rosterKey` is empty or longer than 128 characters, when " #
    "`rosterKey` is already bound to a **different** caller, or when `rosterKey` is on the roster " #
    "but unbound (a guest currently holds it). It accepts a key already bound to the **same** " #
    "caller. The binding is recorded synchronously before any await; the sanitized typed " #
    "`username` is stored with it so wins credit the typed name rather than the `_copy`-adjusted " #
    "roster name. After login it prunes bindings whose key no longer exists on the roster " #
    "(matched by key, never by principal). If the caller already has a winner entry, its stored " #
    "display name is refreshed to the newly typed name.\n" #
    "- `getWinnerRanking(limit : Nat) -> [WinnerRankingRow]`\n" #
    "  Returns the public winner ranking, open to everyone. `limit` is capped at **50** " #
    "server-side. Rows are sorted by `wins` descending, then `lastWinGame` ascending. Each row " #
    "carries `rank` (1-based), `displayName`, `wins`, and `isMe` — **no principals are returned**. " #
    "`isMe` is true only for the calling principal's own row and is always false for an anonymous " #
    "caller. Read-only query.\n" #
    "- `getMyWins() -> MyWins`\n" #
    "  Returns the calling principal's own standing: `wins` and 1-based `rank` within the full " #
    "ranking (`rank` is 0 when the caller has no winner entry). Open to everyone; an anonymous " #
    "caller receives `{ wins = 0; rank = 0 }`. Read-only query.\n" #
    "\n" #
    "**Win accounting.** Wins are recorded synchronously at game conclusion for a roster player " #
    "who is on the winning team, has a `lastPing` within the existing 180-second stale cutoff, " #
    "and has a binding. Wins are deduped by bound principal, so the same principal occupying two " #
    "roster entries counts once. Timeout wins count; draws do not. The win is credited against " #
    "the game number read before the conclusion increment, so a double conclusion cannot " #
    "double-count.\n" #
    "\n" #
    "### Competition (alternating Sunday/Thursday leaderboard)\n" #
    "\n" #
    "The competition is a leaderboard alongside the All-time ranking. Competitions alternate " #
    "between **Sunday** and **Thursday** boundaries: each competition runs for a single day, " #
    "**00:00:00 to 23:59:59 UTC** of its boundary day, and the next competition starts four days " #
    "after a Sunday (on Thursday) or three days after a Thursday (on Sunday). A win counts toward " #
    "the competition only when the game **concludes** inside that one-day window, judged by the " #
    "canister's time at conclusion; a game that starts before the boundary day ends but concludes " #
    "at or after the next boundary's 00:00:00 UTC counts toward All time only. Every " #
    "competition-qualifying win also still increments the All-time total, so All time is " #
    "unchanged. The competition stores are internal and are **not** exposed through any OQL " #
    "entity.\n" #
    "\n" #
    "- `getSundayCompStandings(limit : Nat) -> [CompStandingRow]`\n" #
    "  Returns the current competition's standings: at most **50** rows (`limit` is capped " #
    "server-side), sorted by `wins` descending with ties broken by who reached that win count " #
    "first (the earlier player ranks higher). Each row carries `rank` (1-based), `displayName` " #
    "(the most recent username), `wins`, and `isMe` — **no principals are returned**. `isMe` is " #
    "true only for the calling principal's own row and always false for an anonymous caller. " #
    "This is an **update call**, not a query: it finalizes the previous competition lazily and " #
    "idempotently before reading (see below), and a query cannot persist that archive.\n" #
    "- `getPastWinners() -> [PastWinnerRow]`\n" #
    "  Returns the Past winners table, **newest first**, with **no principals**. Each row carries " #
    "`sunday` (the competition's boundary date, UTC, in nanoseconds at 00:00:00), `winnerName` / " #
    "`winnerWins`, and `runnerUpName` / `runnerUpWins` (each null when there was no winner or no " #
    "runner-up). Only competitions with a confirmed prize allocation are listed (see the archive " #
    "gate below); a competition date without a prize pool never appears. This is an **update " #
    "call** for the same lazy-finalization reason as " #
    "`getSundayCompStandings`.\n" #
    "- `getSundayCompStatus() -> CompStatus`\n" #
    "  Returns the competition status: `live` (whether a competition is currently running), " #
    "`sunday` (the current competition's boundary date, UTC, in nanoseconds at 00:00:00), and " #
    "`secondsRemaining` (the seconds until the competition ends when live, or until the next one " #
    "starts when frozen). Read-only query; it mutates nothing.\n" #
    "\n" #
    "**Win accounting.** Competition wins reuse the exact All-time eligibility rules: a roster " #
    "player on the winning team whose `lastPing` is within the 180-second stale cutoff and who " #
    "has a binding, deduped by bound principal so the same principal on two roster entries counts " #
    "once. Timeout wins count; draws and absent players do not; anonymous callers and guests are " #
    "rejected (they have no binding). The All-time recording runs synchronously at the two hook " #
    "sites (the checkmate celebration path and the timeout branch of timer expiry) and returns " #
    "the exact deduped (principal, display name) pairs it credited; the competition recording " #
    "then consumes that pre-computed list rather than re-reading the bindings, so the two " #
    "recordings always agree even if a binding is removed during the intervening await. The " #
    "competition recording is wrapped so a failure in it never blocks or rolls back the All-time " #
    "recording or the game ending.\n" #
    "\n" #
    "**Frozen board and reset.** Outside a competition the board is frozen on the last " #
    "competition's final standings. The live store is not cleared while the just-ended " #
    "competition is still the frozen one, so the frozen board keeps showing that competition's " #
    "final standings; it resets to zero only once the next competition has actually begun, so a " #
    "read just after a boundary with no wins shows an empty live board and every player starts at " #
    "0. The chessboard itself is never frozen or affected.\n" #
    "\n" #
    "**Lazy, exactly-once finalization.** A competition runs 00:00:00 to 23:59:59 UTC of its " #
    "boundary day, so it is finished once its day has fully passed. The first read or write after " #
    "that archives it exactly once, even after weeks with no activity, from the standings that " #
    "were live when it ended — so a finished competition with recorded wins archives its winner " #
    "and runner-up rather than an empty result. Several missed " #
    "competitions are each archived in order on the first read, with a winner only for the " #
    "competitions that actually had wins (a competition with no wins archives no winner; a single " #
    "winner archives no runner-up). A finalization marker records the last finalized competition, " #
    "so a competition is never archived twice. The archive of a finished competition never clears " #
    "or overwrites the current competition's live standings. Each archived competition stores its " #
    "boundary " #
    "date, the winner and the runner-up, each with the principal stored internally (for future " #
    "rewards) plus the username and win count at that moment; principals are never returned to " #
    "the frontend.\n" #
    "\n" #
    "**Archive gate — a confirmed prize allocation is required.** A fully-passed competition is " #
    "archived **only when it has a confirmed prize allocation** (a stored prize pool for that " #
    "exact competition date). A competition with no confirmed pool is never archived: no archive " #
    "entry, no winner, no runner-up, no placements and no prize claims are created for it, and " #
    "the finalization marker advances past it so a later lazy finalization cannot re-create it. " #
    "The gate is applied identically by the lazy finalization, the admin finalize action, and the " #
    "admin backfill. Consequently the Past winners table and the admin competition-date views " #
    "list only competitions with a confirmed pool, and a competition date without a prize pool " #
    "never appears in the archive.\n" #
    "\n" #
    "**Permanent removal before 1 November 2026 (UTC).** Every competition dated before the " #
    "00:00:00 UTC boundary of Sunday 1 November 2026 is permanently removed from both archives, " #
    "the prize allocations and the prize claims. The removal is applied at the start of every " #
    "finalization pass and is idempotent (a second pass finds nothing to remove). It subsumes the " #
    "four never-held October dates (4, 11, 15 and 18 October 2026). No archive-backed read " #
    "returns a removed date, and no new persisted field is needed — the removal is expressed " #
    "purely as a filter over the existing store contents.\n" #
    "\n" #
    "**Parallel 10-place archive.** Alongside the 2-place archive above, the same finalization " #
    "trigger also records each finalized competition's **top ten** placements (rank, principal, " #
    "display name, win count) in a separate 10-place archive, finalized lazily and idempotently " #
    "exactly once per competition. The 2-place archive is left completely untouched in shape and " #
    "behavior. The Past winners table reads each competition's winner and runner-up from " #
    "whichever store holds it — the 10-place archive when present, otherwise the 2-place archive " #
    "— so old competitions still show. The 10-place archive stores principals internally for " #
    "future rewards and never returns them to the frontend.\n" #
    "\n" #
    "### Prize domain\n" #
    "\n" #
    "The prize domain computes a per-Sunday prize pool from a competition's qualifying activity " #
    "and derives the first-prize amount from it. Amounts are in e8s (1 ICP = 100_000_000 e8s). " #
    "The pool is the number of qualifying wins in the competition times a fixed per-win " #
    "contribution; the first prize is half the pool. The single named ledger-fee constant " #
    "(10_000 e8s) is defined in one place (`lib/ledger-fee.mo`) so it can later be read from the " #
    "ledger without touching callers.\n" #
    "\n" #
    "- `getCurrentPrizePool() -> PrizePool`\n" #
    "  Returns the current competition's prize pool: `poolE8s` (the pool amount) and " #
    "`firstPrizeE8s` (the first-prize amount derived from it). Read-only query; it computes from " #
    "the live competition store and mutates nothing.\n" #
    "- `getArchivedPrizePool(sunday : Timestamp) -> ?ArchivedPrizePool`\n" #
    "  Returns the prize pool for the archived competition whose Sunday date is `sunday` " #
    "(`{ sunday; poolE8s; firstPrizeE8s }`), or null when no competition is archived for that " #
    "date. Read-only query.\n" #
    "- `getMyPrize() -> ?MyPrize`\n" #
    "  Returns the calling principal's own claimable prize — `{ sunday; rank; amountE8s; " #
    "deadline }` — or null. **Signed-in Internet Identity callers only**: an anonymous caller " #
    "**traps** with \"getMyPrize requires a signed-in Internet Identity principal\". It never " #
    "returns principals, and never returns an expired or already-paid prize. This is an **update " #
    "call**: it finalizes the 10-place archive lazily and idempotently before reading, and a " #
    "query cannot persist that archive.\n" #
    "- `getClaimStatus(sunday : Timestamp) -> ClaimStatus`\n" #
    "  Returns the claim status of the competition at `sunday`: `#claimable` while the claim " #
    "window is open, `#expired` after the deadline passes. The deadline is the next competition " #
    "start — four days after a Sunday, three days after a Thursday. Read-only query.\n" #
    "- `getAdminPrizeOverview() -> AdminPrizeOverview`\n" #
    "  **Admin-only.** Returns the current competition's prize pool plus the number of finalized " #
    "competitions in the 10-place archive (`{ pool; archivedCompetitionCount }`). Carries no " #
    "principals. The caller is checked against the hardcoded compile-time admin principal; any " #
    "other caller — including the anonymous principal — **traps** with \"getAdminPrizeOverview is " #
    "restricted to the admin principal\". The frontend admin panel is a display gate only; this " #
    "backend check is the security boundary. Update call.\n" #
    "\n" #
    "**Claim window.** A prize is claimable from the competition's boundary day until the next " #
    "competition starts — four days after a Sunday, three days after a Thursday; after that it is " #
    "expired and `getMyPrize` no longer returns " #
    "it. `getMyPrize` walks the archive newest first and returns the caller's most recent " #
    "claimable placement. The amount is the prize stored in the place record at finalization for " #
    "that exact rank — the competition's allocation first prize divided by 2^(rank-1), rounded " #
    "down — and never a value recomputed from the live allocation. A competition with no " #
    "allocation stores 0 for every rank, so its places have no prize to claim.\n" #
    "\n" #
    "**Per-Sunday admin allocation.** The admin may load a total pool (in e8s, fees included) for " #
    "an upcoming Sunday. The backend derives the first prize and the ten rank prizes from that " #
    "total and stores them per Sunday. The player view reads only the first prize for an allocated " #
    "Sunday; it never sees the pool, the fees, or any principal.\n" #
    "\n" #
    "- `getFirstPrizeForSunday(sunday : Timestamp) -> ?Nat`\n" #
    "  Returns the first prize (in e8s) for the Sunday whose UTC 00:00:00 boundary is `sunday`, or " #
    "null when that Sunday has no allocation. This is the **only** prize figure the player view " #
    "reads: it never returns the pool, the fees, or any principal. Read-only query; callable by " #
    "any principal, including anonymous.\n" #
    "- `getUpcomingAllocationStatuses() -> [SundayAllocationStatus]`\n" #
    "  **Admin-only.** Returns the allocation status of each of the next **8** upcoming Sundays " #
    "(UTC dates that have not started, never today or past), for the admin dropdown. Each row is " #
    "`{ sunday; allocated; poolE8s }` — `poolE8s` is null when the Sunday has no allocation. " #
    "Carries no principals. The caller is checked against the hardcoded compile-time admin " #
    "principal; any other caller — including the anonymous principal — **traps** with " #
    "\"getUpcomingAllocationStatuses is restricted to the admin principal\". Update call.\n" #
    "- `previewPrizeAllocation(poolE8s : Nat) -> PrizePreviewResult`\n" #
    "  **Admin-only.** Returns the preview figures for a candidate total pool, computed by the " #
    "backend so the frontend never disagrees: `preview` carries `firstPrizeE8s`, all ten " #
    "`rankPrizesE8s`, `prizesTotalE8s`, `feesTotalE8s` (10 x the ledger fee), and " #
    "`poolRequiredE8s` (prizes total plus the ten fees). `rejections` lists the blocking reasons " #
    "(empty when the pool is acceptable) and `warnings` lists the non-blocking warnings. Gated to " #
    "the hardcoded compile-time admin principal; any other caller, including the anonymous " #
    "principal, **traps** with \"previewPrizeAllocation is restricted to the admin principal\". " #
    "Update call.\n" #
    "- `savePrizeAllocation(sunday : Timestamp, poolE8s : Nat) -> AllocationResult`\n" #
    "  **Admin-only.** Saves an allocation for `sunday` from a total pool in e8s. Rejects " #
    "anonymous and non-admin callers (trap), a Sunday that has already started (trap — today's " #
    "and past Sundays are frozen), and a pool the preview rejects (returns " #
    "`#rejected([PrizeRejection])`). On success returns `#ok(SundayAllocationStatus)` for the " #
    "affected Sunday. Re-saving the same Sunday replaces its allocation. Update call.\n" #
    "- `clearPrizeAllocation(sunday : Timestamp) -> AllocationResult`\n" #
    "  **Admin-only.** Clears the allocation for `sunday`. Available until that Sunday starts; a " #
    "started Sunday **traps** (frozen). Rejects anonymous and non-admin callers (trap). Returns " #
    "`#ok(SundayAllocationStatus)` for the affected Sunday (with `allocated = false`). Update " #
    "call.\n" #
    "\n" #
    "**Allocation prize formula.** The ten rank prizes are `F / 2^(r-1)` rounding down for ranks " #
    "1 to 10, where `F` is the first prize. `F` is the smaller of `pool / 2` and the largest " #
    "value such that the sum of the ten halved prizes plus 10 x the ledger fee is at most the " #
    "pool — so the loaded pool always covers its own fees. The ledger fee is the single named " #
    "constant `10_000` e8s (`lib/ledger-fee.mo`).\n" #
    "\n" #
    "**Allocation rejections and warnings.** A candidate pool is rejected when it is too small to " #
    "cover the ten fees (`#poolTooSmallForFees`), when the rank-10 prize rounds to zero " #
    "(`#rank10RoundsToZero`), or when it exceeds the maximum pool of 20 ICP " #
    "(`#aboveMaximumPool`). A pool where low ranks pay less than the ledger fee is a " #
    "**non-blocking warning** (`#lowRanksBelowFee`), not a rejection. The maximum pool is fixed " #
    "at 20 ICP and is not admin-editable.\n" #
    "\n" #
    "**Sunday date rules use the canister clock.** `getUpcomingAllocationStatuses`, " #
    "`savePrizeAllocation`, and `clearPrizeAllocation` judge every Sunday against the canister's " #
    "own clock (`Time.now()`), never the browser's. A Sunday is editable only while it has not " #
    "started; once its 00:00:00 UTC boundary is reached the allocation is frozen.\n" #
    "\n" #
    "### Prize claim flow\n" #
    "\n" #
    "A signed-in Internet Identity player who owns a claimable place in a finalized competition " #
    "can claim their prize. The backend pays the prize by calling the prize canister's " #
    "`pay(competition, rank, recipient, amount)` from JALCA's own backend principal; the prize " #
    "canister authenticates that caller and is the authoritative gate. The prize canister is " #
    "configurable (see the admin setter below) and defaults to the live canister " #
    "`hqxm3-eaaaa-aaaam-ajppa-cai`.\n" #
    "\n" #
    "**Recipients must be principals.** The prize canister pays an ICP **principal** only; it " #
    "cannot pay a 64-character hex account ID or an exchange deposit address. The claim modal " #
    "validates the entered principal locally (well-formed, not the anonymous principal, not a " #
    "canister) and requires a full read-back plus the confirmation checkbox before submitting.\n" #
    "\n" #
    "- `claimPrize(competition : Timestamp, rank : Nat, recipient : Principal) -> ClaimResult`\n" #
    "  Claims the caller's own prize for the archived placement at `competition` (the competition " #
    "start timestamp — the exact archive key) and `rank` (1 to 10), paying `recipient`. This is a " #
    "`shared ({ caller })` **update call**. It **traps** for the anonymous principal with " #
    "\"claimPrize requires a signed-in Internet Identity principal\". The caller must own that " #
    "place: the archived placement's stored principal must equal the caller, otherwise the call " #
    "returns a not-claimable result and pays nothing. The place is set to `paying` **synchronously " #
    "before the first await**, together with the ownership check, so only one claim per place can " #
    "run at once — a double click or two simultaneous claims result in exactly one payment. The " #
    "recipient and the exact amount are recorded at the first attempt; **the amount sent to the " #
    "prize canister comes only from the stored prize for that exact rank, never from the browser**. " #
    "Returns " #
    "`ClaimResult` (`{ state; amountE8s; blockIndex; message }`).\n" #
    "- `getAdminPrizeClaims() -> AdminPrizeOverview`\n" #
    "  **Admin-only.** Returns, for each competition, its unclaimed, paying and paid prizes with " #
    "the amount, the recipient principal for paid ones, and the block index. Gated to the " #
    "hardcoded compile-time admin principal; any other caller — including the anonymous principal " #
    "— **traps** with \"getAdminPrizeClaims is restricted to the admin principal\". Never shown to " #
    "non-admins. Update call.\n" #
    "- `getAdminAllocatedCompetitionDates() -> [AdminCompetitionDate]`\n" #
    "  **Admin-only.** Returns the competition dates that have a confirmed prize pool, **newest " #
    "first**, for the admin prize-claims dropdown. Covers every competition with a confirmed pool " #
    "— past, present and future. Each row is `{ sunday; poolE8s }` (`sunday` is the " #
    "UTC 00:00:00 boundary in nanoseconds, `poolE8s` the stored total pool in e8s). It finalizes " #
    "the archive lazily and idempotently " #
    "before reading, so a just-ended competition with a confirmed pool is present. Gated to the " #
    "hardcoded compile-time admin principal; any other caller — including the anonymous principal " #
    "— **traps** with \"getAdminAllocatedCompetitionDates is restricted to the admin principal\". " #
    "Returns no principals. Update call.\n" #
    "- `getAdminCompetitionDetail(sunday : Timestamp) -> AdminCompetitionDetail`\n" #
    "  **Admin-only.** Returns the detail for one competition date selected in the admin " #
    "prize-claims dropdown: the confirmed pool prize and first prize, the past winners (winner and " #
    "runner-up names and win counts, each null when absent), and the claim status buckets " #
    "(`unclaimed` / `paying` / `paid`). An upcoming competition with a confirmed pool shows no " #
    "winners yet. It finalizes the archive lazily and idempotently before reading. Gated to the " #
    "hardcoded compile-time admin principal; any other caller — including the anonymous principal " #
    "— **traps** with \"getAdminCompetitionDetail is restricted to the admin principal\". Returns " #
    "no principals except the paid entries' recipient, which is admin-only. Update call.\n" #
    "- `setPrizeCanisterPrincipal(principal : Principal) -> ()`\n" #
    "  **Admin-only.** Sets the configurable prize canister principal. Rejects anonymous and " #
    "non-admin callers (trap). Defaults to the live canister `hqxm3-eaaaa-aaaam-ajppa-cai`. Update " #
    "call.\n" #
    "- `getPrizeCanisterBalances() -> PrizeBalancesResult`\n" #
    "  **Admin-only.** Reads the prize canister's ICP ledger balance and cycle balance by calling " #
    "its `balances` method from JALCA's own backend principal, using the same actor-reference style " #
    "and the same stored prize canister principal that `claimPrize` uses for `pay`. Gated to the " #
    "hardcoded compile-time admin principal; any other caller — including the anonymous principal " #
    "— **traps** with \"getPrizeCanisterBalances is restricted to the admin principal\". Returns a " #
    "**non-trapping result**: `#ok({ icpE8s; cycles })` on success, or `#err Text` when the call " #
    "fails or is rejected — for example before the prize canister is upgraded to expose `balances`, " #
    "in which case the error text is \"Prize canister did not answer. It may not be upgraded yet\". " #
    "`icpE8s` is the ICP balance in e8s (1 ICP = 100_000_000 e8s); `cycles` is the raw cycle " #
    "balance. This is an **update call** (the prize canister's `balances` makes an inter-canister " #
    "call to the ledger), not a query. It is **read-only**: it never moves funds and changes no " #
    "state, so it is safe to call repeatedly.\n" #
    "\n" #
    "**Claim states.** A place is `claimable` before any attempt (or after a definite rejection " #
    "returned it to claimable), `paying` while a claim is in flight or after an unknown outcome, " #
    "and `paid` once the prize canister returned `ok` with the ledger block index. On `ok` the " #
    "place becomes `paid` with the block index. On a **definite rejection** — `bad recipient`, " #
    "`ledger rejected the transfer; prize remains claimable`, `amount outside limits`, " #
    "`competition cap exceeded`, `insufficient balance`, or `bad rank` — the place returns to " #
    "`claimable` and may be retried. On **any unknown outcome** the place stays `paying`.\n" #
    "\n" #
    "**Retry safety.** A retry of a `paying` place must send the same competition, rank, recipient " #
    "and amount. The recipient is locked at the first attempt and cannot be changed while `paying`: " #
    "a retry with a different recipient is a mismatch, flags the place for the admin, and does not " #
    "send. After the `pay` call returns, the retry branch **re-reads the claim** and confirms it is " #
    "still `paying` with the same recipient and the same amount that were sent before applying the " #
    "outcome; if the place changed while the call was in flight, the outcome is not applied to the " #
    "changed place. The player triggers a retry with a \"Try again\" button; there is no timer-driven " #
    "automatic retry. A stuck `paying` place is shown to the player and flagged for the admin. " #
    "`needs manual check` shows the player a clear message and flags the place for the admin, and " #
    "is **not** retried; `unauthorized` is likewise flagged to the admin and not retried. The " #
    "prize canister's `pay` is itself idempotent — repeating the same call returns the original " #
    "block with `ok` and never sends twice — so a retry of the same payment is safe.\n" #
    "\n" #
    "**Deadline.** The claim deadline is the next competition start (four days after a Sunday, " #
    "three days after a Thursday), judged by the canister's clock when the place becomes paying. A " #
    "claim accepted before the deadline still pays if it completes after it. Retries of `paying` " #
    "places after the deadline are still allowed.\n" #
    "\n" #
    "**Amount limits.** The prize canister enforces a **10 ICP ceiling per payment** and a **20 ICP " #
    "cap per competition**. A stored prize above the per-payment ceiling, or a competition whose " #
    "stored prizes exceed the per-competition cap, is flagged for the admin and is not sent.\n" #
    "\n" #
    "**Privacy.** Principals of other players are never returned to the frontend. A player sees " #
    "only their own prize; the recipient principal is returned only in the admin-only overview.\n" #
    "\n" #
    "### OQL query surface\n" #
    "\n" #
    "- `schema() -> ...`\n" #
    "  Returns the OQL schema describing the queryable entities exposed by this canister.\n" #
    "- `execute(query : Text) -> ...`\n" #
    "  Executes a JSON OQL query over the exposed entities and returns the result rows.\n" #
    "\n" #
    "The exposed entities include the Real Bet domain's persisted data:\n" #
    "\n" #
    "- `realBet` — one row per locally recorded real bet, keyed by the monotonic local `id`. " #
    "Columns: `id`, `block_index` (the ICRC Ledger block index returned by the escrow), `game_id` " #
    "(the JALCA-generated match UUID), `player` (the player's principal as text), `username`, " #
    "`anonymous`, `pot_tier`, `amount_e8s`, `outcome` (`white`/`black`/`draw`), `wallet_address`, " #
    "`placed_at`, and `timestamp`.\n" #
    "- `settlement` — one row per locally recorded settlement, keyed by the monotonic local `id`. " #
    "Columns: `id`, `game_id` (the JALCA-generated match UUID that was resolved), `outcome` " #
    "(`white`/`black`/`draw`), `settled_at`, and `timestamp`.\n" #
    "\n" #
    "The exposed entities also include the Kick domain's live vote data:\n" #
    "\n" #
    "- `kickVote` — one row per kick vote, keyed by the (target, kicker) pair. Columns: `target` and " #
    "`kicker` (both PseudoPrincipal `Text` values). Votes are erased at the end of every game, so " #
    "rows reflect the current game's live kick votes.\n" #
    "\n" #
    "The exposed entities also include the ICRC-37 spender-approval state:\n" #
    "\n" #
    "- `approvalState` — one row per player's approval state, keyed by the player's " #
    "PseudoPrincipal. Columns: `player`, `collection` (the collection canister principal), " #
    "`spender` (the approved spender principal), `granted`, `grantedAt`, and `lastConsentError` " #
    "(the exact error/trap text from the most recent icrc21 consent call, or \"\" when the last " #
    "attempt produced no consent error).\n" #
    "\n" #
    "The exposed entities also include the shield-and-spell-resolution domain's per-game data:\n" #
    "\n" #
    "- `teamShield` — one row per team's per-game shield total (White and Black), keyed by `team`. " #
    "Columns: `team` (`White`/`Black`) and `shield` (the team's current shield total for this " #
    "game). The shield resets to zero for both teams at the start of every new game and never " #
    "carries over.\n" #
    "- `burnAndPlayResult` — zero or one row: the pending burn-and-play result for the current " #
    "turn, keyed by `tokenId`. Columns: `tokenId`, `spellName`, `gameNumber` (the NFT's game " #
    "number as text, or \"\" for a legacy NFT), `team` (`White`/`Black`), `kind` " #
    "(`SubaoVe`/`Minor`/`Major`/`Balls`), `attacker`, `defender`, `spellValue`, `shieldBefore`, " #
    "`shieldAfter`, `outcome` (`fired`/`cancelled`/`legacy`), `firesOnBoard`, `appliedColour` " #
    "(the Balls colour family applied by the burn, or \"\" when none), `appliedOpponentImage` " #
    "(the opponent-board image applied to the defender's board by the burn, or \"\" when none), " #
    "and `spellCheckWin` (the casting team — `White`/`Black` — when the spell's board effect " #
    "left the defending king in check so the game concluded as a win for the caster, or \"\" " #
    "when the spell did not end the game; display-only, never reaching the escrow or the stored " #
    "end state), `castOutcome` (`succeeded`/`prevented`/`noEffect` — the per-spell cast " #
    "outcome recorded on the burn state for this cast, or \"\" for a defensive Subao Ve burn, " #
    "which is a shield contribution and never appears in the per-spell outcome list), and " #
    "`removedSquares` (the board square index — 0..63, a1=0 ... h8=63 — of every piece this " #
    "burn's removal spell removed, in removal order, as a comma-separated text list; empty for " #
    "every non-removal spell and for a removal that removed nothing). " #
    "The resolution " #
    "columns are \"\" / 0 / false when the burn was a defensive Subao Ve shield contribution or a " #
    "legacy inert burn. The row is cleared when a new turn begins, so it never carries into the " #
    "next turn.\n" #
    "- `burnedSpell` — one row per burned spell in the team windows (White and " #
    "Black, each with its Minor/Major and Subao Ve sections), keyed by `spellName`. Columns: " #
    "`spellName`, `gameNumber`, `team` (`White`/`Black`), `category` " #
    "(`SubaoVe`/`Minor`/`Major`/`Balls`), and `outcome` (`succeeded`/`prevented`/`noEffect` — the " #
    "per-spell cast outcome: a tick for a successful cast, a cross for a Subao Ve-prevented cast, " #
    "or a question mark for a cast that had no effect on Subao Ve and did not land on the board). " #
    "The team spell windows accumulate every cast spell for the whole game and are cleared only " #
    "at game start and game end — they do not reset when a turn advances.\n" #
    "\n" #
    "The exposed entities also include the per-team spell board state:\n" #
    "\n" #
    "- `spellBoardState` — one row per team's board (White and Black), keyed by `team`. Columns: " #
    "`team` (`White`/`Black`), `ballsColour` (the active Balls colour family for that team's board " #
    "— `Sandy`/`Cloudy`/`Grassy`/`Fiery`/`Wooden` — or \"\" when no Balls spell has fired on that " #
    "team's board), `opponentImage` (the active opponent-board image for that team's board — " #
    "`Hairy`/`Veiny`/`Shiny` — or \"\" when no image spell has fired on that team's board), " #
    "`blockedSquareCount` (the number of squares blocked by Bouvet Hondao), and " #
    "`explosiveSquareCount` (the number of squares holding Conu Bungno explosive traps). Each " #
    "team's board is a function only of what has been cast on that team's board, never of the " #
    "opponent's. The board state is scoped to the current game: it resets at new-game start and " #
    "never carries over.\n" #
    "\n" #
    "The exposed entities also include the fixed game-settings snapshot:\n" #
    "\n" #
    "- `gameSettingsSnapshot` — zero or one row: the FIXED vote snapshot that decided the CURRENT " #
    "game's settings, keyed by `startingPosition`. Columns: `startingPosition` " #
    "(`Standard`/`Random`), `spellUse` (`On`/`Off`), `turnDuration` " #
    "(`TwoMinutes`/`NinetySeconds`/`OneMinute`), `standardCount`, `randomCount`, " #
    "`spellOnCount`, `spellOffCount`, `twoMinuteCount`, `ninetySecondCount`, and " #
    "`oneMinuteCount`. It is captured once at the start of the current game and " #
    "held unchanged for the whole current game, so it does not change as players cast votes for " #
    "the next game. Before the first game starts it is the zero-vote snapshot (defaults " #
    "`Random` / `On` / `TwoMinutes`, all counts 0).\n" #
    "\n" #
    "The exposed entities also include the Story domain's persisted data:\n" #
    "\n" #
    "- `story` — one row per Story section, in order. Columns: `index` (the section's position, " #
    "0 being the permanent \"Forever\" section), `text`, `deleteCount`, `keepCount`, " #
    "`deleted` (true while the section is a gap awaiting the writer), and the caller-relative " #
    "`hasVotedDelete` / `hasVotedKeep` flags (always false in the OQL projection, which has no " #
    "caller context).\n" #
    "\n" #
    "The exposed entities also include the live game state and the remaining game-domain " #
    "collections:\n" #
    "\n" #
    "- `gameState` — zero or one row: the live current-game state, keyed by `gameNumber`. " #
    "Columns: `gameNumber`, `phase` (`Playing`/`Celebration`/`Draw`/`Paused`), `currentTurn` " #
    "(`White`/`Black`), `winner` (`White`/`Black`, or \"\" when none), `openingName` (or \"\"), " #
    "`spellUseEnabled`, `moveMakerPrincipal` (or \"\"), `turnStartTime` (ns), `turnTimeLimitMs`, " #
    "`turnDuration` (`TwoMinutes`/`NinetySeconds`/`OneMinute` — the turn duration resolved for " #
    "the current game), " #
    "`celebrationEndTime` (ns as text, or \"\" when none), and `spellWinName` (the cast spell's " #
    "name when the game concluded by a spell-induced check win, or \"\" otherwise; display-only).\n" #
    "- `player` — one row per logged-in player, keyed by `principal`. Columns: `principal`, " #
    "`username`, `team`, `lastPing`, `isMoveMaker`, `walletAddress` (or \"\"), `walletSource` " #
    "(`none`/`typed`/`oisy`), and `isFresh`.\n" #
    "- `recordedMove` — one row per recorded move in the current/just-concluded game, keyed by " #
    "`index`. Columns: `index`, `username`, `team`, `fromSquare`, `toSquare`, `notation`, " #
    "`gaveCheck`, `capturedPiece` (or \"\"), `isCastling`, `promotion` (or \"\"), `isEnPassant`, " #
    "and `timestamp`.\n" #
    "- `playerListEntry` — one row per player in the Logged_In_List snapshot at game " #
    "conclusion, keyed by `listPosition`. Columns: `listPosition`, `principal`, `username`, " #
    "`team`, and `walletAddress` (or \"\").\n" #
    "- `teamRoster` — one row per team at game conclusion, keyed by `team`. Columns: `team` and " #
    "`count`.\n" #
    "- `exerciseAssignment` — one row per capture, in capture sequence, keyed by `index`. " #
    "Columns: `index`, `lostTeam`, `capturedPiece`, `reps`, `exercise`, `timestamp`, and " #
    "`moveIndex`.\n" #
    "- `drinkingAssignment` — one row per capture, in capture sequence, keyed by `index`. " #
    "Columns: `index`, `lostTeam`, `capturedPiece`, `drinks`, `timestamp`, and `moveIndex`.\n" #
    "- `nftRecord` — one row per minted NFT, in mint order, keyed by `tokenId`. Columns: " #
    "`tokenId`, `owner` (the recipient principal as text), `gameResult`, `endState`, " #
    "`recipientRole`, `recipientTeam`, `recipientUsername`, `recipientWalletAddress`, " #
    "`moveCount`, `concludedAt`, `gameNumber`, `spellId`, `spellName`, and `mintedAt`.\n" #
    "- `mintAttempt` — one row per mint attempt, keyed by `id`. Columns: `id`, `gameNumber`, " #
    "`recipientWalletAddress`, `recipientUsername`, `recipientTeam`, `recipientRole`, `outcome` " #
    "(`succeeded`/`skipped`/`failed`), and `attemptedAt`.\n" #
    "- `spell` — one row per spell in the spell table (a module constant, not stable state), " #
    "keyed by `id`. Columns: `id`, `name`, `meaning`, `spell`, `category`, `dropChance`, " #
    "`complexity`, `nftEligible`, `magicCategory` (`Necromancy`/`Conjuring`/`Elemental`/`Hex`, or " #
    "\"\" when unassigned), and `level` (`Basic`/`Skilled`/`Advanced`/`Mastery`/`OP`, or \"\" when " #
    "unassigned).\n" #
    "- `vote` — one row per player's vote for the next game's settings, keyed by `principal`. " #
    "Columns: `principal`, `startingPosition` (`Standard`/`Random`), `spellUse` " #
    "(`On`/`Off`), and `turnDuration` (`TwoMinutes`/`NinetySeconds`/`OneMinute`).\n" #
    "- `pbppInformation` — one row per time-stamped PBPP_Information entry, keyed by " #
    "`timestamp`. Columns: `timestamp` and `content`.\n" #
    "- `bet` — one row per recorded prediction bet, keyed by `id`. Columns: `id`, `pot`, " #
    "`prediction`, `playerPrincipal`, `displayUsername`, `anonymous`, and `timestamp`.\n" #
    "- `gameResult` — one row per authoritative game result recorded for settlement, keyed by " #
    "`id`. Columns: `id`, `result`, and `timestamp`.\n" #
    "- `guaranteedEntry` — one row per guaranteed-tier entry, keyed by the post-`_copy` roster " #
    "`username`. Columns: `username`, `walletAddress` (the entry's own recorded NFT wallet " #
    "address, or \"\" when none), and `betVerified` (true once a prediction bet for that " #
    "username was successfully placed). Entries are self-contained, so a departed bettor whose " #
    "player row was heartbeat-cleaned still appears. The set is cleared at the start of each new " #
    "game alongside the vote clearing, so rows reflect the current game's guaranteed set.\n" #
    "- `prizePlacement` — one row per archived placement in the parallel 10-place " #
    "Sunday-competition archive, keyed by the composite `placementKey` (`rank:principal`). " #
    "Columns: `placementKey`, `rank` (1-based), `principal` (the player's principal as text, " #
    "stored internally for future rewards), `displayName` (the name at the moment the " #
    "competition ended), `wins`, and `prizeE8s` (the stored prize for that exact rank, 0 when the " #
    "competition had no allocation). Only competitions with a confirmed prize allocation are " #
    "archived (see the archive gate), so a competition date without a prize pool has no rows " #
    "here. Newest last.\n" #
    "- `prizeAllocation` — one row per admin-allocated Sunday, keyed by `sunday` (the UTC " #
    "00:00:00 boundary in nanoseconds). Columns: `sunday`, `poolE8s` (the total pool the admin " #
    "loaded, fees included), `firstPrizeE8s`, and `rankPrizesE8s` (the ten rank prizes as a " #
    "comma-separated text list, rank 1 first). The player view never reads this entity; it reads " #
    "only the first prize through `getFirstPrizeForSunday`.\n" #
    "- `prizeClaim` — one row per archived placement's claim record, keyed by the composite " #
    "`claimKey` (`competition:rank`). Columns: `claimKey`, `competition` (the competition start " #
    "timestamp — the exact archive key), `rank` (1-based), `state` (`claimable`/`paying`/`paid`), " #
    "`recipient` (the locked ICP principal as text, or \"\" when none; stored internally and " #
    "exposed only to the platform controller), `amountE8s` (the exact stored prize in e8s), " #
    "`blockIndex` (the ledger block index as text when paid, or \"\"), and `manualCheck` (true " #
    "when the place is flagged for the admin). The recipient principal is never returned to the " #
    "frontend.\n" #
    "\n" #
    "### Game-end NFT minting (automatic, not a public method)\n" #
    "\n" #
    "At **every** game conclusion — checkmate (`triggerCelebration`), stalemate or " #
    "insufficient material (`triggerDraw`), and timeout (`checkTimerExpiry`) — the backend " #
    "automatically mints NFTs for the participating players. There is no public method to " #
    "trigger this and no manual re-mint endpoint; the mint is wired into the single " #
    "`mintGameNftsSafe` hook that all three conclusion paths call. The whole pass is wrapped " #
    "in try/catch, so a mint failure never blocks the game conclusion.\n" #
    "\n" #
    "**Eligibility.** Every player in the recorder's `playerList` snapshot is eligible " #
    "regardless of win or lose — there is no filtering by team outcome. A player is eligible " #
    "only when their wallet address is non-null and non-empty. Players with no wallet address " #
    "are never eligible and always get an explicit `#skipped(\"no wallet address supplied\")` " #
    "attempt recorded (there are no silent skips). Players whose heartbeat was stale at the " #
    "exact conclusion moment are excluded from the snapshot by the recorder's presence gate " #
    "and get an explicit `#skipped(\"stale heartbeat at game conclusion\")` attempt.\n" #
    "\n" #
    "**Guaranteed tier (additive, not capped).** A separate guaranteed set is keyed on the " #
    "post-`_copy` roster username. Each entry is self-contained: it carries its own NFT wallet " #
    "address and a verified-bet flag, so heartbeat cleanup of the player row cannot strip the " #
    "wallet address. An entry becomes bet-verified when that username successfully places a " #
    "prediction bet (rejected, cancelled, or failed bets write nothing), and its wallet address " #
    "is recorded when the player connects or updates their NFT wallet. At game end, **every** " #
    "guaranteed entry with a verified bet and a recorded, non-empty wallet receives an NFT, " #
    "read from the guaranteed entry rather than the player row — so a departed bettor whose " #
    "player row was heartbeat-cleaned still receives their guaranteed NFT. Guaranteed mints are " #
    "**additive and do not consume the 10-NFT cap**. Guaranteed players are excluded from the " #
    "capped pool below, preserving at most one NFT per wallet globally. The guaranteed set is " #
    "cleared at the start of each new game alongside the vote clearing.\n" #
    "\n" #
    "**Maximum of 10 NFTs per game (capped pool).** The per-game mint for players **not** in " #
    "the guaranteed set is capped at **10** NFTs (`maxMintsPerGame = 10`):\n" #
    "  - When **10 or fewer** such players are eligible, **every** eligible player is minted to " #
    "(one NFT each).\n" #
    "  - When **more than 10** are eligible, exactly **10 distinct recipients** are chosen by " #
    "the deterministic selection below.\n" #
    "\n" #
    "**Deterministic recipient selection (driven by the last digit of the game number).** " #
    "When more than 10 players are eligible, the recipients are chosen by a deterministic " #
    "walk over the eligible players in player-list order. Let `d` be the **last digit of the " #
    "game number**, with `0` treated as `10` (so `d` is always in 1..10):\n" #
    "  1. The **first** recipient is the eligible player at index `d - 1` (0-based) in the " #
    "eligible list.\n" #
    "  2. From there, step forward by `d` positions, wrapping modulo the number of eligible " #
    "players `N`, **skipping already-picked players**, until 10 distinct recipients have been " #
    "chosen.\n" #
    "  3. If the step-by-`d` orbit is exhausted before 10 are chosen (which happens when " #
    "`gcd(d, N) > 1`, so the orbit is a proper subset), the walk advances by one position " #
    "(wrapping) to the next unchosen player and resumes stepping by `d` from there. This " #
    "guarantees 10 distinct recipients whenever more than 10 players are eligible.\n" #
    "\n" #
    "The selection is pure and side-effect free, so the same game number and eligible list " #
    "always produce the same recipients. The chosen recipients are returned in selection " #
    "order.\n" #
    "\n" #
    "**Separate fixed-recipient mint.** In addition to the per-player mints above, the " #
    "backend mints one NFT to a hardcoded fixed recipient principal on **every** game " #
    "conclusion (win, draw, or timeout). This fixed-recipient mint is a separate, always-on " #
    "mint and is **not** part of the 10-per-game cap. It is internally wrapped in try/catch, " #
    "so a failed or skipped fixed-address mint never blocks the game result or the per-player " #
    "mints.\n" #
    "\n" #
    "**Per-recipient reward.** Each selected recipient gets a game-end spell reward rolled " #
    "from the NFT-eligible spell pool (the weighted roll determines which spell the player " #
    "receives), and the chosen spell's id and name are threaded into the NFT metadata so the " #
    "reward is a verifiable part of the minted artifact.\n" #
    "\n" #
    "### NFT mint status and retention\n" #
    "\n" #
    "- `getMintStatusForPlayer(walletAddress : Text) -> ?MintOutcome`\n" #
    "  Returns the most recent mint outcome recorded for the given wallet address text, or null " #
    "when no attempt has been recorded for it. Read-only query.\n" #
    "- `getMintStatusesForGame() -> [MintStatusEntry]`\n" #
    "  Returns every recorded mint attempt as `{ username; walletAddress; team; outcome }`, " #
    "including players with no wallet address (whose `walletAddress` is null). Read-only query.\n" #
    "- `getMintAttemptsByGame() -> [MintAttemptGroup]`\n" #
    "  Returns the retained mint attempts grouped by game, **most recent game first**. Each group " #
    "carries `gameNumber` and the attempts recorded for that game, in append order. Read-only " #
    "query, safe to poll.\n" #
    "- `clearNftMintAttempts() -> ()`\n" #
    "  Clears the entire retained mint-attempt log. This is an explicit manual reset; the " #
    "new-game start path no longer calls it. It does not clear minted NFTs or reset the token-id " #
    "counter.\n" #
    "\n" #
    "**Retention.** Mint attempts are retained **across games** rather than wiped when a new game " #
    "starts. The log is capped at the **10 most recent distinct game numbers**: after each append, " #
    "attempts whose `gameNumber` is older than the 10th-most-recent distinct game number present " #
    "are pruned automatically. Pruning is deterministic and bounded. Each attempt carries the " #
    "sequential `gameNumber` it belongs to (the grouping key), plus the player's username, team, " #
    "role, wallet address, outcome, and attempt timestamp.\n" #
    "\n" #
    "**Outcome reasons.** Every attempt records a distinguishable outcome:\n" #
    "  - `#succeeded({ tokenId })` — the NFT was minted; `tokenId` is the collection canister's " #
    "returned token id.\n" #
    "  - `#skipped(\"stale heartbeat at game conclusion\")` — the player's heartbeat was stale at " #
    "the exact conclusion moment, so they were excluded from the mint snapshot.\n" #
    "  - `#skipped(\"no wallet address supplied\")` — the player had no wallet address.\n" #
    "  - `#skipped(\"invalid wallet address\")` — the wallet address was empty at mint time.\n" #
    "  - `#failed(\"hex account IDs are not supported for minting; please use your principal " #
    "textual address\")` — the wallet address was a 64-char hex account ID, which cannot be " #
    "reversed to a principal.\n" #
    "  - `#failed(\"mint canister call trapped: <error message>\")` / `#failed(\"mint trapped\")` / " #
    "`#failed(\"wallet address parse failed\")` — the mint call errored or trapped. The " #
    "`mint canister call trapped` reason carries the real caught error message appended after " #
    "the prefix.\n" #
    "  - `#failed(\"mint pass failed\")` — the whole mint pass failed before per-player outcomes " #
    "could be recorded; this is recorded rather than silently swallowed.\n" #
    "\n" #
    "**Token id assignment.** The capped per-player tier mints through the collection canister's " #
    "batched `mint_auto_batch` entrypoint, passing two index-aligned vecs — the recipient accounts " #
    "and the per-recipient metadata vecs — in chunks of at most 50 recipients per call. The " #
    "additive guaranteed tier and the fixed-recipient mint still use the single `mint_auto` " #
    "entrypoint. Neither entrypoint takes a token id: the canister assigns each token id " #
    "internally from a monotonic counter that starts at **200**, only increases, and is never " #
    "affected by burns, so there is no token-id computation, no supply-derived candidate id, no " #
    "`icrc7_total_supply` query on the mint path, and no collision retry loop. `mint_auto_batch` " #
    "returns one receipt per input in the same order and does **not** roll back the whole call on " #
    "partial failure, so each receipt is checked individually and mapped back to its player by " #
    "index; a per-receipt `#Err` fails only that player. The returned `#Ok(tokenId)` is the " #
    "assigned id and is used to update the local NftRecord. Both entrypoints guarantee " #
    "collision-free ids internally, so there is no per-mint safety gate. The local next-token-id " #
    "counter is cache-only: it is never used as a requested id, is only advanced from confirmed " #
    "canister results, and is reconciled from the canister's actual supply on startup.\n" #
    "\n" #
    "## Authentication and authorization\n" #
    "\n" #
    "The backend installs the platform's Internet Identity / authorization extension " #
    "(`caffeineai-authorization`), which exposes the `_internet_identity_sign_in_start` / " #
    "`_internet_identity_sign_in_verify` method family the frontend Internet Identity client " #
    "calls, plus role-based access-control endpoints. The first authenticated caller to sign in " #
    "becomes admin; subsequent callers receive the default role. Anonymous principals are treated " #
    "as guests.\n" #
    "\n" #
    "The app's frontend pins an Internet Identity derivation origin, published at " #
    "`/.well-known/ii-derivation-origin` when available. An agent that already holds the user's " #
    "Internet Identity authorization derives the correct per-app principal against that origin " #
    "(for example `icp identity link web <name> --app <host>`). Such a delegation acts with the " #
    "user's full authority in this app until it expires.\n" #
    "\n" #
    "Registration is a prerequisite for role-guarded calls: a caller registers by signing in " #
    "through the app's own frontend, which invokes the `_internet_identity_*` sign-in family. A " #
    "principal that never signed in through the app's frontend is unregistered even when it " #
    "belongs to the app's owner, and a signed-in caller derived against a different origin is a " #
    "different principal than the one the frontend registered. Unregistered and anonymous callers " #
    "receive the guest role and are rejected by role-guarded endpoints.\n" #
    "\n" #
    "The game domains themselves do not use Internet Identity caller authentication; player " #
    "identity is carried as a `PseudoPrincipal` (a `Text` value stored in the frontend's " #
    "localStorage) and passed explicitly as a field. The Prediction Bet domain instead enforces an " #
    "**allowlist** on the mutating endpoints: the caller's `Principal` must equal the configured " #
    "`jalcaPrincipal`.\n" #
    "\n" #
    "**Ranked play** is the one game-domain feature that uses Internet Identity caller " #
    "authentication. `loginRanked` is a `shared ({ caller })` method: it requires a signed " #
    "(non-anonymous) caller and binds that caller's principal to the supplied roster key. The " #
    "guest `login` method traps when the supplied key is already bound, so a guest cannot take " #
    "over a ranked slot. The two ranking queries (`getWinnerRanking`, `getMyWins`) are open to " #
    "everyone; `isMe` is always false for an anonymous caller and `getMyWins` returns zeros for " #
    "an anonymous caller.\n" #
    "\n" #
    "- `submitBet` and `recordGameResult` are `shared ({ caller })` methods that " #
    "trap unless `caller` equals `betStore.jalcaPrincipal`. The trap messages are:\n" #
    "  - `submitBet`: \"Only the configured JALCA canister principal may submit bets\"\n" #
    "  - `recordGameResult`: \"Only the configured JALCA canister principal may record game results\"\n" #
    "- `getBets`, `getResults`, `setPbppCanisterPrincipal`, `setJalcaPrincipal`, " #
    "`appendPbppInformation`, and `getPbppInformation` perform no caller check and are callable by " #
    "any principal.\n" #
    "- The Real Bet domain methods (`placeBet`, `checkAllowance`, `startGame`, `reportOutcome`, " #
    "`getRealBets`, `getSettlements`) perform no caller allowlist check. The cross-canister calls to " #
    "the escrow's `place_bet`, `start_game`, and `report_outcome` originate from JALCA's own backend " #
    "principal (`py4x3-piaaa-aaaai-ax2ya-cai`): an outbound inter-canister call always carries the " #
    "calling canister's principal as caller to the target, so the calls are never made from the " #
    "user's browser session principal. The escrow authenticates that caller and is the authoritative " #
    "gate at `icrc2_transfer_from`; JALCA's `checkAllowance` is a convenience and the " #
    "`approval_confirmed` flag is never trusted as the security gate. The automatic `start_game` " #
    "call on game start and the automatic `report_outcome` call on game conclusion likewise " #
    "originate from JALCA's own backend principal, which is what the escrow's allowlist " #
    "authenticates (any other caller would receive `#err #Unauthorized`).\n" #
    "- The Kick domain methods (`castKickVote`, `withdrawKickVote`) take the caller's `PseudoPrincipal` " #
    "explicitly (no Internet Identity caller authentication). `castKickVote` enforces that the caller " #
    "is a logged-in player with a connected wallet (`walletAddress != null`) and is on the same team " #
    "as the target; otherwise it returns `#err` (it does not trap). `withdrawKickVote` requires the " #
    "caller to be a logged-in player with an existing vote against the target. `getKickState` is a " #
    "read-only query with no caller check. Kicks are tied to player identity/wallet, never team " #
    "color, so a kick never affects a player's prediction bet placed before the game started.\n" #
    "- The spender-approval methods (`getApprovalState`, `fireApproval`, " #
    "`setApprovalGranted`, `recordConsentError`) take the player's `PseudoPrincipal` explicitly " #
    "(no Internet Identity caller authentication) and perform no caller allowlist check. The " #
    "ICRC-37 spender-approval inter-canister attempt is disabled: `fireApproval` performs no " #
    "inter-canister call and always returns `#err`. The burn does not depend on any approval — " #
    "the backend burns directly as itself through the collection canister's allowlisted-admin " #
    "path, and the collection canister is the authoritative gate at burn time.\n" #
    "- The shield-and-spell-resolution methods (`burnAndPlay`, `getShieldState`, " #
    "`getShieldResolutionSnapshot`) take the caller's `PseudoPrincipal` explicitly (no Internet " #
    "Identity caller authentication). `burnAndPlay` enforces the burn restrictions server-side " #
    "against the live game state: the caller must be the current Move_Maker, the burn must not " #
    "already be recorded this turn, and the opening Move_Maker may burn only a Subao Ve. It " #
    "returns `#err Text` (it does not trap) when a restriction is violated. The burn itself is " #
    "performed by the backend as itself through the collection canister's allowlisted-admin " #
    "path, exactly like `burnNfts` / `burnNft`; no player signature or wallet mediation is " #
    "involved. `getShieldState` and `getShieldResolutionSnapshot` are read-only queries with no " #
    "caller check.\n" #
    "- The Story domain write methods (`appendStorySection`, `fillStoryGap`, and the legacy " #
    "`writeStory`) are `shared ({ caller })` methods gated to the hardcoded sole writer; any " #
    "other caller traps. The voting methods (`pressStoryDelete`, `pressStoryKeep`) are open to " #
    "any caller, including anonymous. `getStorySections` and `getStoryAuthor` are read-only " #
    "queries with no caller check. The legacy `claimStoryAuthorship` rejects the anonymous " #
    "principal and any principal other than the already-recorded author (both trap).\n" #
    "- The OQL `schema` and `execute` methods enforce per-entity authorization. Every exposed entity " #
    "is declared `.controllerOnly()`, so only the platform controller can read rows; end users " #
    "cannot query them directly.\n" #
    "- The prize reads (`getCurrentPrizePool`, `getArchivedPrizePool`, `getClaimStatus`, " #
    "`getFirstPrizeForSunday`) perform no caller check and are callable by any principal. " #
    "`getMyPrize` is a `shared ({ caller })` method that **traps** for the anonymous principal; " #
    "it returns only the caller's own claimable prize and never returns principals. `claimPrize` " #
    "is a `shared ({ caller })` method that **traps** for the anonymous principal and requires " #
    "the caller to own the archived place; it returns only the caller's own claim result and " #
    "never returns another player's principal. The " #
    "admin-only methods (`getAdminPrizeOverview`, `getUpcomingAllocationStatuses`, " #
    "`previewPrizeAllocation`, `savePrizeAllocation`, `clearPrizeAllocation`, " #
    "`getAdminPrizeClaims`, `getAdminAllocatedCompetitionDates`, `getAdminCompetitionDetail`, " #
    "`setPrizeCanisterPrincipal`, `getPrizeCanisterBalances`) are " #
    "`shared ({ caller })` methods gated to the hardcoded compile-time admin principal: any " #
    "other caller, including the anonymous principal, **traps**. The admin principal is fixed at " #
    "compile time with no setter and no runtime change.\n" #
    "\n" #
    "Because `jalcaPrincipal` defaults to a placeholder principal (`aaaaa-aa`) until set via " #
    "`setJalcaPrincipal`, the allowlisted methods (`submitBet`, `recordGameResult`) trap for every " #
    "caller until an admin configures the real JALCA canister principal.\n" #
    "\n" #
    "## Units and encodings\n" #
    "\n" #
    "- **Timestamps** are nanoseconds since the Unix epoch (`mo:core/Time`), encoded as `Int` for " #
    "`Timestamp` fields and as `Nat` for `start_time` / `end_time` / `placed_at` / `settled_at` in " #
    "the escrow messages.\n" #
    "- **Pot** is a variant: `#One` (1 ICP), `#Ten` (10 ICP), `#Hundred` (100 ICP), `#Thousand` " #
    "(1000 ICP).\n" #
    "- **Prediction / GameResult** is a variant: `#White`, `#Black`, or `#Draw`.\n" #
    "- **PseudoPrincipal** is a `Text` value (the frontend's localStorage player key).\n" #
    "- **GameOutcome** is the escrow's outcome variant: `#white`, `#black`, or `#draw` (lowercase, " #
    "matching the escrow's published Candid).\n" #
    "- **EscrowError** is the single error variant returned by every escrow service method:\n" #
    "  - `#Unauthorized` — the caller is not the allowlisted JALCA principal.\n" #
    "  - `#NoApproval` — the player has not approved the escrow canister as spender.\n" #
    "  - `#InsufficientAllowance` — the player's approval is below the required amount " #
    "(bet + 10_000 e8s fee).\n" #
    "  - `#TransferFailed : text` — the ICRC-2 pull failed; carries the underlying failure message.\n" #
    "  - `#InvalidTier` — the requested pot tier is not one of the supported tiers.\n" #
    "  - `#NoActiveGame` — no game is currently in progress for the given `game_id`.\n" #
    "- **PlaceBetArgs** is a 7-field record: `player : Principal`, `username : Text`, " #
    "`anonymous : Bool`, `pot_tier : Nat`, `amount_e8s : Nat`, `outcome : GameOutcome`, " #
    "`wallet_address : Text`.\n" #
    "- **StartGameArgs** is a 2-field record: `game_id : Text`, `start_time : Nat`.\n" #
    "- **ReportOutcomeArgs** is a 3-field record: `game_id : Text`, `result : GameOutcome`, " #
    "`end_time : Nat`.\n" #
    "- **Real Bet amounts** are in e8s (1 ICP = 100_000_000 e8s). `amount_e8s` is the bet only; " #
    "`pot_tier` is a `Nat` (1/10/100/1000 ICP).\n" #
    "- **Account** is `{ owner : Principal; subaccount : ?Blob }`. The allowance check uses " #
    "account = `{ owner = player; subaccount = null }` and spender = the escrow canister principal " #
    "with `subaccount = null`.\n" #
    "\n" #
    "## ICRC-2 approval flow\n" #
    "\n" #
    "Before a player can place a real bet, the player must approve the escrow canister " #
    "(`oqybv-uyaaa-aaaac-bf5oq-cai`) as spender on the ICP ledger " #
    "(`ryjl3-tyaaa-aaaaa-aaaba-cai`) via ICRC-2 `icrc2_approve`. The approval is made with " #
    "`spender = { owner = oqybv-uyaaa-aaaac-bf5oq-cai; subaccount = null }` and must cover " #
    "**the bet amount plus a 10_000 e8s fee** (bet + 10_000 e8s). The `amount_e8s` field of " #
    "`PlaceBetArgs` is the bet only — it does not include the fee. When the escrow processes " #
    "`place_bet` it pulls the stake with `icrc2_transfer_from`; if the player has not approved " #
    "the escrow it returns `#err #NoApproval`, and if the approved allowance is below the " #
    "required amount it returns `#err #InsufficientAllowance`. The frontend can call " #
    "`checkAllowance(player)` to read the current allowance and show immediate feedback before " #
    "submitting a bet, but the escrow remains the authoritative gate.\n" #
    "\n" #
    "## game_id lifecycle\n" #
    "\n" #
    "`game_id` is a JALCA-generated match UUID (a `Text` value). JALCA passes it in " #
    "`start_game` (`StartGameArgs.game_id`) to lock the accumulated bets for that game, and " #
    "reuses the same `game_id` in `report_outcome` (`ReportOutcomeArgs.game_id`) to trigger " #
    "payout resolution. The escrow returns `#err #NoActiveGame` when a `report_outcome` (or " #
    "other game-scoped call) references a `game_id` for which no game is currently in " #
    "progress. Locally recorded real bets and settlements carry the `game_id` so the " #
    "frontend and the OQL `realBet` / `settlement` entities can correlate bets with the " #
    "game they belong to.\n" #
    "\n" #
    "## Lifecycle and polling\n" #
    "\n" #
    "- Bets and results are append-only: each `submitBet` / `recordGameResult` adds a new record " #
    "with a monotonic id and never overwrites prior records. `getBets` / `getResults` return the " #
    "full history in order.\n" #
    "- PBPP_Information is append-only: each `appendPbppInformation` adds a new time-stamped entry; " #
    "prior entries are never overwritten. `getPbppInformation` returns the full history in append " #
    "order.\n" #
    "- Real bets and settlements are append-only: each successful `placeBet` / `reportOutcome` adds " #
    "a new locally recorded record with a monotonic id and never overwrites prior records. " #
    "`getRealBets` / `getSettlements` return the full history in order.\n" #
    "- Kick votes are scoped to the current game: they are erased at the end of every game, so " #
    "`getKickState` and the `kickVote` OQL entity always reflect the live votes of the game in " #
    "progress. There is no kick history or audit log across games, and no cooldown or vote-expiry " #
    "timing — a vote persists until it is withdrawn, its kicker leaves (outgoing votes removed), or " #
    "the game ends. Poll `getKickState` to render the live kick count and 'kicked by' columns; it is " #
    "a read-only query and safe to poll.\n" #
    "- The shield is scoped to the current game: it resets to zero for both teams at the start of " #
    "every new game and never carries over. The pending burn-and-play result is scoped to the " #
    "current turn: it is cleared when a new turn begins, so `getShieldResolutionSnapshot` and the " #
    "`burnAndPlayResult` OQL entity never carry a result into the next turn. Poll " #
    "`getShieldResolutionSnapshot` to render the burn-and-play toast; it is a read-only query and " #
    "safe to poll. There is no shield or spell-resolution history log across turns or games.\n" #
    "\n" #
    "## Mutation retry safety, idempotency, and destructive effects\n" #
    "\n" #
    "- `submitBet` and `recordGameResult` are **not idempotent**: each call appends a new record " #
    "with a fresh monotonic id. Re-sending the same submission creates a duplicate bet/result. " #
    "Callers must deduplicate at the application layer (for example by tracking `test_id` or " #
    "submission ids).\n" #
    "- `appendPbppInformation` is **not idempotent**: each call appends a new entry. Re-sending the " #
    "same content creates a duplicate entry.\n" #
    "- `setPbppCanisterPrincipal` and `setJalcaPrincipal` are idempotent overwrites of a single " #
    "value; re-calling with the same value is harmless.\n" #
    "- `placeBet` and `reportOutcome` are **not idempotent**: each successful call relays to the " #
    "escrow and records a new local bet/settlement. Re-sending the same bet creates a duplicate. " #
    "Callers must deduplicate at the application layer (for example by tracking the returned " #
    "ICRC Ledger block index / `game_id`).\n" #
    "- `checkAllowance` is a read-only convenience query and has no side effects.\n" #
    "- `castKickVote` is **idempotent**: votes are unique per (target, kicker) pair, so re-casting " #
    "for the same pair is a no-op (the vote already exists). `withdrawKickVote` is also idempotent " #
    "in effect — removing a vote that does not exist is a no-op — though it returns `#err` if the " #
    "caller has no vote against the target. Re-sending either call is safe and does not duplicate " #
    "votes.\n" #
    "- `fireApproval` is **disabled**: it performs no inter-canister call and always returns " #
    "`#err`, so re-sending it is harmless. `setApprovalGranted` is an idempotent overwrite of " #
    "the local mirror; re-calling with the same value is harmless. `recordConsentError` " #
    "overwrites the stored consent error text and is idempotent.\n" #
    "- `burnNfts` / `burnNft` are **not idempotent**: each call destroys the requested tokens " #
    "on the collection canister. Re-sending a burn for an already-burned token fails for that " #
    "token (the token no longer exists) and is reported as `#failed`; it does not resurrect or " #
    "duplicate anything. Callers must not retry a burn whose outcome they did not observe " #
    "without first re-reading ownership.\n" #
    "- `burnAndPlay` is **not idempotent**: it performs a real burn and records the burn-and-play " #
    "result. Re-sending it for the same turn is rejected with `#err` because the burn is already " #
    "recorded this turn (the one-burn-per-turn rule), so a retry after an unobserved outcome does " #
    "not double-burn. The burn itself is destructive: the token is destroyed on the collection " #
    "canister and cannot be recovered.\n" #
    "- None of these methods delete or overwrite existing records.\n" #
    "- `loginRanked` is **idempotent for the same caller and key**: re-calling it with a key " #
    "already bound to the same caller re-runs the login path and refreshes the stored display " #
    "name, but does not create a second binding. It is **not** idempotent across callers: a key " #
    "bound to one principal can never be re-bound to another (the call traps). The guest `login` " #
    "is **not idempotent** in the sense that it re-runs the roster/team logic, but it is safe to " #
    "retry: a re-login for an existing principal updates the existing player row rather than " #
    "appending a duplicate.\n" #
    "\n" #
    "## Errors, traps, limits, and gotchas\n" #
    "\n" #
    "- The allowlisted methods (`submitBet`, `recordGameResult`) **trap** " #
    "(reject the message) when the caller is not the configured `jalcaPrincipal`. A trap rolls back " #
    "the whole message and surfaces as an opaque reject; callers cannot branch on it.\n" #
    "- The escrow cross-canister method names are `place_bet`, `start_game`, and `report_outcome` " #
    "(underscore), matching the escrow's authoritative interface. A wrong name fails with " #
    "method-not-found.\n" #
    "- Every escrow service method returns the single `EscrowError` variant. `placeBet` surfaces it " #
    "verbatim as `#err EscrowError`: `#Unauthorized` (the caller is not the allowlisted JALCA " #
    "principal), `#NoApproval` (the player has not approved the escrow as spender), " #
    "`#InsufficientAllowance` (the approved allowance is below bet + 10_000 e8s), " #
    "`#TransferFailed(text)` (the ICRC-2 pull failed, carrying the underlying message), " #
    "`#InvalidTier` (the requested pot tier is not supported), and `#NoActiveGame` (no game is in " #
    "progress for the given `game_id`). If the cross-canister call itself rejects or traps, JALCA " #
    "maps it to `#err #TransferFailed(\"escrow place_bet call failed\")`.\n" #
    "- `startGame` returns `#ok` (unit) on success or `#err EscrowError`. If the cross-canister call " #
    "itself rejects or traps, JALCA maps it to `#err #TransferFailed(\"escrow start_game call " #
    "failed\")`.\n" #
    "- `reportOutcome` returns `#ok` (unit) on success or `#err EscrowError`. If the cross-canister " #
    "call itself rejects or traps, JALCA maps it to `#err #TransferFailed(\"escrow report_outcome " #
    "call failed\")`.\n" #
    "- The automatic `start_game` call on game start and the automatic `report_outcome` call on game " #
    "conclusion are wrapped in try/catch and never block or alter the game start or conclusion; " #
    "their results are handled for accountability only.\n" #
    "- `checkAllowance` queries the live ICP ledger; it may reject if the ledger is unreachable or " #
    "the account/spender form is invalid.\n" #
    "- The Kick methods do **not** trap on caller error; they return `#err` with a human-readable " #
    "message the frontend can branch on. `castKickVote` returns `#err` when the caller is not a " #
    "logged-in player, has no connected wallet, the target is not a logged-in player, or the caller " #
    "is not on the target's team. `withdrawKickVote` returns `#err` when the caller is not a " #
    "logged-in player or has no vote against the target. Kicks are tied to player identity/wallet, " #
    "never team color, so a kick never affects a player's prediction bet placed before the game " #
    "started.\n" #
    "- `fireApproval` is **disabled** and does not trap: it performs no inter-canister call and " #
    "always returns `#err` with the message that ICRC-37 spender approval is disabled and burns " #
    "are backend-authorized. `getApprovalState` and `setApprovalGranted` return " #
    "`#err` when the player has no recorded state rather than trapping.\n" #
    "- `burnAndPlay` does **not** trap on caller error; it returns `#err Text` with a " #
    "human-readable reason the frontend can branch on: the caller is not the current Move_Maker, " #
    "the burn is already recorded this turn, the opening Move_Maker holds no Subao Ve, or the " #
    "spell name is missing. A legacy NFT (no game number) is not an error: it burns inert and is " #
    "reported as `#legacy` with `firesOnBoard = false`. A spell whose value is neither strictly " #
    "greater than the defending shield nor at least double it is not an error either: it is " #
    "reported as `#cancelled` with the shield reduced (floored at zero) and no board effect. A " #
    "spell value strictly greater than the shield, or at least double the shield, fires on the " #
    "board.\n" #
    "- The OQL entities are controller-only: the Data Intelligence agent (acting as the controller) " #
    "can read them, but end users cannot. `schema()` and `execute()` reflect only the entities " #
    "registered in the `Expose` mixin.\n" #
    "- `loginRanked` **traps** (rejects the message) on caller error rather than returning an " #
    "error variant: the anonymous principal, an invalid roster key (empty or longer than 128 " #
    "characters), a key bound to a different caller, or a key on the roster but unbound. The " #
    "guest `login` **traps** when the supplied key is bound to an Internet Identity principal. " #
    "A trap rolls back the whole message and surfaces as an opaque reject; callers cannot branch " #
    "on it. The two ranking queries never trap and are safe to poll.\n"
  };
};
