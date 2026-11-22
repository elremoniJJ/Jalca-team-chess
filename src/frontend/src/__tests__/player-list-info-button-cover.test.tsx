import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { Team, WalletSource } from "@/backend";
import type { PlayerInfo } from "@/backend";
import { PlayerList } from "@/components/PlayerList";

/**
 * Cover for the Players window header layout change.
 *
 * The request moves the Info button out from behind the theme dots: the
 * player count now sits immediately to the left of the Info button, and the
 * Info button sits to the right of the theme dots. The Info button keeps its
 * data-ocid, aria-pressed state and toggle behavior.
 *
 * Covered here (frontend observable behavior):
 *   - the Info button renders to the right of the theme dots in DOM order;
 *   - the player count renders immediately to the left of the Info button;
 *   - the Info button toggles the info content and flips aria-pressed;
 *   - the Info button keeps its data-ocid.
 */
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

function renderList(players: PlayerInfo[], currentPrincipal = "me") {
  return render(
    <PlayerList players={players} currentPrincipal={currentPrincipal} />,
  );
}

describe("PlayerList header Info button placement", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the Info button to the right of the theme dots", () => {
    const { container } = renderList([
      makePlayer({ principal: "w1", username: "Ada", team: Team.White }),
    ]);

    const themeDots = container.querySelector(
      '[data-ocid="player_list.theme_dots"]',
    );
    const infoButton = container.querySelector(
      '[data-ocid="player_list.info_button"]',
    );
    expect(themeDots).not.toBeNull();
    expect(infoButton).not.toBeNull();

    // The Info button must follow the theme dots in document order, so it is
    // not overlapped or hidden behind them.
    const position = themeDots!.compareDocumentPosition(infoButton!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the player count immediately to the left of the Info button", () => {
    const { container } = renderList([
      makePlayer({ principal: "w1", username: "Ada", team: Team.White }),
      makePlayer({ principal: "b1", username: "Cara", team: Team.Black }),
    ]);

    const count = screen.getByText("1W / 1B");
    const infoButton = container.querySelector(
      '[data-ocid="player_list.info_button"]',
    );
    expect(infoButton).not.toBeNull();

    // The count precedes the Info button in document order.
    const position = count.compareDocumentPosition(infoButton!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The count is the Info button's immediately preceding element sibling.
    expect(infoButton!.previousElementSibling).toBe(count);
  });

  it("toggles the info content and aria-pressed when clicked", async () => {
    const user = userEvent.setup();
    const { container } = renderList([
      makePlayer({ principal: "w1", username: "Ada", team: Team.White }),
    ]);

    const infoButton = container.querySelector<HTMLButtonElement>(
      '[data-ocid="player_list.info_button"]',
    );
    expect(infoButton).not.toBeNull();
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(
      container.querySelector('[data-ocid="player_list.info_content"]'),
    ).toBeNull();

    await user.click(infoButton as HTMLButtonElement);

    expect(infoButton).toHaveAttribute("aria-pressed", "true");
    expect(
      container.querySelector('[data-ocid="player_list.info_content"]'),
    ).not.toBeNull();

    await user.click(infoButton as HTMLButtonElement);

    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(
      container.querySelector('[data-ocid="player_list.info_content"]'),
    ).toBeNull();
  });
});
