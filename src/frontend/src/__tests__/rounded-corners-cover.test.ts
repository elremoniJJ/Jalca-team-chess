import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cover for the rounded-corners styling change.
 *
 * The accepted change is CSS/visual only: it softens the hard-edged white
 * squares that the user-supplied line-art images would otherwise show. Three
 * surfaces gain a border-radius, and the wordmark version is bumped:
 *
 *   1. the OpenChat channel icon image (`.openchat-icon-img`) — the PNG carries
 *      an opaque white background, so the image itself is rounded while the
 *      white background is preserved;
 *   2. the spell-effect overlay (`.spell-effect-overlay`) — the shared overlay
 *      box that carries every per-spell background image (ids 10-14 plus the
 *      reserved blocked image);
 *   3. the per-square Balls board backgrounds
 *      (`.board-square-opponent-image-hairy` / `-veiny` / `-shiny`).
 *
 * jsdom does not apply the app's `index.css`, so the CSS half of the change is
 * asserted against the stylesheet source — the same approach the spell-effect
 * asset cover and the header no-clip cover use. These tests pin the accepted
 * styling contract: a regression that drops a border-radius, or that changes
 * the white-background image to a transparent one, fails here.
 *
 * This file does not measure real pixel rendering — jsdom has no layout engine
 * — so it cannot prove the corners look soft in a browser. It pins the
 * stylesheet contract that produces that outcome.
 */

const CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

/** Extract the body of the first rule whose selector matches exactly. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(
    new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`),
  );
  return match?.[1] ?? "";
}

describe("rounded corners styling", () => {
  it("rounds the OpenChat icon image itself so its white background is not a hard square", () => {
    const img = ruleBody(".openchat-icon-img");
    expect(img).not.toBe("");
    // The image itself carries the radius (not only the wrapping link), so the
    // opaque white PNG background gets soft corners.
    expect(img).toMatch(/border-radius\s*:\s*[^;]+;/);
    // The white background is preserved: the image is not made transparent or
    // clipped away.
    expect(img).not.toMatch(/opacity\s*:\s*0\s*;/);
    expect(img).not.toMatch(/display\s*:\s*none/);
  });

  it("rounds the OpenChat icon link container as well", () => {
    const link = ruleBody(".openchat-icon");
    expect(link).not.toBe("");
    expect(link).toMatch(/border-radius\s*:\s*[^;]+;/);
  });

  it("rounds the spell-effect overlay that carries every spell image", () => {
    const overlay = ruleBody(".spell-effect-overlay");
    expect(overlay).not.toBe("");
    expect(overlay).toMatch(/border-radius\s*:\s*[^;]+;/);
    // The overlay still owns the shared background-image layer contract.
    expect(overlay).toMatch(/background-size\s*:\s*contain/);
    expect(overlay).toMatch(/pointer-events\s*:\s*none/);
  });

  it("rounds each per-square Balls board background", () => {
    for (const slug of ["hairy", "veiny", "shiny"]) {
      const body = ruleBody(`.board-square-opponent-image-${slug}`);
      expect(body, `${slug} rule should exist`).not.toBe("");
      expect(body, `${slug} should be rounded`).toMatch(
        /border-radius\s*:\s*[^;]+;/,
      );
      // The image layer contract is unchanged: it is a background-image only.
      expect(body).toMatch(/background-image\s*:\s*url\(/);
      expect(body).toMatch(/background-size\s*:\s*cover/);
    }
  });

  it("keeps the per-spell effect images mapped to their id-named assets", () => {
    // The rounded overlay must not have displaced the per-spell image mapping.
    for (const id of [10, 11, 12, 13, 14]) {
      const body = ruleBody(`.spell-effect-${id}`);
      expect(body, `spell-effect-${id} rule should exist`).not.toBe("");
      expect(body).toMatch(
        new RegExp(`url\\(["']?/assets/spells/${id}\\.png["']?\\)`),
      );
    }
    const blocked = ruleBody(".spell-effect-blocked");
    expect(blocked).toMatch(/url\(["']?\/assets\/spells\/blocked\.png["']?\)/);
  });
});
