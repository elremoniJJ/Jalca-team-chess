import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

let pic: PocketIc | undefined;
let actor: _SERVICE;

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
  ({ actor } = await pic.setupCanister<_SERVICE>({ idlFactory, wasm: BACKEND_WASM }));
});

afterAll(async () => {
  await pic?.tearDown();
});

it("answers empty-state reads instead of trapping", async () => {
  // A fresh canister has no game yet — every read path must resolve with an
  // empty/neutral value rather than trapping on uninitialized state.
  const state = await actor.getGameState("player-1");
  expect(state.players).toEqual([]);
  expect(state.board).toHaveLength(64);

  // A fresh canister is already on its first game (game number 1).
  await expect(actor.getGameNumber()).resolves.toBe(1n);
  await expect(actor.getExerciseAssignments()).resolves.toEqual([]);
  await expect(actor.getDrinkingAssignments()).resolves.toEqual([]);

  // The NFT spell-name read path (used by the EndGameModal) must not trap on
  // a fresh canister: no NFT has been minted for game 1 / this wallet, so
  // it resolves to the absent optional ([]) rather than throwing.
  await expect(actor.getSpellNameForGame(1n, "aaaaa-aa")).resolves.toEqual(
    [],
  );
});

it("round-trips a login through the real canister", async () => {
  const result = await actor.login(
    "player-1",
    "Ada",
    [],
    { none: null },
  );
  expect(result.principal).toBe("player-1");
  expect(result.username).toBe("Ada");

  // The logged-in player appears in the game state roster.
  const state = await actor.getGameState("player-1");
  expect(state.players).toContainEqual(
    expect.objectContaining({ principal: "player-1", username: "Ada" }),
  );
});

it("stores the Oisy wallet address on the player's backend user record", async () => {
  // A fresh player logs in with no wallet.
  await actor.login("player-2", "Bob", [], { none: null });

  // The Oisy connection captures the owner principal and stores it with the
  // #oisy source on the player's backend user record.
  await actor.updateWalletAddress("player-2", ["owner-principal-abc"], { oisy: null });

  const state = await actor.getGameState("player-2");
  const bob = state.players.find((p) => p.principal === "player-2");
  expect(bob).toBeDefined();
  expect(bob?.walletAddress).toEqual(["owner-principal-abc"]);
  expect(bob?.walletSource).toEqual({ oisy: null });
});

it("allows the first Move_Maker to burn a Subao Ve spell on the first turn", async () => {
  // Two players log in to start a game (one per team for balance). The first
  // login leaves the lobby paused (unbalanced); the second login starts the
  // game and assigns a Move_Maker for White.
  await actor.login("player-1", "Ada", [], { none: null });
  await actor.login("player-2", "Bob", [], { none: null });

  // The game has started and a Move_Maker has been assigned.
  const state = await actor.getGameState("player-1");
  const moveMaker = state.moveMaker;
  expect(moveMaker.length).toBe(1);
  const maker = moveMaker[0];

  // The first Move_Maker may burn a Subao Ve spell on the first turn (the
  // backend's first-turn no-burn rule is relaxed for Subao Ve).
  const result = await actor.recordBurn(maker, {
    spellName: "Subao Ve",
    gameNumber: 1n,
    category: { SubaoVe: null },
  });
  expect(result).toHaveProperty("ok");

  // The burn is recorded in the Move_Maker's team window under Subao Ve, and
  // the one-burn-per-turn flag is set.
  const burnState = await actor.getBurnState();
  expect(burnState.burnOccurredThisTurn).toBe(true);
  const whiteWindow = burnState.whiteWindow;
  const blackWindow = burnState.blackWindow;
  const subaoVeSpells = [...whiteWindow.subaoVeSpells, ...blackWindow.subaoVeSpells];
  expect(subaoVeSpells).toContainEqual(
    expect.objectContaining({ spellName: "Subao Ve", gameNumber: 1n }),
  );
});

it("answers the backend burn method without trapping when the collection is unreachable", async () => {
  // burnNft is the new public burn entrypoint the frontend calls. It reads the
  // token metadata and then calls the external ICRC-7 collection canister's
  // icrc7_burn. That collection canister (23quc-cyaaa-aaaac-bfvia-cai) does not
  // exist in this replica, so both inter-canister calls reject. The try/catch
  // must map the rejected burn to the #failed variant rather than trapping
  // JALCA's canister — a trap here would surface to the user as an unhandled
  // error instead of a per-token burn failure.
  const outcome = await actor.burnNft(1n);
  expect(outcome).toEqual({ failed: "burn canister call trapped" });
});

it("round-trips the collection-level approval state through the real canister", async () => {
  // A fresh player has no recorded approval state, so the read resolves to the
  // #err variant rather than trapping on uninitialized state.
  await expect(actor.getApprovalState("approval-player")).resolves.toEqual({
    err: "No approval state recorded for this player",
  });

  // Granting the approval writes the local mirror and returns the granted
  // state, naming the collection and JALCA's spender principal.
  const granted = await actor.setApprovalGranted("approval-player", true);
  expect(granted).toEqual({
    ok: expect.objectContaining({
      player: "approval-player",
      collection: "23quc-cyaaa-aaaac-bfvia-cai",
      spender: "py4x3-piaaa-aaaai-ax2ya-cai",
      granted: true,
    }),
  });

  // The authoritative read reflects the grant — this is the state the frontend
  // toggle derives its ON position from.
  const read = await actor.getApprovalState("approval-player");
  expect(read).toEqual({
    ok: expect.objectContaining({ granted: true }),
  });

  // Revoking is local only: the mirror flips back to ungranted with no wallet
  // call, and the read reflects it.
  const revoked = await actor.setApprovalGranted("approval-player", false);
  expect(revoked).toEqual({
    ok: expect.objectContaining({ granted: false, grantedAt: 0n }),
  });
  await expect(actor.getApprovalState("approval-player")).resolves.toEqual({
    ok: expect.objectContaining({ granted: false }),
  });
});

it("persists the exact icrc21 consent error text for a player", async () => {
  // recordConsentError returns unit; PocketIC decodes a zero-value reply to
  // null, so await the call and assert on the later read rather than on the
  // return value.
  await actor.recordConsentError(
    "consent-player",
    "icrc21 consent error: ConsentMessageUnavailable",
  );

  const read = await actor.getApprovalState("consent-player");
  expect(read).toEqual({
    ok: expect.objectContaining({
      granted: false,
      lastConsentError: ["icrc21 consent error: ConsentMessageUnavailable"],
    }),
  });
});

it("returns the disabled #err from fireApproval without an inter-canister attempt", async () => {
  // The ICRC-37 spender-approval inter-canister attempt has been removed: the
  // burn no longer requires a spender approval because the backend burns
  // directly as itself through the allowlisted-admin path. fireApproval is
  // retained only so the public method surface is unchanged; it performs NO
  // inter-canister call and always returns #err. If it still attempted the
  // (unreachable) collection call, this would resolve to #consentError
  // instead — so the #err variant is the observable proof the dead path is
  // disabled.
  const result = await actor.fireApproval("fire-player");
  expect(result).toEqual({
    err: "ICRC-37 spender approval is disabled; burns are backend-authorized and require no approval",
  });

  // The disabled endpoint must not write any approval state: the player still
  // has no recorded state, so the read resolves to #err rather than a granted
  // mirror.
  await expect(actor.getApprovalState("fire-player")).resolves.toEqual({
    err: "No approval state recorded for this player",
  });
});

it("answers the batched NFT metadata read instead of trapping", async () => {
  // The batched metadata read is the single call the wallet grid uses to load
  // every owned token's metadata in one response. On a fresh canister no token
  // has been minted into the local cache, so every entry is the absent
  // optional ([]) — but the call must resolve with one positionally-aligned
  // entry per requested id rather than trapping.
  const batch = await actor.getNftMetadataBatch([1n, 2n, 3n]);
  expect(batch).toEqual([[], [], []]);

  // An empty request is a valid no-op that returns an empty response.
  await expect(actor.getNftMetadataBatch([])).resolves.toEqual([]);

  // The existing per-token query stays unchanged and still resolves to the
  // absent optional for an unknown token.
  await expect(actor.getNftMetadata(1n)).resolves.toEqual([]);
});

it("answers empty-state real-bet reads instead of trapping", async () => {
  // A fresh canister has no relayed real bets and no settlements yet. Both
  // read paths must resolve with an empty array rather than trapping on
  // uninitialized state.
  await expect(actor.getRealBets()).resolves.toEqual([]);
  await expect(actor.getSettlements()).resolves.toEqual([]);
});

it("relays a real bet to JEL without trapping when JEL is unreachable", async () => {
  // placeBet takes the single record-shaped PlaceBetArgs (matching the escrow's
  // Candid signature) and makes a cross-canister call to JEL's live canister
  // (oqybv-uyaaa-aaaac-bf5oq-cai), which does not exist in this replica. The
  // try/catch must map the rejected call to #err(#TransferFailed(text)) rather
  // than trapping JALCA's canister. The call originates from JALCA's own
  // backend principal (an outbound inter-canister call carries the calling
  // canister's principal as caller to the target).
  const player = createIdentity("real-bet-player").getPrincipal();
  const result = await actor.placeBet({
    username: "Ada",
    player,
    wallet_address: "owner-principal-abc",
    pot_tier: 1n,
    anonymous: false,
    amount_e8s: 100_000_000n,
    outcome: { white: null },
  });
  expect(result).toEqual({
    err: { TransferFailed: "escrow place_bet call failed" },
  });
});

it("reports a game outcome to JEL without trapping when JEL is unreachable", async () => {
  // reportOutcome takes the single record-shaped ReportOutcomeArgs (game_id +
  // result + end_time) and makes a cross-canister call to JEL's live canister,
  // which does not exist in this replica. The try/catch must map the rejected
  // call to #err(#TransferFailed(text)) rather than trapping JALCA's canister.
  const result = await actor.reportOutcome({
    result: { black: null },
    end_time: 1_700_000_000_000_000_000n,
    game_id: "lane-game-1",
  });
  expect(result).toEqual({
    err: { TransferFailed: "escrow report_outcome call failed" },
  });
});

it("rejects a kick vote from a player without a connected wallet", async () => {
  // Two players log in (one per team). Neither has a wallet yet.
  await actor.login("player-1", "Ada", [], { none: null });
  await actor.login("player-2", "Bob", [], { none: null });

  // A wallet-less player cannot cast a kick vote — the wallet check runs
  // before any team check.
  const result = await actor.castKickVote("player-1", "player-2");
  expect(result).toEqual({
    err: "castKickVote: you need a connected wallet to kick",
  });
});

it("rejects a kick vote against a player on the opposing team", async () => {
  // Two players log in with wallets; the first fills White, the second Black.
  await actor.login("player-1", "Ada", ["wallet-1"], { oisy: null });
  await actor.login("player-2", "Bob", ["wallet-2"], { oisy: null });

  // A wallet-connected player can only kick a teammate, not an opponent.
  const result = await actor.castKickVote("player-1", "player-2");
  expect(result).toEqual({
    err: "castKickVote: you can only kick a teammate",
  });
});

it("records and withdraws a kick vote between teammates", async () => {
  // Three players log in with wallets. The first two fill White and Black;
  // the third is assigned to a weighted-random team, guaranteeing at least
  // one pair of teammates.
  await actor.login("player-1", "Ada", ["wallet-1"], { oisy: null });
  await actor.login("player-2", "Bob", ["wallet-2"], { oisy: null });
  await actor.login("player-3", "Cara", ["wallet-3"], { oisy: null });

  const state = await actor.getGameState("player-1");
  const white = state.players.filter((p) => "White" in p.team);
  const black = state.players.filter((p) => "Black" in p.team);
  const team = white.length >= 2 ? white : black;
  const kicker = team[0];
  const target = team[1];

  // Cast a kick vote from one teammate against the other. A single vote is
  // never a strict majority of a 2- or 3-player team, so no kick fires.
  const cast = await actor.castKickVote(kicker.principal, target.principal);
  expect(cast).toEqual({ ok: null });

  // getKickState reflects the vote: count 1, 'kicked by' contains the kicker.
  const kickState = await actor.getKickState();
  const targetState = kickState.players.find(
    (p) => p.principal === target.principal,
  );
  expect(targetState?.kickCount).toBe(1n);
  expect(targetState?.kickedBy).toContain(kicker.username);

  // Withdrawing the vote drops the count back to zero.
  const withdraw = await actor.withdrawKickVote(
    kicker.principal,
    target.principal,
  );
  expect(withdraw).toEqual({ ok: null });
  const after = await actor.getKickState();
  const targetAfter = after.players.find(
    (p) => p.principal === target.principal,
  );
  expect(targetAfter?.kickCount).toBe(0n);
  expect(targetAfter?.kickedBy).toEqual([]);
});

it("rejects withdrawing a kick vote that was never cast", async () => {
  // Two players log in with wallets (one per team).
  await actor.login("player-1", "Ada", ["wallet-1"], { oisy: null });
  await actor.login("player-2", "Bob", ["wallet-2"], { oisy: null });

  // Withdrawing a vote that was never cast returns an error, not a trap.
  const result = await actor.withdrawKickVote("player-1", "player-2");
  expect(result).toEqual({
    err: "withdrawKickVote: you have no vote against this player",
  });
});

it("starts a new game even when JEL's start_game is unreachable", async () => {
  // When a new game starts, JALCA's backend calls JEL's `start_game` (a no-arg
  // update call) from JALCA's own backend principal, wired into the
  // startNewGame chokepoint. JEL's live canister does not exist in this
  // replica, so the cross-canister call rejects; RealBet.startGame maps that
  // to a safe local outcome (#err #gameAlreadyInProgress) and the game start
  // must NOT be blocked. Two fresh players logging in triggers startNewGame.
  await actor.login("player-1", "Ada", [], { none: null });
  await actor.login("player-2", "Bob", [], { none: null });

  // The game actually started (phase #Playing) despite the unreachable
  // start_game call — proving the safe-local-outcome mapping never blocks the
  // game start.
  const state = await actor.getGameState("player-1");
  expect(state.phase).toEqual({ Playing: null });
  expect(state.moveMaker.length).toBe(1);
});
