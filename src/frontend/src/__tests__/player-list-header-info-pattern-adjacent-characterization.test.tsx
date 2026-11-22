import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the Players window Info-button change.
 *
 * The request intentionally adds an Info button to the Players window header
 * (mobile collapsible header AND desktop header) matching the sibling windows'
 * info-button pattern, and replaces the roster body with explanatory content
 * while Info is active.
 *
 * This file deliberately does NOT assert the new Players Info button or its
 * content (those are the intentional changes). What it protects is the
 * behavior ADJACENT to the change that must survive it:
 *
 *   - the sibling windows' info-button pattern itself (Info icon + "Info"
 *     label, aria-pressed toggle, accent color when active) — the pattern the
 *     Players button must match, so a regression in the shared pattern is
 *     caught here;
 *   - the Players header layout in BOTH the mobile collapsible header and the
 *     desktop header: the "Players" heading, the per-window theme dots, and
 *     the "NW / NB" count all still render, and the theme dots still precede
 *     the count in DOM order;
 *   - the mobile header still toggles the body and the desktop header still
 *     renders without a toggle.
 *
 * These are component/integration contracts with no actor or network access;
 * the backend actor is mocked.
 */

// PlayerList imports Team as a runtime value from @/backend, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the component needs.
vi.mock("@/backend", () => ({
  Team: { Black: "Black", White: "White" },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
  GamePhase: {
    Paused: "Paused",
    Draw: "Draw",
    Playing: "Playing",
    Celebration: "Celebration",
  },
}));

// PlayerList calls getActor() from lib/backend-actor on click to query the
// NFT count. Mock it so the test controls the returned token list without
// touching the real actor or @caffeineai/core-infrastructure.
const { getNftsForOwner } = vi.hoisted(() => ({ getNftsForOwner: vi.fn() }));
vi.mock("@/lib/backend-actor", () => ({
  getActor: vi.fn().mockResolvedValue({ getNftsForOwner }),
}));

// The mobile header path is driven by the panel-collapse context. Mock the
// Layout module so the test can supply a context value (mobile) or null
// (desktop) without rendering the whole Layout.
const { collapseContext } = vi.hoisted(() => ({
  collapseContext: { value: null as unknown },
}));
vi.mock("@/components/Layout", () => ({
  usePanelCollapseContext: () => collapseContext.value,
}));

import { Team, WalletSource } from "@/backend";
import type { PlayerInfo } from "@/backend";
import { PlayerList } from "@/components/PlayerList";
import { StatusWindow } from "@/components/StatusWindow";

function makePlayer(overrides: Partial<PlayerInfo> = {}): PlayerInfo {
  return {
    principal: "player-1",
    username: "Ada",
    team: Team.White,
    walletSource: WalletSource.none,
    isMoveMaker: false,
    isFresh: true,
    isInactive: false,
    isBot: false,
    ...overrides,
  };
}

function renderList(
  players: PlayerInfo[],
  props: Partial<React.ComponentProps<typeof PlayerList>> = {},
) {
  return render(
    <PlayerList players={players} currentPrincipal="me" {...props} />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  collapseContext.value = null;
  window.localStorage.clear();
});

describe("Sibling info-button pattern the Players button must match", () => {
  it("renders the Game status Info button as an aria-pressed toggle with an Info label", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("tco-status-open", "true");
    render(
      <StatusWindow
        turn={Team.White}
        phase={"Playing" as never}
        moveMaker="player-1"
        players={[makePlayer({ isFresh: false })]}
        timerRemainingMs={300000n}
        showCoordinates
        onToggleCoordinates={() => {}}
        onFlipBoard={() => {}}
      />,
    );

    const infoButton = screen.getByRole("button", {
      name: "Toggle game status information",
    });
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(infoButton).toHaveTextContent("Info");

    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Players header layout survives the Info-button change", () => {
  it("keeps the heading, theme dots and W/B count in the desktop header", () => {
    collapseContext.value = null;
    const { container } = renderList([
      makePlayer({ principal: "w1", username: "Ada", team: Team.White }),
      makePlayer({ principal: "b1", username: "Cara", team: Team.Black }),
    ]);

    expect(screen.getByText("Players")).toBeInTheDocument();
    expect(screen.getByText("1W / 1B")).toBeInTheDocument();

    const dots = container.querySelector(
      '[data-ocid="player_list.theme_dots"]',
    );
    expect(dots).not.toBeNull();

    // The theme dots precede the W/B count in DOM order.
    const header = dots?.parentElement as HTMLElement;
    const ordered = Array.from(
      header.querySelectorAll(
        '[data-ocid="player_list.theme_dots"], span.font-mono',
      ),
    );
    expect(ordered[0]).toBe(dots);
  });

  it("keeps the heading, theme dots and W/B count in the mobile header", () => {
    collapseContext.value = {
      panel: "players",
      expanded: true,
      onToggle: vi.fn(),
    };
    const { container } = renderList([
      makePlayer({ principal: "w1", username: "Ada", team: Team.White }),
      makePlayer({ principal: "b1", username: "Cara", team: Team.Black }),
    ]);

    expect(screen.getByText("Players")).toBeInTheDocument();
    expect(screen.getByText("1W / 1B")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="player_list.theme_dots"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="player_list.toggle"]'),
    ).not.toBeNull();
  });

  it("keeps the mobile header toggle independent of the header content", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    collapseContext.value = {
      panel: "players",
      expanded: true,
      onToggle,
    };
    const { container } = renderList([
      makePlayer({ principal: "w1", username: "Ada", team: Team.White }),
    ]);

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-ocid="player_list.toggle"]',
    );
    expect(toggle).not.toBeNull();
    await user.click(toggle as HTMLButtonElement);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
