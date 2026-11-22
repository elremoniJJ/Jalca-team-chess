import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the OisyBurnPanel burn-card image mapping, taken BEFORE
 * the three Minor removal spells (Chila Cao, Handom Zitie Zumuc, Bamburgh —
 * spell ids 15-17) gain their own images.
 *
 * The request intentionally changes the image mapping for those three spell
 * names, so this file deliberately does NOT pin their current default-null
 * behavior. What IS protected is the adjacent image-mapping behavior the new
 * cases must not disturb, because the change edits the same `spellImageFor`
 * switch:
 *   - the existing image-mapped spells (the three Balls spells, the five Lua
 *     fire spells, Subao Ve) keep showing their own PNG on the card;
 *   - a spell with no image mapping (Bendika) keeps the Rabbit placeholder.
 *
 * The hook is replaced by a typed local mock of `UseOisyBurn`, so this is
 * component/integration coverage of the panel's rendering — not a deployed
 * browser journey and not real backend behavior.
 */

import { OisyBurnPanel } from "@/oisy-burn/OisyBurnPanel";
import type { OisyNft } from "@/oisy-burn/types";
import type { UseOisyBurn } from "@/oisy-burn/use-oisy-burn";

/** The existing image-mapped spells and the asset each must keep rendering. */
const EXISTING_IMAGE_SPELLS = [
  { name: "Hairy Balls", image: "/assets/spells/hairy-balls.png" },
  { name: "Veiny Balls", image: "/assets/spells/veiny-balls.png" },
  { name: "Shiny Balls", image: "/assets/spells/shiny-balls.png" },
  { name: "Tia Lua", image: "/assets/spells/10.png" },
  { name: "Cau Lua", image: "/assets/spells/11.png" },
  { name: "Hoa Boc", image: "/assets/spells/12.png" },
  { name: "Buc Tung Lua", image: "/assets/spells/13.png" },
  { name: "Mua Lua", image: "/assets/spells/14.png" },
  { name: "Subao Ve", image: "/assets/spells/subao-ve.png" },
] as const;

/** A spell with no image mapping — must keep the Rabbit placeholder.
 * "Newkai Dodan" (id 1) is not one of the spells this change maps; "Bendika"
 * is now intentionally mapped to /assets/spells/3.png. */
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

describe("OisyBurnPanel image mapping adjacent to the Minor removal images", () => {
  it("keeps showing each existing image-mapped spell's own PNG on its card", () => {
    for (const spell of EXISTING_IMAGE_SPELLS) {
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
      unmount();
    }
  });

  it("keeps the Rabbit placeholder for a spell with no image mapping", () => {
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
