import { IDL } from "@icp-sdk/core/candid";
import { describe, expect, it } from "vitest";

import { idlFactory } from "@/declarations/backend.did.js";

/**
 * Characterization of the maintenance-pass Candid contract, taken BEFORE the
 * accepted change that makes the 5-second maintenance pass return immediately
 * when the lobby has zero players.
 *
 * The request changes only the BODY of `runMaintenance` (an early return when
 * no players are present). It does NOT change the maintenance pass's public
 * shape, and the frontend suite cannot observe the body — it mocks the actor.
 * What the frontend CAN observe, and what this file freezes, is the protocol
 * seam the change depends on:
 *
 *   - `runMaintenance` must remain an UPDATE call. A query carries no consensus
 *     round and cannot mutate state, so a maintenance pass that cleans up stale
 *     players, expires a turn timer, or closes a celebration window can never be
 *     a query. If a future change reclassified it, the pass would silently stop
 *     mutating state.
 *   - `runMaintenance` keeps its `[Timestamp] -> ()` signature: exactly one
 *     argument (the IC time the timer callback passes) and no return value. The
 *     actor-body timer callback and the generated frontend wrapper both bind to
 *     this shape.
 *   - The adjacent public methods the maintenance pass and its callers rely on
 *     keep their update/query classification and arity: `heartbeat` and `login`
 *     stay updates (they mutate presence), `getGameState` stays a query (a read
 *     must not run maintenance), and `logout` stays an update.
 *
 * The real canister behavior behind these signatures is exercised by the
 * PocketIC lane (maintenance-timer-cover.test.ts), not here. This file
 * introspects the generated Candid service directly — no network, no canister.
 */

type ServiceFields = Map<string, IDL.FuncClass>;

function serviceFields(): ServiceFields {
  // `idlFactory` destructures `IDL` from its argument, so pass the real one.
  const service = idlFactory({ IDL }) as IDL.ServiceClass;
  return new Map(service._fields as Array<[string, IDL.FuncClass]>);
}

describe("maintenance pass Candid contract", () => {
  it("keeps runMaintenance an update call, never a query", () => {
    const func = serviceFields().get("runMaintenance");
    expect(
      func,
      "runMaintenance missing from the Candid service",
    ).toBeDefined();
    // A query cannot mutate state, so the maintenance pass must stay an update.
    expect(func?.annotations).not.toContain("query");
  });

  it("keeps runMaintenance's [Timestamp] -> () signature", () => {
    const func = serviceFields().get("runMaintenance");
    expect(
      func,
      "runMaintenance missing from the Candid service",
    ).toBeDefined();
    // One argument (the IC time the timer callback passes), no return value.
    expect(func?.argTypes).toHaveLength(1);
    expect(func?.retTypes).toHaveLength(0);
  });

  it("keeps heartbeat and login as updates that mutate presence", () => {
    const fields = serviceFields();
    for (const method of ["heartbeat", "login", "logout"] as const) {
      const func = fields.get(method);
      expect(func, `${method} missing from the Candid service`).toBeDefined();
      expect(
        func?.annotations,
        `${method} must remain an update`,
      ).not.toContain("query");
    }
  });

  it("keeps getGameState a query so a read never runs maintenance", () => {
    const func = serviceFields().get("getGameState");
    expect(func, "getGameState missing from the Candid service").toBeDefined();
    expect(func?.annotations).toContain("query");
    // getGameState takes the caller principal and returns one snapshot.
    expect(func?.argTypes).toHaveLength(1);
    expect(func?.retTypes).toHaveLength(1);
  });

  it("keeps heartbeat's [PseudoPrincipal] -> () signature", () => {
    const func = serviceFields().get("heartbeat");
    expect(func, "heartbeat missing from the Candid service").toBeDefined();
    expect(func?.argTypes).toHaveLength(1);
    expect(func?.retTypes).toHaveLength(0);
  });
});
