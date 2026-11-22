import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the removal of the previous-game-results block from the Prediction
 * Bet window's info content (PredictionBetWindow.tsx InfoContent).
 *
 * The accepted request removes the explanatory paragraph about previous game
 * results and the "Previous game — White wins" example block with its four
 * per-pot result rows, so the copy and the UI stay consistent. This file
 * asserts the removed content is ABSENT from the rendered window.
 *
 * It also protects the ADJACENT info content that must survive the removal:
 *   - the intro paragraph ("Prediction betting lets players put real ICP...");
 *   - the interactive betting-flow walkthrough (all 8 stages, first active);
 *   - the "How it works" heading and its bullets;
 *   - the "Worked example" heading and its per-pot breakdown;
 *   - the permanent live-payments footer mention.
 *
 * The backend actor and Oisy signer are mocked throughout; this is
 * component/integration coverage, not deployed browser E2E or real backend
 * behavior. The info content is static copy, so no actor call is involved.
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

// The window's BettingPanel is wired through usePbppBet. The info content
// under test is static copy, so the hook is mocked to its resting state and
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

import { PredictionBetWindow } from "@/components/PredictionBetWindow";

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
  renderWithProviders(<PredictionBetWindow />);
  await user.click(
    screen.getByRole("button", { name: "Toggle prediction bet information" }),
  );
  return user;
}

describe("PredictionBetWindow previous-game-results block (removed)", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("does not render the explanatory paragraph about previous game results", async () => {
    await openBetInfo();

    expect(
      screen.queryByText(
        /Once the game finishes, the results of the previous game are shown at the bottom of the Prediction Bet window/,
      ),
    ).not.toBeInTheDocument();
    // The paragraph's anonymous-bettor sentence is gone too.
    expect(
      screen.queryByText(
        /Bettors who chose to stay anonymous are listed as a count rather than by name/,
      ),
    ).not.toBeInTheDocument();
  });

  it("does not render the 'Previous game — White wins' example block or its per-pot rows", async () => {
    await openBetInfo();

    expect(
      screen.queryByText("Previous game — White wins"),
    ).not.toBeInTheDocument();

    // None of the four per-pot result rows survive.
    expect(
      screen.queryByText("1 ICP pot: Alice, Bob, Eve + 2 anonymous bettors"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("10 ICP pot: no winners — everyone refunded"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "100 ICP pot: Jack, Kim, Mia, Olivia + 1 anonymous bettor",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("1000 ICP pot: Peter + 1 anonymous bettor"),
    ).not.toBeInTheDocument();
  });

  it("renders no previous-game-results UI anywhere in the window", async () => {
    const { container } = renderWithProviders(<PredictionBetWindow />);

    // The window is expanded by default and shows the betting panel; the
    // previous-results UI must be absent in both the betting and info views.
    const body = container.textContent ?? "";
    expect(body).not.toMatch(/Previous game/i);
    expect(body).not.toMatch(/anonymous bettor/i);
    expect(body).not.toMatch(/results of the previous game/i);

    // Toggling the info content on does not reveal it either.
    await userEvent.setup().click(
      screen.getByRole("button", {
        name: "Toggle prediction bet information",
      }),
    );
    const infoBody = container.textContent ?? "";
    expect(infoBody).not.toMatch(/Previous game/i);
    expect(infoBody).not.toMatch(/anonymous bettor/i);
    expect(infoBody).not.toMatch(/results of the previous game/i);
  });
});

describe("PredictionBetWindow info content adjacent to the previous-results block", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("keeps the intro paragraph and the interactive walkthrough with all 8 stages", async () => {
    await openBetInfo();

    // The intro paragraph survives.
    expect(
      screen.getByText(
        /Prediction betting lets players put real ICP on the line/,
      ),
    ).toBeInTheDocument();

    // The walkthrough card and its first active stage survive.
    expect(screen.getByText("How your bet is placed")).toBeInTheDocument();
    expect(screen.getByText("Pick your bet")).toBeInTheDocument();
    expect(screen.getByText("1 / 8")).toBeInTheDocument();

    // All 8 stage labels are present in the rail.
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
  });

  it("keeps the 'How it works' heading and its bullets", async () => {
    await openBetInfo();

    expect(screen.getByText("How it works")).toBeInTheDocument();
    expect(
      screen.getByText(/Players bet on the result of the NEXT game/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/A 1\.5% platform fee is taken from each pot/),
    ).toBeInTheDocument();
  });

  it("keeps the 'Worked example' heading and its per-pot breakdown", async () => {
    await openBetInfo();

    expect(screen.getByText("Worked example")).toBeInTheDocument();
    expect(
      screen.getByText("Simple example — a 10 ICP pot"),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 ICP pot — 5 players/)).toBeInTheDocument();
    expect(screen.getByText(/1000 ICP pot — 2 players/)).toBeInTheDocument();
  });

  it("keeps the permanent live-payments footer mention outside the info content", async () => {
    const { container } = renderWithProviders(<PredictionBetWindow />);

    // The footer mention is present whether or not the info content is shown.
    const mention = container.querySelector(
      '[data-ocid="prediction_bet.live_payments_mention"]',
    );
    expect(mention).not.toBeNull();
    expect(mention?.textContent).toContain("to see live payments.");

    // It is not part of the info content: toggling info on leaves it mounted.
    await userEvent.setup().click(
      screen.getByRole("button", {
        name: "Toggle prediction bet information",
      }),
    );
    expect(
      container.querySelector(
        '[data-ocid="prediction_bet.live_payments_mention"]',
      ),
    ).not.toBeNull();
    // The info content is now shown alongside it.
    expect(screen.getByText("How it works")).toBeInTheDocument();
  });
});
