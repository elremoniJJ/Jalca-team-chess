import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Wordmark } from "@/components/Wordmark";
import { JALCA_VERSION, JALCA_WORDMARK } from "@/lib/version";

/**
 * Characterization of the shared wordmark COMPOSITION SEAM, taken BEFORE the
 * version constant is bumped to v260.
 *
 * The request bumps the published jalca version to v260 by editing the single
 * `JALCA_VERSION` constant in lib/version.ts. The bump itself is an
 * intentional change, so this file deliberately does NOT pin the numeric
 * version. What it protects is the invariant that must survive every bump:
 *
 *   - `JALCA_WORDMARK` is always composed as `jalca ${JALCA_VERSION}` from the
 *     single constant, so a bump is a one-line edit and no consumer can drift;
 *   - `JALCA_VERSION` keeps the `v<digits>` shape;
 *   - the Wordmark component renders the composed string verbatim as both its
 *     visible text and its `aria-label`, regardless of element type or props.
 *
 * The version-pinned assertions live in version.test.ts / wordmark.test.tsx /
 * login-wordmark.test.tsx / layout-wordmark.test.tsx and are expected to be
 * updated to v260 by the bump; this file is the version-agnostic backstop.
 */
describe("jalca wordmark composition seam", () => {
  afterEach(() => {
    cleanup();
  });

  it("composes the wordmark string from the single version constant", () => {
    expect(JALCA_WORDMARK).toBe(`jalca ${JALCA_VERSION}`);
  });

  it("keeps the version tag in the v<digits> shape", () => {
    expect(JALCA_VERSION).toMatch(/^v\d+$/);
  });

  it("renders the composed wordmark string as visible text and aria-label", () => {
    render(<Wordmark />);
    const el = screen.getByText(JALCA_WORDMARK);
    expect(el).toHaveAttribute("aria-label", JALCA_WORDMARK);
  });

  it("renders as a span by default and as the requested element type", () => {
    render(<Wordmark />);
    expect(screen.getByText(JALCA_WORDMARK).tagName).toBe("SPAN");

    cleanup();
    render(<Wordmark as="h1" />);
    expect(screen.getByText(JALCA_WORDMARK).tagName).toBe("H1");
  });

  it("passes through className, data-ocid, and data-theme markers", () => {
    render(
      <Wordmark
        className="login-wordmark"
        data-ocid="login.wordmark"
        data-theme="dark"
      />,
    );
    const el = screen.getByText(JALCA_WORDMARK);
    expect(el).toHaveClass("login-wordmark");
    expect(el).toHaveAttribute("data-ocid", "login.wordmark");
    expect(el).toHaveAttribute("data-theme", "dark");
  });
});
