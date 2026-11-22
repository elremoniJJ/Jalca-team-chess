import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cover for the spell-effect asset wiring.
 *
 * The request wires five supplied fire-spell effect PNGs (spell ids 10-14:
 * Tia Lua, Cau Lua, Hoa Boc, Buc Tung Lua, Mua Lua) plus a reserved
 * shield-blocked image into the board overlay. The acceptance criteria require
 * the five PNGs to be copied VERBATIM into
 * `src/frontend/public/assets/spells/` named by spell id (10.png ... 14.png)
 * with no renaming or redrawing, and a reserved blocked-image filename in the
 * same folder used when a cast is cancelled by a shield.
 *
 * This file pins the on-disk artifacts and the CSS mapping from each overlay
 * class to its asset. It does not render the board (that is covered in
 * chessboard-spell-effect-overlay-cover.test.tsx) and does not exercise the
 * backend.
 *
 * Paths are resolved from the frontend package root (the working directory the
 * `test` script runs in) rather than from `import.meta.url`, which Vitest
 * rewrites to a non-file URL under jsdom.
 */

const SPELL_ASSET_DIR = resolve(process.cwd(), "public/assets/spells");

const SPELL_IDS = [10, 11, 12, 13, 14] as const;

describe("spell-effect assets", () => {
  it("ships a non-empty PNG for each of the five fire spells, named by id", () => {
    for (const id of SPELL_IDS) {
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

  it("ships a non-empty reserved blocked image", () => {
    const path = resolve(SPELL_ASSET_DIR, "blocked.png");
    const stat = statSync(path);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("maps each spell-effect class to its id-named asset in the CSS", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    for (const id of SPELL_IDS) {
      expect(css).toMatch(
        new RegExp(
          `\\.spell-effect-${id}\\s*\\{[^}]*url\\(["']?/assets/spells/${id}\\.png["']?\\)`,
        ),
      );
    }
  });

  it("maps the blocked overlay class to the reserved blocked asset", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    expect(css).toMatch(
      /\.spell-effect-blocked\s*\{[^}]*url\(["']?\/assets\/spells\/blocked\.png["']?\)/,
    );
  });

  it("ships a non-empty supplied Subao Ve image", () => {
    const path = resolve(SPELL_ASSET_DIR, "subao-ve.png");
    const stat = statSync(path);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
    const header = readFileSync(path).subarray(0, 8);
    expect(
      header.equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
      "subao-ve.png should have a PNG signature",
    ).toBe(true);
  });

  it("ships a non-empty supplied Spell blocked image", () => {
    const path = resolve(SPELL_ASSET_DIR, "spell-blocked.png");
    const stat = statSync(path);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
    const header = readFileSync(path).subarray(0, 8);
    expect(
      header.equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
      "spell-blocked.png should have a PNG signature",
    ).toBe(true);
  });

  it("maps the Subao Ve overlay class to the supplied Subao Ve asset", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    expect(css).toMatch(
      /\.spell-effect-subao-ve\s*\{[^}]*url\(["']?\/assets\/spells\/subao-ve\.png["']?\)/,
    );
  });

  it("maps the Spell blocked overlay class to the supplied Spell blocked asset", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    expect(css).toMatch(
      /\.spell-effect-spell-blocked\s*\{[^}]*url\(["']?\/assets\/spells\/spell-blocked\.png["']?\)/,
    );
  });
});
