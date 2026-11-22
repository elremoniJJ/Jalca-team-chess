import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the ADJACENT behavior around the fee-wording change.
 *
 * The request changes the site's fee wording from a 0.1% platform fee to a
 * 1.5% platform fee, with a corrected payout explanation, network-fee details,
 * timeout-refund details, and a worked example. The fee wording itself is
 * intentionally changing, so this file does NOT pin the platform-fee
 * percentage or the worked-example arithmetic.
 *
 * Instead it protects the seams the wording edit must not disturb:
 *
 *   1. The approval breakdown's network transfer fee is the ICRC network fee
 *      (0.0001 ICP), derived from the shared `ICP_TRANSFER_FEE_E8S` constant —
 *      it is NOT the platform fee, and the two must not be conflated. The
 *      breakdown must never surface the platform-fee percentage.
 *   2. The relay success surface formats the staked amount through the shared
 *      ICP formatter, so a non-trivial pot (1000 ICP) renders with thousands
 *      separators and the correct denomination.
 *   3. The InformationModal's prediction section keeps its escrow/pot/outcome
 *      description, and the other seven sections are untouched by the fee
 *      edit.
 *   4. The betting-flow walkthrough keeps its non-settlement stages and the
 *      approve-stage e8s rule line (bet + fee in e8s), which the fee-wording
 *      edit must not disturb.
 *
 * The backend actor and Oisy signer are mocked throughout; this is
 * component/integration coverage, not deployed browser E2E or real backend
 * behavior.
 */

// The PredictionBetWindow imports Pot/GameOutcome from @/backend, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock them with the symbols the generated backend wrapper re-exports.
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

vi.mock("@/hooks/use-game-state", () => ({
  useGameState: () => ({
    data: { players: [{ principal: "player-1", username: "Ada" }] },
    isLoading: false,
    error: null,
  }),
}));

// The InformationModal renders a CanisterCyclesGauge in its footer. That
// gauge's useCanisterCycles hook reads the React Query client and makes a real
// network call to the IC blackhole canister, and its import chain transitively
// pulls in @caffeineai/core-infrastructure. The gauge is out of scope for this
// cover, so mock it to a marker (the same workaround the existing
// information-modal.test.tsx uses).
vi.mock("@/components/CanisterCyclesGauge", () => ({
  CanisterCyclesGauge: () => <div data-testid="canister-cycles-gauge" />,
  NftMintingCanisterGauge: () => (
    <div data-testid="nft-minting-canister-gauge" />
  ),
  EscrowLedgerCanisterGauge: () => (
    <div data-testid="escrow-ledger-canister-gauge" />
  ),
}));
vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
}));

// Drive the approval flow deterministically by mocking usePbppBet. The
// connection state, approveAllowance outcome, and relayBet are controlled
// per-test so the approval breakdown and the relay success surface can be
// asserted without opening a real signer popup or touching the actor.
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
    relayState: { status: "idle" } as
      | { status: "idle" }
      | { status: "relaying" }
      | { status: "success"; blockIndex: bigint }
      | { status: "error"; message: string },
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
    relayState: mockPbpp.relayState,
    relayBet: mockPbpp.relayBet,
    getRealBets: vi.fn().mockResolvedValue([]),
    getSettlements: vi.fn().mockResolvedValue([]),
  }),
}));

import { InformationModal } from "@/components/InformationModal";
import { PredictionBetWindow } from "@/components/PredictionBetWindow";
import { ICP_TRANSFER_FEE_E8S } from "@/lib/pbpp";

// The InformationModal's sections carry deterministic `data-ocid` markers
// rather than `data-testid`. Configure the test-id attribute so getByTestId
// can target them semantically.
configure({ testIdAttribute: "data-ocid" });

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

function connectWallet() {
  mockPbpp.connection = {
    status: "connected",
    account: { owner: "owner-principal-abc", subaccount: null },
  };
}

describe("PredictionBetWindow approval breakdown network-fee seam", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockPbpp.connection = { status: "disconnected" };
    mockPbpp.checkAllowance.mockResolvedValue(null);
    mockPbpp.relayState = { status: "idle" };
    window.localStorage.clear();
  });

  it("derives the displayed network transfer fee from ICP_TRANSFER_FEE_E8S, not a hardcoded figure", async () => {
    // The breakdown's fee figure must track the shared constant so the
    // displayed amount stays consistent with the allowance math. The platform
    // fee is a separate concept and must never appear in the approval form.
    connectWallet();
    // Seed the Prediction Bet window open so its body mounts regardless of the
    // collapsed-by-default first-visit state.
    window.localStorage.setItem("tco-prediction-bet-open", "true");
    renderWithProviders(<PredictionBetWindow />);

    const breakdown = await screen.findByText(
      /Approving 1 ICP plus the transfer fee/,
    );
    expect(breakdown).toBeInTheDocument();

    // The expected figure is computed from the exported constant (10_000 e8s
    // = 0.0001 ICP), so a change to the constant is reflected here.
    const expectedFeeIcp = (Number(ICP_TRANSFER_FEE_E8S) / 100_000_000).toFixed(
      4,
    );
    expect(expectedFeeIcp).toBe("0.0001");
    expect(
      screen.getByText(new RegExp(`${expectedFeeIcp} ICP`)),
    ).toBeInTheDocument();

    // The breakdown names the fee as the Internet Computer ICRC network
    // transfer fee — not the platform fee.
    expect(
      screen.getByText(/Internet Computer ICRC network transfer fee/),
    ).toBeInTheDocument();
    // No platform-fee percentage leaks into the approval form.
    expect(screen.queryByText(/0\.1%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1\.5%/)).not.toBeInTheDocument();
  });

  it("keeps the network fee fixed while the bet amount tracks the selected pot", async () => {
    // The bet amount follows the pot; the network fee does not. This pins the
    // two independent figures the fee-wording edit must not merge.
    const user = userEvent.setup();
    connectWallet();
    // Seed the Prediction Bet window open so its body mounts.
    window.localStorage.setItem("tco-prediction-bet-open", "true");
    renderWithProviders(<PredictionBetWindow />);

    await screen.findByText(/Approving 1 ICP plus the transfer fee/);

    await user.click(screen.getByRole("button", { name: "1000 ICP" }));

    expect(
      screen.getByText(/Approving 1000 ICP plus the transfer fee/),
    ).toBeInTheDocument();
    expect(screen.getByText(/1000 ICP for your bet/)).toBeInTheDocument();
    // The network fee figure is unchanged by the pot selection.
    expect(screen.getByText(/0\.0001 ICP/)).toBeInTheDocument();
  });
});

describe("PredictionBetWindow relay success amount formatting", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockPbpp.connection = { status: "disconnected" };
    mockPbpp.checkAllowance.mockResolvedValue(null);
    mockPbpp.relayState = { status: "idle" };
    window.localStorage.clear();
  });

  it("formats a non-trivial staked amount with thousands separators in the success surface", async () => {
    // The success surface renders the staked amount through the shared ICP
    // formatter. The worked-example arithmetic is intentionally changing, but
    // the amount formatting on the success surface is adjacent behavior that
    // must survive.
    const user = userEvent.setup();
    connectWallet();
    mockPbpp.checkAllowance.mockResolvedValue({
      allowance: 1_000_000_000_000n,
      expires_at: [],
    });
    mockPbpp.approveAllowance.mockResolvedValue({ ok: 7n });
    mockPbpp.relayBet.mockResolvedValue(undefined);
    mockPbpp.relayState = { status: "success", blockIndex: 42n };

    // Seed the Prediction Bet window open so its body mounts.
    window.localStorage.setItem("tco-prediction-bet-open", "true");
    renderWithProviders(<PredictionBetWindow />);

    // Select the 1000 ICP pot so the success surface names a formatted amount.
    await user.click(screen.getByRole("button", { name: "1000 ICP" }));

    expect(screen.getByText("Real bet placed")).toBeInTheDocument();
    // 1000 ICP renders with a thousands separator and the ICP denomination.
    expect(screen.getByText(/1,000 ICP/)).toBeInTheDocument();
    expect(screen.getByText(/Escrowed in ledger block/)).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});

describe("InformationModal prediction section adjacent content", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the escrow, pot, and outcome description in the prediction section", () => {
    // The fee percentage in this section is intentionally changing, but the
    // surrounding description of how a bet is held and settled must survive.
    render(<InformationModal onClose={vi.fn()} />);

    const prediction = screen.getByTestId("information.section.prediction");
    const scope = within(prediction);

    // The three outcomes and the pot denominations are still described.
    expect(scope.getByText("White")).toBeInTheDocument();
    expect(scope.getByText("Black")).toBeInTheDocument();
    expect(scope.getByText("Draw")).toBeInTheDocument();
    expect(scope.getByText(/1, 10, 100, or 1000 ICP/)).toBeInTheDocument();
    // The escrow holder and the settlement flow are still named.
    expect(scope.getByText(/held in escrow by JEL/)).toBeInTheDocument();
    expect(scope.getByText(/JEL settles the pot/)).toBeInTheDocument();
    // The winnings are still paid to correct predictors. The fee percentage
    // and the payout split are intentionally changing, so this asserts only
    // the surviving description of who is paid.
    expect(
      scope.getByText(
        /split equally among the players in that pot who predicted correctly/,
      ),
    ).toBeInTheDocument();
  });

  it("leaves the non-prediction sections' content intact", () => {
    // The fee edit touches only the prediction section; the other sections
    // must be unaffected.
    render(<InformationModal onClose={vi.fn()} />);

    expect(screen.getByTestId("information.section.game")).toHaveTextContent(
      /randomly assigned to the White and Black teams/,
    );
    expect(
      screen.getByTestId("information.section.settings"),
    ).toHaveTextContent(/standard opening/);
    expect(
      screen.getByTestId("information.section.move_maker"),
    ).toHaveTextContent(/Move_Maker/);
    expect(screen.getByTestId("information.section.move")).toHaveTextContent(
      /three clicks/,
    );
    expect(screen.getByTestId("information.section.kick")).toHaveTextContent(
      /more than half of the team's active members have voted to kick/,
    );
    expect(screen.getByTestId("information.section.wallet")).toHaveTextContent(
      /earn an NFT spell/,
    );
  });
});

describe("PredictionBetWindow walkthrough adjacent stages", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockPbpp.connection = { status: "disconnected" };
    mockPbpp.checkAllowance.mockResolvedValue(null);
    mockPbpp.relayState = { status: "idle" };
    window.localStorage.clear();
  });

  it("keeps the non-settlement stages and the approve-stage e8s rule line", async () => {
    // The settlement and refund stage wording is intentionally changing, but
    // the earlier stages and the approve-stage e8s rule (bet + fee in e8s)
    // must survive the fee-wording edit.
    const user = userEvent.setup();
    // Seed the Prediction Bet window open so its body mounts.
    window.localStorage.setItem("tco-prediction-bet-open", "true");
    renderWithProviders(<PredictionBetWindow />);

    await user.click(
      screen.getByRole("button", { name: "Toggle prediction bet information" }),
    );

    // The non-settlement stage labels are present.
    for (const label of [
      "Select pot & outcome",
      "Connect wallet",
      "Approve JEL as spender",
      "JALCA verifies & relays",
      "JEL pulls the bet",
      "Bet recorded",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // The first stage is active by default and shows its e8s rule line.
    expect(screen.getByText("1 ICP = 100_000_000 e8s")).toBeInTheDocument();

    // Advance to the approve stage and assert its e8s rule line.
    const next = screen.getByRole("button", { name: "Next" });
    await user.click(next);
    await user.click(next);
    expect(screen.getByText("Approve JEL for bet + fee")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Approval = bet + fee, e.g. 100_000_000 + 10_000 = 100_010_000 e8s",
      ),
    ).toBeInTheDocument();
  });
});
