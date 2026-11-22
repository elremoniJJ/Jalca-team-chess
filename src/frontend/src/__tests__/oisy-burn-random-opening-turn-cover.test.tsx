import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted opening-turn detection change on the game screen,
 * taken AFTER the implementation.
 *
 * Accepted behavior:
 *   - the first turn is "no REAL move has been made since the opening
 *     finished", detected by comparing the shown move count against the number
 *     of moves the opening seeded (`openingMoveCount`), not against zero;
 *   - with a Random opening the seeded replay moves are present in `moves`, so
 *     the first Move_Maker must STILL be treated as the opening Move_Maker: a
 *     Minor/Major NFT is disabled with the opening-turn reason and note, while
 *     a Subao Ve NFT stays enabled;
 *   - with a Standard opening (openingMoveCount 0, no seeded moves) the first
 *     Move_Maker's Minor/Major NFT is disabled and a Subao Ve stays enabled,
 *     exactly as before;
 *   - once a real move has been made past the seeded count, a Minor/Major NFT
 *     is enabled.
 *
 * The sibling oisy-burn-opening-move-maker-characterization file covers the
 * Standard-opening case with a mock that omits `openingMoveCount` (so it falls
 * back to 0). This file pins the Random-opening case the change fixes, where
 * `moves` is non-empty but equals the seeded count.
 *
 * The backend actor and the oisy-signer module are typed local mocks, so this
 * is component/integration coverage of the hook's restriction gates — not real
 * backend behavior. The real backend burn path is exercised by the PocketIC
 * lane (random-opening-turn-cover.test.ts).
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

// The hook consumes useGameState (Move_Maker principal, move list, and the
// seeded opening-move count) and useBurnState (one-burn-per-turn flag). Both
// are hoisted so individual tests can drive the Random-opening (seeded moves)
// vs Standard-opening (no moves) vs past-opening (a real move) distinction.
const { gameState, burnState } = vi.hoisted(() => ({
  gameState: {
    moveMaker: "player-1" as string,
    moves: [] as unknown[],
    openingMoveCount: 0,
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
    openingMoveCount: gameState.openingMoveCount,
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

/** Two seeded opening moves, as a Random opening would pre-fill. */
const seededOpeningMoves = [oneMove, { ...oneMove, from: 52, to: 36 }];

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

describe("useOisyBurn opening-turn detection with a Random opening", () => {
  beforeEach(() => {
    isSignerAvailable.mockReturnValue(true);
    preloadSigner.mockResolvedValue(true);
    gameState.moveMaker = "player-1";
    gameState.moves = [];
    gameState.openingMoveCount = 0;
    burnState.burnOccurredThisTurn = false;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("disables a Minor/Major NFT on the first turn of a Random opening", async () => {
    // A Random opening pre-fills `moves` with its seeded replay moves, so the
    // shown move count is non-zero. The seeded count matches, so this is still
    // the opening turn and an attacking spell is disabled.
    gameState.moves = seededOpeningMoves;
    gameState.openingMoveCount = seededOpeningMoves.length;
    renderHarness("player-1", makeNft({ spellName: "Minor Spell" }));

    await waitFor(() => {
      expect(screen.getByTestId("reason")).toHaveTextContent(
        "On the first turn only a defensive Subao Ve NFT can be burned.",
      );
    });
    expect(screen.getByTestId("note")).toHaveTextContent(
      "First Move_Maker of the game may only burn a defensive Subao Ve",
    );
  });

  it("keeps a Subao Ve NFT enabled on the first turn of a Random opening", async () => {
    gameState.moves = seededOpeningMoves;
    gameState.openingMoveCount = seededOpeningMoves.length;
    renderHarness("player-1", makeNft({ spellName: "Subao Ve" }));

    await waitFor(() => {
      expect(screen.getByTestId("can-burn")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("reason")).toHaveTextContent("ENABLED");
    expect(screen.getByTestId("note")).toHaveTextContent("NO-NOTE");
  });

  it("disables a Minor/Major NFT on the first turn of a Standard opening", async () => {
    // A Standard opening seeds no moves, so the shown count is zero and the
    // seeded count is zero: still the opening turn.
    gameState.moves = [];
    gameState.openingMoveCount = 0;
    renderHarness("player-1", makeNft({ spellName: "Minor Spell" }));

    await waitFor(() => {
      expect(screen.getByTestId("reason")).toHaveTextContent(
        "On the first turn only a defensive Subao Ve NFT can be burned.",
      );
    });
    expect(screen.getByTestId("note")).toHaveTextContent(
      "First Move_Maker of the game may only burn a defensive Subao Ve",
    );
  });

  it("keeps a Subao Ve NFT enabled on the first turn of a Standard opening", async () => {
    gameState.moves = [];
    gameState.openingMoveCount = 0;
    renderHarness("player-1", makeNft({ spellName: "Subao Ve" }));

    await waitFor(() => {
      expect(screen.getByTestId("can-burn")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("reason")).toHaveTextContent("ENABLED");
    expect(screen.getByTestId("note")).toHaveTextContent("NO-NOTE");
  });

  it("enables a Minor/Major NFT once a real move is made past a Random opening", async () => {
    // One real move beyond the seeded count ends the opening turn, so an
    // attacking spell is allowed.
    gameState.moves = [...seededOpeningMoves, oneMove];
    gameState.openingMoveCount = seededOpeningMoves.length;
    renderHarness("player-1", makeNft({ spellName: "Minor Spell" }));

    await waitFor(() => {
      expect(screen.getByTestId("can-burn")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("reason")).toHaveTextContent("ENABLED");
    expect(screen.getByTestId("note")).toHaveTextContent("NO-NOTE");
  });
});
