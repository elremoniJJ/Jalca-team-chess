import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cover for the three Minor removal spell image assets (spell ids 15-17:
 * Chila Cao, Handom Zitie Zumuc, Bamburgh).
 *
 * The acceptance criteria require the three PNGs to exist at
 * `src/frontend/public/assets/spells/15.png`, `16.png` and `17.png`, to be
 * referenced by the CSS overlay classes `.spell-effect-15/16/17`, and for the
 * previous AI-generated originals under `public/assets/generated/` to be gone.
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
const GENERATED_ASSET_DIR = resolve(process.cwd(), "public/assets/generated");

const MINOR_REMOVAL_IDS = [15, 16, 17] as const;

describe("Minor removal spell-effect assets", () => {
  it("ships a non-empty PNG for each Minor removal spell, named by id", () => {
    for (const id of MINOR_REMOVAL_IDS) {
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

  it("removes the previous AI-generated originals for the three spells", () => {
    for (const id of MINOR_REMOVAL_IDS) {
      const generated = resolve(GENERATED_ASSET_DIR, `${id}.dim_512x512.png`);
      expect(
        existsSync(generated),
        `${id}.dim_512x512.png should have been deleted`,
      ).toBe(false);
    }
  });

  it("maps each Minor removal overlay class to its id-named asset in the CSS", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    for (const id of MINOR_REMOVAL_IDS) {
      expect(css).toMatch(
        new RegExp(
          `\\.spell-effect-${id}\\s*\\{[^}]*url\\(["']?/assets/spells/${id}\\.png["']?\\)`,
        ),
      );
    }
  });

  it("keeps the existing fire-spell overlay classes mapped to their assets", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    for (const id of [10, 11, 12, 13, 14] as const) {
      expect(css).toMatch(
        new RegExp(
          `\\.spell-effect-${id}\\s*\\{[^}]*url\\(["']?/assets/spells/${id}\\.png["']?\\)`,
        ),
      );
    }
  });
});
