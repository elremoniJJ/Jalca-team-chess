import { describe, expect, it } from "vitest";

import { JALCA_VERSION, JALCA_WORDMARK } from "@/lib/version";

/**
 * Cover for the jalca wordmark version bump.
 *
 * The request bumps the published jalca version to v425. The version lives in
 * the single `JALCA_VERSION` constant in lib/version.ts and is composed into
 * the display string `JALCA_WORDMARK` that every Wordmark instance renders
 * verbatim. These tests pin the bumped value and the composition seam so a
 * future bump (or a regression back to an old value) is caught.
 */
describe("jalca wordmark version", () => {
  it("is bumped to the requested v425", () => {
    // The request bumps the published version to v425.
    expect(JALCA_VERSION).toBe("v425");
    const current = Number(JALCA_VERSION.replace(/^v/, ""));
    expect(Number.isInteger(current)).toBe(true);
    expect(current).toBe(425);
  });

  it("composes the accepted wordmark string 'jalca v425'", () => {
    // The acceptance criterion is the exact rendered string, not just the
    // numeric tag: the wordmark must read `jalca v425`.
    expect(JALCA_WORDMARK).toBe("jalca v425");
  });

  it("composes the wordmark string from the version constant", () => {
    expect(JALCA_VERSION).toMatch(/^v\d+$/);
    expect(JALCA_WORDMARK).toBe(`jalca ${JALCA_VERSION}`);
  });
});
