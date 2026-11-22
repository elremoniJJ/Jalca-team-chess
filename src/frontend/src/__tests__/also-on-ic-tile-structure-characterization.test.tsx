import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AlsoOnIcWindow } from "@/components/AlsoOnIcWindow";

/**
 * Characterization of the "Also on the IC" tile STRUCTURE, taken BEFORE the
 * request replaces the piko thumbnail and points its link at
 * www.piko.network.
 *
 * The piko image and its exact destination URL are the intentional change, so
 * this file deliberately does NOT pin either. What it protects is the tile
 * contract the change must not disturb:
 *
 *   - the row still holds exactly six tiles — three linked and three
 *     "open to suggestions" placeholders;
 *   - every linked tile still opens in a NEW browser tab with
 *     target="_blank" and rel="noopener noreferrer";
 *   - the placeholders remain non-links carrying the "open to suggestions"
 *     label;
 *   - the piko tile still exists as a linked tile with a thumbnail image and
 *     a caption, so replacing its asset/link cannot silently drop the tile.
 *
 * The window is seeded open so the body is mounted regardless of the
 * first-visit default (which this request intentionally changes). No actor or
 * network access is involved.
 */

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderOpen() {
  window.localStorage.setItem("tco-also-on-ic-open", "true");
  return render(<AlsoOnIcWindow />);
}

describe("AlsoOnIcWindow tile structure", () => {
  it("renders six tiles: three linked and three open-to-suggestions placeholders", () => {
    const { container } = renderOpen();

    const tiles = container.querySelectorAll('[data-ocid^="also_on_ic.tile."]');
    expect(tiles).toHaveLength(6);

    const links = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(
        'a[data-ocid^="also_on_ic.tile."]',
      ),
    );
    expect(links).toHaveLength(3);

    const placeholders = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-ocid^="also_on_ic.tile.suggestion-"]',
      ),
    );
    expect(placeholders).toHaveLength(3);
    for (const tile of placeholders) {
      expect(tile.tagName).not.toBe("A");
      expect(tile.textContent).toContain("open to suggestions");
    }
  });

  it("opens every linked tile in a new browser tab", () => {
    const { container } = renderOpen();

    const links = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(
        'a[data-ocid^="also_on_ic.tile."]',
      ),
    );
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("keeps the piko tile as a linked tile with a thumbnail image and caption", () => {
    const { container } = renderOpen();

    const piko = container.querySelector<HTMLAnchorElement>(
      'a[data-ocid="also_on_ic.tile.piko"]',
    );
    expect(piko).not.toBeNull();
    // The tile is a link that opens in a new tab.
    expect(piko).toHaveAttribute("target", "_blank");
    expect(piko).toHaveAttribute("rel", "noopener noreferrer");
    // It still carries a thumbnail image and a visible caption.
    const image = piko?.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBeTruthy();
    expect(piko?.textContent).toContain("piko.network");
  });
});
