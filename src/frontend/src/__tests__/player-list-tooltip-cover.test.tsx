import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
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
 * Cover for the kick button after the wallet requirement was removed.
 *
 * The request deletes the "Connect a wallet to kick" tooltip and the
 * `hasWallet` prop, so the kick button is no longer wrapped in a Radix
 * Tooltip and is never disabled for a missing wallet. This test asserts the
 * observable consequence: the button is enabled and carries no tooltip
 * trigger, and no tooltip content is rendered.
 *
 * Covered here (frontend observable behavior):
 *   - the kick button is enabled for a player with no wallet prop;
 *   - the button is not a tooltip trigger and no tooltip content renders.
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

describe("PlayerList kick button (no wallet tooltip)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders an enabled kick button with no tooltip trigger or content", () => {
    const { container } = render(
      <PlayerList
        players={[
          makePlayer({ principal: "me", username: "Ada", team: Team.White }),
          makePlayer({
            principal: "target",
            username: "Bob",
            team: Team.White,
          }),
        ]}
        currentPrincipal="me"
        currentUsername="Ada"
      />,
    );

    const kickButton = container.querySelector<HTMLButtonElement>(
      '[data-ocid="player_list.kick_button.1"]',
    );
    expect(kickButton).not.toBeNull();
    expect(kickButton).toBeEnabled();
    // The wallet-required tooltip is gone: the button is not a tooltip
    // trigger and no tooltip content is rendered.
    expect(kickButton).not.toHaveAttribute("data-slot", "tooltip-trigger");
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
  });
});
