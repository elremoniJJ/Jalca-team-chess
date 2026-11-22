import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted burn-card mapping of the user's original hand-drawn
 * images to Bendika (id 3), Bendika Tah (id 4) and Mayban Dadoy Tron (id 6).
 *
 * Each of the three spells must render its own PNG at `/assets/spells/3.png`,
 * `/assets/spells/4.png` and `/assets/spells/6.png` on its owned-NFT card
 * instead of the Rabbit placeholder, while the existing image mappings and the
 * unmapped-spell fallback keep working.
 *
 * The hook is replaced by a typed local mock of `UseOisyBurn`, so this is
 * component/integration coverage of the panel's rendering — not a deployed
 * browser journey and not real backend behavior. See episode.coverageLimits.
 */

import { OisyBurnPanel } from "@/oisy-burn/OisyBurnPanel";
import type { OisyNft } from "@/oisy-burn/types";
import type { UseOisyBurn } from "@/oisy-burn/use-oisy-burn";

/** The three spells this change maps and the asset each must render. */
const ORIGINAL_IMAGE_SPELLS = [
  { name: "Bendika", image: "/assets/spells/3.png" },
  { name: "Bendika Tah", image: "/assets/spells/4.png" },
  { name: "Mayban Dadoy Tron", image: "/assets/spells/6.png" },
] as const;

/** Existing image-mapped spells whose mapping must be unchanged. */
const EXISTING_IMAGE_SPELLS = [
  { name: "Hairy Balls", image: "/assets/spells/hairy-balls.png" },
  { name: "Tia Lua", image: "/assets/spells/10.png" },
  { name: "Subao Ve", image: "/assets/spells/subao-ve.png" },
] as const;

/** A spell with no image mapping — must keep the Rabbit placeholder. */
const NO_IMAGE_SPELL = "Hipsy Tan Chin";

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

describe("OisyBurnPanel original spell images", () => {
  it("renders each of the three spells' own PNG instead of the Rabbit placeholder", () => {
    for (const spell of ORIGINAL_IMAGE_SPELLS) {
      const { unmount } = render(
        <OisyBurnPanel
          oisy={makeOisy({ nfts: [makeNft({ spellName: spell.name })] })}
        />,
      );

      const thumb = screen.getByRole("button", {
        name: `View metadata for ${spell.name} · Game 7`,
      });
      const img = thumb.querySelector("img");
      expect(img, `${spell.name} should render an image`).not.toBeNull();
      expect(img).toHaveAttribute("src", spell.image);
      // The Rabbit placeholder must not be what is shown.
      expect(thumb.querySelector("svg")).toBeNull();
      unmount();
    }
  });

  it("keeps the existing image mappings and the unmapped-spell fallback", () => {
    for (const spell of EXISTING_IMAGE_SPELLS) {
      const { unmount } = render(
        <OisyBurnPanel
          oisy={makeOisy({ nfts: [makeNft({ spellName: spell.name })] })}
        />,
      );
      const thumb = screen.getByRole("button", {
        name: `View metadata for ${spell.name} · Game 7`,
      });
      expect(thumb.querySelector("img")).toHaveAttribute("src", spell.image);
      unmount();
    }

    render(
      <OisyBurnPanel
        oisy={makeOisy({ nfts: [makeNft({ spellName: NO_IMAGE_SPELL })] })}
      />,
    );
    const thumb = screen.getByRole("button", {
      name: `View metadata for ${NO_IMAGE_SPELL} · Game 7`,
    });
    expect(thumb.querySelector("img")).toBeNull();
    expect(thumb.querySelector("svg")).not.toBeNull();
  });
});
