import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the NFT grid CARD STRUCTURE, taken BEFORE the card
 * headline is repointed from the collection string ("JALCA Game NFT #N") to
 * the spell name plus the NFT's game number, and before the rabbit/image
 * rectangle is reduced to a compact thumbnail.
 *
 * Those two changes are intentional and are deliberately NOT asserted here:
 * the card's headline text and the thumbnail's size are expected to change.
 *
 * What IS protected — the card's surrounding behavior, which the restyle must
 * preserve:
 *   - the grid lists every eligible NFT (one card per token) and excludes a
 *     token with no spell name;
 *   - each card keeps a thumbnail button that opens the metadata pop-up, and
 *     falls back to the rabbit icon when the token has no thumbnail URL;
 *   - each card keeps its per-token burn button, which opens the burn
 *     confirmation step and calls the hook's burnOne on confirm;
 *   - a restricted burn button reveals its contextual note instead of burning;
 *   - a per-token result indicator renders the burn outcome.
 *
 * The hook is replaced by a typed local mock of `UseOisyBurn`, so this is
 * component/integration coverage of the panel's rendering and interaction —
 * not a deployed browser journey and not real backend behavior.
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
 * may burn.
 */
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

function renderPanel(oisy: UseOisyBurn) {
  return render(<OisyBurnPanel oisy={oisy} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OisyBurnPanel card structure", () => {
  it("lists one card per eligible NFT and excludes a token with no spell name", () => {
    renderPanel(
      makeOisy({
        nfts: [
          makeNft({ id: 1n, spellName: "Minor Spell" }),
          makeNft({ id: 2n, spellName: null }),
          makeNft({ id: 3n, spellName: "Subao Ve" }),
        ],
      }),
    );

    const grid = screen.getByRole("list");
    expect(within(grid).getAllByRole("listitem")).toHaveLength(2);
    // The spell-less token is not listed. Its card label would fall back to
    // the collection name plus the game number.
    expect(
      screen.queryByRole("button", {
        name: "Burn JALCA Game NFT #2 · Game 7",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps a thumbnail button per card that opens the metadata pop-up", async () => {
    const user = userEvent.setup();
    renderPanel(makeOisy());

    const thumb = screen.getByRole("button", {
      name: "View metadata for Minor Spell · Game 7",
    });
    await user.click(thumb);

    const dialog = screen.getByRole("dialog", {
      name: /jalca game nft #1 metadata/i,
    });
    expect(within(dialog).getByText("Game 7")).toBeInTheDocument();
    expect(within(dialog).getByText("Minor Spell")).toBeInTheDocument();
  });

  it("falls back to the rabbit icon when the token has no thumbnail URL", () => {
    renderPanel(makeOisy({ nfts: [makeNft({ thumbnailUrl: null })] }));

    const thumb = screen.getByRole("button", {
      name: "View metadata for Minor Spell · Game 7",
    });
    // No <img> is rendered; the lucide Rabbit fallback (an svg) is.
    expect(thumb.querySelector("img")).toBeNull();
    expect(thumb.querySelector("svg")).not.toBeNull();
  });

  it("renders the token thumbnail image when a thumbnail URL is present", () => {
    renderPanel(
      makeOisy({
        nfts: [makeNft({ thumbnailUrl: "https://example.test/thumb.png" })],
      }),
    );

    const thumb = screen.getByRole("button", {
      name: "View metadata for Minor Spell · Game 7",
    });
    const img = thumb.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "https://example.test/thumb.png");
  });

  it("opens the burn confirmation and calls burnOne on confirm", async () => {
    const user = userEvent.setup();
    const oisy = makeOisy();
    renderPanel(oisy);

    await user.click(
      screen.getByRole("button", { name: "Burn Minor Spell · Game 7" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: /confirm burn of jalca game nft #1/i,
    });
    await user.click(within(dialog).getByRole("button", { name: "Burn NFT" }));

    expect(oisy.burnOne).toHaveBeenCalledTimes(1);
    expect(oisy.burnOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1n, spellName: "Minor Spell" }),
    );
  });

  it("reveals the contextual note instead of burning when the card is restricted", async () => {
    const user = userEvent.setup();
    const oisy = makeOisy({
      canBurn: false,
      burnDisabledReason: "Only the current Move_Maker can burn an NFT.",
      burnDisabledReasonFor: () =>
        "Only the current Move_Maker can burn an NFT.",
      burnNoteFor: () => "Wait for your turn to burn.",
    });
    renderPanel(oisy);

    const burnButton = screen.getByRole("button", {
      name: "Burn Minor Spell · Game 7",
    });
    expect(burnButton).toHaveAttribute("aria-disabled", "true");

    await user.click(burnButton);

    expect(screen.getByText("Wait for your turn to burn.")).toBeInTheDocument();
    expect(oisy.burnOne).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: /confirm burn/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the per-token result indicator for a burned token", () => {
    renderPanel(
      makeOisy({
        tokenStates: { "1": "success" },
        tokenResults: { "1": { kind: "success", tokenId: 1n } },
      }),
    );

    // The burn button also reads "Burned" once the token is in the success
    // state, so scope the query to the dedicated result indicator (the only
    // element with role="status") rather than matching both elements.
    const indicator = screen.getByRole("status");
    expect(indicator).toHaveTextContent("Burned");
  });

  it("does not report a burn success for a token whose burn failed", () => {
    // A failed burn leaves the token in the 'error' state. The success
    // watcher must not fire onBurnSuccess for it, so a host surface (the
    // Spells view) stays open on a failure. This is the adjacent behavior the
    // success-detection refactor must preserve.
    const onBurnSuccess = vi.fn();
    render(
      <OisyBurnPanel
        oisy={makeOisy({
          tokenStates: { "1": "error" },
          tokenResults: {
            "1": { kind: "error", tokenId: 1n, reason: "Burn failed." },
          },
        })}
        onBurnSuccess={onBurnSuccess}
      />,
    );

    expect(onBurnSuccess).not.toHaveBeenCalled();
  });

  it("reports a burn success at most once per token across re-renders", () => {
    // The success watcher is idempotent: a token that transitions to the
    // 'success' state must fire onBurnSuccess exactly once, so a re-render
    // cannot close a host surface twice or re-trigger a side effect. The
    // transition is driven AFTER mount: a token already at 'success' when the
    // panel mounts is seeded without firing, so reopening a host surface does
    // not immediately close it again.
    const onBurnSuccess = vi.fn();
    const { rerender } = render(
      <OisyBurnPanel
        oisy={makeOisy({ tokenStates: {} })}
        onBurnSuccess={onBurnSuccess}
      />,
    );

    // No success yet — nothing reported.
    expect(onBurnSuccess).not.toHaveBeenCalled();

    // The burn completes: the token transitions to 'success'.
    const succeeded = makeOisy({
      tokenStates: { "1": "success" },
      tokenResults: { "1": { kind: "success", tokenId: 1n } },
    });
    rerender(<OisyBurnPanel oisy={succeeded} onBurnSuccess={onBurnSuccess} />);
    expect(onBurnSuccess).toHaveBeenCalledTimes(1);
    expect(onBurnSuccess).toHaveBeenCalledWith("1");

    // A re-render with the same success state must not fire again.
    rerender(<OisyBurnPanel oisy={succeeded} onBurnSuccess={onBurnSuccess} />);
    expect(onBurnSuccess).toHaveBeenCalledTimes(1);
  });
});
