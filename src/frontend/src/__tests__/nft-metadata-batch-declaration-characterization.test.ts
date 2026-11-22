import { describe, expect, it } from "vitest";

/**
 * Characterization of the generated Candid declaration contract for the
 * batched NFT metadata read, taken BEFORE the call-type change.
 *
 * The request intentionally changes ONE thing about `getNftMetadataBatch`:
 * its Candid call type moves from an update call to a query call. That
 * annotation is the intentional change, so this file deliberately does NOT
 * assert it — freezing `[]` here would make the accepted change fail.
 *
 * Everything ADJACENT to that change must survive it, and this file pins it:
 *
 *   1. The batch method's ARGUMENT and RETURN shapes are unchanged:
 *      `vec nat -> vec opt MintMetadata`. Only the annotation moves; a
 *      conversion that accidentally reshapes the payload (e.g. drops the
 *      per-id optional, or flattens the vec) would break every consumer.
 *   2. The per-token `getNftMetadata` stays a query — the batch change must
 *      not touch its sibling read.
 *   3. No OTHER backend function's call type changes. The read methods the
 *      frontend depends on keep their current query/update classification.
 *
 * This file reads the generated IDL factory only. It makes no network call
 * and opens no signer popup.
 */

import { IDL } from "@icp-sdk/core/candid";

import { idlFactory } from "@/declarations/backend.did.js";

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

describe("getNftMetadataBatch declaration contract", () => {
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

    // The record is the full MintMetadata shape the frontend maps onto each
    // owned token. Assert the field set so a conversion that drops a field
    // fails here rather than in front of a user.
    const fieldNames = (metadata as IDL.RecordClass)._fields
      .map(([fieldName]) => fieldName)
      .sort();
    expect(fieldNames).toEqual(
      [
        "concludedAt",
        "endState",
        "finalBoardState",
        "gameNumber",
        "gameResult",
        "moveCount",
        "recipientRole",
        "recipientTeam",
        "recipientUsername",
        "recipientWalletAddress",
        "spellId",
        "spellName",
      ].sort(),
    );
  });

  it("keeps the per-token getNftMetadata read as a query", () => {
    // The batch change must not touch its sibling read. getNftMetadata is a
    // pure local-cache lookup and stays a query.
    expect(annotations("getNftMetadata")).toEqual(["query"]);
  });

  it("does not change any other read method's call type", () => {
    // The read methods the frontend depends on keep their current
    // classification. getNftsForOwner is an update because it makes an
    // inter-canister call; the rest are local reads and stay queries.
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
