import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
// useActorState() now consumes useInternetIdentity() to attach the signed-in
// identity to the actor, so the mock must provide it too. Signed out here: the
// window under test never touches the actor.
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
  useInternetIdentity: () => ({ identity: null }),
}));

import { Layout } from "@/components/Layout";
import { PredictionBetWindow } from "@/components/PredictionBetWindow";

// Mock usePbppBet so the window renders without a real wallet/actor. The
// diagnostic test surface (sendTest / testState) was removed from the hook
// along with the window's diagnostic control, so the mock no longer carries
// it.
const { mockUsePbppBet } = vi.hoisted(() => ({
  mockUsePbppBet: vi.fn(),
}));
vi.mock("@/lib/use-pbpp-bet", () => ({
  usePbppBet: mockUsePbppBet,
}));

// Default mock return mirrors the real hook's resting state (disconnected
// wallet, idle submission state), so the existing characterization tests
// render the window as before. Individual tests override the fields they care
// about. The manual settlement surface (settlementState / reportOutcome) was
// removed from the hook — the backend now reports game outcomes to JEL
// automatically at game conclusion.
mockUsePbppBet.mockReturnValue({
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
});

// The window's BettingPanel calls useGameState -> useActorState, which reads
// the React Query client. Wrap every render in a QueryClientProvider so the
// real window can mount (the actor itself is never called).
function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/**
 * Characterization of the Prediction Bet window and its Layout slot.
 *
 * The request re-mounts the Prediction Bet window by wiring a `predictionBet`
 * key into the game route's window stack. The Layout component already owns
 * that slot: when a `predictionBet` node is provided it renders the window in
 * the fixed stack. The 'Prediction Bet' nav link that previously sat in the
 * top brand buffer has been REMOVED as part of the header reorganization
 * (the header now shows Info, Theme palette, and Logout next to the JALCA
 * title), so these tests no longer assert any nav link.
 *
 * These tests protect the seams the change relies on and must not disturb:
 *   - Layout renders the window when the slot is present;
 *   - the PredictionBetWindow renders its info button, worked example, and
 *     the wired betting panel (pot selection / White-Black-Draw outcome /
 *     anonymity switch / wallet connect);
 *   - the betting controls update the local pot/outcome selection without
 *     opening a dialog or navigating.
 *
 * The betting panel is wired to the backend through usePbppBet, but the
 * window under test never calls the actor (the wallet is not connected in
 * the test environment), so submission stays disabled.
 */

describe("Layout predictionBet slot", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("no longer renders the Prediction Bet window in the Layout stack", () => {
    // The accepted change removes the predictionBet slot from the Layout
    // stack: the window now renders inside the board view overlay instead.
    const { container } = renderWithProviders(
      <Layout
        onLogout={() => {}}
        windows={{
          board: <div>board</div>,
        }}
      />,
    );

    expect(
      container.querySelector('[data-ocid="prediction_bet_window"]'),
    ).toBeNull();
  });

  it("renders the Prediction Bet window standalone when mounted directly", () => {
    const { container } = renderWithProviders(<PredictionBetWindow />);

    // The window itself still mounts with its own data-ocid marker.
    expect(
      container.querySelector('[data-ocid="prediction_bet_window"]'),
    ).not.toBeNull();
  });
});

describe("PredictionBetWindow", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders the info button and the wired betting panel by default", () => {
    renderWithProviders(<PredictionBetWindow />);

    // Info toggle button beside the heading.
    expect(
      screen.getByRole("button", { name: "Toggle prediction bet information" }),
    ).toBeInTheDocument();

    // The four pot denominations, one button each.
    for (const label of ["1 ICP", "10 ICP", "100 ICP", "1000 ICP"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }

    // The 3-way White/Black/Draw outcome toggles are present in the
    // Prediction fieldset. (The manual "Settle outcome" section that once
    // rendered a second set of White/Black/Draw buttons has been removed, so
    // the Prediction fieldset is the only source of these buttons.)
    const prediction = within(
      screen.getByRole("group", { name: "Prediction" }),
    );
    expect(
      prediction.getByRole("button", { name: "White" }),
    ).toBeInTheDocument();
    expect(
      prediction.getByRole("button", { name: "Black" }),
    ).toBeInTheDocument();
    expect(
      prediction.getByRole("button", { name: "Draw" }),
    ).toBeInTheDocument();

    // The anonymity switch and wallet connect button are present.
    expect(
      screen.getByRole("switch", { name: "Make my username public" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("shows the worked example when the info button is toggled on", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PredictionBetWindow />);

    expect(screen.queryByText("Worked example")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Toggle prediction bet information" }),
    );

    expect(screen.getByText("Worked example")).toBeInTheDocument();
    expect(screen.getByText(/1 ICP pot — 5 players/)).toBeInTheDocument();
    expect(screen.getByText(/1000 ICP pot — 2 players/)).toBeInTheDocument();
  });

  it("toggles between the info panel and the wired betting panel via the info button", async () => {
    // The info button swaps the body between the information content and the
    // wired betting control panel. The info CONTENT itself is intentionally
    // changing (a static walkthrough becomes an interactive flowchart), so
    // this characterization pins only the toggle mechanism that must survive:
    // selecting info hides the betting panel, deselecting restores it.
    const user = userEvent.setup();
    renderWithProviders(<PredictionBetWindow />);

    // Default: the wired betting panel is shown (pot selection present).
    expect(screen.getByRole("button", { name: "1 ICP" })).toBeInTheDocument();

    // Selecting info hides the betting panel and shows the info content.
    await user.click(
      screen.getByRole("button", { name: "Toggle prediction bet information" }),
    );
    expect(
      screen.queryByRole("button", { name: "1 ICP" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("How it works")).toBeInTheDocument();

    // Deselecting info restores the wired betting panel.
    await user.click(
      screen.getByRole("button", { name: "Toggle prediction bet information" }),
    );
    expect(screen.getByRole("button", { name: "1 ICP" })).toBeInTheDocument();
    expect(screen.queryByText("How it works")).not.toBeInTheDocument();
  });

  it("selects a pot and outcome but keeps the bet submission disabled until connected and approved", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PredictionBetWindow />);

    // The 1 ICP pot and White outcome are selected by default. The outcome
    // buttons live in the Prediction fieldset (the manual "Settle outcome"
    // section that once rendered a second set of White/Black/Draw buttons has
    // been removed).
    const prediction = within(
      screen.getByRole("group", { name: "Prediction" }),
    );
    expect(screen.getByRole("button", { name: "1 ICP" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(prediction.getByRole("button", { name: "White" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Selecting a different pot and outcome updates the selection state.
    await user.click(screen.getByRole("button", { name: "10 ICP" }));
    await user.click(prediction.getByRole("button", { name: "Black" }));
    expect(screen.getByRole("button", { name: "10 ICP" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "1 ICP" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(prediction.getByRole("button", { name: "Black" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(prediction.getByRole("button", { name: "White" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // No dialog or overlay appeared.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders no diagnostic test control anywhere in the window", () => {
    // The accepted requirement removes the diagnostic 'Send test' control and
    // every user-visible trace of it from the Prediction Bet window. The
    // window must render no diagnostic section, no 'Send test' button, and no
    // test-receipt surface.
    renderWithProviders(<PredictionBetWindow />);

    expect(screen.queryByText("Diagnostic test")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Sends the current selections to PBPP as a test/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send test" }),
    ).not.toBeInTheDocument();
    // No test-receipt rows survive either.
    expect(screen.queryByText("Test ID:")).not.toBeInTheDocument();
    expect(screen.queryByText("Received:")).not.toBeInTheDocument();
  });
});

/**
 * Cover for the 2-button real-bet UI in the Prediction Bet window.
 *
 * The request reduces the betting flow from 5 buttons to 2 (Connect wallet +
 * Place bet). The single "Place bet" button chains the two on-chain actions
 * sequentially and automatically: it first triggers the real icrc2_approve
 * naming JEL as spender (the wallet window opens directly from the button
 * click), waits for the approval to confirm, then automatically calls
 * place_bet to relay the bet to JEL. The fixed-amount approval (exactly the
 * bet amount) is kept for safety.
 *
 * The duplicate "Approve stake" button is removed, and "Confirm bet" +
 * "Relay real bet" are merged into the single "Place bet" button.
 *
 * The manual "Settle outcome" section (White/Black/Draw buttons) was REMOVED
 * from the window: the backend now reports game outcomes to JEL automatically
 * at game conclusion, so players have no way to report a result. The absence
 * of that section is asserted below.
 *
 * These tests drive the window through a mocked usePbppBet (the backend actor
 * and Oisy signer are never touched), asserting the observable feedback and
 * the wiring of the Place bet button to the hook's approveAllowance and
 * relayBet methods.
 */
describe("PredictionBetWindow 2-button real-bet UI", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
    mockUsePbppBet.mockReturnValue({
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
    });
  });

  it("shows 'You haven't approved JEL yet' with a single Place bet button when the allowance does not cover the stake", async () => {
    // Connected wallet whose ledger allowance (spender = JEL) is below the
    // 1 ICP stake (100,000,000 e8s).
    mockUsePbppBet.mockReturnValue({
      connection: {
        status: "connected",
        account: { owner: "aaaaa-aa", subaccount: null },
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
      signerAvailable: true,
      anonymous: false,
      setAnonymous: vi.fn(),
      submitState: { status: "idle" },
      submitBet: vi.fn(),
      approveAllowance: vi.fn(),
      checkAllowance: vi.fn().mockResolvedValue({
        allowance: 10_000_000n,
        expires_at: [],
      }),
      relayState: { status: "idle" },
      relayBet: vi.fn(),
      getRealBets: vi.fn().mockResolvedValue([]),
      getSettlements: vi.fn().mockResolvedValue([]),
    });

    renderWithProviders(<PredictionBetWindow />);

    // The allowance check resolves and the warning banner appears, telling the
    // player that Place bet will approve the stake first.
    await waitFor(() => {
      expect(
        screen.getByText(/You haven't approved JEL yet/),
      ).toBeInTheDocument();
    });
    // The single "Place bet" button is present (it chains approve -> relay).
    expect(
      screen.getByRole("button", { name: "Place 1 ICP bet" }),
    ).toBeInTheDocument();
    // No separate "Approve stake" button remains — the flow is 2 buttons.
    expect(
      screen.queryByRole("button", { name: "Approve stake" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Relay real bet" }),
    ).not.toBeInTheDocument();
  });

  it("shows 'Allowance verified' and keeps the single Place bet button when the allowance covers the stake", async () => {
    mockUsePbppBet.mockReturnValue({
      connection: {
        status: "connected",
        account: { owner: "aaaaa-aa", subaccount: null },
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
      signerAvailable: true,
      anonymous: false,
      setAnonymous: vi.fn(),
      submitState: { status: "idle" },
      submitBet: vi.fn(),
      approveAllowance: vi.fn(),
      checkAllowance: vi.fn().mockResolvedValue({
        allowance: 100_000_000n,
        expires_at: [],
      }),
      relayState: { status: "idle" },
      relayBet: vi.fn(),
      getRealBets: vi.fn().mockResolvedValue([]),
      getSettlements: vi.fn().mockResolvedValue([]),
    });

    renderWithProviders(<PredictionBetWindow />);

    await waitFor(() => {
      expect(screen.getByText("Allowance verified")).toBeInTheDocument();
    });
    // The single Place bet button is present and enabled.
    expect(
      screen.getByRole("button", { name: "Place 1 ICP bet" }),
    ).toBeEnabled();
  });

  it("chains approveAllowance then relayBet when Place bet is pressed", async () => {
    const user = userEvent.setup();
    const approveAllowance = vi.fn().mockResolvedValue({ ok: 100_000_000n });
    const relayBet = vi.fn().mockResolvedValue(undefined);
    mockUsePbppBet.mockReturnValue({
      connection: {
        status: "connected",
        account: { owner: "aaaaa-aa", subaccount: null },
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
      signerAvailable: true,
      anonymous: false,
      setAnonymous: vi.fn(),
      submitState: { status: "idle" },
      submitBet: vi.fn(),
      approveAllowance,
      checkAllowance: vi.fn().mockResolvedValue(null),
      relayState: { status: "idle" },
      relayBet,
      getRealBets: vi.fn().mockResolvedValue([]),
      getSettlements: vi.fn().mockResolvedValue([]),
    });

    renderWithProviders(<PredictionBetWindow />);

    // The single Place bet button opens the approval window directly from the
    // click and, after the approval confirms, automatically relays the bet.
    await user.click(screen.getByRole("button", { name: "Place 1 ICP bet" }));

    await waitFor(() => {
      expect(approveAllowance).toHaveBeenCalledTimes(1);
    });
    // The fixed-amount approval (exactly the 1 ICP stake in e8s) is kept.
    expect(approveAllowance).toHaveBeenCalledWith(100_000_000n);
    // After the approval confirms, relayBet is called automatically.
    await waitFor(() => {
      expect(relayBet).toHaveBeenCalledTimes(1);
    });
    expect(relayBet).toHaveBeenCalledWith(
      "Player",
      false,
      1n,
      100_000_000n,
      expect.anything(),
    );
  });

  it("surfaces the ICRC Ledger block index after a successful relay", async () => {
    mockUsePbppBet.mockReturnValue({
      connection: {
        status: "connected",
        account: { owner: "aaaaa-aa", subaccount: null },
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
      signerAvailable: true,
      anonymous: false,
      setAnonymous: vi.fn(),
      submitState: { status: "idle" },
      submitBet: vi.fn(),
      approveAllowance: vi.fn(),
      checkAllowance: vi.fn().mockResolvedValue({
        allowance: 100_000_000n,
        expires_at: [],
      }),
      relayState: {
        status: "success",
        blockIndex: 42n,
      },
      relayBet: vi.fn(),
      getRealBets: vi.fn().mockResolvedValue([]),
      getSettlements: vi.fn().mockResolvedValue([]),
    });

    renderWithProviders(<PredictionBetWindow />);

    // The success state names the placed bet and the escrowed ledger block.
    expect(screen.getByText("Real bet placed")).toBeInTheDocument();
    expect(screen.getByText(/Escrowed in ledger block/)).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("relays the stake amount (not the allowance) to JEL when Place bet is pressed", async () => {
    // The accepted change adds the ICP transfer fee to the icrc2_approve
    // ALLOWANCE so the escrow can pull the stake plus the fee. The bet relayed
    // to JEL must still carry the plain stake amount (100,000,000 e8s for the
    // 1 ICP pot) — the fee is only added to the allowance, never to the bet
    // amount. This pins the relayed-amount seam that must survive the change.
    const user = userEvent.setup();
    const approveAllowance = vi.fn().mockResolvedValue({ ok: 100_100_000n });
    const relayBet = vi.fn().mockResolvedValue(undefined);
    mockUsePbppBet.mockReturnValue({
      connection: {
        status: "connected",
        account: { owner: "aaaaa-aa", subaccount: null },
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
      signerAvailable: true,
      anonymous: false,
      setAnonymous: vi.fn(),
      submitState: { status: "idle" },
      submitBet: vi.fn(),
      approveAllowance,
      checkAllowance: vi.fn().mockResolvedValue(null),
      relayState: { status: "idle" },
      relayBet,
      getRealBets: vi.fn().mockResolvedValue([]),
      getSettlements: vi.fn().mockResolvedValue([]),
    });

    renderWithProviders(<PredictionBetWindow />);

    await user.click(screen.getByRole("button", { name: "Place 1 ICP bet" }));

    await waitFor(() => {
      expect(relayBet).toHaveBeenCalledTimes(1);
    });
    // The bet relayed to JEL carries the plain stake (1 ICP = 100,000,000 e8s),
    // not the allowance (which includes the fee).
    expect(relayBet).toHaveBeenCalledWith(
      "Player",
      false,
      1n,
      100_000_000n,
      expect.anything(),
    );
  });

  it("no longer renders a manual 'Settle outcome' section", () => {
    // The accepted requirement removes the manual 'Settle outcome' section
    // (White/Black/Draw buttons) from the Prediction Bet window so players
    // have no way to report a result — the backend now reports game outcomes
    // to JEL automatically at game conclusion.
    renderWithProviders(<PredictionBetWindow />);

    // No 'Settle outcome' heading or its White/Black/Draw report buttons.
    expect(screen.queryByText("Settle outcome")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Report White" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Report Black" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Report Draw" }),
    ).not.toBeInTheDocument();
    // No settlement success surface either.
    expect(screen.queryByText("Round settled")).not.toBeInTheDocument();
  });
});

/**
 * Cover for the interactive betting-flow walkthrough added to the Prediction
 * Bet info panel.
 *
 * The request renders the betting process as an interactive step-by-step
 * walkthrough inside the info panel, highlighting each stage as the user reads
 * it with next/back navigation, responsive for both portrait and landscape
 * screens. The walkthrough is additive: the existing info-panel content (title,
 * HOW IT WORKS bullets, WORKED EXAMPLE) must continue to display alongside it.
 *
 * These tests pin the walkthrough's observable behavior:
 *   - it renders inside the info panel when the info button is toggled on;
 *   - the first stage is active by default and the stage rail lists all 8
 *     stages;
 *   - Next advances through every stage, highlighting each as active, and Back
 *     returns to the previous stage;
 *   - the e8s rule lines (100_000_000 e8s, 100_010_000 e8s) are displayed,
 *     confirming every natural number in the bet path is expressed in e8s;
 *   - the existing HOW IT WORKS and WORKED EXAMPLE content still displays
 *     alongside the walkthrough.
 */
describe("PredictionBetWindow betting-flow walkthrough", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  async function openInfo() {
    const user = userEvent.setup();
    renderWithProviders(<PredictionBetWindow />);
    await user.click(
      screen.getByRole("button", { name: "Toggle prediction bet information" }),
    );
    return user;
  }

  it("renders the walkthrough inside the info panel with all 8 stages and the first stage active", async () => {
    const { container } = renderWithProviders(<PredictionBetWindow />);
    await userEvent.setup().click(
      screen.getByRole("button", {
        name: "Toggle prediction bet information",
      }),
    );

    // The walkthrough card is present inside the info panel.
    expect(screen.getByText("How your bet is placed")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="prediction_bet.flow_walkthrough"]'),
    ).not.toBeNull();

    // The first stage is active by default and shows its detail.
    const firstStep = container.querySelector(
      '[data-ocid="prediction_bet.flow_step.1"]',
    );
    expect(firstStep).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Pick your bet")).toBeInTheDocument();
    // The e8s rule line confirms 1 ICP = 100_000_000 e8s.
    expect(screen.getByText("1 ICP = 100_000_000 e8s")).toBeInTheDocument();

    // The counter reads 1 / 8.
    expect(screen.getByText("1 / 8")).toBeInTheDocument();
  });

  it("advances through every stage with Next, highlighting each as active, and Back returns", async () => {
    const user = await openInfo();

    // The 8 stage labels are all present in the rail.
    for (const label of [
      "Select pot & outcome",
      "Connect wallet",
      "Approve JEL as spender",
      "JALCA verifies & relays",
      "JEL pulls the bet",
      "Bet recorded",
      "Settlement",
      "Auto-refund",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // The approve stage's e8s rule confirms the approval allowance is
    // bet + fee in e8s (100_000_000 + 10_000 = 100_010_000 e8s).
    const next = screen.getByRole("button", { name: "Next" });
    const back = screen.getByRole("button", { name: "Back" });
    expect(back).toBeDisabled();

    // Advance to stage 3 (approve) and assert its detail + e8s rule.
    await user.click(next);
    await user.click(next);
    expect(screen.getByText("Approve JEL for bet + fee")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Approval = bet + fee, e.g. 100_000_000 + 10_000 = 100_010_000 e8s",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("3 / 8")).toBeInTheDocument();

    // Back returns to stage 2.
    await user.click(back);
    expect(screen.getByText("Connect your ICP wallet")).toBeInTheDocument();
    expect(screen.getByText("2 / 8")).toBeInTheDocument();

    // Advance to the final stage; Next becomes disabled at the end.
    for (let i = 0; i < 6; i += 1) {
      await user.click(next);
    }
    expect(screen.getByText("2-hour auto-refund path")).toBeInTheDocument();
    expect(screen.getByText("8 / 8")).toBeInTheDocument();
    expect(next).toBeDisabled();
  });

  it("keeps the existing HOW IT WORKS and WORKED EXAMPLE content alongside the walkthrough", async () => {
    await openInfo();

    // The walkthrough title is present.
    expect(screen.getByText("How your bet is placed")).toBeInTheDocument();
    // The existing HOW IT WORKS heading and a bullet survive.
    expect(screen.getByText("How it works")).toBeInTheDocument();
    expect(
      screen.getByText(/Players bet on the result of the NEXT game/),
    ).toBeInTheDocument();
    // The existing WORKED EXAMPLE heading and a pot row survive.
    expect(screen.getByText("Worked example")).toBeInTheDocument();
    expect(screen.getByText(/1 ICP pot — 5 players/)).toBeInTheDocument();
  });

  it("no longer shows the planned-feature / not-yet-available disclaimer in the info content", async () => {
    // The accepted requirement drops the "planned feature / not yet available"
    // disclaimer from the Prediction Bet information content. The info panel
    // still renders its real-feature documentation, but no statement that
    // prediction betting is planned or unavailable may remain.
    await openInfo();

    expect(screen.queryByText(/planned feature/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not yet available/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();

    // The real-feature documentation is still present.
    expect(screen.getByText("How it works")).toBeInTheDocument();
    expect(screen.getByText("Worked example")).toBeInTheDocument();
  });
});
