import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// The InformationModal imports CanisterCyclesGauge, whose useCanisterCycles
// hook makes a real network call to the IC blackhole canister. That is an
// external network call we must never make in a test, and the modal's
// internals are out of scope for this cover. Mock the modal to a marker so
// the Info button's click behavior (opening the modal) is what we assert,
// not the modal's own body.
vi.mock("@/components/InformationModal", () => ({
  InformationModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="information-modal">
      <button type="button" onClick={onClose}>
        Close info
      </button>
    </div>
  ),
}));

import { Layout } from "@/components/Layout";
import { JALCA_WORDMARK } from "@/lib/version";

// The Layout brand buffer carries deterministic `data-ocid` markers rather
// than `data-testid`. Configure the test-id attribute so getByTestId can
// target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the reorganized Layout header.
 *
 * The layout reorganization moved the Info, Theme palette, and Logout buttons
 * up from the board control row into the top brand buffer next to the JALCA
 * title, and REMOVED the Prediction Bet nav link from the header. These tests
 * assert the new header arrangement:
 *   - the JALCA title is followed by the Info, Theme palette, and Logout
 *     buttons in the top brand buffer;
 *   - there is NO Prediction Bet button in the header;
 *   - the Info button opens the information modal;
 *   - the Theme palette opens and selects a theme;
 *   - the Logout button fires the onLogout handler.
 */
describe("Layout header controls", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.documentElement.className = "";
  });

  const renderLayout = (onLogout: () => void = vi.fn()) =>
    render(
      <Layout
        onLogout={onLogout}
        windows={{
          board: <div>board</div>,
        }}
      />,
    );

  it("shows the JALCA title followed by Info, Theme palette, and Logout buttons with no Prediction Bet button", () => {
    renderLayout();

    const buffer = screen.getByTestId("brand.buffer.top");
    expect(buffer).toBeInTheDocument();

    // The JALCA title is present.
    expect(within(buffer).getByText(JALCA_WORDMARK)).toBeInTheDocument();

    // The three header controls are present next to the title.
    expect(
      within(buffer).getByRole("button", {
        name: /Theme: Light\. Click to choose a theme/,
      }),
    ).toBeInTheDocument();
    expect(
      within(buffer).getByRole("button", {
        name: "How the chess app works",
      }),
    ).toBeInTheDocument();
    expect(
      within(buffer).getByRole("button", { name: "Log out" }),
    ).toBeInTheDocument();

    // No Prediction Bet button is present in the header.
    expect(
      within(buffer).queryByRole("button", { name: /Prediction Bet/i }),
    ).not.toBeInTheDocument();
  });

  it("opens the information modal from the Info button and closes it", async () => {
    const user = userEvent.setup();
    renderLayout();

    expect(
      screen.queryByRole("button", { name: "Close info" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "How the chess app works" }),
    );
    expect(
      screen.getByRole("button", { name: "Close info" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close info" }));
    expect(
      screen.queryByRole("button", { name: "Close info" }),
    ).not.toBeInTheDocument();
  });

  it("opens the theme palette and selects a theme", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(
      screen.getByRole("button", {
        name: /Theme: Light\. Click to choose a theme/,
      }),
    );

    // All six theme swatches are present in the palette. The active swatch
    // carries an "(active)" suffix on its label.
    for (const label of [
      "Light theme",
      "Dark theme",
      "Neon theme",
      "Fire theme",
      "Water theme",
      "Bubblegum theme",
    ]) {
      expect(
        screen.getByRole("button", {
          name: new RegExp(`^${label}( \\(active\\))?$`),
        }),
      ).toBeInTheDocument();
    }

    // Selecting a theme applies its class to <html>.
    await user.click(screen.getByRole("button", { name: "Dark theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("fires the logout handler from the Logout button", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    renderLayout(onLogout);

    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
