import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the "Heartbeat info + larger timer/username"
 * change.
 *
 * The request intentionally:
 *   1. adds/adjusts the Game status window's Info button and its explanatory
 *      panel so it explains the Heartbeat situation (the panel's current
 *      wording is therefore expected to change);
 *   2. enlarges the turn timer;
 *   3. enlarges the Move_Maker username notification.
 *
 * This file deliberately does NOT pin the Info panel's current wording, nor
 * the current font-size classes of the timer or the username — those are the
 * intentional changes. What it protects is the behavior ADJACENT to the change
 * that must survive it:
 *
 *   - the Game status window header still exposes an Info toggle that swaps
 *     the merged status body for an explanatory panel and back, reflecting its
 *     state via aria-pressed;
 *   - the Info toggle is independent of the collapse/expand chevron;
 *   - the Info button still sits in the header row after the theme dots,
 *     mirroring the Vote on next game window's header order;
 *   - the turn timer still formats mm:ss and still flags the urgent state;
 *   - the Move_Maker username notification still renders during play.
 *
 * These are component/integration contracts with no actor or network access;
 * the backend module and the voting snapshot hook are mocked locally.
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

describe("Game status Info toggle survives the Heartbeat panel change", () => {
  it("swaps the merged status body for an explanatory panel and back", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-status-open", "true");
    const { container } = renderStatusWindow();

    const infoButton = screen.getByRole("button", {
      name: "Toggle game status information",
    });
    expect(infoButton).toHaveAttribute("aria-pressed", "false");

    // Default: the merged status body is mounted.
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).not.toBeNull();

    // Selected: the status body is replaced by an explanatory panel. The
    // panel's exact wording is intentionally not pinned here.
    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "true");
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).toBeNull();

    // Deselected: the status body is restored.
    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).not.toBeNull();
  });

  it("keeps the Info toggle independent of the collapse/expand chevron", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-status-open", "true");
    renderStatusWindow();

    const header = screen.getByRole("button", { name: /Game status/ });
    const infoButton = screen.getByRole("button", {
      name: "Toggle game status information",
    });

    await user.click(infoButton);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(infoButton).toHaveAttribute("aria-pressed", "true");

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("places the Info button after the theme dots, matching the Vote window", () => {
    window.localStorage.setItem("tco-status-open", "true");
    const { container } = renderStatusWindow();

    const header = container.querySelector(
      '[data-ocid="status_window"] > div',
    ) as HTMLElement;
    expect(header).not.toBeNull();

    const dots = header.querySelector('[data-ocid="status_window.theme_dots"]');
    const info = header.querySelector(
      '[data-ocid="status_window.info_button"]',
    );
    expect(dots).not.toBeNull();
    expect(info).not.toBeNull();

    const ordered = Array.from(
      header.querySelectorAll(
        '[data-ocid="status_window.theme_dots"], [data-ocid="status_window.info_button"]',
      ),
    );
    expect(ordered).toEqual([dots, info]);
  });
});

describe("Vote on next game Info toggle reference behavior", () => {
  it("still toggles its explanatory content and restores the controls", async () => {
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

    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
  });
});

describe("Turn timer and Move_Maker username content survive the size change", () => {
  it("still formats the remaining time as mm:ss", () => {
    window.localStorage.setItem("tco-status-open", "true");
    renderStatusWindow({ timerRemainingMs: 125000n });

    expect(screen.getByText("Turn timer")).toBeInTheDocument();
    expect(screen.getByText("2:05")).toBeInTheDocument();
  });

  it("still flags the urgent state under 30 seconds while Playing", () => {
    window.localStorage.setItem("tco-status-open", "true");
    const { container } = renderStatusWindow({ timerRemainingMs: 25000n });

    const timer = container.querySelector(
      '[data-ocid="turn_indicator.timer"]',
    ) as HTMLElement;
    expect(timer).not.toBeNull();
    expect(timer.className).toContain("text-destructive");
    expect(timer.className).toContain("animate-pulse");
  });

  it("still renders the Move_Maker username notification during play", () => {
    window.localStorage.setItem("tco-status-open", "true");
    renderStatusWindow();

    expect(screen.getByText("White to move")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("still shows the waiting message while paused", () => {
    window.localStorage.setItem("tco-status-open", "true");
    renderStatusWindow({ phase: GamePhase.Paused });

    expect(screen.getByText("Waiting for players...")).toBeInTheDocument();
  });
});
