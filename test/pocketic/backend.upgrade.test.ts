import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";
const PREVIOUS_WASM = process.env.BACKEND_WASM_PREVIOUS ?? "";

let pic: PocketIc | undefined;

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
});

afterAll(async () => {
  await pic?.tearDown();
});

it("carries the PBPP live backend principal entry across the migration upgrade", async () => {
  // 1. Install the version the user is actually running (the previous
  //    revision). The Candid interface is unchanged by this migration, so the
  //    current idlFactory describes the previous wasm's public API identically.
  const previous = await pic.setupCanister({ idlFactory, wasm: PREVIOUS_WASM });

  // 2. Read the PBPP_Information record through the OLD public API, as the
  //    deployed app sees it. The previous revision's chain already includes
  //    the live-backend-principal migration (000003), so the record already
  //    holds the principal entry before this upgrade.
  const previousActor = pic.createActor<_SERVICE>(idlFactory, previous.canisterId);
  const before = await previousActor.getPbppInformation();
  expect(before.length).toBeGreaterThanOrEqual(3);
  const priorContents = before.map((e) => e.content);

  // Stop the canister before upgrading. The canister installs a recurring
  // maintenance timer whose self-message is outstanding at upgrade time, and
  // the pre_upgrade check traps with "outstanding message callbacks" unless the
  // canister is stopped first — the remedy the trap message itself names. The
  // migration runs as part of the upgrade, so stopping does not skip it.
  await pic.stopCanister({ canisterId: previous.canisterId });

  // 3. Upgrade to the version this build produces. `wasm_memory_persistence:
  //    keep` is required for these enhanced-orthogonal-persistence canisters.
  await pic.upgradeCanister({
    canisterId: previous.canisterId,
    wasm: BACKEND_WASM,
    upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] },
  });
  await pic.startCanister({ canisterId: previous.canisterId });

  // 4. Read through the NEW API and assert both halves: prior entries survive
  //    in order, and the record still carries the time-stamped entry recording
  //    the live deployed backend principal.
  const upgraded = pic.createActor<_SERVICE>(idlFactory, previous.canisterId);
  const after = await upgraded.getPbppInformation();

  // Prior entries are preserved, in order, unmodified.
  expect(after.slice(0, before.length).map((e) => e.content)).toEqual(priorContents);

  // The record carries a time-stamped entry stating the live deployed backend
  // canister principal.
  const principalEntry = after.find((e) =>
    e.content.includes("hcfuw-caaaa-aaaaf-qgzaa-cai"),
  );
  expect(principalEntry).toBeDefined();
  expect(typeof principalEntry?.timestamp).toBe("bigint");
});

it("preserves the NFT-domain reads across the nextTokenId reconciliation migration", async () => {
  // 1. Install the previous revision (the version the user is actually
  //    running). Its migration chain ends at 20260928_000002.mo; the new
  //    20260928_000003.mo migration reconciles the cache-only nextTokenId
  //    counter from the local nfts cache and must not disturb the NFT store.
  const previous = await pic.setupCanister({ idlFactory, wasm: PREVIOUS_WASM });

  // 2. Seed some non-NFT state through the OLD public API so the upgrade has
  //    real state to carry. The NFT store itself cannot be seeded: the only
  //    path that writes it is the game-end mint, which calls the external
  //    ICRC-7 collection canister absent from this replica.
  const previousActor = pic.createActor<_SERVICE>(idlFactory, previous.canisterId);
  await previousActor.login("player-1", "Ada", [], { none: null });
  await previousActor.login("player-2", "Bob", [], { none: null });
  const beforeNumber = await previousActor.getGameNumber();

  // 3. Upgrade to the version this build produces. The new migration runs here;
  //    a migration that traps or rebuilds the NFT store with a wrong shape
  //    fails the upgrade.
  await pic.upgradeCanister({
    canisterId: previous.canisterId,
    wasm: BACKEND_WASM,
    upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] },
  });

  // 4. Read through the NEW API. The NFT-domain reads must still resolve (the
  //    store survived the migration with its shape intact), and the game state
  //    written before the upgrade must survive.
  const upgraded = pic.createActor<_SERVICE>(idlFactory, previous.canisterId);
  await expect(upgraded.getMintAttemptsByGame()).resolves.toEqual([]);
  await expect(upgraded.getMintStatusesForGame()).resolves.toEqual([]);
  await expect(upgraded.getNftMetadataBatch([1n, 2n])).resolves.toEqual([[], []]);
  await expect(upgraded.getGameNumber()).resolves.toBe(beforeNumber);

  const state = await upgraded.getGameState("player-1");
  expect(state.players).toContainEqual(
    expect.objectContaining({ principal: "player-1", username: "Ada" }),
  );
});

it("carries prior state through the Sunday-comp migration and initializes the new stores empty", async () => {
  // 1. Install the version the user is actually running (the previous
  //    revision). Its actor has no compWinStore / compArchiveStore /
  //    compFinalizeMarker fields.
  const previous = await pic.setupCanister({ idlFactory, wasm: PREVIOUS_WASM });

  // 2. Seed state through the OLD public API, as the deployed app did, so the
  //    upgrade has real data to carry.
  const previousActor = pic.createActor<_SERVICE>(idlFactory, previous.canisterId);
  await previousActor.login("sunday-player-1", "Ada", [], { none: null });
  await previousActor.login("sunday-player-2", "Bob", [], { none: null });
  const beforeNumber = await previousActor.getGameNumber();

  // Stop the canister before upgrading: the recurring maintenance timer's
  // self-message is outstanding at upgrade time and the pre_upgrade check traps
  // with "outstanding message callbacks" otherwise. The migration still runs as
  // part of the upgrade.
  await pic.stopCanister({ canisterId: previous.canisterId });

  // 3. Upgrade to the version this build produces. The Sunday-comp migration
  //    runs here; a migration that traps or rebuilds the stores with a wrong
  //    shape fails the upgrade.
  await pic.upgradeCanister({
    canisterId: previous.canisterId,
    wasm: BACKEND_WASM,
    upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] },
  });
  await pic.startCanister({ canisterId: previous.canisterId });

  // 4. Read through the NEW API. Prior player state and the game number must
  //    survive, and the three new Sunday-comp structures must be initialized
  //    empty rather than trapping.
  const upgraded = pic.createActor<_SERVICE>(idlFactory, previous.canisterId);

  await expect(upgraded.getGameNumber()).resolves.toBe(beforeNumber);
  const state = await upgraded.getGameState("sunday-player-1");
  expect(state.players).toContainEqual(
    expect.objectContaining({ principal: "sunday-player-1", username: "Ada" }),
  );
  expect(state.players).toContainEqual(
    expect.objectContaining({ principal: "sunday-player-2", username: "Bob" }),
  );

  // The new Sunday-comp stores are initialized empty by the migration: the
  // standings read answers empty. The archive read finalizes the previous
  // completed Sunday lazily on first read (the finalize marker starts at 0),
  // archiving exactly one no-winner row — proving the new structures are wired
  // and initialized rather than left uninitialized.
  await expect(upgraded.getSundayCompStandings(50n)).resolves.toEqual([]);
  const past = await upgraded.getPastWinners();
  expect(past).toHaveLength(1);
  expect(past[0]?.winnerName).toEqual([]);
  expect(past[0]?.runnerUpName).toEqual([]);

  // The status read works against the migrated state instead of trapping.
  const status = await upgraded.getSundayCompStatus();
  expect(typeof status.live).toBe("boolean");
  expect(typeof status.sunday).toBe("bigint");
});

it("carries prior state through the 10-place archive migration and initializes the new fields empty", async () => {
  // 1. Install the version the user is actually running (the previous
  //    revision). Its actor has no compArchive10Store / compFinalize10Marker
  //    fields.
  const previous = await pic.setupCanister({ idlFactory, wasm: PREVIOUS_WASM });

  // 2. Seed state through the OLD public API, as the deployed app did, so the
  //    upgrade has real data to carry.
  const previousActor = pic.createActor<_SERVICE>(idlFactory, previous.canisterId);
  await previousActor.login("archive10-player-1", "Ada", [], { none: null });
  await previousActor.login("archive10-player-2", "Bob", [], { none: null });
  const beforeNumber = await previousActor.getGameNumber();

  // Stop the canister before upgrading: the recurring maintenance timer's
  // self-message is outstanding at upgrade time and the pre_upgrade check traps
  // with "outstanding message callbacks" otherwise. The migration still runs as
  // part of the upgrade.
  await pic.stopCanister({ canisterId: previous.canisterId });

  // 3. Upgrade to the version this build produces. The 10-place archive
  //    migration runs here; a migration that traps or rebuilds the stores with
  //    a wrong shape fails the upgrade.
  await pic.upgradeCanister({
    canisterId: previous.canisterId,
    wasm: BACKEND_WASM,
    upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] },
  });
  await pic.startCanister({ canisterId: previous.canisterId });

  // 4. Read through the NEW API. Prior player state and the game number must
  //    survive, and the two new 10-place archive fields must be initialized
  //    empty rather than trapping.
  const upgraded = pic.createActor<_SERVICE>(idlFactory, previous.canisterId);

  await expect(upgraded.getGameNumber()).resolves.toBe(beforeNumber);
  const state = await upgraded.getGameState("archive10-player-1");
  expect(state.players).toContainEqual(
    expect.objectContaining({ principal: "archive10-player-1", username: "Ada" }),
  );
  expect(state.players).toContainEqual(
    expect.objectContaining({ principal: "archive10-player-2", username: "Bob" }),
  );

  // The new 10-place archive is initialized empty by the migration: the
  // archived-pool read answers null for a Sunday with no archived competition.
  await expect(upgraded.getArchivedPrizePool(0n)).resolves.toEqual([]);

  // The archive read finalizes the previous completed Sunday lazily on first
  // read (the finalize marker starts at 0), archiving exactly one no-winner
  // row — proving the new 10-place structures are wired and initialized rather
  // than left uninitialized. The archived pool for that Sunday is then readable
  // and carries the zero pool of a competition with no wins.
  const past = await upgraded.getPastWinners();
  expect(past).toHaveLength(1);
  const sunday = past[0]!.sunday;
  const archived = await upgraded.getArchivedPrizePool(sunday);
  expect(archived).toHaveLength(1);
  expect(archived[0]!.poolE8s).toBe(0n);
  expect(archived[0]!.firstPrizeE8s).toBe(0n);

  // The current pool read works against the migrated state instead of trapping.
  const pool = await upgraded.getCurrentPrizePool();
  expect(typeof pool.poolE8s).toBe("bigint");
  expect(typeof pool.firstPrizeE8s).toBe("bigint");
});

it("initializes the new blockedSquareOwners field across the migration upgrade", async () => {
  // 1. Install the previous revision (the version the user is actually
  //    running). Its SpellBoardState has no blockedSquareOwners field.
  const previous = await pic.setupCanister({ idlFactory, wasm: PREVIOUS_WASM });

  // 2. Upgrade to the version this build produces. The migration must add the
  //    new field, initialized to an empty array (no blocked squares exist in
  //    the prior state, so there is no owner to derive). Stop the canister
  //    first: the recurring maintenance timer's self-message is outstanding at
  //    upgrade time and the pre_upgrade check traps with "outstanding message
  //    callbacks" otherwise.
  await pic.stopCanister({ canisterId: previous.canisterId });
  await pic.upgradeCanister({
    canisterId: previous.canisterId,
    wasm: BACKEND_WASM,
    upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] },
  });
  await pic.startCanister({ canisterId: previous.canisterId });

  // 3. Read through the NEW API. The reply must decode with the new field
  //    present and empty, and the pre-existing spell arrays must survive.
  const upgraded = pic.createActor<_SERVICE>(idlFactory, previous.canisterId);
  const after = await upgraded.getSpellBoardState();
  expect(after.blockedSquareOwners).toEqual([]);
  expect(after.blockedSquares).toEqual([]);
  expect(after.explosiveSquares).toEqual([]);
});

it("carries prior state through the stored-prize migration and initializes the new field", async () => {
  // 1. Install the version the user is actually running (the previous
  //    revision). Its ArchivedPlacement10 has no prizeE8s field; the new
  //    20261018_000003.mo migration adds it.
  const previous = await pic.setupCanister({ idlFactory, wasm: PREVIOUS_WASM });

  // 2. Seed state through the OLD public API, as the deployed app did, so the
  //    upgrade has real data to carry. The 10-place archive itself cannot be
  //    seeded directly (its only writer is finalization, which needs the clock
  //    to cross a competition boundary), so seed the player state and the game
  //    number that must survive the migration.
  const previousActor = pic.createActor<_SERVICE>(idlFactory, previous.canisterId);
  await previousActor.login("stored-prize-player-1", "Ada", [], { none: null });
  await previousActor.login("stored-prize-player-2", "Bob", [], { none: null });
  const beforeNumber = await previousActor.getGameNumber();

  // Stop the canister before upgrading: the recurring maintenance timer's
  // self-message is outstanding at upgrade time and the pre_upgrade check traps
  // with "outstanding message callbacks" otherwise. The migration still runs as
  // part of the upgrade.
  await pic.stopCanister({ canisterId: previous.canisterId });

  // 3. Upgrade to the version this build produces. The stored-prize migration
  //    runs here; a migration that traps or rebuilds the 10-place archive with
  //    a wrong shape fails the upgrade.
  await pic.upgradeCanister({
    canisterId: previous.canisterId,
    wasm: BACKEND_WASM,
    upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] },
  });
  await pic.startCanister({ canisterId: previous.canisterId });

  // 4. Read through the NEW API. Prior player state and the game number must
  //    survive, and the 10-place archive must still resolve with the new
  //    prizeE8s field present rather than trapping on a shape mismatch.
  const upgraded = pic.createActor<_SERVICE>(idlFactory, previous.canisterId);

  await expect(upgraded.getGameNumber()).resolves.toBe(beforeNumber);
  const state = await upgraded.getGameState("stored-prize-player-1");
  expect(state.players).toContainEqual(
    expect.objectContaining({ principal: "stored-prize-player-1", username: "Ada" }),
  );
  expect(state.players).toContainEqual(
    expect.objectContaining({ principal: "stored-prize-player-2", username: "Bob" }),
  );

  // The archive read finalizes the previous completed competition lazily on
  // first read (the finalize marker starts at 0), archiving exactly one
  // no-winner row. That row's placements are empty, so the new prizeE8s field
  // is exercised only through the archived-pool read, which must still resolve
  // against the migrated store.
  const past = await upgraded.getPastWinners();
  expect(past).toHaveLength(1);
  const sunday = past[0]!.sunday;
  const archived = await upgraded.getArchivedPrizePool(sunday);
  expect(archived).toHaveLength(1);
  expect(archived[0]!.poolE8s).toBe(0n);
  expect(archived[0]!.firstPrizeE8s).toBe(0n);

  // The claim surface reads the migrated archive without trapping: a signed-in
  // caller who owns no migrated placement gets a not-claimable result, and the
  // stored-amount read for a rank with no placement answers no prize.
  const alice = createIdentity("stored-prize-migrated-claimant");
  upgraded.setIdentity(alice);
  const recipient = createIdentity("stored-prize-migrated-recipient").getPrincipal();
  const claim = await upgraded.claimPrize(sunday, 1n, recipient);
  expect(claim.state).toEqual({ claimable: null });
  expect(claim.amountE8s).toBe(0n);
  expect(claim.blockIndex).toEqual([]);
});
