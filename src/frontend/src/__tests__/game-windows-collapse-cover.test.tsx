import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// VotingWindow imports SpellUse/StartingPosition as runtime values from
// @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the components need.
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
  useVoteTally: () => ({
    tally: null,
    isLoading: false,
    error: null,
  }),
  useGameSettingsSnapshot: () => ({
    snapshot: null,
    isLoading: false,
    error: null,
  }),
}));

// The real Layout imports InformationModal, which transitively pulls in
// @caffeineai/core-infrastructure via CanisterCyclesGauge. That package fails
// to resolve its own submodules in the jsdom test environment (a pre-existing
// dependency issue), so mock the modal to a marker. The test never opens it.
vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));

import {
  GamePhase,
  SpellUse,
  StartingPosition,
  Team,
  WalletSource,
} from "@/backend";
import { Layout } from "@/components/Layout";
import { StatusWindow } from "@/components/StatusWindow";
import { VotingWindow } from "@/components/VotingWindow";

/**
 * Cover for the two new standalone collapsible Layout-level windows added by
 * this request:
 *
 *   1. "Vote on next game" — promoted out of the chessboard panel into its own
 *      collapsible window above the board, with its voting toggles, Info
 *      content, and three-row summary unchanged.
 *   2. The merged game-status panel (move-maker indicator + turn timer +
 *      Coords/Flip/Advice toolbar) — promoted out of the chessboard panel into
 *      its own collapsible window above the board, kept as ONE unit.
 *
 * Both windows follow the NFT Spell burning window pattern: a full-width
 * chevron header toggle, open state persisted to localStorage as a JSON
 * boolean, and the body UNMOUNTED when collapsed.
 *
 * These are component/integration contracts with no actor or network access;
 * the backend actor is mocked.
 */

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

describe("VotingWindow collapsible behavior", () => {
  it("is collapsed by default and expands its body when the header is toggled", async () => {
    const user = userEvent.setup();
    renderVotingWindow();

    const header = screen.getByRole("button", { name: /Vote on next game/ });
    // Collapsed by default: aria-expanded false and the voting controls absent.
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "OFF" }),
    ).not.toBeInTheDocument();

    // Expanding mounts the body (the toggles and summary appear).
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
    expect(screen.getByText("NFT spells: OFF with 0")).toBeInTheDocument();

    // Collapsing unmounts the body again.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "OFF" }),
    ).not.toBeInTheDocument();
  });

  it("persists the toggled state to localStorage and restores it on remount", async () => {
    const user = userEvent.setup();
    const first = renderVotingWindow();

    // Starts collapsed; opening writes true.
    await user.click(screen.getByRole("button", { name: /Vote on next game/ }));
    expect(window.localStorage.getItem("tco-voting-open")).toBe("true");

    // Remount: the expanded state is restored from localStorage.
    first.unmount();
    renderVotingWindow();
    expect(
      screen.getByRole("button", { name: /Vote on next game/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
  });

  it("restores a collapsed state written by a previous session", () => {
    window.localStorage.setItem("tco-voting-open", "false");
    renderVotingWindow();

    expect(
      screen.getByRole("button", { name: /Vote on next game/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "OFF" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the voting toggles, Info content, and three-row summary unchanged", async () => {
    const user = userEvent.setup();
    // Seed the window open so the body is mounted regardless of the default.
    window.localStorage.setItem("tco-voting-open", "true");
    const { container } = renderVotingWindow();

    // The two controlled toggle groups.
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ON" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Standard" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Random" })).toBeInTheDocument();

    // The fixed three-row summary.
    const summary = container.querySelector(
      '[data-ocid="voting_window.summary"]',
    );
    expect(summary).not.toBeNull();
    expect(
      summary?.querySelectorAll(".voting-window-summary-row"),
    ).toHaveLength(3);

    // The Info toggle swaps the controls for the explanatory content.
    await user.click(
      screen.getByRole("button", { name: "Toggle voting information" }),
    );
    expect(screen.getByText("How votes are counted")).toBeInTheDocument();
    expect(screen.getByText("Ties")).toBeInTheDocument();
  });
});

describe("StatusWindow collapsible behavior", () => {
  it("is collapsed by default and expands its body when the header is toggled", async () => {
    const user = userEvent.setup();
    const { container } = renderStatusWindow();

    const header = screen.getByRole("button", { name: /Game status/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).toBeNull();

    // Expanding mounts the merged body.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).not.toBeNull();

    // Collapsing unmounts the merged body again.
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).toBeNull();
  });

  it("persists the toggled state to localStorage and restores it on remount", async () => {
    const user = userEvent.setup();
    const first = renderStatusWindow();

    // Starts collapsed; opening writes true.
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

  it("restores a collapsed state written by a previous session", () => {
    window.localStorage.setItem("tco-status-open", "false");
    const { container } = renderStatusWindow();

    expect(screen.getByRole("button", { name: /Game status/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      container.querySelector('[data-ocid="turn_status.panel"]'),
    ).toBeNull();
  });

  it("keeps the move-maker indicator, turn timer, and board controls merged as one unit", () => {
    // Seed the window open so the merged body is mounted.
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
    // The two board controls; the Advice control was removed.
    expect(
      status.getByRole("button", { name: "Hide coordinates" }),
    ).toBeInTheDocument();
    expect(
      status.getByRole("button", { name: "Flip board" }),
    ).toBeInTheDocument();
    expect(
      status.queryByRole("button", { name: /advice/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Layout-level window placement above the chessboard", () => {
  it("renders the wallet window below the board window", () => {
    const { container } = render(
      <Layout
        onLogout={() => {}}
        windows={{
          wallet: <div data-testid="wallet-content" />,
          board: <div data-testid="board-content" />,
        }}
      />,
    );

    const wallet = container.querySelector('[data-ocid="window.wallet"]');
    const board = container.querySelector('[data-ocid="window.board"]');
    expect(wallet).not.toBeNull();
    expect(board).not.toBeNull();

    // DOM order encodes the vertical stack: board, then wallet.
    const ordered = Array.from(
      container.querySelectorAll(
        '[data-ocid="window.board"], [data-ocid="window.wallet"]',
      ),
    );
    expect(ordered).toEqual([board, wallet]);
  });

  it("omits the wallet window when the route does not provide it", () => {
    const { container } = render(
      <Layout
        onLogout={() => {}}
        windows={{
          board: <div data-testid="board-content" />,
        }}
      />,
    );

    expect(container.querySelector('[data-ocid="window.wallet"]')).toBeNull();
    expect(
      container.querySelector('[data-ocid="window.board"]'),
    ).not.toBeNull();
  });
});
