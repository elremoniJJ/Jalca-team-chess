import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted "Heartbeat info + larger timer/username" change.
 *
 * The request intentionally:
 *   1. adds an Info button to the Game status window header whose placement and
 *      behavior match the Vote on next game window's Info button, toggling
 *      between an explanatory panel and the normal status content;
 *   2. makes that panel explain the Heartbeat situation — the Move_Maker has 15
 *      seconds per move while every other player has 120 seconds, players can
 *      kick one another off the team when the kicked player receives more than
 *      50% of the kick vote, and the timer is per move, not per game;
 *   3. enlarges the turn timer;
 *   4. enlarges the Move_Maker username notification.
 *
 * This file asserts the accepted observable behavior. The adjacent behavior
 * that must survive the change (toggle independence, header order, mm:ss
 * formatting, urgency, waiting message) is protected by the sibling
 * characterization files.
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

describe("Game status Info panel explains the Heartbeat situation", () => {
  it("reveals the per-move timer budgets, the kick-vote rule, and the timer scope", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-status-open", "true");
    renderStatusWindow();

    const infoButton = screen.getByRole("button", {
      name: "Toggle game status information",
    });
    await user.click(infoButton);

    // Heartbeat framing: the periodic "I'm still here" ping every player
    // sends, with the Move_Maker pinging every 15s and everyone else every
    // 120s, and a stale (non-pinging) player removed from the team.
    expect(screen.getByText("Heartbeat")).toBeInTheDocument();
    expect(
      screen.getByText(
        /The heartbeat is the periodic .*I.*m still here.* ping every player sends to stay on the team\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /The Move_Maker pings every 15 seconds, while every other player pings every 120 seconds\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /A player who stops pinging goes stale and is removed from the team\./,
      ),
    ).toBeInTheDocument();

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

  it("hides the Heartbeat panel until the Info button is selected", () => {
    window.localStorage.setItem("tco-status-open", "true");
    renderStatusWindow();

    expect(screen.queryByText("Heartbeat")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/The Move_Maker pings every 15 seconds/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Kicking a player")).not.toBeInTheDocument();
    expect(screen.queryByText("Timer scope")).not.toBeInTheDocument();
  });
});

describe("Turn timer is larger and more prominent", () => {
  it("renders the timer readout with a large, bold font", () => {
    window.localStorage.setItem("tco-status-open", "true");
    const { container } = renderStatusWindow({ timerRemainingMs: 125000n });

    const timer = container.querySelector(
      '[data-ocid="turn_indicator.timer"]',
    ) as HTMLElement;
    expect(timer).not.toBeNull();
    expect(timer).toHaveTextContent("2:05");

    // Enlarged from the previous text-sm: a large display size and bold weight.
    expect(timer.className).toContain("text-4xl");
    expect(timer.className).toContain("font-bold");
  });
});

describe("Move_Maker username notification is larger and more prominent", () => {
  it("renders the username with a larger, bold, foreground treatment", () => {
    window.localStorage.setItem("tco-status-open", "true");
    renderStatusWindow();

    const username = screen.getByText("Ada");
    const notification = username.parentElement as HTMLElement;
    expect(notification).not.toBeNull();

    // Enlarged from the previous text-xs text-muted-foreground: a larger,
    // bold, foreground-colored notification.
    expect(notification.className).toContain("text-base");
    expect(notification.className).toContain("font-bold");
    expect(notification.className).toContain("text-foreground");
  });
});
