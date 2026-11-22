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
 * Cover for the accepted 1.5% platform-fee wording.
 *
 * The request replaces the site's old 0.1% platform fee with a 1.5% platform
 * fee and corrects the surrounding payout explanation. This file asserts the
 * accepted observable text in the two fee-wording sites:
 *
 *   - PredictionBetWindow's "How it works" bullets and "Worked example";
 *   - PredictionBetWindow's betting-flow walkthrough settlement/refund stages;
 *   - InformationModal's Prediction Betting section.
 *
 * It also asserts the negative: no frontend text still states a 0.1% (or
 * 0.10%, 1/1000, 10 basis points) platform fee.
 *
 * The backend actor and Oisy signer are mocked throughout; this is
 * component/integration coverage, not deployed browser E2E or real backend
 * behavior. The fee wording is static copy, so no actor call is involved.
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
vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
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

// The window's BettingPanel is wired through usePbppBet. The fee wording under
// test is static info content, so the hook is mocked to its resting state and
// never drives an actor call.
vi.mock("@/lib/use-pbpp-bet", () => ({
  usePbppBet: () => ({
    connection: { status: "disconnected" },
    connect: vi.fn(),
    disconnect: vi.fn(),
    signerAvailable: true,
    anonymous: false,
    setAnonymous: vi.fn(),
    submitState: { status: "idle" },
    submitBet: vi.fn(),
    approveAllowance: vi.fn(),
    checkAllowance: vi.fn().mockResolvedValue(null),
    relayState: { status: "idle" },
    relayBet: vi.fn(),
    getRealBets: vi.fn().mockResolvedValue([]),
    getSettlements: vi.fn().mockResolvedValue([]),
  }),
}));

import { InformationModal } from "@/components/InformationModal";
import { PredictionBetWindow } from "@/components/PredictionBetWindow";

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

/** Open the PredictionBetWindow's info content (How it works + worked example). */
async function openBetInfo() {
  const user = userEvent.setup();
  // Seed the Prediction Bet window open so its body (and the info panel)
  // mounts regardless of the collapsed-by-default first-visit state.
  window.localStorage.setItem("tco-prediction-bet-open", "true");
  renderWithProviders(<PredictionBetWindow />);
  await user.click(
    screen.getByRole("button", { name: "Toggle prediction bet information" }),
  );
  return user;
}

describe("PredictionBetWindow How it works fee wording", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("states the 1.5% platform fee and the 98.5% equal split among winners", async () => {
    await openBetInfo();

    expect(
      screen.getByText(/A 1\.5% platform fee is taken from each pot/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /remaining 98\.5% is split equally among the winning bettors/,
      ),
    ).toBeInTheDocument();
  });

  it("states the no-winner case returns 98.5% equally and still charges 1.5%", async () => {
    await openBetInfo();

    expect(
      screen.getByText(/If nobody in a pot predicted the correct outcome/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/98\.5% is returned equally to everyone in that pot/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the 1\.5% platform fee still applies/),
    ).toBeInTheDocument();
  });

  it("states the 0.0001 ICP network fee, when it is paid, and that it goes to the network", async () => {
    await openBetInfo();

    expect(
      screen.getByText(
        /charges a 0\.0001 ICP network transfer fee per transfer/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/paid once when you place a bet/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/deducted from each payout you receive/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This fee goes to the network, not to the platform/),
    ).toBeInTheDocument();
  });

  it("states the 2-hour timeout refund keeps the stake minus only the network fee, with no platform fee", async () => {
    await openBetInfo();

    expect(
      screen.getByText(/If a game times out after 2 hours without a result/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/stake back minus only the 0\.0001 ICP network fee/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no platform fee is charged on timeout refunds/),
    ).toBeInTheDocument();
  });

  it("states that very small pots below the network fee do not incur the platform fee", async () => {
    await openBetInfo();

    expect(
      screen.getByText(
        /Very small pots where the fee would be less than the network fee do not incur the platform fee/,
      ),
    ).toBeInTheDocument();
  });
});

describe("PredictionBetWindow worked example fee arithmetic", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("shows the 10 ICP pot example with a 0.15 ICP fee and 9.85 ICP shared among winners", async () => {
    await openBetInfo();

    expect(
      screen.getByText("Simple example — a 10 ICP pot"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /In a pot of 10 ICP, the 1\.5% platform fee is 0\.15 ICP/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/remaining 9\.85 ICP is shared among the winners/),
    ).toBeInTheDocument();
  });

  it("shows the per-pot breakdown using 1.5% fee arithmetic", async () => {
    await openBetInfo();

    // 1 ICP pot: 5 ICP pot, 1.5% = 0.075 ICP, 4.925 ICP split three ways.
    expect(screen.getByText(/Fee: 1\.5% \(0\.075 ICP\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/split the remaining 4\.925 ICP equally/),
    ).toBeInTheDocument();

    // 10 ICP pot: 40 ICP pot, 1.5% = 0.6 ICP, 39.4 ICP returned four ways.
    expect(screen.getByText(/Fee: 1\.5% \(0\.6 ICP\)/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /remaining 39\.4 ICP is returned equally to all four players/,
      ),
    ).toBeInTheDocument();

    // 100 ICP pot: 600 ICP pot, 1.5% = 9 ICP, 591 ICP split four ways.
    expect(screen.getByText(/Fee: 1\.5% \(9 ICP\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/split the remaining 591 ICP equally/),
    ).toBeInTheDocument();

    // 1000 ICP pot: 2000 ICP pot, 1.5% = 30 ICP, 1970 ICP to the winner.
    expect(screen.getByText(/Fee: 1\.5% \(30 ICP\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/takes the remaining 1970 ICP/),
    ).toBeInTheDocument();
  });
});

describe("PredictionBetWindow walkthrough settlement and refund stages", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("states the 1.5% fee and 98.5% split in the settlement stage", async () => {
    const user = await openBetInfo();

    // Advance to the settlement stage (stage 7 of 8).
    const next = screen.getByRole("button", { name: "Next" });
    for (let i = 0; i < 6; i += 1) {
      await user.click(next);
    }

    expect(
      screen.getByText("JEL settles the locked round"),
    ).toBeInTheDocument();
    // Scope to the walkthrough's active-stage body so the identical phrase in
    // the "How it works" bullet does not create an ambiguous match.
    const stageBody = screen
      .getByText("JEL settles the locked round")
      .closest(".flow-body");
    expect(stageBody).not.toBeNull();
    const stage = within(stageBody as HTMLElement);
    expect(
      stage.getByText(/a 1\.5% platform fee is taken from the pot/),
    ).toBeInTheDocument();
    expect(
      stage.getByText(
        /remaining 98\.5% is split equally among the winning bettors/,
      ),
    ).toBeInTheDocument();
    expect(stage.getByText(/the 1\.5% fee still applies/)).toBeInTheDocument();
    expect(
      stage.getByText("1.5% platform fee; 98.5% split equally among winners"),
    ).toBeInTheDocument();
  });

  it("states the 2-hour refund keeps the stake minus only the network fee, with no platform fee", async () => {
    const user = await openBetInfo();

    // Advance to the final refund stage (stage 8 of 8).
    const next = screen.getByRole("button", { name: "Next" });
    for (let i = 0; i < 7; i += 1) {
      await user.click(next);
    }

    expect(screen.getByText("2-hour auto-refund path")).toBeInTheDocument();
    expect(
      screen.getByText(
        /stake back minus only the 0\.0001 ICP network transfer fee/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No platform fee is charged on timeout refunds/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "2-hour auto-refund; no platform fee, only the 0.0001 ICP network fee",
      ),
    ).toBeInTheDocument();
  });
});

describe("InformationModal Prediction Betting fee wording", () => {
  afterEach(() => {
    cleanup();
  });

  it("states the 1.5% fee, the 98.5% split, the no-winner case, the network fee, the timeout refund, and the small-pot rule", () => {
    render(<InformationModal onClose={vi.fn()} />);

    const prediction = screen.getByTestId("information.section.prediction");
    const scope = within(prediction);

    // 1.5% platform fee and the 98.5% equal split among correct predictors.
    expect(scope.getByText("1.5% platform fee")).toBeInTheDocument();
    expect(
      scope.getByText(
        /remaining 98\.5% is split equally among the players in that pot who predicted correctly/,
      ),
    ).toBeInTheDocument();

    // No-winner case: 98.5% returned equally, 1.5% still applies.
    expect(
      scope.getByText(
        /remaining 98\.5% is returned equally to everyone in the pot/,
      ),
    ).toBeInTheDocument();
    expect(scope.getByText(/the 1\.5% fee still applies/)).toBeInTheDocument();

    // 0.0001 ICP network fee: paid once on bet, deducted from each payout,
    // goes to the network.
    expect(
      scope.getByText(/0\.0001 ICP network transfer fee per transfer/),
    ).toBeInTheDocument();
    expect(
      scope.getByText(
        /paid once when you place a bet and deducted from each payout you receive/,
      ),
    ).toBeInTheDocument();
    expect(
      scope.getByText(/which goes to the network, not the platform/),
    ).toBeInTheDocument();

    // 2-hour timeout refund: stake minus only the network fee, no platform fee.
    expect(
      scope.getByText(
        /stake back minus only that 0\.0001 ICP network fee, with no platform fee charged/,
      ),
    ).toBeInTheDocument();

    // Very small pots below the network fee do not incur the platform fee.
    expect(
      scope.getByText(
        /Very small pots where the fee would be less than the network fee do not incur the platform fee/,
      ),
    ).toBeInTheDocument();
  });
});

describe("No superseded 0.1% platform-fee wording remains", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders no 0.1% / 0.10% / 1-in-1000 / basis-point fee wording in the PredictionBetWindow info content", async () => {
    await openBetInfo();

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/0\.1\s*%/);
    expect(body).not.toMatch(/0\.10\s*%/);
    expect(body).not.toMatch(/1\s*\/\s*1000/);
    expect(body).not.toMatch(/basis point/i);
  });

  it("renders no 0.1% / 0.10% / 1-in-1000 / basis-point fee wording in the InformationModal", () => {
    render(<InformationModal onClose={vi.fn()} />);

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/0\.1\s*%/);
    expect(body).not.toMatch(/0\.10\s*%/);
    expect(body).not.toMatch(/1\s*\/\s*1000/);
    expect(body).not.toMatch(/basis point/i);
  });
});
