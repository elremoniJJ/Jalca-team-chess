import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the OPENING Move_Maker burn restriction and the
 * spells-off gate, taken BEFORE the shield/spell resolution layer is added.
 *
 * The request adds per-game shield totals and offensive-spell resolution, and
 * restates the opening rule: the opening Move_Maker (whichever color opens,
 * including random Black openings) may only burn/play a defensive Subao Ve,
 * and with no Subao Ve held they make a plain chess move with no NFT spell.
 * That opening restriction already exists in the hook as the "first turn"
 * rule and must survive the shield work unchanged.
 *
 * What IS protected here — the two restriction branches no other suite
 * exercises (the sibling oisy-burn-restriction-rules-characterization file
 * covers the missing-spell-name, missing-game-number, already-burned, and
 * not-Move_Maker branches):
 *   - on the first turn (no moves yet) a Minor/Major NFT is disabled with the
 *     first-turn reason and the "First Move_Maker ... may only burn a
 *     defensive Subao Ve" note, while a Subao Ve NFT stays enabled;
 *   - on a later turn (a move exists) a Minor/Major NFT is enabled;
 *   - when NFT spells are voted off, the global gate and the per-NFT note
 *     report the spells-off wording.
 *
 * The backend actor and the oisy-signer module are typed local mocks, so this
 * is component/integration coverage of the hook's restriction gates — not
 * real backend behavior. The real backend burn path is exercised by the
 * PocketIC lane.
 */

vi.mock("@/backend", () => ({
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
  BurnedSpellCategory: { Major: "Major", Minor: "Minor", SubaoVe: "SubaoVe" },
  Team: { Black: "Black", White: "White" },
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
}));

const { actorMethods } = vi.hoisted(() => ({
  actorMethods: {
    updateWalletAddress: vi.fn(),
    recordBurn: vi.fn(),
    burnNft: vi.fn(),
    getNftsForOwner: vi.fn(),
    getNftMetadata: vi.fn(),
  },
}));

// A static spell table used to resolve a spell's burn category from its name.
const { spellTable } = vi.hoisted(() => ({
  spellTable: {
    block: {
      id: 1n,
      complexity: { Moderate: null },
      nftEligible: true,
      meaning: "Defensive shield",
      name: "Subao Ve",
      spell: "block",
      category: { Block: null },
      dropChance: 1n,
    },
    minor: [
      {
        id: 2n,
        complexity: { Easy: null },
        nftEligible: true,
        meaning: "Attacking",
        name: "Minor Spell",
        spell: "minor",
        category: { Minor: null },
        dropChance: 1n,
      },
    ],
    major: [
      {
        id: 3n,
        complexity: { Complex: null },
        nftEligible: true,
        meaning: "Attacking",
        name: "Major Spell",
        spell: "major",
        category: { Major: null },
        dropChance: 1n,
      },
    ],
  },
}));

vi.mock("@/lib/backend-actor", () => ({
  getActor: vi.fn().mockResolvedValue({
    ...actorMethods,
    getSpellTable: vi.fn().mockResolvedValue(spellTable),
  }),
  useActorState: () => ({
    actor: { getSpellTable: vi.fn().mockResolvedValue(spellTable) },
    isLoading: false,
    error: null,
  }),
}));

// The hook consumes useGameState (Move_Maker principal + move list) and
// useBurnState (one-burn-per-turn flag). Both are hoisted so individual tests
// can drive the opening (no moves) vs later-turn (one move) distinction.
const { gameState, burnState } = vi.hoisted(() => ({
  gameState: {
    moveMaker: "player-1" as string,
    moves: [] as unknown[],
  },
  burnState: { burnOccurredThisTurn: false },
}));

vi.mock("@/hooks/use-game-state", () => ({
  useGameState: () => ({
    data: { moveMaker: gameState.moveMaker, turn: "White" },
    isLoading: false,
    error: null,
    moves: gameState.moves,
    lastMove: null,
    prevBoard: null,
    checkSquare: null,
    // The hook now compares the shown move count against the number of moves
    // the opening seeded (0 for a Standard opening) to detect the opening
    // turn. This file characterizes the Standard-opening case, so the seeded
    // count is 0.
    openingMoveCount: 0,
  }),
}));
vi.mock("@/hooks/use-burn-state", () => ({
  useBurnState: () => ({
    data: { burnOccurredThisTurn: burnState.burnOccurredThisTurn },
    isLoading: false,
    error: null,
  }),
}));

// The hook's mount effect probes the signer library and preloads its modules;
// mock the whole module so no real popup is opened.
const { isSignerAvailable, preloadSigner } = vi.hoisted(() => ({
  isSignerAvailable: vi.fn(),
  preloadSigner: vi.fn(),
}));
vi.mock("@/oisy-burn/oisy-signer", () => ({
  openOisySignerSync: vi.fn(),
  getOisyAccounts: vi.fn(),
  fetchOwnedNfts: vi.fn(),
  isSignerAvailable,
  preloadSigner,
}));

vi.mock("@icp-sdk/signer", () => ({ __esModule: true, default: {} }));

import type { OisyNft } from "@/oisy-burn/types";
import { useOisyBurn } from "@/oisy-burn/use-oisy-burn";

/** One move, so the game is past the opening turn. */
const oneMove = {
  from: 12,
  to: 28,
  color: "White",
  piece: "Pawn",
  captured: null,
  capturedSquare: null,
  promotion: null,
  castle: false,
  isEnPassant: false,
};

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
 * A harness exposing the per-NFT restriction reason and note plus the global
 * canBurn gate, so the restriction rules can be asserted directly without
 * rendering the whole panel. The panel consumes exactly these values to decide
 * whether each burn button is enabled.
 */
function RestrictionHarness({
  principal,
  nft,
  spellUseEnabled,
}: {
  principal: string;
  nft: OisyNft;
  spellUseEnabled: boolean;
}) {
  const oisy = useOisyBurn(principal, spellUseEnabled);
  return (
    <div>
      <span data-testid="can-burn">{String(oisy.canBurn)}</span>
      <span data-testid="burn-reason">{oisy.burnDisabledReason ?? "NONE"}</span>
      <span data-testid="reason">
        {oisy.burnDisabledReasonFor(nft) ?? "ENABLED"}
      </span>
      <span data-testid="note">{oisy.burnNoteFor(nft) ?? "NO-NOTE"}</span>
    </div>
  );
}

function renderHarness(
  principal: string,
  nft: OisyNft,
  spellUseEnabled = true,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RestrictionHarness
        principal={principal}
        nft={nft}
        spellUseEnabled={spellUseEnabled}
      />
    </QueryClientProvider>,
  );
}

describe("useOisyBurn opening Move_Maker restriction", () => {
  beforeEach(() => {
    isSignerAvailable.mockReturnValue(true);
    preloadSigner.mockResolvedValue(true);
    gameState.moveMaker = "player-1";
    gameState.moves = [];
    burnState.burnOccurredThisTurn = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("disables a Minor/Major NFT on the opening turn with the first-turn reason and note", async () => {
    // No moves yet -> the opening Move_Maker's turn.
    renderHarness("player-1", makeNft({ spellName: "Minor Spell" }));

    await waitFor(() => {
      expect(screen.getByTestId("reason")).toHaveTextContent(
        "On the first turn only a defensive Subao Ve NFT can be burned.",
      );
    });
    // The contextual note uses the requested opening-restriction wording.
    expect(screen.getByTestId("note")).toHaveTextContent(
      "First Move_Maker of the game may only burn a defensive Subao Ve",
    );
  });

  it("keeps a Subao Ve NFT enabled on the opening turn", async () => {
    renderHarness("player-1", makeNft({ spellName: "Subao Ve" }));

    await waitFor(() => {
      expect(screen.getByTestId("can-burn")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("reason")).toHaveTextContent("ENABLED");
    expect(screen.getByTestId("note")).toHaveTextContent("NO-NOTE");
  });

  it("enables a Minor/Major NFT once the opening turn has passed", async () => {
    // A move exists -> not the opening turn, so attacking spells are allowed.
    gameState.moves = [oneMove];
    renderHarness("player-1", makeNft({ spellName: "Minor Spell" }));

    await waitFor(() => {
      expect(screen.getByTestId("can-burn")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("reason")).toHaveTextContent("ENABLED");
    expect(screen.getByTestId("note")).toHaveTextContent("NO-NOTE");
  });

  it("reports the spells-off wording through the global gate and the per-NFT note", async () => {
    gameState.moves = [oneMove];
    renderHarness("player-1", makeNft(), false);

    await waitFor(() => {
      expect(screen.getByTestId("can-burn")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("burn-reason")).toHaveTextContent(
      "NFT spells are turned off for this game.",
    );
    expect(screen.getByTestId("reason")).toHaveTextContent(
      "NFT spells are turned off for this game.",
    );
    expect(screen.getByTestId("note")).toHaveTextContent(
      "NFT spell burning voted to be turned off for this game",
    );
  });
});
