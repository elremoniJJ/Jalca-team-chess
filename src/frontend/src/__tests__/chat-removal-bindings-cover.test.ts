import { IDL } from "@icp-sdk/core/candid";
import { describe, expect, it } from "vitest";

import * as declarations from "@/declarations/backend.did.js";
import { idlFactory } from "@/declarations/backend.did.js";

/**
 * Cover for the accepted removal of the dead chat path, asserted at the
 * generated-bindings seam.
 *
 * The request deletes the `sendChat` endpoint, the `chat` field from the
 * game-state snapshot, the `ChatMessage` type, and the chat store/helpers. The
 * frontend suite mocks the actor, so it cannot observe a real call; the
 * PocketIC lane is the only place the real canister is exercised. What IS
 * observable in the gated frontend suite is the regenerated Candid service and
 * the exported IDL types — the artifact the agent, the replica, and the app's
 * own wrapper all read. This file introspects them directly (no network, no
 * canister) and pins:
 *
 *   - `sendChat` is absent from the Candid service;
 *   - the `GameStateSnapshot` record carries no `chat` field;
 *   - no exported IDL declaration is named `ChatMessage`;
 *   - the sibling snapshot fields the frontend consumes are still present, so
 *     the removal did not disturb the adjacent shape.
 *
 * The real canister's serialization behind these declarations is the PocketIC
 * lane's job, not this file's.
 */

type ServiceFields = Map<string, IDL.FuncClass>;

function serviceFields(): ServiceFields {
  // `idlFactory` destructures `IDL` from its argument, so pass the real one.
  const service = idlFactory({ IDL }) as IDL.ServiceClass;
  return new Map(service._fields as Array<[string, IDL.FuncClass]>);
}

/**
 * The runtime `GameStateSnapshot` IDL record. The generated `.did.d.ts`
 * declares the same name as a type-only interface, so a named import binds the
 * type and not the value; read it off the module namespace instead.
 */
function gameStateSnapshotRecord(): IDL.RecordClass {
  return (declarations as unknown as Record<string, IDL.RecordClass>)
    .GameStateSnapshot;
}

/** The field names of a generated `IDL.Record`, whose `_fields` is a pair list. */
function recordFieldNames(record: IDL.RecordClass): Set<string> {
  return new Set(
    (record._fields as Array<[string, IDL.Type]>).map(([name]) => name),
  );
}

/** The snapshot fields the frontend consumes and that must survive the removal. */
const SURVIVING_SNAPSHOT_FIELDS = [
  "spellBoardState",
  "spellUseEnabled",
  "turn",
  "timerRemainingMs",
  "players",
  "board",
  "moveMaker",
  "phase",
] as const;

describe("chat removal in the regenerated bindings", () => {
  it("does not declare a sendChat endpoint in the Candid service", () => {
    expect(serviceFields().has("sendChat")).toBe(false);
  });

  it("does not serialize a chat field on the GameStateSnapshot record", () => {
    const fields = recordFieldNames(gameStateSnapshotRecord());
    expect(fields.has("chat")).toBe(false);
  });

  it("keeps every sibling snapshot field the frontend consumes", () => {
    const fields = recordFieldNames(gameStateSnapshotRecord());
    for (const field of SURVIVING_SNAPSHOT_FIELDS) {
      expect(fields.has(field), `snapshot field ${field} missing`).toBe(true);
    }
  });

  it("does not export a ChatMessage IDL declaration", () => {
    expect(Object.keys(declarations)).not.toContain("ChatMessage");
  });
});
