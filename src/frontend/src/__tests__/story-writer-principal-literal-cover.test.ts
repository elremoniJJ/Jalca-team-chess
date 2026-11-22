import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cover for the accepted Story sole-writer principal change.
 *
 * The sole Story writer/editor principal is hardcoded in TWO places that must
 * change together:
 *   - the backend writer gate `soleWriter()` in src/backend/lib/story.mo, which
 *     is authoritative and rejects every other caller; and
 *   - the frontend `WRITER_PRINCIPAL` constant in
 *     src/frontend/src/components/StoryWindow.tsx, which only decides whether
 *     the composer UI is shown.
 *
 * The behavioral tests (story-window-cover, story-window-signin-affordance,
 * story-window-full-principal-display, and the PocketIC
 * story-writer-append-cover lane) prove the gate semantics against the new
 * value. This file adds the exact-literal pin the acceptance criteria state:
 * both production sources must carry exactly
 * `bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-m6mq-uonbp-mpsg7-rstfj-6ae`, and the
 * frontend constant must not still carry the previous value. A future edit that
 * changes one side without the other — the exact failure mode this change
 * exists to fix — fails here.
 *
 * The sources are read as text rather than imported: the backend is Motoko and
 * cannot be imported into the jsdom suite, and the frontend constant is not
 * exported. Reading the literal production artifact is exactly the thing under
 * test. Paths are resolved from the frontend package root (the working
 * directory the `test` script runs in), matching the existing
 * vite-build-config-characterization test.
 */

const WRITER_PRINCIPAL =
  "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae";
const PREVIOUS_WRITER_PRINCIPAL =
  "uxbdn-wxhzx-x7rx5-4dgoz-znnxe-x3fqi-mrgbz-wwal5-stftm-3ejsu-xae";

const frontendSource = readFileSync(
  resolve(process.cwd(), "src/components/StoryWindow.tsx"),
  "utf8",
);
const backendSource = readFileSync(
  resolve(process.cwd(), "..", "backend", "lib", "story.mo"),
  "utf8",
);

describe("Story sole-writer principal literal", () => {
  it("hardcodes exactly the accepted principal in the frontend WRITER_PRINCIPAL constant", () => {
    // The constant is declared as `const WRITER_PRINCIPAL = "<literal>";`.
    const match = frontendSource.match(
      /const\s+WRITER_PRINCIPAL\s*=\s*"([^"]+)"/,
    );
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(WRITER_PRINCIPAL);
  });

  it("hardcodes exactly the accepted principal in the backend soleWriter() gate", () => {
    // The gate is `Principal.fromText("<literal>")` inside soleWriter().
    const match = backendSource.match(
      /func\s+soleWriter\s*\(\s*\)\s*:\s*Principal\s*\{[\s\S]*?Principal\.fromText\("([^"]+)"\)/,
    );
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(WRITER_PRINCIPAL);
  });

  it("no longer carries the previous writer principal in either source", () => {
    expect(frontendSource).not.toContain(PREVIOUS_WRITER_PRINCIPAL);
    expect(backendSource).not.toContain(PREVIOUS_WRITER_PRINCIPAL);
  });

  it("keeps the frontend constant and the backend gate on the same value", () => {
    const frontendMatch = frontendSource.match(
      /const\s+WRITER_PRINCIPAL\s*=\s*"([^"]+)"/,
    );
    const backendMatch = backendSource.match(
      /func\s+soleWriter\s*\(\s*\)\s*:\s*Principal\s*\{[\s\S]*?Principal\.fromText\("([^"]+)"\)/,
    );
    expect(frontendMatch?.[1]).toBe(backendMatch?.[1]);
  });
});
