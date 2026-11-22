import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted burn-authorization change: burning an NFT spell no
 * longer requires the player to connect an Oisy wallet or grant an on-chain
 * approval.
 *
 * The request removed the "Authorize burn" toggle, the signer popup, and the
 * approval-args flow from the burn panel; the backend now burns directly as
 * itself through the existing admin-authorized path. The visible copy states
 * that burning is backend-authorized rather than player-signed.
 *
 * What this file asserts, through the REAL OisyBurnPanel:
 *   - no "Authorize burn" toggle and no signer/approval control appears
 *     anywhere in the burn surface;
 *   - the backend-authorization copy is visible up front and again in the
 *     burn confirmation step;
 *   - a player whose wallet address is already on file can burn an eligible
 *     NFT in one action with NO wallet-connect prerequisite — the grid is
 *     populated while disconnected and the burn button is enabled;
 *   - confirming the burn calls the hook's burnOne with the token id and
 *     never opens a signer popup;
 *   - the metadata modal still opens from a card's spell icon.
 *
 * The hook is replaced by a typed local mock of `UseOisyBurn`, so this is
 * component/integration coverage of the panel's rendering and interaction —
 * not a deployed browser journey and not real backend behavior. The real
 * backend burn path is exercised by the PocketIC lane.
 */

import { OisyBurnPanel } from "@/oisy-burn/OisyBurnPanel";
import type { OisyNft } from "@/oisy-burn/types";
import type { UseOisyBurn } from "@/oisy-burn/use-oisy-burn";

function makeNft(overrides: Partial<OisyNft> = {}): OisyNft {
  return {
    id: 1n,
    name: "JALCA Game NFT #1",
    thumbnailUrl: null,
    gameNumber: 7n,
    spellName: "Minor Spell",
    ...overrides,
  };
}

/**
 * Build a fully-typed `UseOisyBurn` mock. Defaults describe a disconnected
 * player whose wallet address is already on file, who is the Move_Maker and
 * may burn — the exact state in which a burn must be reachable in one action
 * with no wallet-connect prerequisite.
 */
function makeOisy(overrides: Partial<UseOisyBurn> = {}): UseOisyBurn {
  const nft = makeNft();
  return {
    connection: { status: "disconnected" },
    listingOwner: "wallet-abc",
    nfts: [nft],
    loadingNfts: false,
    nftsError: null,
    tokenStates: {},
    tokenResults: {},
    burning: false,
    signerAvailable: true,
    isMoveMaker: true,
    burnOccurredThisTurn: false,
    isFirstTurn: false,
    canBurn: true,
    burnDisabledReason: null,
    burnDisabledReasonFor: () => null,
    burnNoteFor: () => null,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    burnOne: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderPanel(oisy: UseOisyBurn) {
  return render(<OisyBurnPanel oisy={oisy} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OisyBurnPanel backend-authorized burn", () => {
  it("shows no 'Authorize burn' toggle or signer/approval control anywhere", () => {
    renderPanel(makeOisy());

    // The removed consent surface must not reappear as an interactive control.
    // The backend-authorization copy legitimately mentions the words
    // "signature" and "approval" to explain their absence, so assert on the
    // controls (buttons / checkboxes / switches), not on the words.
    expect(
      screen.queryByRole("button", { name: /authorize burn/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /authorize/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /authorize/i }),
    ).not.toBeInTheDocument();
    // No signer/approval action button is present in the burn surface. The
    // "Connect Oisy Wallet" chip is expected to remain — it only identifies
    // which account's NFTs to list and is never a burn prerequisite — so it
    // is deliberately excluded from this check.
    expect(
      screen.queryByRole("button", { name: /sign|approve/i }),
    ).not.toBeInTheDocument();
  });

  it("no longer shows the burning-authorization text as a standalone always-visible notice in the panel body", () => {
    renderPanel(makeOisy());

    // The accepted request removed the standalone always-visible notice
    // (data-ocid oisy_burn.backend_authorized_notice) from the burn window
    // body. The copy now lives in the window's info section instead, so it
    // must not appear in the panel body before any interaction.
    expect(
      document.querySelector(
        '[data-ocid="oisy_burn.backend_authorized_notice"]',
      ),
    ).toBeNull();
    expect(
      screen.queryByText(
        /authorized by the game backend, not signed by your wallet/i,
      ),
    ).not.toBeInTheDocument();
  });

  it("lets a disconnected player burn an eligible NFT in one action with no wallet-connect prerequisite", async () => {
    const user = userEvent.setup();
    const oisy = makeOisy();
    renderPanel(oisy);

    // Disconnected, yet the grid is populated from the wallet address on file
    // and the burn button is enabled — no connect step is required.
    expect(screen.getByText("Minor Spell · Game 7")).toBeInTheDocument();
    const burnButton = screen.getByRole("button", {
      name: "Burn Minor Spell · Game 7",
    });
    expect(burnButton).toHaveAttribute("aria-disabled", "false");

    // One action: press Burn, then confirm. No signer popup, no approval.
    await user.click(burnButton);
    const dialog = screen.getByRole("dialog", {
      name: /confirm burn of jalca game nft #1/i,
    });
    // The confirmation step repeats the backend-authorization copy.
    expect(
      within(dialog).getByText(/authorized by the game backend/i),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Burn NFT" }));

    expect(oisy.burnOne).toHaveBeenCalledTimes(1);
    // burnOne now takes the full OisyNft (the burn-and-play request needs the
    // NFT's spell name and game number, not just the token id).
    expect(oisy.burnOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1n, spellName: "Minor Spell" }),
    );
    // The connect flow is never invoked by a burn.
    expect(oisy.connect).not.toHaveBeenCalled();
  });

  it("still opens the metadata modal from a card's spell icon", async () => {
    const user = userEvent.setup();
    renderPanel(makeOisy());

    await user.click(
      screen.getByRole("button", {
        name: "View metadata for Minor Spell · Game 7",
      }),
    );

    const dialog = screen.getByRole("dialog", {
      name: /jalca game nft #1 metadata/i,
    });
    expect(within(dialog).getByText("Game 7")).toBeInTheDocument();
    expect(within(dialog).getByText("Minor Spell")).toBeInTheDocument();
  });

  it("keeps the burn button disabled with the restriction reason when the player may not burn", () => {
    renderPanel(
      makeOisy({
        canBurn: false,
        burnDisabledReason: "Only the current Move_Maker can burn an NFT.",
        burnDisabledReasonFor: () =>
          "Only the current Move_Maker can burn an NFT.",
      }),
    );

    expect(
      screen.getByText("Only the current Move_Maker can burn an NFT."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Burn Minor Spell · Game 7" }),
    ).toHaveAttribute("aria-disabled", "true");
  });
});
