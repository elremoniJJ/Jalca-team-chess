import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Characterization of the STYLESHEET contract ADJACENT to the
 * transformed-knight glow color change, taken BEFORE the production edit.
 *
 * The request intentionally changes the color of the transformed-knight glow
 * overlay `.spell-transformed-glow` from yellow to pink. That color is the
 * intentional change, so it is deliberately NOT pinned here — asserting the
 * current yellow hue would characterize the change itself.
 *
 * What IS protected is the surrounding stylesheet contract the change must not
 * disturb:
 *   - the PERMANENT summoned-piece glow `.piece-glow-summoned` is a DIFFERENT
 *     class and must stay yellow (hue 95). The request only recolors the
 *     transformed overlay, not the permanent summoned glow, so a summoned
 *     piece must still read yellow;
 *   - the transformed overlay stays a distinct class from the permanent
 *     summoned glow, so recoloring one never recolors the other;
 *   - the transformed overlay keeps its structural contract: absolutely
 *     positioned, non-interactive, above the board, and painted by the box
 *     itself (a radial background plus box-shadow) rather than a drop-shadow
 *     filter, because the overlay has no children.
 *
 * jsdom does not apply the app's `index.css`, so the CSS half of the change is
 * pinned by reading the stylesheet source. Paths are resolved from the frontend
 * package root (the working directory the `test` script runs in) rather than
 * from `import.meta.url`, which Vitest rewrites to a non-file URL under jsdom.
 */

const CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

/** The declaration body of a single-class rule, or null when absent. */
function ruleBody(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? null;
}

describe("transformed-knight glow stylesheet (adjacent characterization)", () => {
  it("keeps the permanent summoned-piece glow yellow (hue 95)", () => {
    // The permanent summoned glow is a separate class from the transformed
    // overlay. The request recolors only the transformed overlay, so this one
    // must stay yellow: oklch hue 95.
    const body = ruleBody(".piece-glow-summoned");
    expect(body).not.toBeNull();
    expect(body).toMatch(/oklch\(0\.9 0\.19 95\b/);
  });

  it("keeps the transformed overlay a distinct class from the permanent glow", () => {
    // Two separate rules: recoloring one must never recolor the other.
    expect(ruleBody(".piece-glow-summoned")).not.toBeNull();
    expect(ruleBody(".spell-transformed-glow")).not.toBeNull();
    expect(CSS).not.toMatch(
      /\.piece-glow-summoned\s*,\s*\.spell-transformed-glow/,
    );
    expect(CSS).not.toMatch(
      /\.spell-transformed-glow\s*,\s*\.piece-glow-summoned/,
    );
  });

  it("keeps the transformed overlay absolutely positioned and non-interactive", () => {
    // The overlay is a board-layer sibling: it must not swallow board clicks
    // and must be positioned from the board's own geometry.
    const body = ruleBody(".spell-transformed-glow");
    expect(body).not.toBeNull();
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/pointer-events:\s*none/);
    expect(body).toMatch(/z-index:\s*20/);
  });

  it("paints the transformed overlay with a background and box-shadow, not a filter", () => {
    // The overlay has no children, so a drop-shadow filter alone would paint
    // nothing. The glow must be painted by the box itself.
    const body = ruleBody(".spell-transformed-glow");
    expect(body).not.toBeNull();
    expect(body).toMatch(/background-image:\s*radial-gradient/);
    expect(body).toMatch(/box-shadow:/);
    expect(body).not.toMatch(/filter:\s*drop-shadow/);
  });

  it("keeps the transformed overlay's glow in a single hue family", () => {
    // The overlay's radial background and box-shadow must agree on one hue, so
    // the recolor is a single coherent change rather than a mixed-hue overlay.
    // The hue VALUE is intentionally not pinned (the request changes it).
    const body = ruleBody(".spell-transformed-glow");
    expect(body).not.toBeNull();
    const hues = Array.from(
      body?.matchAll(/oklch\([^)]*?\s(\d+(?:\.\d+)?)\s*\//g) ?? [],
    ).map((m) => m[1]);
    expect(hues.length).toBeGreaterThan(0);
    expect(new Set(hues).size).toBe(1);
  });
});

/**
 * Cover for the accepted transformed-knight glow COLOR change.
 *
 * The request recolors the Newkai Dodan transformed-knight overlay
 * `.spell-transformed-glow` from yellow to pink. The adjacent characterization
 * above deliberately leaves the hue unpinned; this block pins the accepted
 * value so a future edit cannot silently revert it to yellow.
 *
 * The permanent summoned-piece glow `.piece-glow-summoned` is a DIFFERENT class
 * and must stay yellow: the request recolors only the transformed overlay, so a
 * summoned piece still reads yellow. jsdom does not apply `index.css`, so the
 * contract is read from the stylesheet source, exactly as the characterization
 * block does.
 */
describe("transformed-knight glow color (cover)", () => {
  it("paints the transformed overlay pink (hue 350), not yellow (hue 95)", () => {
    const body = ruleBody(".spell-transformed-glow");
    expect(body).not.toBeNull();
    // Pink is oklch hue 350. Every oklch colour in the rule must use it.
    const hues = Array.from(
      body?.matchAll(/oklch\([^)]*?\s(\d+(?:\.\d+)?)\s*\//g) ?? [],
    ).map((m) => m[1]);
    expect(hues.length).toBeGreaterThan(0);
    for (const hue of hues) {
      expect(hue).toBe("350");
    }
    // The old yellow hue must be gone from the transformed overlay entirely.
    expect(body).not.toMatch(/oklch\([^)]*?\s95\s*\//);
  });

  it("keeps the permanent summoned-piece glow yellow (hue 95)", () => {
    // The recolor is scoped to the transformed overlay; the permanent summoned
    // glow must not have been recolored along with it.
    const body = ruleBody(".piece-glow-summoned");
    expect(body).not.toBeNull();
    expect(body).toMatch(/oklch\(0\.9 0\.19 95\b/);
    expect(body).not.toMatch(/oklch\([^)]*?\s350\s*\//);
  });
});
