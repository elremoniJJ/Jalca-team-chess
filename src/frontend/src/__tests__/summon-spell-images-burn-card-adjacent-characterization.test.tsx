import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the Oisy wallet NFT grid card image mapping ADJACENT to
 * adding the three summon-spell images (Anne Boleyn id 25, Cuoclot Sac Wonmuc
 * Rook id 24, Lazarus id 23), taken BEFORE the change lands.
 *
 * The request intentionally changes, for those three spells, the grid card
 * image from the Rabbit placeholder to their own PNG. That is the intentional
 * change, so this file deliberately does NOT pin what those three spells
 * currently render.
 *
 * What IS protected is the adjacent mapping the new cases must not disturb,
 * because the change edits the exact same `spellImageFor` switch in
 * OisyBurnPanel.tsx:
 *   - each existing image-mapped spell keeps its own PNG on its card;
 *   - a spell with no image mapping keeps the Rabbit placeholder.
 *
 * The hook is replaced by a typed local mock of `UseOisyBurn`, so this is
 * component/integration coverage of the panel's rendering — not a deployed
 * browser journey and not real backend behavior. See episode.coverageLimits.
 */

import { OisyBurnPanel } from "@/oisy-burn/OisyBurnPanel";
import type { OisyNft } from "@/oisy-burn/types";
import type { UseOisyBurn } from "@/oisy-burn/use-oisy-burn";

/** Existing image-mapped spells whose grid-card mapping must be unchanged. */
const EXISTING_IMAGE_SPELLS = [
  { name: "Hairy Balls", image: "/assets/spells/hairy-balls.png" },
  { name: "Veiny Balls", image: "/assets/spells/veiny-balls.png" },
  { name: "Shiny Balls", image: "/assets/spells/shiny-balls.png" },
  { name: "Tia Lua", image: "/assets/spells/10.png" },
  { name: "Subao Ve", image: "/assets/spells/subao-ve.png" },
  { name: "Bendika", image: "/assets/spells/3.png" },
  { name: "Chila Cao", image: "/assets/spells/15.png" },
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

describe("OisyBurnPanel image mapping adjacent to the summon-spell images", () => {
  it("keeps each existing image-mapped spell's own PNG on its card", () => {
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
      // The Rabbit placeholder must not be what is shown.
      expect(thumb.querySelector("svg")).toBeNull();
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
