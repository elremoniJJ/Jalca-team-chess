import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import type { Principal } from "@icp-sdk/core/principal";

import type {
  Allowance,
  EscrowError,
  GameOutcome,
  PlaceBetArgs,
  PlaceBetResult,
  RealBet,
  RealBetRecord,
  ReportOutcomeArgs,
  ReportOutcomeResult,
  SettlementRecord,
  SettlementResult,
  StartGameArgs,
  StartGameResult,
  _SERVICE,
} from "@/declarations/backend.did";

/**
 * Characterization of the escrow integration contract that must survive the
 * intentional rewrite.
 *
 * The request rewrites the escrow canister call contract:
 *   - `place_bet` takes a `PlaceBetArgs` record instead of 7 positional args;
 *   - `start_game` takes a `StartGameArgs` record instead of no args;
 *   - `report_outcome` takes a `ReportOutcomeArgs` record instead of a single
 *     outcome arg;
 *   - escrow errors are decoded as the exact `EscrowError` variant
 *     (`Unauthorized`, `NoApproval`, `InsufficientAllowance`,
 *     `TransferFailed : text`, `InvalidTier`, `NoActiveGame`) instead of the
 *     removed `PlaceBetError` / `ReportOutcomeError` / `StartGameError` shapes;
 *   - `place_bet` success carries the ICRC Ledger block index (a `nat`) rather
 *     than a `RealBet` record;
 *   - `RealBet` carries `block_index` and `game_id`;
 *   - `SettlementResult` carries `game_id`, `outcome`, and `settled_at`.
 *
 * This file pins the NEW accepted contract shapes and the ADJACENT behavior
 * that must remain unchanged across the rewrite:
 *
 *   1. The record-shaped `place_bet` / `start_game` / `report_outcome` args
 *      and their result variants.
 *   2. The exact `EscrowError` variant set.
 *   3. The locally recorded real-bet / settlement read paths return their
 *      arrays and preserve relay/report order.
 *
 * The diagnostic `sendTestPayload` endpoint and its exclusive types
 * (`TestPayload`, `TestReceipt`) were removed from the public API, so they are
 * intentionally not asserted here.
 *
 * The escrow-target and ICRC-2-approval seams (the configurable principal
 * constant, the stake-plus-fee allowance, and the default spender subaccount)
 * are protected value-agnostically by the existing `pbpp-principal.test.ts`,
 * which is why they are not duplicated here.
 *
 * This is a typed local mock of the actor — it does not exercise the real
 * canister. The backend PocketIC lane is the only place the real backend runs,
 * and it is skipped in this environment (no compiled wasm on disk).
 */

const GAME_ID = "match-uuid-1";

function mockActor(): _SERVICE {
  const placeBet = vi.fn(
    async (_args: PlaceBetArgs): Promise<PlaceBetResult> => ({
      ok: 42n,
    }),
  );
  const checkAllowance = vi.fn(
    async (): Promise<Allowance> => ({
      allowance: 100_000_000n,
      expires_at: [],
    }),
  );
  const startGame = vi.fn(
    async (_args: StartGameArgs): Promise<StartGameResult> => ({ ok: null }),
  );
  const reportOutcome = vi.fn(
    async (_args: ReportOutcomeArgs): Promise<ReportOutcomeResult> => ({
      ok: null,
    }),
  );
  const getRealBets = vi.fn(async (): Promise<RealBetRecord[]> => []);
  const getSettlements = vi.fn(async (): Promise<SettlementRecord[]> => []);

  return {
    placeBet,
    checkAllowance,
    startGame,
    reportOutcome,
    getRealBets,
    getSettlements,
  } as unknown as _SERVICE;
}

describe("escrow record-shaped call contract (accepted rewrite)", () => {
  it("placeBet takes a PlaceBetArgs record and returns the ICRC Ledger block index", async () => {
    const actor = mockActor();

    const args: PlaceBetArgs = {
      player: "aaaaa-aa" as unknown as Principal,
      username: "Ada",
      anonymous: false,
      pot_tier: 1n,
      amount_e8s: 100_000_000n,
      outcome: { white: null } as GameOutcome,
      wallet_address: "aaaaa-aa",
    };
    const result = await actor.placeBet(args);

    // The success payload is the ICRC Ledger block index (a nat), not a
    // RealBet record.
    expect(result).toMatchObject({ ok: 42n });
    expect(typeof (result as { ok: bigint }).ok).toBe("bigint");
    // The record-shaped argument is forwarded verbatim.
    expect(actor.placeBet).toHaveBeenCalledWith(args);
  });

  it("startGame takes a StartGameArgs record with the shared game_id", async () => {
    const actor = mockActor();

    const args: StartGameArgs = {
      game_id: GAME_ID,
      start_time: 1_700_000_000_000_000_000n,
    };
    const result = await actor.startGame(args);

    expect(result).toMatchObject({ ok: null });
    expect(actor.startGame).toHaveBeenCalledWith(args);
  });

  it("reportOutcome takes a ReportOutcomeArgs record with the shared game_id", async () => {
    const actor = mockActor();

    const args: ReportOutcomeArgs = {
      game_id: GAME_ID,
      result: { white: null } as GameOutcome,
      end_time: 1_700_000_000_000_000_000n,
    };
    const result = await actor.reportOutcome(args);

    expect(result).toMatchObject({ ok: null });
    expect(actor.reportOutcome).toHaveBeenCalledWith(args);
  });

  it("startGame and reportOutcome share the same game_id for one match", async () => {
    const actor = mockActor();

    await actor.startGame({
      game_id: GAME_ID,
      start_time: 1_700_000_000_000_000_000n,
    });
    await actor.reportOutcome({
      game_id: GAME_ID,
      result: { draw: null } as GameOutcome,
      end_time: 1_700_000_000_000_000_001n,
    });

    const started = (
      actor.startGame as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0][0] as StartGameArgs;
    const reported = (
      actor.reportOutcome as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0][0] as ReportOutcomeArgs;
    // The same JALCA-generated match UUID is passed to both calls.
    expect(started.game_id).toBe(GAME_ID);
    expect(reported.game_id).toBe(GAME_ID);
  });
});

describe("escrow error variants (accepted rewrite)", () => {
  it("decodes every EscrowError variant exactly", async () => {
    // The exact variant set the frontend must decode, in the raw Candid shape
    // the generated declarations carry. A rewrite that drops or renames a
    // variant fails to compile or fails the assertions below.
    const variants: EscrowError[] = [
      { Unauthorized: null },
      { NoApproval: null },
      { InsufficientAllowance: null },
      { TransferFailed: "InsufficientAllowance" },
      { InvalidTier: null },
      { NoActiveGame: null },
    ];

    expect(variants.map((v) => Object.keys(v)[0])).toEqual([
      "Unauthorized",
      "NoApproval",
      "InsufficientAllowance",
      "TransferFailed",
      "InvalidTier",
      "NoActiveGame",
    ]);
    // TransferFailed carries the escrow canister's failure text.
    const transferFailed = variants.find(
      (v) => "TransferFailed" in v,
    ) as Extract<EscrowError, { TransferFailed: string }>;
    expect(transferFailed.TransferFailed).toBe("InsufficientAllowance");
  });

  it("placeBet surfaces an EscrowError variant on failure", async () => {
    const actor = mockActor();
    (actor.placeBet as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      err: { NoApproval: null },
    });

    const result = await actor.placeBet({
      player: "aaaaa-aa" as unknown as Principal,
      username: "Ada",
      anonymous: false,
      pot_tier: 1n,
      amount_e8s: 100_000_000n,
      outcome: { white: null } as GameOutcome,
      wallet_address: "aaaaa-aa",
    });

    expect(result).toMatchObject({ err: { NoApproval: null } });
  });
});

describe("escrow read paths (must survive the contract rewrite)", () => {
  it("getRealBets and getSettlements return the locally recorded arrays", async () => {
    const actor = mockActor();

    await expect(actor.getRealBets()).resolves.toEqual([]);
    await expect(actor.getSettlements()).resolves.toEqual([]);
  });

  it("getRealBets preserves relay order and the recorded RealBet payload", async () => {
    const first: RealBetRecord = {
      id: 0n,
      bet: {
        block_index: 42n,
        game_id: GAME_ID,
        player: "aaaaa-aa" as unknown as Principal,
        username: "Ada",
        anonymous: false,
        pot_tier: 1n,
        amount_e8s: 100_000_000n,
        outcome: { white: null } as GameOutcome,
        wallet_address: "aaaaa-aa",
        placed_at: 1_700_000_000_000_000_000n,
      },
      timestamp: 1_700_000_000_000_000_001n,
    };
    const second: RealBetRecord = {
      ...first,
      id: 1n,
      bet: { ...first.bet, username: "Bob", block_index: 43n },
    };
    const actor = {
      getRealBets: vi.fn(async () => [first, second]),
    } as unknown as _SERVICE;

    const bets = await actor.getRealBets();

    expect(bets.map((b) => b.bet.username)).toEqual(["Ada", "Bob"]);
    expect(bets[0]).toMatchObject({
      id: 0n,
      bet: { block_index: 42n, game_id: GAME_ID },
    });
    expect(bets[1]).toMatchObject({ id: 1n, bet: { block_index: 43n } });
  });

  it("getSettlements preserves report order and the recorded SettlementResult payload", async () => {
    const first: SettlementRecord = {
      id: 0n,
      settlement: {
        game_id: GAME_ID,
        outcome: { white: null } as GameOutcome,
        settled_at: 1_700_000_000_000_000_000n,
      },
      timestamp: 1_700_000_000_000_000_001n,
    };
    const second: SettlementRecord = {
      ...first,
      id: 1n,
      settlement: { ...first.settlement, game_id: "match-uuid-2" },
    };
    const actor = {
      getSettlements: vi.fn(async () => [first, second]),
    } as unknown as _SERVICE;

    const settlements = await actor.getSettlements();

    expect(settlements.map((s) => s.settlement.game_id)).toEqual([
      GAME_ID,
      "match-uuid-2",
    ]);
    expect(settlements[0].settlement).toMatchObject({
      outcome: { white: null },
      settled_at: 1_700_000_000_000_000_000n,
    });
  });
});
