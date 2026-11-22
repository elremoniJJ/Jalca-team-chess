import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// usePbppBet imports Pot/GameOutcome as runtime enums from @/backend, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the hook needs.
vi.mock("@/backend", () => ({
  Pot: { One: "One", Ten: "Ten", Hundred: "Hundred", Thousand: "Thousand" },
  GameOutcome: { draw: "draw", black: "black", white: "white" },
}));

// The hook reuses useOisyBurn for the wallet connection. Mock it so the test
// controls the connection state deterministically without opening a real
// signer popup.
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

// The hook reaches the backend through getActor(). Mock it with a typed local
// actor whose submitBet is a vi.fn() so the test captures the exact call and
// controls the response. The other actor methods the hook touches are stubbed
// so the module resolves.
const { submitBet } = vi.hoisted(() => ({ submitBet: vi.fn() }));
vi.mock("@/lib/backend-actor", () => ({
  getActor: vi.fn().mockResolvedValue({
    submitBet,
    placeBet: vi.fn(),
    checkAllowance: vi.fn(),
    getRealBets: vi.fn(),
    getSettlements: vi.fn(),
  }),
}));

// The hook imports the approval seam from lib/pbpp; stub it so the module
// resolves without a real signer.
vi.mock("@/lib/pbpp", () => ({
  approvePbppAllowance: vi.fn(),
  openApproveSignerSync: vi.fn(),
  preloadSigner: vi.fn(),
}));

import { GameOutcome, Pot } from "@/backend";
import { usePbppBet } from "@/lib/use-pbpp-bet";

/**
 * Characterization of the Prediction Bet SUBMISSION consumer contract, taken
 * BEFORE the backend gains the Internet Identity sign-in method family and the
 * Story-authoring surface.
 *
 * The request adds new backend methods and a new allowlist-gated write family
 * (Story writes gated to the signed-in Internet Identity principal). It must
 * NOT disturb the existing Prediction Bet submission path, which the
 * acceptance criteria name ("prediction bet ... features continue to work").
 *
 * The frontend consumes that path through `usePbppBet.submitBet`, which calls
 * the generated actor's `submitBet(pot, prediction, playerPrincipal,
 * displayUsername, anonymous)` and tracks an idle/submitting/success/error
 * lifecycle. This file pins that seam:
 *
 *   - the exact five positional arguments are forwarded, in order, with the
 *     caller's pseudo-principal and display username;
 *   - a resolved BetRecord moves the lifecycle to `success` and carries the
 *     persisted record;
 *   - a rejected call moves the lifecycle to `error` with the thrown message.
 *
 * The actor is a typed local mock (no real canister, no network). The real
 * backend's allowlist enforcement and persistence are the PocketIC lane's job
 * (prediction-bet-allowlist-characterization.test.ts).
 */

/** A minimal BetRecord fixture matching the generated declarations' shape. */
const betRecordFixture = {
  id: 7n,
  bet: {
    pot: { One: null },
    displayUsername: "Ada",
    prediction: { White: null },
    anonymous: false,
    playerPrincipal: "player-1",
  },
  timestamp: 1_700_000_000_000_000_000n,
};

describe("usePbppBet.submitBet consumer contract", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockConnection.value = { status: "disconnected" };
  });

  it("forwards the exact five positional arguments to actor.submitBet", async () => {
    const user = userEvent.setup();
    submitBet.mockResolvedValue(betRecordFixture);

    function SubmitHarness() {
      const pbpp = usePbppBet("player-1");
      return (
        <div>
          <button
            type="button"
            onClick={() =>
              void pbpp.submitBet(
                Pot.One,
                { White: null } as never,
                "player-1",
                "Ada",
                false,
              )
            }
          >
            submit
          </button>
          <span data-testid="submit-state">{pbpp.submitState.status}</span>
        </div>
      );
    }
    render(<SubmitHarness />);

    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(submitBet).toHaveBeenCalledTimes(1);
    });
    // The five positional arguments are forwarded in order: pot, prediction,
    // player pseudo-principal, display username, anonymity flag.
    expect(submitBet).toHaveBeenCalledWith(
      Pot.One,
      { White: null },
      "player-1",
      "Ada",
      false,
    );
  });

  it("moves to success and carries the persisted BetRecord on resolve", async () => {
    const user = userEvent.setup();
    submitBet.mockResolvedValue(betRecordFixture);

    function SubmitHarness() {
      const pbpp = usePbppBet("player-1");
      return (
        <div>
          <button
            type="button"
            onClick={() =>
              void pbpp.submitBet(
                Pot.One,
                { White: null } as never,
                "player-1",
                "Ada",
                false,
              )
            }
          >
            submit
          </button>
          <span data-testid="submit-state">{pbpp.submitState.status}</span>
          <span data-testid="submit-id">
            {pbpp.submitState.status === "success"
              ? pbpp.submitState.bet.id.toString()
              : ""}
          </span>
        </div>
      );
    }
    render(<SubmitHarness />);

    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(screen.getByTestId("submit-state")).toHaveTextContent("success");
    });
    // The persisted record is surfaced so the UI can confirm the bet.
    expect(screen.getByTestId("submit-id")).toHaveTextContent("7");
  });

  it("moves to error with the thrown message when the actor rejects", async () => {
    const user = userEvent.setup();
    submitBet.mockRejectedValue(
      new Error("Only the configured JALCA canister principal may submit bets"),
    );

    function SubmitHarness() {
      const pbpp = usePbppBet("player-1");
      return (
        <div>
          <button
            type="button"
            onClick={() =>
              void pbpp.submitBet(
                Pot.One,
                { White: null } as never,
                "player-1",
                "Ada",
                false,
              )
            }
          >
            submit
          </button>
          <span data-testid="submit-state">{pbpp.submitState.status}</span>
          <span data-testid="submit-message">
            {pbpp.submitState.status === "error"
              ? pbpp.submitState.message
              : ""}
          </span>
        </div>
      );
    }
    render(<SubmitHarness />);

    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(screen.getByTestId("submit-state")).toHaveTextContent("error");
    });
    // The rejection reason is surfaced verbatim rather than swallowed.
    expect(screen.getByTestId("submit-message")).toHaveTextContent(
      "Only the configured JALCA canister principal may submit bets",
    );
  });
});
