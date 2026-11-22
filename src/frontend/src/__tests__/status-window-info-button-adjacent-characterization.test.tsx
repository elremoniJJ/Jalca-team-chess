import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the game-status-window change.
 *
 * The request intentionally:
 *   1. removes the Advice button/control/popup/markers from the Game status
 *      window and its board toolbar;
 *   2. keeps the Info button in the Game status window header, with placement
 *      and behavior identical to the Info button in the Vote on next game
 *      window;
 *   3. enlarges the turn timer and the Move_Maker username notification.
 *
 * This file deliberately does NOT assert the removed Advice control, and does
 * NOT pin the current text sizes of the timer or the username (those are the
 * intentional changes). What it protects is the behavior ADJACENT to the
 * change that must survive it:
 *
 *   - the Game status window header Info button toggles between the merged
 *     status body and the explanatory Info content, and toggles back — the
 *     exact behavior the Vote on next game window's Info button already has;
 *   - the Info button sits in the header row on the right, after the theme
 *     dots, mirroring the Vote on next game window's header order;
 *   - the Info button is a real toggle (aria-pressed) and does not disturb the
 *     collapse/expand chevron;
 *   - the turn timer still formats mm:ss and the Move_Maker username still
 *     renders during play (content, not size).
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

describe("Game status window Info button behavior", () => {
  it("toggles between the merged status body and the Info content, and back", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-status-open", "true");
    const { container } = renderStatusWindow();

    const infoButton = screen.getByRole("button", {
      name: "Toggle game status information",
    });
    expect(infoButton).toHaveAttribute("aria-pressed", "false");

    // Default: the merged status body is mounted, the Info content is not.
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).not.toBeNull();
    expect(screen.queryByText("Kicking a player")).not.toBeInTheDocument();

    // Selected: the Info content replaces the status body.
    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Kicking a player")).toBeInTheDocument();
    expect(screen.getByText("Timer scope")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).toBeNull();

    // Deselected: the status body is restored.
    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Kicking a player")).not.toBeInTheDocument();
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

    // Toggling Info does not change the window's expanded state.
    await user.click(infoButton);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(infoButton).toHaveAttribute("aria-pressed", "true");

    // Collapsing the window still works while Info is selected.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Game status window header placement matches the Vote on next game window", () => {
  it("places the Info button after the theme dots in the header row", () => {
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

    // The Info button follows the theme dots in DOM order, exactly as the
    // Vote on next game window's header does.
    const ordered = Array.from(
      header.querySelectorAll(
        '[data-ocid="status_window.theme_dots"], [data-ocid="status_window.info_button"]',
      ),
    );
    expect(ordered).toEqual([dots, info]);
  });

  it("mirrors the Vote on next game window's header order (dots then Info)", () => {
    window.localStorage.setItem("tco-voting-open", "true");
    const { container } = renderVotingWindow();

    const header = container.querySelector(
      '[data-ocid="voting_window.panel"] > div',
    ) as HTMLElement;
    expect(header).not.toBeNull();

    const dots = header.querySelector('[data-ocid="voting_window.theme_dots"]');
    const info = header.querySelector(
      '[data-ocid="voting_window.info_button"]',
    );
    expect(dots).not.toBeNull();
    expect(info).not.toBeNull();

    const ordered = Array.from(
      header.querySelectorAll(
        '[data-ocid="voting_window.theme_dots"], [data-ocid="voting_window.info_button"]',
      ),
    );
    expect(ordered).toEqual([dots, info]);
  });
});

describe("Turn timer and Move_Maker username content survive the size change", () => {
  it("still formats the remaining time as mm:ss", () => {
    window.localStorage.setItem("tco-status-open", "true");
    renderStatusWindow({ timerRemainingMs: 125000n });

    expect(screen.getByText("Turn timer")).toBeInTheDocument();
    expect(screen.getByText("2:05")).toBeInTheDocument();
  });

  it("still renders the Move_Maker username notification during play", () => {
    window.localStorage.setItem("tco-status-open", "true");
    renderStatusWindow();

    expect(screen.getByText("White to move")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });
});
