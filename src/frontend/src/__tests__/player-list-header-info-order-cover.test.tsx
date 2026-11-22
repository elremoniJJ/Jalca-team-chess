import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
 * The accepted request moves the header controls so the info button is no
 * longer behind the theme dots: the player count and the info button now
 * render AFTER the theme dots, with the count immediately to the left of the
 * info button. The info button keeps its data-ocid, aria-pressed state and
 * toggle behavior.
 *
 * Covered here (frontend observable behavior):
 *   - the header's DOM order is theme dots -> player count -> info button, so
 *     the info button is not overlapped/hidden by the dots;
 *   - the player count sits immediately to the left of the info button;
 *   - the info button keeps data-ocid="player_list.info_button", toggles
 *     aria-pressed, and swaps the roster for the info content.
 *
 * The backend actor is a typed local mock (no real canister, no network), so
 * this file proves the frontend consumer contract only.
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

/** The header element that contains the theme dots. */
function headerForDots(): HTMLElement {
  const dots = document.querySelector(
    '[data-ocid="player_list.theme_dots"]',
  ) as HTMLElement | null;
  if (!dots) throw new Error("no player_list theme dots container");
  const header = dots.parentElement;
  if (!header) throw new Error("theme dots have no header parent");
  return header;
}

describe("Players window header info-button placement", () => {
  beforeEach(() => {
    // jsdom does not evaluate CSS media queries. Report a landscape viewport
    // so the theme dots render (they are hidden in portrait).
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("landscape"),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders the theme dots, then the player count, then the info button", () => {
    renderList([
      makePlayer({ principal: "w1", username: "Ada", team: Team.White }),
      makePlayer({ principal: "b1", username: "Cara", team: Team.Black }),
    ]);

    const header = headerForDots();
    const dots = header.querySelector(
      '[data-ocid="player_list.theme_dots"]',
    ) as HTMLElement;
    const infoButton = header.querySelector(
      '[data-ocid="player_list.info_button"]',
    ) as HTMLElement;
    const count = screen.getByText("1W / 1B");

    expect(dots).not.toBeNull();
    expect(infoButton).not.toBeNull();

    // The info button comes AFTER the theme dots in document order, so it is
    // no longer behind/overlapped by them.
    expect(
      dots.compareDocumentPosition(infoButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The player count sits between the dots and the info button, i.e.
    // immediately to the left of the info button.
    expect(
      dots.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      count.compareDocumentPosition(infoButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The count is the info button's immediately preceding element sibling.
    expect(infoButton.previousElementSibling).toBe(count);
  });

  it("keeps the info button's data-ocid, aria-pressed and toggle behavior", async () => {
    const user = userEvent.setup();
    renderList([
      makePlayer({ principal: "w1", username: "Ada", team: Team.White }),
    ]);

    const infoButton = screen.getByRole("button", {
      name: "Toggle players information",
    });
    expect(infoButton).toHaveAttribute("data-ocid", "player_list.info_button");
    expect(infoButton).toHaveAttribute("aria-pressed", "false");

    // The roster is shown before toggling.
    expect(screen.getByRole("button", { name: /Ada/ })).toBeInTheDocument();
    expect(
      document.querySelector('[data-ocid="player_list.info_content"]'),
    ).toBeNull();

    await user.click(infoButton);

    // Toggling reveals the info content and hides the roster.
    expect(infoButton).toHaveAttribute("aria-pressed", "true");
    expect(
      document.querySelector('[data-ocid="player_list.info_content"]'),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: /Ada/ }),
    ).not.toBeInTheDocument();

    await user.click(infoButton);

    // Toggling back restores the roster.
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(
      document.querySelector('[data-ocid="player_list.info_content"]'),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /Ada/ })).toBeInTheDocument();
  });
});
