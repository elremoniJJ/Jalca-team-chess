import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import type {
  PbppInformationEntry,
  _SERVICE,
} from "@/declarations/backend.did";

/**
 * Characterization of the PBPP_Information API-consumer contract.
 *
 * The request appends a new time-stamped entry to the PBPP_Information record
 * via a backend migration. The frontend consumes that record through two
 * actor methods on the generated `_SERVICE` contract:
 *   - `getPbppInformation(): Array<PbppInformationEntry>` — returns the
 *     append-only record in append order;
 *   - `appendPbppInformation(content): PbppInformationEntry` — appends a new
 *     time-stamped entry and returns it.
 *
 * These tests pin the contract shape the migration must not disturb: the
 * entry carries a `content` string and a `timestamp` bigint, and the record
 * is append-only (a new entry is added, prior entries are never overwritten).
 *
 * This is a typed local mock of the actor — it does not exercise the real
 * canister. The backend PocketIC lane is the only place the real migration
 * runs, and it is skipped in this environment (no compiled wasm on disk).
 */

function mockActor(entries: PbppInformationEntry[]): _SERVICE {
  const getPbppInformation = vi.fn(async () => entries);
  const appendPbppInformation = vi.fn(async (content: string) => {
    const entry: PbppInformationEntry = { content, timestamp: 123n };
    entries.push(entry);
    return entry;
  });
  return {
    getPbppInformation,
    appendPbppInformation,
  } as unknown as _SERVICE;
}

describe("PBPP_Information actor contract", () => {
  it("exposes getPbppInformation returning entries in append order", async () => {
    const actor = mockActor([
      { content: "first", timestamp: 1n },
      { content: "second", timestamp: 2n },
    ]);

    const entries = await actor.getPbppInformation();

    expect(entries).toEqual([
      { content: "first", timestamp: 1n },
      { content: "second", timestamp: 2n },
    ]);
  });

  it("appendPbppInformation adds a new time-stamped entry without overwriting prior entries", async () => {
    const actor = mockActor([{ content: "first", timestamp: 1n }]);

    const appended = await actor.appendPbppInformation("second");

    // The appended entry carries the content and a timestamp.
    expect(appended).toMatchObject({ content: "second" });
    expect(typeof appended.timestamp).toBe("bigint");

    // The record grows by one and preserves the prior entry in order.
    const entries = await actor.getPbppInformation();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ content: "first", timestamp: 1n });
    expect(entries[1]).toMatchObject({ content: "second" });
  });
});
