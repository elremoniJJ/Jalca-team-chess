import { describe, expect, it } from "vitest";

/**
 * Characterization of the read-only ICRC-7 interface contract, taken BEFORE
 * any production work on the live collection canister.
 *
 * The request is read-only interface verification of the live ICRC-7 NFT
 * canister at 23quc-cyaaa-aaaac-bfvia-cai. No production behavior is intended
 * to change, so this file pins the two stable seams the read path depends on:
 *
 *   1. The frontend's target canister principal — the single constant that
 *      identifies which live collection the read-only queries address. A
 *      regression that repoints it (or drops it) would silently read the
 *      wrong collection.
 *   2. The backend's declared read-method surface — the API-consumer contract
 *      the frontend's fetchOwnedNfts path calls. The frontend suite mocks the
 *      actor everywhere, so nothing else asserts that the generated
 *      declarations still expose these methods.
 *
 * This file makes NO network call and opens NO signer popup: it reads the
 * module constant and the generated declarations only.
 */

import { IDL } from "@icp-sdk/core/candid";

import { idlFactory } from "@/declarations/backend.did.js";
import { ICRC7_CANISTER_ID } from "@/oisy-burn/oisy-signer";

/**
 * The generated Candid service, built from the app's own IDL factory.
 *
 * `IDL.Service` stores its methods as `_fields`, a list of `[name, type]`
 * tuples. The accessor below reads the name from either a tuple or an object
 * entry so the assertion does not depend on the candid library's internal
 * representation.
 */
function serviceMethodNames(): string[] {
  const service = idlFactory({ IDL }) as unknown as {
    _fields: Array<[string, unknown] | { name: string }>;
  };
  return service._fields.map((field) =>
    Array.isArray(field) ? field[0] : field.name,
  );
}

describe("ICRC-7 read-only interface contract", () => {
  it("targets the live ICRC-7 collection canister principal", () => {
    // The read-only interface addresses exactly this collection. The value is
    // the project's target collection on IC Mainnet; a change here is a
    // production decision, not a refactor.
    expect(ICRC7_CANISTER_ID).toBe("23quc-cyaaa-aaaac-bfvia-cai");
  });

  it("exposes the backend read methods the owned-NFT path calls", () => {
    // The generated Candid service must still declare the three read methods
    // fetchOwnedNfts routes through. A missing method here means the frontend
    // read path cannot compile against the real canister.
    const methodNames = serviceMethodNames();

    expect(methodNames).toContain("getNftsForOwner");
    expect(methodNames).toContain("getNftMetadataBatch");
    expect(methodNames).toContain("getNftMetadata");
  });
});
