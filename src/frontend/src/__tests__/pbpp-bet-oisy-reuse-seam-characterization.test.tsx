import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the `usePbppBet` -> `useOisyBurn` reuse seam, taken
 * BEFORE the burn-path identity change lands.
 *
 * The accepted request switches ONLY the burn path
 * (WalletConnectionWindow -> useOisyBurn -> burnAndPlay / updateWalletAddress)
 * from the guest identity to the active identity. It explicitly leaves
 * use-pbpp-bet.ts unchanged: the prediction-bet hook still reuses
 * `useOisyBurn(principal, true)` for the wallet connection, forwarding the
 * principal it receives.
 *
 * This file pins that reuse seam. It deliberately does NOT pin which accessor
 * the WALLET window reads for its burn principal — that is the intentional
 * change.
 *
 * The backend actor and the Oisy signer are mocked throughout: this is
 * component/integration coverage of the frontend wiring, not deployed browser
 * E2E. The real backend behavior is the PocketIC lane's job.
 */

// The hook reuses useOisyBurn for the wallet connection. Mock it so the test
// captures the principal the hook forwards, without opening a real signer.
const { useOisyBurn } = vi.hoisted(() => ({ useOisyBurn: vi.fn() }));
vi.mock("@/oisy-burn/use-oisy-burn", () => ({ useOisyBurn }));

// The hook reaches the backend through getActor(); stub it so the module
// resolves. The reuse seam under test never calls the actor.
vi.mock("@/lib/backend-actor", () => ({
  getActor: vi.fn().mockResolvedValue({}),
}));

// The hook imports the approval seam from lib/pbpp; stub it so the module
// resolves without a real signer.
vi.mock("@/lib/pbpp", () => ({
  approvePbppAllowance: vi.fn(),
  openApproveSignerSync: vi.fn(),
  preloadSigner: vi.fn(),
}));

import { usePbppBet } from "@/lib/use-pbpp-bet";

describe("usePbppBet still forwards its principal to useOisyBurn", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("passes the principal it receives to useOisyBurn for the wallet connection", () => {
    useOisyBurn.mockReturnValue({
      connection: { status: "disconnected" },
      connect: vi.fn(),
      disconnect: vi.fn(),
      signerAvailable: true,
    });

    function Harness() {
      usePbppBet("pbpp-principal-1");
      return <div />;
    }
    render(<Harness />);

    // The reuse seam is unchanged: the hook hands its principal to useOisyBurn
    // (with spellUseEnabled true — the bet feature is not gated by NFT spells).
    expect(useOisyBurn).toHaveBeenCalled();
    expect(useOisyBurn.mock.calls[0]?.[0]).toBe("pbpp-principal-1");
    expect(useOisyBurn.mock.calls[0]?.[1]).toBe(true);
  });
});
