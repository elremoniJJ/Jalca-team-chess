import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import type { Principal } from "@icp-sdk/core/principal";

import type {
  Allowance,
  GameOutcome,
  PlaceBetArgs,
  PlaceBetResult,
  RealBetRecord,
  ReportOutcomeArgs,
  ReportOutcomeResult,
  SettlementRecord,
  StartGameArgs,
  StartGameResult,
  _SERVICE,
} from "@/declarations/backend.did";

/**
 * Characterization of the Real Bet API-consumer contract.
 *
 * The request adds a `start_game` caller to JALCA's backend that calls JEL's
 * `start_game` (record-shaped update) from JALCA's own backend principal when a
 * new game starts. That change must NOT disturb the existing Phase 2 real-bet
 * integration (`place_bet` / `report_outcome`). The frontend consumes those
 * through the generated `_SERVICE` actor contract:
 *   - `placeBet(args: PlaceBetArgs): PlaceBetResult` — relays a real bet to
 *     JEL and returns the ICRC Ledger block index on success;
 *   - `checkAllowance(player): Allowance` — reads the ledger allowance with
 *     JEL as spender;
 *   - `startGame(args: StartGameArgs): StartGameResult` — starts a JEL game
 *     for a JALCA-generated match UUID;
 *   - `reportOutcome(args: ReportOutcomeArgs): ReportOutcomeResult` — reports
 *     a game outcome to JEL for the same match UUID;
 *   - `getRealBets(): Array<RealBetRecord>` and
 *     `getSettlements(): Array<SettlementRecord>` — read the locally recorded
 *     real bets / settlements.
 *
 * The diagnostic `sendTestPayload` endpoint and its exclusive types
 * (`TestPayload`, `TestReceipt`) were removed from the public API, so they are
 * intentionally not asserted here.
 *
 * These tests pin the contract shapes the change must not disturb: the exact
 * record-shaped arguments and result variants of the real-bet methods. A
 * future change that accidentally alters these signatures (e.g. while adding
 * `start_game`) fails here.
 *
 * This is a typed local mock of the actor — it does not exercise the real
 * canister. The backend PocketIC lane is the only place the real backend runs,
 * and it is skipped in this environment (no compiled wasm on disk).
 */

const GAME_ID = "match-uuid-1";

function mockActor(): _SERVICE {
  const placeBet = vi.fn(
    async (_args: PlaceBetArgs): Promise<PlaceBetResult> => ({ ok: 42n }),
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

describe("Real Bet actor contract", () => {
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

    // The ok payload is the ICRC Ledger block index (a nat).
    expect(result).toMatchObject({ ok: 42n });
    expect(typeof (result as { ok: bigint }).ok).toBe("bigint");
    expect(actor.placeBet).toHaveBeenCalledWith(args);
  });

  it("checkAllowance takes a player principal and returns the Allowance with JEL as spender", async () => {
    const actor = mockActor();

    const allowance = await actor.checkAllowance(
      "aaaaa-aa" as unknown as Principal,
    );

    expect(allowance).toEqual({ allowance: 100_000_000n, expires_at: [] });
  });

  it("startGame takes a StartGameArgs record and returns StartGameResult", async () => {
    const actor = mockActor();

    const args: StartGameArgs = {
      game_id: GAME_ID,
      start_time: 1_700_000_000_000_000_000n,
    };
    const result = await actor.startGame(args);

    expect(result).toMatchObject({ ok: null });
    expect(actor.startGame).toHaveBeenCalledWith(args);
  });

  it("reportOutcome takes a ReportOutcomeArgs record and returns ReportOutcomeResult", async () => {
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

  it("getRealBets and getSettlements return the locally recorded arrays", async () => {
    const actor = mockActor();

    await expect(actor.getRealBets()).resolves.toEqual([]);
    await expect(actor.getSettlements()).resolves.toEqual([]);
  });
});
