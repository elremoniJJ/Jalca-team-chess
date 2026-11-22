import { IDL } from "@icp-sdk/core/candid";
import { describe, expect, it } from "vitest";

import { idlFactory } from "@/declarations/backend.did.js";

/**
 * Cover for the accepted update-vs-query reclassification.
 *
 * The request converts several read-only methods from update to true query:
 * getGameState, getGameRecord, getExerciseAssignments, getDrinkingAssignments,
 * getBets, and getResults. A query carries no consensus round and
 * cannot mutate state, so the classification is the observable contract that
 * makes "no maintenance side effect" true at the protocol level.
 *
 * The classification is not visible from the app's own components (the
 * generated wrapper exposes the same method names either way), and the
 * frontend suite mocks the actor, so it cannot observe a real call's
 * round-trip. It IS visible in the generated Candid service, which is the
 * artifact the replica and the agent both read. This file introspects that
 * service directly — no network, no canister — and pins:
 *
 *   - the seven converted methods carry the `query` annotation;
 *   - the two methods that must stay updates (heartbeat, runMaintenance) do
 *     not, so a future change cannot silently reclassify them;
 *   - the argument/return arity of each converted method is unchanged, so the
 *     "same data shape as before" criterion is not satisfied by a signature
 *     change.
 *
 * The real canister behavior behind these signatures is exercised by the
 * PocketIC lane (maintenance-timer-cover.test.ts), not here.
 */

const CONVERTED_READS = [
  "getGameState",
  "getGameRecord",
  "getExerciseAssignments",
  "getDrinkingAssignments",
  "getBets",
  "getResults",
] as const;

/** The methods that must remain update calls after the conversion. */
const REMAINING_UPDATES = ["heartbeat", "runMaintenance"] as const;

type ServiceFields = Map<string, IDL.FuncClass>;

function serviceFields(): ServiceFields {
  // `idlFactory` destructures `IDL` from its argument, so pass the real one.
  const service = idlFactory({ IDL }) as IDL.ServiceClass;
  return new Map(service._fields as Array<[string, IDL.FuncClass]>);
}

describe("converted read methods are Candid queries", () => {
  it.each(CONVERTED_READS)(
    "%s is declared as a query (no consensus round)",
    (method) => {
      const func = serviceFields().get(method);
      expect(func, `${method} missing from the Candid service`).toBeDefined();
      expect(func?.annotations).toContain("query");
    },
  );

  it.each(REMAINING_UPDATES)(
    "%s remains an update call (not reclassified)",
    (method) => {
      const func = serviceFields().get(method);
      expect(func, `${method} missing from the Candid service`).toBeDefined();
      expect(func?.annotations).not.toContain("query");
    },
  );

  it("keeps the argument and return arity of every converted read", () => {
    const fields = serviceFields();

    // getGameState takes the caller principal; the rest take no arguments.
    // Every one returns exactly one value.
    const expectedArgCount: Record<(typeof CONVERTED_READS)[number], number> = {
      getGameState: 1,
      getGameRecord: 0,
      getExerciseAssignments: 0,
      getDrinkingAssignments: 0,
      getBets: 0,
      getResults: 0,
    };

    for (const method of CONVERTED_READS) {
      const func = fields.get(method);
      expect(func, `${method} missing from the Candid service`).toBeDefined();
      expect(func?.argTypes).toHaveLength(expectedArgCount[method]);
      expect(func?.retTypes).toHaveLength(1);
    }
  });
});
