import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Wordmark } from "@/components/Wordmark";
import { JALCA_WORDMARK } from "@/lib/version";

/**
 * Characterization of the Wordmark component.
 *
 * The request bumps the published jalca version (v250 -> v252) by editing the
 * single JALCA_VERSION constant in lib/version.ts. The Wordmark component is
 * the shared renderer used by BOTH the Login_Page header (route "/") and the
 * Main_Page header (Layout's top brand buffer), and it renders the composed
 * JALCA_WORDMARK string verbatim. These tests protect the rendering contract
 * that must remain unchanged across the bump: the component always renders
 * the single composed wordmark string as both its visible text and its
 * aria-label, regardless of which element type or className it is given.
 */
describe("Wordmark", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the composed wordmark string as visible text and aria-label", () => {
    render(<Wordmark />);
    const el = screen.getByText(JALCA_WORDMARK);
    expect(el).toHaveAttribute("aria-label", JALCA_WORDMARK);
  });

  it("renders the accepted version tag 'jalca v425' verbatim", () => {
    // The acceptance criterion is the exact visible string. Asserting the
    // literal (rather than only the derived JALCA_WORDMARK) catches a
    // regression that changes the constant's composition or hardcodes a
    // stale version in the component.
    render(<Wordmark />);
    const el = screen.getByText("jalca v425");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-label", "jalca v425");
  });

  it("renders as a span by default", () => {
    render(<Wordmark />);
    expect(screen.getByText(JALCA_WORDMARK).tagName).toBe("SPAN");
  });

  it("renders as the requested element type (h1 for the login header)", () => {
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
