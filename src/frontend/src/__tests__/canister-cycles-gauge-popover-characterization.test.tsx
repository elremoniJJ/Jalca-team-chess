import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CanisterCyclesGauge consumes the retained `components/ui/popover` primitive.
// The UI-kit cleanup deletes unused primitives; popover.tsx is one of the two
// reachable primitives that must keep working. This test characterizes the
// gauge's observable popover behavior so the deletion cannot silently break it.
//
// The gauge's useCanisterCycles hook makes a real network call to the IC
// blackhole canister. That is an external network call we must never make in a
// test, so mock the hook with a local typed stub and drive the gauge's three
// observable states (balance, loading, unavailable) directly.
const { useCanisterCycles } = vi.hoisted(() => ({
  useCanisterCycles: vi.fn(),
}));
vi.mock("@/hooks/use-canister-cycles", () => ({ useCanisterCycles }));

import { CanisterCyclesGauge } from "@/components/CanisterCyclesGauge";
import { ICRC7_CANISTER_ID } from "@/oisy-burn/oisy-signer";

/**
 * Characterization of the CanisterCyclesGauge popover.
 *
 * The gauge is a Radix Popover: a trigger button opens a content panel that
 * shows the ICRC-7 canister's remaining cycles. The popover primitive
 * (popover.tsx) is retained by the UI-kit cleanup, so this behavior must
 * remain unchanged.
 *
 * The donation prompt (the copyable canister-id button and its "can help by
 * donating cycles to" copy) is intentionally being removed, so this file no
 * longer pins it. The balance, loading, and unavailable states — the popover
 * behavior that must survive — are still covered here.
 *
 * Covered here (frontend observable behavior):
 *   - the trigger button is present and labelled;
 *   - opening the popover reveals the formatted balance;
 *   - the loading and unavailable states render their own copy.
 */
describe("CanisterCyclesGauge popover", () => {
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

  const openGauge = async () => {
    const user = userEvent.setup();
    render(
      <CanisterCyclesGauge
        canisterId={ICRC7_CANISTER_ID}
        label="NFT minting canister"
        ocidPrefix="canister_cycles"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "NFT minting canister cycles" }),
    );
    return user;
  };

  it("opens the popover and shows the formatted cycle balance", async () => {
    useCanisterCycles.mockReturnValue({
      cycles: 1_500_000_000_000n,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    await openGauge();

    expect(screen.getByText("1.500T cycles remaining")).toBeInTheDocument();
  });

  it("shows the loading copy while the balance is being fetched", async () => {
    useCanisterCycles.mockReturnValue({
      cycles: null,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    await openGauge();

    expect(screen.getByText("Loading cycles...")).toBeInTheDocument();
  });

  it("shows the unavailable copy when the balance cannot be fetched", async () => {
    useCanisterCycles.mockReturnValue({
      cycles: null,
      isLoading: false,
      error: "not blackhole-controlled",
      refetch: vi.fn(),
    });

    await openGauge();

    expect(screen.getByText("Cycle balance unavailable")).toBeInTheDocument();
  });
});
