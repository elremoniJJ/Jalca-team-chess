import "@testing-library/jest-dom/vitest";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// The InformationModal renders a CanisterCyclesGauge in its footer. That
// gauge's useCanisterCycles hook makes a real network call to the IC
// blackhole canister (https://icp-api.io), and its import chain transitively
// pulls in @caffeineai/core-infrastructure, which fails to resolve its own
// submodules in the jsdom test environment (a pre-existing dependency issue,
// the same one the other modal tests work around). The gauge is out of scope
// for this cover, so mock it to a marker.
vi.mock("@/components/CanisterCyclesGauge", () => ({
  CanisterCyclesGauge: () => <div data-testid="canister-cycles-gauge" />,
  NftMintingCanisterGauge: () => (
    <div data-testid="nft-minting-canister-gauge" />
  ),
  EscrowLedgerCanisterGauge: () => (
    <div data-testid="escrow-ledger-canister-gauge" />
  ),
}));

import { InformationModal } from "@/components/InformationModal";

// The modal's sections carry deterministic `data-ocid` markers rather than
// `data-testid`. Configure the test-id attribute so getByTestId can target
// them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the InformationModal structural contract.
 *
 * The request updates the info/help screen CONTENT with three confirmed
 * adjustments. The body text is intentionally changing, so this test does
 * NOT pin any of the current body copy. Instead it protects the modal's
 * structural shell that must remain unchanged across the content edit:
 * the dialog renders with its title, the X close button and "Got it"
 * button both dismiss it, Escape closes it, and the eight content sections
 * keep their stable data-ocid markers. A future edit that breaks the
 * modal's shell (removes the title, breaks dismissal, drops a section
 * marker) is caught here regardless of what the body text becomes.
 */
describe("InformationModal structural contract", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the dialog with its title and the eight content sections", () => {
    render(<InformationModal onClose={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "How the Chess App Works" }),
    ).toBeInTheDocument();

    // The eight content sections keep their stable markers.
    for (const marker of [
      "information.section.game",
      "information.section.settings",
      "information.section.buttons",
      "information.section.move_maker",
      "information.section.move",
      "information.section.kick",
      "information.section.prediction",
      "information.section.wallet",
    ]) {
      expect(screen.getByTestId(marker)).toBeInTheDocument();
    }
  });

  it("closes via the X close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<InformationModal onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Close information" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via the Got it button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<InformationModal onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<InformationModal onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/**
 * Cover for the three confirmed content adjustments to the info/help screen.
 *
 * The request updates the body copy with specific changes. These tests
 * assert the observable text of those changes so a future edit that reverts
 * them is caught:
 *   - the Prediction Betting section states the 1.5% platform fee;
 *   - the Game mode button description lists the three separate modes.
 */
describe("InformationModal confirmed content adjustments", () => {
  afterEach(() => {
    cleanup();
  });

  it("states the 1.5% platform fee in the Prediction Betting section", () => {
    render(<InformationModal onClose={vi.fn()} />);
    const prediction = screen.getByTestId("information.section.prediction");
    expect(prediction).toHaveTextContent(/1\.5%/i);
    // The superseded 0.1% figure must not survive anywhere in the section.
    expect(prediction).not.toHaveTextContent(/0\.1%/i);
  });

  it("lists the three separate game mode buttons", () => {
    render(<InformationModal onClose={vi.fn()} />);
    const buttons = screen.getByTestId("information.section.buttons");
    expect(buttons).toHaveTextContent(/Just for Fun/i);
    expect(buttons).toHaveTextContent(/Exercise Game/i);
    expect(buttons).toHaveTextContent(/Drinking Game/i);
  });
});
