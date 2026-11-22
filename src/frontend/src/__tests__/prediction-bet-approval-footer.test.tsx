import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The PredictionBetWindow imports Pot from @/backend, which transitively pulls
// in @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test environment
// (a pre-existing dependency issue), so mock them with the symbols the
// generated backend wrapper re-exports.
vi.mock("@caffeineai/object-storage", () => ({
  ExternalBlob: Symbol("ExternalBlob"),
}));
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
}));
vi.mock("@/backend", () => ({
  Pot: { One: "One", Ten: "Ten", Hundred: "Hundred", Thousand: "Thousand" },
  GameOutcome: { draw: "draw", black: "black", white: "white" },
}));

// The window's BettingPanel calls useGameState -> useActorState, which reads
// the React Query client. Wrap every render in a QueryClientProvider so the
// real window can mount (the actor itself is never called).
vi.mock("@/hooks/use-game-state", () => ({
  useGameState: () => ({
    data: { players: [{ principal: "player-1", username: "Ada" }] },
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
}));

// Drive the approval flow deterministically by mocking usePbppBet. The
// connection state, approveAllowance outcome, and relayBet are controlled
// per-test so the Place bet button's chained wiring and the outcome surfacing
// can be asserted without opening a real signer popup or touching the actor.
const { mockPbpp } = vi.hoisted(() => ({
  mockPbpp: {
    connection: { status: "disconnected" } as
      | { status: "disconnected" }
      | { status: "connecting" }
      | { status: "connected"; account: { owner: string; subaccount: null } }
      | { status: "error"; message: string },
    approveAllowance: vi.fn(),
    relayBet: vi.fn(),
    checkAllowance: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("@/lib/use-pbpp-bet", () => ({
  usePbppBet: () => ({
    connection: mockPbpp.connection,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signerAvailable: true,
    anonymous: false,
    setAnonymous: vi.fn(),
    submitState: { status: "idle" },
    submitBet: vi.fn(),
    approveAllowance: mockPbpp.approveAllowance,
    checkAllowance: mockPbpp.checkAllowance,
    relayState: { status: "idle" },
    relayBet: mockPbpp.relayBet,
    getRealBets: vi.fn().mockResolvedValue([]),
    getSettlements: vi.fn().mockResolvedValue([]),
  }),
}));

import { PredictionBetWindow } from "@/components/PredictionBetWindow";

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/**
 * Characterization of the Prediction Bet approval flow and the live-payments
 * footer mention.
 *
 * The request reduces the betting flow to 2 buttons (Connect wallet + Place
 * bet). The single "Place bet" button chains the two on-chain actions
 * sequentially and automatically: it first triggers the real icrc2_approve
 * naming JEL as spender (the wallet window opens directly from the button
 * click), waits for the approval to confirm, then automatically calls
 * place_bet to relay the bet to JEL. The fixed-amount approval (exactly the
 * bet amount) is kept for safety.
 *
 * These tests protect the ADJACENT behavior that must remain unchanged:
 *   - the Place bet button is wired to the approval handler and calls
 *     approveAllowance with the selected pot's stake in e8s;
 *   - a failed approval surfaces the reason;
 *   - the button shows 'Approving stake…' and is disabled while the approval
 *     is in flight;
 *   - the footer mention is present, opens its link in a new tab, and keeps
 *     the trailing 'to see live payments.' text.
 *
 * The footer link text/href and the synchronous-vs-async signer timing are
 * intentionally NOT asserted here.
 */

describe("PredictionBetWindow approval flow", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockPbpp.connection = { status: "disconnected" };
    mockPbpp.checkAllowance.mockResolvedValue(null);
    window.localStorage.clear();
  });

  it("calls approveAllowance with the stake in e8s when Place bet is pressed", async () => {
    const user = userEvent.setup();
    mockPbpp.connection = {
      status: "connected",
      account: { owner: "owner-principal-abc", subaccount: null },
    };
    mockPbpp.approveAllowance.mockResolvedValue({ ok: 42n });
    mockPbpp.relayBet.mockResolvedValue(undefined);
    renderWithProviders(<PredictionBetWindow />);

    // The single Place bet button is present (no separate Approve button).
    const placeButton = screen.getByRole("button", { name: "Place 1 ICP bet" });
    expect(placeButton).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();

    await user.click(placeButton);

    await waitFor(() => {
      expect(mockPbpp.approveAllowance).toHaveBeenCalledTimes(1);
    });
    // 1 ICP = 100,000,000 e8s — the fixed-amount approval is kept.
    expect(mockPbpp.approveAllowance).toHaveBeenCalledWith(100_000_000n);
  });

  it("relays the bet automatically after a successful approval", async () => {
    const user = userEvent.setup();
    mockPbpp.connection = {
      status: "connected",
      account: { owner: "owner-principal-abc", subaccount: null },
    };
    mockPbpp.approveAllowance.mockResolvedValue({ ok: 42n });
    mockPbpp.relayBet.mockResolvedValue(undefined);
    renderWithProviders(<PredictionBetWindow />);

    await user.click(screen.getByRole("button", { name: "Place 1 ICP bet" }));

    // After the approval confirms, relayBet is called automatically.
    await waitFor(() => {
      expect(mockPbpp.relayBet).toHaveBeenCalledTimes(1);
    });
  });

  it("surfaces a failed approval with the reason", async () => {
    const user = userEvent.setup();
    mockPbpp.connection = {
      status: "connected",
      account: { owner: "owner-principal-abc", subaccount: null },
    };
    mockPbpp.approveAllowance.mockResolvedValue({ err: "InsufficientFunds" });
    renderWithProviders(<PredictionBetWindow />);

    await user.click(screen.getByRole("button", { name: "Place 1 ICP bet" }));

    await waitFor(() => {
      expect(
        screen.getByText("Approval failed: InsufficientFunds"),
      ).toBeInTheDocument();
    });
    // A failed approval does not relay the bet.
    expect(mockPbpp.relayBet).not.toHaveBeenCalled();
  });

  it("shows 'Approving stake…' and disables the button while the approval is in flight", async () => {
    const user = userEvent.setup();
    mockPbpp.connection = {
      status: "connected",
      account: { owner: "owner-principal-abc", subaccount: null },
    };
    let resolveApproval: (o: { ok: bigint }) => void = () => {};
    mockPbpp.approveAllowance.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApproval = resolve;
        }),
    );
    renderWithProviders(<PredictionBetWindow />);

    await user.click(screen.getByRole("button", { name: "Place 1 ICP bet" }));

    // While the approval is pending the button reads 'Approving stake…' and is
    // disabled.
    const approvingButton = screen.getByRole("button", {
      name: "Approving stake…",
    });
    expect(approvingButton).toBeDisabled();

    resolveApproval({ ok: 7n });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Place 1 ICP bet" }),
      ).toBeEnabled();
    });
  });

  it("drives the approval copy from the selected pot so the stake amount stays in sync", async () => {
    // The approval form wording must state the bet amount. The bet amount is
    // the selected pot's stake, so the allowance warning and the Place bet
    // button must track the pot selection. This pins the pot-driven stake
    // seam the fee-wording change must not disturb.
    const user = userEvent.setup();
    mockPbpp.connection = {
      status: "connected",
      account: { owner: "owner-principal-abc", subaccount: null },
    };
    mockPbpp.checkAllowance.mockResolvedValue({
      allowance: 10_000_000n,
      expires_at: [],
    });
    renderWithProviders(<PredictionBetWindow />);

    // Default pot is 1 ICP — the warning and button name that stake.
    await waitFor(() => {
      expect(
        screen.getByText(/Place bet will approve your 1 ICP stake first/),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Place 1 ICP bet" }),
    ).toBeInTheDocument();

    // Selecting the 10 ICP pot updates both the warning and the button to the
    // new stake amount.
    await user.click(screen.getByRole("button", { name: "10 ICP" }));
    await waitFor(() => {
      expect(
        screen.getByText(/Place bet will approve your 10 ICP stake first/),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Place 10 ICP bet" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Place 1 ICP bet" }),
    ).not.toBeInTheDocument();
  });
});

describe("PredictionBetWindow approval breakdown wording", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockPbpp.connection = { status: "disconnected" };
    mockPbpp.checkAllowance.mockResolvedValue(null);
    window.localStorage.clear();
  });

  function connectWallet() {
    mockPbpp.connection = {
      status: "connected",
      account: { owner: "owner-principal-abc", subaccount: null },
    };
  }

  it("states the bet amount, the 0.0001 ICP transfer fee, and that the fee is for the Internet Computer ICRC network transfer", async () => {
    // The accepted wording must tell the player exactly what the approval
    // covers: the bet amount, the transfer fee amount (0.0001 ICP), and that
    // the fee is for the Internet Computer ICRC network transfer.
    connectWallet();
    renderWithProviders(<PredictionBetWindow />);

    // The breakdown is only shown once the wallet is connected.
    const breakdown = await screen.findByText(
      /Approving 1 ICP plus the transfer fee/,
    );
    expect(breakdown).toBeInTheDocument();

    // The bet amount is stated.
    expect(screen.getByText(/1 ICP for your bet/)).toBeInTheDocument();
    // The transfer fee amount is stated as 0.0001 ICP.
    expect(screen.getByText(/0\.0001 ICP/)).toBeInTheDocument();
    // The fee is explicitly for the Internet Computer ICRC network transfer.
    expect(
      screen.getByText(/Internet Computer ICRC network transfer fee/),
    ).toBeInTheDocument();
  });

  it("tracks the selected pot's bet amount in the approval breakdown", async () => {
    // The bet amount in the breakdown must follow the selected pot, so the
    // player always sees the amount they are actually approving.
    const user = userEvent.setup();
    connectWallet();
    renderWithProviders(<PredictionBetWindow />);

    await screen.findByText(/Approving 1 ICP plus the transfer fee/);

    // Selecting the 10 ICP pot updates the breakdown's bet amount.
    await user.click(screen.getByRole("button", { name: "10 ICP" }));
    expect(
      screen.getByText(/Approving 10 ICP plus the transfer fee/),
    ).toBeInTheDocument();
    expect(screen.getByText(/10 ICP for your bet/)).toBeInTheDocument();
    // The fee figure stays 0.0001 ICP regardless of the pot.
    expect(screen.getByText(/0\.0001 ICP/)).toBeInTheDocument();
  });

  it("shows no other fee figure in the approval form", async () => {
    // The accepted wording must not show any other fee figure — only the
    // 0.0001 ICP Internet Computer ICRC network transfer fee. The breakdown
    // must not surface the platform-fee percentage or any other amount.
    connectWallet();
    renderWithProviders(<PredictionBetWindow />);

    await screen.findByText(/Approving 1 ICP plus the transfer fee/);

    // The only fee figure present is 0.0001 ICP.
    expect(screen.getByText(/0\.0001 ICP/)).toBeInTheDocument();
    // No platform-fee percentage or other fee figure appears in the approval form.
    expect(screen.queryByText(/0\.1%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1\.5%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.005 ICP/)).not.toBeInTheDocument();
  });
});

describe("PredictionBetWindow live-payments footer mention", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders the live-payments mention with a new-tab link and the trailing text", () => {
    const { container } = renderWithProviders(<PredictionBetWindow />);

    const mention = container.querySelector(
      '[data-ocid="prediction_bet.live_payments_mention"]',
    );
    expect(mention).not.toBeNull();

    const link = mention?.querySelector("a");
    expect(link).not.toBeNull();
    // The link opens in a new tab with noopener/noreferrer.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // The footer link points at the live-payments site and reads the accepted
    // copy: 'Visit jalca-escrow-ledger.xyz to see live payments.'
    expect(link).toHaveAttribute("href", "https://jalca-escrow-ledger.xyz");
    expect(link).toHaveTextContent("jalca-escrow-ledger.xyz");

    // The trailing copy is preserved.
    expect(mention?.textContent).toContain("to see live payments.");
  });
});
