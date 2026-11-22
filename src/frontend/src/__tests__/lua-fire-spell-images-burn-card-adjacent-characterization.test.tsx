import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the OisyBurnPanel burn-card image mapping, taken BEFORE
 * the `spellImageFor` helper gains five new cases mapping the Lua fire spells
 * (Tia Lua, Cau Lua, Hoa Boc, Buc Tung Lua, Mua Lua) to
 * `/assets/spells/10.png` ... `/assets/spells/14.png`.
 *
 * The request intentionally changes the image mapping for those five spell
 * names, so this file deliberately does NOT pin their current default-null
 * behavior. What IS protected is the adjacent image-mapping behavior the new
 * cases must not disturb:
 *   - the three image Balls spells (Hairy / Veiny / Shiny Balls) keep showing
 *     their own PNG on the card;
 *   - a spell with no image mapping (Bendika) keeps the Rabbit placeholder;
 *   - a token's own `thumbnailUrl` still takes precedence over the spell image.
 *
 * The hook is replaced by a typed local mock of `UseOisyBurn`, so this is
 * component/integration coverage of the panel's rendering — not a deployed
 * browser journey and not real backend behavior.
 */

import { OisyBurnPanel } from "@/oisy-burn/OisyBurnPanel";
import type { OisyNft } from "@/oisy-burn/types";
import type { UseOisyBurn } from "@/oisy-burn/use-oisy-burn";

/** The three image Balls spells whose mapping already exists and must hold. */
const IMAGE_SPELLS = [
  { name: "Hairy Balls", image: "/assets/spells/hairy-balls.png" },
  { name: "Veiny Balls", image: "/assets/spells/veiny-balls.png" },
  { name: "Shiny Balls", image: "/assets/spells/shiny-balls.png" },
] as const;

/**
 * A spell with no image mapping. Deliberately NOT one of the five Lua fire
 * spells, whose mapping is the intentional change and must not be frozen here.
 * "Newkai Dodan" (id 1) is not mapped by any change; "Bendika" is now
 * intentionally mapped to /assets/spells/3.png.
 */
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

describe("OisyBurnPanel spell image mapping (adjacent behavior)", () => {
  it("keeps showing each image Balls spell's own PNG on its card", () => {
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

  it("keeps the token's own thumbnailUrl ahead of the spell image", () => {
    render(
      <OisyBurnPanel
        oisy={makeOisy({
          nfts: [
            makeNft({
              spellName: "Hairy Balls",
              thumbnailUrl: "https://example.test/thumb.png",
            }),
          ],
        })}
      />,
    );

    const thumb = screen.getByRole("button", {
      name: "View metadata for Hairy Balls · Game 7",
    });
    const img = thumb.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "https://example.test/thumb.png");
  });
});
