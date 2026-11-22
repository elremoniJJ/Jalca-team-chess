import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// usePbppBet imports Pot as a runtime enum from @/backend, which transitively
// pulls in @caffeineai/object-storage and @caffeineai/core-infrastructure.
// Those packages fail to resolve their own submodules in the jsdom test
// environment (a pre-existing dependency issue), so mock the backend module
// with the enum value the hook needs.
vi.mock("@/backend", () => ({
  Pot: { One: "One", Ten: "Ten", Hundred: "Hundred", Thousand: "Thousand" },
  GameOutcome: { draw: "draw", black: "black", white: "white" },
}));

// The hook reuses useOisyBurn for the wallet connection. Mock it so the test
// controls the connection state (connected with a known account, or
// disconnected) deterministically without opening a real signer popup.
const { mockConnection } = vi.hoisted(() => ({
  mockConnection: {
    value: { status: "disconnected" } as
      | { status: "disconnected" }
      | { status: "connecting" }
      | { status: "connected"; account: { owner: string; subaccount: null } }
      | { status: "error"; message: string },
  },
}));
vi.mock("@/oisy-burn/use-oisy-burn", () => ({
  useOisyBurn: () => ({
    connection: mockConnection.value,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signerAvailable: true,
  }),
}));

// The hook calls getActor() from lib/backend-actor to reach the backend.
// Mock it so the tests drive the real-bet actor methods (placeBet,
// checkAllowance, getRealBets, getSettlements) without touching the real
// actor. The diagnostic sendTestPayload surface was removed from the hook and
// the backend, so it is no longer mocked here. The manual reportOutcome
// surface was removed from the hook (the backend now reports outcomes
// automatically at game conclusion), so it is no longer mocked here either.
const { placeBet, checkAllowance, getRealBets, getSettlements } = vi.hoisted(
  () => ({
    placeBet: vi.fn(),
    checkAllowance: vi.fn(),
    getRealBets: vi.fn(),
    getSettlements: vi.fn(),
  }),
);
vi.mock("@/lib/backend-actor", () => ({
  getActor: vi.fn().mockResolvedValue({
    placeBet,
    checkAllowance,
    getRealBets,
    getSettlements,
  }),
}));

// The hook exposes approveAllowance via lib/pbpp; the approval flow opens the
// signer synchronously (openApproveSignerSync) as the first statement in the
// click handler and passes the already-open signer to approvePbppAllowance.
// Mock the seam so the test can assert the synchronous open precedes the
// approval call.
const { approvePbppAllowance, openApproveSignerSync, preloadSigner } =
  vi.hoisted(() => ({
    approvePbppAllowance: vi.fn(),
    openApproveSignerSync: vi.fn(),
    preloadSigner: vi.fn(),
  }));
vi.mock("@/lib/pbpp", () => ({
  approvePbppAllowance,
  openApproveSignerSync,
  preloadSigner,
}));

import { GameOutcome } from "@/backend";
import { usePbppBet } from "@/lib/use-pbpp-bet";

/**
 * Cover for the synchronous signer-opening approval flow.
 *
 * The request fixes the wallet signer approval flow so the signer window opens
 * synchronously inside the click handler (instead of after an await, which
 * loses the browser's user-activation token). The hook's approveAllowance
 * opens the signer via openApproveSignerSync() as its first synchronous
 * statement and passes the already-open signer instance to
 * approvePbppAllowance(). These tests pin that seam: the signer is opened
 * before the approval call, the opened signer is passed through, and a
 * disconnected wallet is rejected before any signer is opened.
 */
describe("usePbppBet.approveAllowance — synchronous signer opening", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockConnection.value = { status: "disconnected" };
  });

  it("opens the signer synchronously and passes it to approvePbppAllowance", async () => {
    const user = userEvent.setup();
    mockConnection.value = {
      status: "connected",
      account: { owner: "owner-principal-abc", subaccount: null },
    };
    const signer = { __signer: Symbol("signer") };
    openApproveSignerSync.mockReturnValue(signer);
    approvePbppAllowance.mockResolvedValue({ ok: 42n });

    function ApproveHarness() {
      const pbpp = usePbppBet("player-1");
      return (
        <div>
          <button
            type="button"
            onClick={() => void pbpp.approveAllowance(100_000_000n)}
          >
            approve
          </button>
        </div>
      );
    }
    render(<ApproveHarness />);

    await user.click(screen.getByRole("button", { name: "approve" }));

    await waitFor(() => {
      expect(approvePbppAllowance).toHaveBeenCalledTimes(1);
    });
    // The signer is opened synchronously (before the approval call) and the
    // already-open signer instance is passed through to the approval.
    expect(openApproveSignerSync).toHaveBeenCalledTimes(1);
    expect(approvePbppAllowance).toHaveBeenCalledWith(
      signer,
      { owner: "owner-principal-abc", subaccount: null },
      100_000_000n,
    );
  });

  it("rejects the approval with a clear error when no wallet is connected, without opening a signer", async () => {
    const user = userEvent.setup();
    // Default mockConnection is disconnected.
    function ApproveHarness() {
      const pbpp = usePbppBet("player-1");
      return (
        <div>
          <button
            type="button"
            onClick={() => void pbpp.approveAllowance(100_000_000n)}
          >
            approve
          </button>
        </div>
      );
    }
    render(<ApproveHarness />);

    await user.click(screen.getByRole("button", { name: "approve" }));

    await waitFor(() => {
      expect(openApproveSignerSync).not.toHaveBeenCalled();
    });
    expect(approvePbppAllowance).not.toHaveBeenCalled();
  });
});

/**
 * Cover for the Phase 2 real-bet relay and allowance check surfaces in
 * usePbppBet.
 *
 * The request adds two hook surfaces:
 *   - relayBet(...) calls the backend placeBet method (the cross-canister call
 *     originates from JALCA's own backend principal, never the browser
 *     session) with the record-shaped PlaceBetArgs payload and surfaces the
 *     ICRC Ledger block index JEL returned on success, or a mapped EscrowError
 *     message on failure;
 *   - checkAllowance() calls the backend checkAllowance (spender = JEL,
 *     account = the connected wallet owner) and returns the Allowance so the
 *     UI can show immediate feedback such as "you haven't approved JEL yet".
 *
 * The manual reportOutcome surface was REMOVED from the hook: the backend now
 * reports game outcomes to JEL automatically at game conclusion, so there is
 * no player-facing settlement action left to wire. The public reportOutcome
 * actor method still exists and is pinned by real-bet-contract.test.ts.
 *
 * These tests pin the hook's wiring to the actor seam: the exact record-shaped
 * argument forwarded to placeBet, the block-index success state, and the
 * EscrowError mapping. The backend actor is mocked throughout.
 */
describe("usePbppBet Phase 2 real-bet surfaces", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockConnection.value = { status: "disconnected" };
  });

  it("relays a real bet to placeBet with the record-shaped payload and surfaces the block index", async () => {
    const user = userEvent.setup();
    mockConnection.value = {
      status: "connected",
      account: { owner: "aaaaa-aa", subaccount: null },
    };
    placeBet.mockResolvedValue({ __kind__: "ok", ok: 42n });

    function RelayHarness() {
      const pbpp = usePbppBet("player-1");
      return (
        <div>
          <button
            type="button"
            onClick={() =>
              void pbpp.relayBet(
                "Ada",
                false,
                1n,
                100_000_000n,
                GameOutcome.white,
              )
            }
          >
            relay
          </button>
          <span data-testid="relay-state">{pbpp.relayState.status}</span>
          <span data-testid="relay-block">
            {pbpp.relayState.status === "success"
              ? pbpp.relayState.blockIndex.toString()
              : ""}
          </span>
        </div>
      );
    }
    render(<RelayHarness />);

    await user.click(screen.getByRole("button", { name: "relay" }));

    await waitFor(() => {
      expect(placeBet).toHaveBeenCalledTimes(1);
    });
    // The record-shaped PlaceBetArgs payload is forwarded to the backend
    // placeBet method. `amount_e8s` is the bet only.
    expect(placeBet).toHaveBeenCalledWith({
      player: expect.anything(), // Principal.fromText(owner)
      username: "Ada",
      anonymous: false,
      pot_tier: 1n,
      amount_e8s: 100_000_000n,
      outcome: GameOutcome.white,
      wallet_address: "aaaaa-aa",
    });
    // The ICRC Ledger block index JEL returned is surfaced in the success
    // state.
    await waitFor(() => {
      expect(screen.getByTestId("relay-state")).toHaveTextContent("success");
    });
    expect(screen.getByTestId("relay-block")).toHaveTextContent("42");
  });

  it("maps a JEL NoApproval EscrowError to the 'haven't approved' message", async () => {
    const user = userEvent.setup();
    mockConnection.value = {
      status: "connected",
      account: { owner: "aaaaa-aa", subaccount: null },
    };
    placeBet.mockResolvedValue({
      __kind__: "err",
      err: { __kind__: "NoApproval", NoApproval: null },
    });

    function RelayHarness() {
      const pbpp = usePbppBet("player-1");
      return (
        <div>
          <button
            type="button"
            onClick={() =>
              void pbpp.relayBet(
                "Ada",
                false,
                1n,
                100_000_000n,
                GameOutcome.white,
              )
            }
          >
            relay
          </button>
          <span data-testid="relay-state">{pbpp.relayState.status}</span>
          <span data-testid="relay-message">
            {pbpp.relayState.status === "error" ? pbpp.relayState.message : ""}
          </span>
        </div>
      );
    }
    render(<RelayHarness />);

    await user.click(screen.getByRole("button", { name: "relay" }));

    await waitFor(() => {
      expect(screen.getByTestId("relay-state")).toHaveTextContent("error");
    });
    expect(screen.getByTestId("relay-message")).toHaveTextContent(
      "NoApproval — you haven't approved the escrow canister as spender yet. Approve the stake first.",
    );
  });

  it("renders a TransferFailed EscrowError verbatim with the escrow failure text", async () => {
    const user = userEvent.setup();
    mockConnection.value = {
      status: "connected",
      account: { owner: "aaaaa-aa", subaccount: null },
    };
    // JEL rejected the bet at icrc2_transfer_from and returned the
    // TransferFailed variant carrying the escrow canister's failure text. The
    // hook must render the exact variant verbatim, not a collapsed generic
    // reason.
    placeBet.mockResolvedValue({
      __kind__: "err",
      err: {
        __kind__: "TransferFailed",
        TransferFailed: "InsufficientAllowance (allowance = 0)",
      },
    });

    function RelayHarness() {
      const pbpp = usePbppBet("player-1");
      return (
        <div>
          <button
            type="button"
            onClick={() =>
              void pbpp.relayBet(
                "Ada",
                false,
                1n,
                100_000_000n,
                GameOutcome.white,
              )
            }
          >
            relay
          </button>
          <span data-testid="relay-state">{pbpp.relayState.status}</span>
          <span data-testid="relay-message">
            {pbpp.relayState.status === "error" ? pbpp.relayState.message : ""}
          </span>
        </div>
      );
    }
    render(<RelayHarness />);

    await user.click(screen.getByRole("button", { name: "relay" }));

    await waitFor(() => {
      expect(screen.getByTestId("relay-state")).toHaveTextContent("error");
    });
    // The exact variant is rendered verbatim, including the escrow failure
    // text.
    expect(screen.getByTestId("relay-message")).toHaveTextContent(
      "TransferFailed: InsufficientAllowance (allowance = 0)",
    );
  });

  it("checks the ledger allowance for the connected wallet owner", async () => {
    const user = userEvent.setup();
    mockConnection.value = {
      status: "connected",
      account: { owner: "aaaaa-aa", subaccount: null },
    };
    checkAllowance.mockResolvedValue({
      allowance: 100_000_000n,
      expires_at: [],
    });

    function AllowanceHarness() {
      const pbpp = usePbppBet("player-1");
      return (
        <div>
          <button type="button" onClick={() => void pbpp.checkAllowance()}>
            check
          </button>
          <span data-testid="allowance">
            {pbpp.connection.status === "connected" ? "connected" : ""}
          </span>
        </div>
      );
    }
    render(<AllowanceHarness />);

    await user.click(screen.getByRole("button", { name: "check" }));

    await waitFor(() => {
      expect(checkAllowance).toHaveBeenCalledTimes(1);
    });
    // The allowance check targets the connected wallet owner as the account.
    expect(checkAllowance).toHaveBeenCalledWith(expect.anything());
  });

  it("rejects a real-bet relay with a clear error when no wallet is connected, without calling the actor", async () => {
    const user = userEvent.setup();
    // Default mockConnection is disconnected.
    function RelayHarness() {
      const pbpp = usePbppBet("player-1");
      return (
        <div>
          <button
            type="button"
            onClick={() =>
              void pbpp.relayBet(
                "Ada",
                false,
                1n,
                100_000_000n,
                GameOutcome.white,
              )
            }
          >
            relay
          </button>
          <span data-testid="relay-state">{pbpp.relayState.status}</span>
          <span data-testid="relay-message">
            {pbpp.relayState.status === "error" ? pbpp.relayState.message : ""}
          </span>
        </div>
      );
    }
    render(<RelayHarness />);

    await user.click(screen.getByRole("button", { name: "relay" }));

    await waitFor(() => {
      expect(screen.getByTestId("relay-state")).toHaveTextContent("error");
    });
    expect(screen.getByTestId("relay-message")).toHaveTextContent(
      "Connect your Oisy wallet to relay a real bet.",
    );
    // No actor call is made when the wallet is not connected.
    expect(placeBet).not.toHaveBeenCalled();
  });
});
