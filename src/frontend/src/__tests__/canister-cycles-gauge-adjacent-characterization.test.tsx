import "@testing-library/jest-dom/vitest";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CanisterCyclesGauge consumes the retained `components/ui/popover` primitive
// and the useCanisterCycles hook, which makes a real network call to the IC
// blackhole canister. That is an external network call we must never make in a
// test, so mock the hook with a local typed stub and drive the gauge's
// observable states directly.
const { useCanisterCycles } = vi.hoisted(() => ({
  useCanisterCycles: vi.fn(),
}));
vi.mock("@/hooks/use-canister-cycles", () => ({ useCanisterCycles }));

import {
  CanisterCyclesGauge,
  EscrowLedgerCanisterGauge,
  NftMintingCanisterGauge,
} from "@/components/CanisterCyclesGauge";
import { PBPP_CANISTER_PRINCIPAL } from "@/lib/pbpp";
import { ICRC7_CANISTER_ID } from "@/oisy-burn/oisy-signer";

// The gauge's markers use `data-ocid`, not `data-testid`. Configure the
// test-id attribute so getByTestId can target them.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the CanisterCyclesGauge behavior that must survive the
 * upcoming change.
 *
 * The request intentionally changes three things about this component:
 *   - the donation prompt ("can help by donating cycles to" + the copyable
 *     ICRC-7 canister id button) is removed;
 *   - the note "NFT spell minting will exist as long as this canister
 *     contains sufficient cycles." is replaced with "NFT minting canister";
 *   - a second, visually identical gas symbol and gauge is added for the
 *     Escrow ledger canister.
 *
 * This file deliberately does NOT freeze any of that changing copy. It
 * protects the behavior ADJACENT to the change that must remain intact:
 *
 *   - the panel wrapper and the labelled trigger button are still rendered;
 *   - the ring gauge still renders its 10 SVG arc segments (the visual gauge
 *     the second gauge is meant to mirror);
 *   - the balance is still formatted in trillions with the "cycles remaining"
 *     suffix;
 *   - the loading and unavailable states still render their own copy;
 *   - the popover still opens on click.
 *
 * The hook is mocked, so this is component/integration coverage only — it
 * says nothing about the real blackhole fetch.
 */
describe("CanisterCyclesGauge adjacent behavior", () => {
  beforeEach(() => {
    // jsdom lacks these browser APIs Radix Popover relies on to position its
    // content. Stub them so the portal content can mount.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const renderGauge = (cycles: bigint | null, isLoading = false) => {
    useCanisterCycles.mockReturnValue({
      cycles,
      isLoading,
      error: null,
      refetch: vi.fn(),
    });
    return render(
      <CanisterCyclesGauge
        canisterId={ICRC7_CANISTER_ID}
        label="NFT minting canister"
        ocidPrefix="canister_cycles"
      />,
    );
  };

  it("renders the panel wrapper and the labelled trigger button", () => {
    renderGauge(1_500_000_000_000n);

    expect(screen.getByTestId("canister_cycles.panel")).toBeInTheDocument();
    const trigger = screen.getByRole("button", {
      name: "NFT minting canister cycles",
    });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute("title", "NFT minting canister cycles");
  });

  it("renders the 10-segment ring gauge inside the trigger", () => {
    renderGauge(1_500_000_000_000n);

    const trigger = screen.getByRole("button", {
      name: "NFT minting canister cycles",
    });
    // The gauge is a 10-segment SVG ring; each segment is one <path>. Scope to
    // the 28x28 ring SVG so the Fuel icon's own <path> elements are excluded.
    const ring = trigger.querySelector('svg[viewBox="0 0 28 28"]');
    expect(ring).not.toBeNull();
    expect(ring?.querySelectorAll("path")).toHaveLength(10);
  });

  it("formats the balance in trillions with the cycles-remaining suffix", async () => {
    const user = userEvent.setup();
    renderGauge(1_500_000_000_000n);

    await user.click(
      screen.getByRole("button", { name: "NFT minting canister cycles" }),
    );

    expect(screen.getByText("1.500T cycles remaining")).toBeInTheDocument();
  });

  it("shows the loading copy while the balance is being fetched", async () => {
    const user = userEvent.setup();
    renderGauge(null, true);

    await user.click(
      screen.getByRole("button", { name: "NFT minting canister cycles" }),
    );

    expect(screen.getByText("Loading cycles...")).toBeInTheDocument();
  });

  it("shows the unavailable copy when the balance cannot be fetched", async () => {
    const user = userEvent.setup();
    renderGauge(null, false);

    await user.click(
      screen.getByRole("button", { name: "NFT minting canister cycles" }),
    );

    expect(screen.getByText("Cycle balance unavailable")).toBeInTheDocument();
  });

  it("renders the NFT minting gauge with the ICRC-7 canister id and label", () => {
    useCanisterCycles.mockReturnValue({
      cycles: 1_500_000_000_000n,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<NftMintingCanisterGauge />);

    expect(screen.getByTestId("canister_cycles.panel")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "NFT minting canister cycles" }),
    ).toBeInTheDocument();
    // The hook is called with the ICRC-7 canister id.
    expect(useCanisterCycles).toHaveBeenCalledWith(ICRC7_CANISTER_ID);
  });

  it("renders the Escrow ledger gauge with the escrow canister id and label", () => {
    useCanisterCycles.mockReturnValue({
      cycles: 1_500_000_000_000n,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<EscrowLedgerCanisterGauge />);

    expect(screen.getByTestId("escrow_cycles.panel")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Escrow ledger canister cycles" }),
    ).toBeInTheDocument();
    // The hook is called with the escrow ledger canister id.
    expect(useCanisterCycles).toHaveBeenCalledWith(PBPP_CANISTER_PRINCIPAL);
  });
});
