import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the game-status-window change.
 *
 * The request intentionally:
 *   1. removes the Advice toggle from the Game status window's board toolbar
 *      (leaving only Coords and Flip);
 *   2. removes the advice popup, advice markers, and advice picker from the
 *      chessboard;
 *   3. adds an Info button to the Game status window header, matching the
 *      Vote on next game window's Info button;
 *   4. enlarges the turn timer and the Move_Maker username notification.
 *
 * This file deliberately does NOT assert any of those changed behaviors (it
 * does not require the Advice button, does not require the Info button, and
 * does not pin text sizes). What it protects is the adjacent behavior that
 * must survive the edit:
 *
 *   - the Game status window still renders its three rows as one merged unit
 *     in the accepted top-to-bottom order: move-maker notice, then turn timer,
 *     then the board toolbar;
 *   - the board toolbar still renders the Coords and Flip controls and still
 *     fires their handlers;
 *   - the turn timer still formats mm:ss and still switches to its urgent
 *     treatment under 30 seconds while Playing;
 *   - the move-maker notice still shows "White to move" / "Black to move" for
 *     a consistent mover, "Waiting for players..." while paused, and the
 *     move-maker's username during play;
 *   - the Vote on next game window's Info button still toggles its explanatory
 *     content — the reference behavior the new status-window Info button must
 *     match;
 *   - the status window still collapses/expands and persists its open state.
 *
 * These are component/integration contracts with no actor or network access;
 * the backend actor is mocked.
 */

// StatusWindow/VotingWindow import GamePhase/Team/SpellUse/StartingPosition as
// runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test environment
// (a pre-existing dependency issue), so mock the backend module with the enum
// values the components need.
vi.mock("@/backend", () => ({
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
  GamePhase: {
    Paused: "Paused",
    Draw: "Draw",
    Playing: "Playing",
    Celebration: "Celebration",
  },
  Team: { Black: "Black", White: "White" },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// The historical summary comes from useGameSettingsSnapshot, which polls the
// backend actor. Mock the hook so VotingWindow renders without a real actor or
// QueryClient.
vi.mock("@/hooks/use-voting", () => ({
  useVoteTally: () => ({ tally: null, isLoading: false, error: null }),
  useGameSettingsSnapshot: () => ({
    snapshot: null,
    isLoading: false,
    error: null,
  }),
}));

import {
  GamePhase,
  SpellUse,
  StartingPosition,
  Team,
  WalletSource,
} from "@/backend";
import { StatusWindow } from "@/components/StatusWindow";
import { VotingWindow } from "@/components/VotingWindow";

function renderStatusWindow(
  props: Partial<React.ComponentProps<typeof StatusWindow>> = {},
) {
  return render(
    <StatusWindow
      turn={Team.White}
      phase={GamePhase.Playing}
      moveMaker="player-1"
      players={[
        {
          principal: "player-1",
          username: "Ada",
          team: Team.White,
          walletSource: WalletSource.none,
          isMoveMaker: true,
          isFresh: false,
          isInactive: false,
          isBot: false,
        },
      ]}
      timerRemainingMs={300000n}
      showCoordinates
      onToggleCoordinates={() => {}}
      onFlipBoard={() => {}}
      {...props}
    />,
  );
}

function renderVotingWindow(
  props: Partial<React.ComponentProps<typeof VotingWindow>> = {},
) {
  return render(
    <VotingWindow
      spellUse={SpellUse.Off}
      onSpellUseChange={() => {}}
      startingPosition={StartingPosition.Standard}
      onStartingPositionChange={() => {}}
      gameNumber={7n}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("Game status window merged rows survive the toolbar change", () => {
  it("renders the move-maker notice, turn timer, and board toolbar in that order", () => {
    // Seed the window open so the merged body is mounted.
    window.localStorage.setItem("tco-status-open", "true");
    const { container } = renderStatusWindow();

    const statusPanel = container.querySelector(
      '[data-ocid="turn_status.panel"]',
    );
    expect(statusPanel).not.toBeNull();
    const status = within(statusPanel as HTMLElement);

    // Move-maker notice and turn timer readouts.
    expect(status.getByText("White to move")).toBeInTheDocument();
    expect(status.getByText("Turn timer")).toBeInTheDocument();
    expect(status.getByText("5:00")).toBeInTheDocument();

    // The three rows are distinct panels in the accepted top-to-bottom order.
    const notice = statusPanel?.querySelector(
      '[data-ocid="move_maker_indicator.panel"]',
    );
    const timer = statusPanel?.querySelector(
      '[data-ocid="turn_indicator.panel"]',
    );
    const toolbar = statusPanel?.querySelector(
      '[data-ocid="board_toolbar.panel"]',
    );
    expect(notice).not.toBeNull();
    expect(timer).not.toBeNull();
    expect(toolbar).not.toBeNull();

    const rows = Array.from(
      (statusPanel as HTMLElement).querySelectorAll(
        '[data-ocid="move_maker_indicator.panel"], [data-ocid="turn_indicator.panel"], [data-ocid="board_toolbar.panel"]',
      ),
    );
    expect(rows).toEqual([notice, timer, toolbar]);
  });

  it("keeps the Coords and Flip controls and fires their handlers", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-status-open", "true");
    const onToggleCoordinates = vi.fn();
    const onFlipBoard = vi.fn();
    renderStatusWindow({ onToggleCoordinates, onFlipBoard });

    const toolbar = document.querySelector(
      '[data-ocid="board_toolbar.panel"]',
    ) as HTMLElement;
    expect(toolbar).not.toBeNull();
    const scope = within(toolbar);

    await user.click(scope.getByRole("button", { name: "Hide coordinates" }));
    expect(onToggleCoordinates).toHaveBeenCalledTimes(1);

    await user.click(scope.getByRole("button", { name: "Flip board" }));
    expect(onFlipBoard).toHaveBeenCalledTimes(1);
  });
});

describe("Turn timer formatting and urgency survive the size change", () => {
  it("formats the remaining time as mm:ss", () => {
    window.localStorage.setItem("tco-status-open", "true");
    renderStatusWindow({ timerRemainingMs: 125000n });

    expect(screen.getByText("2:05")).toBeInTheDocument();
  });

  it("applies the urgent treatment under 30 seconds while Playing", () => {
    window.localStorage.setItem("tco-status-open", "true");
    const { container } = renderStatusWindow({ timerRemainingMs: 25000n });

    const timer = container.querySelector(
      '[data-ocid="turn_indicator.timer"]',
    ) as HTMLElement;
    expect(timer).not.toBeNull();
    expect(timer.className).toContain("text-destructive");
    expect(timer.className).toContain("animate-pulse");
  });

  it("does not apply the urgent treatment at or above 30 seconds", () => {
    window.localStorage.setItem("tco-status-open", "true");
    const { container } = renderStatusWindow({ timerRemainingMs: 30000n });

    const timer = container.querySelector(
      '[data-ocid="turn_indicator.timer"]',
    ) as HTMLElement;
    expect(timer).not.toBeNull();
    expect(timer.className).not.toContain("text-destructive");
  });
});

describe("Move-maker notice content survives the size change", () => {
  it("shows the side to move and the move-maker username during play", () => {
    window.localStorage.setItem("tco-status-open", "true");
    renderStatusWindow();

    expect(screen.getByText("White to move")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("shows 'Waiting for players...' while paused", () => {
    window.localStorage.setItem("tco-status-open", "true");
    renderStatusWindow({ phase: GamePhase.Paused });

    expect(screen.getByText("Waiting for players...")).toBeInTheDocument();
  });

  it("shows 'Black to move' for a consistent Black mover", () => {
    window.localStorage.setItem("tco-status-open", "true");
    renderStatusWindow({
      turn: Team.Black,
      moveMaker: "player-2",
      players: [
        {
          principal: "player-2",
          username: "Grace",
          team: Team.Black,
          walletSource: WalletSource.none,
          isMoveMaker: true,
          isFresh: false,
          isInactive: false,
          isBot: false,
        },
      ],
    });

    expect(screen.getByText("Black to move")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
  });
});

describe("Vote on next game Info button reference behavior", () => {
  it("toggles its explanatory content and restores the controls", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-voting-open", "true");
    renderVotingWindow();

    const infoButton = screen.getByRole("button", {
      name: "Toggle voting information",
    });
    expect(infoButton).toHaveAttribute("aria-pressed", "false");

    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("How votes are counted")).toBeInTheDocument();
    expect(screen.getByText("Ties")).toBeInTheDocument();

    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
  });
});

describe("Game status window collapse behavior survives the header change", () => {
  it("is collapsed by default and expands its body when the header is toggled", async () => {
    const user = userEvent.setup();
    const { container } = renderStatusWindow();

    const header = screen.getByRole("button", { name: /Game status/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).toBeNull();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).not.toBeNull();
  });

  it("persists the toggled state to localStorage and restores it on remount", async () => {
    const user = userEvent.setup();
    const first = renderStatusWindow();

    await user.click(screen.getByRole("button", { name: /Game status/ }));
    expect(window.localStorage.getItem("tco-status-open")).toBe("true");

    first.unmount();
    renderStatusWindow();
    expect(screen.getByRole("button", { name: /Game status/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
