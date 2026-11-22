import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Wordmark } from "@/components/Wordmark";
import { JALCA_VERSION, JALCA_WORDMARK } from "@/lib/version";

/**
 * Characterization of the Wordmark COMPONENT RENDER CONTRACT, taken BEFORE the
 * published version constant is bumped from v404 to v421.
 *
 * The bump itself is the intentional change, so this file deliberately does
 * NOT pin the numeric version and does NOT assert the obsolete `jalca v404`
 * literal. What it protects is the component-level behavior the bump relies on
 * and must not disturb, independent of the version value:
 *
 *   - the component renders the composed `JALCA_WORDMARK` string verbatim as
 *     its visible text, never a hardcoded literal of its own;
 *   - the `aria-label` always equals the visible text, so assistive technology
 *     announces exactly the published version the sighted user sees;
 *   - the component tracks the single `JALCA_VERSION` constant, so a one-line
 *     bump reaches every instance without a component edit.
 *
 * Every expected string derives from `JALCA_VERSION` at run time, so the file
 * stays green across the bump while still failing if the component hardcodes a
 * stale version or drifts its aria-label from its text. The version-pinned
 * assertions live in wordmark.test.tsx / wordmark-v398-cover.test.tsx /
 * wordmark-v398-both-headers-cover.test.tsx / layout-wordmark.test.tsx /
 * login-wordmark.test.tsx / openchat-icon-cover.test.tsx and are expected to
 * be updated to v421 by the bump; this file is the version-agnostic backstop
 * for the component's own render contract.
 */
describe("wordmark component render contract", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the composed wordmark string as its visible text", () => {
    render(<Wordmark />);
    expect(screen.getByText(JALCA_WORDMARK)).toBeInTheDocument();
  });

  it("keeps the aria-label equal to the visible text", () => {
    render(<Wordmark />);
    const el = screen.getByText(JALCA_WORDMARK);
    expect(el).toHaveAttribute("aria-label", JALCA_WORDMARK);
    expect(el.getAttribute("aria-label")).toBe(el.textContent);
  });

  it("tracks the single version constant rather than a hardcoded literal", () => {
    // The rendered text must equal the constant-derived string, so a component
    // that hardcoded a stale version would fail here after the bump.
    render(<Wordmark />);
    const el = screen.getByText(JALCA_WORDMARK);
    expect(el.textContent).toBe(`jalca ${JALCA_VERSION}`);
    expect(el).toHaveAttribute("aria-label", `jalca ${JALCA_VERSION}`);
  });

  it("renders the same constant-derived string for every element type", () => {
    render(<Wordmark as="h1" />);
    const heading = screen.getByText(JALCA_WORDMARK);
    expect(heading.tagName).toBe("H1");
    expect(heading.textContent).toBe(`jalca ${JALCA_VERSION}`);
    expect(heading).toHaveAttribute("aria-label", `jalca ${JALCA_VERSION}`);

    cleanup();
    render(<Wordmark as="span" />);
    const span = screen.getByText(JALCA_WORDMARK);
    expect(span.tagName).toBe("SPAN");
    expect(span.textContent).toBe(`jalca ${JALCA_VERSION}`);
    expect(span).toHaveAttribute("aria-label", `jalca ${JALCA_VERSION}`);
  });
});
