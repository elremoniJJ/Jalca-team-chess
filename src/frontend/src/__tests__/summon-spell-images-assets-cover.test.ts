import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cover for the three new summon-spell image assets (spell ids 23-25:
 * Lazarus, Cuoclot Sac Wonmuc Rook, Anne Boleyn).
 *
 * The acceptance criteria require the three PNGs to exist at
 * `src/frontend/public/assets/spells/23.png`, `24.png` and `25.png`, to be
 * referenced by the CSS overlay classes `.spell-effect-23/24/25` (the image
 * shown after the 3-frame burning pre-roll), and for the existing spell
 * overlay classes to keep their own assets.
 *
 * This file pins the on-disk artifacts and the CSS mapping from each overlay
 * class to its asset. It does not render the board or the collection UI (those
 * are covered in the sibling cover files) and does not exercise the backend.
 *
 * Paths are resolved from the frontend package root (the working directory the
 * `test` script runs in) rather than from `import.meta.url`, which Vitest
 * rewrites to a non-file URL under jsdom.
 */

const SPELL_ASSET_DIR = resolve(process.cwd(), "public/assets/spells");

const SUMMON_IMAGE_IDS = [23, 24, 25] as const;

/** The existing spell overlay classes whose assets must be unchanged. */
const EXISTING_OVERLAY_IDS = [3, 4, 6, 10, 11, 12, 13, 14, 15, 16, 17] as const;

describe("summon spell-effect assets", () => {
  it("ships a non-empty PNG for each summon spell, named by id", () => {
    for (const id of SUMMON_IMAGE_IDS) {
      const path = resolve(SPELL_ASSET_DIR, `${id}.png`);
      const stat = statSync(path);
      expect(stat.isFile(), `${id}.png should be a file`).toBe(true);
      expect(stat.size, `${id}.png should not be empty`).toBeGreaterThan(0);
      // PNG magic number — the file is a real PNG, not a renamed placeholder.
      const header = readFileSync(path).subarray(0, 8);
      expect(
        header.equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ),
        `${id}.png should have a PNG signature`,
      ).toBe(true);
    }
  });

  it("maps each summon overlay class to its id-named asset in the CSS", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    for (const id of SUMMON_IMAGE_IDS) {
      expect(css).toMatch(
        new RegExp(
          `\\.spell-effect-${id}\\s*\\{[^}]*url\\(["']?/assets/spells/${id}\\.png["']?\\)`,
        ),
      );
    }
  });

  it("keeps the existing spell overlay classes mapped to their own assets", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    for (const id of EXISTING_OVERLAY_IDS) {
      expect(css).toMatch(
        new RegExp(
          `\\.spell-effect-${id}\\s*\\{[^}]*url\\(["']?/assets/spells/${id}\\.png["']?\\)`,
        ),
      );
    }
  });
});
