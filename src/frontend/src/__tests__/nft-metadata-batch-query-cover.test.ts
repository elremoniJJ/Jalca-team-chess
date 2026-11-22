import { IDL } from "@icp-sdk/core/candid";
import { describe, expect, it } from "vitest";

import { idlFactory } from "@/declarations/backend.did.js";

/**
 * Cover for the accepted change: `getNftMetadataBatch` is exposed as a QUERY
 * call instead of an update call.
 *
 * The characterization file
 * (`nft-metadata-batch-declaration-characterization.test.ts`) deliberately did
 * NOT assert the batch method's own annotation, because that annotation is the
 * intentional change. This file closes that gap and pins the accepted result:
 *
 *   1. `getNftMetadataBatch` carries the `query` annotation in the generated
 *      Candid service — the artifact the replica and the agent both read.
 *   2. Its payload shape is unchanged: `vec nat -> vec opt MintMetadata`, so
 *      one entry per requested id, positionally aligned, with a per-id
 *      optional that lets an unknown id occupy its slot as null.
 *   3. No OTHER backend function's call type changed. The sibling
 *      `getNftMetadata` stays a query, and the read methods the frontend
 *      depends on keep their classification.
 *
 * This file reads the generated IDL factory only. It makes no network call and
 * opens no signer popup. The real canister behavior behind the annotation is
 * exercised by the PocketIC lane (backend.test.ts), not here.
 */

/**
 * The generated Candid service, built from the app's own IDL factory.
 *
 * `IDL.Service` stores its methods as `_fields`, a list of `[name, FuncClass]`
 * tuples. The accessor below reads the name from either a tuple or an object
 * entry so the assertion does not depend on the candid library's internal
 * representation.
 */
function serviceFields(): Array<[string, IDL.FuncClass]> {
  const service = idlFactory({ IDL }) as unknown as {
    _fields: Array<[string, IDL.FuncClass] | { name: string }>;
  };
  return service._fields.map((field) =>
    Array.isArray(field)
      ? [field[0], field[1] as IDL.FuncClass]
      : [field.name, field as unknown as IDL.FuncClass],
  );
}

function method(name: string): IDL.FuncClass {
  const found = serviceFields().find(([methodName]) => methodName === name);
  if (found === undefined) {
    throw new Error(`generated Candid service does not declare ${name}`);
  }
  return found[1];
}

/** The Candid annotations on a method: `[]` for update, `["query"]` for query. */
function annotations(name: string): string[] {
  return method(name).annotations;
}

describe("getNftMetadataBatch is a query call", () => {
  it("carries the query annotation in the generated Candid service", () => {
    // The accepted change: the batched metadata read is a true query, so it
    // carries no consensus round and cannot mutate state. A regression that
    // reverts it to an update call fails here.
    expect(annotations("getNftMetadataBatch")).toEqual(["query"]);
  });

  it("keeps the vec nat -> vec opt MintMetadata payload shape", () => {
    const batch = method("getNftMetadataBatch");

    // Exactly one argument: a vec of nat token ids.
    expect(batch.argTypes).toHaveLength(1);
    const arg = batch.argTypes[0];
    expect(arg).toBeInstanceOf(IDL.VecClass);
    expect((arg as IDL.VecClass<unknown>)._type).toBeInstanceOf(IDL.NatClass);

    // Exactly one return: a vec whose element is an optional MintMetadata.
    // The per-id optional is what lets an unknown id occupy its position as
    // null instead of shifting the rest of the response.
    expect(batch.retTypes).toHaveLength(1);
    const ret = batch.retTypes[0];
    expect(ret).toBeInstanceOf(IDL.VecClass);
    const element = (ret as IDL.VecClass<unknown>)._type;
    expect(element).toBeInstanceOf(IDL.OptClass);
    const metadata = (element as IDL.OptClass<unknown>)._type;
    expect(metadata).toBeInstanceOf(IDL.RecordClass);
  });

  it("keeps the per-token getNftMetadata read as a query", () => {
    // The batch change must not touch its sibling read.
    expect(annotations("getNftMetadata")).toEqual(["query"]);
  });

  it("does not change any other read method's call type", () => {
    // The read methods the frontend depends on keep their classification.
    // getNftsForOwner is an update because it makes an inter-canister call;
    // the rest are local reads and stay queries.
    const expected: Record<string, string[]> = {
      getNftsForOwner: [],
      getGameState: ["query"],
      getGameRecord: ["query"],
      getGameNumber: ["query"],
      getBets: ["query"],
      getResults: ["query"],
      getExerciseAssignments: ["query"],
      getDrinkingAssignments: ["query"],
      getSpellNameForGame: ["query"],
      getBurnState: ["query"],
      getKickState: ["query"],
      getApprovalState: ["query"],
    };

    for (const [name, expectedAnnotations] of Object.entries(expected)) {
      expect(annotations(name), `${name} call type changed`).toEqual(
        expectedAnnotations,
      );
    }
  });
});
