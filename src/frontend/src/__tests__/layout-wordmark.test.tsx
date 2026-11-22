import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The Layout imports InformationModal, which transitively pulls in
// @caffeineai/core-infrastructure via CanisterCyclesGauge. That package fails
// to resolve its own submodules in the jsdom test environment (a pre-existing
// dependency issue), so mock the modal to a marker. The wordmark test never
// opens the modal, so only the import needs to resolve.
vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));

import { Layout } from "@/components/Layout";
import { JALCA_WORDMARK } from "@/lib/version";

// The Layout brand buffer carries a deterministic `data-ocid` marker rather
// than `data-testid`. Configure the test-id attribute so getByTestId can
// target it semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the Layout header wordmark integration.
 *
 * The request bumps the published jalca version (v250 -> v252) by editing the
 * single JALCA_VERSION constant in lib/version.ts. The Wordmark component is
 * the shared renderer used by BOTH the Login_Page header (route "/") and the
 * Main_Page header (Layout's top brand buffer). The component-level rendering
 * contract is covered in wordmark.test.tsx; this test protects the Layout
 * integration that must remain unchanged across the bump — the Main_Page
 * header actually renders the shared Wordmark with the composed string, so a
 * future edit that stops wiring the Wordmark into the Layout header (or
 * hardcodes a stale version there) is caught.
 */
describe("Layout header wordmark", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders the shared wordmark in the top brand buffer", () => {
    render(
      <Layout
        onLogout={() => {}}
        windows={{
          board: <div>board</div>,
        }}
      />,
    );

    const buffer = screen.getByTestId("brand.buffer.top");
    expect(buffer).toBeInTheDocument();
    expect(within(buffer).getByText(JALCA_WORDMARK)).toBeInTheDocument();
  });

  it("renders the accepted 'jalca v425' in the top brand buffer", () => {
    render(
      <Layout
        onLogout={() => {}}
        windows={{
          board: <div>board</div>,
        }}
      />,
    );

    // The acceptance criterion is the exact visible string in the main
    // header, so assert the literal rather than only the derived constant.
    const buffer = screen.getByTestId("brand.buffer.top");
    expect(within(buffer).getByText("jalca v425")).toBeInTheDocument();
  });
});
