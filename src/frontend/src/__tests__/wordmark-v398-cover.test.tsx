import "@testing-library/jest-dom/vitest";
import { cleanup, configure, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Wordmark } from "@/components/Wordmark";
import { JALCA_VERSION, JALCA_WORDMARK } from "@/lib/version";

// The Wordmark render sites carry a deterministic `data-ocid` marker rather
// than `data-testid`. Configure the test-id attribute so getByTestId can
// target it semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted wordmark bump to v425.
 *
 * The request bumps the published jalca version to v425. The version lives in
 * the single `JALCA_VERSION` constant in lib/version.ts and is composed into
 * `JALCA_WORDMARK`, which the shared Wordmark component renders verbatim as
 * both its text content and its `aria-label`. These tests pin the accepted
 * value at the display seam so a regression back to an older tag (or a
 * composition drift) is caught.
 */
describe("jalca wordmark v425 cover", () => {
  afterEach(() => {
    cleanup();
  });

  it("pins the accepted version constant to v425", () => {
    expect(JALCA_VERSION).toBe("v425");
    expect(JALCA_WORDMARK).toBe("jalca v425");
  });

  it("renders the accepted 'jalca v425' as text and aria-label", () => {
    render(<Wordmark data-ocid="wordmark.cover" />);

    const wordmark = screen.getByTestId("wordmark.cover");
    expect(wordmark).toHaveTextContent("jalca v425");
    expect(wordmark).toHaveAttribute("aria-label", "jalca v425");
  });

  it("keeps the wordmark composed from the single version constant", () => {
    expect(JALCA_WORDMARK).toBe(`jalca ${JALCA_VERSION}`);
    expect(JALCA_VERSION).toMatch(/^v\d+$/);
  });
});
