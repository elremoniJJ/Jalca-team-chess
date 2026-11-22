import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The PredictionBetWindow imports Pot from @/backend, which transitively pulls
// in @caffeineai/object-storage, and its usePbppBet hook pulls in
// @caffeineai/core-infrastructure via lib/backend-actor. Those packages fail to
// resolve their own submodules in the jsdom test environment (a pre-existing
// dependency issue), so mock them with the symbols the generated backend
// wrapper re-exports. The window under test never touches the actor.
vi.mock("@caffeineai/object-storage", () => ({
  ExternalBlob: Symbol("ExternalBlob"),
}));
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
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

// Drive the real-bet panel through a mocked usePbppBet so the test controls
// the wallet connection and the approval/relay wiring deterministically,
// without opening a real signer popup or touching the actor.
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
 * Characterization of the Prediction Bet window's collapse behavior and the
 * real-bet control panel that must survive the removal of the diagnostic
 * 'Send test' control.
 *
 * The request removes the diagnostic test section from the Prediction Bet
 * window. That section is intentionally changing, so it is NOT asserted here.
 * These tests protect the ADJACENT behavior in the same component that the
 * removal must not disturb:
 *
 *   - the window header toggles the body open/closed via aria-expanded, and
 *     the body is UNMOUNTED when collapsed;
 *   - the open/collapsed state persists to localStorage under
 *     "tco-prediction-bet-open" and is restored on the next mount;
 *   - the real-bet control panel (pot selection, White/Black/Draw outcome,
 *     anonymity switch, wallet connect, Place bet) still renders and works;
 *   - the info button still swaps the body between the info content and the
 *     real-bet panel.
 *
 * The backend actor and Oisy signer are mocked throughout; this is
 * component/integration coverage, not deployed browser E2E.
 */

describe("PredictionBetWindow collapse behavior", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockPbpp.connection = { status: "disconnected" };
    mockPbpp.checkAllowance.mockResolvedValue(null);
    window.localStorage.clear();
  });

  it("expands by default and collapses the body when the header is toggled", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PredictionBetWindow />);

    const header = screen.getByRole("button", { name: /Prediction Bet/ });
    // Expanded by default: aria-expanded true and the real-bet panel mounted.
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "1 ICP" })).toBeInTheDocument();

    // Collapsing unmounts the body.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "1 ICP" }),
    ).not.toBeInTheDocument();

    // Expanding restores the body.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "1 ICP" })).toBeInTheDocument();
  });

  it("persists the collapsed state to localStorage and restores it on remount", async () => {
    const user = userEvent.setup();
    const first = renderWithProviders(<PredictionBetWindow />);

    await user.click(screen.getByRole("button", { name: /Prediction Bet/ }));
    expect(window.localStorage.getItem("tco-prediction-bet-open")).toBe(
      "false",
    );

    // Remount: the collapsed state is restored from localStorage.
    first.unmount();
    renderWithProviders(<PredictionBetWindow />);
    expect(
      screen.getByRole("button", { name: /Prediction Bet/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "1 ICP" }),
    ).not.toBeInTheDocument();
  });

  it("restores an expanded state written by a previous session", () => {
    window.localStorage.setItem("tco-prediction-bet-open", "true");
    renderWithProviders(<PredictionBetWindow />);

    expect(
      screen.getByRole("button", { name: /Prediction Bet/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "1 ICP" })).toBeInTheDocument();
  });
});

describe("PredictionBetWindow real-bet panel survives the diagnostic removal", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockPbpp.connection = { status: "disconnected" };
    mockPbpp.checkAllowance.mockResolvedValue(null);
    window.localStorage.clear();
  });

  it("renders the full real-bet control panel with pot, outcome, anonymity, and connect controls", () => {
    renderWithProviders(<PredictionBetWindow />);

    // Pot denominations.
    for (const label of ["1 ICP", "10 ICP", "100 ICP", "1000 ICP"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // 3-way outcome toggles.
    expect(screen.getByRole("button", { name: "White" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Black" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draw" })).toBeInTheDocument();
    // Anonymity switch and wallet connect.
    expect(
      screen.getByRole("switch", { name: "Make my username public" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("keeps the pot and outcome selection interactive", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PredictionBetWindow />);

    await user.click(screen.getByRole("button", { name: "100 ICP" }));
    await user.click(screen.getByRole("button", { name: "Draw" }));

    expect(screen.getByRole("button", { name: "100 ICP" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Draw" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "1 ICP" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("still chains approveAllowance then relayBet from the Place bet button", async () => {
    const user = userEvent.setup();
    mockPbpp.connection = {
      status: "connected",
      account: { owner: "owner-principal-abc", subaccount: null },
    };
    mockPbpp.approveAllowance.mockResolvedValue({ ok: 100_000_000n });
    mockPbpp.relayBet.mockResolvedValue(undefined);
    renderWithProviders(<PredictionBetWindow />);

    await user.click(screen.getByRole("button", { name: "Place 1 ICP bet" }));

    await waitFor(() => {
      expect(mockPbpp.approveAllowance).toHaveBeenCalledWith(100_000_000n);
    });
    await waitFor(() => {
      expect(mockPbpp.relayBet).toHaveBeenCalledTimes(1);
    });
  });

  it("still swaps between the info content and the real-bet panel via the info button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PredictionBetWindow />);

    // Default: real-bet panel.
    expect(screen.getByRole("button", { name: "1 ICP" })).toBeInTheDocument();

    // Info on: real-bet panel hidden, info content shown.
    await user.click(
      screen.getByRole("button", { name: "Toggle prediction bet information" }),
    );
    expect(
      screen.queryByRole("button", { name: "1 ICP" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("How it works")).toBeInTheDocument();

    // Info off: real-bet panel restored.
    await user.click(
      screen.getByRole("button", { name: "Toggle prediction bet information" }),
    );
    expect(screen.getByRole("button", { name: "1 ICP" })).toBeInTheDocument();
  });
});
