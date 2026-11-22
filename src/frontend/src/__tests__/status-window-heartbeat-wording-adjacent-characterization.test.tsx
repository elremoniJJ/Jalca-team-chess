import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the "heartbeat wording" change.
 *
 * The request intentionally rewrites the Game status window's InfoContent so
 * the heartbeat is clearly framed as the heartbeat ping interval (not the move
 * timer) and explains that a player who stops pinging is removed from the team.
 * The panel's current heartbeat-adjacent wording is therefore expected to
 * change, so this file deliberately does NOT pin any exact sentence of the
 * panel.
 *
 * What it protects is the behavior ADJACENT to that rewrite that must survive
 * it:
 *
 *   - the Info toggle still swaps the merged status body for the explanatory
 *     panel and back, reflecting its state via aria-pressed;
 *   - the panel is hidden until the Info button is selected;
 *   - the panel still explains the kick-vote rule (more than 50% of the kick
 *     vote) and the per-move timer scope, which the rewrite must not drop;
 *   - the Info toggle stays independent of the collapse/expand chevron.
 *
 * These are component/integration contracts with no actor or network access;
 * the backend module and the voting snapshot hook are mocked locally.
 */

// StatusWindow imports GamePhase/Team/WalletSource as runtime values from
// @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the component needs.
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
// backend actor. Mock the hook so the component renders without a real actor
// or QueryClient.
vi.mock("@/hooks/use-voting", () => ({
  useVoteTally: () => ({ tally: null, isLoading: false, error: null }),
  useGameSettingsSnapshot: () => ({
    snapshot: null,
    isLoading: false,
    error: null,
  }),
}));

import { GamePhase, Team, WalletSource } from "@/backend";
import { StatusWindow } from "@/components/StatusWindow";

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("Game status Info panel survives the heartbeat-wording rewrite", () => {
  it("swaps the merged status body for the explanatory panel and back", async () => {
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

    // Selected: the status body is replaced by the explanatory panel.
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

  it("hides the explanatory panel until the Info button is selected", () => {
    window.localStorage.setItem("tco-status-open", "true");
    renderStatusWindow();

    // The panel's exact wording is intentionally not pinned; assert the
    // panel's stable section headings are absent while Info is deselected.
    expect(screen.queryByText("Kicking a player")).not.toBeInTheDocument();
    expect(screen.queryByText("Timer scope")).not.toBeInTheDocument();
  });

  it("still explains the kick-vote rule and the per-move timer scope", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-status-open", "true");
    renderStatusWindow();

    await user.click(
      screen.getByRole("button", { name: "Toggle game status information" }),
    );

    // Kick-vote rule: any player on a team can vote; a player is moved when
    // more than half of the team's active members have voted; idle and
    // departed members' votes do not count. No wallet requirement.
    expect(screen.getByText("Kicking a player")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Any player on a team can vote to kick a teammate\. A player is moved to the other team when more than half of the team.s active members have voted to kick them\. Votes from idle members and from players who have left do not count\./,
      ),
    ).toBeInTheDocument();

    // Timer scope: per move, not per game.
    expect(screen.getByText("Timer scope")).toBeInTheDocument();
    expect(
      screen.getByText("The timer is per move, not per game."),
    ).toBeInTheDocument();
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
});
