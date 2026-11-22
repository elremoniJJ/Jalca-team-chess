import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Characterization of the STYLESHEET and ASSET contract ADJACENT to the
 * per-square death-square skull marker change, taken BEFORE the production
 * edit.
 *
 * The request adds a per-square skull marker layer to the board: the
 * Chessboard already renders elements carrying the `spell-marker` /
 * `spell-marker-fade` classes, and the acceptance criteria require the built
 * stylesheet to carry the matching rules — `.spell-marker` with the
 * death-square background image and the `@keyframes spell-marker-fade`
 * animation — so the marker layer is styled rather than unstyled.
 *
 * This file pins the on-disk asset and the CSS rules the marker layer depends
 * on. It does NOT render the board (that is covered by the sibling
 * characterization files) and does NOT exercise the backend.
 *
 * Paths are resolved from the frontend package root (the working directory the
 * `test` script runs in) rather than from `import.meta.url`, which Vitest
 * rewrites to a non-file URL under jsdom.
 */

const SPELL_ASSET_DIR = resolve(process.cwd(), "public/assets/spells");
const CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

describe("death-square skull marker stylesheet (adjacent characterization)", () => {
  it("ships a non-empty death-square PNG asset", () => {
    const path = resolve(SPELL_ASSET_DIR, "death-square.png");
    const stat = statSync(path);
    expect(stat.isFile(), "death-square.png should be a file").toBe(true);
    expect(stat.size, "death-square.png should not be empty").toBeGreaterThan(
      0,
    );
    // PNG magic number — the file is a real PNG, not a renamed placeholder.
    const header = readFileSync(path).subarray(0, 8);
    expect(
      header.equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
      "death-square.png should have a PNG signature",
    ).toBe(true);
  });

  it("maps the .spell-marker class to the death-square background image", () => {
    expect(CSS).toMatch(
      /\.spell-marker\s*\{[^}]*url\(["']?\/assets\/spells\/death-square\.png["']?\)/,
    );
  });

  it("keeps the .spell-marker layer non-interactive and absolutely positioned", () => {
    // The marker is a board-layer overlay: it must not swallow board clicks and
    // must be positioned from the board's own geometry.
    const rule = CSS.match(/\.spell-marker\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? "";
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/pointer-events:\s*none/);
  });

  it("declares the spell-marker-fade animation and its keyframes", () => {
    expect(CSS).toMatch(
      /\.spell-marker-fade\s*\{[^}]*animation:\s*spell-marker-fade\b/,
    );
    expect(CSS).toMatch(/@keyframes\s+spell-marker-fade\s*\{/);
  });

  it("keeps the existing spell-effect overlay rules intact", () => {
    // The marker layer is additive: the pre-existing spell image overlay rules
    // must remain so the two layers coexist.
    expect(CSS).toMatch(/\.spell-effect-overlay\s*\{/);
    expect(CSS).toMatch(/@keyframes\s+spell-effect-fade\s*\{/);
    expect(CSS).toMatch(
      /\.spell-effect-10\s*\{[^}]*url\(["']?\/assets\/spells\/10\.png["']?\)/,
    );
  });
});
