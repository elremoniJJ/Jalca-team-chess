import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// StatusWindow / BoardToolbar / TurnIndicator / MoveMakerIndicator import
// GamePhase/Team as runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test environment
// (a pre-existing dependency issue), so mock the backend module with the enum
// values the components need. The behavior under test is pure frontend
// rendering and never touches the actor.
vi.mock("@/backend", () => ({
  GamePhase: {
    Paused: "Paused",
    Draw: "Draw",
    Playing: "Playing",
    Celebration: "Celebration",
  },
  Team: { Black: "Black", White: "White" },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

import { GamePhase, Team, WalletSource } from "@/backend";
import { BoardToolbar } from "@/components/BoardToolbar";
import { MoveMakerIndicator } from "@/components/MoveMakerIndicator";
import { StatusWindow } from "@/components/StatusWindow";
import { TurnIndicator } from "@/components/TurnIndicator";

/**
 * Characterization taken BEFORE the advice-removal / status-header change.
 *
 * The request intentionally:
 *   1. removes the Advice toggle from the Game status window's board toolbar
 *      (leaving only Coords and Flip);
 *   2. removes the advice popup, board markers, and picker from the board;
 *   3. adds an Info button to the Game status window header, matching the
 *      Vote on next game window's Info button;
 *   4. enlarges the turn timer and the Move_Maker username notification.
 *
 * Those four things are intentional, so this file deliberately does NOT freeze
 * the Advice control, the advice markers, the current header layout, or the
 * current text sizes. What it protects is the behavior ADJACENT to the change
 * that must survive it:
 *
 *   - the board toolbar still renders its Coords and Flip controls and still
 *     fires their handlers;
 *   - the Game status window still collapses/expands via its header chevron,
 *     persists that state, and keeps its three merged rows (move-maker notice,
 *     turn timer, board toolbar) as one unit;
 *   - the turn timer still formats mm:ss and still flags the urgent state;
 *   - the move-maker indicator still announces the side to move, the waiting
 *     state, and the Move_Maker username notification.
 *
 * These are component/integration contracts with no actor or network access.
 */

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

describe("BoardToolbar adjacent behavior", () => {
  it("still renders the Coords and Flip controls and fires their handlers", async () => {
    const user = userEvent.setup();
    const onToggleCoordinates = vi.fn();
    const onFlipBoard = vi.fn();
    render(
      <BoardToolbar
        showCoordinates
        onToggleCoordinates={onToggleCoordinates}
        onFlipBoard={onFlipBoard}
      />,
    );

    const coords = screen.getByRole("button", { name: "Hide coordinates" });
    const flip = screen.getByRole("button", { name: "Flip board" });
    expect(coords).toBeInTheDocument();
    expect(flip).toBeInTheDocument();

    await user.click(coords);
    expect(onToggleCoordinates).toHaveBeenCalledTimes(1);

    await user.click(flip);
    expect(onFlipBoard).toHaveBeenCalledTimes(1);
  });

  it("reflects the coordinates-off state in the Coords control label", () => {
    render(
      <BoardToolbar
        showCoordinates={false}
        onToggleCoordinates={vi.fn()}
        onFlipBoard={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Show coordinates" }),
    ).toBeInTheDocument();
  });
});

describe("StatusWindow adjacent behavior", () => {
  it("is collapsed by default and expands its merged body via the header chevron", async () => {
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

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).toBeNull();
  });

  it("persists the toggled open state to localStorage and restores it on remount", async () => {
    const user = userEvent.setup();
    const first = renderStatusWindow();

    await user.click(screen.getByRole("button", { name: /Game status/ }));
    expect(window.localStorage.getItem("tco-status-open")).toBe("true");

    first.unmount();
    const second = renderStatusWindow();
    expect(screen.getByRole("button", { name: /Game status/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      second.container.querySelector('[data-ocid="turn_status.panel"]'),
    ).not.toBeNull();
  });

  it("keeps the move-maker notice, turn timer, and board controls merged as one unit", () => {
    window.localStorage.setItem("tco-status-open", "true");
    const { container } = renderStatusWindow();

    const statusPanel = container.querySelector(
      '[data-ocid="turn_status.panel"]',
    );
    expect(statusPanel).not.toBeNull();
    const status = within(statusPanel as HTMLElement);

    // Move-maker notice.
    expect(status.getByText("White to move")).toBeInTheDocument();
    // Turn timer label + mm:ss countdown (300000ms -> 5:00).
    expect(status.getByText("Turn timer")).toBeInTheDocument();
    expect(status.getByText("5:00")).toBeInTheDocument();
    // The board controls that stay with the board.
    expect(
      status.getByRole("button", { name: "Hide coordinates" }),
    ).toBeInTheDocument();
    expect(
      status.getByRole("button", { name: "Flip board" }),
    ).toBeInTheDocument();

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
});

describe("TurnIndicator adjacent behavior", () => {
  it("formats the remaining time as mm:ss", () => {
    render(
      <TurnIndicator timerRemainingMs={300000n} phase={GamePhase.Playing} />,
    );

    expect(screen.getByText("Turn timer")).toBeInTheDocument();
    expect(screen.getByText("5:00")).toBeInTheDocument();
  });

  it("clamps a negative remaining time to 0:00", () => {
    render(
      <TurnIndicator timerRemainingMs={-5000n} phase={GamePhase.Playing} />,
    );

    expect(screen.getByText("0:00")).toBeInTheDocument();
  });

  it("flags the urgent state only while playing under 30 seconds", () => {
    const { container, unmount } = render(
      <TurnIndicator timerRemainingMs={29000n} phase={GamePhase.Playing} />,
    );
    const urgentTimer = container.querySelector(
      '[data-ocid="turn_indicator.timer"]',
    );
    expect(urgentTimer?.className).toContain("animate-pulse");
    unmount();

    // The same remaining time while paused is not urgent.
    const paused = render(
      <TurnIndicator timerRemainingMs={29000n} phase={GamePhase.Paused} />,
    );
    const pausedTimer = paused.container.querySelector(
      '[data-ocid="turn_indicator.timer"]',
    );
    expect(pausedTimer?.className).not.toContain("animate-pulse");
  });
});

describe("MoveMakerIndicator adjacent behavior", () => {
  const players = [
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
  ];

  it("announces the side to move and the Move_Maker username while playing", () => {
    render(
      <MoveMakerIndicator
        turn={Team.White}
        phase={GamePhase.Playing}
        moveMaker="player-1"
        players={players}
      />,
    );

    expect(screen.getByText("White to move")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("shows the waiting message while paused", () => {
    render(
      <MoveMakerIndicator
        turn={Team.White}
        phase={GamePhase.Paused}
        moveMaker={undefined}
        players={players}
      />,
    );

    expect(screen.getByText("Waiting for players...")).toBeInTheDocument();
  });

  it("renders no mover announcement when the move maker is inconsistent with the turn", () => {
    render(
      <MoveMakerIndicator
        turn={Team.Black}
        phase={GamePhase.Playing}
        moveMaker="player-1"
        players={players}
      />,
    );

    // player-1 is White but it is Black's turn, so the consistency guard
    // suppresses the announcement and the username notification.
    expect(screen.queryByText("White to move")).not.toBeInTheDocument();
    expect(screen.queryByText("Black to move")).not.toBeInTheDocument();
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
  });

  // The accepted presence change excludes an inactive player from Move_Maker
  // selection, so a stale inactive mover must not be announced as "to move"
  // here either. The consistency guard now also requires the mover to be
  // active; an inactive mover on the correct team is suppressed.
  it("renders no mover announcement when the move maker is inactive", () => {
    render(
      <MoveMakerIndicator
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
            isFresh: true,
            isInactive: true,
            isBot: false,
          },
        ]}
      />,
    );

    // The mover is on the correct team but is inactive, so the announcement
    // and the username notification are both suppressed.
    expect(screen.queryByText("White to move")).not.toBeInTheDocument();
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
  });
});
