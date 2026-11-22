import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cover for the three original hand-drawn spell image assets (spell ids 3, 4
 * and 6: Bendika, Bendika Tah, Mayban Dadoy Tron).
 *
 * The acceptance criteria require the three PNGs to exist at
 * `src/frontend/public/assets/spells/3.png`, `4.png` and `6.png`, to be
 * referenced by the CSS overlay classes `.spell-effect-3/4/6`, and for no
 * AI-generated artwork to be used for these spells.
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

const ORIGINAL_IMAGE_IDS = [3, 4, 6] as const;

describe("original spell image assets", () => {
  it("ships a non-empty PNG for each of the three spells, named by id", () => {
    for (const id of ORIGINAL_IMAGE_IDS) {
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

  it("uses no AI-generated artwork for the three spells", () => {
    // The user requires only their own uploaded originals. No generated
    // (`.dim_WxH`) asset may exist for these spell ids.
    for (const id of ORIGINAL_IMAGE_IDS) {
      const generated = resolve(GENERATED_ASSET_DIR, `${id}.dim_512x512.png`);
      expect(
        existsSync(generated),
        `${id}.dim_512x512.png should not exist`,
      ).toBe(false);
    }
  });

  it("maps each original spell overlay class to its id-named asset in the CSS", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    for (const id of ORIGINAL_IMAGE_IDS) {
      expect(css).toMatch(
        new RegExp(
          `\\.spell-effect-${id}\\s*\\{[^}]*url\\(["']?/assets/spells/${id}\\.png["']?\\)`,
        ),
      );
    }
  });
});
