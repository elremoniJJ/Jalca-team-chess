import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PlayerList imports Team as a runtime value from @/backend, which
// transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the component needs. The
// NFT popup under test is pure frontend rendering plus a mocked actor call.
vi.mock("@/backend", () => ({
  Team: { Black: "Black", White: "White" },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// PlayerList calls getActor() from lib/backend-actor on click to query the
// NFT count. Mock it so the test controls the returned token list without
// touching the real actor or @caffeineai/core-infrastructure. The mock is
// built with vi.hoisted because the factory is hoisted above the imports.
const { getNftsForOwner } = vi.hoisted(() => ({ getNftsForOwner: vi.fn() }));
vi.mock("@/lib/backend-actor", () => ({
  getActor: vi.fn().mockResolvedValue({ getNftsForOwner }),
}));

import { Team, WalletSource } from "@/backend";
import type { PlayerInfo } from "@/backend";
import { PlayerList } from "@/components/PlayerList";

/**
 * Characterization of the Players window NFT count popup.
 *
 * The request changes how a connected wallet's NFT count is displayed: a
 * player with a connected wallet will show their app spell NFT count as a
 * number (0 when connected with no NFTs) instead of a dash, and the Oisy
 * wallet address will be captured and stored in the backend user record.
 *
 * What must remain stable across that change is protected here:
 *   - a player with NO wallet connected still shows the dash ("nfts: -")
 *     with no canister query — this is explicitly unchanged;
 *   - a player with a queryable (principal-text) wallet shows a NUMBER —
 *     the count returned by getNftsForOwner, including 0 for an empty
 *     collection — never a dash;
 *   - the popup opens on clicking a username, closes on Escape, and closes
 *     on the close button.
 *
 * The old dash-for-connected-wallet behavior is intentionally NOT asserted:
 * the request changes it.
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

function renderList(players: PlayerInfo[]) {
  return render(<PlayerList players={players} currentPrincipal="me" />);
}

describe("PlayerList NFT count popup", () => {
  beforeEach(() => {
    getNftsForOwner.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the dash for a player with no wallet connected, with no canister query", async () => {
    const user = userEvent.setup();
    renderList([makePlayer({ walletAddress: undefined })]);

    await user.click(screen.getByRole("button", { name: /Ada/ }));

    expect(screen.getByText("nfts: -")).toBeInTheDocument();
    expect(getNftsForOwner).not.toHaveBeenCalled();
  });

  it("shows the count returned by getNftsForOwner for a connected wallet", async () => {
    const user = userEvent.setup();
    getNftsForOwner.mockResolvedValue([1n, 2n, 3n]);
    renderList([
      makePlayer({
        walletAddress: "aaaaa-aa",
        walletSource: WalletSource.oisy,
      }),
    ]);

    await user.click(screen.getByRole("button", { name: /Ada/ }));

    expect(await screen.findByText("nfts: 3")).toBeInTheDocument();
    expect(getNftsForOwner).toHaveBeenCalledWith("aaaaa-aa");
  });

  it("shows 0 for a connected wallet with no spell NFTs", async () => {
    const user = userEvent.setup();
    getNftsForOwner.mockResolvedValue([]);
    renderList([
      makePlayer({
        walletAddress: "aaaaa-aa",
        walletSource: WalletSource.oisy,
      }),
    ]);

    await user.click(screen.getByRole("button", { name: /Ada/ }));

    expect(await screen.findByText("nfts: 0")).toBeInTheDocument();
  });

  it("closes the popup on Escape", async () => {
    const user = userEvent.setup();
    renderList([makePlayer({ walletAddress: undefined })]);

    await user.click(screen.getByRole("button", { name: /Ada/ }));
    expect(screen.getByText("nfts: -")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("nfts: -")).not.toBeInTheDocument();
  });

  it("closes the popup via the close button", async () => {
    const user = userEvent.setup();
    const { container } = renderList([
      makePlayer({ walletAddress: undefined }),
    ]);

    await user.click(screen.getByRole("button", { name: /Ada/ }));
    expect(screen.getByText("nfts: -")).toBeInTheDocument();

    // The backdrop and the close button share the "Close NFT count" label;
    // target the explicit close button by its data-ocid.
    const closeButton = container.querySelector(
      '[data-ocid="player_list.nft_popup.close_button"]',
    );
    expect(closeButton).not.toBeNull();
    await user.click(closeButton as HTMLElement);
    expect(screen.queryByText("nfts: -")).not.toBeInTheDocument();
  });
});
