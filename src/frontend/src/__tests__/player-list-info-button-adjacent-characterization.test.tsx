import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the Players window Info-button change.
 *
 * The request intentionally:
 *   1. adds an Info button to the Players window header (mobile collapsible
 *      header AND desktop header), matching the sibling windows' info-button
 *      pattern (Info icon + "Info" label, aria-pressed toggle, accent color
 *      when active);
 *   2. replaces the roster body with explanatory content while Info is active,
 *      restoring the roster when toggled off.
 *
 * This file deliberately does NOT assert the new Info button or the new info
 * content (those are the intentional changes). What it protects is the
 * behavior ADJACENT to the change that must survive it:
 *
 *   - the roster still renders both team columns with the correct per-team
 *     header counts and the "NW / NB" count in the header;
 *   - the current player's "you" marker and the Move_Maker crown/"to move"
 *     marker still render;
 *   - stale players (isFresh === false) are still filtered out;
 *   - the empty state still renders when no fresh players are present;
 *   - the kick column still renders per row (enabled with a wallet, disabled
 *     without) and the kick count / kicked-by columns are present;
 *   - clicking a username still opens the NFT popup and queries
 *     getNftsForOwner for a connected wallet, showing "nfts: <count>";
 *   - the per-window theme dots still render in the header;
 *   - the mobile collapsible header still toggles the body, and the desktop
 *     header still renders without a toggle.
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

describe("Players window roster survives the Info-button change", () => {
  it("renders both team columns with per-team counts and the header W/B count", () => {
    renderList([
      makePlayer({ principal: "w1", username: "Ada", team: Team.White }),
      makePlayer({ principal: "w2", username: "Bob", team: Team.White }),
      makePlayer({ principal: "b1", username: "Cara", team: Team.Black }),
    ]);

    expect(screen.getByText("2W / 1B")).toBeInTheDocument();
    expect(screen.getByText("White")).toBeInTheDocument();
    expect(screen.getByText("Black")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ada/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bob/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cara/ })).toBeInTheDocument();
  });

  it("keeps the 'you' and Move_Maker markers and filters stale players", () => {
    renderList(
      [
        makePlayer({
          principal: "me",
          username: "Ada",
          team: Team.White,
          isMoveMaker: true,
        }),
        makePlayer({ principal: "other", username: "Bob", team: Team.White }),
        makePlayer({
          principal: "stale",
          username: "Zed",
          team: Team.White,
          isFresh: false,
        }),
      ],
      { currentPrincipal: "me" },
    );

    const adaRow = screen.getByRole("button", { name: /Ada/ });
    expect(adaRow).toHaveTextContent("you");
    expect(adaRow).toHaveTextContent("to move");
    expect(screen.getByRole("button", { name: /Bob/ })).not.toHaveTextContent(
      "you",
    );
    // Stale player is filtered out of the roster and the header count.
    expect(
      screen.queryByRole("button", { name: /Zed/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("2W / 0B")).toBeInTheDocument();
  });

  it("renders the empty state when no fresh players are present", () => {
    renderList([
      makePlayer({
        principal: "stale",
        username: "Zed",
        team: Team.White,
        isFresh: false,
      }),
    ]);

    expect(
      screen.getByText("Waiting for players to join..."),
    ).toBeInTheDocument();
  });

  it("keeps the kick column per row: an enabled button plus the count columns", () => {
    const { container } = renderList(
      [
        makePlayer({ principal: "me", username: "Ada", team: Team.White }),
        makePlayer({ principal: "target", username: "Bob", team: Team.White }),
      ],
      {
        currentPrincipal: "me",
        currentUsername: "Ada",
        onCastKickVote: vi.fn(),
        onWithdrawKickVote: vi.fn(),
      },
    );

    const kickButton = container.querySelector<HTMLButtonElement>(
      '[data-ocid="player_list.kick_button.1"]',
    );
    expect(kickButton).not.toBeNull();
    expect(kickButton).toBeEnabled();
    expect(
      container.querySelector('[data-ocid="player_list.kick_count.1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="player_list.kicked_by.1"]'),
    ).not.toBeNull();
  });

  it("renders no kick button on the viewer's own row", () => {
    const { container } = renderList(
      [
        makePlayer({ principal: "me", username: "Ada", team: Team.White }),
        makePlayer({ principal: "target", username: "Bob", team: Team.White }),
      ],
      {
        currentPrincipal: "me",
        currentUsername: "Ada",
      },
    );

    // The viewer's own row (index 0) has no kick button, but the count
    // columns still render.
    expect(
      container.querySelector('[data-ocid="player_list.kick_button.0"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-ocid="player_list.kick_count.0"]'),
    ).not.toBeNull();
  });

  it("opens the NFT popup on username click and queries getNftsForOwner", async () => {
    const user = userEvent.setup();
    getNftsForOwner.mockResolvedValue([{ id: 1n }, { id: 2n }]);

    const { container } = renderList([
      makePlayer({
        principal: "w1",
        username: "Ada",
        team: Team.White,
        walletAddress: "wallet-1",
      }),
    ]);

    await user.click(screen.getByRole("button", { name: /Ada/ }));

    await waitFor(() => {
      expect(getNftsForOwner).toHaveBeenCalledWith("wallet-1");
    });
    const popup = container.querySelector(
      '[data-ocid="player_list.nft_popup"]',
    );
    expect(popup).not.toBeNull();
    await waitFor(() => {
      expect(popup).toHaveTextContent("nfts: 2");
    });
  });

  it("shows 'nfts: -' without querying when the player has no wallet", async () => {
    const user = userEvent.setup();

    const { container } = renderList([
      makePlayer({ principal: "w1", username: "Ada", team: Team.White }),
    ]);

    await user.click(screen.getByRole("button", { name: /Ada/ }));

    const popup = container.querySelector(
      '[data-ocid="player_list.nft_popup"]',
    );
    expect(popup).not.toBeNull();
    expect(popup).toHaveTextContent("nfts: -");
    expect(getNftsForOwner).not.toHaveBeenCalled();
  });

  it("keeps the per-window theme dots in the header", () => {
    const { container } = renderList([
      makePlayer({ principal: "w1", username: "Ada", team: Team.White }),
    ]);

    expect(
      container.querySelector('[data-ocid="player_list.theme_dots"]'),
    ).not.toBeNull();
  });
});

describe("Players window header structure survives the Info-button change", () => {
  it("renders the desktop header without a collapse toggle", () => {
    collapseContext.value = null;
    const { container } = renderList([
      makePlayer({ principal: "w1", username: "Ada", team: Team.White }),
    ]);

    expect(screen.getByText("Players")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="player_list.toggle"]'),
    ).toBeNull();
    // Desktop body is always rendered.
    expect(
      container.querySelector('[data-ocid="player_list.list"]'),
    ).not.toBeNull();
  });

  it("renders the mobile collapsible header and toggles the body", async () => {
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
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      container.querySelector('[data-ocid="player_list.list"]'),
    ).not.toBeNull();

    await user.click(toggle as HTMLButtonElement);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("hides the mobile body when the panel is collapsed", () => {
    collapseContext.value = {
      panel: "players",
      expanded: false,
      onToggle: vi.fn(),
    };

    const { container } = renderList([
      makePlayer({ principal: "w1", username: "Ada", team: Team.White }),
    ]);

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-ocid="player_list.toggle"]',
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      container.querySelector('[data-ocid="player_list.list"]'),
    ).toBeNull();
  });
});
