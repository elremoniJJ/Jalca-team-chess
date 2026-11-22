import "@testing-library/jest-dom/vitest";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The gauge's useCanisterCycles hook makes a real network call to the IC
// blackhole canister (https://icp-api.io). That is an external network call we
// must never make in a test, so mock the hook with a local typed stub and drive
// the gauge's observable states directly. The hook is the ONLY mocked seam in
// this file: the real CanisterCyclesGauge and the real InformationModal render.
const { useCanisterCycles } = vi.hoisted(() => ({
  useCanisterCycles: vi.fn(),
}));
vi.mock("@/hooks/use-canister-cycles", () => ({ useCanisterCycles }));

import {
  CanisterCyclesGauge,
  EscrowLedgerCanisterGauge,
  NftMintingCanisterGauge,
} from "@/components/CanisterCyclesGauge";
import { InformationModal } from "@/components/InformationModal";
import { PBPP_CANISTER_PRINCIPAL } from "@/lib/pbpp";
import { ICRC7_CANISTER_ID } from "@/oisy-burn/oisy-signer";

// The gauge's markers use `data-ocid`, not `data-testid`. Configure the
// test-id attribute so getByTestId can target them.
configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted canister-cycles/gas-indicator requirements.
 *
 * The request makes four observable changes:
 *   1. the donation reference / prompt to donate cycles is removed from the
 *      cycles indicator;
 *   2. the old note "NFT spell minting will exist as long as this canister
 *      contains sufficient cycles." is replaced with the label
 *      "NFT minting canister";
 *   3. a second gas symbol and gauge, visually identical in style to the
 *      existing one, is added for the Escrow ledger canister
 *      (oqybv-uyaaa-aaaac-bf5oq-cai);
 *   4. both canisters involved in the game are visible to the player, and the
 *      escrow gauge surfaces an unavailable state gracefully when its balance
 *      cannot be read.
 *
 * The useCanisterCycles hook is mocked (it would otherwise hit the live IC
 * blackhole canister), so this is component/integration coverage only. It says
 * nothing about the real blackhole fetch or the real canister balances.
 */
describe("CanisterCyclesGauge accepted behavior", () => {
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

  const mockCycles = (cycles: bigint | null, isLoading = false) => {
    useCanisterCycles.mockReturnValue({
      cycles,
      isLoading,
      error: null,
      refetch: vi.fn(),
    });
  };

  it("contains no donation reference or prompt to donate cycles", async () => {
    const user = userEvent.setup();
    mockCycles(1_500_000_000_000n);
    render(<NftMintingCanisterGauge />);

    await user.click(
      screen.getByRole("button", { name: "NFT minting canister cycles" }),
    );

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/donat/i);
    expect(body).not.toMatch(/help by donating/i);
    expect(body).not.toMatch(/sufficient cycles/i);
  });

  it("shows the 'NFT minting canister' label where the old note was", () => {
    mockCycles(1_500_000_000_000n);
    render(<NftMintingCanisterGauge />);

    // The label is rendered as the panel's visible text.
    expect(screen.getByText("NFT minting canister")).toBeInTheDocument();
    // The superseded note must not survive anywhere.
    expect(
      screen.queryByText(/NFT spell minting will exist as long as/i),
    ).not.toBeInTheDocument();
  });

  it("renders the escrow gauge with the same visual style as the NFT gauge", () => {
    mockCycles(1_500_000_000_000n);
    const { unmount } = render(<NftMintingCanisterGauge />);
    const nftTrigger = screen.getByRole("button", {
      name: "NFT minting canister cycles",
    });
    const nftRing = nftTrigger.querySelector('svg[viewBox="0 0 28 28"]');
    expect(nftRing?.querySelectorAll("path")).toHaveLength(10);
    const nftClasses = nftTrigger.className;
    unmount();

    render(<EscrowLedgerCanisterGauge />);
    const escrowTrigger = screen.getByRole("button", {
      name: "Escrow ledger canister cycles",
    });
    const escrowRing = escrowTrigger.querySelector('svg[viewBox="0 0 28 28"]');
    // Same 10-segment ring gauge and the same trigger styling.
    expect(escrowRing?.querySelectorAll("path")).toHaveLength(10);
    expect(escrowTrigger.className).toBe(nftClasses);
  });

  it("points the escrow gauge at the escrow ledger canister id", () => {
    mockCycles(1_500_000_000_000n);
    render(<EscrowLedgerCanisterGauge />);

    expect(useCanisterCycles).toHaveBeenCalledWith(PBPP_CANISTER_PRINCIPAL);
    expect(PBPP_CANISTER_PRINCIPAL).toBe("oqybv-uyaaa-aaaac-bf5oq-cai");
  });

  it("surfaces a graceful unavailable state when the escrow balance cannot be read", async () => {
    const user = userEvent.setup();
    mockCycles(null, false);
    render(<EscrowLedgerCanisterGauge />);

    // The gauge still renders its panel and trigger — not a broken gauge.
    expect(screen.getByTestId("escrow_cycles.panel")).toBeInTheDocument();
    const trigger = screen.getByRole("button", {
      name: "Escrow ledger canister cycles",
    });
    expect(trigger).toBeInTheDocument();
    // All 10 segments render unlit rather than the gauge disappearing.
    const ring = trigger.querySelector('svg[viewBox="0 0 28 28"]');
    expect(ring?.querySelectorAll("path")).toHaveLength(10);
    expect(ring?.querySelectorAll("path.text-primary")).toHaveLength(0);

    await user.click(trigger);
    expect(screen.getByText("Cycle balance unavailable")).toBeInTheDocument();
  });

  it("shows the escrow balance in trillions when it can be read", async () => {
    const user = userEvent.setup();
    mockCycles(2_250_000_000_000n);
    render(<EscrowLedgerCanisterGauge />);

    await user.click(
      screen.getByRole("button", { name: "Escrow ledger canister cycles" }),
    );

    expect(screen.getByText("2.250T cycles remaining")).toBeInTheDocument();
  });
});

/**
 * Cover for the InformationModal footer showing both canisters involved in the
 * game. The real InformationModal and the real gauges render; only the
 * useCanisterCycles hook is mocked.
 */
describe("InformationModal canister visibility", () => {
  beforeEach(() => {
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

  it("shows both the NFT minting and Escrow ledger canisters to the player", () => {
    useCanisterCycles.mockReturnValue({
      cycles: 1_500_000_000_000n,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<InformationModal onClose={vi.fn()} />);

    // Both gauges are present in the modal footer.
    expect(screen.getByTestId("canister_cycles.panel")).toBeInTheDocument();
    expect(screen.getByTestId("escrow_cycles.panel")).toBeInTheDocument();
    // Both canister roles are named to the player.
    expect(screen.getByText("NFT minting canister")).toBeInTheDocument();
    expect(screen.getByText("Escrow ledger canister")).toBeInTheDocument();
    // The hook was called once per canister with the right ids.
    expect(useCanisterCycles).toHaveBeenCalledWith(ICRC7_CANISTER_ID);
    expect(useCanisterCycles).toHaveBeenCalledWith(PBPP_CANISTER_PRINCIPAL);
  });

  it("keeps the escrow gauge graceful when its balance is unavailable", () => {
    useCanisterCycles.mockReturnValue({
      cycles: null,
      isLoading: false,
      error: "not blackhole-controlled",
      refetch: vi.fn(),
    });
    render(<InformationModal onClose={vi.fn()} />);

    // Both panels still render; the escrow one is not a broken gauge.
    expect(screen.getByTestId("canister_cycles.panel")).toBeInTheDocument();
    expect(screen.getByTestId("escrow_cycles.panel")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Escrow ledger canister cycles" }),
    ).toBeInTheDocument();
  });
});
