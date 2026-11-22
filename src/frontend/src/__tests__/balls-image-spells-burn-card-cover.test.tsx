import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the burn card image of the three new offensive image Balls spells
 * (Hairy Balls, Veiny Balls, Shiny Balls).
 *
 * The accepted behavior: an owned NFT of one of the three shows the spell's
 * own image on the burn card instead of the Rabbit placeholder, while every
 * other spell keeps the placeholder.
 *
 * The hook is replaced by a typed local mock of `UseOisyBurn`, so this is
 * component/integration coverage of the panel's rendering — not a deployed
 * browser journey and not real backend behavior.
 */

import { OisyBurnPanel } from "@/oisy-burn/OisyBurnPanel";
import type { OisyNft } from "@/oisy-burn/types";
import type { UseOisyBurn } from "@/oisy-burn/use-oisy-burn";

const IMAGE_SPELLS = [
  { name: "Hairy Balls", image: "/assets/spells/hairy-balls.png" },
  { name: "Veiny Balls", image: "/assets/spells/veiny-balls.png" },
  { name: "Shiny Balls", image: "/assets/spells/shiny-balls.png" },
] as const;

function makeNft(overrides: Partial<OisyNft> = {}): OisyNft {
  return {
    id: 1n,
    name: "JALCA Game NFT #1",
    thumbnailUrl: null,
    gameNumber: 7n,
    spellName: "Hairy Balls",
    ...overrides,
  };
}

function makeOisy(overrides: Partial<UseOisyBurn> = {}): UseOisyBurn {
  return {
    connection: { status: "disconnected" },
    listingOwner: "wallet-abc",
    nfts: [makeNft()],
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("new image Balls spells on the burn card", () => {
  it("shows each new spell's own image on its owned NFT card", () => {
    for (const spell of IMAGE_SPELLS) {
      const { unmount } = render(
        <OisyBurnPanel
          oisy={makeOisy({ nfts: [makeNft({ spellName: spell.name })] })}
        />,
      );

      const thumb = screen.getByRole("button", {
        name: `View metadata for ${spell.name} · Game 7`,
      });
      const img = thumb.querySelector("img");
      expect(img).not.toBeNull();
      expect(img).toHaveAttribute("src", spell.image);
      unmount();
    }
  });

  it("keeps the Rabbit placeholder for a spell with no image", () => {
    // "Hipsy Tan Chin" (id 2) has no image mapping. (This test previously used
    // "Newkai Dodan", which now intentionally maps to /assets/spells/1.png.)
    render(
      <OisyBurnPanel
        oisy={makeOisy({ nfts: [makeNft({ spellName: "Hipsy Tan Chin" })] })}
      />,
    );

    const thumb = screen.getByRole("button", {
      name: "View metadata for Hipsy Tan Chin · Game 7",
    });
    expect(thumb.querySelector("img")).toBeNull();
    expect(thumb.querySelector("svg")).not.toBeNull();
  });

  /**
   * Cover for the accepted Newkai Dodan burn-card image.
   *
   * The request gives Newkai Dodan (id 1) the supplied image at
   * `/assets/spells/1.png`, so an owned Newkai Dodan NFT shows that image on
   * its burn card instead of the Rabbit placeholder.
   *
   * The hook is replaced by a typed local mock of `UseOisyBurn`, so this is
   * component/integration coverage of the panel's rendering — not a deployed
   * browser journey and not real backend behavior. See episode.coverageLimits.
   */
  it("shows Newkai Dodan's own image on its owned NFT card", () => {
    render(
      <OisyBurnPanel
        oisy={makeOisy({ nfts: [makeNft({ spellName: "Newkai Dodan" })] })}
      />,
    );

    const thumb = screen.getByRole("button", {
      name: "View metadata for Newkai Dodan · Game 7",
    });
    const img = thumb.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "/assets/spells/1.png");
  });
});
