import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted Subao Ve artwork on the OisyBurnPanel burn card.
 *
 * The request wires the supplied Subao Ve image into the spell collection UI.
 * The burn card's `spellImageFor` copy must show `/assets/spells/subao-ve.png`
 * for a Subao Ve NFT instead of the Rabbit placeholder, while the existing
 * Balls / Lua fire images and the unmapped-spell fallback keep working.
 *
 * The hook is replaced by a typed local mock of `UseOisyBurn`, so this is
 * component/integration coverage of the panel's rendering — not a deployed
 * browser journey and not real backend behavior.
 */

import { OisyBurnPanel } from "@/oisy-burn/OisyBurnPanel";
import type { OisyNft } from "@/oisy-burn/types";
import type { UseOisyBurn } from "@/oisy-burn/use-oisy-burn";

const SUBAO_VE_IMAGE = "/assets/spells/subao-ve.png";

/** The existing image-mapped spells that must keep their own PNG. */
const EXISTING_IMAGE_SPELLS = [
  { name: "Hairy Balls", image: "/assets/spells/hairy-balls.png" },
  { name: "Tia Lua", image: "/assets/spells/10.png" },
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
    spellName: "Subao Ve",
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

describe("OisyBurnPanel Subao Ve artwork", () => {
  it("shows the supplied Subao Ve image on the Subao Ve burn card", () => {
    render(<OisyBurnPanel oisy={makeOisy()} />);

    const thumb = screen.getByRole("button", {
      name: "View metadata for Subao Ve · Game 7",
    });
    const img = thumb.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", SUBAO_VE_IMAGE);
    // The Rabbit placeholder must not be what is shown.
    expect(thumb.querySelector("svg")).toBeNull();
  });

  it("keeps the existing image-mapped spells and the unmapped-spell fallback", () => {
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
