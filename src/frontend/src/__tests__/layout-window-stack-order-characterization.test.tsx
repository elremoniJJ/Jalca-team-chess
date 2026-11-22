import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real Layout imports InformationModal, which transitively pulls in
// @caffeineai/core-infrastructure via CanisterCyclesGauge. That package fails
// to resolve its own submodules in the jsdom test environment (a pre-existing
// dependency issue), so mock the modal to a marker. This test never opens the
// modal, so only the import needs to resolve.
vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));

import { Layout } from "@/components/Layout";

/**
 * Characterization of the Layout window stack ORDER.
 *
 * The request intentionally REMOVES the status, players, captured and moves
 * windows from the Layout stack and moves their content into the board slot
 * (a non-collapsible status header above the board and a Moves / Captured /
 * Players tab panel under it). A later accepted change also removes the Also
 * on the IC, Vote on next game and Story windows from the stack — the game
 * route renders them inside the board view overlay instead. A further accepted
 * change removes the Prediction Bet and Leaderboard slots too, so only the
 * Wallet/Spells window remains collapsible. Those removals are the intentional
 * change, so this file deliberately does NOT assert the presence or absence of
 * the removed windows. What it protects is the adjacent, working structure the
 * change must not disturb:
 *
 *   - every surviving window slot still renders when provided;
 *   - the surviving windows keep their fixed relative order (board → wallet);
 *   - a slot that is not provided still renders nothing (no empty card).
 *
 * The Layout is rendered directly with marker content in each slot; the real
 * window components are covered by their own focused test files.
 */

function renderLayout(
  windows: Partial<React.ComponentProps<typeof Layout>["windows"]>,
) {
  return render(
    <Layout
      onLogout={() => {}}
      windows={{
        board: <div data-testid="board-content" />,
        ...windows,
      }}
    />,
  );
}

/** The data-ocid markers of the window cards, in DOM order. */
function windowOrder(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(
      '[data-ocid="window.board"], [data-ocid="window.wallet"]',
    ),
  ).map((el) => el.getAttribute("data-ocid") ?? "");
}

describe("Layout window stack order", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders every provided window slot", () => {
    const { container } = renderLayout({
      wallet: <div data-testid="wallet-content" />,
    });

    for (const ocid of ["window.board", "window.wallet"]) {
      expect(container.querySelector(`[data-ocid="${ocid}"]`)).not.toBeNull();
    }
  });

  it("keeps the windows in their fixed top-to-bottom order", () => {
    const { container } = renderLayout({
      wallet: <div data-testid="wallet-content" />,
    });

    expect(windowOrder(container)).toEqual(["window.board", "window.wallet"]);
  });

  it("renders the Wallet window after the board window", () => {
    const { container } = renderLayout({
      wallet: <div data-testid="wallet-content" />,
    });

    const board = container.querySelector('[data-ocid="window.board"]');
    const wallet = container.querySelector('[data-ocid="window.wallet"]');
    expect(board).not.toBeNull();
    expect(wallet).not.toBeNull();

    // DOM order encodes the vertical stack: board precedes Wallet.
    const ordered = Array.from(
      container.querySelectorAll(
        '[data-ocid="window.board"], [data-ocid="window.wallet"]',
      ),
    );
    expect(ordered).toEqual([board, wallet]);
  });

  it("no longer renders the Prediction Bet and Leaderboard slots", () => {
    const { container } = renderLayout({
      wallet: <div data-testid="wallet-content" />,
    });

    expect(
      container.querySelector('[data-ocid="window.prediction_bet"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-ocid="window.leaderboard"]'),
    ).toBeNull();
  });

  it("renders the Wallet window content inside its own card", () => {
    renderLayout({
      wallet: <div data-testid="wallet-content" />,
    });

    const card = screen
      .getByTestId("wallet-content")
      .closest('[data-ocid="window.wallet"]');
    expect(card).not.toBeNull();
    expect(
      within(card as HTMLElement).getByTestId("wallet-content"),
    ).toBeInTheDocument();
  });

  it("omits optional windows that the route does not provide", () => {
    const { container } = renderLayout({});

    // Only the required board window renders.
    expect(
      container.querySelector('[data-ocid="window.board"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-ocid="window.wallet"]')).toBeNull();
  });
});
